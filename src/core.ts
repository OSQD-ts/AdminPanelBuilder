/**
 * The panel: a registry of values, groups, charts and actions, and the two questions every
 * front end asks of it — what is there (`schema`) and what is it now (`state`).
 *
 * The panel never touches a request or a response. It takes facts (an edit with who made it,
 * an action with who ran it, which groups a listener shows) and returns answers; the router in
 * `server/` turns HTTP into those facts and the adapters turn the router's answers back into
 * HTTP for Node, for Fetch, or for nothing at all when the panel is rendered to HTML. That is
 * what lets one panel be mounted on a path, served on a port and embedded in a page at the same
 * time, with the same rules in all three.
 *
 * This file coordinates; the parts live beside it in `panel/`: charts and their histories,
 * proposals waiting for approval, the schedule of timed and scheduled changes, profiles, alerts,
 * and the channel that carries changes between replicas.
 *
 * What is swappable and what is not: the title, theme, colour scheme, poll interval and every
 * group's presentation are read on every request, so `configure()` takes effect on the next
 * poll. The clock, the store and the sync channel are fixed at construction, because replacing
 * one would drop what was read or written through it.
 */
import { DEFAULT_ACTION_TIMEOUT_MS, PanelAction } from "./actions.js";
import { createFetchHandler, type FetchServeOptions, type PanelFetchHandler } from "./adapters/fetch.js";
import { listenPanel, type PanelServer } from "./adapters/listen.js";
import { createPanelHandler, type PanelRequestHandler } from "./adapters/node.js";
import { type Counter, type CounterOptions, declareCounter, declarePercentiles, type PercentileOptions, type Percentiles, type RateOptions, rateOf } from "./blocks/counter.js";
import { MAX_FEED_CAPACITY, PanelFeed } from "./blocks/feed.js";
import { checkTableOptions, MAX_SEARCH_LENGTH, PanelTable } from "./blocks/table.js";
import { ChangeLog, type ChangeLogStore, MAX_CHANGES } from "./change-log.js";
import { AdminPanelConfigError, ValueError } from "./errors.js";
import { ENGLISH, format, LOCALES, type MessageKey } from "./i18n/messages.js";
import { refusal } from "./i18n/refuse.js";
import { withDeadline, } from "./internal/async.js";
import { type Clock, systemClock } from "./internal/clock.js";
import { Emitter } from "./internal/emitter.js";
import { checkId, slug } from "./internal/ids.js";
import { rejectUnknown } from "./internal/options.js";
import { checkAlert, AlertMonitor } from "./panel/alerts.js";
import { APPROVAL_TTL_MS, Approvals, MAX_PENDING } from "./panel/approvals.js";
import { ChartRegistry, MAX_SERIES } from "./panel/charts.js";
import { checkCardSize, checkGroupName, checkPoll, checkScheme, checkSpan, checkTitle, defaultOnError, describe, looksSecret, message, MIN_POLL_INTERVAL_MS, readSafely, sameJson } from "./panel/checks.js";
import { PanelGroup } from "./panel/group.js";
import { Replication } from "./panel/replication.js";
import { diffSettings, exportSettings } from "./panel/settings.js";
import { actionSchema, checkCondition, checkReason, checkReasonOption, conditionOf, decorateWire, MAX_REASON_LENGTH, scheduledShape, valueSchema } from "./panel/wire.js";
import { checkProfileSettings, profileActive, type ProfileEntry, profileSchema, profileWritable } from "./panel/profiles.js";
import { checkRepeat, describeRepeat, nextRun, type RepeatRule } from "./panel/recurrence.js";
import { ChangeSchedule, MAX_SCHEDULE_AHEAD_MS, MAX_SCHEDULED, type NewEntry, SCHEDULE_KEY, type ScheduleEntry } from "./panel/schedule.js";
import { type ActionOutcome, anyAllowed, canEdit, canRun, type EditOutcome, type PanelScope, READ_ONLY_SCOPE, visible } from "./panel/scope.js";
import { checkGrid, DEFAULT_GRID, MAX_LAYOUT_BYTES, readLayout } from "./panel/layout.js";
import type { ChangeMessage, LayoutMessage, PanelSync } from "./panel/sync.js";
import { type HtmlOptions, renderFragment } from "./render/html.js";
import type { ListenOptions, ServeOptions } from "./server/types.js";
import type { ValueStore } from "./stores/types.js";
import { BUILT_IN_THEMES, resolveTheme } from "./themes/index.js";
import type { Theme } from "./themes/types.js";
import type {
  ActionContext,
  ActionOptions,
  Alert,
  BindOptions,
  CardSize,
  ChangeRecord,
  ChartOptions,
  FeedOptions,
  FeedSchema,
  GroupLayout,
  GroupOptions,
  GroupSchema,
  GridShape,
  ItemSchema,
  JsonValue,
  ModifiableOptions,
  Notice,
  PanelLayout,
  PanelSchema,
  PanelState,
  PendingChange,
  ProfileOptions,
  ScheduledChange,
  SettingDiff,
  SharedChartOptions,
  Span,
  TableOptions,
  TableQuery,
  TableRowsAnswer,
  ViewableOptions,
  WireValue,
} from "./types.js";
import { PanelValue, type ValueDefinition, type ValueOwner, type ValueSource } from "./values/handle.js";
import { checkInput, type ResolvedField, resolveInput } from "./values/input.js";
import { encodeForWire, inferKind, plottable, resolveConstraints, statelessPattern, toJson } from "./values/kinds.js";
import { checkStatusRule, statusOf } from "./values/status.js";
import { VERSION } from "./version.js";

export { canEdit, canRun, READ_ONLY_SCOPE, narrowScope } from "./panel/scope.js";
export { PanelGroup } from "./panel/group.js";
export { MAX_REASON_LENGTH };
export type { ActionOutcome, EditOutcome, Grants, PanelScope } from "./panel/scope.js";
export { APPROVAL_TTL_MS, MAX_CHANGES, MAX_PENDING, MAX_SCHEDULE_AHEAD_MS, MAX_SCHEDULED, MAX_SERIES, MIN_POLL_INTERVAL_MS };

export interface AdminPanelOptions {
  /** The heading, and the page title. Default `"Admin panel"`. */
  title?: string | undefined;
  /** Which process this is, shown beside the title: a hostname, a replica name. One panel reports one process. */
  instance?: string | undefined;
  /** A theme from `defineTheme`, or `"material"` (the default), `"apple"`, `"osqd"`, `"fluent"`, `"carbon"` or `"high-contrast"`. */
  theme?: Theme | string | undefined;
  /**
   * Themes a viewer may choose among in the page's Settings, beside the panel's own. Every built-in
   * theme is offered unless this says otherwise; themes from `defineTheme` given here are added to
   * the list (one named like a built-in replaces it). `false` keeps every viewer on `theme`.
   */
  themes?: ReadonlyArray<Theme | string> | false | undefined;
  /**
   * The grid of cells every group is laid out in: `columns` at full width (default 12) and
   * `rowHeight`, the height of a row in pixels (default 72). A group may have its own.
   */
  grid?: Partial<GridShape> | undefined;
  /** `"auto"` follows the viewer's system. Default `"auto"`. */
  colorScheme?: "auto" | "light" | "dark" | undefined;
  /** How often the page asks for new values. Default 1000, at least `MIN_POLL_INTERVAL_MS`. */
  pollIntervalMs?: number | undefined;
  /** The group of anything declared without one. Default `"General"`. */
  defaultGroup?: string | undefined;
  /** Where `persist: true` values are remembered. Without one, `persist` is refused. */
  store?: ValueStore | undefined;
  clock?: Clock | undefined;
  /**
   * Where failures that must not reach the application go: a throwing getter, a change
   * listener that rejected, a store that could not be written. Default: `console.error`.
   */
  onError?: ((error: unknown, source: string) => void) | undefined;
  /** Where every change record is kept, across restarts. Without one, the page shows the last `MAX_CHANGES` since start. */
  changeLog?: ChangeLogStore | undefined;
  /** The language of the page's own words: `"en"` (the default), `"pl"` or `"de"`. */
  locale?: string | undefined;
  /** Replacements for any of the page's own words, by key. An unknown key is refused. */
  messages?: Partial<Record<MessageKey, string>> | undefined;
  /** Carries operator changes to every replica of this application. See `redisSync`. */
  sync?: PanelSync | undefined;
  /** Keep chart histories in the store across restarts, saved every `everyMs` (default a minute) and on `close()`. */
  keepHistory?: boolean | { everyMs?: number | undefined } | undefined;
}

/** What a panel reports to subscribers. */
export interface AdminPanelEvents extends Record<string, unknown> {
  /** An operator edited a value, ran an action, applied a profile or approved a change; or a timed or scheduled change fired. Never fired for writes from code. */
  change: ChangeRecord;
  notice: Notice;
  error: { error: unknown; source: string };
  /** A value's status reached its alert level and held. */
  alert: Alert;
}

/** Most distinct notices kept. The same condition noticed again updates its notice rather than adding one. */
export const MAX_NOTICES = 100;
/** The longest a timed change may wait to revert: a week. Longer is a setting, not a temporary one. */
export const MAX_REVERT_MS = 7 * 24 * 3_600_000;

const COMMON_KEYS = ["id", "label", "description", "group", "order", "span", "size"];
const VIEWABLE_KEYS = [...COMMON_KEYS, "kind", "unit", "format", "decimals", "chart", "sensitive", "min", "max", "status", "alert", "visibleWhen", "disabledWhen", "timeline"];
const MODIFIABLE_KEYS = [...VIEWABLE_KEYS, "step", "integer", "options", "maxLength", "pattern", "multiline", "validate", "onChange", "persist", "confirm", "approval", "timed", "validateAsync", "validateTimeoutMs", "reason"];

/** How an operator's change is made: now, for a while, at a time, by a rule, and why. */
export interface ChangeOptions {
  revertAfterMs?: number | undefined;
  at?: number | undefined;
  repeat?: RepeatRule | undefined;
  reason?: string | undefined;
}

/** Every group and every control: what the panel uses for changes it makes itself (a schedule firing). */
const INTERNAL: PanelScope = { groups: undefined, edit: true, actions: true, restrictions: [] };
const BIND_KEYS = [...MODIFIABLE_KEYS, "editable"];
const SHARED_CHART_KEYS = ["kind", "over", "title", "group", "series", "description", "order", "span", "size", "points", "sampleEveryMs", "min", "max", "stacked", "lines", "annotate", "bins"];
const PANEL_KEYS = ["title", "instance", "theme", "themes", "grid", "colorScheme", "pollIntervalMs", "defaultGroup", "store", "clock", "onError", "changeLog", "locale", "messages", "sync", "keepHistory"];
const SWAPPABLE_KEYS = ["title", "instance", "theme", "colorScheme", "pollIntervalMs"];
const HISTORY_KEY = "apb.history";
/** What saving a layout answers: done, or refused with a sentence. */
export type LayoutOutcome = { ok: true } | Extract<EditOutcome, { ok: false }>;

/** Store key of the layout saved for everybody. Ids starting "apb." are refused for values, so it cannot collide. */
export const LAYOUT_KEY = "apb.layout";
const THEME_NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** Themes to offer beside the panel's own, resolved and checked, or false for none. */
function checkThemes(themes: AdminPanelOptions["themes"]): Theme[] | false {
  if (themes === undefined) return [];
  if (themes === false) return false;
  if (!Array.isArray(themes)) throw new AdminPanelConfigError("createAdminPanel(): themes is a list of themes (from defineTheme, or built-in names), or false");
  return themes.map((theme) => {
    const resolved = resolveTheme(theme);
    // The name becomes an attribute value the stylesheet selects on.
    if (!THEME_NAME.test(resolved.name)) throw new AdminPanelConfigError(`createAdminPanel(): the theme "${resolved.name}" needs a name of lower-case letters, digits and hyphens to be offered`);
    return resolved;
  });
}
/** Timeline entries a value keeps by default: enough to see what it has been lately, small enough to send. */
const DEFAULT_TIMELINE = 20;
/**
 * How long a live value's reading is shared between requests. Twenty viewers polling a getter once a
 * second would otherwise call it twenty times a second; a quarter second is finer than any page shows.
 */
const LIVE_READ_MS = 250;

interface GroupEntry {
  name: string;
  id: string;
  options: GroupOptions;
  sequence: number;
}

interface Ticker {
  everyMs: number;
  nextDue: number;
  run: (now: number) => void;
}

export class AdminPanel implements ValueOwner {
  private title: string;
  private instance: string | undefined;
  private theme: Theme;
  /** Themes offered beside the panel's own; false offers none. */
  private readonly extraThemes: Theme[] | false;
  private readonly grid: GridShape;
  /** The layout saved for everybody from the page, over the sizes and order in code. */
  private sharedLayout: PanelLayout | undefined;
  private colorScheme: "auto" | "light" | "dark";
  private pollIntervalMs: number;
  private readonly defaultGroup: string;
  private readonly clock: Clock;
  private readonly store: ValueStore | undefined;
  private readonly sync: PanelSync | undefined;
  private readonly onError: (error: unknown, source: string) => void;
  /** Tells this process's changes apart from those that arrive from other replicas. */
  readonly origin: string;

  private readonly values = new Map<string, PanelValue<unknown>>();
  private readonly actions = new Map<string, PanelAction>();
  private readonly groups = new Map<string, GroupEntry>();
  private readonly charts: ChartRegistry;
  private readonly log: ChangeLog;
  private readonly noticeLog = new Map<string, Notice>();
  private readonly feeds = new Map<string, PanelFeed>();
  private readonly tables = new Map<string, PanelTable<never>>();
  private readonly profiles = new Map<string, ProfileEntry>();
  private readonly inputs = new Map<string, ResolvedField[]>();
  private readonly tickers: Ticker[] = [];
  private readonly approvals: Approvals;
  private readonly schedule: ChangeSchedule;
  private readonly replicas: Replication;
  private readonly alerts: AlertMonitor;
  private readonly timelines = new Map<string, Array<{ at: number; value: JsonValue; by?: string }>>();
  private readonly liveCache = new Map<string, { at: number; wire: WireValue }>();
  private readonly locale: string;
  private readonly messages: Record<string, string> | undefined;
  private readonly counterIds = new Set<string>();
  private readonly totals = new Map<string, number>();
  private readonly events: Emitter<AdminPanelEvents>;
  private readonly failedGetters = new Set<string>();
  private readonly keepHistoryMs: number | undefined;
  private feedSequence = 0;
  private sequence = 0;
  private unnamed = 0;
  private version = 0;
  private structure = 1;
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  private unsubscribe: (() => void) | undefined;
  /** Stored choices once loaded, so a value declared after the load is restored as it is declared. */
  private stored: Record<string, JsonValue> | undefined;

  /** Settles once stored choices, the change log and saved histories are loaded. Never rejects: a failed load is a notice. */
  readonly ready: Promise<void>;

  constructor(options: AdminPanelOptions = {}) {
    rejectUnknown(options, PANEL_KEYS, "createAdminPanel()");
    this.title = checkTitle(options.title ?? "Admin panel");
    this.instance = options.instance;
    this.theme = resolveTheme(options.theme);
    this.extraThemes = checkThemes(options.themes);
    const grid = options.grid === undefined ? {} : checkGrid(options.grid);
    if (typeof grid === "string") throw new AdminPanelConfigError(`createAdminPanel(): ${grid}`);
    this.grid = { ...DEFAULT_GRID, ...grid };
    this.colorScheme = checkScheme(options.colorScheme ?? "auto");
    this.pollIntervalMs = checkPoll(options.pollIntervalMs ?? 1000);
    this.defaultGroup = checkGroupName(options.defaultGroup ?? "General");
    this.clock = options.clock ?? systemClock;
    this.store = options.store;
    this.sync = options.sync;
    this.onError = options.onError ?? defaultOnError;
    this.origin = `${options.instance ?? "panel"}-${Math.random().toString(36).slice(2, 10)}`;
    this.events = new Emitter((error, event) => this.onError(error, `a "${event}" listener on the panel`));
    this.locale = options.locale ?? "en";
    if (this.locale !== "auto" && LOCALES[this.locale] === undefined) throw new AdminPanelConfigError(`there is no "${this.locale}" translation of the page (there are ${Object.keys(LOCALES).join(", ")}); pass messages to supply your own words`);
    if (options.messages !== undefined) {
      for (const [key, text] of Object.entries(options.messages)) {
        if (!Object.hasOwn(ENGLISH, key)) throw new AdminPanelConfigError(`messages has a key "${key}" the page never shows`);
        if (typeof text !== "string" || text === "") throw new AdminPanelConfigError(`messages.${key} must be non-empty text`);
      }
      this.messages = { ...options.messages } as Record<string, string>;
    } else this.messages = undefined;
    if (options.keepHistory !== undefined && options.keepHistory !== false) {
      if (this.store === undefined) throw new AdminPanelConfigError("keepHistory needs a store to keep the history in: pass { store: fileStore(path) }");
      const everyMs = options.keepHistory === true ? 60_000 : (options.keepHistory.everyMs ?? 60_000);
      if (!Number.isFinite(everyMs) || everyMs < 5000) throw new AdminPanelConfigError(`keepHistory.everyMs is ${everyMs}; saving more often than every five seconds writes more than a chart gains`);
      this.keepHistoryMs = everyMs;
    } else this.keepHistoryMs = undefined;

    this.charts = new ChartRegistry({
      now: () => this.clock.now(),
      read: (value) => this.read(value),
      assertOwn: (value, where) => this.assertOwn(value, where),
      structureChanged: () => this.structureChanged(),
      needTimer: () => this.startTimer(),
      nextSequence: () => this.sequence++,
    });
    this.approvals = new Approvals(() => this.clock.now(), `${this.origin}:p`);
    this.schedule = new ChangeSchedule({
      now: () => this.clock.now(),
      durable: (entry) => (entry.target === "value" ? this.values.get(entry.targetId)?.definition.persist === true : this.store !== undefined && this.profiles.has(entry.targetId)),
      fire: (entry, late) => this.replicas.fireOnce(entry, late),
      save: (stored) => this.saveToStore(SCHEDULE_KEY, stored, "the schedule of timed changes"),
      changed: (entry, removed) => this.replicas.scheduled(entry, removed),
      origin: this.origin,
    });
    this.alerts = new AlertMonitor(
      (value) => this.read(value),
      (alert) => {
        // An alert's sentence is the alert's, and reads the same here, in the log and in a webhook.
        this.notice("warning", `alert-${alert.target}`, { text: alert.message });
        this.events.emit("alert", alert);
      },
    );
    this.log = new ChangeLog(
      options.changeLog,
      (record) => {
        const key = `${record.kind}|${record.ok}`;
        this.totals.set(key, (this.totals.get(key) ?? 0) + 1);
        this.events.emit("change", record);
      },
      (error) => {
        this.notice("warning", "change-log-append", "noticeChangeLogAppend", { reason: message(error) });
        this.onError(error, "writing the change log");
      },
    );
    this.replicas = new Replication(this.sync, {
      origin: this.origin,
      approvals: this.approvals,
      schedule: this.schedule,
      knows: (kind, id) => (kind === "action" ? this.actions.has(id) : kind === "profile" ? this.profiles.has(id) : this.values.has(id)),
      applyChange: (change) => this.applyChange(change),
      applyLayout: (change) => this.applyLayout(change),
      bump: (valueId) => {
        this.version += 1;
        const value = valueId === undefined ? undefined : this.values.get(valueId);
        if (value !== undefined) value.version = this.version;
      },
      fire: (entry, late) => this.fireScheduled(entry, late),
      notice: (level, id, key, params) => this.notice(level, id, key, params),
      clearNotice: (id) => this.noticeLog.delete(id),
      onError: (error, source) => this.onError(error, source),
    });
    if (this.sync !== undefined) this.unsubscribe = this.sync.subscribe((incoming) => this.replicas.receive(incoming));
    if (this.keepHistoryMs !== undefined) this.every(this.keepHistoryMs, () => this.saveHistory());
    const restoring: Promise<void>[] = [];
    if (this.store !== undefined) restoring.push(this.restore(this.store));
    if (options.changeLog !== undefined) {
      restoring.push(
        this.log.restore().catch((error: unknown) => {
          this.notice("warning", "change-log-load", "noticeChangeLogLoad", { reason: message(error) });
          this.onError(error, "loading the change log");
        }),
      );
    }
    this.ready = Promise.all(restoring).then(() => undefined);
  }

  // -------------------------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------------------------

  /**
   * Shows a value. Pass the value itself, or a function the panel calls whenever somebody looks
   * (`viewable(() => queue.length)`), which is the way to show something the application
   * already keeps elsewhere.
   */
  viewable<T>(initial: T | (() => T), options?: ViewableOptions | string): PanelValue<T> {
    const resolved = typeof options === "string" ? { label: options } : (options ?? {});
    rejectUnknown(resolved, VIEWABLE_KEYS, `viewable(${describe(resolved)})`);
    const source: ValueSource<T> = typeof initial === "function" ? { kind: "getter", read: initial as () => T } : { kind: "cell", current: initial };
    return this.declare(source, resolved, false);
  }

  /** Shows a value an operator may change, within the declared constraints. */
  modifiable<T>(initial: T, options?: ModifiableOptions<T> | string): PanelValue<T> {
    const resolved = typeof options === "string" ? { label: options } : (options ?? {});
    rejectUnknown(resolved, MODIFIABLE_KEYS, `modifiable(${describe(resolved)})`);
    if (typeof initial === "function") throw new AdminPanelConfigError(`modifiable(${describe(resolved)}) was given a function, which is read from rather than written to; bind() a property to make something the application computes editable`);
    return this.declare({ kind: "cell", current: initial }, resolved as ModifiableOptions<unknown>, true);
  }

  /**
   * Shows a property of an object the application already has, read and written through that
   * object: `bind(config, "maxPlayers", { editable: true, min: 2 })`. The object stays the
   * source of truth, so code that reads `config.maxPlayers` sees an operator's change at once.
   */
  bind<O extends object, K extends keyof O & (string | number)>(target: O, key: K, options?: BindOptions<O[K]> | string): PanelValue<O[K]> {
    const resolved = typeof options === "string" ? { label: options } : (options ?? {});
    rejectUnknown(resolved, BIND_KEYS, `bind(${describe({ label: String(key), ...resolved })})`);
    if (target === null || typeof target !== "object") throw new AdminPanelConfigError(`bind() needs an object to read "${String(key)}" from`);
    const withLabel = { label: String(key), ...resolved } as BindOptions<unknown>;
    return this.declare({ kind: "property", target, key }, withLabel, resolved.editable === true);
  }

  /** A button that runs `run` in the application. Usable only on a listener that grants `controls.actions`. */
  action(label: string, run: (context: ActionContext) => unknown, options: ActionOptions = {}): PanelAction {
    if (typeof run !== "function") throw new AdminPanelConfigError(`action "${label}" needs a function to run`);
    rejectUnknown(options, ["id", "label", "description", "group", "order", "span", "size", "confirm", "destructive", "timeoutMs", "input", "visibleWhen", "disabledWhen", "approval", "reason"], `action("${label}")`);
    if (options.confirm !== undefined && typeof options.confirm !== "boolean" && options.confirm !== "type") throw new AdminPanelConfigError(`action "${label}" has confirm ${JSON.stringify(options.confirm)}; it is true, false or "type"`);
    checkReasonOption(label, options.reason);
    const id = checkId(options.id ?? (slug(label) || `action-${this.actions.size + 1}`), `action "${label}"`);
    if (this.actions.has(id)) throw new AdminPanelConfigError(`two actions have the id "${id}": the second would silently replace the first on the page`);
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new AdminPanelConfigError(`action "${label}" has a timeout of ${timeoutMs}; it must be a positive number of milliseconds`);
    checkCondition(label, "visibleWhen", options.visibleWhen);
    checkCondition(label, "disabledWhen", options.disabledWhen);
    const group = this.ensureGroup(options.group ?? this.defaultGroup);
    const action = new PanelAction(
      {
        id,
        label: checkTitle(options.label ?? label),
        description: options.description,
        confirm: options.confirm === true || options.confirm === "type" || options.destructive === true,
        destructive: options.destructive === true,
        timeoutMs,
        order: options.order ?? 0,
        sequence: this.sequence++,
        span: checkSpan(label, options.span),
        size: checkCardSize(label, options.size),
        visibleWhen: options.visibleWhen,
        disabledWhen: options.disabledWhen,
        typeToConfirm: options.confirm === "type",
        approval: options.approval === true,
        reasonRequired: options.reason === "required" || options.approval === true,
      },
      run,
      group,
    );
    if (options.input !== undefined) this.inputs.set(id, resolveInput(label, options.input));
    this.actions.set(id, action);
    this.structureChanged();
    return action;
  }

  /**
   * A table of rows, paged, sorted and searched: the games in progress, the queued mail. See
   * `TableOptions` for the two ways to hand it rows.
   */
  table<Row = Record<string, unknown>>(label: string, options: TableOptions<Row>): PanelTable<Row> {
    checkTableOptions(label, options);
    const id = checkId(options.id ?? (slug(label) || `table-${this.tables.size + 1}`), `table "${label}"`);
    if (this.tables.has(id)) throw new AdminPanelConfigError(`two tables have the id "${id}"`);
    checkSpan(label, options.span);
    checkCardSize(label, options.size);
    const table = new PanelTable<Row>(id, checkTitle(options.label ?? label), options, this.ensureGroup(options.group ?? this.defaultGroup), this.sequence++);
    this.tables.set(id, table as unknown as PanelTable<never>);
    this.structureChanged();
    return table;
  }

  /** A bounded list of events, newest first. `feed.push("text")` or `feed.push({ fields }, "warn")`. */
  feed(label: string, options: FeedOptions = {}): PanelFeed {
    rejectUnknown(options, ["id", "label", "description", "group", "order", "span", "size", "capacity", "perSecond"], `feed("${label}")`);
    const id = checkId(options.id ?? (slug(label) || `feed-${this.feeds.size + 1}`), `feed "${label}"`);
    if (this.feeds.has(id)) throw new AdminPanelConfigError(`two feeds have the id "${id}"`);
    const capacity = options.capacity ?? 200;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_FEED_CAPACITY) throw new AdminPanelConfigError(`feed "${label}" keeps ${capacity} entries; it is 1 to ${MAX_FEED_CAPACITY}`);
    const perSecond = options.perSecond ?? 50;
    if (!Number.isFinite(perSecond) || perSecond < 1) throw new AdminPanelConfigError(`feed "${label}" accepts ${perSecond} entries a second; it must accept at least one`);
    const feed = new PanelFeed(
      { id, label: checkTitle(options.label ?? label), description: options.description, capacity, perSecond, order: options.order ?? 0, sequence: this.sequence++, span: checkSpan(label, options.span), size: checkCardSize(label, options.size) },
      this.ensureGroup(options.group ?? this.defaultGroup),
      this.clock,
      () => ++this.feedSequence,
    );
    this.feeds.set(id, feed);
    this.structureChanged();
    return feed;
  }

  /**
   * Several modifiable values set at once: "maintenance", "tournament mode". Applied whole or not at
   * all, with one change record, and only on a listener that may edit every value it sets.
   */
  profile(label: string, settings: ReadonlyArray<readonly [PanelValue<unknown>, unknown]>, options: ProfileOptions = {}): string {
    rejectUnknown(options, ["id", "label", "description", "group", "order", "span", "size", "confirm", "approval", "reason"], `profile("${label}")`);
    checkReasonOption(label, options.reason);
    const id = checkId(options.id ?? (slug(label) || `profile-${this.profiles.size + 1}`), `profile "${label}"`);
    if (this.profiles.has(id)) throw new AdminPanelConfigError(`two profiles have the id "${id}"`);
    checkProfileSettings(label, settings, (value, where) => this.assertOwn(value, where));
    this.profiles.set(id, {
      id,
      label: checkTitle(options.label ?? label),
      description: options.description,
      settings: settings.map(([value, to]) => [value, to]),
      confirm: options.confirm !== false,
      group: this.ensureGroup(options.group ?? (settings[0]?.[0] as PanelValue<unknown>).group),
      order: options.order ?? 0,
      sequence: this.sequence++,
      span: checkSpan(label, options.span),
      size: checkCardSize(label, options.size),
      approval: options.approval === true,
      reasonRequired: options.reason === "required" || options.approval === true,
    });
    if (this.stored !== undefined) this.schedule.restore(this.stored[SCHEDULE_KEY], "profile", id);
    this.structureChanged();
    return id;
  }

  /**
   * A group, created on first mention. Configure it, or move values and actions into it after
   * the fact: `panel.group("Matchmaking", { order: 1 }).add(queueLength, maxWait)`.
   */
  group(name: string, options?: GroupOptions): PanelGroup {
    const entry = this.groups.get(this.ensureGroup(name)) as GroupEntry;
    rejectUnknown(options, ["title", "description", "order", "layout", "grid"], `group("${name}")`);
    if (options?.layout !== undefined && options.layout !== "grid" && options.layout !== "list") throw new AdminPanelConfigError(`group "${name}" has a layout of ${JSON.stringify(options.layout)}; it is "grid" or "list"`);
    if (options?.grid !== undefined) {
      const grid = checkGrid(options.grid);
      if (typeof grid === "string") throw new AdminPanelConfigError(`group "${name}": ${grid}`);
    }
    if (options !== undefined) {
      entry.options = { ...entry.options, ...options };
      this.structureChanged();
    }
    return new PanelGroup(this, entry.name);
  }

  /** A chart of the group's own, drawing several values together. */
  chart(options: SharedChartOptions): string {
    rejectUnknown(options, SHARED_CHART_KEYS, `chart("${options.title}")`);
    if (!Array.isArray(options.series) || options.series.length === 0) throw new AdminPanelConfigError(`chart "${options.title}" has no series to draw`);
    for (const value of options.series) this.assertOwn(value, `chart "${options.title}"`);
    const first = options.series[0] as PanelValue<unknown>;
    const group = this.ensureGroup(options.group ?? first.group);
    const entry = this.charts.build(options.title, { ...options, in: undefined } as ChartOptions & { span?: Span | undefined; size?: CardSize | undefined; order?: number | undefined }, options.series, "group", group, options.description);
    return entry.id;
  }

  /** A count that only goes up, with its rate over a sliding window charted beside it. */
  counter(label: string, options?: CounterOptions): Counter {
    return declareCounter(this, label, options);
  }

  /** The rate of a total the application already keeps. */
  rate(label: string, read: () => number, options?: RateOptions): PanelValue<number> {
    return rateOf(this, label, read, options);
  }

  /** Percentiles of recent observations, charted together. */
  percentiles(label: string, options?: PercentileOptions): Percentiles {
    return declarePercentiles(this, label, options);
  }

  /** Moves a value or an action into a group. */
  move(item: PanelValue<unknown> | PanelAction, group: string): void {
    if (item instanceof PanelAction) {
      if (this.actions.get(item.id) !== item) throw new AdminPanelConfigError(`action "${item.label}" belongs to another panel`);
      item.group = this.ensureGroup(group);
      this.structureChanged();
      return;
    }
    this.moveValue(item, group);
  }

  /** Changes the presentation. Everything here is read on every request, so it applies on the next poll. */
  configure(options: Pick<AdminPanelOptions, "title" | "instance" | "theme" | "colorScheme" | "pollIntervalMs">): void {
    rejectUnknown(options, SWAPPABLE_KEYS, "panel.configure()");
    // Validated as a whole before anything is applied: half a configuration is worse than none.
    const title = options.title === undefined ? this.title : checkTitle(options.title);
    const theme = options.theme === undefined ? this.theme : resolveTheme(options.theme);
    const scheme = options.colorScheme === undefined ? this.colorScheme : checkScheme(options.colorScheme);
    const poll = options.pollIntervalMs === undefined ? this.pollIntervalMs : checkPoll(options.pollIntervalMs);
    this.title = title;
    this.theme = theme;
    this.colorScheme = scheme;
    this.pollIntervalMs = poll;
    if ("instance" in options) this.instance = options.instance;
    this.structureChanged();
  }

  /** A declared value by id. */
  get(id: string): PanelValue<unknown> | undefined {
    return this.values.get(id);
  }

  /** The theme in use. */
  currentTheme(): Theme {
    return this.theme;
  }

  /** The themes a viewer may choose among, the panel's first. */
  offeredThemes(): Theme[] {
    if (this.extraThemes === false) return [this.theme];
    const byName = new Map<string, Theme>([[this.theme.name, this.theme]]);
    for (const theme of [...this.extraThemes, ...Object.values(BUILT_IN_THEMES)]) if (!byName.has(theme.name)) byName.set(theme.name, theme);
    return [...byName.values()];
  }

  /** The layout saved for everybody, or undefined when the page follows the code. */
  layout(): PanelLayout | undefined {
    return this.sharedLayout === undefined ? undefined : structuredClone(this.sharedLayout);
  }

  /**
   * Saves the layout every viewer gets, or with `null` goes back to the sizes and order in code.
   * Only groups `scope` may edit can change; the others keep what they had, so an operator who
   * sees two groups saves those two. Recorded in the change log and carried to replicas.
   */
  saveLayout(layout: unknown, by: string, scope: PanelScope = INTERNAL, options: { reason?: string | undefined } = {}): LayoutOutcome {
    const why = checkReason(options.reason, false, "the layout");
    if (!why.ok) return why;
    let next: PanelLayout = {};
    if (layout !== null) {
      if (layout === undefined || typeof layout !== "object" || Array.isArray(layout)) return { ok: false, reason: "invalid", ...refusal("refuseLayoutShape") };
      if (JSON.stringify(layout).length > MAX_LAYOUT_BYTES) return { ok: false, reason: "invalid", ...refusal("refuseLayoutTooLarge", { kb: Math.round(MAX_LAYOUT_BYTES / 1024) }) };
      next = readLayout(layout) ?? {};
    }
    const before = this.sharedLayout ?? {};
    const byId = new Map([...this.groups.values()].map((group) => [group.id, group]));
    const after: PanelLayout = {};
    for (const id of new Set([...Object.keys(before), ...Object.keys(next)])) {
      const group = byId.get(id);
      const seen = group !== undefined && visible(scope, group.name);
      // A group this operator cannot see keeps what it had: their layout never mentions it.
      if (!seen) {
        if (before[id] !== undefined) after[id] = before[id] as GroupLayout;
        else if (group === undefined) return { ok: false, reason: "invalid", ...refusal("refuseLayoutGroup", { group: id }) };
        continue;
      }
      if (!sameJson(before[id] ?? null, next[id] ?? null) && !canEdit(scope, group.name)) return { ok: false, reason: "not-allowed", ...refusal("refuseLayoutNotAllowed", { group: group.options.title ?? group.name }) };
      if (next[id] !== undefined) after[id] = next[id] as GroupLayout;
    }
    const kept = Object.keys(after).length === 0 ? undefined : after;
    this.sharedLayout = kept;
    this.saveToStore(LAYOUT_KEY, (kept ?? null) as unknown as JsonValue, "the layout saved for everybody");
    const record = this.log.record({ kind: "layout", target: "layout", label: "Layout", by, at: this.clock.now(), ok: true, origin: this.origin, outcome: kept === undefined ? "Put back the layout in code." : `Arranged ${Object.keys(kept).length === 1 ? "one group" : `${Object.keys(kept).length} groups`} for everybody.`, ...(why.reason === undefined ? {} : { reason: why.reason }) });
    this.replicas.layout((kept ?? null) as unknown as JsonValue, record);
    this.structureChanged();
    this.version += 1;
    return { ok: true };
  }

  /** Recent operator changes, oldest first, each saying whether it can still be undone. */
  changes(): ChangeRecord[] {
    return this.log.list().map((record) => ({ ...record, revertible: this.revertible(record) }));
  }

  /** Changes waiting for a second operator. */
  pending(): PendingChange[] {
    return this.approvals.list();
  }

  /** Current notices, oldest first. */
  notices(): Notice[] {
    return [...this.noticeLog.values()];
  }

  /** Subscribes to operator changes, notices, alerts and isolated errors. Returns the way to stop. */
  on<K extends keyof AdminPanelEvents & string>(event: K, listener: (payload: AdminPanelEvents[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  // -------------------------------------------------------------------------------------------
  // Serving it
  // -------------------------------------------------------------------------------------------

  /**
   * The panel as Node middleware, to mount on a path of a server you already run:
   * `app.use("/admin", panel.handler({ basePath: "/admin", auth }))`.
   */
  handler(options?: ServeOptions): PanelRequestHandler {
    return createPanelHandler(this, options);
  }

  /** The panel on a port of its own. Loopback unless told otherwise, and never elsewhere without `auth`. */
  listen(options?: ListenOptions): Promise<PanelServer> {
    return listenPanel(this, options);
  }

  /** The panel as `(Request) => Promise<Response>`, for Workers, Deno, Bun and Fetch-based routers. */
  fetchHandler(options?: FetchServeOptions): PanelFetchHandler {
    return createFetchHandler(this, options);
  }

  /**
   * The panel as HTML to put in a page of your own: either a live fragment backed by a handler
   * mounted at `api`, or a read-only `snapshot` of the values now. One of the two is required —
   * a fragment with neither would render and never change, which looks live and is not.
   */
  html(options: HtmlOptions & { groups?: readonly string[] | undefined }): string {
    rejectUnknown(options, ["api", "snapshot", "nonce", "document", "groups", "script", "group", "compact"], "panel.html()");
    const live = options.api !== undefined;
    const snapshot = options.snapshot === true;
    if (live === snapshot) {
      throw new AdminPanelConfigError(
        live
          ? "panel.html() was given both api and snapshot: a fragment either polls a mounted handler or shows the values as they are now"
          : 'panel.html() needs either { api: "/path" } where panel.handler() is mounted, or { snapshot: true } for a read-only render; without either it would never change',
      );
    }
    if (live && (typeof options.api !== "string" || !/^(\/|https?:\/\/)/.test(options.api as string))) throw new AdminPanelConfigError(`panel.html(): api must be a path starting with "/" (got ${JSON.stringify(options.api)})`);
    if (live && options.groups !== undefined) throw new AdminPanelConfigError("panel.html(): groups belong on the handler at api, which decides what the fragment is shown");
    const scope: PanelScope = options.groups === undefined ? READ_ONLY_SCOPE : { ...READ_ONLY_SCOPE, groups: new Set(options.groups) };
    const bootstrap = snapshot ? { schema: this.schema(scope), state: this.state(scope) } : undefined;
    return renderFragment(bootstrap, this.theme, {
      themes: this.offeredThemes(),
      api: options.api,
      scheme: this.colorScheme,
      title: this.title,
      nonce: options.nonce,
      document: options.document === true,
      script: options.script !== false,
      group: options.group,
      compact: options.compact === true,
    });
  }

  /** Stops the timers, saves the chart histories when they are kept, and leaves the sync channel. */
  close(): void {
    if (this.closed) return;
    if (this.keepHistoryMs !== undefined) this.saveHistory();
    this.closed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.schedule.close();
    this.unsubscribe?.();
  }

  // -------------------------------------------------------------------------------------------
  // What the front ends ask
  // -------------------------------------------------------------------------------------------

  schema(scope: PanelScope = READ_ONLY_SCOPE): PanelSchema {
    const groups: GroupSchema[] = [];
    for (const group of this.orderedGroups()) {
      if (!visible(scope, group.name)) continue;
      const items = this.itemsOf(group.name, scope);
      if (items.length === 0) continue;
      const schema: GroupSchema = { id: group.id, title: group.options.title ?? group.name, layout: group.options.layout ?? "grid", items };
      if (group.options.description !== undefined) schema.description = group.options.description;
      if (group.options.grid !== undefined) schema.grid = { ...this.grid, ...(checkGrid(group.options.grid) as Partial<GridShape>) };
      groups.push(schema);
    }
    const schema: PanelSchema = {
      title: this.title,
      version: VERSION,
      structure: this.structure,
      theme: { name: this.theme.name, scheme: this.colorScheme },
      grid: { ...this.grid },
      pollMs: this.pollIntervalMs,
      controls: { edit: anyAllowed(scope.edit), actions: anyAllowed(scope.actions) },
      restrictions: [...scope.restrictions],
      groups,
      locale: this.locale,
      locales: Object.keys(LOCALES),
    };
    if (this.instance !== undefined) schema.instance = this.instance;
    const offered = this.offeredThemes();
    if (offered.length > 1) schema.theme.offered = offered.map((theme) => ({ name: theme.name, label: theme.label }));
    // Only the groups this viewer is shown: a layout says what is in the others by naming cards.
    const shown = new Set(groups.map((group) => group.id));
    const layout = Object.fromEntries(Object.entries(this.sharedLayout ?? {}).filter(([id]) => shown.has(id)));
    if (Object.keys(layout).length > 0) schema.layout = layout;
    if (schema.controls.edit) schema.layoutWritable = true;
    if (this.messages !== undefined) schema.messages = { ...this.messages };
    // The page's bundle carries English alone; another language travels with the schema that asks for it.
    if (this.locale !== "en" && this.locale !== "auto") schema.translations = { ...(LOCALES[this.locale] as Record<string, string>) };
    return schema;
  }

  /**
   * The values and samples a page needs. With `since`, only values changed after that version,
   * plus every live value, which has no version to compare. With `after`, only samples in or
   * after the bucket holding that time. With `feedAfter`, only feed entries after that sequence.
   */
  state(scope: PanelScope = READ_ONLY_SCOPE, since?: number, after?: number, feedAfter?: number): PanelState {
    const now = this.clock.now();
    const values: WireValue[] = [];
    for (const value of this.values.values()) {
      if (!visible(scope, value.group)) continue;
      const conditional = value.definition.visibleWhen !== undefined || value.definition.disabledWhen !== undefined;
      if (since !== undefined && !value.live && !conditional && value.version <= since) continue;
      values.push(this.wire(value, now));
    }
    const feeds: PanelState["feeds"] = {};
    for (const feed of this.feeds.values()) {
      if (!visible(scope, feed.group)) continue;
      const entries = feed.after(feedAfter);
      if (feedAfter === undefined || entries.length > 0 || feed.dropped > 0) feeds[feed.id] = { entries, dropped: feed.dropped, total: feed.total };
    }
    const pending = this.pending().filter((change) => {
      const group = change.kind === "action" ? this.actions.get(change.target)?.group : change.kind === "profile" ? this.profiles.get(change.target)?.group : this.values.get(change.target)?.group;
      return group !== undefined && visible(scope, group);
    });
    const activeProfiles: string[] = [];
    for (const profile of this.profiles.values()) if (visible(scope, profile.group) && profileActive(profile, (value) => this.read(value))) activeProfiles.push(profile.id);
    const actionStates: PanelState["actionStates"] = {};
    for (const action of this.actions.values()) {
      if (!visible(scope, action.group)) continue;
      const condition = conditionOf(action.definition.visibleWhen, action.definition.disabledWhen);
      if (condition.hidden === true || condition.disabled !== undefined) actionStates[action.id] = condition;
    }
    return {
      version: this.version,
      structure: this.structure,
      now,
      values,
      series: this.charts.series(scope, after),
      feeds,
      feedSeq: this.feedSequence,
      pending,
      activeProfiles,
      marks: this.charts.marks(scope, now, this.log.list()),
      actionStates,
      ...this.profileSchedulesFor(scope),
    };
  }

  /**
   * An operator's change, attributed. Validation is the same as for code; the outcome says what went
   * wrong in a sentence. With `revertAfterMs`, the value returns to what it was once that has passed;
   * with `at`, the change waits for that time; with `repeat`, it happens by that rule. A value
   * declared with `approval` becomes a proposal. `validateAsync` is not run here: a listener runs it
   * first, through `checkAsync`, and so should any caller whose values declare one.
   */
  edit(id: string, candidate: unknown, by: string, scope: PanelScope, options: ChangeOptions = {}): EditOutcome {
    const value = this.values.get(id);
    if (value === undefined || !visible(scope, value.group)) return { ok: false, reason: "not-found", ...refusal("refuseNoValue", { id }) };
    if (!value.editable) return { ok: false, reason: "not-editable", ...refusal("refuseNotModifiable", { label: value.label }) };
    if (!canEdit(scope, value.group)) return { ok: false, reason: "not-allowed", ...refusal("refuseEditOff", { label: value.label }) };
    const condition = conditionOf(value.definition.visibleWhen, value.definition.disabledWhen);
    if (condition.hidden === true) return { ok: false, reason: "not-allowed", ...refusal("refuseNotOffered", { label: value.label }) };
    if (condition.disabled !== undefined) return { ok: false, reason: "not-allowed", ...refusal("refuseDisabled", { label: value.label, reason: condition.disabled }) };
    const { revertAfterMs } = options;
    if (revertAfterMs !== undefined && !value.definition.timed) return { ok: false, reason: "invalid", ...refusal("refuseNotTimed", { label: value.label }) };
    const when = this.checkWhen(options, value.definition.approval);
    if (!when.ok) return when;
    const why = checkReason(options.reason, value.definition.reasonRequired, value.label);
    if (!why.ok) return why;
    try {
      value.check(candidate);
    } catch (error) {
      if (error instanceof ValueError) return { ok: false, reason: "invalid", message: error.message, refusal: error.refusal };
      throw error;
    }
    if (value.definition.approval) {
      const pending = this.propose({ kind: "value", id: value.id, label: value.label, sensitive: value.definition.sensitive }, candidate, by, { revertAfterMs, applyAt: when.at, reason: why.reason });
      return { ok: true, pending };
    }
    if (when.at !== undefined || when.repeat !== undefined) {
      this.scheduleTarget({ kind: "scheduled", target: "value", targetId: value.id, to: candidate, at: when.at ?? nextRun(when.repeat as RepeatRule, this.clock.now()), by, reason: why.reason, repeat: when.repeat, revertAfterMs }, value.label, value.definition.sensitive ? undefined : toJson(candidate));
      this.version += 1;
      value.version = this.version;
      return { ok: true, value: this.wire(value, this.clock.now()) };
    }
    return this.apply(value, candidate, by, "edit", revertAfterMs, why.reason);
  }

  /**
   * Runs the `validateAsync` checks of the values a request is about to change, within each value's
   * deadline. Resolves to the first refusal as a sentence, or nothing when every value is accepted.
   */
  async checkAsync(changes: ReadonlyArray<readonly [string, unknown]>): Promise<string | undefined> {
    for (const [id, candidate] of changes) {
      const value = this.values.get(id);
      const check = value?.definition.validateAsync;
      if (value === undefined || check === undefined) continue;
      let verdict: string | undefined;
      try {
        verdict = await withDeadline(Promise.resolve().then(() => check(candidate as never)), value.definition.validateTimeoutMs, `checking ${value.label}`);
      } catch (error) {
        return `${value.label} could not be checked: ${message(error)}`;
      }
      if (typeof verdict === "string" && verdict !== "") return verdict;
    }
    return undefined;
  }

  /** What `checkAsync` needs to be handed for a pending change, a profile or an undo. */
  candidatesFor(kind: "pending" | "profile" | "undo", id: string): Array<[string, unknown]> {
    if (kind === "pending") {
      const entry = this.approvals.get(id);
      if (entry === undefined || entry.kind === "action") return [];
      return entry.kind === "profile" ? this.candidatesFor("profile", entry.target) : [[entry.target, entry.candidate]];
    }
    if (kind === "profile") return (this.profiles.get(id)?.settings ?? []).map(([value, to]) => [value.id, to]);
    const record = this.log.find(Number(id));
    if (record === undefined) return [];
    if (this.isMany(record)) return Object.entries((record.from ?? {}) as Record<string, unknown>);
    return [[record.target, record.from]];
  }

  /** What kind of proposal an id names, for a caller that answers them differently. */
  pendingKind(pendingId: string): "value" | "action" | "profile" | undefined {
    return this.approvals.get(pendingId)?.kind;
  }

  /**
   * Approves a proposal: a value's change is applied, a profile applied, an action run with the input
   * it was proposed with. The operator who proposed it cannot approve it.
   */
  async approve(pendingId: string, by: string, scope: PanelScope): Promise<EditOutcome | ActionOutcome> {
    const pending = this.approvals.get(pendingId);
    const allowed = pending === undefined ? undefined : this.decidable(pending, scope, "approve");
    if (pending === undefined || allowed === undefined) return { ok: false, reason: "not-found", ...refusal("refuseNoPending", { id: pendingId }) };
    if (!allowed.ok) return allowed;
    if (operatorOf(pending.by) === operatorOf(by)) return { ok: false, reason: "not-allowed", ...refusal("refuseOwnProposal", { by }) };
    if (!(await this.replicas.claimed(`pending:${pendingId}`, APPROVAL_TTL_MS))) return { ok: false, reason: "not-found", ...refusal("refuseNoPending", { id: pendingId }) };
    this.decided(pendingId);
    const approvedBy = `${pending.by}, approved by ${by}`;
    const later = pending.applyAt !== undefined && pending.applyAt > this.clock.now() ? pending.applyAt : undefined;
    if (pending.kind === "action") {
      const action = this.actions.get(pending.target) as PanelAction;
      return this.execute(action, (pending.candidate ?? {}) as Record<string, JsonValue>, approvedBy, pending.reason);
    }
    if (pending.kind === "profile") {
      const profile = this.profiles.get(pending.target) as ProfileEntry;
      if (later !== undefined) {
        this.scheduleTarget({ kind: "scheduled", target: "profile", targetId: profile.id, to: null, at: later, by: approvedBy, reason: pending.reason, revertAfterMs: pending.revertAfterMs }, profile.label, undefined);
        return { ok: true, value: this.wire(profile.settings[0]?.[0] as PanelValue<unknown>, this.clock.now()) };
      }
      return this.applyMany(profile.settings, approvedBy, scope, { kind: "profile", target: profile.id, label: profile.label }, { reason: pending.reason, revertAfterMs: pending.revertAfterMs });
    }
    const value = this.values.get(pending.target) as PanelValue<unknown>;
    if (later !== undefined) {
      this.scheduleTarget({ kind: "scheduled", target: "value", targetId: value.id, to: pending.candidate, at: later, by: approvedBy, reason: pending.reason, revertAfterMs: pending.revertAfterMs }, value.label, value.definition.sensitive ? undefined : toJson(pending.candidate));
      this.version += 1;
      value.version = this.version;
      return { ok: true, value: this.wire(value, this.clock.now()) };
    }
    return this.apply(value, pending.candidate, approvedBy, "approval", pending.revertAfterMs, pending.reason);
  }

  /** Withdraws or turns down a proposal. Anyone who may make the change may. */
  async reject(pendingId: string, by: string, scope: PanelScope, options: { reason?: string | undefined } = {}): Promise<EditOutcome> {
    const pending = this.approvals.get(pendingId);
    const allowed = pending === undefined ? undefined : this.decidable(pending, scope, "decide");
    if (pending === undefined || allowed === undefined) return { ok: false, reason: "not-found", ...refusal("refuseNoPending", { id: pendingId }) };
    if (!allowed.ok) return allowed;
    const why = checkReason(options.reason, false, pending.label);
    if (!why.ok) return why;
    if (!(await this.replicas.claimed(`pending:${pendingId}`, APPROVAL_TTL_MS))) return { ok: false, reason: "not-found", ...refusal("refuseNoPending", { id: pendingId }) };
    this.decided(pendingId);
    this.log.record({ kind: "approval", target: pending.target, label: pending.label, by, at: this.clock.now(), ok: false, outcome: `Turned down ${pending.by}'s change.`, ...(why.reason === undefined ? {} : { reason: why.reason }) });
    this.version += 1;
    return { ok: true, value: allowed.wire };
  }

  /** Cancels a scheduled or repeating change before its (next) time. */
  cancelScheduled(entryId: string, by: string, scope: PanelScope): EditOutcome {
    const entry = this.schedule.get(entryId);
    const target = entry === undefined || entry.kind !== "scheduled" ? undefined : this.scheduleTargetOf(entry, scope);
    if (entry === undefined || target === undefined) return { ok: false, reason: "not-found", ...refusal("refuseNoSchedule", { id: entryId }) };
    if (!target.writable) return { ok: false, reason: "not-allowed", ...refusal("refuseCancelOff", { label: target.label }) };
    this.schedule.cancel(entryId);
    this.log.record({ kind: "scheduled", target: entry.targetId, label: target.label, by, at: this.clock.now(), ok: false, outcome: entry.repeat === undefined ? `Cancelled the change ${entry.by} scheduled for ${new Date(entry.at).toISOString()}.` : `Cancelled the change ${entry.by} scheduled ${describeRepeat(entry.repeat)}.` });
    this.version += 1;
    if (target.value !== undefined) target.value.version = this.version;
    return { ok: true, value: this.wire(target.value ?? target.first, this.clock.now()) };
  }

  /** Undoes a change by writing back what it replaced, through the same checks as any edit: one value, or all of a profile's or an import's. */
  undo(changeId: number, by: string, scope: PanelScope, options: { reason?: string | undefined } = {}): EditOutcome {
    const record = this.log.find(changeId);
    if (record === undefined) return { ok: false, reason: "not-found", ...refusal("refuseNoChange", { id: changeId }) };
    if (this.isMany(record)) {
      const pairs = Object.keys((record.to ?? {}) as Record<string, JsonValue>).map((id) => [this.values.get(id), ((record.from ?? {}) as Record<string, unknown>)[id]] as const);
      if (pairs.some(([value]) => value === undefined || !visible(scope, value.group))) return { ok: false, reason: "not-found", ...refusal("refuseNoChange", { id: changeId }) };
      if (!this.revertible(record)) return { ok: false, reason: "conflict", ...refusal("refuseUndoChanged", { id: changeId, label: record.label }) };
      const why = checkReason(options.reason, false, record.label);
      if (!why.ok) return why;
      return this.applyMany(pairs as ReadonlyArray<readonly [PanelValue<unknown>, unknown]>, by, scope, { kind: "revert", target: record.target, label: `Undid: ${record.label}` }, { reason: why.reason });
    }
    const value = this.values.get(record.target);
    if (value === undefined || !visible(scope, value.group)) return { ok: false, reason: "not-found", ...refusal("refuseNoChange", { id: changeId }) };
    if (!this.revertible(record)) return { ok: false, reason: "conflict", ...(record.from === undefined ? refusal("refuseUndoUnrecorded", { id: changeId }) : refusal("refuseUndoChanged", { id: changeId, label: value.label })) };
    return this.edit(value.id, record.from, by, scope, { reason: options.reason });
  }

  /** Applies a profile whole, or nothing of it: now, for a while, at a time, or by a rule. A profile declared with `approval` becomes a proposal. */
  applyProfile(id: string, by: string, scope: PanelScope, options: ChangeOptions = {}): EditOutcome {
    const profile = this.profiles.get(id);
    if (profile === undefined || !visible(scope, profile.group)) return { ok: false, reason: "not-found", ...refusal("refuseNoProfile", { id }) };
    const blocked = profile.settings.find(([value]) => !visible(scope, value.group) || !canEdit(scope, value.group));
    if (blocked !== undefined) return { ok: false, reason: "not-allowed", ...refusal("refuseManyNotAllowed", { what: profile.label, label: blocked[0].label }) };
    const { revertAfterMs } = options;
    if (revertAfterMs !== undefined) {
      if (!Number.isFinite(revertAfterMs) || revertAfterMs < 1000 || revertAfterMs > MAX_REVERT_MS) return { ok: false, reason: "invalid", ...refusal("refuseRevertRange") };
      const sensitive = profile.settings.find(([value]) => value.definition.sensitive);
      if (sensitive !== undefined) return { ok: false, reason: "invalid", ...refusal("refuseProfileTimedSensitive", { label: profile.label, value: sensitive[0].label }) };
    }
    const when = this.checkWhen(options, profile.approval);
    if (!when.ok) return when;
    const why = checkReason(options.reason, profile.reasonRequired, profile.label);
    if (!why.ok) return why;
    const first = profile.settings[0]?.[0] as PanelValue<unknown>;
    if (profile.approval) {
      const pending = this.propose({ kind: "profile", id: profile.id, label: profile.label, sensitive: true }, undefined, by, { revertAfterMs, applyAt: when.at, reason: why.reason });
      return { ok: true, pending };
    }
    if (when.at !== undefined || when.repeat !== undefined) {
      this.scheduleTarget({ kind: "scheduled", target: "profile", targetId: profile.id, to: null, at: when.at ?? nextRun(when.repeat as RepeatRule, this.clock.now()), by, reason: why.reason, repeat: when.repeat, revertAfterMs }, profile.label, undefined);
      return { ok: true, value: this.wire(first, this.clock.now()) };
    }
    return this.applyMany(profile.settings, by, scope, { kind: "profile", target: id, label: profile.label }, { reason: why.reason, revertAfterMs });
  }

  /** Checks when a change happens: at most one of `at` and `repeat`, each within bounds. */
  private checkWhen(options: ChangeOptions, approval: boolean): { ok: true; at: number | undefined; repeat: RepeatRule | undefined } | { ok: false; reason: "invalid" | "conflict"; message: string; refusal: import("./errors.js").Refusal } {
    const { at, revertAfterMs } = options;
    if (revertAfterMs !== undefined && (!Number.isFinite(revertAfterMs) || revertAfterMs < 1000 || revertAfterMs > MAX_REVERT_MS)) return { ok: false, reason: "invalid", ...refusal("refuseRevertRange") };
    let repeat: RepeatRule | undefined;
    if (options.repeat !== undefined) {
      if (at !== undefined) return { ok: false, reason: "invalid", ...refusal("refuseRepeatAndAt") };
      if (approval) return { ok: false, reason: "invalid", ...refusal("refuseRepeatApproval") };
      try {
        repeat = checkRepeat(options.repeat);
      } catch (error) {
        return { ok: false, reason: "invalid", ...refusal("refuseRepeat", { detail: message(error) }) };
      }
    }
    if (at !== undefined) {
      const now = this.clock.now();
      if (!Number.isFinite(at) || at <= now) return { ok: false, reason: "invalid", ...refusal("refuseScheduleFuture") };
      if (at - now > MAX_SCHEDULE_AHEAD_MS) return { ok: false, reason: "invalid", ...refusal("refuseScheduleAhead") };
    }
    if ((at !== undefined || repeat !== undefined) && this.schedule.size >= MAX_SCHEDULED) return { ok: false, reason: "conflict", ...refusal("refuseScheduleFull", { count: MAX_SCHEDULED }) };
    return { ok: true, at, repeat };
  }

  /** Makes a proposal and records it. */
  private propose(target: import("./panel/approvals.js").ProposalTarget, candidate: unknown, by: string, options: { revertAfterMs?: number | undefined; applyAt?: number | undefined; reason?: string | undefined }): PendingChange {
    const entry = this.approvals.propose(target, candidate, by, options);
    this.log.record({ kind: "approval", target: target.id, label: target.label, by, at: this.clock.now(), ok: true, outcome: "Proposed; waiting for a second operator.", ...(entry.to === undefined ? {} : { to: entry.to }), ...(options.reason === undefined ? {} : { reason: options.reason }) });
    this.version += 1;
    this.replicas.proposal(entry, false);
    const { candidate: _candidate, revertAfterMs: _revert, kind, ...pending } = entry;
    return kind === "value" ? pending : { ...pending, kind };
  }

  /** A proposal was decided here: it is removed everywhere. */
  private decided(pendingId: string): void {
    const entry = this.approvals.take(pendingId);
    if (entry !== undefined) this.replicas.proposal(entry, true);
  }

  /** Whether a scope may decide a proposal, with the wire value its answer carries. */
  private decidable(pending: import("./panel/approvals.js").PendingEntry, scope: PanelScope, verb: "approve" | "decide"): ({ ok: true; wire: WireValue } | { ok: false; reason: "not-allowed"; message: string; refusal: import("./errors.js").Refusal }) | undefined {
    const refused = { ok: false as const, reason: "not-allowed" as const, ...refusal(verb === "approve" ? "refuseApproveOff" : "refuseDecideOff", { label: pending.label }) };
    const now = this.clock.now();
    if (pending.kind === "action") {
      const action = this.actions.get(pending.target);
      if (action === undefined || !visible(scope, action.group)) return undefined;
      return canRun(scope, action.group) ? { ok: true, wire: { id: action.id, value: null, at: now, version: this.version } } : refused;
    }
    if (pending.kind === "profile") {
      const profile = this.profiles.get(pending.target);
      if (profile === undefined || !visible(scope, profile.group)) return undefined;
      return profileWritable(profile, scope) ? { ok: true, wire: this.wire(profile.settings[0]?.[0] as PanelValue<unknown>, now) } : refused;
    }
    const value = this.values.get(pending.target);
    if (value === undefined || !visible(scope, value.group)) return undefined;
    return canEdit(scope, value.group) ? { ok: true, wire: this.wire(value, now) } : refused;
  }

  /** What a schedule entry changes, as a scope sees it; undefined when the scope cannot see it. */
  private scheduleTargetOf(entry: ScheduleEntry, scope: PanelScope): { label: string; writable: boolean; value: PanelValue<unknown> | undefined; first: PanelValue<unknown> } | undefined {
    if (entry.target === "profile") {
      const profile = this.profiles.get(entry.targetId);
      if (profile === undefined || !visible(scope, profile.group)) return undefined;
      return { label: profile.label, writable: profileWritable(profile, scope), value: undefined, first: profile.settings[0]?.[0] as PanelValue<unknown> };
    }
    const value = this.values.get(entry.targetId);
    if (value === undefined || !visible(scope, value.group)) return undefined;
    return { label: value.label, writable: canEdit(scope, value.group), value, first: value };
  }

  // -------------------------------------------------------------------------------------------
  // Settings: export, diff, import
  // -------------------------------------------------------------------------------------------

  /** Every modifiable value a scope shows, by id, as JSON. Sensitive values are left out: an export is a file people pass around. */
  exportSettings(scope: PanelScope): Record<string, JsonValue> {
    return exportSettings(this.values.values(), scope, (value) => this.read(value));
  }

  /** What importing `settings` would change, value by value, with the reason any would be refused. Changes nothing. */
  diffSettings(settings: unknown, scope: PanelScope): { diff: SettingDiff[]; unknown: string[] } {
    return diffSettings(this.values, settings, scope, (value) => this.read(value));
  }

  /** Applies imported settings as one change, whole or not at all. Ids this panel does not have are refused, not skipped. */
  importSettings(settings: unknown, by: string, scope: PanelScope, options: { reason?: string | undefined } = {}): EditOutcome & { changed?: number } {
    if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return { ok: false, reason: "invalid", ...refusal("refuseSettingsShape") };
    const { diff, unknown } = this.diffSettings(settings, scope);
    if (unknown.length > 0) return { ok: false, reason: "invalid", ...refusal("refuseNotImportable", { ids: unknown.map((id) => `"${id}"`).join(", ") }) };
    const refused = diff.find((line) => line.error !== undefined);
    if (refused !== undefined) return { ok: false, reason: "invalid", ...refusal("refuseNotImported", { reason: refused.error ?? "" }) };
    if (diff.length === 0) return { ok: true, value: { id: "", value: null, at: this.clock.now(), version: this.version }, changed: 0 };
    const pairs = diff.map((line) => [this.values.get(line.id) as PanelValue<unknown>, (settings as Record<string, unknown>)[line.id]] as [PanelValue<unknown>, unknown]);
    const why = checkReason(options.reason, false, "an import");
    if (!why.ok) return why;
    const outcome = this.applyMany(pairs, by, scope, { kind: "import", target: "settings", label: `Imported ${diff.length} setting${diff.length === 1 ? "" : "s"}` }, { reason: why.reason });
    return { ...outcome, changed: diff.length };
  }

  // -------------------------------------------------------------------------------------------
  // Actions and tables
  // -------------------------------------------------------------------------------------------

  /** Runs an action for an operator, within its deadline, or proposes it when it needs approval. Never rejects. */
  async run(id: string, by: string, scope: PanelScope, rawInput?: unknown, options: { reason?: string | undefined } = {}): Promise<ActionOutcome> {
    const action = this.actions.get(id);
    if (action === undefined || !visible(scope, action.group)) return { ok: false, reason: "not-found", ...refusal("refuseNoAction", { id }) };
    if (!canRun(scope, action.group)) return { ok: false, reason: "not-allowed", ...refusal("refuseRunOff", { label: action.label }) };
    const condition = conditionOf(action.definition.visibleWhen, action.definition.disabledWhen);
    if (condition.hidden === true) return { ok: false, reason: "not-allowed", ...refusal("refuseNotOffered", { label: action.label }) };
    if (condition.disabled !== undefined) return { ok: false, reason: "not-allowed", ...refusal("refuseActionDisabled", { label: action.label, reason: condition.disabled }) };
    let input: Record<string, JsonValue> = {};
    const fields = this.inputs.get(id);
    try {
      if (fields !== undefined) input = checkInput(fields, rawInput);
      else if (rawInput !== undefined && rawInput !== null && Object.keys(rawInput as object).length > 0) throw new ValueError(`${action.label} takes no input`, { key: "refuseNoInput", params: { label: action.label } });
    } catch (error) {
      if (error instanceof ValueError) return { ok: false, reason: "invalid", message: error.message, refusal: error.refusal };
      throw error;
    }
    const why = checkReason(options.reason, action.definition.reasonRequired, action.label);
    if (!why.ok) return why;
    if (action.definition.approval) return { ok: true, pending: this.propose({ kind: "action", id: action.id, label: action.label, sensitive: false }, input, by, { reason: why.reason }) };
    return this.execute(action, input, by, why.reason);
  }

  /** Runs an action that is allowed to run, within its deadline, and records it. */
  private async execute(action: PanelAction, input: Record<string, JsonValue>, by: string, reason: string | undefined): Promise<ActionOutcome> {
    const id = action.id;
    const controller = new AbortController();
    let outcome: ActionOutcome;
    try {
      const result = await withDeadline(Promise.resolve().then(() => action.run({ by, signal: controller.signal, input, ...(reason === undefined ? {} : { reason }) })), action.definition.timeoutMs, `${action.label}`);
      outcome = { ok: true, message: typeof result === "string" && result !== "" ? result : `${action.label} finished.` };
    } catch (error) {
      controller.abort();
      outcome = { ok: false, reason: "failed", ...refusal("refuseActionFailed", { label: action.label, detail: message(error) }) };
      this.onError(error, `the action "${id}"`);
    }
    this.log.record({ kind: "action", target: id, label: action.label, by, at: this.clock.now(), ok: outcome.ok, outcome: outcome.ok && "message" in outcome ? outcome.message : outcome.ok ? "" : outcome.message, ...(Object.keys(input).length > 0 ? { to: input } : {}), ...(reason === undefined ? {} : { reason }) });
    return outcome;
  }

  /** A page of a table's rows. Rejects with a sentence when the table's source fails. */
  async tableRows(id: string, query: { [K in keyof TableQuery]?: TableQuery[K] | undefined }, scope: PanelScope): Promise<TableRowsAnswer | undefined> {
    const table = this.tables.get(id);
    if (table === undefined || !visible(scope, table.group)) return undefined;
    const full: TableQuery = {
      offset: Math.max(0, Math.floor(query.offset ?? 0)),
      limit: Math.max(1, Math.floor(query.limit ?? table.schema(false).pageSize)),
      sort: query.sort,
      direction: query.direction === "desc" ? "desc" : "asc",
      search: (query.search ?? "").slice(0, MAX_SEARCH_LENGTH),
    };
    return table.page(full);
  }

  /** Runs a row action for an operator. Never rejects. */
  async runRowAction(tableId: string, actionId: string, rowId: string, by: string, scope: PanelScope): Promise<ActionOutcome> {
    const table = this.tables.get(tableId);
    const action = table?.rowActions.find((candidate) => candidate.id === actionId);
    if (table === undefined || action === undefined || !visible(scope, table.group)) return { ok: false, reason: "not-found", ...refusal("refuseNoRowAction", { action: actionId, table: tableId }) };
    if (!canRun(scope, table.group)) return { ok: false, reason: "not-allowed", ...refusal("refuseRunOff", { label: action.label }) };
    if (typeof rowId !== "string" || rowId === "" || rowId.length > 200) return { ok: false, reason: "invalid", ...refusal("refuseRowId") };
    const controller = new AbortController();
    let outcome: ActionOutcome;
    try {
      const result = await withDeadline(Promise.resolve().then(() => action.run(rowId, { by, signal: controller.signal, input: {} })), action.timeoutMs, action.label);
      outcome = { ok: true, message: typeof result === "string" && result !== "" ? result : `${action.label} finished.` };
    } catch (error) {
      controller.abort();
      outcome = { ok: false, reason: "failed", ...refusal("refuseActionFailed", { label: action.label, detail: message(error) }) };
      this.onError(error, `the row action "${tableId}/${actionId}"`);
    }
    this.log.record({ kind: "action", target: `${tableId}/${actionId}`, label: `${action.label} (${table.label}: ${rowId})`, by, at: this.clock.now(), ok: outcome.ok, outcome: outcome.message });
    return outcome;
  }

  // -------------------------------------------------------------------------------------------
  // Timers
  // -------------------------------------------------------------------------------------------

  /** Runs periodic updates and samples every timer-driven history that is due. The panel's own timer calls this; a test can too. */
  tick(): void {
    const now = this.clock.now();
    // Tickers first: a counter's rate is computed before a chart samples it.
    for (const ticker of this.tickers) {
      if (now < ticker.nextDue) continue;
      ticker.nextDue = now + ticker.everyMs;
      try {
        ticker.run(now);
      } catch (error) {
        this.onError(error, "a periodic update");
      }
    }
    this.charts.tick(now);
  }

  /** @internal Runs `run` every `everyMs` on the panel's timer: counters, percentiles and alerts use it. */
  every(everyMs: number, run: (now: number) => void): void {
    this.tickers.push({ everyMs: Math.max(250, everyMs), nextDue: 0, run });
    this.startTimer();
  }

  /** @internal Exported as a Prometheus counter rather than a gauge. */
  markCounter(id: string): void {
    this.counterIds.add(id);
  }

  /** @internal Every numeric value a scope shows, for the metrics exposition. Sensitive values are left out. */
  metricValues(scope: PanelScope): Array<{ id: string; label: string; group: string; value: number; counter: boolean }> {
    const out: Array<{ id: string; label: string; group: string; value: number; counter: boolean }> = [];
    for (const value of this.values.values()) {
      if (!visible(scope, value.group) || value.definition.sensitive) continue;
      const number = plottable(this.read(value));
      if (number !== undefined) out.push({ id: value.id, label: value.label, group: value.group, value: number, counter: this.counterIds.has(value.id) });
    }
    return out;
  }

  /** @internal Changes counted by kind and outcome since start: in memory, so the count never goes backwards when the list trims. */
  changeTotals(): Map<string, number> {
    return this.totals;
  }

  /** Settles when every change so far is chained and handed to the change log store: await it before a planned exit. */
  flushed(): Promise<void> {
    return this.log.flushed();
  }

  // -------------------------------------------------------------------------------------------
  // ValueOwner: what a value calls back into
  // -------------------------------------------------------------------------------------------

  /** @internal The hot path: every `set()` in the application lands here. */
  valueChanged(value: PanelValue<unknown>, by: string): void {
    this.version += 1;
    value.version = this.version;
    const now = this.clock.now();
    value.updatedAt = now;
    this.charts.changed(value, now);
    if (value.definition.timeline > 0) this.remember(value, now, by);
  }

  /** @internal */
  moveValue(value: PanelValue<unknown>, group: string): void {
    this.assertOwn(value, "moveTo()");
    value.group = this.ensureGroup(group);
    this.structureChanged();
  }

  /** @internal */
  reportError(error: unknown, source: string): void {
    this.onError(error, source);
    this.events.emit("error", { error, source });
  }

  /**
   * @internal Adds or refreshes a notice. The panel's own words are a message key and what fills it,
   * so a page can say them in the viewer's language; `{ text }` is for words the panel did not write
   * itself — an alert's sentence, which reads the same here, in the change log and in a webhook.
   */
  notice(level: Notice["level"], id: string, said: MessageKey | { text: string }, params: Record<string, string | number> = {}): void {
    const keyed = typeof said === "string";
    const notice: Notice = { id, level, message: keyed ? format(ENGLISH[said], params) : said.text, at: this.clock.now() };
    if (keyed) {
      notice.key = said;
      notice.params = params;
    }
    this.noticeLog.delete(id);
    this.noticeLog.set(id, notice);
    if (this.noticeLog.size > MAX_NOTICES) {
      const oldest = this.noticeLog.keys().next().value;
      if (oldest !== undefined) this.noticeLog.delete(oldest);
    }
    this.events.emit("notice", notice);
  }

  /** @internal Group names the panel knows, for a listener to check its `groups` list against. */
  groupNames(): string[] {
    return [...this.groups.keys()];
  }

  /** @internal Whether anything in the scope is modifiable, or runnable, for the listener's restrictions. */
  counts(): { editable: number; actions: number } {
    let editable = 0;
    for (const value of this.values.values()) if (value.editable) editable += 1;
    let actions = this.actions.size;
    for (const table of this.tables.values()) actions += table.rowActions.length;
    return { editable: editable + this.profiles.size, actions };
  }

  /** @internal Fires a timed or scheduled change now, as its timer would. */
  fireScheduledNow(entryId: string): void {
    this.schedule.fire(entryId);
  }

  /** @internal Reverts a value's timed change now, as its timer would. */
  fireRevert(value: PanelValue<unknown>): void {
    const entry = this.schedule.revertFor("value", value.id);
    if (entry !== undefined) this.schedule.fire(entry.id);
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  private declare<T>(source: ValueSource<T>, options: ModifiableOptions<unknown>, editable: boolean): PanelValue<T> {
    const label = options.label ?? options.id;
    let id: string;
    if (options.id !== undefined) {
      id = checkId(options.id, `the value "${label}"`);
      if (id.startsWith("apb.")) throw new AdminPanelConfigError(`the value id "${id}" starts with "apb.", which the panel keeps for itself`);
    } else if (label !== undefined && slug(label) !== "") id = slug(label);
    else {
      this.unnamed += 1;
      id = `value-${this.unnamed}`;
      this.notice("info", "unnamed-values", this.unnamed === 1 ? "noticeUnnamedOne" : "noticeUnnamedMany", { count: this.unnamed });
    }
    const shown = checkTitle(label ?? `Value ${this.unnamed}`);
    if (this.values.has(id)) throw new AdminPanelConfigError(`two values have the id "${id}": the second would silently replace the first on the page. Give one of them its own id or label`);
    if (options.persist === true) {
      if (!editable) throw new AdminPanelConfigError(`"${shown}" asks to be persisted but is not modifiable; only an operator's changes are persisted`);
      if (options.id === undefined && options.label === undefined) throw new AdminPanelConfigError("a persisted value needs an id or a label: a name derived from the order of declaration would attach the stored value to a different setting when declarations move");
      if (this.store === undefined) throw new AdminPanelConfigError(`"${shown}" asks to be persisted, but the panel has no store: pass { store: fileStore(path) } to createAdminPanel`);
    }
    if (source.kind === "getter" && editable) throw new AdminPanelConfigError(`"${shown}" is read from a function, so it cannot be modifiable; bind() a property instead`);
    if (options.validateAsync !== undefined && typeof options.validateAsync !== "function") throw new AdminPanelConfigError(`"${shown}" has a validateAsync that is not a function`);
    const validateTimeoutMs = options.validateTimeoutMs ?? 5000;
    if (!Number.isFinite(validateTimeoutMs) || validateTimeoutMs <= 0) throw new AdminPanelConfigError(`"${shown}" has a validateTimeoutMs of ${validateTimeoutMs}; it is a positive number of milliseconds`);
    checkCondition(shown, "visibleWhen", options.visibleWhen);
    checkCondition(shown, "disabledWhen", options.disabledWhen);
    checkReasonOption(shown, options.reason);

    const initial = readSafely(source);
    const kind = inferKind(initial, options);
    const constraints = resolveConstraints(shown, kind, options);
    const pattern = options.pattern === undefined ? undefined : statelessPattern(options.pattern);
    if (options.decimals !== undefined && (!Number.isInteger(options.decimals) || options.decimals < 0 || options.decimals > 12)) {
      throw new AdminPanelConfigError(`"${shown}" asks for ${options.decimals} decimals; it must be a whole number from 0 to 12`);
    }
    const status = checkStatusRule(shown, options.status);
    const alert = checkAlert(shown, options.alert, status);
    const timeline = options.timeline ?? (kind === "enum" || kind === "boolean" || kind === "string" ? DEFAULT_TIMELINE : 0);
    if (!Number.isInteger(timeline) || timeline < 0 || timeline > 200) throw new AdminPanelConfigError(`"${shown}" keeps a timeline of ${timeline}; it is 0 to 200 changes`);
    const definition: ValueDefinition = {
      id,
      label: shown,
      description: options.description,
      kind,
      editable,
      sensitive: options.sensitive === true,
      confirm: options.confirm === true,
      persist: options.persist === true,
      constraints,
      pattern,
      unit: options.unit,
      format: options.format,
      decimals: options.decimals,
      order: options.order ?? 0,
      sequence: this.sequence++,
      validate: options.validate as ValueDefinition["validate"],
      onChange: options.onChange,
      status,
      approval: options.approval === true,
      timed: editable && options.timed !== false,
      span: checkSpan(shown, options.span),
      size: checkCardSize(shown, options.size),
      visibleWhen: options.visibleWhen,
      disabledWhen: options.disabledWhen,
      timeline: options.sensitive === true ? 0 : timeline,
      validateAsync: options.validateAsync as ValueDefinition["validateAsync"],
      validateTimeoutMs,
      reasonRequired: options.reason === "required" || options.approval === true,
    };
    if (options.approval === true && !editable) throw new AdminPanelConfigError(`"${shown}" asks for approval but is not modifiable`);
    const group = this.ensureGroup(options.group ?? this.defaultGroup);
    const value = new PanelValue<T>(definition, source, this, group, this.clock.now());
    // The declared starting value has to satisfy the declaration, or the first unchanged
    // submission of the form would be refused.
    if (editable && source.kind === "cell") {
      try {
        value.check(initial);
      } catch (error) {
        throw new AdminPanelConfigError(`"${shown}" starts at ${JSON.stringify(toJson(initial))}, which its own declaration refuses: ${message(error)}`);
      }
    }
    this.values.set(id, value as PanelValue<unknown>);
    if (options.chart !== undefined && options.chart !== false) this.charts.attach(value as PanelValue<unknown>, options.chart);
    if (alert !== undefined) {
      if (this.alerts.size === 0) this.every(1000, (now) => this.alerts.check(now));
      this.alerts.add(value as PanelValue<unknown>, alert);
    }
    if (!definition.sensitive && looksSecret(id, shown)) {
      this.notice("warning", `looks-secret-${id}`, "noticeLooksSecret", { label: shown });
    }
    if (this.stored !== undefined) {
      if (definition.persist) this.restoreOne(value as PanelValue<unknown>, this.stored);
      this.schedule.restore(this.stored[SCHEDULE_KEY], "value", id);
    }
    this.structureChanged();
    return value;
  }

  /** @internal The one path an operator's change takes once it is allowed. */
  private apply(value: PanelValue<unknown>, candidate: unknown, by: string, kind: ChangeRecord["kind"], revertAfterMs: number | undefined, reason?: string | undefined): EditOutcome {
    const previous = value.get();
    try {
      // `write` checks the constraints and the validator, the same as a write from code.
      value.write(candidate, by);
    } catch (error) {
      if (error instanceof ValueError) return { ok: false, reason: "invalid", message: error.message, refusal: error.refusal };
      throw error;
    }
    const definition = value.definition;
    this.schedule.cancelRevert("value", value.id);
    const record = this.log.record({
      kind,
      target: value.id,
      label: value.label,
      by,
      at: this.clock.now(),
      ok: true,
      origin: this.origin,
      ...(definition.sensitive ? {} : { from: toJson(previous), to: toJson(candidate) }),
      ...(reason === undefined ? {} : { reason }),
    });
    this.persist(value, candidate);
    // Published before the revert entry, so a replica receiving both drops its own revert first and keeps this one.
    this.replicas.change(value, candidate, record);
    if (revertAfterMs !== undefined) this.schedule.add({ kind: "revert", target: "value", targetId: value.id, to: previous, at: this.clock.now() + revertAfterMs, by, reason });
    this.runOnChange(value, candidate, previous, by);
    return { ok: true, value: this.wire(value, this.clock.now()) };
  }

  /** Several values set in one step, checked first, recorded once: profiles and imports. */
  private applyMany(settings: ReadonlyArray<readonly [PanelValue<unknown>, unknown]>, by: string, scope: PanelScope, record: { kind: "profile" | "import" | "revert"; target: string; label: string }, extra: { reason?: string | undefined; revertAfterMs?: number | undefined } = {}): EditOutcome {
    for (const [value] of settings) {
      if (!visible(scope, value.group) || !canEdit(scope, value.group)) return { ok: false, reason: "not-allowed", ...refusal("refuseManyNotAllowed", { what: record.label, label: value.label }) };
      const condition = conditionOf(value.definition.visibleWhen, value.definition.disabledWhen);
      if (condition.disabled !== undefined) return { ok: false, reason: "not-allowed", ...refusal("refuseManyDisabled", { what: record.label, label: value.label, reason: condition.disabled }) };
    }
    // Checked first, all of them: half a profile is worse than none.
    try {
      for (const [value, to] of settings) value.check(to);
    } catch (error) {
      if (error instanceof ValueError) return { ok: false, reason: "invalid", ...refusal("refuseManyInvalid", { what: record.label, reason: error.message }) };
      throw error;
    }
    const from: Record<string, JsonValue> = {};
    const to: Record<string, JsonValue> = {};
    const previous: unknown[] = [];
    for (const [value, next] of settings) {
      if (!value.definition.sensitive) {
        from[value.id] = toJson(value.get());
        to[value.id] = toJson(next);
      }
      previous.push(value.get());
      this.schedule.cancelRevert("value", value.id);
      value.write(next, by);
      this.persist(value, next);
    }
    if (record.kind !== "import") this.schedule.cancelRevert("profile", record.target);
    const written = this.log.record({ ...record, by, at: this.clock.now(), ok: true, from, to, origin: this.origin, outcome: `Set ${settings.map(([value]) => value.label).join(", ")}.`, ...(extra.reason === undefined ? {} : { reason: extra.reason }) });
    settings.forEach(([value, next], index) => {
      this.replicas.change(value, next, { ...written, target: value.id, label: value.label, ...(value.definition.sensitive ? {} : { to: toJson(next) }) });
      this.runOnChange(value, next, previous[index], by);
    });
    if (extra.revertAfterMs !== undefined) {
      const back: Record<string, unknown> = {};
      settings.forEach(([value], index) => {
        back[value.id] = previous[index];
      });
      this.schedule.add({ kind: "revert", target: "profile", targetId: record.target, to: back, at: this.clock.now() + extra.revertAfterMs, by, reason: extra.reason });
    }
    const first = settings[0]?.[0] as PanelValue<unknown>;
    return { ok: true, value: this.wire(first, this.clock.now()) };
  }

  /** Adds a scheduled or repeating change and records that it was planned. */
  private scheduleTarget(entry: NewEntry, label: string, shown: JsonValue | undefined): ScheduleEntry {
    const added = this.schedule.add(entry);
    const when = entry.repeat === undefined ? `for ${new Date(entry.at).toISOString()}` : `${describeRepeat(entry.repeat)}, first at ${new Date(entry.at).toISOString()}`;
    this.log.record({ kind: "scheduled", target: entry.targetId, label, by: entry.by, at: this.clock.now(), ok: true, outcome: `Scheduled ${when}.`, ...(shown === undefined ? {} : { to: shown }), ...(entry.reason === undefined ? {} : { reason: entry.reason }) });
    return added;
  }

  /** A timed revert, a scheduled change or a repeating change whose time has come. */
  private fireScheduled(entry: ScheduleEntry, late: boolean): void {
    const how = entry.kind === "revert" ? "(timed change ended)" : entry.repeat === undefined ? "(scheduled)" : "(repeating)";
    const by = `${entry.by} ${how}`;
    const kind = entry.kind === "revert" ? "revert" : "scheduled";
    let label: string;
    let outcome: EditOutcome;
    if (entry.target === "profile") {
      const profile = this.profiles.get(entry.targetId);
      if (profile === undefined) return;
      label = profile.label;
      if (entry.kind === "revert") {
        const back = (entry.to ?? {}) as Record<string, unknown>;
        const pairs = profile.settings.filter(([value]) => Object.hasOwn(back, value.id)).map(([value]) => [value, back[value.id]] as const);
        outcome = this.applyMany(pairs, by, INTERNAL, { kind: "revert", target: profile.id, label: `${profile.label} (timed change ended)` }, { reason: entry.reason });
      } else outcome = this.applyMany(profile.settings, by, INTERNAL, { kind: "profile", target: profile.id, label: profile.label }, { reason: entry.reason, revertAfterMs: entry.revertAfterMs });
    } else {
      const value = this.values.get(entry.targetId);
      if (value === undefined) return;
      label = value.label;
      outcome = this.apply(value, entry.to, by, kind, entry.revertAfterMs, entry.reason);
    }
    const reverting = entry.kind === "revert";
    if (!outcome.ok) this.notice("warning", `${entry.kind}-${entry.targetId}`, reverting ? "noticeRevertFailed" : "noticeScheduledFailed", { label, reason: outcome.message });
    else if (late) this.notice("info", `late-${entry.id}`, reverting ? "noticeRevertLate" : "noticeScheduledLate", { label, time: new Date(entry.at).toISOString() });
  }

  /** A change that set several values at once: a profile, an import, or the undoing of either. */
  private isMany(record: ChangeRecord): boolean {
    return record.kind === "profile" || record.kind === "import" || (record.kind === "revert" && !this.values.has(record.target));
  }

  private runOnChange(value: PanelValue<unknown>, candidate: unknown, previous: unknown, by: string): void {
    const onChange = value.definition.onChange;
    if (onChange === undefined) return;
    try {
      const result = onChange(candidate, { previous, by }) as unknown;
      if (typeof (result as { then?: unknown } | undefined)?.then === "function") {
        (result as Promise<unknown>).catch((error: unknown) => this.changeListenerFailed(value, error));
      }
    } catch (error) {
      this.changeListenerFailed(value, error);
    }
  }

  /** A value's change made on another replica, applied here through the same checks, and shown with where it came from. */
  private applyLayout(incoming: LayoutMessage): void {
    this.sharedLayout = incoming.layout === null ? undefined : readLayout(incoming.layout);
    this.log.remember({ ...incoming.record, origin: incoming.origin });
    this.structureChanged();
    this.version += 1;
  }

  private applyChange(incoming: ChangeMessage): void {
    const value = this.values.get(incoming.target);
    if (value === undefined || !value.editable) return;
    try {
      // This replica's copy of a revert the change replaces goes quietly: the maker has announced it.
      this.schedule.cancelRevert("value", value.id, true, false);
      value.write(incoming.value, incoming.record.by);
      this.log.remember({ ...incoming.record, origin: incoming.origin });
    } catch (error) {
      this.notice("warning", `sync-refused-${value.id}`, "noticeSyncRefused", { label: value.label, reason: message(error) });
    }
  }

  private remember(value: PanelValue<unknown>, at: number, by: string): void {
    const list = this.timelines.get(value.id) ?? [];
    const entry: { at: number; value: JsonValue; by?: string } = { at, value: toJson(this.read(value)) };
    if (by !== "code") entry.by = by;
    list.push(entry);
    if (list.length > value.definition.timeline) list.shift();
    this.timelines.set(value.id, list);
  }

  /** Reads a value without letting a throwing getter or property escape. */
  private read(value: PanelValue<unknown>): unknown {
    try {
      return value.get();
    } catch (error) {
      this.getterFailed(value, error);
      return undefined;
    }
  }

  private startTimer(): void {
    if (this.timer !== undefined || this.closed) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        this.onError(error, "sampling");
      }
    }, 250);
    // A panel must never be the thing that keeps a process, a test runner or a serverless invocation alive.
    (this.timer as { unref?: () => void }).unref?.();
  }

  private wire(value: PanelValue<unknown>, now: number): WireValue {
    // A live value is read once per quarter second whoever asks, so many viewers cost one read.
    if (value.live) {
      const cached = this.liveCache.get(value.id);
      if (cached !== undefined && now - cached.at < LIVE_READ_MS && now >= cached.at) return this.decorate(value, { ...cached.wire });
    }
    const base: WireValue = { id: value.id, value: null, at: value.live ? now : value.updatedAt, version: value.version };
    if (value.changedBy !== undefined) base.by = value.changedBy;
    let out: WireValue;
    if (value.definition.sensitive) out = { ...base, masked: true };
    else {
      let current: unknown;
      try {
        current = value.get();
      } catch (error) {
        this.getterFailed(value, error);
        const why = { label: value.label, reason: message(error) };
        return this.decorate(value, { ...base, error: format(ENGLISH.readFailed, why), errorKey: "readFailed", errorParams: why });
      }
      const encoded = encodeForWire(current);
      out = encoded.text === undefined ? { ...base, value: encoded.value } : { ...base, value: encoded.value, text: encoded.text };
      const status = statusOf(value.definition.status, current);
      if (status !== undefined) out.status = status;
    }
    if (value.live) this.liveCache.set(value.id, { at: now, wire: { ...out } });
    return this.decorate(value, out);
  }

  private decorate(value: PanelValue<unknown>, out: WireValue): WireValue {
    return decorateWire(value, out, { revert: this.schedule.revertFor("value", value.id), scheduled: this.schedule.scheduledFor("value", value.id), recent: this.timelines.get(value.id) });
  }

  private profileSchedulesFor(scope: PanelScope): { profileSchedules?: Record<string, ScheduledChange[]> } {
    const out: Record<string, ScheduledChange[]> = {};
    for (const profile of this.profiles.values()) {
      if (!visible(scope, profile.group)) continue;
      const entries = this.schedule.scheduledFor("profile", profile.id);
      if (entries.length > 0) out[profile.id] = entries.map((entry) => scheduledShape(entry, true));
    }
    return Object.keys(out).length === 0 ? {} : { profileSchedules: out };
  }

  private getterFailed(value: PanelValue<unknown>, error: unknown): void {
    if (this.failedGetters.has(value.id)) return;
    this.failedGetters.add(value.id);
    this.notice("warning", `getter-${value.id}`, "noticeGetterThrew", { label: value.label, reason: message(error) });
    this.onError(error, `reading "${value.id}"`);
  }

  private changeListenerFailed(value: PanelValue<unknown>, error: unknown): void {
    this.notice("warning", `on-change-${value.id}`, "noticeChangeHandler", { label: value.label, reason: message(error) });
    this.onError(error, `onChange of "${value.id}"`);
  }

  private itemsOf(group: string, scope: PanelScope): ItemSchema[] {
    // Within an order, values first, then the group's own charts, tables and feeds, then profiles
    // and actions: a chart drawing several values reads best after them, and buttons that change
    // things sit at the end.
    type Ordered = { order: number; rank: number; sequence: number; items: ItemSchema[] };
    const entries: Ordered[] = [];
    for (const value of this.values.values()) {
      if (value.group !== group) continue;
      const items: ItemSchema[] = [valueSchema(value, value.editable && canEdit(scope, group))];
      const chart = value.chartId === undefined ? undefined : this.charts.get(value.chartId);
      if (chart !== undefined && this.charts.visibleTo(chart, scope)) items.push(this.charts.schema(chart, scope));
      entries.push({ order: value.definition.order, rank: 0, sequence: value.definition.sequence, items });
    }
    for (const chart of this.charts.all()) {
      if (chart.placement !== "group" || chart.group !== group || !this.charts.visibleTo(chart, scope)) continue;
      const schema = this.charts.schema(chart, scope);
      if (schema.series.length > 0) entries.push({ order: chart.order, rank: 1, sequence: chart.sequence, items: [schema] });
    }
    for (const table of this.tables.values()) {
      if (table.group !== group) continue;
      entries.push({ order: table.order, rank: 1, sequence: table.sequence, items: [table.schema(canRun(scope, group))] });
    }
    for (const feed of this.feeds.values()) {
      if (feed.group !== group) continue;
      const d = feed.definition;
      const schema: FeedSchema = { type: "feed", id: d.id, title: d.label, capacity: d.capacity, perSecond: d.perSecond };
      if (d.description !== undefined) schema.description = d.description;
      if (d.span !== undefined) schema.span = d.span;
      if (d.size !== undefined) schema.size = d.size;
      entries.push({ order: d.order, rank: 1, sequence: d.sequence, items: [schema] });
    }
    for (const profile of this.profiles.values()) {
      if (profile.group !== group) continue;
      entries.push({ order: profile.order, rank: 2, sequence: profile.sequence, items: [profileSchema(profile, scope)] });
    }
    for (const action of this.actions.values()) {
      if (action.group !== group) continue;
      entries.push({ order: action.definition.order, rank: 2, sequence: action.definition.sequence, items: [actionSchema(action, canRun(scope, group), this.inputs.get(action.id))] });
    }
    entries.sort((a, b) => a.order - b.order || a.rank - b.rank || a.sequence - b.sequence);
    return entries.flatMap((entry) => entry.items);
  }

  private orderedGroups(): GroupEntry[] {
    return [...this.groups.values()].sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0) || a.sequence - b.sequence);
  }

  private ensureGroup(name: string): string {
    const checked = checkGroupName(name);
    if (!this.groups.has(checked)) {
      let id = slug(checked) || "group";
      const taken = new Set([...this.groups.values()].map((group) => group.id));
      for (let n = 2; taken.has(id); n += 1) id = `${slug(checked) || "group"}-${n}`;
      this.groups.set(checked, { name: checked, id, options: {}, sequence: this.sequence++ });
      this.structureChanged();
    }
    return checked;
  }

  private assertOwn(value: PanelValue<unknown>, where: string): void {
    if (!(value instanceof PanelValue) || this.values.get(value.id) !== value) throw new AdminPanelConfigError(`${where} refers to a value declared on another panel`);
  }

  private structureChanged(): void {
    this.structure += 1;
  }

  private revertible(record: ChangeRecord): boolean {
    if (record.from === undefined || record.to === undefined) return false;
    if (this.isMany(record)) {
      const to = record.to as Record<string, JsonValue>;
      const from = record.from as Record<string, JsonValue>;
      if (to === null || typeof to !== "object" || Array.isArray(to) || Object.keys(to).length === 0) return false;
      // A profile whose values include a sensitive one recorded only part of what it replaced.
      if (record.kind === "profile" && (this.profiles.get(record.target)?.settings.some(([value]) => value.definition.sensitive) ?? true)) return false;
      return Object.keys(to).every((id) => {
        const value = this.values.get(id);
        return value !== undefined && value.editable && Object.hasOwn(from, id) && sameJson(this.read(value), to[id]);
      });
    }
    if (record.kind !== "edit" && record.kind !== "approval" && record.kind !== "revert" && record.kind !== "scheduled") return false;
    const value = this.values.get(record.target);
    if (value === undefined || !value.editable) return false;
    return sameJson(this.read(value), record.to);
  }

  private persist(value: PanelValue<unknown>, candidate: unknown): void {
    if (!value.definition.persist || this.store === undefined) return;
    this.store.save(value.id, toJson(candidate)).catch((error: unknown) => {
      this.notice("warning", `store-save-${value.id}`, "noticeStoreSave", { label: value.label, reason: message(error) });
      this.onError(error, `saving "${value.id}"`);
    });
  }

  private saveToStore(key: string, data: JsonValue, what: string): void {
    if (this.store === undefined) return;
    this.store.save(key, data).catch((error: unknown) => this.onError(error, `saving ${what}`));
  }

  private saveHistory(): void {
    this.saveToStore(HISTORY_KEY, this.charts.snapshot(), "chart history");
  }

  private async restore(store: ValueStore): Promise<void> {
    let stored: Record<string, JsonValue>;
    try {
      stored = await store.load();
    } catch (error) {
      this.stored = {};
      this.notice("warning", "store-load", "noticeStoreLoad", { reason: message(error) });
      this.onError(error, "loading stored values");
      return;
    }
    this.stored = stored;
    if (stored[LAYOUT_KEY] !== undefined && stored[LAYOUT_KEY] !== null) {
      this.sharedLayout = readLayout(stored[LAYOUT_KEY]);
      this.structureChanged();
    }
    for (const value of this.values.values()) {
      if (value.definition.persist) this.restoreOne(value, stored);
      this.schedule.restore(stored[SCHEDULE_KEY], "value", value.id);
    }
    for (const profile of this.profiles.keys()) this.schedule.restore(stored[SCHEDULE_KEY], "profile", profile);
    if (this.keepHistoryMs !== undefined && stored[HISTORY_KEY] !== undefined) {
      try {
        this.charts.restore(stored[HISTORY_KEY]);
      } catch (error) {
        this.notice("warning", "history-restore", "noticeHistoryRestore", { reason: message(error) });
      }
    }
  }

  private restoreOne(value: PanelValue<unknown>, stored: Record<string, JsonValue>): void {
    if (!Object.hasOwn(stored, value.id)) return;
    const candidate = stored[value.id];
    try {
      value.check(candidate);
      value.write(candidate, "store");
    } catch (error) {
      this.notice("warning", `store-refused-${value.id}`, "noticeStoreRefused", { label: value.label, reason: message(error) });
    }
  }
}

/**
 * The operator in an actor, without the route they came by: a delegate token records "ada via
 * gateway", and that is still ada. What the two-person rule compares, so the same person cannot
 * approve their own proposal by making one of the two through a gateway.
 */
function operatorOf(actor: string): string {
  const via = actor.lastIndexOf(" via ");
  return via === -1 ? actor : actor.slice(0, via);
}

export function createAdminPanel(options?: AdminPanelOptions): AdminPanel {
  return new AdminPanel(options);
}


