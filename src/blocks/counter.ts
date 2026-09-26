/**
 * Counts, rates and percentiles: the numbers an operator most often wants and most often gets wrong
 * by hand.
 *
 * A counter only goes up, and its rate is the increase over a sliding window divided by the
 * window's length. A drop is a reset (the process behind it restarted, or somebody called
 * `reset()`), and the value after it is counted as the increase — the way Prometheus's `rate()`
 * reads a reset — rather than as a large negative rate.
 *
 * Percentiles come from the most recent `window` observations in a fixed ring, sorted once a
 * second. That is exact for the window and costs a store per observation on the hot path; the price
 * is that the window is counted in observations, not in time, which the documentation says.
 */
import type { AdminPanel } from "../core.js";
import { AdminPanelConfigError } from "../errors.js";
import { rejectUnknown } from "../internal/options.js";
import type { CardSize, ChartKind, Span, ValueFormat } from "../types.js";
import type { PanelValue } from "../values/handle.js";

export interface CounterOptions {
  id?: string | undefined;
  description?: string | undefined;
  group?: string | undefined;
  order?: number | undefined;
  span?: Span | undefined;
  size?: CardSize | undefined;
  /** The rate's unit of time. Default `"second"`. */
  per?: "second" | "minute" | undefined;
  /** How far back the rate looks. Default 10 seconds, 2 seconds to an hour. */
  windowMs?: number | undefined;
  /** Chart the rate. Default true, as a line; a kind name picks another. */
  chart?: boolean | ChartKind | undefined;
}

export interface Counter {
  readonly total: PanelValue<number>;
  readonly rate: PanelValue<number>;
  /** Adds to the count. The hot path: an addition and a comparison. */
  inc(by?: number): void;
  /** Starts the count again from zero; the rate reads it as a reset, not as a negative rate. */
  reset(): void;
}

const COUNTER_KEYS = ["id", "description", "group", "order", "span", "size", "per", "windowMs", "chart"];

export function declareCounter(panel: AdminPanel, label: string, options: CounterOptions = {}): Counter {
  rejectUnknown(options, COUNTER_KEYS, `counter("${label}")`);
  const windowMs = checkWindow(label, options.windowMs);
  const per = options.per ?? "second";
  const common = { group: options.group, order: options.order, span: options.span, size: options.size };
  const total = panel.viewable(0, { ...common, id: options.id, label, format: "integer", description: options.description });
  panel.markCounter(total.id);
  const rate = rateOf(panel, `${label} per ${per}`, () => total.value, { ...common, per, windowMs, chart: options.chart ?? true, id: options.id === undefined ? undefined : `${options.id}-rate` });
  return {
    total,
    rate,
    inc(by = 1) {
      if (!Number.isFinite(by) || by < 0) throw new AdminPanelConfigError(`counter "${label}" was increased by ${by}; a counter only goes up (use reset() to start again)`);
      total.value += by;
    },
    reset() {
      total.value = 0;
    },
  };
}

export interface RateOptions {
  id?: string | undefined;
  description?: string | undefined;
  group?: string | undefined;
  order?: number | undefined;
  span?: Span | undefined;
  size?: CardSize | undefined;
  per?: "second" | "minute" | undefined;
  windowMs?: number | undefined;
  chart?: boolean | ChartKind | undefined;
  unit?: string | undefined;
}

/** The rate of a total the application already keeps: `rate("Requests per second", () => server.handled)`. */
export function rateOf(panel: AdminPanel, label: string, read: () => number, options: RateOptions = {}): PanelValue<number> {
  rejectUnknown(options, ["id", "description", "group", "order", "span", "size", "per", "windowMs", "chart", "unit"], `rate("${label}")`);
  const windowMs = checkWindow(label, options.windowMs);
  const scale = options.per === "minute" ? 60_000 : 1000;
  const size = Math.ceil(windowMs / 1000) + 1;
  const times = new Float64Array(size);
  const totals = new Float64Array(size);
  let count = 0;
  let head = 0;
  let current = 0;
  const value = panel.viewable(0, {
    id: options.id,
    label,
    description: options.description,
    group: options.group,
    order: options.order,
    span: options.span,
    size: options.size,
    decimals: 2,
    unit: options.unit ?? `/${options.per === "minute" ? "min" : "s"}`,
    chart: options.chart === false ? undefined : options.chart === true || options.chart === undefined ? true : options.chart,
  });
  panel.every(1000, (now) => {
    let reading: number;
    try {
      reading = read();
    } catch {
      return;
    }
    if (!Number.isFinite(reading)) return;
    times[head] = now;
    totals[head] = reading;
    head = (head + 1) % size;
    if (count < size) count += 1;
    if (count < 2) return;
    const oldest = (head - count + size) % size;
    let increase = 0;
    for (let i = 1; i < count; i += 1) {
      const previous = totals[(oldest + i - 1) % size] as number;
      const next = totals[(oldest + i) % size] as number;
      increase += next >= previous ? next - previous : next;
    }
    const span = now - (times[oldest] as number);
    const rate = span > 0 ? (increase / span) * scale : 0;
    if (rate !== current) {
      current = rate;
      value.value = Math.round(rate * 1000) / 1000;
    }
  });
  return value;
}

export interface PercentileOptions {
  group?: string | undefined;
  order?: number | undefined;
  description?: string | undefined;
  /** Default `[50, 95, 99]`. */
  percentiles?: readonly number[] | undefined;
  /** Observations the percentiles are computed over. Default 1024, 16 to 65536. */
  window?: number | undefined;
  unit?: string | undefined;
  format?: ValueFormat | undefined;
  /** Chart the percentiles together over time. Default true. */
  chart?: boolean | undefined;
}

export interface Percentiles {
  readonly values: ReadonlyMap<number, PanelValue<number>>;
  /** Records one observation: a store into a ring. */
  record(observation: number): void;
}

/** Latency and its tail: `const latency = percentiles("Move latency", { unit: "ms" }); latency.record(ms)`. */
export function declarePercentiles(panel: AdminPanel, label: string, options: PercentileOptions = {}): Percentiles {
  rejectUnknown(options, ["group", "order", "description", "percentiles", "window", "unit", "format", "chart"], `percentiles("${label}")`);
  const wanted = options.percentiles ?? [50, 95, 99];
  if (wanted.length === 0 || wanted.length > 8 || wanted.some((p) => !Number.isFinite(p) || p <= 0 || p >= 100)) {
    throw new AdminPanelConfigError(`percentiles "${label}" asks for ${JSON.stringify(wanted)}; give one to eight percentiles between 0 and 100`);
  }
  const window = options.window ?? 1024;
  if (!Number.isInteger(window) || window < 16 || window > 65_536) throw new AdminPanelConfigError(`percentiles "${label}" keeps ${window} observations; it is 16 to 65536`);
  const ring = new Float64Array(window);
  let count = 0;
  let head = 0;
  let dirty = false;
  const values = new Map<number, PanelValue<number>>();
  for (const p of wanted) {
    values.set(
      p,
      panel.viewable(0, { label: `${label} p${p}`, group: options.group, order: options.order, description: options.description, unit: options.unit, format: options.format, decimals: 1, chart: options.chart === false ? undefined : { in: label } }),
    );
  }
  panel.every(1000, () => {
    if (!dirty || count === 0) return;
    dirty = false;
    const sorted = Array.from(ring.subarray(0, count)).sort((a, b) => a - b);
    for (const [p, value] of values) value.value = sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
  });
  return {
    values,
    record(observation) {
      if (!Number.isFinite(observation)) return;
      ring[head] = observation;
      head = (head + 1) % window;
      if (count < window) count += 1;
      dirty = true;
    },
  };
}

function checkWindow(label: string, windowMs: number | undefined): number {
  const value = windowMs ?? 10_000;
  if (!Number.isFinite(value) || value < 2000 || value > 3_600_000) throw new AdminPanelConfigError(`"${label}" looks back ${value}ms; the window is 2 seconds to an hour`);
  return value;
}
