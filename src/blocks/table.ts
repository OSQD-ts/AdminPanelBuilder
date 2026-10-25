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
import type { CardSize, DateFormat, ImageOptions, JsonValue, QrOptions, RowMatch, Span, Status, StatusRule, TableColumn, TableOptions, TableQuery, TableRowAction, TableRowsAnswer, TableSchema } from "../types.js";
import { checkDisplay } from "../values/display.js";
import { toJson } from "../values/kinds.js";
import { checkStatusRule, statusOf } from "../values/status.js";
import { checkVisibility } from "../actions.js";
import { type ResolvedField, resolveInput } from "../values/input.js";

/** Most rows one page may carry: a screenful several times over, and a bounded response. */
export const MAX_PAGE_SIZE = 200;
/** Longest search a page may send. Longer is a paste, not a search. */
export const MAX_SEARCH_LENGTH = 200;
const DEFAULT_TABLE_TIMEOUT_MS = 10_000;
const COLUMN_KEYS = ["key", "label", "format", "dateFormat", "image", "qr", "unit", "decimals", "sortable", "status"];
const TABLE_KEYS = ["id", "label", "description", "group", "order", "span", "size", "columns", "rows", "fetch", "findRow", "rowId", "pageSize", "searchable", "actions", "timeoutMs"];

export interface ResolvedColumn {
  key: string;
  label: string;
  format: TableColumn["format"];
  dateFormat: DateFormat | undefined;
  image: ImageOptions | undefined;
  qr: QrOptions | undefined;
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
  /** The label is typed before it runs. */
  typeToConfirm: boolean;
  /** The fields it asks for, checked like an action's. */
  input: ResolvedField[] | undefined;
  visibility: import("../types.js").ActionVisibility | undefined;
  /** Whether a row shows it; undefined: every row. */
  when: ((row: unknown) => boolean) | undefined;
  /** Whether a row may run it: `true`, or the reason it may not (`""` for none given); undefined: every row that shows it. */
  enabledWhen: ((row: unknown) => true | string) | undefined;
}

/** Whether `row` shows `action` and may run it, and if not, why. A condition that throws hides the action: a button is never offered on a guess. */
export function availability(action: RowAction, row: unknown): { shown: boolean; disabled?: string } {
  try {
    if (action.when !== undefined && !action.when(row)) return { shown: false };
    const enabled = action.enabledWhen === undefined ? true : action.enabledWhen(row);
    return enabled === true ? { shown: true } : { shown: true, disabled: enabled };
  } catch {
    return { shown: false };
  }
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
      rejectUnknown(action, ["id", "label", "run", "confirm", "destructive", "timeoutMs", "input", "visibility", "when", "enabledWhen"], `table "${label}", action ${index + 1}`);
      if (action.confirm !== undefined && typeof action.confirm !== "boolean" && action.confirm !== "type") throw new AdminPanelConfigError(`table "${label}" has a row action "${action.label}" with confirm ${JSON.stringify(action.confirm)}; it is true, false or "type"`);
      if (typeof action.run !== "function") throw new AdminPanelConfigError(`table "${label}" has a row action "${action.label}" with nothing to run`);
      return {
        id: checkId(action.id ?? (slug(action.label) || `action-${index + 1}`), `table "${label}", action "${action.label}"`),
        label: action.label,
        run: action.run,
        confirm: action.confirm === true || action.confirm === "type" || action.destructive === true,
        destructive: action.destructive === true,
        timeoutMs: action.timeoutMs ?? 30_000,
        typeToConfirm: action.confirm === "type",
        input: action.input === undefined ? undefined : resolveInput(`${label}: ${action.label}`, action.input),
        visibility: checkVisibility(action.visibility, `table "${label}", row action "${action.label}": visibility`),
        when: compileWhen(label, action, this.columns, this.rowId),
        enabledWhen: compileEnabledWhen(label, action, this.columns, this.rowId),
      };
    });
    this.conditional = this.rowActions.some((action) => action.when !== undefined || action.enabledWhen !== undefined);
    // Running a conditional action checks the row as it is now, so the panel must be able to find
    // it: a `rows` table looks among its rows, a `fetch` table has no way to without `findRow`.
    if (this.conditional && options.fetch !== undefined && options.findRow === undefined) {
      throw new AdminPanelConfigError(`table "${label}" has row actions with when or enabledWhen and rows from fetch, so it needs findRow(rowId): running one checks the row as it is now`);
    }
    if (options.findRow !== undefined && typeof options.findRow !== "function") throw new AdminPanelConfigError(`table "${label}" has a findRow that is not a function`);
  }

  /** @internal Whether any row action depends on the row. */
  readonly conditional: boolean;

  /**
   * @internal The row with this id as it is now, for checking a conditional row action before it
   * runs: `findRow`, or a search of `rows`. Undefined when there is no such row any more.
   */
  async rowFor(rowId: string): Promise<Row | undefined> {
    const find = this.options.findRow;
    if (find !== undefined) return withDeadline(Promise.resolve().then(() => find(rowId)), this.timeoutMs, `the table "${this.label}"`);
    const source = this.options.rows;
    const all = typeof source === "function" ? await withDeadline(Promise.resolve().then(source), this.timeoutMs, `the table "${this.label}"`) : (source ?? []);
    return all.find((row) => {
      const id = cell(row, this.rowId);
      return id !== undefined && id !== null && String(id) === rowId;
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
        if (column.dateFormat !== undefined) out.dateFormat = column.dateFormat;
        if (column.image !== undefined) out.image = column.image;
        if (column.qr !== undefined) out.qr = column.qr;
        if (column.unit !== undefined) out.unit = column.unit;
        if (column.decimals !== undefined) out.decimals = column.decimals;
        return out;
      }),
      pageSize: this.pageSize,
      searchable: this.searchable,
      actions: this.rowActions.map(({ id, label, confirm, destructive, input, typeToConfirm }) => ({
        id,
        label,
        confirm,
        destructive,
        ...(input === undefined || input.length === 0 ? {} : { input: input.map((field) => field.schema) }),
        ...(typeToConfirm ? { typeToConfirm } : {}),
      })),
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
        // Which actions this row offers, worked out here so the page draws only what may be run.
        if (this.conditional) {
          const shown: string[] = [];
          const disabled: Record<string, string> = {};
          for (const action of this.rowActions) {
            const state = availability(action, row);
            if (!state.shown) continue;
            shown.push(action.id);
            if (state.disabled !== undefined) disabled[action.id] = state.disabled;
          }
          out.actions = shown;
          if (Object.keys(disabled).length > 0) out.disabled = disabled;
        }
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
  const display = checkDisplay(`table "${table}", column "${spec.key}"`, spec);
  return {
    key: spec.key,
    label: spec.label ?? spec.key,
    format: display.format,
    dateFormat: display.dateFormat,
    image: display.image,
    qr: display.qr,
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

/** The longest reason a disabled row action may give: a sentence, not a page. */
export const MAX_DISABLED_REASON = 200;

/** A `RowMatch` as a test of a row, checked against the table's columns. */
function compileMatch(where: string, match: RowMatch, columns: readonly ResolvedColumn[], rowId: string, extra: readonly string[]): (row: unknown) => boolean {
  if (match === null || typeof match !== "object" || Array.isArray(match)) throw new AdminPanelConfigError(`${where} is a function or { field, equals } / { field, in }`);
  rejectUnknown(match, ["field", "equals", "in", ...extra], where);
  const field = (match as { field?: unknown }).field;
  if (typeof field !== "string" || (field !== rowId && !columns.some((column) => column.key === field))) {
    throw new AdminPanelConfigError(`${where} names the field ${JSON.stringify(field)}, which is not one of the table's columns (${columns.map((column) => column.key).join(", ")})`);
  }
  const scalar = (value: unknown): boolean => value === null || ["string", "number", "boolean"].includes(typeof value);
  const hasEquals = Object.hasOwn(match, "equals");
  const hasIn = Object.hasOwn(match, "in");
  if (hasEquals === hasIn) throw new AdminPanelConfigError(`${where} needs exactly one of equals or in`);
  if (hasEquals) {
    const wanted = (match as { equals: unknown }).equals;
    if (!scalar(wanted)) throw new AdminPanelConfigError(`${where}: equals is a string, number, boolean or null`);
    return (row) => cell(row, field) === wanted;
  }
  const list = (match as { in: unknown }).in;
  if (!Array.isArray(list) || list.length === 0 || !list.every(scalar)) throw new AdminPanelConfigError(`${where}: in is a non-empty list of strings, numbers, booleans or null`);
  const set = new Set<unknown>(list);
  return (row) => set.has(cell(row, field));
}

function compileWhen(table: string, action: TableRowAction<never>, columns: readonly ResolvedColumn[], rowId: string): RowAction["when"] {
  const when = action.when as unknown;
  if (when === undefined) return undefined;
  if (typeof when === "function") return (row) => (when as (row: unknown) => unknown)(row) === true;
  return compileMatch(`table "${table}", row action "${action.label}": when`, when as RowMatch, columns, rowId, []);
}

function compileEnabledWhen(table: string, action: TableRowAction<never>, columns: readonly ResolvedColumn[], rowId: string): RowAction["enabledWhen"] {
  const enabled = action.enabledWhen as unknown;
  if (enabled === undefined) return undefined;
  const where = `table "${table}", row action "${action.label}": enabledWhen`;
  const reasonOf = (said: unknown): true | string => {
    if (said === true) return true;
    if (typeof said === "string") return said.trim().slice(0, MAX_DISABLED_REASON);
    return "";
  };
  if (typeof enabled === "function") return (row) => reasonOf((enabled as (row: unknown) => unknown)(row));
  const reason = (enabled as { reason?: unknown }).reason;
  if (reason !== undefined && (typeof reason !== "string" || reason.length > MAX_DISABLED_REASON)) throw new AdminPanelConfigError(`${where}: reason is a sentence of at most ${MAX_DISABLED_REASON} characters`);
  const test = compileMatch(where, enabled as RowMatch, columns, rowId, ["reason"]);
  return (row) => (test(row) ? true : (reason ?? ""));
}
