/**
 * The samples a chart draws, kept in a fixed ring.
 *
 * Memory budget, written down because a panel lives inside somebody else's process: a sample
 * over time is two float64s, 16 bytes, in preallocated typed arrays, and a sample against
 * another value carries that value's reading as a third, 24 bytes. The default 300 samples cost
 * 4.7 KB per history; `MAX_HISTORY_POINTS` costs 160 KB. A panel charting 200 values at the
 * default lands near 1 MB, and one charting 200 at the maximum near 32 MB — which is why the
 * maximum is a refusal rather than a clamp, and why nothing grows after construction.
 *
 * Samples are coalesced into time buckets. A value written ten thousand times a second would
 * otherwise fill any ring in a millisecond and show a chart of the last instant; instead a
 * write lands in the bucket of its time, the newest write in a bucket wins, and the ring spans
 * `points × bucket` of real time. A sample's time is its bucket's start, so a sample re-sent
 * after an update has the same time and the page replaces it rather than adding a second point.
 */
import type { Sample } from "../types.js";

/** Longest history a chart may keep. See the budget above. */
export const MAX_HISTORY_POINTS = 10_000;

/**
 * The shortest sampling interval, and the narrowest bucket. Four samples a second is finer than
 * a page polling once a second can show, and coarse enough that a hot counter costs a
 * comparison per write rather than a slot.
 */
export const MIN_SAMPLE_INTERVAL_MS = 250;

export class History {
  private readonly ts: Float64Array;
  private readonly ys: Float64Array;
  /** The other value's readings, for a chart over another value. */
  private readonly xs: Float64Array | undefined;
  /** Index of the next write. */
  private head = 0;
  private size = 0;

  constructor(
    readonly capacity: number,
    private readonly bucketMs: number,
    against: boolean,
  ) {
    this.ts = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
    this.xs = against ? new Float64Array(capacity) : undefined;
  }

  get length(): number {
    return this.size;
  }

  /** Records a sample at time `t`. A sample in the newest bucket replaces it. */
  record(t: number, y: number, x = 0): void {
    const at = Math.floor(t / this.bucketMs) * this.bucketMs;
    if (this.size > 0) {
      const last = (this.head - 1 + this.capacity) % this.capacity;
      // At or before the newest bucket: the newest bucket takes it. Before, because a clock that
      // stepped backwards (NTP, a suspended laptop) must not scramble the order the page draws in.
      if (at <= (this.ts[last] as number)) {
        this.ys[last] = y;
        if (this.xs !== undefined) this.xs[last] = x;
        return;
      }
    }
    this.ts[this.head] = at;
    this.ys[this.head] = y;
    if (this.xs !== undefined) this.xs[this.head] = x;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  /**
   * Samples oldest first, as `[t, y]` or `[t, y, x]`. With `after`, only those in or after the
   * bucket holding it: a page passes the time of its last answer, and the bucket that answer came
   * from may have been updated since, so it is sent again and replaced by time.
   */
  samples(after?: number): Sample[] {
    const out: Sample[] = [];
    const from = after === undefined ? undefined : Math.floor(after / this.bucketMs) * this.bucketMs;
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i += 1) {
      const index = (start + i) % this.capacity;
      const t = this.ts[index] as number;
      if (from !== undefined && t < from) continue;
      out.push(this.xs === undefined ? [t, this.ys[index] as number] : [t, this.ys[index] as number, this.xs[index] as number]);
    }
    return out;
  }

  /** Time of the newest sample, or undefined when there is none. */
  newest(): number | undefined {
    return this.size === 0 ? undefined : (this.ts[(this.head - 1 + this.capacity) % this.capacity] as number);
  }
}
