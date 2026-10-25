import { describe, expect, it } from "vitest";
import { formatAgo, formatClock, formatMoment, formatTime, formatValue, isoInZone } from "../src/client/format.js";
import { timeFor, translator } from "../src/client/i18n.js";
import { loadPrefs } from "../src/client/prefs.js";
import { AdminPanelConfigError } from "../src/errors.js";
import { checkDateFormat, checkTimeSettings, isAllowedImageSource } from "../src/values/display.js";
import { call, panelAt, routerFor } from "./helpers.js";

// Fixed moments, so nothing depends on when or where the suite runs (CI also runs it in Australia/Eucla).
// 2026-03-29 is the night Europe/Warsaw moves from +01:00 to +02:00 at 01:00 UTC.
const BEFORE_DST = Date.UTC(2026, 2, 29, 0, 30); // 01:30 in Warsaw, +01:00
const AFTER_DST = Date.UTC(2026, 2, 29, 1, 30); // 03:30 in Warsaw, +02:00
const NOON_UTC = Date.UTC(2026, 9, 25, 12, 0, 5);

describe("writing a moment in a zone", () => {
  it("writes ISO 8601 with the zone's offset at that moment, across a DST change", () => {
    expect(isoInZone(BEFORE_DST, "Europe/Warsaw")).toBe("2026-03-29T01:30:00+01:00");
    expect(isoInZone(AFTER_DST, "Europe/Warsaw")).toBe("2026-03-29T03:30:00+02:00");
    expect(isoInZone(NOON_UTC, "UTC")).toBe("2026-10-25T12:00:05Z");
  });

  it("handles a zone whose offset is not whole hours", () => {
    // Australia/Eucla is +08:45 all year.
    expect(isoInZone(NOON_UTC, "Australia/Eucla")).toBe("2026-10-25T20:45:05+08:45");
    expect(isoInZone(NOON_UTC, "Asia/Kathmandu")).toBe("2026-10-25T17:45:05+05:45");
    expect(isoInZone(NOON_UTC, "America/St_Johns")).toBe("2026-10-25T09:30:05-02:30");
  });

  it("writes each named shape in the panel's zone", () => {
    const time = { timeZone: "Europe/Warsaw", dateLocale: "en-GB" };
    expect(formatTime(BEFORE_DST, { time }, "time")).toBe("01:30");
    expect(formatTime(AFTER_DST, { time }, "time")).toBe("03:30");
    expect(formatTime(NOON_UTC, { time }, "date")).toBe("25 Oct 2026");
    expect(formatTime(NOON_UTC, { time }, "datetime")).toBe("25 Oct 2026, 13:00");
    expect(formatTime(NOON_UTC, { time }, "datetime-seconds")).toBe("25 Oct 2026, 13:00:05");
    expect(formatTime(NOON_UTC, { time }, "iso")).toBe("2026-10-25T13:00:05+01:00");
  });

  it("takes Intl options for anything else, and the panel's shape when none is given", () => {
    expect(formatTime(NOON_UTC, { time: { timeZone: "UTC", dateLocale: "en-GB" } }, { weekday: "long", hour: "2-digit", minute: "2-digit" })).toBe("Sunday 12:00");
    expect(formatTime(NOON_UTC, { time: { timeZone: "UTC", dateLocale: "en-GB", dateFormat: "date" } })).toBe("25 Oct 2026");
    // No shape anywhere: date and time with seconds, as the page always wrote them.
    expect(formatTime(NOON_UTC, { time: { timeZone: "UTC", dateLocale: "en-GB" } })).toBe("25 Oct 2026, 12:00:05");
  });

  it("writes in the page's language unless a date locale is set", () => {
    expect(formatTime(NOON_UTC, { locale: "pl", time: { timeZone: "UTC" } }, "date")).toBe("25 paź 2026");
    expect(formatTime(NOON_UTC, { locale: "de", time: { timeZone: "UTC" } }, "date")).toBe("25.10.2026");
    expect(formatTime(NOON_UTC, { locale: "pl", time: { timeZone: "UTC", dateLocale: "en-GB" } }, "date")).toBe("25 Oct 2026");
  });

  it("writes relative times, and a date in the zone once a day has passed", () => {
    const time = { timeZone: "Australia/Eucla", dateLocale: "en-GB", dateFormat: "relative" as const };
    expect(formatTime(NOON_UTC - 5 * 60_000, { time, now: NOON_UTC })).toBe("5 min ago");
    // 23:00 UTC on the 24th is the 25th in Eucla.
    expect(formatAgo(Date.UTC(2026, 9, 23, 23, 0), NOON_UTC, "en", time)).toBe("24 Oct 2026");
  });

  it("never writes a scheduled moment as relative, which says nothing about the future", () => {
    const time = { timeZone: "UTC", dateLocale: "en-GB", dateFormat: "relative" as const };
    expect(formatMoment(NOON_UTC + 3_600_000, { time })).toBe("25 Oct 2026, 13:00:05");
    expect(formatMoment(NOON_UTC, { time: { timeZone: "UTC", dateLocale: "en-GB", dateFormat: "iso" } })).toBe("2026-10-25T12:00:05Z");
  });

  it("writes a time of day for charts in the zone", () => {
    expect(formatClock(AFTER_DST, { time: { timeZone: "Europe/Warsaw", dateLocale: "en-GB" } })).toBe("03:30:00");
    expect(formatClock(AFTER_DST, { time: { timeZone: "UTC", dateLocale: "en-GB" } }, false)).toBe("01:30");
  });

  it("formats a timestamp value with the value's own shape over the panel's", () => {
    const time = { timeZone: "UTC", dateLocale: "en-GB", dateFormat: "datetime" as const };
    expect(formatValue(NOON_UTC, { format: "timestamp", time })).toBe("25 Oct 2026, 12:00");
    expect(formatValue(NOON_UTC, { format: "timestamp", time, dateFormat: "iso" })).toBe("2026-10-25T12:00:05Z");
    expect(formatValue("2026-10-25T12:00:05Z", { format: "timestamp", time, dateFormat: "date" })).toBe("25 Oct 2026");
  });
});

describe("the viewer's time settings over the panel's", () => {
  const panel = { timeZone: "Europe/Warsaw", dateFormat: "datetime" as const, dateLocale: "en-GB" };

  it("follows the panel unless the viewer chose", () => {
    expect(timeFor(panel, { timeZone: undefined, dateFormat: undefined })).toEqual(panel);
  });

  it("lets a viewer choose their browser's zone, UTC, or another shape", () => {
    expect(timeFor(panel, { timeZone: "browser", dateFormat: undefined }).timeZone).toBeUndefined();
    expect(timeFor(panel, { timeZone: "UTC", dateFormat: "iso" })).toEqual({ timeZone: "UTC", dateFormat: "iso", dateLocale: "en-GB" });
    expect(timeFor(undefined, { timeZone: undefined, dateFormat: "relative" })).toEqual({ dateFormat: "relative" });
  });

  it("travels with the page's words, so every format call sees it", () => {
    const t = translator({ locale: "en" }, { timeZone: "UTC" });
    expect(t.time).toEqual({ timeZone: "UTC" });
  });

  it("are kept with the viewer's other choices, and only what they chose", () => {
    const store = new Map<string, string>();
    const local = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
    try {
      const prefs = loadPrefs("apb:t");
      expect([prefs.timeZone, prefs.dateFormat, prefs.freshness]).toEqual([undefined, undefined, false]);
      prefs.timeZone = "UTC";
      prefs.dateFormat = "iso";
      prefs.freshness = true;
      prefs.save();
      expect(JSON.parse(store.get("apb:t") ?? "{}")).toMatchObject({ timeZone: "UTC", dateFormat: "iso", freshness: true });
      const again = loadPrefs("apb:t");
      expect([again.timeZone, again.dateFormat, again.freshness]).toEqual(["UTC", "iso", true]);
      // A stored value the page does not offer is dropped, not trusted.
      store.set("apb:t", JSON.stringify({ timeZone: "Mars/Base", dateFormat: "<b>" }));
      const odd = loadPrefs("apb:t");
      expect([odd.timeZone, odd.dateFormat]).toEqual([undefined, undefined]);
      again.reset();
      expect([again.timeZone, again.dateFormat, again.freshness]).toEqual([undefined, undefined, false]);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, "localStorage");
      else Object.defineProperty(globalThis, "localStorage", previous);
    }
  });
});

describe("time settings are checked when the panel is made", () => {
  it("refuses a zone this runtime does not know, naming it", () => {
    expect(() => panelAt(0, { timeZone: "Mars/Olympus_Mons" })).toThrow(/Mars\/Olympus_Mons/);
    expect(() => panelAt(0, { timeZone: "" })).toThrow(AdminPanelConfigError);
  });

  it("refuses an unknown format name, unknown options, and options Intl rejects", () => {
    expect(() => panelAt(0, { dateFormat: "long" as never })).toThrow(/"long"/);
    expect(() => checkDateFormat("x", { timeZone: "UTC" })).toThrow(/timeZone/);
    expect(() => checkDateFormat("x", { month: "sometimes" } as never)).toThrow(/Intl refuses/);
    expect(() => checkDateFormat("x", {})).toThrow(/empty/);
  });

  it("refuses a date locale that is not a language tag", () => {
    expect(() => panelAt(0, { dateLocale: "not a tag" })).toThrow(AdminPanelConfigError);
  });

  it("sends what it accepted to the page, and nothing when nothing was set", () => {
    const { panel } = panelAt(0, { timeZone: "Europe/Warsaw", dateFormat: { month: "short", day: "numeric" }, dateLocale: "pl-PL" });
    expect(panel.schema().time).toEqual({ timeZone: "Europe/Warsaw", dateFormat: { month: "short", day: "numeric" }, dateLocale: "pl-PL" });
    expect(panelAt().panel.schema().time).toBeUndefined();
    expect(checkTimeSettings({})).toEqual({});
  });
});

describe("how a value or a column is shown is checked at declaration", () => {
  it("takes a dateFormat on a timestamp, and refuses it anywhere else", () => {
    const { panel } = panelAt();
    panel.viewable(Date.UTC(2026, 0, 1), { id: "last", format: "timestamp", dateFormat: "relative" });
    expect(panel.schema().groups[0]?.items.find((item) => item.id === "last")).toMatchObject({ format: "timestamp", dateFormat: "relative" });
    expect(() => panel.viewable(5, { id: "count", dateFormat: "date" })).toThrow(/not format: "timestamp"/);
  });

  it("refuses a format the page does not know, instead of showing it plain", () => {
    expect(() => panelAt().panel.viewable(5, { id: "n", format: "currency" as never })).toThrow(/"currency"/);
  });

  it("requires alt text on a picture, and a string to draw it from", () => {
    const { panel } = panelAt();
    expect(() => panel.viewable("https://example.com/a.png", { id: "logo", format: "image" })).toThrow(/alt/);
    expect(() => panel.viewable("https://example.com/a.png", { id: "logo", format: "image", image: { alt: "  " } })).toThrow(/alt/);
    expect(() => panel.viewable(5, { id: "five", format: "image", image: { alt: "five" } })).toThrow(/string/);
    expect(() => panel.viewable("x", { id: "tall", format: "image", image: { alt: "x", height: 10_000 } })).toThrow(/height/);
    panel.viewable("https://example.com/a.png", { id: "logo", format: "image", image: { alt: "Company logo", fit: "cover", height: 120 } });
    expect(panel.schema().groups[0]?.items.find((item) => item.id === "logo")).toMatchObject({ format: "image", image: { alt: "Company logo", fit: "cover", height: 120 } });
  });

  it("takes a QR level on a QR value only", () => {
    const { panel } = panelAt();
    panel.viewable("otpauth://totp/x", { id: "code", format: "qr", qr: { level: "H" } });
    expect(panel.schema().groups[0]?.items.find((item) => item.id === "code")).toMatchObject({ format: "qr", qr: { level: "H" } });
    expect(() => panel.viewable("x", { id: "plain", qr: { level: "H" } })).toThrow(/not format: "qr"/);
    expect(() => panel.viewable("x", { id: "odd", format: "qr", qr: { level: "X" as never } })).toThrow(/level/);
  });

  it("checks table columns the same way", () => {
    const { panel } = panelAt();
    expect(() => panel.table("Users", { id: "t1", columns: [{ key: "avatar", format: "image" }], rows: () => [] })).toThrow(/alt/);
    panel.table("Devices", { id: "t2", columns: [{ key: "seen", format: "timestamp", dateFormat: "iso" }, { key: "pairing", format: "qr" }, { key: "photo", format: "image", image: { alt: "Device photo" } }], rows: () => [] });
    const table = panel.schema().groups[0]?.items.find((item) => item.id === "t2");
    expect(table).toMatchObject({ columns: [{ key: "seen", dateFormat: "iso" }, { key: "pairing", format: "qr" }, { key: "photo", image: { alt: "Device photo" } }] });
  });
});

describe("which picture sources the page will load", () => {
  it("loads http(s), paths on this origin and image data URIs", () => {
    for (const source of ["https://example.com/a.png", "http://example.com/a.png", "/static/logo.svg", "data:image/png;base64,iVBORw0KGgo=", "data:image/svg+xml,%3Csvg%3E"]) expect(isAllowedImageSource(source), source).toBe(true);
  });

  it("refuses scripts, other schemes, other origins by another name, and other data", () => {
    for (const source of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "vbscript:x", "file:///etc/passwd", "//evil.example/x.png", "data:text/html,<b>", "", "logo.png"]) expect(isAllowedImageSource(source), source).toBe(false);
  });
});

describe("the origins a listener lets the page load pictures from", () => {
  it("adds them to the page's img-src, after its own origin and data: URIs", async () => {
    const { panel } = panelAt();
    const page = await call(routerFor(panel, { imageSources: ["https://cdn.example.com", "http://intranet.local:8080"] }), "GET", "/");
    expect(page.headers["content-security-policy"]).toContain("img-src 'self' data: https://cdn.example.com http://intranet.local:8080;");
    const plain = await call(routerFor(panel), "GET", "/");
    expect(plain.headers["content-security-policy"]).toContain("img-src 'self' data:;");
  });

  it("refuses anything that is not an http(s) origin, rather than widen the policy or be ignored", () => {
    const { panel } = panelAt();
    for (const source of ["https://cdn.example.com/images", "https://*.example.com", "javascript:alert(1)", "cdn.example.com", "https://cdn.example.com; script-src *", "data:"]) {
      expect(() => routerFor(panel, { imageSources: [source] }), source).toThrow(AdminPanelConfigError);
    }
  });
});
