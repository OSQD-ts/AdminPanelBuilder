/**
 * The page's own words for the panel it is showing: the schema's locale, with the application's
 * replacements on top. One table per mounted panel, so two panels in two languages can share a page.
 */
// English only: another language arrives with the schema (`translations`) or from the handler, so a
// page carries one language's words, not every language the package ships.
import { ENGLISH, format, type MessageKey } from "../i18n/messages.js";
import type { TimeSpec } from "./format.js";

/**
 * The page's words. `locale` and `has` are part of it, not extras: a translator that forwards the
 * call and drops `has` compiles, says every word correctly, and silently stops translating anything
 * the server keyed — a refusal, a notice, the frame around a reading that failed.
 */
export type Translate = ((key: MessageKey, values?: Record<string, string | number>) => string) & {
  readonly locale: string | undefined;
  /** Whether the table has this key: a refusal the server keyed may name one this page predates. */
  readonly has: (key: string) => boolean;
  /** How this page writes times: the panel's settings under the viewer's own. Absent: the browser's. */
  readonly time?: TimeSpec | undefined;
};

export function translator(schema: { locale: string; messages?: Record<string, string> | undefined; translations?: Record<string, string> | undefined }, time?: TimeSpec): Translate {
  const table: Record<string, string> = { ...ENGLISH, ...(schema.translations ?? {}), ...(schema.messages ?? {}) };
  return Object.assign((key: MessageKey, values?: Record<string, string | number>) => format(table[key] ?? ENGLISH[key], values), { locale: schema.locale, has: (key: string) => Object.hasOwn(table, key), time });
}

export { explain } from "./explain.js";

/** The part of a format spec that comes from the page's language: its separators and its On/Off. */
export function localeSpec(t: Translate): { locale: string | undefined; on: string; off: string; time: TimeSpec | undefined } {
  return { locale: t.locale, on: t("on"), off: t("off"), time: t.time };
}

/**
 * The time settings in effect: the viewer's zone and format over the panel's. A viewer choosing
 * "browser" drops the panel's zone; "UTC" is UTC whatever the panel says.
 */
export function timeFor(panel: { timeZone?: string; dateFormat?: TimeSpec["dateFormat"]; dateLocale?: string } | undefined, viewer: { timeZone: "browser" | "UTC" | undefined; dateFormat: string | undefined }): TimeSpec {
  const spec: TimeSpec = {};
  const zone = viewer.timeZone === "UTC" ? "UTC" : viewer.timeZone === "browser" ? undefined : panel?.timeZone;
  if (zone !== undefined) spec.timeZone = zone;
  const shape = viewer.dateFormat ?? panel?.dateFormat;
  if (shape !== undefined) spec.dateFormat = shape as TimeSpec["dateFormat"];
  if (panel?.dateLocale !== undefined) spec.dateLocale = panel.dateLocale;
  return spec;
}

/**
 * The language a viewer sees: their own choice, else the panel's, else, when the panel says
 * "auto", the first of the browser's languages the page ships, else English.
 */
export function chooseLocale(panel: string, chosen: string | undefined, available: readonly string[], browser: readonly string[]): string {
  if (chosen !== undefined && available.includes(chosen)) return chosen;
  if (panel !== "auto") return panel;
  for (const wanted of browser) {
    const base = wanted.toLowerCase().split("-")[0] ?? "";
    if (available.includes(base)) return base;
  }
  return "en";
}
