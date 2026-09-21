import { describe, expect, it } from "vitest";
import { formatAgo, formatBytes, formatDuration, formatNumber, formatValue, numericEntries } from "../src/client/format.js";

describe("writing a number for a person", () => {
  it("honours the declared format, unit and decimals", () => {
    expect(formatNumber(1234.567, { format: "integer" })).toBe((1235).toLocaleString());
    expect(formatNumber(0.256, { format: "percent" })).toBe(`${(25.6).toLocaleString()}%`);
    expect(formatNumber(12.5, { unit: "ms", decimals: 0 })).toBe("13 ms");
    expect(formatNumber(Number.NaN)).toBe("NaN");
  });

  it("uses binary units and says so", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe(`${(1.5).toLocaleString()} KiB`);
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GiB");
  });

  it("writes durations in their two largest units", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(4200)).toBe(`${(4.2).toLocaleString()} s`);
    expect(formatDuration(185_000)).toBe("3 min 5 s");
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000 + 5000)).toBe("3 d 4 h");
  });

  it("says how long ago without trusting the viewer's clock", () => {
    expect(formatAgo(10_000, 10_500)).toBe("just now");
    expect(formatAgo(0, 42_000)).toBe("42 s ago");
    expect(formatAgo(0, 5 * 60_000)).toBe("5 min ago");
  });
});

describe("writing a value for a person", () => {
  it("shows null as a dash, booleans as words and records as JSON", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(true)).toBe("On");
    expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("finds numeric entries in a record, an array of numbers, pairs, and labelled objects", () => {
    expect(numericEntries({ a: 1, b: "x", c: 2 })).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
    expect(numericEntries([5, 6])).toEqual([
      ["0", 5],
      ["1", 6],
    ]);
    expect(numericEntries([["gmail", 3]])).toEqual([["gmail", 3]]);
    expect(numericEntries([{ label: "ses", value: 9 }])).toEqual([["ses", 9]]);
    expect(numericEntries("not a record")).toEqual([]);
  });
});
