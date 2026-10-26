/**
 * How a group is divided for reading: sections with headings, several values in one card as a
 * list, and lines, gaps and row breaks between cards. Apart from core.ts so the panel's file is the
 * panel; core.ts asks this for what to put on each group's and item's wire shape.
 *
 * Nothing here is required. A group that uses none of it is sent exactly as before, and a page that
 * predates it draws such a group as it always did: everything below rides on optional fields.
 *
 * Sections and cards are named, like groups, and come into being on first mention: `section:
 * "Limits"` on a declaration is enough; `panel.section()` and `panel.card()` only add options. A
 * section belongs to a group, so the same name in two groups is two sections.
 */
import { AdminPanelConfigError } from "../errors.js";
import type { CardSize, Emphasis, GroupSchema, ItemSchema, LayoutMarkSchema, ListCardOptions, ListCardSchema, MarkOptions, SectionOptions, SectionSchema, Span } from "../types.js";
import { checkSize } from "./layout.js";
import { checkSpan, checkTitle } from "./checks.js";

/** How many sections one group may have, and how many cards a list may gather. */
export const MAX_SECTIONS_PER_GROUP = 50;
export const MAX_LIST_CARD_VALUES = 100;
export const MAX_LAYOUT_MARKS_PER_GROUP = 200;

/** What a declaration may say about where it goes, beyond its group. */
export interface PlacementOptions {
  section?: string | undefined;
  card?: string | undefined;
  emphasis?: Emphasis | undefined;
}

/** The keys every declaration that takes a placement accepts, for its `rejectUnknown` list. */
export const PLACEMENT_KEYS = ["section", "card", "emphasis"] as const;

interface Placement {
  group: string;
  section?: string | undefined;
  card?: string | undefined;
  emphasis?: Emphasis | undefined;
}

interface SectionEntry {
  options: SectionOptions;
  sequence: number;
}

interface CardEntry {
  options: ListCardOptions;
  sequence: number;
}

interface MarkEntry {
  id: string;
  kind: "divider" | "spacer" | "break";
  label?: string | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  section?: string | undefined;
  order: number;
  sequence: number;
}

const EMPHASES: readonly Emphasis[] = ["primary", "secondary"];
const CARD_LAYOUTS = ["list", "grid", "columns:2", "columns:3"] as const;
const SPACER_SIZES = ["sm", "md", "lg"] as const;

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function checkName(kind: string, name: unknown): string {
  if (typeof name !== "string" || name.trim() === "") throw new AdminPanelConfigError(`a ${kind} needs a name, a non-empty string`);
  return checkTitle(name.trim());
}

function rejectUnknown(options: object | undefined, keys: readonly string[], where: string): void {
  if (options === undefined) return;
  for (const key of Object.keys(options)) {
    if (!keys.includes(key)) throw new AdminPanelConfigError(`${where} has an unknown option "${key}"; it takes ${keys.join(", ")}`);
  }
}

/** The structure of every group: sections, list cards, marks and where each item sits in them. */
export class PanelStructure {
  /** By group name, then section name. */
  private readonly sections = new Map<string, Map<string, SectionEntry>>();
  /** By group name, then card name. */
  private readonly cards = new Map<string, Map<string, CardEntry>>();
  private readonly marks = new Map<string, MarkEntry[]>();
  /** By `${type}:${id}`. */
  private readonly placements = new Map<string, Placement>();
  private markCount = 0;

  constructor(private readonly nextSequence: () => number) {}

  /** Checks and remembers what a declaration said about its section, card and emphasis. */
  place(key: string, group: string, options: PlacementOptions, label: string): void {
    const placement: Placement = { group };
    if (options.emphasis !== undefined) {
      if (!EMPHASES.includes(options.emphasis)) throw new AdminPanelConfigError(`"${label}" has emphasis ${JSON.stringify(options.emphasis)}; it is "primary" or "secondary"`);
      placement.emphasis = options.emphasis;
    }
    if (options.section !== undefined) placement.section = checkName("section", options.section);
    if (options.card !== undefined) {
      if (!key.startsWith("value:")) throw new AdminPanelConfigError(`"${label}" is given card ${JSON.stringify(options.card)}, but only values are gathered into a list card`);
      placement.card = checkName("card", options.card);
      // A card is in one section: its own, when card() gave it one, or else its first value's.
      const cardSection = this.cards.get(group)?.get(placement.card)?.options.section;
      const members = [...this.placements.values()].filter((other) => other.group === group && other.card === placement.card);
      const expected = cardSection ?? members[0]?.section;
      const where = (section: string | undefined): string => (section === undefined ? "no section" : `section "${section}"`);
      if ((cardSection !== undefined || members.length > 0) && placement.section !== undefined && placement.section !== expected) {
        throw new AdminPanelConfigError(`"${label}" is in ${where(placement.section)}, but its card "${placement.card}" is in ${where(expected)}; a card is in one section`);
      }
      if (cardSection === undefined && members.length > 0 && placement.section === undefined && expected !== undefined) placement.section = expected;
      if (members.length >= MAX_LIST_CARD_VALUES) throw new AdminPanelConfigError(`card "${placement.card}" would hold more than ${MAX_LIST_CARD_VALUES} values; split it, or use sections`);
    }
    if (placement.section !== undefined) this.ensureSection(group, placement.section);
    this.placements.set(key, placement);
  }

  /** A value moved to another group: its section and card were the old group's, so it leaves them. */
  moved(key: string, group: string): void {
    const placement = this.placements.get(key);
    if (placement === undefined || placement.group === group) return;
    this.placements.set(key, { group, ...(placement.emphasis !== undefined ? { emphasis: placement.emphasis } : {}) });
  }

  section(group: string, name: string, options: SectionOptions): void {
    rejectUnknown(options, ["group", "title", "description", "order", "collapsed", "collapsible", "density", "columns"], `section("${name}")`);
    const checked = checkName("section", name);
    if (options.title !== undefined) checkTitle(options.title);
    if (options.collapsed !== undefined && typeof options.collapsed !== "boolean") throw new AdminPanelConfigError(`section "${checked}": collapsed is true or false`);
    if (options.collapsible !== undefined && typeof options.collapsible !== "boolean") throw new AdminPanelConfigError(`section "${checked}": collapsible is true or false`);
    if (options.collapsed === true && options.collapsible === false) throw new AdminPanelConfigError(`section "${checked}" is collapsed but not collapsible: nobody could open it`);
    if (options.density !== undefined && options.density !== "compact" && options.density !== "comfortable") throw new AdminPanelConfigError(`section "${checked}" has density ${JSON.stringify(options.density)}; it is "compact" or "comfortable"`);
    if (options.columns !== undefined && (!Number.isInteger(options.columns) || options.columns < 1 || options.columns > 24)) throw new AdminPanelConfigError(`section "${checked}" has ${JSON.stringify(options.columns)} columns; it is a whole number from 1 to 24`);
    if (options.order !== undefined && !Number.isFinite(options.order)) throw new AdminPanelConfigError(`section "${checked}" has order ${JSON.stringify(options.order)}; it is a number`);
    const entry = this.ensureSection(group, checked);
    const { group: _group, ...rest } = options;
    entry.options = { ...entry.options, ...rest };
  }

  card(group: string, name: string, options: ListCardOptions): void {
    rejectUnknown(options, ["group", "section", "title", "description", "layout", "span", "size", "emphasis"], `card("${name}")`);
    const checked = checkName("card", name);
    if (options.title !== undefined) checkTitle(options.title);
    if (options.layout !== undefined && !(CARD_LAYOUTS as readonly string[]).includes(options.layout)) throw new AdminPanelConfigError(`card "${checked}" has layout ${JSON.stringify(options.layout)}; it is one of ${CARD_LAYOUTS.map((layout) => `"${layout}"`).join(", ")}`);
    if (options.emphasis !== undefined && !EMPHASES.includes(options.emphasis)) throw new AdminPanelConfigError(`card "${checked}" has emphasis ${JSON.stringify(options.emphasis)}; it is "primary" or "secondary"`);
    checkSpan(checked, options.span);
    if (options.size !== undefined) {
      const size = checkSize(options.size);
      if (typeof size === "string") throw new AdminPanelConfigError(`card "${checked}" has size ${JSON.stringify(options.size)}: ${size}`);
    }
    const section = options.section === undefined ? undefined : checkName("section", options.section);
    if (section !== undefined) {
      // Values already in the card and in another section: the card cannot be in two.
      const stray = [...this.placements.entries()].find(([, placement]) => placement.group === group && placement.card === checked && placement.section !== undefined && placement.section !== section);
      if (stray !== undefined) throw new AdminPanelConfigError(`card "${checked}" is put in section "${section}", but "${stray[0].slice(6)}" in it is in section "${stray[1].section}"; a card is in one section`);
      this.ensureSection(group, section);
    }
    let cards = this.cards.get(group);
    if (cards === undefined) {
      cards = new Map();
      this.cards.set(group, cards);
    }
    const entry = cards.get(checked) ?? { options: {}, sequence: this.nextSequence() };
    const { group: _group, ...rest } = options;
    entry.options = { ...entry.options, ...rest, ...(section !== undefined ? { section } : {}) };
    cards.set(checked, entry);
  }

  /** A line, a gap or a row break, placed among the group's cards in order of declaration. */
  mark(group: string, kind: MarkEntry["kind"], options: MarkOptions): void {
    const where = `${kind}()`;
    rejectUnknown(options, kind === "divider" ? ["group", "section", "label", "order"] : kind === "spacer" ? ["group", "section", "size", "order"] : ["group", "section", "order"], where);
    const list = this.marks.get(group) ?? [];
    if (list.length >= MAX_LAYOUT_MARKS_PER_GROUP) throw new AdminPanelConfigError(`group "${group}" has more than ${MAX_LAYOUT_MARKS_PER_GROUP} dividers, spacers and breaks`);
    if (options.size !== undefined && !(SPACER_SIZES as readonly string[]).includes(options.size)) throw new AdminPanelConfigError(`${where} has size ${JSON.stringify(options.size)}; it is "sm", "md" or "lg"`);
    if (options.order !== undefined && !Number.isFinite(options.order)) throw new AdminPanelConfigError(`${where} has order ${JSON.stringify(options.order)}; it is a number`);
    const entry: MarkEntry = { id: `${kind}-${++this.markCount}`, kind, order: options.order ?? 0, sequence: this.nextSequence() };
    if (options.label !== undefined) entry.label = checkTitle(options.label);
    if (options.size !== undefined) entry.size = options.size;
    if (options.section !== undefined) {
      entry.section = checkName("section", options.section);
      this.ensureSection(group, entry.section);
    }
    list.push(entry);
    this.marks.set(group, list);
  }

  /** The marks of a group, for ordering with its items: each with its order and sequence. */
  marksOf(group: string): ReadonlyArray<{ order: number; sequence: number; id: string }> {
    return this.marks.get(group) ?? [];
  }

  /** Writes section, card and emphasis onto each item, and the group's sections, cards and marks onto it. */
  annotate(group: string, schema: GroupSchema, keyOf: (item: ItemSchema) => string, sequence: ReadonlyArray<{ kind: "item"; item: ItemSchema } | { kind: "mark"; id: string }>): void {
    const sections = this.sections.get(group);
    const sectionId = new Map<string, string>();
    const cardId = new Map<string, string>();
    const usedSections = new Set<string>();
    const usedCards = new Set<string>();
    const ids = new Set<string>();
    const unique = (base: string, fallback: string): string => {
      let id = base || fallback;
      for (let n = 2; ids.has(id); n += 1) id = `${base || fallback}-${n}`;
      ids.add(id);
      return id;
    };
    if (sections !== undefined) {
      for (const name of [...sections.keys()]) sectionId.set(name, unique(slug(name), "section"));
    }
    for (const name of this.cards.get(group)?.keys() ?? []) cardId.set(name, unique(`card-${slug(name)}`, "card"));
    for (const item of schema.items) {
      const placement = this.placements.get(keyOf(item));
      if (placement === undefined || placement.group !== group) continue;
      const section = placement.section ?? (placement.card !== undefined ? this.cards.get(group)?.get(placement.card)?.options.section : undefined);
      if (section !== undefined) {
        item.section = sectionId.get(section) ?? unique(slug(section), "section");
        usedSections.add(section);
      }
      if (placement.card !== undefined) {
        if (!cardId.has(placement.card)) cardId.set(placement.card, unique(`card-${slug(placement.card)}`, "card"));
        item.card = cardId.get(placement.card) as string;
        usedCards.add(placement.card);
      }
      if (placement.emphasis !== undefined) item.emphasis = placement.emphasis;
    }
    const marks = this.marks.get(group) ?? [];
    for (const mark of marks) if (mark.section !== undefined) usedSections.add(mark.section);
    if (usedSections.size > 0) {
      const list: Array<SectionSchema & { order: number; sequence: number }> = [];
      for (const name of usedSections) {
        const entry = sections?.get(name) as SectionEntry;
        const o = entry.options;
        const out: SectionSchema & { order: number; sequence: number } = { id: sectionId.get(name) as string, title: o.title ?? name, collapsible: o.collapsible !== false, order: o.order ?? 0, sequence: entry.sequence };
        if (o.description !== undefined) out.description = o.description;
        if (o.collapsed === true) out.collapsed = true;
        if (o.density !== undefined) out.density = o.density;
        if (o.columns !== undefined) out.columns = o.columns;
        list.push(out);
      }
      if (list.length > MAX_SECTIONS_PER_GROUP) throw new AdminPanelConfigError(`group "${group}" has ${list.length} sections; at most ${MAX_SECTIONS_PER_GROUP}`);
      list.sort((a, b) => a.order - b.order || a.sequence - b.sequence);
      schema.sections = list.map(({ order: _order, sequence: _sequence, ...rest }) => rest);
    }
    if (usedCards.size > 0) {
      const cards: ListCardSchema[] = [];
      for (const name of usedCards) {
        const o = this.cards.get(group)?.get(name)?.options ?? {};
        const out: ListCardSchema = { id: cardId.get(name) as string, title: o.title ?? name, layout: o.layout ?? "list" };
        if (o.description !== undefined) out.description = o.description;
        if (o.span !== undefined) out.span = o.span as Span;
        if (o.size !== undefined) out.size = o.size as CardSize;
        if (o.emphasis !== undefined) out.emphasis = o.emphasis;
        cards.push(out);
      }
      schema.cards = cards;
    }
    if (marks.length > 0) {
      const byId = new Map(marks.map((mark) => [mark.id, mark]));
      const out: LayoutMarkSchema[] = [];
      sequence.forEach((step, index) => {
        if (step.kind !== "mark") return;
        const mark = byId.get(step.id) as MarkEntry;
        const section = mark.section === undefined ? undefined : sectionId.get(mark.section);
        const wire: LayoutMarkSchema = { id: mark.id, kind: mark.kind };
        if (mark.label !== undefined) wire.label = mark.label;
        if (mark.size !== undefined) wire.size = mark.size;
        if (section !== undefined) wire.section = section;
        // The card it stands before: the next item in the same section, or none, at the section's end.
        for (const next of sequence.slice(index + 1)) {
          if (next.kind !== "item" || next.item.section !== section) continue;
          wire.before = keyOf(next.item);
          break;
        }
        out.push(wire);
      });
      schema.marks = out;
    }
  }

  private ensureSection(group: string, name: string): SectionEntry {
    let sections = this.sections.get(group);
    if (sections === undefined) {
      sections = new Map();
      this.sections.set(group, sections);
    }
    let entry = sections.get(name);
    if (entry === undefined) {
      if (sections.size >= MAX_SECTIONS_PER_GROUP) throw new AdminPanelConfigError(`group "${group}" would have more than ${MAX_SECTIONS_PER_GROUP} sections`);
      entry = { options: {}, sequence: this.nextSequence() };
      sections.set(name, entry);
    }
    return entry;
  }
}
