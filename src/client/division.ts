/**
 * What a divided group is drawn as, decided without a document: which groups are divided, what
 * each section holds and in which order, which rows a filter keeps, when a tab gets an outline or
 * sub-tabs, what a viewer's open and closed sections are, where the arrow keys move, and how big a
 * list card starts. `divided.ts` draws what this decides; keeping the decisions here is what lets
 * them be tested without a browser.
 */
import { MAX_CARD_ROWS, SPAN_WIDTHS, type Sizing } from "../panel/layout.js";
import type { GridShape, GroupSchema, ItemSchema, LayoutMarkSchema, ListCardSchema, SectionSchema } from "../types.js";

/** Values from which a group offers its filter box when it does not say. */
export const FILTER_FROM = 16;
/** Sections from which a group lists them at the top when it does not say. */
export const OUTLINE_FROM = 4;

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

/** The key a mark's `before` names an item by. */
export function itemKey(item: ItemSchema): string {
  return `${item.type}:${item.id}`;
}

/** One thing drawn in a section, in order: a card (or a row of a list card), or a mark. */
export type Step = { kind: "item"; item: ItemSchema } | { kind: "mark"; mark: LayoutMarkSchema };

/**
 * What one section holds, in drawing order: its items as declared, each mark before the item it
 * names, and the marks that name none at the end. `undefined` is the part above every section. A
 * chart drawn alone is not part of any section's grid. Empty when the section has nothing at all.
 */
export function sectionSteps(group: GroupSchema, section: string | undefined): Step[] {
  const items = group.items.filter((item) => item.section === section && !(item.type === "chart" && item.placement === "alone"));
  const own = (group.marks ?? []).filter((mark) => mark.section === section);
  const before = new Map<string, LayoutMarkSchema[]>();
  const atEnd: LayoutMarkSchema[] = [];
  for (const mark of own) {
    if (mark.before === undefined) atEnd.push(mark);
    else before.set(mark.before, [...(before.get(mark.before) ?? []), mark]);
  }
  const steps: Step[] = [];
  for (const item of items) {
    for (const mark of before.get(itemKey(item)) ?? []) steps.push({ kind: "mark", mark });
    steps.push({ kind: "item", item });
  }
  for (const mark of atEnd) steps.push({ kind: "mark", mark });
  return steps;
}

/** The text a row is found by: its name, its line, and the list card it sits in, in lower case. */
export function searchable(...texts: Array<string | undefined>): string {
  return texts.filter((text) => text !== undefined).join(" ").toLowerCase();
}

/** The words typed into a filter box: trimmed, lower case, split on any run of space. */
export function filterWords(typed: string): string[] {
  return typed
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
}

/** Whether a row's text holds every word typed; no words keep everything. */
export function matchesWords(text: string, words: readonly string[]): boolean {
  return words.every((word) => text.includes(word));
}

/** Whether a group shows its filter box: as it says, else from 16 values. */
export function wantsFilter(group: GroupSchema): boolean {
  return group.filter ?? group.items.filter((item) => item.type === "value").length >= FILTER_FROM;
}

/** Whether a group's sections are drawn as tabs of their own: asked for, and more than one. */
export function isTabbed(group: GroupSchema): boolean {
  return group.sectionTabs === true && (group.sections?.length ?? 0) > 1;
}

/** Whether a group lists its sections at the top: as it says, else from four drawn sections. Never with sub-tabs, which are the list. */
export function wantsOutline(group: GroupSchema, drawnSections: number): boolean {
  if (isTabbed(group)) return false;
  return group.outline ?? drawnSections >= OUTLINE_FROM;
}

/** The pref a viewer's choice about one section is kept under. */
const closedKey = (state: string): string => `section:${state}`;
const openedKey = (state: string): string => `section-open:${state}`;

/** Whether a section starts closed for this viewer: its own default, unless the viewer chose otherwise. */
export function sectionClosed(section: SectionSchema, collapsed: ReadonlySet<string>, state: string): boolean {
  return section.collapsed === true ? !collapsed.has(openedKey(state)) : collapsed.has(closedKey(state));
}

/**
 * Records a viewer opening or closing a section. Only a choice against the section's own default
 * is kept, so a section whose default changes later is not held to a choice that now agrees with it.
 */
export function rememberSection(section: SectionSchema, collapsed: Set<string>, state: string, shown: boolean): void {
  collapsed.delete(closedKey(state));
  collapsed.delete(openedKey(state));
  if (shown && section.collapsed === true) collapsed.add(openedKey(state));
  if (!shown && section.collapsed !== true) collapsed.add(closedKey(state));
}

/** Where a key moves in a strip of `count` sub-tabs from `at`, wrapping; `undefined` for a key that moves nothing. */
export function subtabMove(key: string, at: number, count: number): number | undefined {
  const to = key === "ArrowRight" ? at + 1 : key === "ArrowLeft" ? at - 1 : key === "Home" ? 0 : key === "End" ? count - 1 : undefined;
  return to === undefined ? undefined : (to + count) % count;
}

/** The sub-tab shown first: the one last shown, if it is still there, else the first. */
export function firstSubtab(ids: readonly string[], last: string | undefined): string {
  return last !== undefined && ids.includes(last) ? last : (ids[0] ?? "");
}

/** How a list card is sized: half a row for a list, the row for columns and tiles, unless it says. */
export function listSizing(card: ListCardSchema, shape: GridShape, members: number): Sizing {
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
