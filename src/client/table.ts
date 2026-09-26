/**
 * A table card: rows paged, sorted and searched on the server, with row actions.
 *
 * Part of the extras bundle, with the charts: a panel without tables or charts never loads it.
 * On a narrow screen the stylesheet turns each row into a card of labelled lines, which is why
 * every cell carries its column's label in `data-label`.
 */
import type { TableRowsAnswer, TableSchema } from "../types.js";
import type { Api } from "./api.js";
import { confirmingButton } from "./blocks.js";
import { clear, el } from "./dom.js";
import { formatValue } from "./format.js";
import { localeSpec } from "./i18n.js";
import { explain } from "./explain.js";
import type { Translate } from "./i18n.js";

// ---------------------------------------------------------------------------------------------

export interface TableView {
  element: HTMLElement;
  /** Fetches the current page again; called on each poll while the table is visible. */
  refresh(): void;
}

export function buildTable(schema: TableSchema, api: Api | undefined, t: Translate): TableView {
  const wrap = el("div", "apb-block-table");
  const controls = el("div", "apb-table-controls");
  const search = el("input", "apb-input");
  search.type = "search";
  search.setAttribute("aria-label", t("tableSearch", { label: schema.title }));
  search.placeholder = t("tableSearch", { label: schema.title });
  if (schema.searchable && api !== undefined) controls.append(search);
  const status = el("p", "apb-hint");
  status.setAttribute("aria-live", "polite");
  const scroller = el("div", "apb-table-wrap");
  const pager = el("div", "apb-pager");
  const previous = el("button", "apb-tool", t("previous"));
  const next = el("button", "apb-tool", t("next"));
  previous.type = "button";
  next.type = "button";
  const range = el("span", "apb-hint");
  pager.append(previous, range, next);
  const message = el("p", "apb-result");
  message.setAttribute("aria-live", "polite");
  wrap.append(controls, scroller, pager, status, message);

  let offset = 0;
  let sort: string | undefined;
  let dir: "asc" | "desc" = "asc";
  let query = "";
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;

  /** A request asked for while another was out: it runs when that one returns, with the latest query. */
  let again = false;
  const load = (): void => {
    if (api === undefined) return;
    if (inFlight) {
      // Dropping it would show the page for the query before the one the operator just asked for.
      again = true;
      return;
    }
    inFlight = true;
    api
      .table(schema.id, { offset, limit: schema.pageSize, sort, dir, q: query })
      .then((answer) => {
        status.textContent = "";
        show(answer);
      })
      .catch((problem: unknown) => {
        status.textContent = problem instanceof Error ? problem.message : String(problem);
      })
      .finally(() => {
        inFlight = false;
        if (again) {
          again = false;
          load();
        }
      });
  };

  /** What is drawn now, so an answer that changes nothing leaves the rows, and any selection in them, alone. */
  let shown = "";
  const show = (answer: TableRowsAnswer): void => {
    const key = `${offset}|${sort ?? ""}|${dir}|${JSON.stringify(answer)}`;
    if (key === shown) return;
    shown = key;
    total = answer.total;
    clear(scroller);
    const table = el("table", "apb-table apb-table-stacking");
    const caption = el("caption", "apb-sr", schema.title);
    const head = el("tr");
    // A column of numbers is right-aligned, heading included, so the digits line up by place.
    const numeric = new Set(schema.columns.filter((column) => (column.format !== undefined && column.format !== "plain" && column.format !== "timestamp") || (answer.rows.length > 0 && answer.rows.every((row) => { const cell = row.cells[column.key]; return cell === null || cell === undefined || typeof cell === "number"; }))).map((column) => column.key));
    for (const column of schema.columns) {
      const th = el("th", numeric.has(column.key) ? "apb-num" : null);
      th.setAttribute("scope", "col");
      if (column.sortable && api !== undefined) {
        const button = el("button", "apb-sort", column.label);
        button.type = "button";
        th.setAttribute("aria-sort", sort === column.key ? (dir === "asc" ? "ascending" : "descending") : "none");
        button.addEventListener("click", () => {
          if (sort === column.key) dir = dir === "asc" ? "desc" : "asc";
          else {
            sort = column.key;
            dir = "asc";
          }
          offset = 0;
          load();
        });
        th.append(button);
      } else th.textContent = column.label;
      head.append(th);
    }
    if (schema.actions.length > 0) {
      const th = el("th", "apb-sr", t("tableActions"));
      th.setAttribute("scope", "col");
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const row of answer.rows) {
      const tr = el("tr");
      for (const column of schema.columns) {
        const value = row.cells[column.key] ?? null;
        const td = el("td", numeric.has(column.key) ? "apb-num" : null, formatValue(value, { format: column.format, unit: column.unit, decimals: column.decimals, ...localeSpec(t) }));
        // Read by the stylesheet on narrow screens, where each row becomes a card of labelled lines.
        td.dataset.label = column.label;
        const flagged = row.status?.[column.key];
        // In a table only what needs attention gets a word: "OK" on every row is noise.
        if (flagged !== undefined && flagged !== "ok") {
          td.dataset.status = flagged;
          td.append(el("span", "apb-status-word", ` ${t(flagged === "bad" ? "statusBad" : "statusWarn")}`));
        }
        tr.append(td);
      }
      if (schema.actions.length > 0) {
        const td = el("td", "apb-row-actions");
        td.dataset.label = "";
        for (const action of schema.actions) {
          const button = confirmingButton(action.label, action.confirm, action.destructive ? "apb-tool apb-tool-destructive" : "apb-tool", t, async () => {
            if (api === undefined) return;
            try {
              const said = await api.runRow(schema.id, action.id, row.id);
              message.dataset.ok = "true";
              message.textContent = said;
              load();
            } catch (problem) {
              message.dataset.ok = "false";
              message.textContent = explain(problem, t);
            }
          });
          button.disabled = !schema.runnable;
          button.setAttribute("aria-label", `${action.label}: ${row.id}`);
          td.append(button);
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(caption, thead, tbody);
    scroller.append(table);
    // Nothing to show and nothing asked for is not the same as nothing matching what was asked.
    if (answer.rows.length === 0) scroller.append(el("p", "apb-empty", t(query === "" ? "tableNothing" : "tableEmpty")));
    range.textContent = total === 0 ? "" : t("tableRange", { from: offset + 1, to: offset + answer.rows.length, total });
    previous.disabled = offset === 0;
    next.disabled = offset + answer.rows.length >= total;
  };

  previous.addEventListener("click", () => {
    offset = Math.max(0, offset - schema.pageSize);
    load();
  });
  next.addEventListener("click", () => {
    offset += schema.pageSize;
    load();
  });
  search.addEventListener("input", () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      query = search.value.trim();
      offset = 0;
      load();
    }, 250);
  });
  if (api === undefined) status.textContent = t("snapshotNoRows");
  return { element: wrap, refresh: load };
}

