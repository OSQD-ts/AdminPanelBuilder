/**
 * A group drawn in parts: sections with headings, each with its own grids; several values in one
 * card, one row each; lines, gaps and row breaks between cards; a list of the sections to jump to,
 * or tabs of their own; a box that narrows the tab to what matches. See docs/concepts/layout.md.
 *
 * Each run of cards between two marks is a grid of its own, placed by the same packer as an
 * undivided group, so sizes, gathering and arranging work in it unchanged; the run a mark ends is
 * filled before the mark, and the next one starts below it. A list card is one card on its grid,
 * holding the value cards of its members as rows: each row is still that value's card, with its
 * reading, field, status and flash, so nothing about editing a value changes inside one.
 */
import type { GridShape, GroupLayout, GroupSchema, ItemSchema, LayoutMarkSchema, ListCardSchema, SectionSchema } from "../types.js";
import { MAX_CARD_ROWS, SPAN_WIDTHS, type Sizing } from "../panel/layout.js";
import type { Card } from "./cards.js";
import { el, uid } from "./dom.js";
import { GridView, type Placed } from "./grid.js";
import type { Translate } from "./i18n.js";
import type { Prefs } from "./prefs.js";

export interface DividedHost {
  readonly t: Translate;
  readonly prefs: Prefs;
  buildCard(item: ItemSchema): Card;
  sizing(item: ItemSchema): Sizing;
  shapeOf(groupId: string): GridShape;
  layoutsOf(groupId: string): ReadonlyArray<GroupLayout | undefined>;
  /** Keeps a run's grid for arranging: the first of a group under the group's id. */
  keepGrid(view: GridView, groupId: string, title: string): void;
  /** Measures the grids under `node`, once it is shown. */
  measure(node: HTMLElement): void;
}

/** Values from which a group offers its filter box when it does not say. */
const FILTER_FROM = 16;
/** Sections from which a group lists them at the top when it does not say. */
const OUTLINE_FROM = 4;

/** The section tab each group last showed, kept across redraws of the page. */
const shownSection = new Map<string, string>();

/**
 * Whether a group asks to be drawn in parts at all; one that does not is drawn exactly as it always
 * was, however many values it has. The filter box's default (from 16 values) applies only to a group
 * that is divided anyway, so no panel changes until its code asks for some of this.
 */
export function isDivided(group: GroupSchema): boolean {
  if (group.sections !== undefined || group.cards !== undefined || group.marks !== undefined || group.density !== undefined) return true;
  if (group.filter === true || group.outline === true || group.sectionTabs === true) return true;
  return group.items.some((item) => item.emphasis !== undefined);
}

interface Run {
  grid: HTMLElement;
  view: GridView;
  placed: Placed[];
}

interface Row {
  card: Card;
  container: HTMLElement | undefined;
  text: string;
}

export function buildDivided(host: DividedHost, pane: HTMLElement, group: GroupSchema): Card[] {
  const { t, prefs } = host;
  const cards: Card[] = [];
  const rows: Row[] = [];
  const runs: Run[] = [];
  const parts: HTMLElement[] = [];
  const wrap = el("div", "apb-divided");
  if (group.density !== undefined) wrap.dataset.density = group.density;
  const named = group.sections ?? [];
  const tabbed = group.sectionTabs === true && named.length > 1;
  const listCards = new Map((group.cards ?? []).map((card) => [card.id, card]));
  const containers = new Map<string, { element: HTMLElement; body: HTMLElement; members: number }>();
  const marks = group.marks ?? [];
  const key = (item: ItemSchema): string => `${item.type}:${item.id}`;

  /** The cards of one section, cut into runs by its marks, each run a grid. */
  const fillSection = (body: HTMLElement, section: SectionSchema | undefined): boolean => {
    const items = group.items.filter((item) => item.section === section?.id && !(item.type === "chart" && item.placement === "alone"));
    const own = marks.filter((mark) => mark.section === section?.id);
    if (items.length === 0 && own.length === 0) return false;
    const before = new Map<string, LayoutMarkSchema[]>();
    const atEnd: LayoutMarkSchema[] = [];
    for (const mark of own) {
      if (mark.before === undefined) atEnd.push(mark);
      else before.set(mark.before, [...(before.get(mark.before) ?? []), mark]);
    }
    let placed: Placed[] = [];
    const shape = section?.columns === undefined ? host.shapeOf(group.id) : { ...host.shapeOf(group.id), columns: section.columns };
    const close = (): void => {
      if (placed.length === 0) return;
      const grid = el("div", "apb-grid");
      body.append(grid);
      // Declaration order: a divided group is laid out as it was written, not gathered by kind.
      const view = new GridView(grid, shape, group.layout === "list", true);
      view.place(placed, host.layoutsOf(group.id));
      host.keepGrid(view, group.id, section?.title ?? group.title);
      runs.push({ grid, view, placed });
      placed = [];
    };
    const drawMark = (mark: LayoutMarkSchema): void => {
      close();
      if (mark.kind === "divider") {
        const line = el("div", mark.label === undefined ? "apb-divider" : "apb-divider apb-divider-label");
        line.setAttribute("role", "separator");
        if (mark.label !== undefined) {
          line.append(el("span", "apb-divider-text", mark.label));
          line.setAttribute("aria-label", mark.label);
        }
        body.append(line);
      } else if (mark.kind === "spacer") {
        const gap = el("div", "apb-spacer");
        gap.dataset.size = mark.size ?? "md";
        gap.setAttribute("aria-hidden", "true");
        body.append(gap);
      }
    };
    for (const item of items) {
      for (const mark of before.get(key(item)) ?? []) drawMark(mark);
      const card = host.buildCard(item);
      cards.push(card);
      if (item.emphasis !== undefined) card.element.dataset.emphasis = item.emphasis;
      const label = "label" in item ? item.label : item.title;
      const listed = item.card === undefined ? undefined : listCards.get(item.card);
      if (listed === undefined) {
        placed.push({ id: card.id, element: card.element, sizing: host.sizing(item), label });
        rows.push({ card, container: undefined, text: searchable(label, item.description) });
        continue;
      }
      let container = containers.get(listed.id);
      if (container === undefined) {
        const made = listCard(listed);
        container = { ...made, members: 0 };
        containers.set(listed.id, container);
        placed.push({ id: `card:${listed.id}`, element: made.element, sizing: listSizing(listed, shape, group.items.filter((other) => other.card === listed.id).length), label: listed.title });
      }
      container.members += 1;
      card.element.classList.add("apb-row");
      container.body.append(card.element);
      rows.push({ card, container: container.element, text: searchable(label, item.description, listed.title) });
    }
    for (const mark of atEnd) drawMark(mark);
    close();
    return true;
  };

  // Above the sections, what is in none of them.
  const top = el("div", "apb-section-body");
  if (fillSection(top, undefined)) parts.push(top);

  const sectionEls: Array<{ section: SectionSchema; element: HTMLElement; open: (open: boolean) => void }> = [];
  for (const section of named) {
    const element = el("section", "apb-section");
    if (section.density !== undefined) element.dataset.density = section.density;
    const body = el("div", "apb-section-body");
    body.id = uid("section");
    if (!fillSection(body, section)) continue;
    const head = el("div", "apb-section-head");
    const heading = el("h2", "apb-section-title");
    heading.id = uid("heading");
    element.setAttribute("aria-labelledby", heading.id);
    const state = `${group.id}/${section.id}`;
    let open = (_: boolean): void => {};
    if (section.collapsible && !tabbed) {
      const toggle = el("button", "apb-section-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-controls", body.id);
      toggle.append(el("span", "apb-section-chevron"), el("span", "", section.title));
      open = (shown: boolean): void => {
        toggle.setAttribute("aria-expanded", String(shown));
        body.hidden = !shown;
        element.toggleAttribute("data-closed", !shown);
        if (shown) host.measure(body);
      };
      toggle.addEventListener("click", () => {
        const shown = toggle.getAttribute("aria-expanded") !== "true";
        open(shown);
        // Only a choice against the section's own default is kept.
        prefs.collapsed.delete(`section:${state}`);
        prefs.collapsed.delete(`section-open:${state}`);
        if (shown && section.collapsed === true) prefs.collapsed.add(`section-open:${state}`);
        if (!shown && section.collapsed !== true) prefs.collapsed.add(`section:${state}`);
        prefs.save();
      });
      heading.append(toggle);
      const closed = section.collapsed === true ? !prefs.collapsed.has(`section-open:${state}`) : prefs.collapsed.has(`section:${state}`);
      open(!closed);
    } else {
      heading.textContent = section.title;
      // The outline moves focus here.
      heading.tabIndex = -1;
    }
    head.append(heading);
    if (section.description !== undefined) head.append(el("p", "apb-section-description", section.description));
    element.append(head, body);
    element.dataset.section = section.id;
    sectionEls.push({ section, element, open });
    parts.push(element);
  }

  // A box that narrows the tab: cards and rows whose name matches stay, sections left empty go.
  const wantsFilter = group.filter ?? group.items.filter((item) => item.type === "value").length >= FILTER_FROM;
  if (wantsFilter) {
    const box = el("input", "apb-input apb-group-filter");
    box.type = "search";
    box.placeholder = t("filterTab");
    box.setAttribute("aria-label", `${t("filterTab")}: ${group.title}`);
    const none = el("p", "apb-empty apb-filter-none", t("filterNone"));
    none.hidden = true;
    box.addEventListener("input", () => {
      const words = box.value.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
      const matches = (text: string): boolean => words.every((word) => text.includes(word));
      for (const row of rows) row.card.element.hidden = !matches(row.text);
      for (const row of rows) {
        if (row.container === undefined) continue;
        row.container.hidden = !Array.from(row.container.querySelectorAll(".apb-row")).some((member) => !(member as HTMLElement).hidden);
      }
      for (const run of runs) {
        const visible = run.placed.filter((entry) => !entry.element.hidden);
        run.grid.hidden = visible.length === 0;
        run.view.place(visible, host.layoutsOf(group.id));
      }
      wrap.toggleAttribute("data-filtering", words.length > 0);
      for (const { element, open } of sectionEls) {
        const any = Array.from(element.querySelectorAll(".apb-grid")).some((grid) => !(grid as HTMLElement).hidden);
        element.hidden = !any;
        if (words.length > 0 && any) open(true);
      }
      none.hidden = words.length === 0 || runs.some((run) => !run.grid.hidden);
      host.measure(wrap);
    });
    wrap.append(box, none);
  }

  if (tabbed) {
    const strip = el("div", "apb-subtabs");
    strip.setAttribute("role", "tablist");
    strip.setAttribute("aria-label", `${t("sections")}: ${group.title}`);
    const buttons: HTMLButtonElement[] = [];
    const show = (id: string, focus: boolean): void => {
      shownSection.set(group.id, id);
      for (const [index, { section, element }] of sectionEls.entries()) {
        const on = section.id === id;
        element.hidden = !on;
        const button = buttons[index] as HTMLButtonElement;
        button.setAttribute("aria-selected", String(on));
        button.tabIndex = on ? 0 : -1;
        if (on) {
          host.measure(element);
          if (focus) button.focus();
        }
      }
    };
    for (const { section, element } of sectionEls) {
      const button = el("button", "apb-subtab", section.title);
      button.type = "button";
      button.id = uid("subtab");
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", element.id || (element.id = uid("subpane")));
      element.setAttribute("role", "tabpanel");
      element.setAttribute("aria-labelledby", button.id);
      button.addEventListener("click", () => show(section.id, false));
      buttons.push(button);
      strip.append(button);
    }
    strip.addEventListener("keydown", (event) => {
      const at = buttons.indexOf(event.target as HTMLButtonElement);
      if (at < 0) return;
      const to = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : undefined;
      if (to === undefined) return;
      event.preventDefault();
      const next = sectionEls[(to + buttons.length) % buttons.length];
      if (next !== undefined) show(next.section.id, true);
    });
    wrap.append(strip);
    const wanted = shownSection.get(group.id);
    show(sectionEls.some((entry) => entry.section.id === wanted) ? (wanted as string) : (sectionEls[0]?.section.id ?? ""), false);
  } else if (group.outline ?? sectionEls.length >= OUTLINE_FROM) {
    const outline = el("nav", "apb-outline");
    outline.setAttribute("aria-label", t("onThisTab"));
    for (const { section, element, open } of sectionEls) {
      const jump = el("button", "apb-outline-link", section.title);
      jump.type = "button";
      jump.addEventListener("click", () => {
        open(true);
        element.scrollIntoView({ block: "start" });
        (element.querySelector(".apb-section-toggle, .apb-section-title") as HTMLElement | null)?.focus();
      });
      outline.append(jump);
    }
    wrap.append(outline);
  }

  wrap.append(...parts);
  pane.append(wrap);
  return cards;
}

function searchable(...texts: Array<string | undefined>): string {
  return texts.filter((text) => text !== undefined).join(" ").toLowerCase();
}

/** The card a list card is drawn as: its name, a line about it, and a body its rows go into. */
function listCard(card: ListCardSchema): { element: HTMLElement; body: HTMLElement } {
  const element = el("article", "apb-card apb-listcard");
  element.dataset.card = `card:${card.id}`;
  element.dataset.layout = card.layout;
  if (card.emphasis !== undefined) element.dataset.emphasis = card.emphasis;
  const head = el("div", "apb-card-head");
  const label = el("h2", "apb-label", card.title);
  label.id = uid("label");
  element.setAttribute("aria-labelledby", label.id);
  head.append(label);
  const body = el("div", "apb-card-body apb-listcard-rows");
  if (card.description !== undefined) element.append(head, el("p", "apb-description", card.description), body);
  else element.append(head, body);
  return { element, body };
}

/** How a list card is sized: half a row for a list, the row for columns and tiles, unless it says. */
function listSizing(card: ListCardSchema, shape: GridShape, members: number): Sizing {
  const scale = (w: number): number => Math.min(shape.columns, Math.max(1, Math.round((w * shape.columns) / 12)));
  if (card.size !== undefined) {
    const fixed = { w: Math.min(shape.columns, card.size.w), h: card.size.h };
    return { pref: fixed, min: fixed, max: fixed, locked: true, family: "setting" };
  }
  const columns = card.layout === "columns:3" ? 3 : card.layout === "columns:2" ? 2 : card.layout === "grid" ? 4 : 1;
  const w = scale(card.span !== undefined ? (SPAN_WIDTHS[String(card.span)] ?? 6) : columns === 1 ? 6 : 12);
  // A first guess at the height, about 40 px a row; the grid measures what the card holds and grows it.
  const h = Math.max(2, Math.ceil((Math.ceil(members / columns) * 40 + 48) / shape.rowHeight));
  return { pref: { w, h: Math.min(h, MAX_CARD_ROWS) }, min: { w: Math.min(w, scale(4)), h: 2 }, max: { w: shape.columns, h: MAX_CARD_ROWS }, locked: false, family: "setting" };
}
