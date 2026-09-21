/**
 * A failure in the page's language. Apart from `i18n.ts` so the extras bundle, which reports
 * failures too, does not carry every language's table: it asks the translator it is handed.
 *
 * A refusal the server keyed is translated whole; one it did not is said in the page's language
 * by kind, with the server's English sentence after it, so nothing the server said is lost.
 */
import type { MessageKey } from "../i18n/messages.js";
import type { Translate } from "./i18n.js";

export function explain(problem: unknown, t: Translate): string {
  const message = problem instanceof Error ? problem.message : String(problem);
  if (problem === null || typeof problem !== "object") return message;
  const { key, params, code } = problem as { key?: unknown; params?: Record<string, string | number>; code?: unknown };
  const has = t.has ?? (() => false);
  if (typeof key === "string" && has(key)) return sentence(t(key as MessageKey, params));
  if ((t.locale ?? "en") === "en" || typeof code !== "string") return message;
  const kind = `code_${code}`;
  return has(kind) ? `${t(kind as MessageKey)} (${message})` : `${t("refused")}: ${message}`;
}

function sentence(text: string): string {
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
