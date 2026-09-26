/**
 * Everything the page knows, in one record.
 *
 * A poll merges into it: values by id, samples by time. `drawn` counts merges so a panel that
 * redraws only the visible screen can tell which charts are behind when a tab is opened.
 */
import type { ChangeRecord, ChartSchema, FeedEntry, Notice, PanelSchema, PanelState, PendingChange, Sample, WireValue } from "../types.js";
import { mergeSamples } from "./geometry.js";

export interface Store {
  schema: PanelSchema;
  values: Map<string, WireValue>;
  series: Map<string, Sample[]>;
  version: number;
  /** The server's clock at the last state, for "changed 5 s ago" without trusting the viewer's clock. */
  serverNow: number;
  /** Viewer clock minus server clock, measured at the last state. */
  skew: number;
  changes: ChangeRecord[];
  notices: Notice[];
  /** Bumped on every merge. */
  revision: number;
  /** Samples each history may hold, from the schema. */
  capacity: Map<string, number>;
  /** Feed entries, newest last, bounded by each feed's capacity. */
  feeds: Map<string, { entries: FeedEntry[]; dropped: number; total: number }>;
  feedSeq: number;
  pending: PendingChange[];
  activeProfiles: Set<string>;
  marks: PanelState["marks"];
  actionStates: PanelState["actionStates"];
  profileSchedules: NonNullable<PanelState["profileSchedules"]>;
}

export function createStore(schema: PanelSchema, state: PanelState): Store {
  const store: Store = {
    schema,
    values: new Map(),
    series: new Map(),
    version: 0,
    serverNow: state.now,
    skew: 0,
    changes: [],
    notices: [],
    revision: 0,
    capacity: capacities(schema),
    feeds: new Map(),
    feedSeq: 0,
    pending: [],
    activeProfiles: new Set(),
    marks: {},
    actionStates: {},
    profileSchedules: {},
  };
  mergeState(store, state, true);
  return store;
}

export function capacities(schema: PanelSchema): Map<string, number> {
  const map = new Map<string, number>();
  for (const group of schema.groups) {
    for (const item of group.items) {
      if (item.type !== "chart") continue;
      for (const series of (item as ChartSchema).series) if (series.history !== undefined) map.set(series.history, (item as ChartSchema).points);
    }
  }
  return map;
}

export function mergeState(store: Store, state: PanelState, replace: boolean): void {
  if (replace) {
    store.values.clear();
    store.series.clear();
  }
  for (const value of state.values) store.values.set(value.id, value);
  for (const [key, samples] of Object.entries(state.series)) {
    const held = replace ? [] : (store.series.get(key) ?? []);
    store.series.set(key, mergeSamples(held, samples, store.capacity.get(key) ?? 10_000));
  }
  const feedCapacity = new Map<string, number>();
  for (const group of store.schema.groups) for (const item of group.items) if (item.type === "feed") feedCapacity.set(item.id, item.capacity);
  if (replace) store.feeds.clear();
  for (const [id, feed] of Object.entries(state.feeds ?? {})) {
    const held = store.feeds.get(id)?.entries ?? [];
    const last = held.length === 0 ? 0 : (held[held.length - 1] as FeedEntry).seq;
    const entries = held.concat(feed.entries.filter((entry) => entry.seq > last));
    const capacity = feedCapacity.get(id) ?? 200;
    store.feeds.set(id, { entries: entries.length > capacity ? entries.slice(entries.length - capacity) : entries, dropped: feed.dropped, total: feed.total });
  }
  store.feedSeq = state.feedSeq ?? store.feedSeq;
  store.pending = state.pending ?? [];
  store.activeProfiles = new Set(state.activeProfiles ?? []);
  store.marks = state.marks ?? {};
  store.actionStates = state.actionStates ?? {};
  store.profileSchedules = state.profileSchedules ?? {};
  store.version = state.version;
  store.serverNow = state.now;
  store.skew = Date.now() - state.now;
  store.revision += 1;
}

/** The server's idea of now, extrapolated from the last state. */
export function serverTime(store: Store): number {
  return Date.now() - store.skew;
}
