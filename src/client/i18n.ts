/**
 * The page's own words for the panel it is showing: the schema's locale, with the application's
 * replacements on top. One table per mounted panel, so two panels in two languages can share a page.
 */
// English only: another language arrives with the schema (`translations`) or from the handler, so a
// page carries one language's words, not every language the package ships.
import { ENGLISH, format, type MessageKey } from "../i18n/messages.js";

/**
 * The page's words. `locale` and `has` are part of it, not extras: a translator that forwards the
 * call and drops `has` compiles, says every word correctly, and silently stops translating anything
 * the server keyed — a refusal, a notice, the frame around a reading that failed.
 */
export type Translate = ((key: MessageKey, values?: Record<string, string | number>) => string) & {
  readonly locale: string | undefined;
  /** Whether the table has this key: a refusal the server keyed may name one this page predates. */
  readonly has: (key: string) => boolean;
};

export function translator(schema: { locale: string; messages?: Record<string, string> | undefined; translations?: Record<string, string> | undefined }): Translate {
  const table: Record<string, string> = { ...ENGLISH, ...(schema.translations ?? {}), ...(schema.messages ?? {}) };
  return Object.assign((key: MessageKey, values?: Record<string, string | number>) => format(table[key] ?? ENGLISH[key], values), { locale: schema.locale, has: (key: string) => Object.hasOwn(table, key) });
}

export { explain } from "./explain.js";

/** The part of a format spec that comes from the page's language: its separators and its On/Off. */
export function localeSpec(t: Translate): { locale: string | undefined; on: string; off: string } {
  return { locale: t.locale, on: t("on"), off: t("off") };
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
