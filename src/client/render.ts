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
import type { ItemSchema, Status, ValueSchema } from "../types.js";
import { buildActivity } from "./activity.js";
import { type Announcer, createAnnouncer } from "./announce.js";
import { buildFeed, buildProfile } from "./blocks.js";
import { actionCard, type Card, type CardHost, frame, spanClass, valueCard } from "./cards.js";
import { clear, el, uid } from "./dom.js";
import type { Translate } from "./i18n.js";
import { type Destination, installShortcuts, type Shortcuts } from "./palette.js";
import { loadPrefs, type Prefs } from "./prefs.js";
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
  private search!: HTMLInputElement;
  private tablist!: HTMLElement;
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
    this.prefs = loadPrefs(`apb:${current.schema.title}:${current.schema.instance ?? ""}`);
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

  /** Draws everything from the store's schema. Called again only when the schema's structure changes. */
  build(store: Store): void {
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
    this.applyScheme();
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
    header.append(this.status, this.schemeSwitch());
    container.append(header);

    this.main = el("main", "apb-main");
    this.main.id = `${this.prefix}-main`;
    // A panel embedded in somebody's page is a region of that page, not its main landmark.
    if (!this.deps.standalone) this.main.setAttribute("role", "region");
    this.main.setAttribute("aria-label", schema.title);
    if (schema.restrictions.length > 0) {
      const notes = el("div", "apb-notes");
      for (const text of schema.restrictions) notes.append(el("p", "apb-note", text));
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
    this.tablist = el("div", "apb-tabs");
    this.tablist.setAttribute("role", "tablist");
    this.tablist.setAttribute("aria-label", t("groups"));
    this.main.append(tools, this.tablist);

    if (!this.deps.snapshot) this.addTab(this.buildPinned());
    for (const group of schema.groups) {
      const { tab, pane } = this.tabPair(group.id, group.title, group.items.filter((item) => !(item.type === "chart" && item.placement === "alone")).length);
      if (group.description !== undefined) pane.append(el("p", "apb-pane-description", group.description));
      const grid = el("div", group.layout === "list" ? "apb-grid apb-grid-list" : "apb-grid");
      const cards: Card[] = [];
      for (const item of group.items) {
        if (item.type === "chart" && item.placement === "alone") continue;
        const card = this.buildCard(item);
        cards.push(card);
        grid.append(card.element);
      }
      pane.append(grid);
      this.addTab({ id: group.id, tab, pane, cards });
    }
    this.addTab(this.buildResults());
    if (!this.deps.snapshot) this.addTab(this.buildActivity());
    if (schema.groups.length === 0) this.main.append(el("p", "apb-empty", t("noValues")));
    this.tablist.addEventListener("keydown", (event) => this.onTabKey(event));
    this.main.append(this.announcer.element);
    container.append(this.main);
    this.syncPinnedTab();
    this.installShortcuts();

    const fromHash = this.deps.standalone ? decodeURIComponent(location.hash.replace(/^#/, "")) : "";
    const wanted = [previous, fromHash].find((id) => id !== "" && id !== RESULTS && this.tabs.some((tab) => tab.id === id && !tab.tab.hidden));
    this.select(wanted ?? this.tabs.find((tab) => !tab.tab.hidden)?.id ?? "", false);
    if (this.query !== "") this.showResults();
  }

  /** Brings every card up to the store; redraws expensive ones only on the visible tab. */
  update(): void {
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
  }

  setStatus(text: string, state: "live" | "trouble" | "snapshot" | "signed-out"): void {
    if (this.status === undefined) return;
    this.status.textContent = text;
    this.status.dataset.state = state;
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
      for (const item of group.items) {
        if (item.type === "chart" && item.placement === "alone") continue;
        const card = this.buildCard(item);
        cards.push(card);
        grid.append(card.element);
      }
      section.append(grid);
      this.main.append(section);
    }
    // The status line is kept, out of sight: an embedded card must still say when it lost the panel.
    this.status = el("span", "apb-sr");
    this.status.setAttribute("role", "status");
    this.main.append(this.status, this.announcer.element);
    container.append(this.main);
    this.tabs.push({ id: "compact", tab: el("button"), pane: this.main, cards });
    this.active = "compact";
  }

  // ---------------------------------------------------------------------------------------------
  // Cards
  // ---------------------------------------------------------------------------------------------

  private buildCard(item: ItemSchema): Card {
    switch (item.type) {
      case "value":
        return valueCard(this, item);
      case "chart": {
        const card = frame(this, `chart:${item.id}`, undefined, spanClass(item.span, "full"));
        const view = extras().buildChart?.(item, this.values, this.t);
        if (view !== undefined) card.body.append(view.element);
        return { id: card.id, element: card.element, update: (store, _now, visible) => visible && view?.draw(store) };
      }
      case "table": {
        const card = frame(this, `table:${item.id}`, item.title, spanClass(item.span, "full"), item.description);
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
        const card = frame(this, `feed:${item.id}`, item.title, spanClass(item.span, 2), item.description);
        card.body.append(view.element);
        return { id: card.id, element: card.element, update: (store, now, visible) => visible && view.update(store, now) };
      }
      case "profile": {
        const view = buildProfile(item, this.deps.api, this.t, this.deps.refresh);
        const card = frame(this, `profile:${item.id}`, item.title, spanClass(item.span, 1), item.description);
        card.body.append(view.element);
        return { id: card.id, element: card.element, update: (store) => view.update(store) };
      }
      case "action":
        return actionCard(this, item);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The viewer's own colours
  // ---------------------------------------------------------------------------------------------

  /** A select in the header: follow the system, light or dark, over whatever the panel says, for this viewer only. */
  private schemeSwitch(): HTMLElement {
    const t = this.t;
    const select = el("select", "apb-select apb-scheme");
    select.setAttribute("aria-label", t("scheme"));
    for (const [value, key] of [["", "scheme"], ["auto", "schemeAuto"], ["light", "schemeLight"], ["dark", "schemeDark"]] as const) {
      const option = el("option", null, value === "" ? `${t("scheme")}: ${t(this.deps.scheme === "auto" ? "schemeAuto" : this.deps.scheme === "light" ? "schemeLight" : "schemeDark")}` : t(key));
      option.value = value;
      select.append(option);
    }
    select.value = this.prefs.scheme ?? "";
    select.addEventListener("change", () => {
      const value = select.value;
      this.prefs.scheme = value === "auto" || value === "light" || value === "dark" ? value : undefined;
      this.prefs.save();
      this.applyScheme();
    });
    return select;
  }

  private applyScheme(): void {
    const scheme = this.prefs.scheme ?? this.deps.scheme;
    if (scheme === "auto") this.deps.container.removeAttribute("data-scheme");
    else this.deps.container.dataset.scheme = scheme;
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
    for (const id of this.prefs.pinned) {
      const found = this.items.get(id);
      if (found === undefined) continue;
      const card = this.buildCard(found.item);
      entry.cards.push(card);
      grid.append(card.element);
    }
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
    for (const [, { item }] of this.items) {
      if (item.type === "chart" && item.placement === "alone") continue;
      const text = `${"label" in item ? item.label : item.title} ${item.description ?? ""} ${item.id}`.toLowerCase();
      if (!text.includes(needle)) continue;
      const card = this.buildCard(item);
      entry.cards.push(card);
      grid.append(card.element);
    }
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
    this.active = id;
    for (const entry of this.tabs) {
      const on = entry.id === id;
      entry.tab.setAttribute("aria-selected", String(on));
      entry.tab.tabIndex = on ? 0 : -1;
      entry.pane.hidden = !on;
      if (on && focus) entry.tab.focus();
    }
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
