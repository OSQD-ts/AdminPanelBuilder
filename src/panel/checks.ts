/** Small checks and helpers the panel's modules share. */
import { AdminPanelConfigError } from "../errors.js";
import type { CardSize, Span } from "../types.js";
import type { ValueSource } from "../values/handle.js";
import { toJson } from "../values/kinds.js";
import { checkSize } from "./layout.js";

/** A card's size in cells, as code declares it. See src/panel/layout.ts. */
export function checkCardSize(label: string, size: CardSize | undefined): CardSize | undefined {
  if (size === undefined) return undefined;
  const checked = checkSize(size);
  if (typeof checked === "string") throw new AdminPanelConfigError(`"${label}" has size ${JSON.stringify(size)}: ${checked}`);
  return checked;
}

export function checkSpan(label: string, span: Span | undefined): Span | undefined {
  if (span === undefined || span === 1 || span === 2 || span === 3 || span === "full") return span;
  throw new AdminPanelConfigError(`"${label}" spans ${JSON.stringify(span)}; a span is 1, 2, 3 or "full"`);
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(toJson(a)) === JSON.stringify(toJson(b));
}

/** A declaration's name for an error message: its label or id, or that it has neither. */
export function describe(options: { label?: string | undefined; id?: string | undefined }): string {
  return options.label !== undefined ? JSON.stringify(options.label) : options.id !== undefined ? JSON.stringify(options.id) : "";
}

export function checkTitle(text: string): string {
  if (typeof text !== "string" || text.trim() === "") throw new AdminPanelConfigError(`a label or title must be non-empty text (got ${JSON.stringify(text)})`);
  if (text.length > 200) throw new AdminPanelConfigError(`"${text.slice(0, 40)}…" is ${text.length} characters long; a label or title is at most 200`);
  return text;
}

export function checkGroupName(name: string): string {
  if (typeof name !== "string" || name.trim() === "") throw new AdminPanelConfigError(`a group name must be non-empty text (got ${JSON.stringify(name)})`);
  if (name.length > 100) throw new AdminPanelConfigError(`the group name "${name.slice(0, 40)}…" is longer than 100 characters`);
  return name;
}

export function checkScheme(scheme: string): "auto" | "light" | "dark" {
  if (scheme !== "auto" && scheme !== "light" && scheme !== "dark") throw new AdminPanelConfigError(`colorScheme is "auto", "light" or "dark" (got ${JSON.stringify(scheme)})`);
  return scheme;
}

/**
 * A page asking more often than four times a second learns nothing a person can see, and costs
 * the application a request per viewer each time.
 */
export const MIN_POLL_INTERVAL_MS = 250;

export function checkPoll(ms: number): number {
  if (!Number.isFinite(ms) || ms < MIN_POLL_INTERVAL_MS) throw new AdminPanelConfigError(`pollIntervalMs is ${ms}; the shortest interval is ${MIN_POLL_INTERVAL_MS}ms, because a page asking more often learns nothing a person can see`);
  return ms;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function defaultOnError(error: unknown, source: string): void {
  console.error(`admin-panel: ${source} failed:`, error);
}

export function readSafely<T>(source: ValueSource<T>): unknown {
  try {
    if (source.kind === "cell") return source.current;
    if (source.kind === "getter") return source.read();
    return (source.target as Record<PropertyKey, unknown>)[source.key];
  } catch {
    return undefined;
  }
}

/** Labels and ids that usually hold something that should not reach a browser. */
const SECRET_LIKE = /(pass(word|phrase)?|secret|token|api[-_ ]?key|private[-_ ]?key|credential|dsn|connection[-_ ]?string)/i;

export function looksSecret(id: string, label: string): boolean {
  return SECRET_LIKE.test(id) || SECRET_LIKE.test(label);
}
