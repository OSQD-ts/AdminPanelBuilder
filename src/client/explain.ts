/**
 * What the panel said, in the page's language. Apart from `i18n.ts` so the extras bundle, which
 * reports failures too, does not carry every language's table: it asks the translator it is handed.
 *
 * A refusal the server keyed is translated whole; one it did not is said in the page's language
 * by kind, with the server's English sentence after it, so nothing the server said is lost. The
 * panel's own notices and the frame around a reading that failed travel the same way: a key and
 * what fills it, beside the English sentence to fall back on.
 */
import type { MessageKey } from "../i18n/messages.js";
import type { Translate } from "./i18n.js";

export function explain(problem: unknown, t: Translate): string {
  const message = problem instanceof Error ? problem.message : String(problem);
  if (problem === null || typeof problem !== "object") return message;
  const { key, params, code } = problem as { key?: unknown; params?: Record<string, string | number>; code?: unknown };
  if (typeof key === "string" && t.has(key)) return sentence(t(key as MessageKey, params));
  if ((t.locale ?? "en") === "en" || typeof code !== "string") return message;
  const kind = `code_${code}`;
  return t.has(kind) ? `${t(kind as MessageKey)} (${message})` : `${t("refused")}: ${message}`;
}

function sentence(text: string): string {
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * A sentence the panel sent with a key: said in the page's language where this page has that key,
 * and as the panel sent it where it does not — a page older than the panel it is talking to, or a
 * notice whose words are not the panel's own.
 */
export function said(t: Translate, key: string | undefined, params: Record<string, string | number> | undefined, english: string): string {
  return key !== undefined && t.has(key) ? t(key as MessageKey, params) : english;
}
