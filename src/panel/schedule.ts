/**
 * Changes that happen later: a timed change reverting itself, a change scheduled for a time, and a
 * change that repeats by a rule — for one value or for a whole profile.
 *
 * One timer per entry, unref'd, so a schedule never keeps a process alive. Entries are stored when
 * their target outlives a restart (a persisted value, or a profile, whose values a restart puts
 * back), so a restart does not strand one; an entry whose time passed while the process was down
 * fires as soon as its target is declared, and says it was late. A repeating entry fires and is
 * armed again for its next run; a run missed while the process was down fires once on start, not
 * once per missed night.
 *
 * With replicas, entries are shared: each replica holds every entry, and `claim` lets exactly one
 * of them fire it (see core.ts).
 *
 * Bounds: `MAX_SCHEDULED` entries in all, and nothing further ahead than `MAX_SCHEDULE_AHEAD_MS`.
 * A timer longer than a timer can hold (about 24.8 days) is re-armed when it wakes early.
 */
import type { JsonValue } from "../types.js";
import { toJson } from "../values/kinds.js";
import { nextRun, type RepeatRule } from "./recurrence.js";

/** Scheduled changes held at once. Each is one value an operator chose; a thousand is several screens of them. */
export const MAX_SCHEDULED = 1000;
/** A change scheduled further ahead than thirty days is a plan, and belongs somewhere reviewed. */
export const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 3_600_000;
/** Store key of the schedule. Ids starting "apb." are refused for values, so it cannot collide. */
export const SCHEDULE_KEY = "apb.schedule";
const LONGEST_TIMER = 2_147_000_000;

export type ScheduleTarget = "value" | "profile";

export interface ScheduleEntry {
  id: string;
  kind: "revert" | "scheduled";
  target: ScheduleTarget;
  targetId: string;
  /** For a value, what it becomes; for a profile's revert, the values it puts back, by id. */
  to: unknown;
  at: number;
  by: string;
  reason?: string | undefined;
  /** Repeats after it fires. */
  repeat?: RepeatRule | undefined;
  /** Each run is a timed change of this length. */
  revertAfterMs?: number | undefined;
  /** The replica that made it: without a claim between replicas, only it fires the entry. */
  origin?: string | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** What `add` takes: an entry without its timer, its id optional. */
export type NewEntry = Omit<ScheduleEntry, "id" | "timer"> & { id?: string | undefined };

export interface ScheduleHost {
  now(): number;
  /** Whether the entry's target survives a restart, so the entry is worth storing. */
  durable(entry: ScheduleEntry): boolean;
  /** Applies an entry whose time has come. `late` when its time passed while nothing was running. */
  fire(entry: ScheduleEntry, late: boolean): void;
  save(stored: JsonValue): void;
  /** An entry was added or removed here: replicas are told. */
  changed?(entry: ScheduleEntry, removed: boolean): void;
  /** This replica, recorded on the entries it makes. */
  origin?: string | undefined;
}

export class ChangeSchedule {
  private readonly entries = new Map<string, ScheduleEntry>();
  private sequence = 0;
  private closed = false;

  constructor(private readonly host: ScheduleHost) {}

  get size(): number {
    return this.entries.size;
  }

  /** Adds an entry and arms its timer. A target holds one revert at a time; a new one replaces the old. */
  add(fresh: NewEntry, announce = true): ScheduleEntry {
    if (fresh.kind === "revert") this.cancelRevert(fresh.target, fresh.targetId, false);
    // Unique across replicas too: the time, a counter, and a random tail.
    const id = fresh.id ?? `${fresh.kind === "revert" ? "r" : fresh.repeat === undefined ? "s" : "e"}${Date.now().toString(36)}${(++this.sequence).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const entry: ScheduleEntry = { ...fresh, id, timer: undefined };
    if (entry.origin === undefined && this.host.origin !== undefined) entry.origin = this.host.origin;
    const existing = this.entries.get(entry.id);
    if (existing?.timer !== undefined) clearTimeout(existing.timer);
    this.entries.set(entry.id, entry);
    this.arm(entry);
    this.persist();
    if (announce) this.host.changed?.(entry, false);
    return entry;
  }

  cancel(id: string, announce = true): ScheduleEntry | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    this.entries.delete(id);
    this.persist();
    if (announce) this.host.changed?.(entry, true);
    return entry;
  }

  /** A later change cancels a pending revert of the same target; a scheduled change stands. */
  cancelRevert(target: ScheduleTarget, targetId: string, save = true, announce = true): void {
    for (const entry of this.entries.values()) {
      if (entry.kind !== "revert" || entry.target !== target || entry.targetId !== targetId) continue;
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      this.entries.delete(entry.id);
      if (save) this.persist();
      if (save && announce) this.host.changed?.(entry, true);
    }
  }

  revertFor(target: ScheduleTarget, targetId: string): ScheduleEntry | undefined {
    for (const entry of this.entries.values()) if (entry.kind === "revert" && entry.target === target && entry.targetId === targetId) return entry;
    return undefined;
  }

  scheduledFor(target: ScheduleTarget, targetId: string): ScheduleEntry[] {
    return [...this.entries.values()].filter((entry) => entry.kind === "scheduled" && entry.target === target && entry.targetId === targetId).sort((a, b) => a.at - b.at);
  }

  get(id: string): ScheduleEntry | undefined {
    return this.entries.get(id);
  }

  all(): ScheduleEntry[] {
    return [...this.entries.values()];
  }

  /** Fires an entry now; its timer calls this, and so can a test. A repeating entry is armed for its next run. */
  fire(id: string, late = false): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.entries.delete(id);
    if (entry.repeat !== undefined) {
      const next = nextRun(entry.repeat, Math.max(entry.at, this.host.now()));
      this.entries.set(id, { ...entry, at: next, timer: undefined });
      this.arm(this.entries.get(id) as ScheduleEntry);
    }
    this.persist();
    this.host.fire(entry, late);
  }

  /** Stored entries of one target, re-armed as it is declared; any whose time passed fire now. */
  restore(stored: JsonValue | undefined, target: ScheduleTarget, targetId: string): void {
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return;
    for (const [id, raw] of Object.entries(stored as Record<string, JsonValue>)) {
      const saved = raw as Record<string, JsonValue> | null;
      if (saved === null || typeof saved !== "object" || this.entries.has(id)) continue;
      // Entries written before profiles could be scheduled name their value as `valueId`.
      const savedTarget = saved.target ?? "value";
      const savedId = saved.targetId ?? saved.valueId;
      if (savedTarget !== target || savedId !== targetId) continue;
      if ((saved.kind !== "revert" && saved.kind !== "scheduled") || typeof saved.at !== "number" || typeof saved.by !== "string") continue;
      const entry: ScheduleEntry = { id, kind: saved.kind, target, targetId, to: saved.to ?? null, at: saved.at, by: saved.by, timer: undefined };
      if (typeof saved.reason === "string") entry.reason = saved.reason;
      if (typeof saved.revertAfterMs === "number") entry.revertAfterMs = saved.revertAfterMs;
      if (typeof saved.origin === "string") entry.origin = saved.origin;
      if (saved.repeat !== null && typeof saved.repeat === "object" && !Array.isArray(saved.repeat)) entry.repeat = saved.repeat as unknown as RepeatRule;
      this.entries.set(id, entry);
      if (entry.at <= this.host.now()) this.fire(id, true);
      else this.arm(entry);
    }
  }

  close(): void {
    this.closed = true;
    for (const entry of this.entries.values()) if (entry.timer !== undefined) clearTimeout(entry.timer);
  }

  /** An entry as it is stored and as it travels between replicas. */
  static toJson(entry: ScheduleEntry): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = { kind: entry.kind, target: entry.target, targetId: entry.targetId, to: toJson(entry.to), at: entry.at, by: entry.by };
    if (entry.reason !== undefined) out.reason = entry.reason;
    if (entry.repeat !== undefined) out.repeat = entry.repeat as unknown as JsonValue;
    if (entry.revertAfterMs !== undefined) out.revertAfterMs = entry.revertAfterMs;
    if (entry.origin !== undefined) out.origin = entry.origin;
    return out;
  }

  /** An entry as `toJson` wrote it, or undefined when it cannot be read. */
  static fromJson(id: string, saved: Record<string, JsonValue>): NewEntry | undefined {
    if ((saved.kind !== "revert" && saved.kind !== "scheduled") || (saved.target !== "value" && saved.target !== "profile") || typeof saved.targetId !== "string" || typeof saved.at !== "number" || typeof saved.by !== "string") return undefined;
    const entry: NewEntry = { id, kind: saved.kind, target: saved.target, targetId: saved.targetId, to: saved.to ?? null, at: saved.at, by: saved.by };
    if (typeof saved.reason === "string") entry.reason = saved.reason;
    if (typeof saved.revertAfterMs === "number") entry.revertAfterMs = saved.revertAfterMs;
    if (typeof saved.origin === "string") entry.origin = saved.origin;
    if (saved.repeat !== null && typeof saved.repeat === "object" && !Array.isArray(saved.repeat)) entry.repeat = saved.repeat as unknown as RepeatRule;
    return entry;
  }

  private arm(entry: ScheduleEntry): void {
    if (this.closed) return;
    const delay = Math.max(0, entry.at - this.host.now());
    entry.timer = setTimeout(() => {
      if (this.host.now() + 5 < entry.at) this.arm(entry);
      else this.fire(entry.id);
    }, Math.min(delay, LONGEST_TIMER));
    (entry.timer as { unref?: () => void }).unref?.();
  }

  /** Only entries whose target outlives a restart are stored: the others would restore into a default the process chose afresh. */
  private persist(): void {
    const stored: Record<string, JsonValue> = {};
    for (const entry of this.entries.values()) if (this.host.durable(entry)) stored[entry.id] = ChangeSchedule.toJson(entry);
    this.host.save(stored);
  }
}
