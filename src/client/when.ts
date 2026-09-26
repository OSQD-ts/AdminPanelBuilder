/**
 * The two questions a change can answer besides "to what": when, and why.
 *
 * When: a folded "Later" holding one local date and time and a repeat choice — once, every day at
 * that time, every week on that day at that time — in the viewer's own time zone, which the rule
 * carries so the server runs it on the operator's wall clock, not UTC's.
 *
 * Why: a reason, a visible labelled field where the panel requires one, folded away where it is
 * optional. Values, profiles and actions share both, so they read the same everywhere.
 */
import type { JsonValue, RepeatRuleShape, ScheduledChange } from "../types.js";
import { el, uid } from "./dom.js";
import { formatDuration, formatValue, type FormatSpec } from "./format.js";
import type { Translate } from "./i18n.js";

export interface When {
  at?: number | undefined;
  repeat?: RepeatRuleShape | undefined;
}

export interface WhenField {
  readonly element: HTMLElement;
  /** Nothing chosen is now. Throws a sentence when the date cannot be read. */
  read(): When;
  clear(): void;
}

export function whenField(label: string, t: Translate): WhenField {
  const details = el("details", "apb-when");
  details.append(el("summary", null, t("schedule")));
  const id = uid("at");
  const atLabel = el("label", "apb-input-label", t("scheduleAt"));
  atLabel.htmlFor = id;
  const input = el("input", "apb-input apb-at");
  input.type = "datetime-local";
  input.id = id;
  input.setAttribute("aria-label", `${label}: ${t("scheduleAt")}`);
  const repeatId = uid("repeat");
  const repeatLabel = el("label", "apb-input-label", t("repeat"));
  repeatLabel.htmlFor = repeatId;
  const repeat = el("select", "apb-select apb-repeat");
  repeat.id = repeatId;
  for (const [value, key] of [["", "repeatOnce"], ["day", "repeatDaily"], ["week", "repeatWeekly"]] as const) {
    const option = el("option", null, t(key));
    option.value = value;
    repeat.append(option);
  }
  details.append(atLabel, input, repeatLabel, repeat, el("p", "apb-hint", t("scheduleHint")));
  return {
    element: details,
    read: () => {
      if (input.value === "") return {};
      const at = new Date(input.value);
      if (!Number.isFinite(at.getTime())) throw new Error(t("enterDateTime"));
      if (repeat.value === "") return { at: at.getTime() };
      const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return { repeat: repeat.value === "week" ? { every: "week", at: time, weekday: at.getDay(), timeZone } : { every: "day", at: time, timeZone } };
    },
    clear: () => {
      input.value = "";
      repeat.value = "";
      details.open = false;
    },
  };
}

export interface ReasonField {
  readonly element: HTMLElement;
  read(): string | undefined;
  clear(): void;
}

/** A required reason is a visible field; an optional one is folded away under "Why (optional)". */
export function reasonField(label: string, required: boolean, t: Translate): ReasonField {
  const id = uid("reason");
  const input = el("input", "apb-input apb-reason");
  input.type = "text";
  input.id = id;
  input.maxLength = 500;
  input.autocomplete = "off";
  const field = el("label", "apb-input-label", required ? t("reason") : t("reasonOptional"));
  field.htmlFor = id;
  let element: HTMLElement;
  if (required) {
    input.required = true;
    input.setAttribute("aria-label", `${label}: ${t("reason")}`);
    element = el("div", "apb-reason-field");
    element.append(field, input);
  } else {
    input.setAttribute("aria-label", `${label}: ${t("reasonOptional")}`);
    const details = el("details", "apb-why");
    details.append(el("summary", null, t("reasonOptional")), input);
    element = details;
  }
  return {
    element,
    read: () => (input.value.trim() === "" ? undefined : input.value.trim()),
    clear: () => {
      input.value = "";
      if (element instanceof HTMLDetailsElement) element.open = false;
    },
  };
}

/** "every day at 02:00 (Europe/Warsaw)", with the weekday in the page's language. */
export function describeRule(rule: RepeatRuleShape, t: Translate): string {
  if (rule.every === "day") return t("ruleDaily", { time: rule.at, zone: rule.timeZone });
  // 2023-01-01 was a Sunday: add the weekday to it for that day's name.
  const day = new Date(Date.UTC(2023, 0, 1 + (rule.weekday ?? 0))).toLocaleDateString(t.locale, { weekday: "long", timeZone: "UTC" });
  return t("ruleWeekly", { day, time: rule.at, zone: rule.timeZone });
}

/** One scheduled change of a value, or of a profile when `spec` is undefined, as a sentence. */
export function scheduledSentence(entry: ScheduledChange, spec: FormatSpec | undefined, now: number, t: Translate): string {
  const time = new Date(entry.at).toLocaleString(t.locale);
  const until = formatDuration(Math.max(0, entry.at - now), t.locale);
  const length = entry.revertAfterMs === undefined ? "" : ` (${t("forLength", { length: formatDuration(entry.revertAfterMs, t.locale) })})`;
  const reason = entry.reason === undefined ? "" : ` ${t("reasonShown", { reason: entry.reason })}`;
  if (spec === undefined) {
    const said = entry.repeat === undefined ? t("profileScheduled", { time, in: until, by: entry.by }) : t("profileScheduledRepeat", { rule: describeRule(entry.repeat, t), time, by: entry.by });
    return `${said}${length}${reason}`;
  }
  const value = entry.to === undefined ? "…" : formatValue(entry.to as JsonValue, spec);
  const said = entry.repeat === undefined ? t("scheduledFor", { value, time, in: until, by: entry.by }) : t("scheduledRepeat", { value, rule: describeRule(entry.repeat, t), time, in: until, by: entry.by });
  return `${said}${length}${reason}`;
}
