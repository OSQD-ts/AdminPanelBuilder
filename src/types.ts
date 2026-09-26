/**
 * The shapes the public API speaks.
 *
 * Two families live here. The declaration options (`ViewableOptions`, `ModifiableOptions`,
 * `ChartOptions`, `GroupOptions`, `ActionOptions`) are what an application writes next to its
 * variables. The wire shapes (`PanelSchema`, `PanelState` and what they contain) are what
 * leaves the process: the same objects reach the page, the embedded fragment, the custom
 * element and anybody reading the API with `curl`, so they are documented once, in
 * `docs/reference/data-shapes.md`, and changing one is a change to all four.
 *
 * Everything in a wire shape was written by the application, and some of it by whoever the
 * application serves: a player's name, an email subject, a User-Agent. The page renders all of
 * it as text and never as markup.
 */
import type { PanelValue } from "./values/handle.js";

/** What a value can be once it has been through `JSON.stringify`. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * How a value is shown and, when it is modifiable, how it is edited. Inferred from the initial
 * value unless given: a number is `"number"`, a string `"string"`, a boolean `"boolean"`,
 * anything with `options` `"enum"`, and everything else `"json"`.
 */
export type ValueKind = "number" | "string" | "boolean" | "enum" | "json";

/** How a number or a timestamp is written on the page. The stored value is never rounded. */
export type ValueFormat = "plain" | "integer" | "percent" | "bytes" | "duration" | "timestamp";

/**
 * `histogram` bins an array of numbers; `heatmap` draws a record of records (rows of columns).
 * Both draw the current value, like any chart over keys.
 */
export type ChartKind = "line" | "area" | "step" | "bar" | "sparkline" | "gauge" | "histogram" | "heatmap";

/** How a value reads against its thresholds. Always shown as a word as well as a colour. */
export type Status = "ok" | "warn" | "bad";

/**
 * When a number is worth attention. `{ warn: 100, bad: 1000 }` flags values at or above each;
 * `below: true` flags values at or below instead (free disk, remaining quota). A function
 * decides for anything else, and returning nothing means no status.
 */
export type StatusRule = { warn?: number | undefined; bad?: number | undefined; below?: boolean | undefined } | ((value: never) => Status | undefined);

/** How many grid columns a card spans, or the whole row. */
export type Span = 1 | 2 | 3 | "full";

/**
 * A card's size in its group's grid of cells: `w` columns out of the grid's (12 unless the panel or
 * group says otherwise) and `h` rows. `h` is a minimum: a row grows when what the card shows needs
 * more room, so a size never cuts content off.
 */
export interface CardSize {
  w: number;
  h: number;
}

/** How one group's cards are arranged: their order by card id (`value:<id>`, `chart:<id>`, …), and sizes over the declared ones. */
export interface GroupLayout {
  order?: string[];
  sizes?: Record<string, CardSize>;
}

/** A layout of the whole panel, by group id: what "Save for everybody" stores, and "Save for me" keeps in the browser. */
export type PanelLayout = Record<string, GroupLayout>;

/** A horizontal line across a chart: a fixed number, or another value's current reading (a limit, a target). */
export interface ChartLine {
  value: number | PanelValue<number>;
  label: string;
}

/**
 * What a chart's horizontal axis is.
 *
 * - `"time"` — the value's own history, sampled as it changes or on a timer.
 * - `"keys"` — the entries of the current value, for a record or an array: wins by opening,
 *   messages by provider, one bar each. No history is kept.
 * - another numeric value — this value plotted against that one, sampled together: latency
 *   against load, memory against connected players.
 */
export type ChartAxis = "time" | "keys" | PanelValue<number>;

export interface ChartOptions {
  /** Default `"line"`, or `"bar"` when `over` is `"keys"`. */
  kind?: ChartKind | undefined;
  /** Default `"time"`. */
  over?: ChartAxis | undefined;
  /**
   * The title of a chart shared by the whole group. Values naming the same title draw as
   * series on one chart; absent, the value gets a chart of its own beside it.
   */
  in?: string | undefined;
  /** Title for a chart of its own. Default: the value's label. */
  title?: string | undefined;
  /** How many samples are kept. Default 300 (five minutes of one-second buckets), at most `MAX_HISTORY_POINTS`. */
  points?: number | undefined;
  /**
   * Sample on a timer rather than on change. A value read from a function or bound to a
   * property cannot announce its changes, so it is sampled every second unless this says
   * otherwise. At least `MIN_SAMPLE_INTERVAL_MS`.
   */
  sampleEveryMs?: number | undefined;
  /** Lower bound of the vertical axis. Default: the smallest sample, or 0 for bars. */
  min?: number | undefined;
  /** Upper bound of the vertical axis. A gauge needs one, here or as the value's `max`. */
  max?: number | undefined;
  /** Stack the series of a shared area or bar chart, for shares of a whole. */
  stacked?: boolean | undefined;
  /** Lines across the chart: a limit, a target. */
  lines?: readonly ChartLine[] | undefined;
  /** Mark the moments an operator changed a charted value, or a line's value. Default true. */
  annotate?: boolean | undefined;
  /** Bins of a histogram. Default: Sturges' rule over the values it is given. */
  bins?: number | undefined;
}

interface CommonOptions {
  /**
   * A stable id. Default: derived from the label, or `value-<n>` in order of declaration when
   * there is no label either — which is why a persisted value must have one.
   */
  id?: string | undefined;
  /** What the panel calls it. Default: the id. */
  label?: string | undefined;
  /** One sentence under the label saying what it is and what changing it does. */
  description?: string | undefined;
  /** The group it is drawn in. Default: the panel's `defaultGroup`, `"General"`. */
  group?: string | undefined;
  /** Position within the group; lower first, ties in order of declaration. */
  order?: number | undefined;
  /** Grid columns the card spans. Default 1; a table or a shared chart spans the whole row. Superseded by `size`. */
  span?: Span | undefined;
  /**
   * Cells the card takes in its group's grid: `w` of the grid's columns (12 unless it says
   * otherwise) and `h` rows, a minimum height. Default: chosen from what the card shows.
   */
  size?: CardSize | undefined;
}

export interface ViewableOptions extends CommonOptions {
  /** Overrides the kind inferred from the initial value. */
  kind?: ValueKind | undefined;
  /** Written after the number: `"ms"`, `"req/s"`, `"players"`. */
  unit?: string | undefined;
  format?: ValueFormat | undefined;
  /** Decimal places shown. The stored value is never rounded. */
  decimals?: number | undefined;
  /** `true` for a line over time with the defaults, a kind name for that kind over time, or the full options. */
  chart?: boolean | ChartKind | ChartOptions | undefined;
  /**
   * Never sent to a browser. The page shows that a value exists and when it changed, never
   * what it is: a key, a password, a connection string. A sensitive modifiable value can be
   * replaced from the panel but not read back from it.
   */
  sensitive?: boolean | undefined;
  /** Colours the value, with a word, when it crosses a threshold. */
  status?: StatusRule | undefined;
  /** Raise an alert when the status reaches `at` and holds for `forMs`. Needs `status`. */
  alert?: AlertOptions | undefined;
  /** Shown only while this answers true: a setting that does nothing in the current mode is not offered. */
  visibleWhen?: (() => boolean) | undefined;
  /** A sentence while it may not be changed (why), nothing while it may. */
  disabledWhen?: (() => string | false | undefined) | undefined;
  /** Recent changes kept for a value that cannot be charted, shown as a timeline. Default 20 for text, options and switches; 0 turns it off. */
  timeline?: number | undefined;
}

export interface AlertOptions {
  /** The status that raises it. Default `"bad"`. */
  at?: "warn" | "bad" | undefined;
  /** How long the status must hold first. Default 0: at once. */
  forMs?: number | undefined;
  /** Least time between two alerts for this value, so a flapping value is one event. Default ten minutes. */
  cooldownMs?: number | undefined;
}

/** What an alert says: which value, what it read, against what, for how long. */
export interface Alert {
  target: string;
  label: string;
  status: "warn" | "bad";
  reading: JsonValue;
  /** The threshold crossed, when the rule has one. */
  threshold?: number;
  /** When the status was first reached. */
  since: number;
  at: number;
  /** One sentence for a notification. */
  message: string;
}

/** Everything a change carries besides the new value. */
export interface ChangeContext<T> {
  previous: T;
  /** Who made it: an authenticated operator's name, or `"code"`. */
  by: string;
}

export interface ModifiableOptions<T> extends ViewableOptions {
  /** Smallest accepted number. */
  min?: number | undefined;
  /** Largest accepted number. */
  max?: number | undefined;
  /** Accepted numbers are `min + k * step` (or `k * step` without a minimum). */
  step?: number | undefined;
  /** Only whole numbers are accepted. Implied by `format: "integer"`. */
  integer?: boolean | undefined;
  /** The accepted values, which makes the value an `"enum"`: a select on the page. */
  options?: readonly T[] | undefined;
  /** Longest accepted string. Default 10,000 characters. */
  maxLength?: number | undefined;
  /** Strings must match. A `g` or `y` flag is dropped: both make `test()` stateful. */
  pattern?: RegExp | undefined;
  /** A text area rather than a single line. */
  multiline?: boolean | undefined;
  /**
   * The last word on a new value, after the declared constraints. Return a sentence saying what
   * is wrong to refuse it, or nothing to accept it. It runs for writes from code too.
   */
  validate?: ((next: T) => string | undefined) | undefined;
  /**
   * Called after an operator changes the value. Isolated: a throw or a rejection is reported on
   * the panel's error channel and does not undo the change or reach the operator's request.
   */
  onChange?: ((next: T, change: ChangeContext<T>) => void | Promise<void>) | undefined;
  /**
   * Remember an operator's change in the panel's store and restore it on the next start. Only
   * changes made from the panel are persisted: what the code sets is the code's business.
   */
  persist?: boolean | undefined;
  /** The page asks for a second click before applying, and says what will change. */
  confirm?: boolean | undefined;
  /**
   * An operator's change waits for a second operator to approve it. The one who proposed it cannot
   * approve it, and an unapproved change expires after an hour.
   */
  approval?: boolean | undefined;
  /**
   * Whether an operator's change says why: `"required"` refuses one without a reason, `"optional"`
   * (the default) offers the field. A value declared with `approval` always requires one: the
   * second operator decides on it.
   */
  reason?: "required" | "optional" | undefined;
  /** Offer "for a while" on the page: the change reverts itself after the chosen time. Default true. */
  timed?: boolean | undefined;
  /**
   * A check that has to ask something slow — a database, a URL — for changes arriving through a
   * listener. Resolve to a sentence to refuse. Code's own writes and direct calls to `panel.edit()`
   * do not run it; see docs/concepts/values.md.
   */
  validateAsync?: ((next: T) => Promise<string | undefined>) | undefined;
  /** How long `validateAsync` may take before the change is refused. Default 5 seconds. */
  validateTimeoutMs?: number | undefined;
}

/** A property of an existing object, shown and optionally edited through that object. */
export interface BindOptions<T> extends ModifiableOptions<T> {
  /** Offer it for editing. Default false: binding a property shows it. */
  editable?: boolean | undefined;
}

export interface GroupOptions {
  /** What the tab says. Default: the group's name. */
  title?: string | undefined;
  description?: string | undefined;
  /** Tab position; lower first, ties in order of declaration. */
  order?: number | undefined;
  /** Cards in a grid (the default), or one per row. */
  layout?: "grid" | "list" | undefined;
  /** This group's grid of cells, over the panel's. */
  grid?: Partial<GridShape> | undefined;
}

/** A grid of cells: how many columns at full width, and how tall a row is in CSS pixels. */
export interface GridShape {
  columns: number;
  rowHeight: number;
}

export interface SharedChartOptions extends Omit<ChartOptions, "in" | "title"> {
  title: string;
  /** The group it is drawn in. Default: the group of its first series. */
  group?: string | undefined;
  /** The values drawn, in legend order. Up to eight: one per chart colour. */
  series: readonly PanelValue<unknown>[];
  description?: string | undefined;
  /** Position within the group; lower first, ties in order of declaration. */
  order?: number | undefined;
  span?: Span | undefined;
  size?: CardSize | undefined;
}

/** What an action is handed when an operator runs it. */
export interface ActionContext {
  by: string;
  /** Aborted when the action outlives its `timeoutMs`. Pass it on to anything that takes one. */
  signal: AbortSignal;
  /** The operator's answers to the action's `input`, each already checked against its field. */
  input: Record<string, JsonValue>;
  /** Why, when the operator said. */
  reason?: string | undefined;
}

/** One field an action asks for before it runs, checked like a modifiable value. */
export interface InputField {
  label?: string | undefined;
  description?: string | undefined;
  kind?: "number" | "string" | "boolean" | "enum" | "json" | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  integer?: boolean | undefined;
  options?: readonly JsonValue[] | undefined;
  maxLength?: number | undefined;
  pattern?: RegExp | undefined;
  multiline?: boolean | undefined;
  /** May be left empty. Default false: every field is required. */
  optional?: boolean | undefined;
  /** What the form starts with. It must satisfy the field. */
  default?: JsonValue | undefined;
}

export interface ActionOptions extends CommonOptions {
  /**
   * The page asks for a second click and names what will happen; `"type"` asks for the action's
   * label to be typed instead, for something that cannot be taken back. Default false.
   */
  confirm?: boolean | "type" | undefined;
  /** Running it waits for a second operator to approve, with the proposer's input. Implies a required reason. */
  approval?: boolean | undefined;
  /** As for values: `"required"` refuses a run without a reason. */
  reason?: "required" | "optional" | undefined;
  /** Drawn as a destructive button, and implies `confirm`. */
  destructive?: boolean | undefined;
  /** The operator's request is answered with a failure after this long. Default 30 seconds. */
  timeoutMs?: number | undefined;
  /** Fields the operator fills in before the action runs: `{ player: { kind: "string", maxLength: 40 } }`. */
  input?: Readonly<Record<string, InputField>> | undefined;
  visibleWhen?: (() => boolean) | undefined;
  disabledWhen?: (() => string | false | undefined) | undefined;
}

/** A column of a table. */
export interface TableColumn {
  /** The property of a row this column shows. */
  key: string;
  label?: string | undefined;
  format?: ValueFormat | undefined;
  unit?: string | undefined;
  decimals?: number | undefined;
  /** The page may sort by it. Default true. */
  sortable?: boolean | undefined;
  /** Colours a numeric cell, with a word, past a threshold. */
  status?: StatusRule | undefined;
}

/** What the page asks a table for: a page of rows, sorted and searched. */
export interface TableQuery {
  offset: number;
  limit: number;
  sort: string | undefined;
  direction: "asc" | "desc";
  /** What the operator typed in the search box; `""` for nothing. */
  search: string;
}

export interface TablePage<Row> {
  rows: readonly Row[];
  /** Rows matching the search, all pages together. */
  total: number;
}

/** A button on every row. */
export interface TableRowAction {
  id?: string | undefined;
  label: string;
  run: (rowId: string, context: ActionContext) => unknown;
  confirm?: boolean | undefined;
  destructive?: boolean | undefined;
  timeoutMs?: number | undefined;
}

export interface TableOptions<Row> extends CommonOptions {
  columns: readonly (TableColumn | string)[];
  /**
   * The rows, or a function returning them: the panel sorts, searches and pages them itself. For a
   * set too large to hold, pass `fetch` instead.
   */
  rows?: readonly Row[] | (() => readonly Row[] | Promise<readonly Row[]>) | undefined;
  /** A page of rows for a query, sorted and searched by you: a database query with LIMIT and OFFSET. */
  fetch?: ((query: TableQuery) => TablePage<Row> | Promise<TablePage<Row>>) | undefined;
  /** The property that identifies a row, for row actions. Default `"id"`. */
  rowId?: string | undefined;
  /** Rows per page. Default 25, at most `MAX_PAGE_SIZE`. */
  pageSize?: number | undefined;
  /** Show a search box. Default true. */
  searchable?: boolean | undefined;
  actions?: readonly TableRowAction[] | undefined;
  /** A query answered after this long fails rather than holding the page. Default 10 seconds. */
  timeoutMs?: number | undefined;
}

export interface FeedOptions extends CommonOptions {
  /** Entries kept, newest first. Default 200, at most `MAX_FEED_CAPACITY`. */
  capacity?: number | undefined;
  /**
   * Entries accepted a second. Past it an entry is dropped and counted, never queued: a queue in
   * front of a slow reader is the same unbounded growth moved somewhere less visible. Default 50.
   */
  perSecond?: number | undefined;
}

export interface ProfileOptions extends CommonOptions {
  /** The page asks for a second click, naming what will change. Default true. */
  confirm?: boolean | undefined;
  /** Applying it waits for a second operator to approve. Implies a required reason. */
  approval?: boolean | undefined;
  reason?: "required" | "optional" | undefined;
}

// ---------------------------------------------------------------------------------------------
// Wire shapes. Documented in docs/reference/data-shapes.md.
// ---------------------------------------------------------------------------------------------

export interface ValueConstraints {
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  options?: JsonValue[];
  maxLength?: number;
  /** The pattern's source and flags, for the page to check before sending. The server checks again. */
  pattern?: { source: string; flags: string };
  multiline?: boolean;
}

export interface ValueSchema {
  type: "value";
  id: string;
  label: string;
  description?: string;
  kind: ValueKind;
  unit?: string;
  format?: ValueFormat;
  decimals?: number;
  /** Declared modifiable. Whether this listener lets anybody edit it is `PanelSchema.controls.edit`. */
  editable: boolean;
  /** Read from a function or a property on every request, so it is present in every state. */
  live: boolean;
  sensitive: boolean;
  confirm: boolean;
  constraints: ValueConstraints;
  /** The id of the chart drawn beside it, when it has one of its own. */
  chart?: string;
  /** Modifiable, and this listener lets the viewer change it. */
  writable: boolean;
  /** A change waits for a second operator. */
  approval: boolean;
  /** A change must say why. */
  reasonRequired?: boolean;
  /** The page may offer a change that reverts itself. */
  timed: boolean;
  span?: Span;
  size?: CardSize;
}

export interface ChartSeriesSchema {
  value: string;
  label: string;
  /** Chart colour slot, 1 to 8. Colour is never the only signal: the legend and the table name each series. */
  slot: number;
  /** The key of its samples in `PanelState.series`. Absent for a `"keys"` chart, which draws the current value. */
  history?: string;
}

export interface ChartSchema {
  type: "chart";
  id: string;
  title: string;
  description?: string;
  kind: ChartKind;
  over: "time" | "keys" | { value: string; label: string };
  series: ChartSeriesSchema[];
  min?: number;
  max?: number;
  /** `"alone"` is drawn with the value it belongs to; `"group"` is a chart of the group's own. */
  placement: "alone" | "group";
  /** Samples each history keeps, so the page holds no more than the server does. */
  points: number;
  unit?: string;
  format?: ValueFormat;
  stacked?: boolean;
  /** Lines across the chart; `from` names the value whose reading sets it. */
  lines?: Array<{ label: string; value?: number; from?: string }>;
  bins?: number;
  span?: Span;
  size?: CardSize;
}

export interface InputSchema {
  name: string;
  label: string;
  description?: string;
  kind: ValueKind;
  constraints: ValueConstraints;
  optional: boolean;
  default?: JsonValue;
}

export interface ActionSchema {
  type: "action";
  id: string;
  label: string;
  description?: string;
  confirm: boolean;
  destructive: boolean;
  /** This listener lets the viewer run it. */
  runnable: boolean;
  input?: InputSchema[];
  span?: Span;
  size?: CardSize;
  /** The page asks for the label to be typed before running it. */
  typeToConfirm?: boolean;
  /** A run waits for a second operator. */
  approval?: boolean;
  /** A run must say why. */
  reasonRequired?: boolean;
}

export interface TableSchema {
  type: "table";
  id: string;
  title: string;
  description?: string;
  columns: Array<{ key: string; label: string; format?: ValueFormat; unit?: string; decimals?: number; sortable: boolean }>;
  pageSize: number;
  searchable: boolean;
  actions: Array<{ id: string; label: string; confirm: boolean; destructive: boolean }>;
  runnable: boolean;
  span?: Span;
  size?: CardSize;
}

export interface FeedSchema {
  type: "feed";
  id: string;
  title: string;
  description?: string;
  capacity: number;
  perSecond: number;
  span?: Span;
  size?: CardSize;
}

export interface ProfileSchema {
  type: "profile";
  id: string;
  title: string;
  description?: string;
  confirm: boolean;
  /** What applying it sets. `to` is absent for a sensitive value. */
  settings: Array<{ value: string; label: string; to?: JsonValue }>;
  writable: boolean;
  span?: Span;
  size?: CardSize;
  /** Applying it waits for a second operator. */
  approval?: boolean;
  /** Applying it must say why. */
  reasonRequired?: boolean;
}

export type ItemSchema = ValueSchema | ChartSchema | ActionSchema | TableSchema | FeedSchema | ProfileSchema;

export interface GroupSchema {
  id: string;
  title: string;
  description?: string;
  layout: "grid" | "list";
  /** This group's grid, where it differs from the panel's. */
  grid?: GridShape;
  items: ItemSchema[];
}

export interface PanelSchema {
  title: string;
  instance?: string;
  /** The library's version, for a page talking to an older or newer server. */
  version: string;
  /** Bumped by anything that changes this shape: a declaration, a regrouping, a retitle. */
  structure: number;
  theme: {
    name: string;
    scheme: "auto" | "light" | "dark";
    /** Themes a viewer may choose among, the panel's first. Absent: the panel's theme only. */
    offered?: Array<{ name: string; label: string }>;
  };
  /** The grid every group is laid out in, unless the group has its own. */
  grid: GridShape;
  /** The layout saved for everybody from the page, over the sizes and order in code. */
  layout?: PanelLayout;
  /** Whether this viewer may save a layout for everybody. */
  layoutWritable?: boolean;
  pollMs: number;
  /** Whether anything at all may be edited or run here; each item says whether it may. */
  controls: { edit: boolean; actions: boolean };
  /** Why something declared is not usable here, in sentences the page shows as they are. */
  restrictions: Restriction[];
  groups: GroupSchema[];
  /**
   * The language of the page's own words, or "auto" to follow each viewer's browser, and any of
   * them the application replaced.
   */
  locale: string;
  messages?: Record<string, string>;
  /** The page's words in `locale` when it is not English: the client carries English alone. */
  translations?: Record<string, string>;
  /** Every language the page ships, for a viewer to choose from. */
  locales?: string[];
  /** The listener offers a live stream at `/api/stream`; the page polls without it. */
  stream?: boolean;
}

export interface WireValue {
  id: string;
  /** The value as JSON. `null` when it is masked, failed to read, or is not a finite number. */
  value: JsonValue;
  /** Set when `value` alone would mislead: `"NaN"`, `"Infinity"`, a truncation note. */
  text?: string;
  /** The page's message key for `text`, when the note is the panel's own words rather than a number. */
  textKey?: string;
  textParams?: Record<string, string | number>;
  /** The getter or the property read failed; the sentence says how, in English. */
  error?: string;
  /** The page's message key for `error`, and what fills it, so a page says it in the viewer's language. */
  errorKey?: string;
  errorParams?: Record<string, string | number>;
  /** A sensitive value: it exists, and this is all the page will learn. */
  masked?: boolean;
  /** When it last changed, epoch milliseconds. For a live value, when it was read. */
  at: number;
  /** Who changed it last from the panel. */
  by?: string;
  /** The panel version at its last change. */
  version: number;
  status?: Status;
  /** A timed change is in force: it reverts at `revertAt`, to `revertTo` (absent when sensitive). */
  revertAt?: number;
  revertTo?: JsonValue;
  /** `visibleWhen` answered false: the page leaves the card out. */
  hidden?: boolean;
  /** `disabledWhen` gave a reason: the page shows it instead of the editor. */
  disabled?: string;
  /** Changes waiting for their time. */
  scheduled?: ScheduledChange[];
  /** Recent changes of a value that cannot be charted, newest last. */
  recent?: Array<{ at: number; value: JsonValue; by?: string }>;
}

export interface ScheduledChange {
  id: string;
  /** The next run. */
  at: number;
  /** Absent when the value is sensitive, and for a profile. */
  to?: JsonValue;
  by: string;
  reason?: string;
  /** Runs again by this rule after `at`. */
  repeat?: RepeatRuleShape;
  /** Each run reverts itself after this long. */
  revertAfterMs?: number;
}

/** Every day, or every week on one weekday, at a wall-clock time in a time zone. */
export interface RepeatRuleShape {
  every: "day" | "week";
  /** "HH:MM", 24-hour. */
  at: string;
  /** 0 is Sunday. */
  weekday?: number;
  timeZone: string;
}

/**
 * One sample: `[t, y]` over time, `[t, y, x]` against another value, where `t` is the start of
 * the sample's time bucket in epoch milliseconds and `x` the other value's reading. The page
 * keys samples on `t`, so a re-sent newest bucket replaces the one it had.
 */
export type Sample = [number, number] | [number, number, number];

export interface PanelState {
  /** Pass back as `since` to receive only what changed after it. */
  version: number;
  structure: number;
  now: number;
  values: WireValue[];
  /** Samples by history key. With `after`, only samples at or after it; the last one may repeat, updated. */
  series: Record<string, Sample[]>;
  /** New feed entries by feed id, after the `feed` sequence the page passed. */
  feeds: Record<string, { entries: FeedEntry[]; dropped: number; total: number }>;
  /** Pass back as `feed` to receive only newer entries. */
  feedSeq: number;
  /** Changes waiting for a second operator. */
  pending: PendingChange[];
  /** Profiles whose every setting currently holds. */
  activeProfiles: string[];
  /** Operator changes to mark on each chart, within the chart's window. */
  marks: Record<string, Array<{ at: number; text: string }>>;
  /** Actions hidden or disabled right now, by id; an action absent here is shown and usable. */
  /** Changes scheduled for profiles, by profile id. */
  profileSchedules?: Record<string, ScheduledChange[]>;
  actionStates: Record<string, { hidden?: boolean; disabled?: string }>;
}

/** One line of a settings diff: what importing would change. */
export interface SettingDiff {
  id: string;
  label: string;
  from: JsonValue;
  to: JsonValue;
  /** Why this setting would be refused, in English; a diff with any error applies nothing. */
  error?: string;
  /** The page's message key for `error`, and what fills it, so a page says it in the viewer's language. */
  errorKey?: string;
  errorParams?: Record<string, string | number>;
}

export interface FeedEntry {
  seq: number;
  at: number;
  level: "info" | "warn" | "bad";
  text: string;
  fields?: Record<string, JsonValue>;
}

export interface PendingChange {
  id: string;
  /** What is proposed: a value's change (the default), an action's run, or a profile's application. */
  kind?: "value" | "action" | "profile";
  target: string;
  label: string;
  /** Absent when the value is sensitive; an action's input. */
  to?: JsonValue;
  by: string;
  at: number;
  expiresAt: number;
  /** Why, in the proposer's words. */
  reason?: string;
  /** Approving it schedules it for this time rather than applying it. */
  applyAt?: number;
}

export interface TableRowsAnswer {
  rows: Array<{ id: string; cells: Record<string, JsonValue>; status?: Record<string, Status> }>;
  total: number;
  offset: number;
  limit: number;
}

export interface ChangeRecord {
  /** Increasing within a process, and across restarts when a change log store keeps them. */
  id: number;
  kind: "edit" | "action" | "profile" | "revert" | "approval" | "scheduled" | "import" | "layout";
  /** The value, action, profile or pending change id. */
  target: string;
  label: string;
  by: string;
  at: number;
  /** For an edit, the values as the page would show them; sensitive values are never recorded. */
  from?: JsonValue;
  to?: JsonValue;
  /** For an action: what it answered, or why it failed. */
  outcome?: string;
  ok: boolean;
  /** An edit that the page may undo: not sensitive, and nothing has changed the value since. */
  revertible?: boolean;
  /** The process the change was made on, when changes travel between replicas. */
  origin?: string;
  /** Why, in the words of whoever made it. */
  reason?: string;
  /** SHA-256 of this record and the previous one's hash: a chain a deleted or edited line breaks. */
  hash?: string;
  prevHash?: string;
}

/**
 * A sentence the page shows about what a listener does not allow: English, as every caller has
 * always been sent it, and the key that says it in the viewer's language.
 */
export interface Restriction {
  text: string;
  key: string;
  params?: Record<string, string | number>;
}

export interface Notice {
  /** Stable, so the same condition noticed twice is one notice. */
  id: string;
  level: "info" | "warning";
  /** In English, as every caller of the API has always been sent it. */
  message: string;
  /**
   * The page's message key for `message`, and what fills it, when the panel wrote the notice about
   * its own machinery. Absent for words the panel did not write itself — an alert's sentence, which
   * reads the same here, in the change log and in a webhook.
   */
  key?: string;
  params?: Record<string, string | number>;
  at: number;
}
