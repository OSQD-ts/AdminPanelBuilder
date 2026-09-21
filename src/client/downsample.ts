/**
 * Largest-Triangle-Three-Buckets: fewer points that still look like the line.
 *
 * A 10,000-sample history drawn into a few hundred pixels spends the browser's time on points no
 * one can see. LTTB keeps the first and last points and, from each bucket between, the point that
 * makes the largest triangle with its neighbours — the peaks and troughs a person would notice.
 * Only the drawing is downsampled; the table view lists every sample.
 */
export function lttb(points: ReadonlyArray<readonly [number, number]>, threshold: number): Array<[number, number]> {
  const length = points.length;
  if (threshold >= length || threshold < 3) return points.map(([x, y]) => [x, y]);
  const sampled: Array<[number, number]> = [];
  const every = (length - 2) / (threshold - 2);
  let a = 0;
  sampled.push([points[0]?.[0] as number, points[0]?.[1] as number]);
  for (let i = 0; i < threshold - 2; i += 1) {
    const avgStart = Math.floor((i + 1) * every) + 1;
    const avgEnd = Math.min(Math.floor((i + 2) * every) + 1, length);
    let avgX = 0;
    let avgY = 0;
    for (let j = avgStart; j < avgEnd; j += 1) {
      avgX += (points[j] as readonly [number, number])[0];
      avgY += (points[j] as readonly [number, number])[1];
    }
    const span = Math.max(1, avgEnd - avgStart);
    avgX /= span;
    avgY /= span;
    const rangeStart = Math.floor(i * every) + 1;
    const rangeEnd = Math.floor((i + 1) * every) + 1;
    const [ax, ay] = points[a] as readonly [number, number];
    let maxArea = -1;
    let chosen = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j += 1) {
      const [x, y] = points[j] as readonly [number, number];
      const area = Math.abs((ax - avgX) * (y - ay) - (ax - x) * (avgY - ay));
      if (area > maxArea) {
        maxArea = area;
        chosen = j;
      }
    }
    const [x, y] = points[chosen] as readonly [number, number];
    sampled.push([x, y]);
    a = chosen;
  }
  const last = points[length - 1] as readonly [number, number];
  sampled.push([last[0], last[1]]);
  return sampled;
}

/** Sturges' rule, bounded: enough bins to show a shape, few enough to read. */
export function binCount(count: number): number {
  return Math.min(50, Math.max(4, Math.ceil(Math.log2(Math.max(1, count)) + 1)));
}

/** Counts of values in equal-width bins over their range. */
export function histogram(values: readonly number[], bins: number): Array<{ from: number; to: number; count: number }> {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const width = max === min ? 1 : (max - min) / bins;
  const out = Array.from({ length: bins }, (_, index) => ({ from: min + index * width, to: min + (index + 1) * width, count: 0 }));
  for (const value of finite) {
    const index = max === min ? 0 : Math.min(bins - 1, Math.floor((value - min) / width));
    (out[index] as { count: number }).count += 1;
  }
  return out;
}

/** Aligns several series on the union of their times, carrying each value forward, for stacking. */
export function stack(series: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): { times: number[]; layers: Array<Array<[number, number]>> } {
  const times = [...new Set(series.flatMap((points) => points.map(([t]) => t)))].sort((a, b) => a - b);
  const base = new Array<number>(times.length).fill(0);
  const layers = series.map((points) => {
    let index = 0;
    let last = 0;
    return times.map((t, position) => {
      while (index < points.length && (points[index] as readonly [number, number])[0] <= t) {
        last = (points[index] as readonly [number, number])[1];
        index += 1;
      }
      const bottom = base[position] as number;
      base[position] = bottom + last;
      return [t, bottom + last] as [number, number];
    });
  });
  return { times, layers };
}
