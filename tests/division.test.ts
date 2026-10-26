/**
 * What a divided tab is drawn as (src/client/division.ts), decided without a browser: which groups
 * are divided, what each section holds and in which order, what a filter keeps, when there is an
 * outline or sub-tabs, which sections a viewer finds open, where the arrow keys move, and how big a
 * list card starts. The browser suite checks that the page draws what this decides.
 */
import { describe, expect, it } from "vitest";
import { FILTER_FROM, OUTLINE_FROM, filterWords, firstSubtab, isDivided, isTabbed, itemKey, listSizing, matchesWords, rememberSection, searchable, sectionClosed, sectionSteps, subtabMove, wantsFilter, wantsOutline } from "../src/client/division.js";
import { MAX_CARD_ROWS } from "../src/panel/layout.js";
import type { GroupSchema, ItemSchema, ListCardSchema, SectionSchema } from "../src/types.js";
import { panelAt } from "./helpers.js";

type Panel = ReturnType<typeof panelAt>["panel"];

const groupOf = (panel: Panel, title: string): GroupSchema => {
  const group = panel.schema().groups.find((entry) => entry.title === title);
  if (group === undefined) throw new Error(`no group ${title}`);
  return group;
};

/** What a section's steps read as: item labels and mark kinds, in order. */
const read = (group: GroupSchema, section: string | undefined): string[] =>
  sectionSteps(group, section).map((step) => (step.kind === "mark" ? `[${step.mark.kind}${step.mark.label === undefined ? "" : `:${step.mark.label}`}]` : "label" in step.item ? step.item.label : step.item.title));

describe("which groups are divided", () => {
  it("leaves a group that asks for nothing exactly as it always was, however many values it has", () => {
    const { panel } = panelAt();
    for (let index = 0; index < FILTER_FROM + 5; index++) panel.viewable(index, { label: `v${index}`, group: "Plain" });
    expect(isDivided(groupOf(panel, "Plain"))).toBe(false);
  });

  it("divides a group for each thing that asks for it", () => {
    const cases: Array<[string, (panel: Panel) => void]> = [
      ["a section", (panel) => panel.viewable(1, { label: "a", group: "G", section: "S" })],
      ["a list card", (panel) => panel.viewable(1, { label: "a", group: "G", card: "C" })],
      [
        "a divider",
        (panel) => {
          const g = panel.group("G");
          g.viewable(1, { label: "a" });
          g.divider();
        },
      ],
      ["a density", (panel) => panel.group("G", { density: "compact" }).viewable(1, { label: "a" })],
      ["a filter", (panel) => panel.group("G", { filter: true }).viewable(1, { label: "a" })],
      ["an outline", (panel) => panel.group("G", { outline: true }).viewable(1, { label: "a" })],
      ["an emphasis", (panel) => panel.viewable(1, { label: "a", group: "G", emphasis: "primary" })],
    ];
    for (const [what, declare] of cases) {
      const { panel } = panelAt();
      declare(panel);
      expect(isDivided(groupOf(panel, "G")), what).toBe(true);
    }
  });
});

describe("what a section holds, in order", () => {
  it("puts each mark before the item it names and the rest at the end, section by section", () => {
    const { panel } = panelAt();
    const g = panel.group("G");
    g.section("Live");
    g.viewable(1, { label: "top" });
    g.viewable(2, { label: "a", section: "Live" });
    g.divider({ label: "Machines", section: "Live" });
    g.viewable(3, { label: "b", section: "Live" });
    g.spacer({ section: "Live" });
    g.break({ section: "Live" });
    const group = groupOf(panel, "G");
    expect(read(group, undefined)).toEqual(["top"]);
    expect(read(group, "live")).toEqual(["a", "[divider:Machines]", "b", "[spacer]", "[break]"]);
  });

  it("keeps two marks before the same item in the order they were declared", () => {
    const { panel } = panelAt();
    const g = panel.group("G");
    g.viewable(1, { label: "a" });
    g.divider({ label: "one" });
    g.spacer();
    g.viewable(2, { label: "b" });
    expect(read(groupOf(panel, "G"), undefined)).toEqual(["a", "[divider:one]", "[spacer]", "b"]);
  });

  it("is empty for a section with nothing in it, and for a section another group has", () => {
    const { panel } = panelAt();
    panel.group("G").section("Empty");
    panel.viewable(1, { label: "a", group: "G" });
    const group = groupOf(panel, "G");
    expect(sectionSteps(group, "empty")).toEqual([]);
    expect(sectionSteps(group, "nowhere")).toEqual([]);
  });

  it("leaves out a chart drawn with its value, which is not a card of the section", () => {
    const { panel } = panelAt();
    panel.viewable(1, { label: "a", group: "G" });
    const group = groupOf(panel, "G");
    const alone = { ...(group.items[0] as object), type: "chart", id: "c", title: "c", placement: "alone" } as unknown as ItemSchema;
    const grouped = { ...(group.items[0] as object), type: "chart", id: "d", title: "d", placement: "group" } as unknown as ItemSchema;
    const withCharts: GroupSchema = { ...group, items: [...group.items, alone, grouped] };
    expect(sectionSteps(withCharts, undefined).map((step) => (step.kind === "item" ? step.item.id : step.mark.id))).toEqual(["a", "d"]);
  });

  it("names items the way marks do", () => {
    const { panel } = panelAt();
    panel.viewable(1, { label: "Players", group: "G" });
    expect(itemKey(groupOf(panel, "G").items[0] as ItemSchema)).toBe("value:players");
  });
});

describe("the filter box", () => {
  it("splits what is typed into lower-case words, ignoring extra space", () => {
    expect(filterWords("  Max   Players ")).toEqual(["max", "players"]);
    expect(filterWords("   ")).toEqual([]);
  });

  it("keeps a row only when its text holds every word, and keeps everything for no words", () => {
    const text = searchable("Max players", "Per server", "Limits");
    expect(text).toBe("max players per server limits");
    expect(matchesWords(text, ["max", "limits"])).toBe(true);
    expect(matchesWords(text, ["max", "memory"])).toBe(false);
    expect(matchesWords(text, [])).toBe(true);
    // A row is found by its list card's name too, and an absent line adds nothing.
    expect(searchable("Max", undefined, "Limits")).toBe("max limits");
  });

  it("is offered from 16 values unless the group says, and only values count", () => {
    const many = panelAt().panel;
    for (let index = 0; index < FILTER_FROM; index++) many.viewable(index, { label: `v${index}`, group: "G" });
    expect(wantsFilter(groupOf(many, "G"))).toBe(true);
    const few = panelAt().panel;
    for (let index = 0; index < FILTER_FROM - 1; index++) few.viewable(index, { label: `v${index}`, group: "G" });
    few.action("Go", () => "ok", { group: "G" });
    expect(wantsFilter(groupOf(few, "G"))).toBe(false);
    const off = panelAt().panel;
    const g = off.group("G", { filter: false });
    for (let index = 0; index < FILTER_FROM + 2; index++) g.viewable(index, { label: `v${index}` });
    expect(wantsFilter(groupOf(off, "G"))).toBe(false);
  });
});

describe("sub-tabs and the outline", () => {
  it("draws sections as tabs only when asked and there is more than one", () => {
    const one = panelAt().panel;
    one.group("G", { sections: "tabs" }).section("A").viewable(1, { label: "a", section: "A" });
    expect(isTabbed(groupOf(one, "G"))).toBe(false);
    const two = panelAt().panel;
    const g = two.group("G", { sections: "tabs" });
    g.viewable(1, { label: "a", section: "A" });
    g.viewable(2, { label: "b", section: "B" });
    expect(isTabbed(groupOf(two, "G"))).toBe(true);
    // Tabs are the list of sections, so there is no outline above them.
    expect(wantsOutline(groupOf(two, "G"), 2)).toBe(false);
  });

  it("lists the sections at the top from four drawn sections, unless the group says", () => {
    const { panel } = panelAt();
    panel.viewable(1, { label: "a", group: "G", section: "S" });
    const group = groupOf(panel, "G");
    expect(wantsOutline(group, OUTLINE_FROM - 1)).toBe(false);
    expect(wantsOutline(group, OUTLINE_FROM)).toBe(true);
    expect(wantsOutline({ ...group, outline: true }, 1)).toBe(true);
    expect(wantsOutline({ ...group, outline: false }, OUTLINE_FROM + 3)).toBe(false);
  });

  it("moves along the tabs with the arrow keys, wrapping, and jumps with Home and End", () => {
    expect(subtabMove("ArrowRight", 0, 3)).toBe(1);
    expect(subtabMove("ArrowRight", 2, 3)).toBe(0);
    expect(subtabMove("ArrowLeft", 0, 3)).toBe(2);
    expect(subtabMove("Home", 2, 3)).toBe(0);
    expect(subtabMove("End", 0, 3)).toBe(2);
    expect(subtabMove("Enter", 1, 3)).toBeUndefined();
  });

  it("shows the tab last shown when it is still there, else the first", () => {
    expect(firstSubtab(["a", "b", "c"], "b")).toBe("b");
    expect(firstSubtab(["a", "b", "c"], "gone")).toBe("a");
    expect(firstSubtab(["a", "b"], undefined)).toBe("a");
    expect(firstSubtab([], "b")).toBe("");
  });
});

describe("open and closed sections", () => {
  const open: SectionSchema = { id: "s", title: "S", collapsible: true };
  const shut: SectionSchema = { id: "s", title: "S", collapsible: true, collapsed: true };

  it("starts each section as its code says until the viewer chooses", () => {
    expect(sectionClosed(open, new Set(), "g/s")).toBe(false);
    expect(sectionClosed(shut, new Set(), "g/s")).toBe(true);
  });

  it("remembers a choice against the default, and forgets one that agrees with it", () => {
    const prefs = new Set<string>();
    rememberSection(open, prefs, "g/s", false);
    expect(sectionClosed(open, prefs, "g/s")).toBe(true);
    rememberSection(open, prefs, "g/s", true);
    expect(sectionClosed(open, prefs, "g/s")).toBe(false);
    expect(prefs.size).toBe(0);

    rememberSection(shut, prefs, "g/s", true);
    expect(sectionClosed(shut, prefs, "g/s")).toBe(false);
    rememberSection(shut, prefs, "g/s", false);
    expect(sectionClosed(shut, prefs, "g/s")).toBe(true);
    expect(prefs.size).toBe(0);
  });

  it("keeps each section's choice apart, and leaves other preferences alone", () => {
    const prefs = new Set<string>(["card:x"]);
    rememberSection(open, prefs, "g/one", false);
    expect(sectionClosed(open, prefs, "g/one")).toBe(true);
    expect(sectionClosed(open, prefs, "g/two")).toBe(false);
    expect(prefs.has("card:x")).toBe(true);
  });
});

describe("how big a list card starts", () => {
  const shape = { columns: 12, rowHeight: 40 };
  const card = (extra: Partial<ListCardSchema> = {}): ListCardSchema => ({ id: "c", title: "C", layout: "list", ...extra });

  it("takes half a row as a list and the whole row in columns or tiles", () => {
    expect(listSizing(card(), shape, 4).pref.w).toBe(6);
    expect(listSizing(card({ layout: "columns:2" }), shape, 4).pref.w).toBe(12);
    expect(listSizing(card({ layout: "columns:3" }), shape, 4).pref.w).toBe(12);
    expect(listSizing(card({ layout: "grid" }), shape, 4).pref.w).toBe(12);
  });

  it("grows with its rows and never past the tallest card", () => {
    const short = listSizing(card(), shape, 2).pref.h;
    const tall = listSizing(card(), shape, 12).pref.h;
    expect(tall).toBeGreaterThan(short);
    expect(listSizing(card(), shape, 500).pref.h).toBe(MAX_CARD_ROWS);
    // Rows in columns share a line, so the same values need fewer rows.
    expect(listSizing(card({ layout: "columns:3" }), shape, 12).pref.h).toBeLessThan(tall);
    expect(listSizing(card(), shape, 0).pref.h).toBeGreaterThanOrEqual(2);
  });

  it("follows a named width, scaled to a narrower grid", () => {
    expect(listSizing(card({ span: "third" }), shape, 3).pref.w).toBe(4);
    expect(listSizing(card({ span: "full" }), { columns: 6, rowHeight: 40 }, 3).pref.w).toBe(6);
    expect(listSizing(card({ span: "half" }), { columns: 6, rowHeight: 40 }, 3).pref.w).toBe(3);
  });

  it("is fixed and locked when the card gives a size, clipped to the grid", () => {
    const sized = listSizing(card({ size: { w: 20, h: 5 } }), shape, 40);
    expect(sized.locked).toBe(true);
    expect(sized.pref).toEqual({ w: 12, h: 5 });
    expect(sized.min).toEqual(sized.pref);
    expect(sized.max).toEqual(sized.pref);
  });
});
