/**
 * The pieces of cards that are not a single value: feeds, and the input an action asks for. Tables
 * are in `table.ts`, loaded with the charts only on panels that have them; profiles are cards of
 * their own, in `cards.ts`, since they are changed the way values are.
 *
 * Each follows the rules the value cards do: text through `textContent` only, refusals shown in
 * place in the server's words, a second click on the same button for anything declared confirm,
 * and nothing rebuilt while somebody is typing into it.
 */
import type { ActionSchema, FeedEntry, FeedSchema, InputSchema, JsonValue } from "../types.js";
import { busy, clear, el, uid } from "./dom.js";
import { formatAgo, formatValue } from "./format.js";
import { localeSpec, type Translate } from "./i18n.js";
import type { Store } from "./store.js";

const ARM_MS = 5000;

/** A button that needs a second click when `confirm` is set; the label says what the second click does. */
export function confirmingButton(label: string, confirm: boolean, className: string, t: Translate, run: () => Promise<void>): HTMLButtonElement {
  const button = el("button", className, label);
  button.type = "button";
  let armedUntil = 0;
  button.addEventListener("click", () => {
    if (confirm && Date.now() > armedUntil) {
      armedUntil = Date.now() + ARM_MS;
      button.dataset.armed = "true";
      button.textContent = t("confirmRun", { label });
      setTimeout(() => {
        if (Date.now() < armedUntil) return;
        button.dataset.armed = "false";
        button.textContent = label;
      }, ARM_MS + 50);
      return;
    }
    armedUntil = 0;
    button.dataset.armed = "false";
    button.textContent = label;
    button.disabled = true;
    busy(button, run()).finally(() => {
      button.disabled = false;
    });
  });
  return button;
}

// ---------------------------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------------------------

export interface FeedView {
  element: HTMLElement;
  update(store: Store, now: number): void;
}

/**
 * A feed: newest first, filtered by level and text, and held still while somebody reads it. Held,
 * it keeps collecting and says how many entries are waiting, the way a paused chart does.
 */
export function buildFeed(schema: FeedSchema, t: Translate): FeedView {
  const wrap = el("div", "apb-feed");
  const tools = el("div", "apb-feed-tools");
  const filter = el("input", "apb-input apb-feed-filter");
  filter.type = "search";
  filter.placeholder = t("feedFilter", { label: schema.title });
  filter.setAttribute("aria-label", t("feedFilter", { label: schema.title }));
  const levels = el("select", "apb-select apb-feed-levels");
  levels.setAttribute("aria-label", `${schema.title}: ${t("feedLevels")}`);
  for (const [value, key] of [["", "feedAllLevels"], ["warn", "feedWarnUp"], ["bad", "feedBadOnly"]] as const) {
    const option = el("option", null, t(key));
    option.value = value;
    levels.append(option);
  }
  const pause = el("button", "apb-tool", t("pause"));
  pause.type = "button";
  pause.setAttribute("aria-pressed", "false");
  tools.append(filter, levels, pause);
  const held = el("p", "apb-hint");
  held.setAttribute("aria-live", "polite");
  held.hidden = true;
  const dropped = el("p", "apb-note");
  dropped.hidden = true;
  const list = el("ol", "apb-feed-list");
  list.setAttribute("aria-label", schema.title);
  wrap.append(tools, held, dropped, list);
  let shownKey = "";
  let frozen: FeedEntry[] | undefined;
  let last: { store: Store; now: number } | undefined;

  const matches = (entry: FeedEntry): boolean => {
    const level = levels.value;
    if (level === "bad" && entry.level !== "bad") return false;
    if (level === "warn" && entry.level === "info") return false;
    const needle = filter.value.trim().toLowerCase();
    return needle === "" || entry.text.toLowerCase().includes(needle);
  };
  const redraw = (): void => {
    shownKey = "";
    if (last !== undefined) view.update(last.store, last.now);
  };
  filter.addEventListener("input", redraw);
  levels.addEventListener("change", redraw);
  pause.addEventListener("click", () => {
    frozen = frozen === undefined ? [...(last?.store.feeds.get(schema.id)?.entries ?? [])] : undefined;
    pause.textContent = frozen === undefined ? t("pause") : t("resume");
    pause.setAttribute("aria-pressed", String(frozen !== undefined));
    redraw();
  });

  const view: FeedView = {
    element: wrap,
    update(store, now) {
      last = { store, now };
      const feed = store.feeds.get(schema.id);
      const live = feed?.entries ?? [];
      const entries = frozen ?? live;
      dropped.hidden = (feed?.dropped ?? 0) === 0;
      if (!dropped.hidden) dropped.textContent = t("feedDropped", { count: feed?.dropped ?? 0, rate: schema.perSecond });
      const newestFrozen = frozen === undefined || frozen.length === 0 ? 0 : (frozen[frozen.length - 1] as FeedEntry).seq;
      const waiting = frozen === undefined ? 0 : live.filter((entry) => entry.seq > newestFrozen).length;
      held.hidden = frozen === undefined;
      if (frozen !== undefined) held.textContent = t("feedHeld", { count: waiting });
      const newest = entries.length === 0 ? 0 : (entries[entries.length - 1] as FeedEntry).seq;
      const key = `${newest}|${levels.value}|${filter.value}`;
      if (key === shownKey && list.childElementCount > 0) {
        // Only the relative times move; the rows stay, and so does any text somebody selected.
        list.querySelectorAll<HTMLElement>("[data-at]").forEach((node) => {
          node.textContent = formatAgo(Number(node.dataset.at), now, t.locale);
        });
        return;
      }
      shownKey = key;
      clear(list);
      if (entries.length === 0) {
        list.append(el("li", "apb-empty", t("feedEmpty")));
        return;
      }
      const shown = entries.filter(matches);
      if (shown.length === 0) {
        list.append(el("li", "apb-empty", t("feedNoMatch")));
        return;
      }
      for (const entry of [...shown].reverse()) {
        const item = el("li", "apb-feed-entry");
        item.dataset.level = entry.level;
        const time = el("time", "apb-feed-time", formatAgo(entry.at, now, t.locale));
        time.dateTime = new Date(entry.at).toISOString();
        time.dataset.at = String(entry.at);
        const level = entry.level === "info" ? undefined : el("span", "apb-status-word", t(entry.level === "bad" ? "statusBad" : "statusWarn"));
        item.append(time, ...(level === undefined ? [] : [level]), el("span", "apb-feed-text", entry.text));
        list.append(item);
      }
    },
  };
  return view;
}

// ---------------------------------------------------------------------------------------------
// Action input
// ---------------------------------------------------------------------------------------------

/** The fields an action asks for, and a way to read them. Checks what it can; the server checks everything. */
export function buildInputs(schema: ActionSchema, t: Translate): { element: HTMLElement; read(): Record<string, JsonValue> } | undefined {
  if (schema.input === undefined || schema.input.length === 0) return undefined;
  const wrap = el("div", "apb-inputs");
  const readers: Array<() => [string, JsonValue | undefined]> = [];
  for (const field of schema.input) {
    const id = uid("input");
    const label = el("label", "apb-input-label", field.optional ? t("optionalField", { label: field.label }) : field.label);
    label.htmlFor = id;
    const control = fieldControl(field, id, t);
    wrap.append(label, control.node);
    if (field.description !== undefined) wrap.append(el("p", "apb-hint", field.description));
    readers.push(() => [field.name, control.read()]);
  }
  return {
    element: wrap,
    read() {
      const out: Record<string, JsonValue> = {};
      for (const reader of readers) {
        const [name, value] = reader();
        if (value !== undefined) out[name] = value;
      }
      return out;
    },
  };
}

function fieldControl(field: InputSchema, id: string, t: Translate): { node: HTMLElement; read(): JsonValue | undefined } {
  const c = field.constraints;
  if (field.kind === "boolean") {
    const box = el("input", "apb-checkbox");
    box.type = "checkbox";
    box.id = id;
    box.checked = field.default === true;
    return { node: box, read: () => box.checked };
  }
  if (field.kind === "enum") {
    const select = el("select", "apb-select");
    select.id = id;
    if (field.optional) select.append(el("option", null, ""));
    (c.options ?? []).forEach((option, index) => {
      const node = el("option", null, formatValue(option, localeSpec(t)));
      node.value = String(index);
      if (JSON.stringify(option) === JSON.stringify(field.default)) node.selected = true;
      select.append(node);
    });
    return { node: select, read: () => (select.value === "" ? undefined : ((c.options ?? [])[Number(select.value)] ?? undefined)) };
  }
  const multiline = field.kind === "json" || c.multiline === true;
  const input = multiline ? el("textarea", "apb-textarea") : el("input", "apb-input");
  input.id = id;
  if (input instanceof HTMLInputElement) {
    input.type = field.kind === "number" ? "number" : "text";
    if (field.kind === "number") {
      if (c.min !== undefined) input.min = String(c.min);
      if (c.max !== undefined) input.max = String(c.max);
      input.step = c.step !== undefined ? String(c.step) : c.integer === true ? "1" : "any";
    }
  }
  if (c.maxLength !== undefined) input.maxLength = c.maxLength;
  if (field.default !== undefined) input.value = typeof field.default === "string" ? field.default : JSON.stringify(field.default);
  input.required = !field.optional;
  return {
    node: input,
    read: () => {
      const text = input.value.trim();
      if (text === "") return undefined;
      if (field.kind === "number") return Number(text);
      if (field.kind === "json") {
        try {
          return JSON.parse(text) as JsonValue;
        } catch {
          return text;
        }
      }
      return input.value;
    },
  };
}

