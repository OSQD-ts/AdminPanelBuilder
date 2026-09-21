/**
 * Changes waiting for a second operator.
 *
 * A proposal holds the candidate value (never sent to a browser when the value is sensitive), who
 * proposed it and when it lapses. At most `MAX_PENDING` wait at once; past it the oldest lapses, so a
 * flood of proposals costs a bounded amount of memory and nothing else.
 */
import type { JsonValue, PendingChange } from "../types.js";
import type { PanelValue } from "../values/handle.js";
import { toJson } from "../values/kinds.js";

/** How long a proposed change waits for approval before it lapses. */
export const APPROVAL_TTL_MS = 3_600_000;
/** Proposals waiting at once. Each is one value an operator typed; past this the oldest lapses. */
export const MAX_PENDING = 100;

export interface PendingEntry extends PendingChange {
  candidate: unknown;
  revertAfterMs: number | undefined;
  /** A proposal to apply later: approving it schedules it rather than applying it. */
  applyAt: number | undefined;
}

export class Approvals {
  private readonly entries = new Map<string, PendingEntry>();
  private sequence = 0;

  constructor(private readonly now: () => number) {}

  propose(value: PanelValue<unknown>, candidate: unknown, by: string, options: { revertAfterMs?: number | undefined; applyAt?: number | undefined }): PendingEntry {
    this.expire();
    const at = this.now();
    const entry: PendingEntry = { id: `p${++this.sequence}`, target: value.id, label: value.label, by, at, expiresAt: at + APPROVAL_TTL_MS, candidate, revertAfterMs: options.revertAfterMs, applyAt: options.applyAt };
    if (!value.definition.sensitive) entry.to = toJson(candidate) as JsonValue;
    this.entries.set(entry.id, entry);
    if (this.entries.size > MAX_PENDING) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return entry;
  }

  get(id: string): PendingEntry | undefined {
    this.expire();
    return this.entries.get(id);
  }

  take(id: string): PendingEntry | undefined {
    const entry = this.get(id);
    if (entry !== undefined) this.entries.delete(id);
    return entry;
  }

  /** What a page is told: everything but the candidate itself. */
  list(): PendingChange[] {
    this.expire();
    return [...this.entries.values()].map(({ candidate: _candidate, revertAfterMs: _revert, applyAt: _at, ...change }) => change);
  }

  private expire(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
  }
}
