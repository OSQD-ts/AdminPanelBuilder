/**
 * Rows: games in progress, queued mail, actors, customers.
 *
 * Two sources. `rows` hands the panel everything and the panel sorts, searches and pages it, which
 * is right for anything the process already holds in memory. `fetch` hands the panel a function
 * that answers one page for a query, which is right for anything that lives in a database: the
 * whole set never crosses into the panel, let alone to a browser.
 *
 * Every cell is JSON and every string in it is text somebody may have written; the page shows it
 * as text. A page is at most `MAX_PAGE_SIZE` rows, and a query that does not answer within its
 * deadline fails rather than holding the page open.
 */
import { AdminPanelConfigError } from "../errors.js";
import { withDeadline } from "../internal/async.js";
import { checkId, slug } from "../internal/ids.js";
import { rejectUnknown } from "../internal/options.js";
import type { CardSize, JsonValue, Span, Status, StatusRule, TableColumn, TableOptions, TableQuery, TableRowsAnswer, TableSchema } from "../types.js";
import { toJson } from "../values/kinds.js";
import { checkStatusRule, statusOf } from "../values/status.js";

/** Most rows one page may carry: a screenful several times over, and a bounded response. */
export const MAX_PAGE_SIZE = 200;
/** Longest search a page may send. Longer is a paste, not a search. */
export const MAX_SEARCH_LENGTH = 200;
const DEFAULT_TABLE_TIMEOUT_MS = 10_000;
const COLUMN_KEYS = ["key", "label", "format", "unit", "decimals", "sortable", "status"];
const TABLE_KEYS = ["id", "label", "description", "group", "order", "span", "size", "columns", "rows", "fetch", "rowId", "pageSize", "searchable", "actions", "timeoutMs"];

export interface ResolvedColumn {
  key: string;
  label: string;
  format: TableColumn["format"];
  unit: string | undefined;
  decimals: number | undefined;
  sortable: boolean;
  status: StatusRule | undefined;
}

export interface RowAction {
  id: string;
  label: string;
  run: (rowId: string, context: import("../types.js").ActionContext) => unknown;
  confirm: boolean;
  destructive: boolean;
  timeoutMs: number;
}

export class PanelTable<Row = Record<string, unknown>> {
  /** @internal */
  group: string;
  /** @internal */ readonly columns: ResolvedColumn[];
  /** @internal */ readonly rowActions: RowAction[];
  /** @internal */ readonly order: number;
  /** @internal */ readonly sequence: number;
  private readonly rowId: string;
  private readonly pageSize: number;
  private readonly searchable: boolean;
  private readonly timeoutMs: number;
  private readonly span: Span | undefined;
  private readonly size: CardSize | undefined;
  private readonly description: string | undefined;

  /** @internal Built by the panel; declare tables with `table()`. */
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly options: TableOptions<Row>,
    group: string,
    sequence: number,
  ) {
    this.group = group;
    this.sequence = sequence;
    this.order = options.order ?? 0;
    this.rowId = options.rowId ?? "id";
    this.pageSize = options.pageSize ?? 25;
    this.searchable = options.searchable !== false;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TABLE_TIMEOUT_MS;
    this.span = options.span;
    this.size = options.size;
    this.description = options.description;
    this.columns = options.columns.map((column) => resolveColumn(label, column));
    this.rowActions = (options.actions ?? []).map((action, index) => {
      rejectUnknown(action, ["id", "label", "run", "confirm", "destructive", "timeoutMs"], `table "${label}", action ${index + 1}`);
      if (typeof action.run !== "function") throw new AdminPanelConfigError(`table "${label}" has a row action "${action.label}" with nothing to run`);
      return {
        id: checkId(action.id ?? (slug(action.label) || `action-${index + 1}`), `table "${label}", action "${action.label}"`),
        label: action.label,
        run: action.run,
        confirm: action.confirm === true || action.destructive === true,
        destructive: action.destructive === true,
        timeoutMs: action.timeoutMs ?? 30_000,
      };
    });
  }

  /** @internal */
  schema(runnable: boolean): TableSchema {
    const schema: TableSchema = {
      type: "table",
      id: this.id,
      title: this.label,
      columns: this.columns.map((column) => {
        const out: TableSchema["columns"][number] = { key: column.key, label: column.label, sortable: column.sortable };
        if (column.format !== undefined) out.format = column.format;
        if (column.unit !== undefined) out.unit = column.unit;
        if (column.decimals !== undefined) out.decimals = column.decimals;
        return out;
      }),
      pageSize: this.pageSize,
      searchable: this.searchable,
      actions: this.rowActions.map(({ id, label, confirm, destructive }) => ({ id, label, confirm, destructive })),
      runnable: runnable && this.rowActions.length > 0,
    };
    if (this.description !== undefined) schema.description = this.description;
    if (this.span !== undefined) schema.span = this.span;
    if (this.size !== undefined) schema.size = this.size;
    return schema;
  }

  /** @internal One page for the query. Rejects with a sentence when the source fails or is too slow. */
  async page(query: TableQuery): Promise<TableRowsAnswer> {
    const limit = Math.min(query.limit, MAX_PAGE_SIZE);
    const sortable = query.sort === undefined || this.columns.some((column) => column.key === query.sort && column.sortable);
    const effective: TableQuery = { ...query, limit, sort: sortable ? query.sort : undefined, search: this.searchable ? query.search : "" };
    let rows: readonly Row[];
    let total: number;
    if (this.options.fetch !== undefined) {
      const answer = await withDeadline(Promise.resolve().then(() => (this.options.fetch as NonNullable<TableOptions<Row>["fetch"]>)(effective)), this.timeoutMs, `the table "${this.label}"`);
      rows = (answer?.rows ?? []).slice(0, limit);
      total = Number.isFinite(answer?.total) ? answer.total : rows.length;
    } else {
      const source = this.options.rows;
      const all = typeof source === "function" ? await withDeadline(Promise.resolve().then(source), this.timeoutMs, `the table "${this.label}"`) : (source ?? []);
      const matched = effective.search === "" ? [...all] : all.filter((row) => matches(row, this.columns, effective.search));
      if (effective.sort !== undefined) {
        const key = effective.sort;
        const sign = effective.direction === "desc" ? -1 : 1;
        matched.sort((a, b) => sign * compare(cell(a, key), cell(b, key)));
      }
      total = matched.length;
      rows = matched.slice(effective.offset, effective.offset + limit);
    }
    return {
      rows: rows.map((row, index) => {
        const cells: Record<string, JsonValue> = {};
        const status: Record<string, Status> = {};
        for (const column of this.columns) {
          const raw = cell(row, column.key);
          cells[column.key] = toJson(raw);
          const flagged = statusOf(column.status, raw);
          if (flagged !== undefined) status[column.key] = flagged;
        }
        const id = cell(row, this.rowId);
        const out: TableRowsAnswer["rows"][number] = { id: id === undefined || id === null ? String(effective.offset + index) : String(id), cells };
        if (Object.keys(status).length > 0) out.status = status;
        return out;
      }),
      total,
      offset: effective.offset,
      limit,
    };
  }
}

export function checkTableOptions<Row>(label: string, options: TableOptions<Row>): void {
  rejectUnknown(options, TABLE_KEYS, `table("${label}")`);
  if (!Array.isArray(options.columns) || options.columns.length === 0) throw new AdminPanelConfigError(`table "${label}" has no columns to show`);
  if ((options.rows === undefined) === (options.fetch === undefined)) {
    throw new AdminPanelConfigError(`table "${label}" needs exactly one of rows (the panel pages them) or fetch (you page them)`);
  }
  const size = options.pageSize ?? 25;
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) throw new AdminPanelConfigError(`table "${label}" has a page size of ${size}; it is 1 to ${MAX_PAGE_SIZE}`);
  const keys = new Set<string>();
  for (const column of options.columns) {
    const key = typeof column === "string" ? column : column.key;
    if (keys.has(key)) throw new AdminPanelConfigError(`table "${label}" lists the column "${key}" twice`);
    keys.add(key);
  }
}

function resolveColumn(table: string, column: TableColumn | string): ResolvedColumn {
  const spec: TableColumn = typeof column === "string" ? { key: column } : column;
  rejectUnknown(spec, COLUMN_KEYS, `table "${table}", column "${spec.key}"`);
  if (typeof spec.key !== "string" || spec.key === "") throw new AdminPanelConfigError(`table "${table}" has a column without a key`);
  return {
    key: spec.key,
    label: spec.label ?? spec.key,
    format: spec.format,
    unit: spec.unit,
    decimals: spec.decimals,
    sortable: spec.sortable !== false,
    status: checkStatusRule(`${table}: ${spec.key}`, spec.status),
  };
}

function cell(row: unknown, key: string): unknown {
  if (row === null || typeof row !== "object") return undefined;
  return row instanceof Map ? row.get(key) : (row as Record<string, unknown>)[key];
}

/** Case-insensitive substring over every shown column. */
function matches(row: unknown, columns: readonly ResolvedColumn[], search: string): boolean {
  const needle = search.toLowerCase();
  return columns.some((column) => {
    const value = cell(row, column.key);
    if (value === undefined || value === null) return false;
    return (typeof value === "object" ? JSON.stringify(toJson(value)) : String(value)).toLowerCase().includes(needle);
  });
}

/** Numbers as numbers, everything else as text; missing values last either way. */
function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}
