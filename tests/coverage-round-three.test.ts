/** Paths of this round's modules a feature test does not walk: rule checks, group handles, the sync parser, sentences. */
import { describe, expect, it } from "vitest";
import { createAdminPanel } from "../src/index.js";
import { checkRepeat, describeRepeat, nextRun } from "../src/panel/recurrence.js";
import { MAX_SYNC_MESSAGE_BYTES, parseMessage } from "../src/panel/sync.js";

// Loaded by URL: when.ts is browser code, and this project type-checks without the DOM.
interface WhenModule {
  scheduledSentence(entry: Record<string, unknown>, spec: Record<string, unknown> | undefined, now: number, t: never): string;
  describeRule(rule: Record<string, unknown>, t: never): string;
}
const when = (await import(new URL("../src/client/when.ts", import.meta.url).href)) as WhenModule;
const t = Object.assign((key: string, values: Record<string, string | number> = {}) => `${key}(${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(",")})`, { locale: "en" }) as never;

describe("repeat rules", () => {
  it("refuse every malformed rule with a sentence", () => {
    for (const [rule, pattern] of [
      [null, /repeat must be/],
      [{ every: "day", at: "02:00", timeZone: "UTC", extra: 1 }, /"extra"/],
      [{ every: "hour", at: "02:00", timeZone: "UTC" }, /"day" or "week"/],
      [{ every: "day", at: "2:00", timeZone: "UTC" }, /24-hour/],
      [{ every: "week", at: "02:00", timeZone: "UTC" }, /weekday is 0/],
      [{ every: "day", at: "02:00", weekday: 1, timeZone: "UTC" }, /weekly change only/],
      [{ every: "day", at: "02:00", timeZone: "Nowhere/City" }, /not a time zone/],
    ] as const) {
      expect(() => checkRepeat(rule)).toThrow(pattern);
    }
    expect(checkRepeat({ every: "week", at: "09:30", weekday: 3, timeZone: "UTC" })).toEqual({ every: "week", at: "09:30", weekday: 3, timeZone: "UTC" });
  });

  it("find the next run in a zone ahead of and behind UTC, and describe themselves", () => {
    const after = Date.parse("2026-09-21T23:30:00Z");
    expect(new Date(nextRun({ every: "day", at: "01:00", timeZone: "Asia/Tokyo" }, after)).toISOString()).toBe("2026-09-22T16:00:00.000Z");
    expect(new Date(nextRun({ every: "week", at: "18:00", weekday: 0, timeZone: "America/New_York" }, after)).toISOString()).toBe("2026-09-27T22:00:00.000Z");
    expect(describeRepeat({ every: "week", at: "18:00", weekday: 0, timeZone: "UTC" })).toBe("every Sunday at 18:00 (UTC)");
    expect(describeRepeat({ every: "day", at: "02:00", timeZone: "UTC" })).toBe("every day at 02:00 (UTC)");
  });
});

describe("a group's handle", () => {
  it("declares everything into its group, and moves things in after the fact", () => {
    const panel = createAdminPanel();
    const games = panel.group("Games");
    const value = games.viewable(1, "Players");
    games.modifiable(2, "Limit");
    games.action("Flush", () => "flushed");
    games.table("Rows", { columns: ["id"], rows: () => [] });
    games.feed("Events");
    const stray = panel.viewable(3, "Stray");
    games.add(stray).configure({ description: "The games in progress" });
    expect(value.group).toBe("Games");
    const schema = panel.schema().groups.find((group) => group.title === "Games");
    expect(schema?.items.map((item) => item.id)).toEqual(expect.arrayContaining(["players", "limit", "flush", "rows", "events", "stray"]));
    expect(schema?.description).toBe("The games in progress");
    panel.close();
  });
});

describe("the sync parser", () => {
  it("reads each kind of message, and drops what does not fit", () => {
    const change = { origin: "a", target: "x", value: 1, record: { id: 1, kind: "edit", target: "x", label: "x", by: "ada", at: 1, ok: true } };
    expect(parseMessage(JSON.stringify(change))).toEqual(change);
    expect(parseMessage(JSON.stringify({ ...change, type: "change" }))).toBeDefined();
    expect(parseMessage(JSON.stringify({ type: "pending", origin: "a", removed: false, entry: { id: "p1" } }))).toBeDefined();
    expect(parseMessage(JSON.stringify({ type: "schedule", origin: "a", removed: true, id: "s1", entry: {} }))).toBeDefined();
    for (const bad of [
      "[]",
      JSON.stringify({ origin: 1 }),
      JSON.stringify({ type: "pending", origin: "a", removed: "no", entry: { id: "p1" } }),
      JSON.stringify({ type: "schedule", origin: "a", removed: true, entry: {} }),
      JSON.stringify({ type: "other", origin: "a" }),
      JSON.stringify({ ...change, record: { ...change.record, by: 1 } }),
      JSON.stringify({ ...change, record: null }),
      "x".repeat(MAX_SYNC_MESSAGE_BYTES + 1),
    ]) {
      expect(parseMessage(bad)).toBeUndefined();
    }
  });
});

describe("the page's sentences about schedules", () => {
  it("say a one-off and a repeating change, for a value and a profile, with the length and the reason", () => {
    const now = Date.parse("2026-09-21T12:00:00Z");
    const once = { id: "s1", at: now + 3_600_000, by: "ada", to: 5, reason: "load", revertAfterMs: 900_000 };
    expect(when.scheduledSentence(once, {}, now, t)).toMatch(/^scheduledFor\(value=5,.*in=1 h,by=ada\) \(forLength\(length=15 min\)\) reasonShown\(reason=load\)$/);
    const daily = { id: "e1", at: now, by: "ada", repeat: { every: "day" as const, at: "02:00", timeZone: "UTC" } };
    expect(when.scheduledSentence(daily, undefined, now, t)).toMatch(/^profileScheduledRepeat\(rule=ruleDaily\(time=02:00,zone=UTC\)/);
    expect(when.scheduledSentence({ id: "s2", at: now, by: "ada" }, undefined, now, t)).toMatch(/^profileScheduled\(/);
    expect(when.describeRule({ every: "week", at: "09:00", weekday: 1, timeZone: "UTC" }, t)).toBe("ruleWeekly(day=Monday,time=09:00,zone=UTC)");
  });
});
