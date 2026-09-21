/**
 * The panel behind the bare functions: `import { viewable } from "@osqd/admin-panel-builder"`.
 *
 * Most applications have one panel, and making every module that wants to show a number import
 * a panel object from somewhere central is friction that decides whether anybody bothers. So
 * there is one, created on first use rather than at import — the package declares itself free
 * of side effects, and a module that built a panel on import would be lying.
 *
 * Anything that needs a second panel, or isolation in a test, uses `createAdminPanel()`; the
 * functions here are exactly `defaultPanel().viewable(…)` and so on.
 */
import type { PanelAction } from "./actions.js";
import { AdminPanel, type AdminPanelOptions, type PanelGroup } from "./core.js";
import { AdminPanelConfigError } from "./errors.js";
import type { Counter, CounterOptions, PercentileOptions, Percentiles, RateOptions } from "./blocks/counter.js";
import type { PanelFeed } from "./blocks/feed.js";
import type { PanelTable } from "./blocks/table.js";
import type { ActionContext, ActionOptions, BindOptions, FeedOptions, GroupOptions, ModifiableOptions, ProfileOptions, SharedChartOptions, TableOptions, ViewableOptions } from "./types.js";
import type { PanelValue } from "./values/handle.js";

let shared: AdminPanel | undefined;
let pending: AdminPanelOptions | undefined;

/** The default panel, created on first use with whatever `configure()` said before it. */
export function defaultPanel(): AdminPanel {
  if (shared === undefined) {
    shared = new AdminPanel(pending);
    pending = undefined;
  }
  return shared;
}

/**
 * Settings for the default panel. Called before anything is declared it may set everything,
 * including the store and the clock; afterwards only what a running panel can swap.
 */
export function configure(options: AdminPanelOptions): void {
  if (shared === undefined) {
    pending = { ...pending, ...options };
    return;
  }
  const { store, clock, defaultGroup, onError, changeLog, locale, messages, ...swappable } = options;
  const fixed = Object.entries({ store, clock, defaultGroup, onError, changeLog, locale, messages }).filter(([, value]) => value !== undefined).map(([key]) => key);
  if (fixed.length > 0) {
    throw new AdminPanelConfigError(`${fixed.join(", ")} can only be configured before the first declaration: the default panel already exists, and replacing ${fixed.length === 1 ? "it" : "them"} would drop what was read through ${fixed.length === 1 ? "it" : "them"}`);
  }
  shared.configure(swappable);
}

export function viewable<T>(initial: T | (() => T), options?: ViewableOptions | string): PanelValue<T> {
  return defaultPanel().viewable(initial, options);
}

export function modifiable<T>(initial: T, options?: ModifiableOptions<T> | string): PanelValue<T> {
  return defaultPanel().modifiable(initial, options);
}

export function bind<O extends object, K extends keyof O & (string | number)>(target: O, key: K, options?: BindOptions<O[K]> | string): PanelValue<O[K]> {
  return defaultPanel().bind(target, key, options);
}

export function action(label: string, run: (context: ActionContext) => unknown, options?: ActionOptions): PanelAction {
  return defaultPanel().action(label, run, options);
}

export function group(name: string, options?: GroupOptions): PanelGroup {
  return defaultPanel().group(name, options);
}

export function chart(options: SharedChartOptions): string {
  return defaultPanel().chart(options);
}

export function table<Row = Record<string, unknown>>(label: string, options: TableOptions<Row>): PanelTable<Row> {
  return defaultPanel().table(label, options);
}

export function feed(label: string, options?: FeedOptions): PanelFeed {
  return defaultPanel().feed(label, options);
}

export function profile(label: string, settings: ReadonlyArray<readonly [PanelValue<unknown>, unknown]>, options?: ProfileOptions): string {
  return defaultPanel().profile(label, settings, options);
}

export function counter(label: string, options?: CounterOptions): Counter {
  return defaultPanel().counter(label, options);
}

export function rate(label: string, read: () => number, options?: RateOptions): PanelValue<number> {
  return defaultPanel().rate(label, read, options);
}

export function percentiles(label: string, options?: PercentileOptions): Percentiles {
  return defaultPanel().percentiles(label, options);
}

/** @internal For tests: forget the default panel so the next declaration starts a new one. */
export function resetDefaultPanel(): void {
  shared?.close();
  shared = undefined;
  pending = undefined;
}
