/**
 * A repeating change across a clock change. Its time is a wall-clock time in its own zone, so on
 * the day the clocks go forward it can name a time that does not exist, and on the day they go
 * back one that happens twice. Europe/Warsaw changes on 29 March 2026 (02:00 → 03:00) and on
 * 25 October 2026 (03:00 → 02:00).
 */
import { describe, expect, it } from "vitest";
import { checkRepeat, nextRun } from "../src/panel/recurrence.js";

const at = (iso: string): number => Date.parse(iso);
const daily = (time: string) => checkRepeat({ every: "day", at: time, timeZone: "Europe/Warsaw" });

describe("a daily change on the day the clocks go forward", () => {
  it("runs at the first moment after a time the day does not have, not an hour early or a day late", () => {
    // 02:30 does not exist in Warsaw on 29 March: 01:59 CET is followed by 03:00 CEST, 01:00 UTC.
    expect(nextRun(daily("02:30"), at("2026-03-28T23:00:00Z"))).toBe(at("2026-03-29T01:00:00Z"));
  });

  it("runs at the named time the day before and the day after, in each day's own offset", () => {
    expect(nextRun(daily("02:30"), at("2026-03-27T23:00:00Z"))).toBe(at("2026-03-28T01:30:00Z"));
    expect(nextRun(daily("02:30"), at("2026-03-29T01:00:00Z"))).toBe(at("2026-03-30T00:30:00Z"));
  });

  it("treats a time just past the gap like any other", () => {
    expect(nextRun(daily("03:15"), at("2026-03-28T23:00:00Z"))).toBe(at("2026-03-29T01:15:00Z"));
  });
});

describe("a daily change on the day the clocks go back", () => {
  it("runs once, at the first of the two moments with that time", () => {
    // 02:30 happens twice on 25 October: at 00:30 UTC (CEST) and at 01:30 UTC (CET).
    const first = nextRun(daily("02:30"), at("2026-10-24T22:00:00Z"));
    expect(first).toBe(at("2026-10-25T00:30:00Z"));
    // After it, the next run is the next day's, not the repeat of the same wall time.
    expect(nextRun(daily("02:30"), first)).toBe(at("2026-10-26T01:30:00Z"));
  });
});

describe("a weekly change across a clock change", () => {
  it("lands on its weekday at its time in the new offset", () => {
    // Sunday 29 March 2026 is the change itself; the following Sunday is 5 April, in CEST.
    const sunday = checkRepeat({ every: "week", weekday: 0, at: "09:00", timeZone: "Europe/Warsaw" });
    expect(nextRun(sunday, at("2026-03-29T07:00:00Z"))).toBe(at("2026-04-05T07:00:00Z"));
    expect(nextRun(sunday, at("2026-03-28T12:00:00Z"))).toBe(at("2026-03-29T07:00:00Z"));
  });
});
