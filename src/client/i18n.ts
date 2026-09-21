/**
 * The page's own words for the panel it is showing: the schema's locale, with the application's
 * replacements on top. One table per mounted panel, so two panels in two languages can share a page.
 */
import { ENGLISH, format, LOCALES, type MessageKey } from "../i18n/messages.js";
import type { PanelSchema } from "../types.js";

export type Translate = ((key: MessageKey, values?: Record<string, string | number>) => string) & {
  readonly locale?: string | undefined;
  /** Whether the table has this key: a refusal the server keyed may name one this page predates. */
  readonly has?: ((key: string) => boolean) | undefined;
};

export function translator(schema: Pick<PanelSchema, "locale" | "messages">): Translate {
  const table: Record<string, string> = { ...ENGLISH, ...(LOCALES[schema.locale] ?? {}), ...(schema.messages ?? {}) };
  return Object.assign((key: MessageKey, values?: Record<string, string | number>) => format(table[key] ?? ENGLISH[key], values), { locale: schema.locale, has: (key: string) => Object.hasOwn(table, key) });
}

export { explain } from "./explain.js";
