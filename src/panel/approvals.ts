/**
 * Changes waiting for a second operator: a value's change, an action's run, or a profile's
 * application.
 *
 * A proposal holds the candidate (a value, or an action's input; never sent to a browser when the
 * value is sensitive), who proposed it, why, and when it lapses. At most `MAX_PENDING` wait at once;
 * past it the oldest lapses, so a flood of proposals costs a bounded amount of memory and nothing
 * else. With replicas, proposals are shared through the sync channel (see core.ts): `accept` takes
 * one made elsewhere, and `take` is what a decision removes on every replica.
 */
import type { JsonValue, PendingChange } from "../types.js";
import { toJson } from "../values/kinds.js";

/** How long a proposed change waits for approval before it lapses. */
export const APPROVAL_TTL_MS = 3_600_000;
/** Proposals waiting at once. Each is one thing an operator asked for; past this the oldest lapses. */
export const MAX_PENDING = 100;

export interface PendingEntry extends PendingChange {
  kind: "value" | "action" | "profile";
  candidate: unknown;
  revertAfterMs: number | undefined;
}

/** What is being proposed. */
export interface ProposalTarget {
  kind: PendingEntry["kind"];
  id: string;
  label: string;
  /** The candidate is never shown. */
  sensitive: boolean;
}

export class Approvals {
  private readonly entries = new Map<string, PendingEntry>();
  private sequence = 0;

  constructor(
    private readonly now: () => number,
    /** Makes ids unique across replicas. */
    private readonly prefix = "p",
  ) {}

  propose(target: ProposalTarget, candidate: unknown, by: string, options: { revertAfterMs?: number | undefined; applyAt?: number | undefined; reason?: string | undefined }): PendingEntry {
    this.expire();
    const at = this.now();
    const entry: PendingEntry = { id: `${this.prefix}${++this.sequence}`, kind: target.kind, target: target.id, label: target.label, by, at, expiresAt: at + APPROVAL_TTL_MS, candidate, revertAfterMs: options.revertAfterMs };
    if (!target.sensitive && candidate !== undefined) entry.to = toJson(candidate) as JsonValue;
    if (options.reason !== undefined) entry.reason = options.reason;
    if (options.applyAt !== undefined) entry.applyAt = options.applyAt;
    this.accept(entry);
    return entry;
  }

  /** A proposal made on another replica. */
  accept(entry: PendingEntry): void {
    this.entries.set(entry.id, entry);
    if (this.entries.size > MAX_PENDING) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
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

  /** What a page is told: everything but the candidate itself, and `kind` only when it is not a value's. */
  list(): PendingChange[] {
    this.expire();
    return [...this.entries.values()].map(({ candidate: _candidate, revertAfterMs: _revert, kind, ...change }) => (kind === "value" ? change : { ...change, kind }));
  }

  private expire(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
  }
}
