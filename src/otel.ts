/**
 * The panel's numbers through OpenTelemetry, for a team whose metrics go through an OTel collector
 * rather than a Prometheus scrape. The same series `/metrics` exposes:
 *
 *   `<prefix>.value`          gauge   {id, label, group}   every numeric or boolean value
 *   `<prefix>.count`          counter {id, label, group}   values declared with counter()
 *   `<prefix>.changes`        counter {kind, ok}           operator changes since start
 *   `<prefix>.notices`        gauge                        notices held now
 *
 * The application hands in its own `MeterProvider` (or a `Meter`), typed by the few methods used,
 * so this package imports no OpenTelemetry. Everything is observed when the SDK collects, never on
 * the write path. Sensitive values are left out, and `groups` withholds groups as a listener does.
 */
import type { AdminPanel } from "./core.js";
import { CHANGE_KINDS } from "./metrics.js";

/** What an observable callback is handed. */
export interface ObservableResultLike {
  observe(value: number, attributes?: Record<string, string | number | boolean>): void;
}

export interface ObservableLike {
  addCallback(callback: (result: ObservableResultLike) => void): void;
  removeCallback(callback: (result: ObservableResultLike) => void): void;
}

/** The parts of an OpenTelemetry `Meter` used. */
export interface MeterLike {
  createObservableGauge(name: string, options?: { description?: string; unit?: string }): ObservableLike;
  createObservableCounter(name: string, options?: { description?: string; unit?: string }): ObservableLike;
}

export interface MeterProviderLike {
  getMeter(name: string, version?: string): MeterLike;
}

export interface OtelMetricsOptions {
  /** Instrument names start with it. Default "admin_panel". */
  prefix?: string | undefined;
  /** Only these groups, as a listener's `groups` would show. Default: every group. */
  groups?: readonly string[] | undefined;
}

/** Registers the panel's instruments. Returns the way to stop observing. */
export function otelMetrics(panel: AdminPanel, meter: MeterLike | MeterProviderLike, options: OtelMetricsOptions = {}): () => void {
  const prefix = options.prefix ?? "admin_panel";
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(prefix)) throw new TypeError(`otelMetrics: the prefix ${JSON.stringify(prefix)} is not an instrument name`);
  const resolved: MeterLike = "getMeter" in meter ? meter.getMeter("@osqd/admin-panel-builder") : meter;
  const scope = { groups: options.groups === undefined ? undefined : new Set(options.groups), edit: false, actions: false, restrictions: [] };
  const value = resolved.createObservableGauge(`${prefix}.value`, { description: "Numeric values shown on the admin panel" });
  const count = resolved.createObservableCounter(`${prefix}.count`, { description: "Counters declared with counter() on the admin panel" });
  const changes = resolved.createObservableCounter(`${prefix}.changes`, { description: "Operator changes since the process started, by kind and whether they succeeded" });
  const notices = resolved.createObservableGauge(`${prefix}.notices`, { description: "Notices the panel currently holds" });
  const observeValues = (result: ObservableResultLike): void => {
    for (const entry of panel.metricValues(scope)) if (!entry.counter) result.observe(entry.value, { id: entry.id, label: entry.label, group: entry.group });
  };
  const observeCounts = (result: ObservableResultLike): void => {
    for (const entry of panel.metricValues(scope)) if (entry.counter) result.observe(entry.value, { id: entry.id, label: entry.label, group: entry.group });
  };
  const observeChanges = (result: ObservableResultLike): void => {
    const totals = panel.changeTotals();
    for (const kind of CHANGE_KINDS) for (const ok of [true, false]) result.observe(totals.get(`${kind}|${ok}`) ?? 0, { kind, ok });
  };
  const observeNotices = (result: ObservableResultLike): void => result.observe(panel.notices().length);
  value.addCallback(observeValues);
  count.addCallback(observeCounts);
  changes.addCallback(observeChanges);
  notices.addCallback(observeNotices);
  return () => {
    value.removeCallback(observeValues);
    count.removeCallback(observeCounts);
    changes.removeCallback(observeChanges);
    notices.removeCallback(observeNotices);
  };
}
