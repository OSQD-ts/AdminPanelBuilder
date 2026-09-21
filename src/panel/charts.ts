/**
 * The charts a panel draws and the histories behind them.
 *
 * Moved out of the panel so the panel is a coordinator rather than one very long file. The registry
 * owns every chart, every history ring and the one lookup the hot path pays for (histories sampled
 * on change, by value id); the panel hands it what it cannot know itself — the clock, a safe read,
 * whether a value is its own — through `ChartHost`.
 *
 * Histories can be kept across restarts: `snapshot()` returns every ring as samples and `restore()`
 * puts them back into the rings declared since, matched by history key. A ring declared with a
 * different size or sampling has a different key, so a snapshot can never fill a ring with samples
 * of another shape.
 */
import { AdminPanelConfigError } from "../errors.js";
import { slug } from "../internal/ids.js";
import { rejectUnknown } from "../internal/options.js";
import type { ChangeRecord, ChartKind, ChartOptions, ChartSchema, JsonValue, Sample, Span } from "../types.js";
import type { PanelValue } from "../values/handle.js";
import { History, MAX_HISTORY_POINTS, MIN_SAMPLE_INTERVAL_MS } from "../values/history.js";
import { plottable } from "../values/kinds.js";
import { checkSpan, checkTitle } from "./checks.js";
import { type PanelScope, visible } from "./scope.js";

/** Series one chart may draw: one per chart colour slot. */
export const MAX_SERIES = 8;

const DEFAULT_POINTS = 300;
/**
 * The bucket of a history sampled on change. One second matches the page's default poll: finer
 * buckets would hold samples no viewer ever saw arrive, and shorten the window the ring covers.
 */
const DEFAULT_CHANGE_BUCKET_MS = 1000;
/** A value read from a function or a property cannot announce changes, so a chart of it samples this often. */
const DEFAULT_LIVE_SAMPLE_MS = 1000;
const CHART_KINDS: readonly ChartKind[] = ["line", "area", "step", "bar", "sparkline", "gauge", "histogram", "heatmap"];
const CHART_KEYS = ["kind", "over", "in", "title", "points", "sampleEveryMs", "min", "max", "stacked", "lines", "annotate", "bins"];

interface HistoryEntry {
  key: string;
  history: History;
  value: PanelValue<unknown>;
  against: PanelValue<unknown> | undefined;
  /** Sampled on a timer; otherwise on every change of `value`. */
  everyMs: number | undefined;
  bucketMs: number;
  nextDue: number;
}

export interface ChartEntry {
  id: string;
  title: string;
  description: string | undefined;
  kind: ChartKind;
  over: "time" | "keys" | PanelValue<unknown>;
  series: PanelValue<unknown>[];
  /** A shared chart's own group; an alone chart follows its value. */
  group: string | undefined;
  placement: "alone" | "group";
  min: number | undefined;
  max: number | undefined;
  points: number;
  everyMs: number | undefined;
  order: number;
  sequence: number;
  stacked: boolean;
  lines: Array<{ label: string; value: number | PanelValue<unknown> }>;
  annotate: boolean;
  bins: number | undefined;
  span: Span | undefined;
}

export interface ChartHost {
  now(): number;
  /** Reads a value without letting a throwing getter escape. */
  read(value: PanelValue<unknown>): unknown;
  assertOwn(value: PanelValue<unknown>, where: string): void;
  structureChanged(): void;
  /** Makes sure the panel's timer runs, for histories sampled on a timer. */
  needTimer(): void;
  nextSequence(): number;
}

export class ChartRegistry {
  private readonly charts = new Map<string, ChartEntry>();
  private readonly histories = new Map<string, HistoryEntry>();
  /** Histories sampled on change, by value id: the only lookup `set()` pays for. */
  private readonly onChange = new Map<string, HistoryEntry[]>();
  /** Samples from a snapshot whose ring is not declared yet, applied when it is. */
  private waiting: Record<string, Sample[]> = {};

  constructor(private readonly host: ChartHost) {}

  get(id: string): ChartEntry | undefined {
    return this.charts.get(id);
  }

  all(): IterableIterator<ChartEntry> {
    return this.charts.values();
  }

  /** A value's own `chart` option: a chart beside it, or a series on a chart its group shares. */
  attach(value: PanelValue<unknown>, spec: true | ChartKind | ChartOptions): void {
    const options: ChartOptions = spec === true ? {} : typeof spec === "string" ? { kind: spec } : spec;
    rejectUnknown(options, CHART_KEYS, `the chart of "${value.label}"`);
    if (options.in !== undefined) {
      const title = checkTitle(options.in);
      const existing = [...this.charts.values()].find((chart) => chart.placement === "group" && chart.group === value.group && chart.title === title);
      if (existing !== undefined) {
        this.addSeries(existing, value);
        return;
      }
      this.build(title, options, [value], "group", value.group, undefined);
      return;
    }
    const chart = this.build(options.title ?? value.label, options, [value], "alone", undefined, undefined);
    value.chartId = chart.id;
  }

  build(title: string, options: ChartOptions & { order?: number | undefined; span?: Span | undefined }, series: readonly PanelValue<unknown>[], placement: "alone" | "group", group: string | undefined, description: string | undefined): ChartEntry {
    const current = options.kind === "histogram" || options.kind === "heatmap";
    if (current && options.over !== undefined && options.over !== "keys") throw new AdminPanelConfigError(`chart "${title}" is a ${options.kind}, which draws the current value; it cannot be over ${options.over === "time" ? "time" : "another value"}`);
    const over = options.over ?? (current ? "keys" : "time");
    const kind = options.kind ?? (over === "keys" ? "bar" : "line");
    if (!CHART_KINDS.includes(kind)) throw new AdminPanelConfigError(`chart "${title}" is a ${JSON.stringify(kind)}; the kinds are ${CHART_KINDS.join(", ")}`);
    const points = options.points ?? DEFAULT_POINTS;
    if (!Number.isInteger(points) || points < 2 || points > MAX_HISTORY_POINTS) {
      throw new AdminPanelConfigError(`chart "${title}" keeps ${points} points; it must be a whole number from 2 to ${MAX_HISTORY_POINTS} (each costs 16 bytes, held for as long as the process runs)`);
    }
    if (options.sampleEveryMs !== undefined && (!Number.isFinite(options.sampleEveryMs) || options.sampleEveryMs < MIN_SAMPLE_INTERVAL_MS)) {
      throw new AdminPanelConfigError(`chart "${title}" samples every ${options.sampleEveryMs}ms; the shortest interval is ${MIN_SAMPLE_INTERVAL_MS}ms`);
    }
    if (series.length > MAX_SERIES) throw new AdminPanelConfigError(`chart "${title}" draws ${series.length} series; a chart has ${MAX_SERIES} colour slots, so split it`);
    if (over !== "time" && over !== "keys") this.host.assertOwn(over, `chart "${title}"`);
    if (kind === "gauge" && series.length > 1) throw new AdminPanelConfigError(`chart "${title}" is a gauge of ${series.length} values; a gauge shows one`);
    if (options.stacked === true && (placement !== "group" || (kind !== "area" && kind !== "bar") || over !== "time")) {
      throw new AdminPanelConfigError(`chart "${title}" is stacked, which only a shared area or bar chart over time can be`);
    }
    if (options.bins !== undefined && (kind !== "histogram" || !Number.isInteger(options.bins) || options.bins < 2 || options.bins > 200)) {
      throw new AdminPanelConfigError(`chart "${title}" has ${options.bins} bins; bins belong to a histogram and are 2 to 200`);
    }
    const lines: ChartEntry["lines"] = [];
    for (const line of options.lines ?? []) {
      if (line === null || typeof line !== "object" || typeof line.label !== "string" || line.label === "") throw new AdminPanelConfigError(`chart "${title}" has a line without a label`);
      if (typeof line.value === "number") {
        if (!Number.isFinite(line.value)) throw new AdminPanelConfigError(`chart "${title}" has a line "${line.label}" at ${line.value}`);
      } else {
        this.host.assertOwn(line.value as PanelValue<unknown>, `chart "${title}", line "${line.label}"`);
        if ((line.value as PanelValue<unknown>).kind !== "number") throw new AdminPanelConfigError(`chart "${title}" draws a line at "${line.value.label}", which is not a number`);
      }
      if (over !== "time") throw new AdminPanelConfigError(`chart "${title}" has lines, which only a chart over time draws`);
      lines.push({ label: line.label, value: line.value as number | PanelValue<unknown> });
    }
    const base = slug(`${placement === "alone" ? (series[0] as PanelValue<unknown>).id : `${group}-${title}`}-chart`) || "chart";
    let id = base;
    for (let n = 2; this.charts.has(id); n += 1) id = `${base}-${n}`;
    const entry: ChartEntry = {
      id,
      title: checkTitle(title),
      description,
      kind,
      over: over as ChartEntry["over"],
      series: [],
      group,
      placement,
      min: options.min,
      max: options.max,
      points,
      everyMs: options.sampleEveryMs,
      order: options.order ?? 0,
      sequence: this.host.nextSequence(),
      stacked: options.stacked === true,
      lines,
      annotate: options.annotate !== false,
      bins: options.bins,
      span: checkSpan(title, options.span),
    };
    for (const value of series) this.checkSeries(entry, value);
    this.charts.set(id, entry);
    for (const value of series) this.addSeries(entry, value);
    this.host.structureChanged();
    return entry;
  }

  private checkSeries(chart: ChartEntry, value: PanelValue<unknown>): void {
    if (chart.over === "keys") {
      if (value.kind !== "json") throw new AdminPanelConfigError(`chart "${chart.title}" draws the keys of "${value.label}", which is a ${value.kind}; only a record or an array has keys to draw`);
      return;
    }
    if (value.kind !== "number" && value.kind !== "boolean") {
      throw new AdminPanelConfigError(`chart "${chart.title}" would plot "${value.label}", which is a ${value.kind}; only numbers and booleans can be plotted ${chart.over === "time" ? "over time" : "against another value"}`);
    }
    if (chart.over !== "time" && chart.over.kind !== "number") throw new AdminPanelConfigError(`chart "${chart.title}" is plotted against "${chart.over.label}", which is a ${chart.over.kind}; the horizontal axis must be a number`);
    if (value.definition.sensitive) throw new AdminPanelConfigError(`chart "${chart.title}" would plot "${value.label}", which is sensitive: a chart of a secret is the secret`);
    if (chart.kind === "gauge" && chart.max === undefined && value.definition.constraints.max === undefined) {
      throw new AdminPanelConfigError(`the gauge "${chart.title}" has no maximum to fill towards: give the chart a max, or the value one`);
    }
  }

  private addSeries(chart: ChartEntry, value: PanelValue<unknown>): void {
    if (chart.series.includes(value)) return;
    if (chart.series.length >= MAX_SERIES) throw new AdminPanelConfigError(`chart "${chart.title}" already draws ${MAX_SERIES} series, one per colour slot; "${value.label}" needs a chart of its own`);
    this.checkSeries(chart, value);
    chart.series.push(value);
    if (chart.over === "keys" || chart.kind === "gauge") return;
    const key = historyKey(chart, value);
    if (this.histories.has(key)) return;
    const against = chart.over === "time" ? undefined : chart.over;
    const everyMs = chart.everyMs ?? (value.live || against?.live === true ? DEFAULT_LIVE_SAMPLE_MS : undefined);
    const bucket = everyMs ?? DEFAULT_CHANGE_BUCKET_MS;
    const entry: HistoryEntry = { key, history: new History(chart.points, bucket, against !== undefined), value, against, everyMs, bucketMs: bucket, nextDue: 0 };
    this.histories.set(key, entry);
    const saved = this.waiting[key];
    if (saved !== undefined) {
      for (const sample of saved) entry.history.record(sample[0], sample[1], sample[2]);
      delete this.waiting[key];
    }
    if (everyMs === undefined) {
      const list = this.onChange.get(value.id) ?? [];
      list.push(entry);
      this.onChange.set(value.id, list);
      // The starting value is a sample too, so a chart of something that rarely changes is not empty until it does.
      this.sample(entry, this.host.now());
    } else this.host.needTimer();
    this.host.structureChanged();
  }

  /** The hot path: a value changed. */
  changed(value: PanelValue<unknown>, now: number): void {
    const histories = this.onChange.get(value.id);
    if (histories === undefined) return;
    for (const entry of histories) this.sample(entry, now);
  }

  /** Samples every timer-driven history that is due. */
  tick(now: number): void {
    for (const entry of this.histories.values()) {
      if (entry.everyMs === undefined || now < entry.nextDue) continue;
      entry.nextDue = now + entry.everyMs;
      this.sample(entry, now);
    }
  }

  private sample(entry: HistoryEntry, now: number): void {
    const y = plottable(this.host.read(entry.value));
    if (y === undefined) return;
    if (entry.against === undefined) {
      entry.history.record(now, y);
      return;
    }
    const x = plottable(this.host.read(entry.against));
    if (x !== undefined) entry.history.record(now, y, x);
  }

  /** Samples for every visible chart, by history key. */
  series(scope: PanelScope, after: number | undefined): Record<string, Sample[]> {
    const out: Record<string, Sample[]> = {};
    for (const chart of this.charts.values()) {
      if (!this.visibleTo(chart, scope)) continue;
      for (const value of chart.series) {
        if (!visible(scope, value.group)) continue;
        const entry = this.histories.get(historyKey(chart, value));
        if (entry === undefined || out[entry.key] !== undefined) continue;
        out[entry.key] = entry.history.samples(after);
      }
    }
    return out;
  }

  /** Operator changes to mark on each visible annotated chart, within the window it draws. */
  marks(scope: PanelScope, now: number, records: readonly ChangeRecord[]): Record<string, Array<{ at: number; text: string }>> {
    const out: Record<string, Array<{ at: number; text: string }>> = {};
    if (records.length === 0) return out;
    for (const chart of this.charts.values()) {
      if (!chart.annotate || chart.over !== "time" || !this.visibleTo(chart, scope)) continue;
      const ids = new Set(chart.series.map((value) => value.id));
      for (const line of chart.lines) if (typeof line.value !== "number") ids.add(line.value.id);
      const from = now - chart.points * (chart.everyMs ?? DEFAULT_CHANGE_BUCKET_MS);
      const marks = records
        .filter((record) => (record.kind === "edit" || record.kind === "revert" || record.kind === "approval" || record.kind === "scheduled" || record.kind === "import") && ids.has(record.target) && record.at >= from)
        .map((record) => ({ at: record.at, text: `${record.label}${record.to === undefined ? "" : ` → ${JSON.stringify(record.to)}`} (${record.by})` }));
      if (marks.length > 0) out[chart.id] = marks;
    }
    return out;
  }

  /** A chart plotted against a value from a withheld group would leak that value's readings on its axis, so it is withheld too. */
  visibleTo(chart: ChartEntry, scope: PanelScope): boolean {
    if (chart.over !== "time" && chart.over !== "keys" && !visible(scope, chart.over.group)) return false;
    if (chart.placement === "group") return visible(scope, chart.group as string);
    return visible(scope, (chart.series[0] as PanelValue<unknown>).group);
  }

  schema(chart: ChartEntry, scope: PanelScope): ChartSchema {
    const first = chart.series[0] as PanelValue<unknown>;
    const schema: ChartSchema = {
      type: "chart",
      id: chart.id,
      title: chart.title,
      kind: chart.kind,
      over: chart.over === "time" || chart.over === "keys" ? chart.over : { value: chart.over.id, label: chart.over.label },
      series: chart.series
        .filter((value) => visible(scope, value.group))
        .map((value, index) => {
          const series: ChartSchema["series"][number] = { value: value.id, label: value.label, slot: index + 1 };
          if (this.histories.has(historyKey(chart, value))) series.history = historyKey(chart, value);
          return series;
        }),
      placement: chart.placement,
      points: chart.points,
    };
    if (chart.description !== undefined) schema.description = chart.description;
    const min = chart.min ?? (chart.kind === "gauge" ? (first.definition.constraints.min ?? 0) : undefined);
    const max = chart.max ?? (chart.kind === "gauge" ? first.definition.constraints.max : undefined);
    if (min !== undefined) schema.min = min;
    if (max !== undefined) schema.max = max;
    if (first.definition.unit !== undefined) schema.unit = first.definition.unit;
    if (first.definition.format !== undefined) schema.format = first.definition.format;
    if (chart.stacked) schema.stacked = true;
    if (chart.bins !== undefined) schema.bins = chart.bins;
    if (chart.span !== undefined) schema.span = chart.span;
    const lines = chart.lines
      .filter((line) => typeof line.value === "number" || visible(scope, line.value.group))
      .map((line) => (typeof line.value === "number" ? { label: line.label, value: line.value } : { label: line.label, from: line.value.id }));
    if (lines.length > 0) schema.lines = lines;
    return schema;
  }

  /** Every ring's samples, for keeping history across a restart. Sensitive values are never charted, so nothing secret is in it. */
  snapshot(): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = { ...(this.waiting as Record<string, JsonValue>) };
    for (const [key, entry] of this.histories) out[key] = entry.history.samples() as JsonValue;
    return out;
  }

  /**
   * Puts saved samples back into the rings they came from. A ring declared later gets its samples
   * when it is declared; a damaged entry is skipped, never allowed to stop the rest.
   */
  restore(saved: unknown): number {
    if (saved === null || typeof saved !== "object" || Array.isArray(saved)) return 0;
    let restored = 0;
    for (const [key, samples] of Object.entries(saved as Record<string, unknown>)) {
      if (!Array.isArray(samples)) continue;
      const valid = samples.filter((sample): sample is Sample => Array.isArray(sample) && sample.length >= 2 && sample.length <= 3 && sample.every((part) => typeof part === "number" && Number.isFinite(part)));
      const entry = this.histories.get(key);
      if (entry === undefined) {
        this.waiting[key] = valid;
        continue;
      }
      // A ring only accepts samples newer than its newest, so the saved ones go into a fresh ring
      // first and what was sampled since the start follows them.
      const merged = new History(entry.history.capacity, entry.bucketMs, entry.against !== undefined);
      for (const sample of [...valid, ...entry.history.samples()].sort((a, b) => a[0] - b[0])) merged.record(sample[0], sample[1], sample[2]);
      entry.history = merged;
      restored += 1;
    }
    return restored;
  }
}

export function historyKey(chart: ChartEntry, value: PanelValue<unknown>): string {
  const over = chart.over === "time" || chart.over === "keys" ? chart.over : `vs-${chart.over.id}`;
  return `${value.id}~${over}~${chart.points}~${chart.everyMs ?? "change"}`;
}
