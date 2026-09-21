/**
 * A bounded list of events, newest first: bounces, disconnects, hits.
 *
 * Two bounds, for two different floods. `capacity` is how many entries are kept; past it the oldest
 * leaves, which is retention rather than loss. `perSecond` is how many are accepted; past it an
 * entry is dropped and counted, and the page says so — "a thinned feed must never look like a
 * quiet one". Nothing queues.
 *
 * Memory: an entry is its text (capped at `MAX_ENTRY_TEXT`) and its fields (capped at 4 KB of JSON),
 * so the default 200 entries cost under a megabyte in the worst case and a few kilobytes in the
 * usual one.
 */
import type { Clock } from "../internal/clock.js";
import type { FeedEntry, JsonValue } from "../types.js";
import { toJson } from "../values/kinds.js";

export const MAX_FEED_CAPACITY = 2000;
/** Longest entry text kept. A log line longer than this is a payload, and belongs in a table. */
export const MAX_ENTRY_TEXT = 1000;
const MAX_FIELDS_JSON = 4096;

export interface FeedDefinition {
  id: string;
  label: string;
  description: string | undefined;
  capacity: number;
  perSecond: number;
  order: number;
  sequence: number;
  span: import("../types.js").Span | undefined;
}

export class PanelFeed {
  /** @internal */
  group: string;
  private readonly entries: FeedEntry[] = [];
  private windowStart = 0;
  private windowCount = 0;
  /** Entries refused by the rate cap since the panel started. Never goes backwards. */
  dropped = 0;
  /** Entries accepted since the panel started. */
  total = 0;

  /** @internal Built by the panel; declare feeds with `feed()`. */
  constructor(
    /** @internal */ readonly definition: FeedDefinition,
    group: string,
    private readonly clock: Clock,
    private readonly nextSeq: () => number,
  ) {
    this.group = group;
  }

  get id(): string {
    return this.definition.id;
  }

  /**
   * Adds an entry. A string is its text; an object is fields, shown as a line of `key=value`.
   * Returns false when the rate cap dropped it.
   */
  push(entry: string | Record<string, unknown>, level: FeedEntry["level"] = "info"): boolean {
    const now = this.clock.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    if (this.windowCount >= this.definition.perSecond) {
      this.dropped += 1;
      return false;
    }
    this.windowCount += 1;
    this.total += 1;
    const record: FeedEntry = { seq: this.nextSeq(), at: now, level: level === "warn" || level === "bad" ? level : "info", text: "" };
    if (typeof entry === "string") record.text = entry.slice(0, MAX_ENTRY_TEXT);
    else {
      const fields = toJson(entry) as Record<string, JsonValue>;
      const encoded = JSON.stringify(fields);
      if (encoded.length <= MAX_FIELDS_JSON) record.fields = fields;
      record.text = Object.entries(fields)
        .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
        .join(" ")
        .slice(0, MAX_ENTRY_TEXT);
    }
    this.entries.push(record);
    if (this.entries.length > this.definition.capacity) this.entries.shift();
    return true;
  }

  /** Entries after `seq`, oldest first. */
  after(seq: number | undefined): FeedEntry[] {
    if (seq === undefined) return this.entries.slice();
    let start = this.entries.length;
    while (start > 0 && (this.entries[start - 1] as FeedEntry).seq > seq) start -= 1;
    return this.entries.slice(start);
  }
}
