/**
 * The hot-path cases the bench measures, and the reference loop they are measured against.
 *
 * `value.set()` runs inside the application, as often as the application writes — a counter per
 * request, a gauge per message. Everything here is that path: the panel is never on it for a read.
 */
import { createAdminPanel } from "../src/index.js";

export const ITERATIONS = 200_000;

/**
 * The yardstick: work that gets faster and slower for the same reasons the real work does — short
 * objects, a map and a set, a little string building, a regex — rather than pure arithmetic, which
 * once inflated every ratio on a machine where the real work was faster.
 */
export function reference(iterations: number): number {
  const map = new Map<string, number>();
  const seen = new Set<number>();
  const pattern = /^k\d+$/;
  let total = 0;
  for (let i = 0; i < iterations; i += 1) {
    const key = `k${i & 1023}`;
    map.set(key, (map.get(key) ?? 0) + 1);
    seen.add(i & 255);
    const object = { i, key };
    if (pattern.test(object.key)) total += object.i & 7;
  }
  return total + map.size + seen.size;
}

export interface Case {
  name: string;
  /** Prepared once; `run` is timed. */
  run(iterations: number): void;
}

export function cases(): Case[] {
  const panel = createAdminPanel();
  const plain = panel.viewable(0, "Plain");
  const charted = panel.viewable(0, { label: "Charted", chart: true });
  const shared = panel.viewable(0, { label: "Shared", chart: { in: "Load" } });
  const constrained = panel.modifiable(0, { label: "Constrained", min: 0, max: 1e12, integer: true });
  const counter = panel.counter("Counter");
  const feed = panel.feed("Feed", { perSecond: 1e9, capacity: 200 });
  const latency = panel.percentiles("Latency");
  return [
    { name: "set a plain value", run: (n) => { for (let i = 0; i < n; i += 1) plain.value = i; } },
    { name: "set a charted value", run: (n) => { for (let i = 0; i < n; i += 1) charted.value = i; } },
    { name: "set a value on a shared chart", run: (n) => { for (let i = 0; i < n; i += 1) shared.value = i; } },
    { name: "set a constrained modifiable", run: (n) => { for (let i = 0; i < n; i += 1) constrained.set(i); } },
    { name: "counter.inc()", run: (n) => { for (let i = 0; i < n; i += 1) counter.inc(); } },
    { name: "record a percentile observation", run: (n) => { for (let i = 0; i < n; i += 1) latency.record(i & 1023); } },
    { name: "push a feed entry", run: (n) => { for (let i = 0; i < n; i += 1) feed.push("entry"); } },
  ];
}

/** Median of `rounds` timings of `work`, after a warm-up. */
export function measure(work: (iterations: number) => unknown, iterations: number, rounds = 7): number {
  work(iterations);
  const times: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    (globalThis as { gc?: () => void }).gc?.();
    const start = performance.now();
    work(iterations);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] as number;
}
