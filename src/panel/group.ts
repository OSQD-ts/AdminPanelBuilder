/** The handle `panel.group(name)` returns. Apart from core.ts so the panel's file is the panel. */
import type { PanelAction } from "../actions.js";
import type { Counter, CounterOptions, PercentileOptions, Percentiles, RateOptions } from "../blocks/counter.js";
import type { PanelFeed } from "../blocks/feed.js";
import type { PanelTable } from "../blocks/table.js";
import type { AdminPanel } from "../core.js";
import type { ActionContext, ActionOptions, BindOptions, FeedOptions, GroupOptions, ModifiableOptions, ProfileOptions, SharedChartOptions, TableOptions, ViewableOptions } from "../types.js";
import type { PanelValue } from "../values/handle.js";

/**
 * The handle `panel.group(name)` returns: every declaration, made in this group, and the way to move
 * things into it after they were declared. Each method is the panel's own with `group` filled in,
 * so a group's declarations never repeat its name.
 */
export class PanelGroup {
  constructor(
    private readonly panel: AdminPanel,
    readonly name: string,
  ) {}

  /** Moves values and actions into this group. */
  add(...items: Array<PanelValue<unknown> | PanelAction>): this {
    for (const item of items) this.panel.move(item, this.name);
    return this;
  }

  configure(options: GroupOptions): this {
    this.panel.group(this.name, options);
    return this;
  }

  /** Declares a value in this group. */
  viewable<T>(initial: T | (() => T), options?: ViewableOptions | string): PanelValue<T> {
    return this.panel.viewable(initial, { ...(typeof options === "string" ? { label: options } : options), group: this.name });
  }

  modifiable<T>(initial: T, options?: ModifiableOptions<T> | string): PanelValue<T> {
    return this.panel.modifiable(initial, { ...(typeof options === "string" ? { label: options } : options), group: this.name } as ModifiableOptions<T>);
  }

  action(label: string, run: (context: ActionContext) => unknown, options: ActionOptions = {}): PanelAction {
    return this.panel.action(label, run, { ...options, group: this.name });
  }

  table<Row = Record<string, unknown>>(label: string, options: TableOptions<Row>): PanelTable<Row> {
    return this.panel.table(label, { ...options, group: this.name });
  }

  feed(label: string, options: FeedOptions = {}): PanelFeed {
    return this.panel.feed(label, { ...options, group: this.name });
  }

  bind<O extends object, K extends keyof O & (string | number)>(target: O, key: K, options?: BindOptions<O[K]> | string): PanelValue<O[K]> {
    return this.panel.bind(target, key, { ...(typeof options === "string" ? { label: options } : options), group: this.name } as BindOptions<O[K]>);
  }

  counter(label: string, options: CounterOptions = {}): Counter {
    return this.panel.counter(label, { ...options, group: this.name });
  }

  rate(label: string, read: () => number, options: RateOptions = {}): PanelValue<number> {
    return this.panel.rate(label, read, { ...options, group: this.name });
  }

  percentiles(label: string, options: PercentileOptions = {}): Percentiles {
    return this.panel.percentiles(label, { ...options, group: this.name });
  }

  /** Several values set at once, drawn in this group whichever groups the values are in. */
  profile(label: string, settings: ReadonlyArray<readonly [PanelValue<unknown>, unknown]>, options: ProfileOptions = {}): string {
    return this.panel.profile(label, settings, { ...options, group: this.name });
  }

  /** A chart of this group's own, drawing several values together. */
  chart(options: Omit<SharedChartOptions, "group">): string {
    return this.panel.chart({ ...options, group: this.name });
  }
}
