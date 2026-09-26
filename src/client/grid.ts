/**
 * A group's grid of cells, drawn: cards packed without holes (src/panel/layout.ts), at explicit
 * columns and rows, the column count following the grid's own width.
 *
 * Positions and sizes go through custom properties set with the CSSOM (`--apb-x`, `--apb-y`,
 * `--apb-w`, `--apb-h`), which the page's CSP allows where a `style` attribute would be refused, and
 * the stylesheet turns them into grid lines. The cards are kept in the document in the order they
 * are seen, so Tab walks them as the eye does. Each card is told how much room it has on the screen
 * (`data-detail`: brief, normal or full), and shows as much as fits.
 *
 * Without a layout the cards are gathered by kind and the packer may reorder them a little to fill
 * the grid. With one — saved, or made by arranging — the order is kept, and the sizes it names are
 * kept; the others are still sized to fill the space.
 */
import type { CardSize, GridShape, GroupLayout } from "../types.js";
import { effectiveColumns, gather, MAX_CARD_ROWS, type Packable, pack, type Placement, scaledWidth, type Sizing } from "../panel/layout.js";

export interface Placed {
  id: string;
  element: HTMLElement;
  /** How it may be sized, on the grid's full columns. */
  sizing: Sizing;
  /** Its name, for gathering cards whose names start alike. */
  label: string;
}

/** Every grid by its element, so a tab being shown can measure the grids in it. */
const views = new WeakMap<Element, GridView>();

/** Where a card's level of detail starts, before what it holds is measured. In CSS pixels. */
const BRIEF_BELOW = { width: 190, height: 140 };
const FULL_FROM = { width: 540, height: 330 };
/** How much a card may show. */
const LEVELS = ["brief", "normal", "full"] as const;
type Level = (typeof LEVELS)[number];
/**
 * Passes of measuring and adjusting levels before the page is left as it is: enough for a card to
 * shed what it need not show, twice, and then ask for the rows it still wants.
 */
const FIT_PASSES = 4;
/** How often a grid looks at whether what arrived still fits the cards it arrived on. */
const CHECK_EVERY_MS = 500;
/** What is done with a card, as opposed to read from it: where the foot of a card begins. */
const DOING = ".apb-editor, .apb-inputs, .apb-profile-settings, .apb-button, .apb-why, .apb-when, .apb-toolbar";

/** What a drawing is assumed to have wanted where that is not known, and the slack around both. */
/** Rows to spare over what a card holds, past which its parts stay together rather than spreading. */
const ROOM_APART = 3;
const DRAWING_BACK = 180;
const DRAWING_BAND = 8;

export class GridView {
  /** The view drawing `element`, if one is. */
  static of(element: Element): GridView | undefined {
    return views.get(element);
  }

  /** Columns the grid has now; its full count until it has been measured. */
  private effective: number;
  private cards: Placed[] = [];
  private order: string[] = [];
  /** Sizes somebody chose — saved, or set while arranging — by card id, on the full columns. */
  private readonly fixed = new Map<string, CardSize>();
  /** Whether the order is the automatic one, which the packer may bend to fill the grid. */
  private automatic = true;
  /**
   * Whether the automatic order has been settled for the columns there are. It is worked out once,
   * and kept: a card whose content grows — a table that loaded, a field that opened — must not send
   * every card on the tab to a new place while somebody is using one.
   */
  private settled = false;

  /** Whether a first fitting has been through: until then the cards are packed, not only reflowed. */
  private fitted = false;

  /** When the cards were last looked at for content that no longer fits. */
  private checked = 0;
  /** Elements standing in for cards, while a card is lifted out to be dragged. */
  private readonly standIns = new Map<string, HTMLElement>();
  /** Where each card was put last, by id. */
  private placements = new Map<string, Placement>();
  /** Rows each card needs for what it shows, measured on the page: the packer gives none fewer. */
  private readonly needs = new Map<string, number>();
  /** Levels up or down from what a card's size suggests, from measuring what it holds. */
  private readonly adjusted = new Map<string, number>();
  private fitting = false;
  private refit = 0;
  /** Watches what the cards hold, so a table that loads or a chart that draws is measured again. */
  private readonly watcher: ResizeObserver | undefined =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          cancelAnimationFrame(this.refit);
          this.refit = requestAnimationFrame(() => this.fit());
        })
      : undefined;

  constructor(
    readonly element: HTMLElement,
    readonly shape: GridShape,
    private readonly list: boolean,
  ) {
    this.effective = list ? 1 : shape.columns;
    element.style.setProperty("--apb-row", `${shape.rowHeight}px`);
    element.style.setProperty("--apb-cols", String(this.effective));
    element.toggleAttribute("data-single", this.effective === 1);
    views.set(element, this);
    // Opening or closing something on a card — the numbers behind a chart, a reason, a schedule —
    // changes what the card holds. `toggle` does not bubble, so it is heard on the way down.
    element.addEventListener("toggle", () => {
      cancelAnimationFrame(this.refit);
      this.refit = requestAnimationFrame(() => this.fit());
    }, true);
    // Measured when drawn and when its tab is shown (see render.ts), so it is never painted at the
    // wrong column count; a later resize is taken on the next frame. Changing the columns changes
    // the grid's own height, and doing that inside the observer's callback makes it call again.
    if (typeof ResizeObserver === "function") {
      let frame = 0;
      new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => this.measure());
      }).observe(element);
    }
  }

  /** Columns at full width. */
  get columns(): number {
    return this.shape.columns;
  }

  /** Columns now. */
  get current(): number {
    return this.effective;
  }

  /**
   * Takes the cards, and the layouts that arrange them, highest first: the first that gives an
   * order is kept, and each card takes the size the first layout that names it gives.
   */
  place(cards: readonly Placed[], layouts: ReadonlyArray<GroupLayout | undefined> = []): void {
    this.watcher?.disconnect();
    this.cards = [...cards];
    for (const card of cards) {
      const body = card.element.querySelector(".apb-card-body");
      if (body !== null) this.watcher?.observe(body);
    }
    this.fixed.clear();
    for (const card of cards) {
      const size = layouts.find((layout) => layout?.sizes?.[card.id] !== undefined)?.sizes?.[card.id];
      if (size !== undefined) this.fixed.set(card.id, size);
    }
    this.settled = false;
    this.fitted = false;
    const given = layouts.find((layout) => layout?.order !== undefined && layout.order.length > 0)?.order;
    if (given === undefined) this.reset(false);
    else {
      const rank = new Map(given.map((id, index) => [id, index]));
      this.order = cards
        .map((card, index) => ({ id: card.id, index, rank: rank.get(card.id) ?? Number.POSITIVE_INFINITY }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map((card) => card.id);
      this.automatic = false;
    }
    this.layout();
    // A chart draws and a table loads after the cards are placed, and neither changes the box the
    // grid gave the card: the cards are looked at again once what they hold has arrived.
    for (const wait of [400, 1200]) setTimeout(() => this.check(), wait);
  }

  /** Back to the automatic layout: gathered by kind, sized to fill. `keepSizes` keeps the chosen sizes. */
  reset(draw = true, keepSizes = false): void {
    if (!keepSizes) this.fixed.clear();
    this.settled = false;
    this.fitted = false;
    this.order = gather(this.cards.map((card) => ({ id: card.id, label: card.label, family: card.sizing.family }))).map((card) => card.id);
    this.automatic = true;
    if (draw) this.layout();
  }

  /** The cards in declaration order. */
  declared(): Placed[] {
    return [...this.cards];
  }

  /** Whether nothing has been chosen: the order and sizes are the automatic ones. */
  isAutomatic(): boolean {
    return this.automatic && this.fixed.size === 0;
  }

  /** The cards as seen, first to last, each with its element and the size it has. */
  arrangement(): Array<Placed & { size: CardSize }> {
    const byId = new Map(this.cards.map((card) => [card.id, card]));
    return [...this.placements.values()]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((place) => byId.get(place.id))
      .filter((card): card is Placed => card !== undefined)
      .map((card) => ({ ...card, size: this.sizeOf(card.element) ?? card.sizing.pref }));
  }

  /** What to save: the order as seen, and the sizes somebody chose. */
  saved(): GroupLayout {
    return { order: this.arrangement().map((card) => card.id), sizes: Object.fromEntries(this.fixed) };
  }

  /** The size a card has on the full columns: what was chosen, or what it was given here. */
  sizeOf(element: HTMLElement): CardSize | undefined {
    const card = this.cards.find((entry) => entry.element === element);
    if (card === undefined) return undefined;
    const chosen = this.fixed.get(card.id) ?? (card.sizing.locked ? card.sizing.pref : undefined);
    if (chosen !== undefined) return chosen;
    const place = this.placements.get(card.id);
    if (place === undefined) return card.sizing.pref;
    // Packed on fewer columns, a card's width is reported on the full ones.
    return { w: this.effective === this.columns ? place.w : card.sizing.pref.w, h: place.h };
  }

  /** Gives one card a size somebody chose, within the grid's bounds, and packs again. */
  resize(element: HTMLElement, size: CardSize): CardSize {
    const card = this.cards.find((entry) => entry.element === element);
    const bounded = { w: Math.min(this.columns, Math.max(1, Math.round(size.w))), h: Math.min(MAX_CARD_ROWS, Math.max(1, Math.round(size.h))) };
    if (card === undefined) return bounded;
    this.fixed.set(card.id, bounded);
    this.layout();
    return bounded;
  }

  /** Moves a card before or after another in the order, keeping every other card's place, and packs again. */
  move(id: string, beside: string, after: boolean): void {
    if (id === beside) return;
    const seen = this.arrangement().map((card) => card.id);
    const order = seen.filter((entry) => entry !== id);
    const at = order.indexOf(beside);
    if (at === -1) return;
    order.splice(after ? at + 1 : at, 0, id);
    this.order = order;
    this.automatic = false;
    this.layout();
  }

  /** Moves a card one place earlier (-1) or later (+1) in the order as seen. */
  step(id: string, by: -1 | 1): void {
    const seen = this.arrangement().map((card) => card.id);
    const at = seen.indexOf(id);
    const other = seen[at + by];
    if (other !== undefined) this.move(id, other, by > 0);
  }

  /** Puts `stand` where the card `id` is, until `unstand`: the card itself can then leave the grid to be dragged. */
  stand(id: string, stand: HTMLElement): void {
    this.standIns.set(id, stand);
    this.element.append(stand);
    this.layout();
  }

  unstand(id: string): void {
    this.standIns.get(id)?.remove();
    this.standIns.delete(id);
    this.layout();
  }

  /** How many columns and rows a distance on the screen is, for dragging a card's corner; on the full columns. */
  cells(dx: number, dy: number): { columns: number; rows: number } {
    const { column, row } = this.pitch();
    return { columns: Math.round((dx / Math.max(1, column)) * (this.columns / this.effective)), rows: Math.round(dy / Math.max(1, row)) };
  }

  /** Takes the column count the grid's width allows now, and packs again when it changed. */
  measure(): void {
    const width = this.element.clientWidth;
    // A hidden tab has no width; it is measured again when it is shown.
    if (width === 0) return;
    const effective = effectiveColumns(width, this.columns, this.list);
    if (effective === this.effective) {
      this.detail();
      return;
    }
    this.effective = effective;
    this.element.style.setProperty("--apb-cols", String(effective));
    this.element.toggleAttribute("data-single", effective === 1);
    // Another number of columns is another arrangement: the automatic order is worked out again.
    this.settled = false;
    this.fitted = false;
    this.layout();
  }

  /** The rows each card was asking for when it was last laid out, to tell growth from shrinking. */
  private given = new Map<string, number>();

  /** Packs the cards for the columns there are now, and puts each where it goes. */
  layout(): void {
    const scale = (size: CardSize): CardSize => ({ w: scaledWidth(size.w, this.columns, this.effective), h: size.h });
    const byId = new Map(this.cards.map((card) => [card.id, card]));
    const packable: Packable[] = [];
    for (const id of this.order) {
      const card = byId.get(id);
      if (card === undefined) continue;
      // Never fewer rows than what the card shows needs: a row stretched by one card stretches its neighbours.
      const need = Math.min(MAX_CARD_ROWS, this.needs.get(id) ?? 0);
      // Folded away, a card is its heading and nothing else: it takes the rows that takes, whatever
      // size it was given or chose.
      const folded = card.element.querySelector<HTMLElement>(".apb-card-body")?.hidden === true;
      const chosen = this.fixed.get(id) ?? (card.sizing.locked ? card.sizing.pref : undefined);
      if (chosen !== undefined) {
        const full = scale(chosen);
        const size = folded ? { w: full.w, h: Math.max(1, Math.min(need, full.h)) } : full;
        packable.push({ id, pref: size, min: size, max: size, locked: true });
      } else {
        const grow = (size: CardSize): CardSize => (folded ? { w: size.w, h: Math.max(1, need) } : { w: size.w, h: Math.max(size.h, need) });
        // A gauge holds nothing that grows, whatever family it keeps; a chart, a table or a feed does.
        const elastic = (card.sizing.family === "chart" || card.sizing.family === "list") && card.element.querySelector(".apb-gauge-track") === null;
        packable.push({ id, pref: grow(scale(card.sizing.pref)), min: grow(scale(card.sizing.min)), max: grow(scale(card.sizing.max)), locked: false, elastic });
      }
    }
    // Growing content moves cards down, it does not rearrange the page: a card told to show more —
    // the numbers behind a chart opened, a longer reading — keeps its column and its width, and what
    // is under it moves down. Everything else packs afresh.
    const reflowing = this.fitting && this.fitted && this.placements.size === packable.length;
    const placements = reflowing ? this.reflow(packable) : pack(packable, this.effective, { reorder: this.automatic && !this.settled });
    if (this.fitting) this.fitted = true;
    this.placements = new Map(placements.map((place) => [place.id, place]));
    if (this.automatic && !this.settled) {
      this.order = [...placements].sort((a, b) => a.y - b.y || a.x - b.x).map((place) => place.id);
      this.settled = true;
    }
    for (const place of placements) {
      const element = this.standIns.get(place.id) ?? byId.get(place.id)?.element;
      if (element === undefined) continue;
      element.style.setProperty("--apb-x", String(place.x + 1));
      element.style.setProperty("--apb-y", String(place.y + 1));
      element.style.setProperty("--apb-w", String(place.w));
      element.style.setProperty("--apb-h", String(place.h));
      const card = byId.get(place.id) as Placed;
      const size = this.sizeOf(card.element) ?? card.sizing.pref;
      card.element.dataset.size = `${size.w}×${size.h}`;
    }
    this.given = new Map(this.cards.map((card) => [card.id, this.needs.get(card.id) ?? 0]));
    this.inOrder(placements, byId);
    this.detail();
    if (!this.fitting) this.fit();
  }

  /** A card too small for what it holds shows less and scrolls the rest. */
  private scrolls(element: HTMLElement, scrolling: boolean): void {
    element.toggleAttribute("data-tight", scrolling);
  }

  /** Fits the cards again, now, whatever they hold: something was folded away, or opened. */
  fitAgain(): void {
    if (this.element.clientWidth === 0) return;
    cancelAnimationFrame(this.refit);
    this.refit = requestAnimationFrame(() => this.fit());
  }

  /**
   * Fits the cards again when one of them no longer holds what it was given: content can arrive
   * without anybody clicking anything, and a card's own box does not change when it does.
   */
  check(): void {
    // Reading a card's scroll height costs a layout: at most twice a second, whatever arrives.
    const now = Date.now();
    if (this.element.clientWidth === 0 || now - this.checked < CHECK_EVERY_MS) return;
    this.checked = now;
    const over = this.cards.some((card) => {
      const body = card.element.querySelector<HTMLElement>(".apb-card-body");
      return body !== null && !body.hidden && body.scrollHeight > body.clientHeight;
    });
    // Whatever scrolls is reachable at once, whether or not fitting the cards again can help it.
    this.reachable();
    if (!over) return;
    cancelAnimationFrame(this.refit);
    this.refit = requestAnimationFrame(() => this.fit());
  }

  /**
   * The cards as they now stand: what the treatments cost is checked against the room there is —
   * a card given more space around its reading, or a bigger number, that no longer holds what it
   * shows keeps the plain layout — and whatever still scrolls takes the keyboard, so what is below
   * the fold of a card can be reached by it.
   */
  private settle(): void {
    // Numbers standing in for a chart are given the room the chart had, less the words above them,
    // and scroll within it: a <details> cannot be asked to shrink what it holds by style alone.
    for (const card of this.cards) {
      const view = card.element.querySelector<HTMLElement>(".apb-table-view[open]");
      const wrap = view?.querySelector<HTMLElement>(".apb-table-wrap");
      if (view === null || wrap === undefined || wrap === null) continue;
      if (card.element.dataset.numbers !== "instead") wrap.style.removeProperty("--apb-room");
      else {
        // The room between the top of the numbers and the bottom of the fold, less what the box
        // itself takes: its border, and a scrollbar along the bottom where the table is wide.
        const edges = wrap.offsetHeight - wrap.clientHeight;
        wrap.style.setProperty("--apb-room", `${Math.max(0, Math.floor(view.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top - edges))}px`);
      }
    }
    const bodies = this.cards.map((card) => ({ card, body: card.element.querySelector<HTMLElement>(".apb-card-body") }));
    for (const { card, body } of bodies) {
      if (body === null || body.hidden) continue;
      if (card.element.dataset.room !== undefined && body.scrollHeight > body.clientHeight) card.element.removeAttribute("data-room");
    }
    this.foot(bodies);
    this.reachable();
  }

  /**
   * Where a card has room to spare and nothing in it grows, what is read stays at the top and what
   * is done with the card — a field, a button, a schedule — goes to the foot of it. This marks where
   * the doing starts; the stylesheet pushes it, and everything after it, down.
   */
  private foot(bodies: ReadonlyArray<{ card: Placed; body: HTMLElement | null }>): void {
    const seen = (node: Element): boolean => (node as HTMLElement).getClientRects().length > 0;
    for (const { card, body } of bodies) {
      if (body === null) continue;
      for (const marked of Array.from(body.querySelectorAll("[data-foot]"))) marked.removeAttribute("data-foot");
      const room = card.element.dataset.room;
      if (room === "ends") {
        const doing = Array.from(body.children).find((kid) => kid.matches(DOING) || kid.querySelector(DOING) !== null);
        if (doing !== undefined) (doing as HTMLElement).dataset.foot = "";
      } else if (room === "top") {
        // A card of a reading and nothing else: what it says about the number goes to the foot.
        const shown = Array.from(body.children).filter(seen);
        const reading = shown.length === 1 && shown[0]?.classList.contains("apb-reading") ? (shown[0] as HTMLElement) : undefined;
        const parts = reading === undefined ? [] : Array.from(reading.children).filter(seen);
        const last = parts.length > 1 ? (parts[parts.length - 1] as HTMLElement) : undefined;
        if (last !== undefined && (last.classList.contains("apb-meta") || last.classList.contains("apb-stats"))) last.dataset.foot = "";
      }
    }
  }

  /** What scrolls takes the keyboard, so what is below the fold of a card can be reached by it. */
  private reachable(): void {
    for (const card of this.cards) {
      const body = card.element.querySelector<HTMLElement>(".apb-card-body");
      if (body === null || body.hidden) continue;
      if (body.scrollHeight > body.clientHeight) body.tabIndex = 0;
      else body.removeAttribute("tabindex");
    }
  }

  /**
   * The same columns and widths as now, with the rows worked out again from the top: a card whose
   * content grew takes the rows it needs and the cards under it follow, rather than the page being
   * packed again around it.
   */
  private reflow(packable: readonly Packable[]): Placement[] {
    const bottoms = new Array<number>(this.effective).fill(0);
    const placements: Placement[] = [];
    // Down the page, then across: the order the cards are read in is the order they settle in.
    const order = [...packable].sort((a, b) => (this.placements.get(a.id)?.y ?? 0) - (this.placements.get(b.id)?.y ?? 0) || (this.placements.get(a.id)?.x ?? 0) - (this.placements.get(b.id)?.x ?? 0));
    for (const card of order) {
      const was = this.placements.get(card.id);
      if (was === undefined) return pack(packable, this.effective, { reorder: false });
      // More to show: the rows it now asks for, on top of the rows it was given. Less: back to the
      // size it would have been packed at, so closing what was opened gives the room back.
      const shrank = (this.needs.get(card.id) ?? 0) < (this.given.get(card.id) ?? 0);
      const h = card.locked || shrank ? card.pref.h : Math.min(MAX_CARD_ROWS, Math.max(was.h, card.pref.h));
      const columns = bottoms.slice(was.x, was.x + was.w);
      const y = Math.max(0, ...columns);
      for (let column = was.x; column < was.x + was.w; column += 1) bottoms[column] = y + h;
      placements.push({ id: card.id, x: was.x, y, w: was.w, h });
    }
    return placements;
  }

  /**
   * Fits what each card shows to the room it has, by measuring how tall it is when it is only as
   * tall as what it holds. Every card is measured at once: two layouts a pass, not one per card.
   *
   * A card that may grow asks the packer for the rows it needs. A card that may not — its size was
   * set in code or chosen on the page, or it is already at its largest — shows less instead: one
   * level down, and if it is still short, what it holds scrolls inside it rather than stretching
   * the row and every card beside it. A card with a row or more to spare shows more, and spreads
   * what it shows over the room it has. Not while arranging, where rows are held on purpose.
   */
  private fit(): void {
    if (this.element.clientWidth === 0) return;
    // While arranging, what a card shows still follows the size being chosen; the packing does not,
    // so the cards stay where the hands left them.
    const arranging = this.element.closest("[data-arranging]") !== null;
    // One card to a row: nothing beside it to stretch, so it is as tall as what it holds.
    const single = this.effective === 1;
    const { row, rowGap } = this.pitch();
    // Worked out afresh every time: a card that was short at one size shows everything again at a
    // larger one, rather than carrying the level it was dropped to.
    this.adjusted.clear();
    this.detail();
    let packAgain = false;
    for (let pass = 0; pass < FIT_PASSES; pass += 1) {
      const cards = this.cards.filter((card) => this.standIns.get(card.id) === undefined && this.placements.has(card.id));
      for (const card of cards) {
        // Measured as if nothing scrolled: a card already scrolling would measure as tall as its room.
        this.scrolls(card.element, false);
        // Measured without the treatments a size earns, so the height read is the card's own: the
        // numbers behind a chart are measured under it, which is where they go when there is room.
        card.element.removeAttribute("data-room");
        card.element.removeAttribute("data-grow");
        card.element.removeAttribute("data-numbers");
        card.element.style.setProperty("align-self", "start");
      }
      const heights = cards.map((card) => card.element.offsetHeight);
      for (const card of cards) card.element.style.removeProperty("align-self");
      let levelsChanged = false;
      cards.forEach((card, index) => {
        const place = this.placements.get(card.id) as Placement;
        const needed = Math.max(1, Math.ceil(((heights[index] ?? 0) + rowGap) / row));
        const level = LEVELS.indexOf(this.levelOf(card.id, place));
        /*
         * Anything opened on a card is held by the card itself, so that nothing on the page moves
         * while somebody reads it. The room comes, in this order, from what the card has spare, from
         * the drawing the numbers can stand in for, and from what the card need not show — its
         * description, what it says about its reading. What is left over scrolls inside the card.
         */
        const opened = !arranging && card.element.querySelector("details[open]") !== null;
        if (opened) {
          const numbers = card.element.querySelector(".apb-chart > .apb-table-view[open]") !== null;
          // Not below the level that would hide what was opened: that would take it away again.
          const floor = card.element.querySelector(".apb-timeline[open]") === null ? 0 : 1;
          if (needed <= place.h) this.scrolls(card.element, false);
          else if (numbers) card.element.dataset.numbers = "instead";
          else if (level > floor) {
            this.adjusted.set(card.id, (this.adjusted.get(card.id) ?? 0) - 1);
            levelsChanged = true;
          } else this.scrolls(card.element, true);
          return;
        }
        // A card set in code or by a hand grows back to the size it was given, and no further; one
        // folded away has been packed to its heading, and that is not the size it may grow to.
        const chosen = this.fixed.get(card.id) ?? (card.sizing.locked ? card.sizing.pref : undefined);
        const ceiling = arranging ? place.h : Math.max(place.h, chosen === undefined ? card.sizing.max.h : chosen.h);
        const canGrow = needed <= ceiling;
        if (!arranging && canGrow && needed !== this.needs.get(card.id)) {
          this.needs.set(card.id, needed);
          packAgain = true;
        }
        // A card that may grow asks for the rows instead of showing less; one that may not shows less.
        const short = !single && needed > place.h && !canGrow;
        // The room a drawing takes is the first thing to give way: a chart squeezed into a box too
        // small to read says nothing, where the numbers beside it still do. It is drawn again when
        // the card has the room back, with a little slack so a card on the edge does not flicker.
        const slack = place.h * row + (place.h - 1) * rowGap - (heights[index] ?? 0);
        const plot = card.element.querySelector<HTMLElement>(".apb-chart > .apb-chart-body");
        // Only where the card still says something without it: a chart of keys is the whole card,
        // and dropping it would leave a heading and nothing under it.
        const says = card.element.querySelector<HTMLElement>(".apb-value");
        const drawable = plot !== null && plot.querySelector(".apb-plot-sparkline") === null && says !== null && says.getClientRects().length > 0;
        const tall = place.h * row + (place.h - 1) * rowGap;
        // Room again for what the card was asking for while it was drawing: it draws again.
        if (drawable && card.element.dataset.drawing === "off" && tall >= Number(card.element.dataset.drew ?? DRAWING_BACK) + DRAWING_BAND) {
          card.element.removeAttribute("data-drawing");
          card.element.removeAttribute("data-drew");
          levelsChanged = true;
          return;
        }
        if (short && level > 0) {
          this.adjusted.set(card.id, (this.adjusted.get(card.id) ?? 0) - 1);
          levelsChanged = true;
        } else if (short && drawable && card.element.dataset.drawing !== "off") {
          // Nothing left to drop but the drawing, and a drawing squeezed into a box too small to
          // read says nothing the numbers beside it do not. What the card wanted is remembered.
          card.element.dataset.drew = String(Math.round(heights[index] ?? 0));
          card.element.dataset.drawing = "off";
          levelsChanged = true;
          return;
        } else if (!short && needed <= place.h - 2 && level < LEVELS.length - 1) {
          this.adjusted.set(card.id, (this.adjusted.get(card.id) ?? 0) + 1);
          levelsChanged = true;
        }
        // Still short at its briefest: what it holds scrolls, so one card cannot stretch the row.
        this.scrolls(card.element, short && level === 0);
        // Room to spare: a card holding a reading alone centres it and lets the number grow; one
        // holding more spreads what it holds over the room. A chart already grows into it.
        // A whole row of slack: what a card does with room to spare — more space around its reading,
        // a bigger number — takes room of its own.
        const spare = !short && slack >= row && card.element.querySelector(".apb-chart .apb-plot:not(.apb-plot-sparkline)") === null;
        // A gauge is a reading with a bar under it, not something that grows into the room.
        const gauge = card.element.querySelector(".apb-gauge-track") !== null;
        // A chart that is not being drawn is not something that grows, and leaves the card a reading.
        const drawing = card.element.dataset.drawing !== "off" && card.element.querySelector(".apb-chart") !== null;
        const grows = !gauge && (drawing || card.element.querySelector(".apb-table-wrap, .apb-feed-list") !== null);
        const alone = !drawing && card.element.querySelector(".apb-editor, .apb-table-wrap, .apb-feed-list, .apb-inputs, .apb-profile-settings, .apb-button") === null;
        // What grows takes the room; a reading, with or without a bar under it, keeps to the top of
        // the card and its number grows; a card with something to do on it puts that at the foot.
        // Anchoring is not a hole: past a few rows to spare, a card whose parts are a reading and
        // something to do with it keeps them together at the top, rather than at opposite edges of
        // a box far bigger than either.
        if (spare) card.element.dataset.room = grows ? "spread" : alone || gauge ? "top" : slack > row * ROOM_APART ? "near" : "ends";
        // How much bigger the reading may be drawn: by the rows the card has over what it needs, in
        // steps, so that a card whose content wanders by a few pixels does not resize its number.
        if (spare && !grows && (alone || gauge)) card.element.dataset.grow = slack >= row * 3 ? "3" : slack >= row * 1.8 ? "2" : "1";
      });
      if (!levelsChanged) break;
      this.detail();
    }
    if (!packAgain) {
      this.settle();
      return;
    }
    this.fitting = true;
    this.layout();
    this.fitting = false;
    this.settle();
  }

  /** Keeps the cards in the document in the order they are seen; focus stays where it was. */
  private inOrder(placements: readonly Placement[], byId: ReadonlyMap<string, Placed>): void {
    const wanted = [...placements]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((place) => this.standIns.get(place.id) ?? byId.get(place.id)?.element)
      .filter((element): element is HTMLElement => element !== undefined);
    const now = Array.from(this.element.children).filter((child) => wanted.includes(child as HTMLElement));
    if (now.length === wanted.length && now.every((child, index) => child === wanted[index])) return;
    const root = this.element.getRootNode() as Document | ShadowRoot;
    const focused = root.activeElement;
    for (const element of wanted) this.element.append(element);
    if (focused instanceof HTMLElement && this.element.contains(focused) && root.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  /** Tells each card how much room it has on the screen now. */
  private detail(): void {
    if (this.element.clientWidth === 0) return;
    for (const [id, place] of this.placements) {
      const card = this.cards.find((entry) => entry.id === id);
      if (card !== undefined) card.element.dataset.detail = this.levelOf(id, place);
    }
  }

  /** What a card shows: what its size suggests, moved by what measuring found it needs. */
  private levelOf(id: string, place: Placement): Level {
    const { column, row, gap, rowGap } = this.pitch();
    const width = place.w * column - gap;
    const height = place.h * row - rowGap;
    const base = width < BRIEF_BELOW.width || height < BRIEF_BELOW.height ? 0 : width >= FULL_FROM.width && height >= FULL_FROM.height ? 2 : 1;
    // Nothing is raised to full on a card too narrow to lay it out.
    const ceiling = width >= FULL_FROM.width ? 2 : 1;
    return LEVELS[Math.max(0, Math.min(ceiling, base + (this.adjusted.get(id) ?? 0)))] as Level;
  }

  /** One column and one row, gap included, in CSS pixels. */
  private pitch(): { column: number; row: number; gap: number; rowGap: number } {
    const style = getComputedStyle(this.element);
    const gap = Number.parseFloat(style.columnGap) || 0;
    const rowGap = Number.parseFloat(style.rowGap) || 0;
    const column = (this.element.clientWidth - gap * (this.effective - 1)) / this.effective + gap;
    return { column, row: this.shape.rowHeight + rowGap, gap, rowGap };
  }
}
