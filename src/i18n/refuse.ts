/**
 * A refusal, in one place: the key the page translates, what fills it, and the English sentence the
 * API has always sent, made from the same template so the two can never say different things.
 */
import type { Refusal } from "../errors.js";
import { ENGLISH, format, type MessageKey } from "./messages.js";

export type RefusalKey = Extract<MessageKey, `refuse${string}`>;

export function refusal(key: RefusalKey, params: Record<string, string | number> = {}): { message: string; refusal: Refusal } {
  return { message: format(ENGLISH[key], params), refusal: { key, params } };
}

/** What kind of failure a status is, for a caller that branches on it rather than on the sentence. */
export const REFUSAL_CODE: Readonly<Record<number, string>> = Object.freeze({
  400: "invalid",
  401: "unauthenticated",
  403: "not-allowed",
  404: "not-found",
  405: "method",
  409: "conflict",
  413: "too-large",
  415: "media-type",
  421: "wrong-host",
  429: "rate-limited",
  500: "internal",
  502: "failed",
  503: "busy",
});

/** A refusal as every route answers it: the English sentence, the kind, and the key a page says it in its own language with. */
export function refusalBody(status: number, key: RefusalKey, params: Record<string, string | number> = {}): { error: string; code: string; key: string; params: Record<string, string | number> } {
  return { error: refusal(key, params).message, code: REFUSAL_CODE[status] ?? "failed", key, params };
}
