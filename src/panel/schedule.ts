/**
 * Changes that happen later: a timed change reverting itself, and a change scheduled for a time.
 *
 * One timer per entry, unref'd, so a schedule never keeps a process alive. Entries for persisted
 * values are stored, so a restart does not strand one; an entry whose time passed while the process
 * was down fires as soon as its value is declared, and says it was late.
 *
 * Bounds: `MAX_SCHEDULED` entries in all, and nothing further ahead than `MAX_SCHEDULE_AHEAD_MS`.
 * A timer longer than a timer can hold (about 24.8 days) is re-armed when it wakes early.
 */
import type { JsonValue } from "../types.js";
import type { PanelValue } from "../values/handle.js";
import { toJson } from "../values/kinds.js";

/** Scheduled changes held at once. Each is one value an operator chose; a thousand is several screens of them. */
export const MAX_SCHEDULED = 1000;
/** A change scheduled further ahead than thirty days is a plan, and belongs somewhere reviewed. */
export const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 3_600_000;
/** Store key of the schedule. Ids starting "apb." are refused for values, so it cannot collide. */
export const SCHEDULE_KEY = "apb.schedule";
const LONGEST_TIMER = 2_147_000_000;

export interface ScheduleEntry {
  id: string;
  kind: "revert" | "scheduled";
  valueId: string;
  to: unknown;
  at: number;
  by: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface ScheduleHost {
  now(): number;
  value(id: string): PanelValue<unknown> | undefined;
  /** Applies an entry whose time has come. `late` when its time passed while nothing was running. */
  fire(entry: ScheduleEntry, late: boolean): void;
  save(stored: JsonValue): void;
}

export class ChangeSchedule {
  private readonly entries = new Map<string, ScheduleEntry>();
  private sequence = 0;
  private closed = false;

  constructor(private readonly host: ScheduleHost) {}

  get size(): number {
    return this.entries.size;
  }

  /** Adds an entry and arms its timer. A value holds one revert at a time; a new one replaces the old. */
  add(kind: ScheduleEntry["kind"], value: PanelValue<unknown>, to: unknown, at: number, by: string, id?: string): ScheduleEntry {
    if (kind === "revert") this.cancelRevert(value.id, false);
    const entry: ScheduleEntry = { id: id ?? `${kind === "revert" ? "r" : "s"}${Date.now().toString(36)}${(++this.sequence).toString(36)}`, kind, valueId: value.id, to, at, by, timer: undefined };
    this.entries.set(entry.id, entry);
    this.arm(entry);
    this.persist();
    return entry;
  }

  cancel(id: string): ScheduleEntry | undefined {
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    this.entries.delete(id);
    this.persist();
    return entry;
  }

  /** A later change cancels a pending revert of the same value; a scheduled change stands. */
  cancelRevert(valueId: string, save = true): void {
    for (const entry of this.entries.values()) {
      if (entry.kind !== "revert" || entry.valueId !== valueId) continue;
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      this.entries.delete(entry.id);
      if (save) this.persist();
    }
  }

  revertFor(valueId: string): ScheduleEntry | undefined {
    for (const entry of this.entries.values()) if (entry.kind === "revert" && entry.valueId === valueId) return entry;
    return undefined;
  }

  scheduledFor(valueId: string): ScheduleEntry[] {
    return [...this.entries.values()].filter((entry) => entry.kind === "scheduled" && entry.valueId === valueId).sort((a, b) => a.at - b.at);
  }

  get(id: string): ScheduleEntry | undefined {
    return this.entries.get(id);
  }

  /** Fires an entry now; its timer calls this, and so can a test. */
  fire(id: string, late = false): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.entries.delete(id);
    this.persist();
    this.host.fire(entry, late);
  }

  /** Stored entries of one value, re-armed as it is declared; any whose time passed fire now. */
  restore(stored: JsonValue | undefined, value: PanelValue<unknown>): void {
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return;
    for (const [id, raw] of Object.entries(stored as Record<string, JsonValue>)) {
      const saved = raw as { kind?: unknown; valueId?: unknown; to?: JsonValue; at?: unknown; by?: unknown } | null;
      if (saved === null || typeof saved !== "object" || saved.valueId !== value.id || this.entries.has(id)) continue;
      if ((saved.kind !== "revert" && saved.kind !== "scheduled") || typeof saved.at !== "number" || typeof saved.by !== "string") continue;
      const entry: ScheduleEntry = { id, kind: saved.kind, valueId: value.id, to: saved.to ?? null, at: saved.at, by: saved.by, timer: undefined };
      this.entries.set(id, entry);
      if (entry.at <= this.host.now()) this.fire(id, true);
      else this.arm(entry);
    }
  }

  close(): void {
    this.closed = true;
    for (const entry of this.entries.values()) if (entry.timer !== undefined) clearTimeout(entry.timer);
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

  /** Only entries of persisted values are stored: the others would restore into a default the process chose afresh. */
  private persist(): void {
    const stored: Record<string, JsonValue> = {};
    for (const entry of this.entries.values()) {
      if (this.host.value(entry.valueId)?.definition.persist !== true) continue;
      stored[entry.id] = { kind: entry.kind, valueId: entry.valueId, to: toJson(entry.to), at: entry.at, by: entry.by };
    }
    this.host.save(stored);
  }
}
