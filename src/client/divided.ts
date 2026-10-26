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
 *
 * What is drawn, and in which order, is decided in division.ts, which is tested without a browser.
 */
import type { Sizing } from "../panel/layout.js";
import type { GridShape, GroupLayout, GroupSchema, ItemSchema, LayoutMarkSchema, ListCardSchema, SectionSchema } from "../types.js";
import type { Card } from "./cards.js";
import { filterWords, firstSubtab, isTabbed, listSizing, matchesWords, rememberSection, searchable, sectionClosed, sectionSteps, subtabMove, wantsFilter, wantsOutline } from "./division.js";
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

/** The section tab each group last showed, kept across redraws of the page. */
const shownSection = new Map<string, string>();

export { isDivided } from "./division.js";

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
  const tabbed = isTabbed(group);
  const listCards = new Map((group.cards ?? []).map((card) => [card.id, card]));
  const containers = new Map<string, { element: HTMLElement; body: HTMLElement; members: number }>();

  /** The cards of one section, cut into runs by its marks, each run a grid. */
  const fillSection = (body: HTMLElement, section: SectionSchema | undefined): boolean => {
    const steps = sectionSteps(group, section?.id);
    if (steps.length === 0) return false;
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
    for (const step of steps) {
      if (step.kind === "mark") {
        drawMark(step.mark);
        continue;
      }
      const { item } = step;
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
        rememberSection(section, prefs.collapsed, state, shown);
        prefs.save();
      });
      heading.append(toggle);
      open(!sectionClosed(section, prefs.collapsed, state));
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
  if (wantsFilter(group)) {
    const box = el("input", "apb-input apb-group-filter");
    box.type = "search";
    box.placeholder = t("filterTab");
    box.setAttribute("aria-label", `${t("filterTab")}: ${group.title}`);
    const none = el("p", "apb-empty apb-filter-none", t("filterNone"));
    none.hidden = true;
    box.addEventListener("input", () => {
      const words = filterWords(box.value);
      for (const row of rows) row.card.element.hidden = !matchesWords(row.text, words);
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
      const to = subtabMove(event.key, at, buttons.length);
      if (to === undefined) return;
      event.preventDefault();
      const next = sectionEls[to];
      if (next !== undefined) show(next.section.id, true);
    });
    wrap.append(strip);
    show(
      firstSubtab(
        sectionEls.map((entry) => entry.section.id),
        shownSection.get(group.id),
      ),
      false,
    );
  } else if (wantsOutline(group, sectionEls.length)) {
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
