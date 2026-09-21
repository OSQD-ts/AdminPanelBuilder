/**
 * Chart geometry, without a document. Pure, so it is unit-tested.
 *
 * Charts draw into a 0–1000 × 0–1000 box that the SVG stretches to its container
 * (`preserveAspectRatio="none"`, strokes with `vector-effect: non-scaling-stroke`), and the
 * axis labels are HTML placed beside it. The alternative — a fixed viewBox scaled as a whole —
 * scaled the text with it, which put 8px labels under a chart in a narrow card and 18px ones
 * under a wide one.
 */
import type { Sample } from "../types.js";

export const BOX = 1000;

export interface Extent {
  min: number;
  max: number;
}

/** The range to draw: the declared bounds where given, the data's otherwise, padded so a flat line is not drawn on the frame. */
export function extentOf(values: readonly number[], declared: { min?: number | undefined; max?: number | undefined } = {}, zeroBased = false): Extent {
  let min = declared.min ?? Number.POSITIVE_INFINITY;
  let max = declared.max ?? Number.NEGATIVE_INFINITY;
  if (declared.min === undefined || declared.max === undefined) {
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      if (declared.min === undefined && value < min) min = value;
      if (declared.max === undefined && value > max) max = value;
    }
  }
  if (zeroBased && declared.min === undefined && min > 0) min = 0;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    return { min: declared.min ?? min - pad, max: declared.max ?? max + pad };
  }
  return { min, max };
}

/** Round tick values covering the extent: 0, 25, 50, 75, 100 rather than 0, 23.7, 47.4. */
export function niceTicks(extent: Extent, count = 4): number[] {
  const span = extent.max - extent.min;
  if (!(span > 0) || !Number.isFinite(span)) return [extent.min];
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  const first = Math.ceil(extent.min / step - 1e-9) * step;
  for (let tick = first; tick <= extent.max + step * 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
}

/** Position of `value` in the box, 0 at the bottom (`y`) or left (`x`). */
export function scale(value: number, extent: Extent): number {
  const span = extent.max - extent.min;
  if (!(span > 0)) return BOX / 2;
  return ((value - extent.min) / span) * BOX;
}

/** SVG path data. `step` holds each value until the next sample, which is the honest drawing of a setting that changes in jumps. */
export function linePath(points: ReadonlyArray<readonly [number, number]>, step = false): string {
  let path = "";
  points.forEach(([x, y], index) => {
    const px = round(x);
    const py = round(BOX - y);
    if (index === 0) path += `M${px} ${py}`;
    else if (step) {
      const previous = points[index - 1] as readonly [number, number];
      path += ` L${px} ${round(BOX - previous[1])} L${px} ${py}`;
    } else path += ` L${px} ${py}`;
  });
  return path;
}

/** The line closed down to the baseline, for an area. */
export function areaPath(points: ReadonlyArray<readonly [number, number]>, step = false, baseline = 0): string {
  if (points.length === 0) return "";
  const first = points[0] as readonly [number, number];
  const last = points[points.length - 1] as readonly [number, number];
  return `${linePath(points, step)} L${round(last[0])} ${round(BOX - baseline)} L${round(first[0])} ${round(BOX - baseline)} Z`;
}

/** Samples mapped into the box, sorted by x for a chart over another value. */
export function project(samples: readonly Sample[], x: Extent, y: Extent, against: boolean): Array<[number, number]> {
  const points = samples.map((sample) => [scale(against ? (sample[2] ?? 0) : sample[0], x), scale(sample[1], y)] as [number, number]);
  if (against) points.sort((a, b) => a[0] - b[0]);
  return points;
}

/** Merges fresh samples into held ones by time: a re-sent newest bucket replaces the one held, and the ring's capacity is kept. */
export function mergeSamples(held: readonly Sample[], fresh: readonly Sample[], capacity: number): Sample[] {
  if (fresh.length === 0) return held as Sample[];
  const firstFresh = (fresh[0] as Sample)[0];
  let keep = held.length;
  while (keep > 0 && (held[keep - 1] as Sample)[0] >= firstFresh) keep -= 1;
  const merged = held.slice(0, keep).concat(fresh);
  return merged.length > capacity ? merged.slice(merged.length - capacity) : merged;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
