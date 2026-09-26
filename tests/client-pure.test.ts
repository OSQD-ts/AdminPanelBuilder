import { describe, expect, it } from "vitest";
import { toCsv } from "../src/client/csv.js";
import { initialsOf, slotOf } from "../src/client/format.js";
import { binCount, histogram, lttb, stack } from "../src/client/downsample.js";
import { translator } from "../src/client/i18n.js";

describe("downsampling", () => {
  it("keeps the ends and the peaks, and leaves short series alone", () => {
    const points = Array.from({ length: 1000 }, (_, x) => [x, x === 500 ? 100 : 0] as [number, number]);
    const reduced = lttb(points, 50);
    expect(reduced).toHaveLength(50);
    expect(reduced[0]).toEqual([0, 0]);
    expect(reduced.at(-1)).toEqual([999, 0]);
    expect(reduced.some(([, y]) => y === 100)).toBe(true);
    expect(lttb(points.slice(0, 10), 50)).toHaveLength(10);
  });
});

describe("histograms and stacking", () => {
  it("bin values over their range", () => {
    expect(histogram([1, 2, 3, 4], 2).map((bin) => bin.count)).toEqual([2, 2]);
    expect(binCount(1000)).toBe(11);
  });

  it("stack series on the union of their times, carrying values forward", () => {
    const { times, layers } = stack([
      [[0, 1], [2, 3]],
      [[1, 10]],
    ]);
    expect(times).toEqual([0, 1, 2]);
    expect(layers[1]).toEqual([[0, 1], [1, 11], [2, 13]]);
  });
});

describe("CSV export", () => {
  it("quotes every cell and defuses what a spreadsheet would run as a formula", () => {
    expect(toCsv([["key", "value"], ['=HYPERLINK("x")', "-3"], ['say "hi"', "@SUM(A1)"]])).toBe('"key","value"\r\n"\'=HYPERLINK(""x"")","-3"\r\n"say ""hi""","\'@SUM(A1)"');
  });
});

describe("the page's words", () => {
  it("come in the schema's language, with the application's replacements on top", () => {
    // The client carries English; another language arrives with the schema as `translations`.
    expect(translator({ locale: "pl", translations: { apply: "Zastosuj" } })("apply")).toBe("Zastosuj");
    expect(translator({ locale: "pl" })("apply")).toBe("Apply");
    expect(translator({ locale: "en", messages: { apply: "Save" } })("apply")).toBe("Save");
    expect(translator({ locale: "en" })("reconnecting", { seconds: 4 })).toBe("Cannot reach the panel. Trying again in 4 s.");
  });
});

describe("who made a change", () => {
  it("has up to two initials, and the same colour slot on every page", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("ada")).toBe("AD");
    expect(initialsOf("ops-bot")).toBe("OB");
    expect(initialsOf("sam.k@example.com")).toBe("SK");
    expect(initialsOf("")).toBe("?");
    expect(slotOf("ada")).toBe(slotOf("ada"));
    for (const name of ["ada", "sam", "ops-bot", "store", "a very long operator name"]) {
      expect(slotOf(name)).toBeGreaterThanOrEqual(1);
      expect(slotOf(name)).toBeLessThanOrEqual(8);
    }
  });
});
