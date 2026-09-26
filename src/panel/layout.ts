/**
 * The grid of cells a group's cards are laid out in, as numbers: pure, shared by the server (which
 * validates what code and operators say) and the page (which draws it).
 *
 * A group's width is split into `columns` equal columns (12 unless the panel or group says
 * otherwise) and its height into rows of `rowHeight` pixels. Every card takes `w` columns and `h`
 * rows. `h` is a minimum: a row grows when what a card shows needs more room, so a size never cuts
 * content off. Where a size is not given, one is chosen from what the card shows.
 *
 * On a narrower screen the grid has fewer columns (a third as many on a tablet — four of twelve —
 * and one on a phone), and every width is scaled to them. A third, not a half: the widths people
 * give cards are quarters, thirds and halves of twelve, and four columns keep quarters and halves
 * whole where six would split a quarter into one and a half columns and leave holes.
 *
 * Precedence, highest first: this viewer's own layout, the layout saved for everybody, the sizes in
 * code, the sizes chosen by kind.
 */
import type { CardSize, GroupLayout, ItemSchema, PanelLayout, Span } from "../types.js";

/** Columns a grid may be split into. Past 24 a cell is narrower than a word. */
export const MAX_GRID_COLUMNS = 24;
/** Rows one card may ask for. Twenty-four rows is several screens. */
export const MAX_CARD_ROWS = 24;
/** A saved layout, as JSON. A thousand cards with sizes fit, and it still travels to replicas in one message. */
export const MAX_LAYOUT_BYTES = 48 * 1024;
/** Groups and cards a saved layout may name. */
export const MAX_LAYOUT_ENTRIES = 5000;

export interface GridConfig {
  /** Columns at full width. */
  columns: number;
  /** The height of one row, in CSS pixels. */
  rowHeight: number;
}

export const DEFAULT_GRID: GridConfig = { columns: 12, rowHeight: 72 };

/** Widths below which the grid has fewer columns, and then one. In CSS pixels of the grid itself. */
export const FEWER_COLUMNS_BELOW = 900;
export const ONE_COLUMN_BELOW = 560;

/** Widths on a 12-column grid for the old `span`: a third, a half, three quarters, all. */
const SPAN_WIDTHS: Record<string, number> = { "1": 3, "2": 6, "3": 9, full: 12 };

/** A width given for a 12-column grid, on a grid of `columns`. */
function fromTwelve(w: number, columns: number): number {
  return Math.min(columns, Math.max(1, Math.round((w * columns) / 12)));
}

/**
 * How a card may be sized: the size it would like, the smallest it stays readable at and the largest
 * it is useful at, each on a grid of `columns`. A size given in code is kept as it is (`locked`); a
 * `span` is a preferred width. `family` says what kind of thing the card shows, for gathering
 * related cards together.
 */
export interface Sizing {
  pref: CardSize;
  min: CardSize;
  max: CardSize;
  locked: boolean;
  family: Family;
}

/** What a card shows, as far as placing it near its kind goes. */
export type Family = "reading" | "setting" | "chart" | "action" | "list";

/** The size a card has before anybody arranged it: its declared `size`, its `span` as a width, or one chosen from what it shows. */
export function declaredSize(item: ItemSchema, columns: number, chart?: DrawnAs): CardSize {
  return sizingOf(item, columns, chart).pref;
}

/** How a value is drawn beside its reading: a plot over time or against another value, bars (keys or a histogram), a gauge, a sparkline, or a heatmap. */
export type DrawnAs = "plot" | "bars" | "gauge" | "spark" | "heatmap";

export function sizingOf(item: ItemSchema, columns: number, chart?: DrawnAs): Sizing {
  const kind = kindSizing(item, chart);
  const scale = (size: CardSize): CardSize => ({ w: fromTwelve(size.w, columns), h: Math.min(MAX_CARD_ROWS, Math.max(1, size.h)) });
  const span = (item as { span?: Span }).span;
  const pref = scale(span === undefined ? kind.pref : { w: SPAN_WIDTHS[String(span)] ?? kind.pref.w, h: kind.pref.h });
  const family = familyOf(item, chart);
  if (item.size !== undefined) {
    const fixed = { w: Math.min(columns, Math.max(1, item.size.w)), h: Math.min(MAX_CARD_ROWS, Math.max(1, item.size.h)) };
    return { pref: fixed, min: fixed, max: fixed, locked: true, family };
  }
  const min = scale(kind.min);
  const max = scale(kind.max);
  return { pref: { w: Math.min(Math.max(pref.w, min.w), max.w), h: pref.h }, min, max, locked: false, family };
}

function familyOf(item: ItemSchema, chart: DrawnAs | undefined): Family {
  switch (item.type) {
    case "value":
      return chart !== undefined ? "chart" : item.writable ? "setting" : "reading";
    case "chart":
      return "chart";
    case "action":
    case "profile":
      return "action";
    case "table":
    case "feed":
      return "list";
  }
}

/**
 * Sizes by kind, on a 12-column grid: preferred, smallest, largest. Chosen to hold what the card
 * shows at the default row height; a card given fewer rows than it needs grows its rows, and the
 * cards beside it with them.
 */
function kindSizing(item: ItemSchema, chart: DrawnAs | undefined): { pref: CardSize; min: CardSize; max: CardSize } {
  const sizes = (pref: [number, number], min: [number, number], max: [number, number]) => ({ pref: { w: pref[0], h: pref[1] }, min: { w: min[0], h: min[1] }, max: { w: max[0], h: max[1] } });
  switch (item.type) {
    case "value":
      if (chart === "plot") return item.writable ? sizes([6, 7], [4, 6], [12, 10]) : sizes([6, 5], [4, 4], [12, 8]);
      if (chart === "bars") return sizes([6, 4], [4, 3], [12, 8]);
      // A gauge is a reading over one bar: given more rows it would only hold air.
      if (chart === "gauge") return sizes([4, 3], [3, 2], [6, 4]);
      // A sparkline is a reading with a line under it, no axes to read: one row more than a number.
      if (chart === "spark") return sizes([3, 3], [3, 2], [6, 4]);
      // Rows of columns (a day of hours is 24 of them) need the width; narrower, the numbers hide and the colours stay.
      if (chart === "heatmap") return sizes([12, 5], [8, 4], [12, 8]);
      if (item.kind === "json") return sizes([6, 3], [4, 2], [12, 10]);
      // A setting carries its editor, and often a reason and a time: it is given room to hold them.
      if (item.writable) return sizes([4, 3], [3, 3], [6, 9]);
      return sizes([3, 2], [2, 2], [6, 3]);
    case "chart":
      if (item.kind === "heatmap") return sizes([12, 4], [8, 3], [12, 8]);
      if (item.kind === "gauge") return sizes([4, 3], [3, 2], [6, 4]);
      if (item.over === "keys" || item.kind === "histogram") return sizes([6, 4], [4, 3], [12, 8]);
      return item.placement === "group" ? sizes([12, 5], [6, 4], [12, 8]) : sizes([6, 5], [4, 4], [12, 8]);
    case "table":
      return sizes([12, 5], [6, 4], [12, 10]);
    case "feed":
      return sizes([6, 5], [4, 4], [12, 8]);
    case "action":
      // A button with a line about it: wider it can be, taller it has nothing to hold.
      return item.input !== undefined && item.input.length > 0 ? sizes([4, 3], [3, 3], [6, 8]) : sizes([3, 2], [2, 2], [6, 3]);
    case "profile":
      return sizes([4, 3], [3, 3], [6, 8]);
  }
}

/**
 * Related cards together: by family, in the order each family first appears, and within a family,
 * cards whose labels share all but their last word (Server move time p50, p95, p99) side by side.
 * Otherwise declaration order: the order the application gave is kept wherever it does not split a
 * family.
 */
export function gather<T extends { family: string; label: string }>(cards: readonly T[]): T[] {
  const families: string[] = [];
  for (const card of cards) if (!families.includes(card.family)) families.push(card.family);
  const out: T[] = [];
  for (const family of families) {
    const members = cards.filter((card) => card.family === family);
    const stems: string[] = [];
    for (const card of members) if (!stems.includes(stemOf(card.label))) stems.push(stemOf(card.label));
    for (const stem of stems) out.push(...members.filter((card) => stemOf(card.label) === stem));
  }
  return out;
}

/** A label without its last word: "Server move time p95" → "server move time"; a one-word label is its own stem. */
function stemOf(label: string): string {
  const words = label.trim().toLowerCase().split(/\s+/);
  return words.length > 1 ? words.slice(0, -1).join(" ") : (words[0] ?? "");
}

/** A card as the packer sees it, on the grid it packs: sizes already in that grid's columns. */
export interface Packable {
  id: string;
  pref: CardSize;
  min: CardSize;
  max: CardSize;
  /** Kept exactly as it is: set in code, or by somebody arranging the cards. */
  locked: boolean;
  /**
   * Its content grows into the height it is given — a chart's line or bars, a table, a feed — so it
   * may be stretched a little past its largest size to close a hole. A card holding a reading, an
   * editor or a button is not: stretching it only adds empty space.
   */
  elastic?: boolean;
}

/** Where a card goes: its first column and row (from 0) and its size, in cells. */
export interface Placement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rows a card may grow past its largest size to close a hole between cards. */
const HOLE_SLACK = 1;

/** Cards the packer looks ahead through for one that fits a stretch, when it may reorder. */
const LOOK_AHEAD = 6;

/**
 * Places cards on a grid of `columns`, leaving no empty cell under any card.
 *
 * The packer always fills the lowest open stretch of the grid (the lowest run of columns at the
 * same height), left first, so nothing it places can have a hole beneath it. For each stretch it
 * takes the next card that fits — looking a few cards ahead when `reorder` allows — at its
 * preferred width, narrowed to the stretch or widened to fill it when nobody else could, and at a
 * height that lines up with its neighbour where that is within the card's range. Where no card fits
 * a stretch, a card beside it on the same row widens across it, or the cards above it grow down to
 * meet its neighbour; a stretch one row short of its neighbour is closed the same way.
 * At the end the cards on the bottom edge grow down, within their largest size, so the dashboard
 * ends square where it can. Locked cards keep their size; only a stretch that nothing fits and
 * nothing above can fill is left empty, level with its neighbour.
 */
export function pack(cards: readonly Packable[], columns: number, options: { reorder?: boolean } = {}): Placement[] {
  const look = options.reorder === false ? 1 : LOOK_AHEAD;
  const heights: number[] = new Array(columns).fill(0);
  const placed: Array<Placement & { card: Packable }> = [];
  const queue = cards.map((card) => ({ ...card, pref: bound(card.pref, columns), min: bound(card.min, columns), max: bound(card.max, columns) }));

  /** The lowest run of columns at one height, leftmost first. */
  const lowest = (): { x: number; w: number; y: number } => {
    const y = Math.min(...heights);
    const x = heights.indexOf(y);
    let w = 0;
    while (x + w < columns && heights[x + w] === y) w += 1;
    return { x, w, y };
  };
  /** How far the stretch is below the nearer of its neighbours; infinite when it has none. */
  const rise = (stretch: { x: number; w: number; y: number }): number => {
    const left = stretch.x > 0 ? (heights[stretch.x - 1] as number) : Number.POSITIVE_INFINITY;
    const right = stretch.x + stretch.w < columns ? (heights[stretch.x + stretch.w] as number) : Number.POSITIVE_INFINITY;
    return Math.min(left, right) - stretch.y;
  };
  /**
   * Grows every card resting on the stretch down by `by` rows, or none of them. `slack` lets a card
   * whose content grows into it pass its largest size by that many rows: a card a little taller than
   * it needs is better than a hole between cards, though not at the bottom edge, where a jagged end
   * is allowed.
   */
  const growDown = (stretch: { x: number; w: number; y: number }, by: number, slack = 0): boolean => {
    if (stretch.y === 0 || !Number.isFinite(by)) return false;
    const above = placed.filter((entry) => entry.y + entry.h === stretch.y && entry.x >= stretch.x && entry.x + entry.w <= stretch.x + stretch.w);
    const covered = above.reduce((sum, entry) => sum + entry.w, 0);
    if (covered !== stretch.w || above.some((entry) => entry.card.locked || entry.h + by > Math.min(MAX_CARD_ROWS, entry.card.max.h + (entry.card.elastic === true ? slack : 0)))) return false;
    for (const entry of above) entry.h += by;
    for (let column = stretch.x; column < stretch.x + stretch.w; column += 1) heights[column] = stretch.y + by;
    return true;
  };

  /**
   * Widens a card that starts on the stretch's row, right beside it, across the whole stretch: a
   * stretch too narrow for any card left becomes part of its neighbour rather than a hole.
   */
  const widenInto = (stretch: { x: number; w: number; y: number }): boolean => {
    const beside = placed.find((entry) => entry.y === stretch.y && !entry.card.locked && entry.w + stretch.w <= entry.card.max.w && (entry.x + entry.w === stretch.x || entry.x === stretch.x + stretch.w));
    if (beside === undefined) return false;
    if (beside.x === stretch.x + stretch.w) beside.x = stretch.x;
    beside.w += stretch.w;
    for (let column = stretch.x; column < stretch.x + stretch.w; column += 1) heights[column] = beside.y + beside.h;
    return true;
  };

  let guard = 0;
  while (queue.length > 0 && guard++ < 100_000) {
    const stretch = lowest();
    const step = rise(stretch);
    // A stretch one row short of its neighbour: the cards above grow into it rather than a card
    // starting a row lower and leaving the edge jagged.
    if (step === 1 && growDown(stretch, 1, HOLE_SLACK)) continue;
    // The first card that wants no more width than the stretch has; a card is squeezed down to its
    // smallest only when the stretch would otherwise be filled by a neighbour or left empty.
    const takes = (card: (typeof queue)[number], narrow: boolean) => (card.locked ? card.pref.w : narrow ? card.min.w : Math.min(card.pref.w, card.max.w)) <= stretch.w;
    const choose = (narrow: boolean, ahead: number): number => {
      for (let i = 0; i < Math.min(ahead, queue.length); i += 1) if (takes(queue[i] as (typeof queue)[number], narrow)) return i;
      return -1;
    };
    let index = choose(false, look);
    if (index === -1) {
      if (widenInto(stretch)) continue;
      if (growDown(stretch, step, HOLE_SLACK)) continue;
      // Sooner than leave a tall hole, the next card along that fits is taken, narrower than it
      // wants and out of the order given: that reads better than a gap in the middle of the page.
      // A gap of a single row at the end of a row is not worth cramping a card for — the row above
      // is levelled off instead, and the card goes where it fits.
      if (!Number.isFinite(step) || step > 1) index = choose(true, LOOK_AHEAD);
    }
    if (index === -1) {
      // Nothing fits and nothing above can grow: the stretch stays empty, level with its neighbour.
      const by = Number.isFinite(step) ? step : 1;
      for (let column = stretch.x; column < stretch.x + stretch.w; column += 1) heights[column] = stretch.y + by;
      continue;
    }
    const card = queue.splice(index, 1)[0] as (typeof queue)[number];
    let w = card.locked ? card.pref.w : Math.min(Math.max(card.pref.w, card.min.w), card.max.w, stretch.w);
    const leftover = stretch.w - w;
    // Widen to the end of the stretch when no card coming could use what is left of it.
    if (!card.locked && leftover > 0 && !queue.slice(0, look).some((next) => (next.locked ? next.pref.w : next.min.w) <= leftover)) w = Math.min(card.max.w, stretch.w);
    let h = card.pref.h;
    if (!card.locked) {
      // Line up with a neighbour's bottom, where that is a height this card can take.
      const reach = [stretch.x > 0 ? heights[stretch.x - 1] : undefined, stretch.x + w < columns ? heights[stretch.x + w] : undefined]
        .filter((bottom): bottom is number => bottom !== undefined && bottom > stretch.y)
        .map((bottom) => bottom - stretch.y)
        .filter((rows) => rows >= card.min.h && rows <= card.max.h && Math.abs(rows - card.pref.h) <= 2);
      if (reach.length > 0) h = reach.reduce((best, rows) => (Math.abs(rows - card.pref.h) < Math.abs(best - card.pref.h) ? rows : best));
    }
    placed.push({ id: card.id, x: stretch.x, y: stretch.y, w, h, card });
    for (let column = stretch.x; column < stretch.x + w; column += 1) heights[column] = stretch.y + h;
  }

  // What is left once every card is placed: holes between the cards close first, by growing the
  // cards above them or widening a neighbour; then the bottom edge is squared as far as it can be.
  const bottom = Math.max(0, ...heights);
  for (let pass = 0; pass < columns * 4; pass += 1) {
    const stretch = lowest();
    if (stretch.y >= bottom) break;
    const reach = rise(stretch);
    const step = Math.min(reach, bottom - stretch.y);
    // A hole with taller cards on both sides is worth a little more height than a card asked for;
    // the bottom edge, where a jagged end is allowed, is not.
    if (growDown(stretch, step, reach < bottom - stretch.y ? HOLE_SLACK : 0)) continue;
    if (widenInto(stretch)) continue;
    for (let column = stretch.x; column < stretch.x + stretch.w; column += 1) heights[column] = stretch.y + step;
  }
  return placed.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
}

function bound(size: CardSize, columns: number): CardSize {
  return { w: Math.min(columns, Math.max(1, size.w)), h: Math.min(MAX_CARD_ROWS, Math.max(1, size.h)) };
}

/** Columns the grid has at `width` pixels. A list layout always has one. */
export function effectiveColumns(width: number, columns: number, list = false): number {
  if (list || width < ONE_COLUMN_BELOW) return 1;
  if (width < FEWER_COLUMNS_BELOW) return columns >= 8 ? Math.round(columns / 3) : Math.max(1, Math.ceil(columns / 2));
  return columns;
}

/** A card's width on a grid that has `effective` of its `columns`. */
export function scaledWidth(w: number, columns: number, effective: number): number {
  if (effective >= columns) return Math.min(w, columns);
  return Math.min(effective, Math.max(1, Math.round((w * effective) / columns)));
}

/** A size as code or a request gives it: whole numbers within bounds, or a sentence saying what is wrong. */
export function checkSize(size: unknown, columns = MAX_GRID_COLUMNS): CardSize | string {
  if (size === null || typeof size !== "object" || Array.isArray(size)) return "a size is { w, h }";
  const { w, h } = size as { w?: unknown; h?: unknown };
  if (!Number.isInteger(w) || (w as number) < 1 || (w as number) > columns) return `w must be a whole number from 1 to ${columns}`;
  if (!Number.isInteger(h) || (h as number) < 1 || (h as number) > MAX_CARD_ROWS) return `h must be a whole number from 1 to ${MAX_CARD_ROWS}`;
  return { w: w as number, h: h as number };
}

/** A grid as code gives it, or a sentence saying what is wrong. */
export function checkGrid(grid: unknown): Partial<GridConfig> | string {
  if (grid === null || typeof grid !== "object" || Array.isArray(grid)) return "grid is { columns, rowHeight }";
  const { columns, rowHeight } = grid as { columns?: unknown; rowHeight?: unknown };
  const out: Partial<GridConfig> = {};
  if (columns !== undefined) {
    if (!Number.isInteger(columns) || (columns as number) < 1 || (columns as number) > MAX_GRID_COLUMNS) return `grid.columns must be a whole number from 1 to ${MAX_GRID_COLUMNS}`;
    out.columns = columns as number;
  }
  if (rowHeight !== undefined) {
    if (typeof rowHeight !== "number" || !Number.isFinite(rowHeight) || rowHeight < 24 || rowHeight > 400) return "grid.rowHeight must be a number of pixels from 24 to 400";
    out.rowHeight = rowHeight;
  }
  return out;
}

/**
 * A layout as it arrives from a browser or a request: kept where it makes sense, dropped where it
 * does not. Undefined when nothing usable is left. Bounded, so a stored layout cannot grow without
 * limit.
 */
export function readLayout(raw: unknown): PanelLayout | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: PanelLayout = {};
  let entries = 0;
  for (const [group, value] of Object.entries(raw as Record<string, unknown>)) {
    if (entries >= MAX_LAYOUT_ENTRIES || typeof group !== "string" || group.length > 200) break;
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const { order, sizes } = value as { order?: unknown; sizes?: unknown };
    const kept: GroupLayout = {};
    if (Array.isArray(order)) {
      kept.order = order.filter((id): id is string => typeof id === "string" && id.length <= 300).slice(0, MAX_LAYOUT_ENTRIES - entries);
      entries += kept.order.length;
    }
    if (sizes !== null && typeof sizes === "object" && !Array.isArray(sizes)) {
      const keptSizes: Record<string, CardSize> = {};
      for (const [id, size] of Object.entries(sizes as Record<string, unknown>)) {
        if (entries >= MAX_LAYOUT_ENTRIES || id.length > 300) break;
        const checked = checkSize(size);
        if (typeof checked === "string") continue;
        keptSizes[id] = checked;
        entries += 1;
      }
      if (Object.keys(keptSizes).length > 0) kept.sizes = keptSizes;
    }
    if (kept.order !== undefined || kept.sizes !== undefined) out[group] = kept;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
