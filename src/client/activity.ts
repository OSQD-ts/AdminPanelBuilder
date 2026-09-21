/**
 * The Activity tab: changes waiting for approval, recent changes with undo, notices, and the
 * panel's settings as a file.
 *
 * Settings go out as a download of `/api/settings` and come back through a diff: choosing a file
 * shows what importing it would change, value by value, with the reason any would be refused,
 * and nothing is applied until the operator presses the button under that list. The import is
 * one change, applied whole or not at all, like a profile.
 */
import type { JsonValue, SettingDiff } from "../types.js";
import { confirmingButton } from "./blocks.js";
import type { CardHost } from "./cards.js";
import { pendingRow } from "./cards.js";
import { clear, el } from "./dom.js";
import { formatAgo, formatValue } from "./format.js";
import { explain } from "./explain.js";
import { serverTime } from "./store.js";

export interface ActivityView {
  readonly element: HTMLElement;
  show(): void;
}

export function buildActivity(host: CardHost): ActivityView {
  const { t } = host;
  const section = el("div", "apb-activity");
  const pending = el("section");
  pending.append(el("h2", null, t("pendingTitle")));
  const pendingList = el("div");
  pending.append(pendingList);
  const changes = el("section");
  changes.append(el("h2", null, t("recentChanges")));
  const changeList = el("div");
  changes.append(changeList);
  const notices = el("section");
  notices.append(el("h2", null, t("notices")));
  const noticeList = el("div");
  notices.append(noticeList);
  section.append(pending, changes, notices);
  const settings = buildSettings(host);
  if (settings !== undefined) section.append(settings);

  const show = (): void => {
    const store = host.store();
    clear(pendingList);
    pending.hidden = store.pending.length === 0;
    for (const change of store.pending) pendingList.append(pendingRow(host, change, host.values.get(change.target)));
    clear(changeList);
    if (store.changes.length === 0) changeList.append(el("p", "apb-empty", t("noChanges")));
    else changeList.append(changeTable(host, show));
    clear(noticeList);
    if (store.notices.length === 0) noticeList.append(el("p", "apb-empty", t("noNotices")));
    for (const notice of [...store.notices].reverse()) {
      const item = el("div", "apb-notice");
      item.dataset.level = notice.level;
      item.append(el("span", "apb-notice-level", notice.level === "warning" ? "Warning:" : "Note:"), document.createTextNode(notice.message));
      noticeList.append(item);
    }
  };
  return { element: section, show };
}

function changeTable(host: CardHost, refreshed: () => void): HTMLElement {
  const { t, deps } = host;
  const store = host.store();
  const table = el("table", "apb-table apb-table-stacking");
  const headings = ["When", "Who", "What", "Result"];
  const head = el("tr");
  for (const text of [...headings, ""]) {
    const th = el("th", text === "" ? "apb-sr" : null, text === "" ? t("undo") : text);
    th.setAttribute("scope", "col");
    head.append(th);
  }
  const thead = el("thead");
  thead.append(head);
  const body = el("tbody");
  const now = serverTime(store);
  const api = deps.api;
  for (const change of [...store.changes].reverse()) {
    const row = el("tr");
    const schema = host.values.get(change.target);
    const shownValue = (value: JsonValue | undefined): string => (value === undefined ? "hidden" : formatValue(value, schema));
    const what =
      change.kind === "edit" || change.kind === "revert" || change.kind === "scheduled" || (change.kind === "approval" && change.from !== undefined)
        ? change.from === undefined && change.to !== undefined
          ? `${change.label}: → ${shownValue(change.to)}`
          : `${change.label}: ${shownValue(change.from)} → ${shownValue(change.to)}`
        : change.kind === "action"
          ? `Ran ${change.label}`
          : change.label;
    const undo = el("td");
    undo.dataset.label = "";
    if (change.revertible === true && api !== undefined && schema?.writable === true) {
      const result = el("span", "apb-result");
      undo.append(
        confirmingButton(t("undo"), true, "apb-tool", t, async () => {
          try {
            await api.undo(change.id);
            deps.refresh();
            await deps.loadActivity?.();
            refreshed();
          } catch (problem) {
            result.dataset.ok = "false";
            result.textContent = explain(problem, t);
          }
        }),
        result,
      );
    }
    const cells = [formatAgo(change.at, now), change.origin === undefined ? change.by : `${change.by} (${change.origin})`, what, change.outcome ?? (change.ok ? "Applied" : "Failed")];
    cells.forEach((text, index) => {
      const td = el("td", null, text);
      td.dataset.label = headings[index] ?? "";
      row.append(td);
    });
    row.append(undo);
    body.append(row);
  }
  table.append(thead, body);
  const wrap = el("div", "apb-table-wrap");
  wrap.append(table);
  return wrap;
}

/** Download and import. Absent on a snapshot, which has no API to ask. */
function buildSettings(host: CardHost): HTMLElement | undefined {
  const { t, deps } = host;
  const api = deps.api;
  if (api === undefined) return undefined;
  const section = el("section", "apb-settings");
  section.append(el("h2", null, t("settings")), el("p", "apb-hint", t("settingsHint")));
  const result = el("p", "apb-result");
  result.setAttribute("aria-live", "polite");
  const download = el("button", "apb-tool", t("exportSettings"));
  download.type = "button";
  download.addEventListener("click", () => {
    api.settings().then(
      (settings) => {
        const blob = new Blob([`${JSON.stringify({ settings }, null, 2)}\n`], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = el("a");
        link.href = url;
        link.download = `${host.store().schema.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "panel"}-settings.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      (problem: unknown) => {
        result.dataset.ok = "false";
        result.textContent = explain(problem, t);
      },
    );
  });
  // The input inside its label: the label looks like a button, and shows the focus ring of the
  // visually hidden input it holds.
  const label = el("label", "apb-tool apb-file", t("importSettings"));
  const file = el("input", "apb-sr");
  file.type = "file";
  file.accept = "application/json,.json";
  label.append(file);
  const preview = el("div", "apb-import-preview");
  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    file.value = "";
    clear(preview);
    result.textContent = "";
    if (chosen === undefined) return;
    void chosen
      .text()
      .then(async (text) => {
        let settings: unknown;
        try {
          const parsed = JSON.parse(text) as { settings?: unknown };
          settings = parsed !== null && typeof parsed === "object" && "settings" in parsed ? parsed.settings : parsed;
        } catch {
          throw new Error(t("importUnreadable"));
        }
        if (settings === null || typeof settings !== "object" || Array.isArray(settings)) throw new Error(t("importUnreadable"));
        const { diff, unknown } = await api.diffSettings(settings);
        showDiff(host, preview, result, settings, diff, unknown);
      })
      .catch((problem: unknown) => {
        result.dataset.ok = "false";
        result.textContent = explain(problem, t);
      });
  });
  const tools = el("div", "apb-toolbar");
  tools.append(download, label);
  section.append(tools, preview, result);
  return section;
}

function showDiff(host: CardHost, preview: HTMLElement, result: HTMLElement, settings: unknown, diff: SettingDiff[], unknown: string[]): void {
  const { t, deps } = host;
  const api = deps.api;
  if (api === undefined) return;
  if (unknown.length > 0) preview.append(el("p", "apb-note", t("importUnknown", { ids: unknown.join(", ") })));
  if (diff.length === 0) {
    preview.append(el("p", "apb-empty", t("importNothing")));
    return;
  }
  preview.append(el("p", null, t("importChanges")));
  const list = el("ul", "apb-import-diff");
  for (const line of diff) {
    const schema = host.values.get(line.id);
    const item = el("li", null, `${line.label}: ${formatValue(line.from, schema)} → ${formatValue(line.to, schema)}`);
    if (line.error !== undefined) {
      item.dataset.status = "bad";
      item.append(el("span", "apb-status-word", ` ${line.error}`));
    }
    list.append(item);
  }
  preview.append(list);
  const refused = unknown.length > 0 || diff.some((line) => line.error !== undefined);
  const apply = confirmingButton(t("importApply", { count: diff.length }), true, "apb-button", t, async () => {
    try {
      const changed = await api.importSettings(settings);
      clear(preview);
      result.dataset.ok = "true";
      result.textContent = t("importApplied", { count: changed });
      deps.refresh();
    } catch (problem) {
      result.dataset.ok = "false";
      result.textContent = t("importRefused", { reason: explain(problem, t) });
    }
  });
  // Shown but disabled: the list above says why, and a button that would be refused anyway invites the click.
  apply.disabled = refused;
  preview.append(apply);
}
