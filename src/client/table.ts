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

  const load = (): void => {
    if (api === undefined || inFlight) return;
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
      });
  };

  const show = (answer: TableRowsAnswer): void => {
    total = answer.total;
    clear(scroller);
    const table = el("table", "apb-table apb-table-stacking");
    const caption = el("caption", "apb-sr", schema.title);
    const head = el("tr");
    for (const column of schema.columns) {
      const th = el("th");
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
      const th = el("th", "apb-sr", "Actions");
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
        const td = el("td", null, formatValue(value, { format: column.format, unit: column.unit, decimals: column.decimals }));
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
              message.dataset.ok = "true";
              message.textContent = await api.runRow(schema.id, action.id, row.id);
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
    if (answer.rows.length === 0) scroller.append(el("p", "apb-empty", t("tableEmpty")));
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
  if (api === undefined) status.textContent = "A snapshot does not include table rows.";
  return { element: wrap, refresh: load };
}

