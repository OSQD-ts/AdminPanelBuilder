/**
 * The panel's screens: a header, a search box, one tab per group, a Pinned tab when anything is
 * pinned, search results while there is a query, and an Activity tab. In compact mode (an element
 * or fragment showing one group inside somebody else's page), only the groups' cards.
 *
 * Built once per schema, then updated in place on every update: a value's text changes, its
 * editor is told the new value (and ignores it while somebody is typing), and only the charts,
 * tables and feeds on the visible tab are redrawn. Rebuilding every card on every update would
 * take a text selection, an open table view and the keyboard focus with it once a second.
 *
 * This module holds the tabs and what moves between them. The cards are in `cards.ts`, the
 * Activity tab in `activity.ts`, the shortcuts and the go-to list in `palette.ts`, and the voice
 * that says a value turned bad in `announce.ts`.
 *
 * A card can appear in more than one place — its group, Pinned, search results — so every card is
 * built by one function and registered, and an update reaches every copy.
 *
 * Ids are the contract between this module and the stylesheet and tests: tabs are
 * `<prefix>-tab-<id>` wired to `<prefix>-pane-<id>` with `aria-controls`, and the prefix is unique
 * per mounted panel so two panels on one page never share an id.
 */
import type { ChartSchema, GridShape, GroupLayout, ItemSchema, PanelSchema, Status, ValueSchema } from "../types.js";
import { type Sizing, sizingOf } from "../panel/layout.js";
import { buildActivity } from "./activity.js";
import { type Announcer, createAnnouncer } from "./announce.js";
import { buildFeed } from "./blocks.js";
import { actionCard, type Card, type CardHost, frame, profileCard, valueCard } from "./cards.js";
import { clear, el, flash, uid } from "./dom.js";
import { said } from "./explain.js";
import type { Translate } from "./i18n.js";
import { type Destination, installShortcuts, type Shortcuts } from "./palette.js";
import { GridView, type Placed } from "./grid.js";
import type { Prefs } from "./prefs.js";
import { buildSettings } from "./settings.js";
import { type Arranging, startArranging } from "./arrange.js";
import { extras } from "./registry.js";
import { type Store, serverTime } from "./store.js";
import type { ViewDeps } from "./view-deps.js";

export type { ViewDeps } from "./view-deps.js";

interface TabEntry {
  id: string;
  tab: HTMLButtonElement;
  pane: HTMLElement;
  cards: Card[];
}

const ACTIVITY = "activity";
const PINNED = "pinned";
const RESULTS = "results";

export class View implements CardHost {
  private readonly prefix = uid("panel");
  private readonly tabs: TabEntry[] = [];
  private active = "";
  private status!: HTMLElement;
  /** The status sentence again, above the cards, while what they show may be out of date. */
  private stale: HTMLElement | undefined;
  private search!: HTMLInputElement;
  private tablist!: HTMLElement;
  private nav!: HTMLElement;
  private arranging: Arranging | undefined;
  private arrange: HTMLButtonElement | undefined;
  /** A structure that arrived while arranging, drawn once it ends. */
  private held: Store | undefined;
  /** Each group's grid, by group id, for arranging cards on the page. */
  readonly grids = new Map<string, GridView>();
  /** Where the page was scrolled when each tab was left, so going back returns there. */
  private readonly scrolled = new Map<string, number>();
  private main!: HTMLElement;
  private activity: { show(): void } | undefined;
  private announcer: Announcer;
  private shortcuts: Shortcuts | undefined;
  readonly items = new Map<string, { item: ItemSchema; group: string }>();
  readonly values = new Map<string, ValueSchema>();
  readonly prefs: Prefs;
  private query = "";

  constructor(
    readonly deps: ViewDeps,
    private current: Store,
  ) {
    this.prefs = deps.prefs;
    this.announcer = createAnnouncer(deps.t);
  }

  get t(): Translate {
    return this.deps.t;
  }

  store(): Store {
    return this.current;
  }

  pinsChanged(): void {
    this.rebuildPinned();
  }

  foldedCard(): void {
    for (const view of this.grids.values()) view.fitAgain();
  }

  /** Draws everything from the store's schema. Called again only when the schema's structure changes. */
  build(store: Store): void {
    // While cards are being arranged the page holds still: a new structure waits for arranging to end.
    if (this.arranging !== undefined) {
      this.held = store;
      return;
    }
    this.current = store;
    const { container } = this.deps;
    const previous = this.active;
    clear(container);
    this.tabs.length = 0;
    this.items.clear();
    this.values.clear();
    const schema = store.schema;
    for (const group of schema.groups) {
      for (const item of group.items) {
        this.items.set(`${item.type}:${item.id}`, { item, group: group.id });
        if (item.type === "value") this.values.set(item.id, item);
      }
    }
    this.applyPrefs();
    this.grids.clear();
    if (this.deps.compact) return this.buildCompact(store);
    const t = this.t;

    const header = el("header", "apb-header");
    // Inside the banner rather than before it: still the first thing a keyboard reaches, and
    // not a piece of the page outside every landmark, which an axe pass flagged.
    if (this.deps.standalone) {
      const skip = el("a", "apb-skip", t("skip"));
      skip.href = `#${this.prefix}-main`;
      header.append(skip);
    }
    header.append(el("h1", "apb-title", schema.title));
    if (schema.instance !== undefined) header.append(el("span", "apb-instance", schema.instance));
    this.status = el("span", "apb-status");
    this.status.setAttribute("role", "status");
    const settings = buildSettings(this);
    header.append(this.status, this.arrangeButton(), settings.button);
    container.append(header);

    this.main = el("main", "apb-main");
    this.main.id = `${this.prefix}-main`;
    // A panel embedded in somebody's page is a region of that page, not its main landmark.
    if (!this.deps.standalone) this.main.setAttribute("role", "region");
    this.main.setAttribute("aria-label", schema.title);
    if (schema.restrictions.length > 0) {
      const notes = el("div", "apb-notes");
      for (const restriction of schema.restrictions) notes.append(el("p", "apb-note", said(this.t, restriction.key, restriction.params, restriction.text)));
      this.main.append(notes);
    }
    const tools = el("div", "apb-toolbar");
    const search = el("input", "apb-input apb-search");
    search.type = "search";
    search.placeholder = t("search");
    search.setAttribute("aria-label", t("search"));
    if (this.deps.standalone) search.setAttribute("aria-keyshortcuts", "/");
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value.trim();
      this.showResults();
    });
    this.search = search;
    tools.append(search);
    if (this.deps.standalone) {
      // The key that reaches the box, shown in it; the stylesheet hides it while the box is in use.
      const key = el("kbd", "apb-search-key", "/");
      key.setAttribute("aria-hidden", "true");
      tools.append(key);
    }
    this.tablist = el("div", "apb-tabs");
    this.tablist.setAttribute("role", "tablist");
    this.tablist.setAttribute("aria-label", t("groups"));
    // One band, so the tabs and the search stay in reach together while the cards scroll under them.
    const nav = el("div", "apb-nav");
    nav.append(tools, this.tablist);
    this.nav = nav;
    // Not a live region: the status in the header already is one, and says the same.
    this.stale = el("p", "apb-stale");
    this.stale.hidden = true;
    // A line just above the band: once it scrolls out of sight, the band is floating and says so.
    const sentinel = el("div", "apb-nav-sentinel");
    sentinel.setAttribute("aria-hidden", "true");
    this.main.append(this.stale, sentinel, nav);
    if (typeof IntersectionObserver === "function") {
      new IntersectionObserver(([entry]) => nav.toggleAttribute("data-stuck", entry !== undefined && !entry.isIntersecting && entry.boundingClientRect.top < 0)).observe(sentinel);
    }
    this.tablist.addEventListener("scroll", () => this.markEdges(), { passive: true });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => this.markEdges()).observe(this.tablist);

    if (!this.deps.snapshot) this.addTab(this.buildPinned());
    for (const group of schema.groups) {
      const { tab, pane } = this.tabPair(group.id, group.title, group.items.filter((item) => !(item.type === "chart" && item.placement === "alone")).length);
      if (group.description !== undefined) pane.append(el("p", "apb-pane-description", group.description));
      const grid = el("div", group.layout === "list" ? "apb-grid apb-grid-list" : "apb-grid");
      const cards = this.fillGrid(grid, group.items, this.shapeOf(group.id), group.layout === "list", [this.prefs.layout?.[group.id], schema.layout?.[group.id]], group.id);
      pane.append(grid);
      this.addTab({ id: group.id, tab, pane, cards });
    }
    this.addTab(this.buildResults());
    if (!this.deps.snapshot) this.addTab(this.buildActivity());
    if (schema.groups.length === 0) this.main.append(el("p", "apb-empty", t("noValues")));
    this.tablist.addEventListener("keydown", (event) => this.onTabKey(event));
    this.main.append(this.announcer.element);
    container.append(this.main, settings.element);
    this.measureGrids(this.main);
    this.syncPinnedTab();
    this.installShortcuts();

    const fromHash = this.deps.standalone ? decodeURIComponent(location.hash.replace(/^#/, "")) : "";
    const wanted = [previous, fromHash].find((id) => id !== "" && id !== RESULTS && this.tabs.some((tab) => tab.id === id && !tab.tab.hidden));
    this.select(wanted ?? this.tabs.find((tab) => !tab.tab.hidden)?.id ?? "", false);
    if (this.query !== "") this.showResults();
  }

  /** Brings every card up to the store; redraws expensive ones only on the visible tab. */
  update(): void {
    // Paused while arranging: a value that changes changes its card's height, and the cards would move under the pointer.
    if (this.arranging !== undefined) return;
    const store = this.current;
    const now = serverTime(store);
    const statuses = new Map<string, Status | undefined>();
    for (const entry of this.tabs) {
      const visible = entry.id === this.active;
      for (const card of entry.cards) {
        card.update(store, now, visible);
        if (visible && card.id.startsWith("value:")) {
          const id = card.id.slice(6);
          statuses.set(id, store.values.get(id)?.status);
        }
      }
    }
    this.announcer.observe(statuses, (id) => this.values.get(id)?.label ?? id);
    if (this.active === ACTIVITY) this.activity?.show();
    // What arrived may be taller than the card it arrived on — a reason field, a longer reading:
    // a grid whose cards no longer hold what they were given is fitted again. A hidden tab has no
    // width and is left until it is shown.
    for (const view of this.grids.values()) view.check();
  }

  setStatus(text: string, state: "live" | "trouble" | "snapshot" | "signed-out"): void {
    if (this.status === undefined) return;
    this.status.textContent = text;
    this.status.dataset.state = state;
    this.deps.container.dataset.connection = state;
    const stale = state === "trouble" || state === "signed-out";
    if (this.stale !== undefined) {
      this.stale.hidden = !stale;
      this.stale.textContent = stale ? text : "";
    }
  }

  destroy(): void {
    this.shortcuts?.destroy();
    this.shortcuts = undefined;
  }

  /** Activity is drawn on demand; app.ts calls this once the changes and notices have arrived. */
  showActivity(): void {
    this.activity?.show();
  }

  // ---------------------------------------------------------------------------------------------
  // Compact: the cards alone
  // ---------------------------------------------------------------------------------------------

  private buildCompact(store: Store): void {
    const { container } = this.deps;
    this.main = el("div", "apb-main apb-main-compact");
    this.main.setAttribute("role", "region");
    this.main.setAttribute("aria-label", store.schema.title);
    const cards: Card[] = [];
    for (const group of store.schema.groups) {
      const section = el("section", "apb-compact-group");
      if (store.schema.groups.length > 1) section.append(el("h2", "apb-label", group.title));
      const grid = el("div", group.layout === "list" ? "apb-grid apb-grid-list" : "apb-grid");
      cards.push(...this.fillGrid(grid, group.items, this.shapeOf(group.id), group.layout === "list", [this.prefs.layout?.[group.id], store.schema.layout?.[group.id]], group.id));
      section.append(grid);
      this.main.append(section);
    }
    // The status line is kept, out of sight: an embedded card must still say when it lost the panel.
    this.status = el("span", "apb-sr");
    this.status.setAttribute("role", "status");
    this.main.append(this.status, this.announcer.element);
    container.append(this.main);
    this.measureGrids(this.main);
    this.tabs.push({ id: "compact", tab: el("button"), pane: this.main, cards });
    this.active = "compact";
  }

  // ---------------------------------------------------------------------------------------------
  // Cards
  // ---------------------------------------------------------------------------------------------

  /** A group's grid, or the panel's where the group has none of its own. */
  private shapeOf(groupId: string): GridShape {
    const schema = this.store().schema;
    return schema.groups.find((group) => group.id === groupId)?.grid ?? schema.grid;
  }

  /** How a card may be sized, in its own group's grid: by what it shows, or as code says. */
  private sizing(item: ItemSchema): Sizing {
    const group = this.items.get(`${item.type}:${item.id}`)?.group;
    const shape = group === undefined ? this.store().schema.grid : this.shapeOf(group);
    const chart = item.type === "value" && item.chart !== undefined ? (this.items.get(`chart:${item.chart}`)?.item as ChartSchema | undefined) : undefined;
    const drawn = chart === undefined ? undefined : chart.kind === "sparkline" ? "spark" : chart.kind === "heatmap" ? "heatmap" : chart.kind === "gauge" ? "gauge" : chart.over === "keys" || chart.kind === "histogram" ? "bars" : "plot";
    return sizingOf(item, shape.columns, drawn);
  }

  /**
   * Builds the cards of `items` into `grid` and places them: in the order and at the sizes the
   * layouts give, highest first. A group's grid is kept, for arranging on the page.
   */
  private fillGrid(grid: HTMLElement, items: readonly ItemSchema[], shape: GridShape, list: boolean, layouts: ReadonlyArray<GroupLayout | undefined> = [], groupId?: string): Card[] {
    const cards: Card[] = [];
    const placed: Placed[] = [];
    for (const item of items) {
      if (item.type === "chart" && item.placement === "alone") continue;
      const card = this.buildCard(item);
      cards.push(card);
      placed.push({ id: card.id, element: card.element, sizing: this.sizing(item), label: "label" in item ? item.label : item.title });
    }
    const view = new GridView(grid, shape, list);
    view.place(placed, layouts);
    if (groupId !== undefined) this.grids.set(groupId, view);
    return cards;
  }

  private buildCard(item: ItemSchema): Card {
    switch (item.type) {
      case "value":
        return valueCard(this, item);
      case "chart": {
        const card = frame(this, `chart:${item.id}`, item.title, item.description);
        const view = extras().buildChart?.(item, this.values, this.t);
        if (view !== undefined) card.body.append(view.element);
        return { id: card.id, element: card.element, update: (store, _now, visible) => visible && view?.draw(store) };
      }
      case "table": {
        const card = frame(this, `table:${item.id}`, item.title, item.description);
        const view = extras().buildTable?.(item, this.deps.api, this.t);
        if (view !== undefined) card.body.append(view.element);
        let loaded = false;
        let lastVersion = -1;
        return {
          id: card.id,
          element: card.element,
          update: (store, _now, visible) => {
            // A table refetches when something changed, not every second: a query may be a database call.
            if (visible && view !== undefined && (!loaded || store.version !== lastVersion)) {
              loaded = true;
              lastVersion = store.version;
              view.refresh();
            }
          },
        };
      }
      case "feed": {
        const view = buildFeed(item, this.t);
        const card = frame(this, `feed:${item.id}`, item.title, item.description);
        card.body.append(view.element);
        return { id: card.id, element: card.element, update: (store, now, visible) => visible && view.update(store, now) };
      }
      case "profile":
        return profileCard(this, item);
      case "action":
        return actionCard(this, item);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The viewer's own settings
  // ---------------------------------------------------------------------------------------------

  schema(): PanelSchema {
    return this.current.schema;
  }

  /**
   * The header's button: arranges the cards of the tab that is open, and stops arranging when it is
   * pressed again. Offered only where there is a group to arrange — not on Pinned, search results or
   * Activity, and not in a panel with no groups.
   */
  private arrangeButton(): HTMLButtonElement {
    const button = el("button", "apb-arrange-button");
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.append(el("span", "apb-arrange-icon"), el("span", "apb-arrange-word", this.t("arrange")));
    button.addEventListener("click", () => {
      if (this.arranging !== undefined) this.arranging.stop(true);
      else this.editLayout();
      this.syncArrangeButton();
    });
    this.arrange = button;
    this.syncArrangeButton();
    return button;
  }

  /** Whether the tab that is open can be arranged, and whether it is being arranged now. */
  private syncArrangeButton(): void {
    const button = this.arrange;
    if (button === undefined) return;
    const arranging = this.arranging !== undefined;
    const group = this.current.schema.groups.some((entry) => entry.id === this.active);
    button.disabled = !group && !arranging;
    button.setAttribute("aria-pressed", String(arranging));
    button.setAttribute("aria-label", this.t(arranging ? "layoutStop" : "layoutEdit"));
    button.title = this.t(!group && !arranging ? "layoutNoGroup" : arranging ? "layoutStop" : "layoutEdit");
  }

  /** Starts arranging the cards of the open group's tab. */
  editLayout(): void {
    this.arranging?.stop(true);
    this.arranging = startArranging(this);
    this.syncArrangeButton();
  }

  /** Arranging ended: the updates it held back, and a structure that arrived meanwhile, are drawn now. */
  arrangingStopped(): void {
    this.arranging = undefined;
    this.syncArrangeButton();
    // Measuring was paused while arranging: the cards are fitted to the sizes they were given now.
    for (const view of this.grids.values()) view.layout();
    const held = this.held;
    this.held = undefined;
    if (held !== undefined) this.build(held);
    this.update();
  }

  /** Forgets this viewer's own layout: every group goes back to the panel's. */
  resetLayout(): void {
    this.prefs.layout = undefined;
    this.prefs.save();
    for (const [id, view] of this.grids) view.place(view.declared(), [this.current.schema.layout?.[id]]);
  }

  /** The group whose tab is open, which is the one the header's button arranges. */
  arrangeableGroup(): { id: string; title: string } | undefined {
    const group = this.current.schema.groups.find((entry) => entry.id === this.active);
    return group === undefined ? undefined : { id: group.id, title: group.title };
  }

  mainRegion(): HTMLElement {
    return this.main;
  }

  /** Puts this viewer's choices on the root, where the stylesheet reads them. */
  applyPrefs(): void {
    const { container } = this.deps;
    const prefs = this.prefs;
    const scheme = prefs.scheme ?? this.deps.scheme;
    if (scheme === "auto") container.removeAttribute("data-scheme");
    else container.dataset.scheme = scheme;
    const theme = this.current.schema.theme;
    const chosen = prefs.theme !== undefined && prefs.theme !== theme.name && (theme.offered ?? []).some((entry) => entry.name === prefs.theme) ? prefs.theme : undefined;
    if (chosen === undefined) container.removeAttribute("data-theme");
    else container.dataset.theme = chosen;
    const flags: Array<[string, boolean]> = [
      ["density", prefs.density === "compact"],
      ["flash", !prefs.flash],
      ["motion", !prefs.motion],
      ["trends", !prefs.trends],
    ];
    for (const [name, set] of flags) {
      if (!set) container.removeAttribute(`data-${name}`);
      else container.setAttribute(`data-${name}`, name === "density" ? "compact" : "off");
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Shortcuts
  // ---------------------------------------------------------------------------------------------

  /** Only on a page of its own: a fragment inside somebody else's page must not take their keys. */
  private installShortcuts(): void {
    this.shortcuts?.destroy();
    this.shortcuts = undefined;
    if (!this.deps.standalone) return;
    const t = this.t;
    this.shortcuts = installShortcuts({
      container: this.deps.container,
      t,
      focusSearch: () => this.search.focus(),
      groups: () => this.store().schema.groups.map((group) => () => this.select(group.id, true, true)),
      destinations: () => {
        const list: Destination[] = [];
        for (const group of this.store().schema.groups) {
          list.push({ label: group.title, kind: t("paletteGroup"), go: () => this.select(group.id, true, true) });
          for (const item of group.items) {
            if (item.type !== "value" && item.type !== "action") continue;
            list.push({ label: item.label, kind: t(item.type === "value" ? "paletteValue" : "paletteAction"), where: group.title, go: () => this.reveal(group.id, `${item.type}:${item.id}`) });
          }
        }
        return list;
      },
    });
    this.deps.container.append(...this.shortcuts.elements);
  }

  /** Opens a card's tab and moves focus to the card. */
  private reveal(group: string, cardId: string): void {
    this.select(group, true);
    const pane = this.tabs.find((entry) => entry.id === group)?.pane;
    const card = pane?.querySelector<HTMLElement>(`[data-card="${CSS.escape(cardId)}"]`);
    if (card === undefined || card === null) return;
    card.tabIndex = -1;
    card.scrollIntoView?.({ block: "center" });
    card.focus();
    flash(card, "data-reached");
  }

  // ---------------------------------------------------------------------------------------------
  // Pinned, search results, activity
  // ---------------------------------------------------------------------------------------------

  private buildPinned(): TabEntry {
    const { tab, pane } = this.tabPair(PINNED, this.t("pinned"), undefined);
    const entry: TabEntry = { id: PINNED, tab, pane, cards: [] };
    this.fillPinned(entry);
    return entry;
  }

  private fillPinned(entry: TabEntry): void {
    clear(entry.pane);
    entry.cards = [];
    const grid = el("div", "apb-grid");
    const items = [...this.prefs.pinned].map((id) => this.items.get(id)?.item).filter((item): item is ItemSchema => item !== undefined);
    entry.cards = this.fillGrid(grid, items, this.store().schema.grid, false);
    entry.pane.append(grid);
  }

  private rebuildPinned(): void {
    const entry = this.tabs.find((tab) => tab.id === PINNED);
    if (entry === undefined) return;
    this.fillPinned(entry);
    this.syncPinnedTab();
    this.update();
  }

  /** The Pinned tab exists only while something is pinned. */
  private syncPinnedTab(): void {
    const entry = this.tabs.find((tab) => tab.id === PINNED);
    if (entry === undefined) return;
    entry.tab.hidden = entry.cards.length === 0;
    if (entry.tab.hidden && this.active === PINNED) this.select(this.tabs.find((tab) => !tab.tab.hidden)?.id ?? "", false);
  }

  private buildResults(): TabEntry {
    const { tab, pane } = this.tabPair(RESULTS, this.t("results"), undefined);
    tab.hidden = true;
    return { id: RESULTS, tab, pane, cards: [] };
  }

  /** Cards whose label or description holds the query, built fresh into the results tab. */
  private showResults(): void {
    const entry = this.tabs.find((tab) => tab.id === RESULTS);
    if (entry === undefined) return;
    if (this.query === "") {
      entry.tab.hidden = true;
      if (this.active === RESULTS) this.select(this.tabs.find((tab) => !tab.tab.hidden)?.id ?? "", false);
      return;
    }
    const needle = this.query.toLowerCase();
    clear(entry.pane);
    entry.cards = [];
    const grid = el("div", "apb-grid");
    const found: ItemSchema[] = [];
    for (const [, { item }] of this.items) {
      if (item.type === "chart" && item.placement === "alone") continue;
      const text = `${"label" in item ? item.label : item.title} ${item.description ?? ""} ${item.id}`.toLowerCase();
      if (text.includes(needle)) found.push(item);
    }
    entry.cards = this.fillGrid(grid, found, this.store().schema.grid, false);
    if (entry.cards.length === 0) entry.pane.append(el("p", "apb-empty", this.t("searchEmpty", { query: this.query })));
    entry.pane.append(grid);
    entry.tab.hidden = false;
    this.select(RESULTS, false);
  }

  private buildActivity(): TabEntry {
    const { tab, pane } = this.tabPair(ACTIVITY, this.t("activity"), undefined);
    const view = buildActivity(this);
    this.activity = view;
    pane.append(view.element);
    return { id: ACTIVITY, tab, pane, cards: [] };
  }

  // ---------------------------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------------------------

  private addTab(entry: TabEntry): void {
    this.tabs.push(entry);
    this.tablist.append(entry.tab);
    this.main.append(entry.pane);
  }

  private tabPair(id: string, title: string, count: number | undefined): { tab: HTMLButtonElement; pane: HTMLElement } {
    const tab = el("button", "apb-tab", title);
    tab.type = "button";
    tab.id = `${this.prefix}-tab-${id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `${this.prefix}-pane-${id}`);
    tab.setAttribute("aria-selected", "false");
    tab.tabIndex = -1;
    if (count !== undefined) {
      const badge = el("span", "apb-count", String(count));
      badge.setAttribute("aria-hidden", "true");
      tab.append(badge);
    }
    tab.addEventListener("click", () => this.select(id, true));
    const pane = el("section", "apb-pane");
    pane.id = `${this.prefix}-pane-${id}`;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", tab.id);
    pane.tabIndex = 0;
    pane.hidden = true;
    return { tab, pane };
  }

  private select(id: string, fromUser: boolean, focus = false): void {
    const leaving = this.active;
    // Arranging belongs to the tab it started on. Leaving that tab puts back what was there, the
    // way Cancel does: an arrangement nobody can see is not one anybody can finish.
    if (this.arranging !== undefined && leaving !== id && leaving !== "") this.arranging.stop(true);
    const moving = fromUser && this.deps.standalone && leaving !== id && leaving !== "";
    if (moving) this.scrolled.set(leaving, window.scrollY);
    this.active = id;
    for (const entry of this.tabs) {
      const on = entry.id === id;
      entry.tab.setAttribute("aria-selected", String(on));
      entry.tab.tabIndex = on ? 0 : -1;
      entry.pane.hidden = !on;
      if (on && focus) entry.tab.focus();
      if (on) this.bringIntoStrip(entry.tab);
    }
    const shown = this.tabs.find((entry) => entry.id === id)?.pane;
    if (shown !== undefined) this.measureGrids(shown);
    // Another tab is another group to arrange, or none at all.
    if (leaving !== id) this.syncArrangeButton();
    if (moving) this.restoreScroll(id);
    if (fromUser && this.deps.standalone && id !== RESULTS) history.replaceState(null, "", `#${encodeURIComponent(id)}`);
    if (id === ACTIVITY) {
      this.activity?.show();
      this.deps.loadActivity?.().then(
        () => this.activity?.show(),
        () => undefined,
      );
    }
    this.update();
  }

  /** Gives the grids under `node` their column count now, before the page is painted. */
  private measureGrids(node: HTMLElement): void {
    for (const grid of Array.from(node.querySelectorAll(".apb-grid"))) GridView.of(grid)?.measure();
  }

  /** Scrolls the tab strip, and only the strip, so `tab` is in it with a little room to spare. */
  private bringIntoStrip(tab: HTMLElement): void {
    const strip = this.tablist;
    if (strip === undefined || strip.scrollWidth <= strip.clientWidth) return;
    const outer = strip.getBoundingClientRect();
    const inner = tab.getBoundingClientRect();
    const room = 32;
    if (inner.left < outer.left + room) strip.scrollLeft -= outer.left + room - inner.left;
    else if (inner.right > outer.right - room) strip.scrollLeft += inner.right - (outer.right - room);
    this.markEdges();
  }

  /** Tells the stylesheet which ends of the tab strip have more tabs beyond them, to fade those. */
  private markEdges(): void {
    const strip = this.tablist;
    if (strip === undefined) return;
    strip.toggleAttribute("data-more-before", strip.scrollLeft > 1);
    strip.toggleAttribute("data-more-after", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
  }

  /** Back to where this tab was left; a tab not seen yet starts at its top when the band was floating. */
  private restoreScroll(id: string): void {
    const kept = this.scrolled.get(id);
    const bandTop = this.nav.getBoundingClientRect().top + window.scrollY;
    const top = kept ?? (this.nav.hasAttribute("data-stuck") ? bandTop - 1 : undefined);
    if (top !== undefined) window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
  }

  /** The tablist's keyboard contract: arrows move between tabs, Home and End jump, and a tab is activated as it is focused. */
  private onTabKey(event: KeyboardEvent): void {
    const shown = this.tabs.filter((entry) => !entry.tab.hidden);
    const index = shown.findIndex((entry) => entry.id === this.active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % shown.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + shown.length) % shown.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = shown.length - 1;
    else return;
    event.preventDefault();
    const entry = shown[next];
    if (entry === undefined) return;
    this.select(entry.id, true);
    entry.tab.focus();
  }
}
