/**
 * The panel in a real browser: the keyboard contract of the tabs, an edit accepted and an edit
 * refused through the page, a narrow screen, the custom element in a shadow root, and an axe pass
 * over every screen. None of it can be checked by calling a function — a stylesheet can ship
 * broken with every unit test green.
 *
 * `BROWSER_ENGINE=firefox npm run test:browser` runs another engine; CI runs all three.
 */
import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, chromium, firefox, type Page, webkit } from "playwright";
import { createAdminPanel, defineTheme, type AdminPanel } from "../../src/index.js";

const TOKEN = "browser-token-0123456789";
const engines = { chromium, firefox, webkit };
const engine = engines[(process.env.BROWSER_ENGINE ?? "chromium") as keyof typeof engines];

let browser: Browser;
let panel: AdminPanel;
let plain: AdminPanel;
let german: AdminPanel;
let load: { value: number };
let players: { value: number };
const requested: string[] = [];
let server: Server;
let base = "";
const errors: string[] = [];

/** `bypassCSP` only for the axe pass, which injects its own script: the page's CSP refuses it, as it should. */
async function open(path: string, width = 1200, bypassCSP = false): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, bypassCSP });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // A refusal the tests provoke on purpose is a 4xx the browser reports as a failed resource;
    // what this collects is script errors and anything else.
    if (message.type() === "error" && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(message.text())) errors.push(message.text());
  });
  await page.goto(`${base}${path}`);
  return page;
}

async function axe(page: Page): Promise<string[]> {
  const source = await import("axe-core");
  await page.addScriptTag({ content: (source as unknown as { source: string }).source });
  const result = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run(context?: unknown): Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> } }).axe;
    return run.run();
  });
  return result.violations.map((violation) => `${violation.id}: ${JSON.stringify(violation.nodes.map((node) => (node as { target: unknown; failureSummary?: string }).target))} ${(violation.nodes[0] as { failureSummary?: string }).failureSummary ?? ""}`);
}

beforeAll(async () => {
  panel = createAdminPanel({ title: "Browser test", theme: "material", themes: [defineTheme({ name: "brand", label: "Brand", light: { accent: "#6a1b9a" }, dark: { accent: "#ce93d8" } })] });
  players = panel.viewable(3, { label: "Players online", group: "Game", chart: true });
  panel.modifiable(100, { label: "Max players", group: "Game", min: 2, max: 500 });
  panel.viewable(42, { label: "Sessions", group: "Game", format: "integer" });
  panel.modifiable(true, { label: "Guests allowed", group: "Game" });
  panel.viewable({ blitz: 4, rapid: 2 }, { label: "Queue", group: "Game", chart: { over: "keys" } });
  panel.modifiable("hello", { label: "Greeting", group: "Text", maxLength: 20 });
  panel.action("Flush", () => "Flushed.", { group: "Text" });
  panel.action("Drop cache", () => "Dropped.", { group: "Later", confirm: "type" });
  panel.action("Refund", ({ input }) => `Refunded ${String(input.order)}.`, { group: "Later", approval: true, input: { order: { maxLength: 20 } } });
  const quiet = panel.modifiable(false, { label: "Quiet hours", group: "Later" });
  panel.profile("Night", [[quiet, true]], { group: "Later" });
  panel.modifiable(5, { label: "Guarded limit", group: "Text", approval: true, max: 100 });
  panel.modifiable(50, { label: "Send rate", group: "Text", min: 1, max: 500 });
  panel.modifiable(7, { label: "Reasoned limit", group: "Text", max: 10, reason: "required" });
  const said = "A choice whose name is a whole sentence about what it chooses";
  panel.modifiable(said, { label: "Sentence reading", group: "Text", options: [said, "Short"] });
  panel.viewable("", { label: "Empty reading", group: "Text" });
  panel.action("Ban player", ({ input }) => `Banned ${String(input.player)}.`, { group: "Text", input: { player: { maxLength: 20 } } });
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: `g${index}`, white: index % 2 === 0 ? "ada" : "sam", moves: index * 3 }));
  panel.table("Games", { group: "Blocks", columns: ["id", "white", { key: "moves", format: "integer", status: { warn: 60 } }], rows: () => rows, pageSize: 10, actions: [{ label: "End", run: (id) => `Ended ${id}.` }] });
  const feed = panel.feed("Disconnects", { group: "Blocks" });
  feed.push("first entry");
  feed.push({ player: "sam", game: "g2" }, "warn");
  const motd = panel.modifiable("", { label: "Message", group: "Blocks" });
  panel.profile("Quiet evening", [[motd, "Back soon"]], { group: "Blocks" });
  panel.viewable([3, 5, 5, 8, 13, 21, 21, 21, 34], { label: "Lengths", group: "Blocks", chart: { kind: "histogram" } });
  panel.viewable({ Mon: { "09": 3, "10": 5 }, Tue: { "09": 1, "10": 8 } }, { label: "Activity", group: "Blocks", chart: { kind: "heatmap" } });
  const mode = panel.modifiable("normal", { label: "Mode", group: "Later", options: ["normal", "maintenance"] });
  panel.modifiable(10, { label: "Batch size", group: "Later", min: 1, max: 100, disabledWhen: () => (mode.value === "maintenance" ? "maintenance is on" : false) });
  panel.modifiable("hello", { label: "Banner", group: "Later" });
  load = panel.viewable(10, { label: "Load", group: "Later", status: { warn: 50, bad: 90 } });
  plain = createAdminPanel({ title: "Plain" });
  plain.modifiable(1, { label: "Only a number", group: "Plain" });
  const plainHandler = plain.handler({ basePath: "/plain" });
  german = createAdminPanel({ title: "Deutsch", locale: "de" });
  german.modifiable(5, { label: "Grenze", group: "Spiel", max: 10 });
  german.viewable(
    () => {
      throw new Error("Datenbank antwortet nicht");
    },
    { label: "Kaputt", group: "Spiel" },
  );
  // An action the /de listener does not grant, so the page is told why its button is disabled.
  german.action("Neu starten", () => "fertig", { group: "Spiel" });
  const germanHandler = german.handler({ basePath: "/de", auth: { check: () => "tester" }, controls: { edit: true } });
  const handler = panel.handler({ basePath: "/admin", auth: { check: (request) => (request.headers["x-user"] === "second" ? "reviewer" : "tester") }, controls: { edit: true, actions: true } });
  const element = (await build({ entryPoints: ["src/element/index.ts"], bundle: true, format: "esm", write: false, platform: "browser" })).outputFiles[0]?.text ?? "";
  server = createServer((request, response) => {
    const url = request.url ?? "/";
    requested.push(url);
    if (url.startsWith("/admin")) return handler(request, response);
    if (url.startsWith("/plain/") || url === "/plain") return plainHandler(request, response);
    if (url.startsWith("/de")) return germanHandler(request, response);
    if (url === "/element.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      return response.end(element);
    }
    if (url === "/boot.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      return response.end('import { defineAdminPanelElement } from "/element.js"; defineAdminPanelElement();');
    }
    const body =
      url === "/element"
        ? '<main><h1>Host</h1><admin-panel src="/admin"></admin-panel></main><script type="module" src="/boot.js"></script>'
        : url === "/element-compact"
          ? '<main><h1>Host</h1><admin-panel src="/admin" group="Later" compact></admin-panel></main><script type="module" src="/boot.js"></script>'
          : url === "/plain-host"
            ? `<main><h1>Host</h1>${plain.html({ api: "/plain" })}</main>`
            : url === "/two"
              ? `<main><h1>Host</h1>${panel.html({ api: "/admin", script: false, group: "Game", compact: true })}${plain.html({ api: "/plain", script: false })}<script src="/plain/client.js" defer></script></main>`
              : `<main><h1>Host</h1>${panel.html({ api: "/admin" })}</main>`;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'" });
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Host</title></head><body>${body}</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  browser = await engine.launch();
  const timer = setInterval(() => {
    players.value += 1;
  }, 200);
  timer.unref();
  void TOKEN;
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  panel?.close();
  plain?.close();
  german?.close();
});

describe("the standalone page", () => {
  it("draws every group as a tab, and the arrow keys move between them", async () => {
    const page = await open("/admin/");
    const tabs = page.getByRole("tab");
    await expect.poll(() => tabs.count()).toBe(5);
    await page.getByRole("tab", { name: /^Game/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.getByRole("tab", { name: /^Text/ }).getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("End");
    await expect.poll(() => page.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("Home");
    expect(await page.getByRole("tab", { name: /^Game/ }).getAttribute("aria-selected")).toBe("true");
    await page.close();
  });

  it("applies an accepted edit and shows a refused one in place, in the server's words", async () => {
    const page = await open("/admin/");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Max players" }) });
    await card.getByRole("spinbutton").fill("250");
    await card.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => panel.get("max-players")?.value).toBe(250);
    await card.getByRole("spinbutton").fill("9999");
    await card.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => card.getByRole("alert").textContent()).toMatch(/largest accepted value is 500/);
    await page.getByRole("switch", { name: "Guests allowed" }).click();
    await expect.poll(() => panel.get("guests-allowed")?.value).toBe(false);
    await page.close();
  });

  it("records who changed what under Activity", async () => {
    const page = await open("/admin/");
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect.poll(() => page.getByRole("tabpanel").textContent()).toMatch(/tester/);
    await page.close();
  });

  it("fits a phone without scrolling sideways", async () => {
    const page = await open("/admin/", 360);
    await page.waitForSelector(".apb-card");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.close();
  });

  it("passes axe on every screen", async () => {
    const page = await open("/admin/", 1200, true);
    await page.waitForSelector(".apb-card");
    const found: string[] = [];
    for (const name of [/^Game/, /^Text/, /^Blocks/, /^Later/, "Activity"]) {
      await page.getByRole("tab", { name }).click();
      found.push(...(await axe(page)));
    }
    expect(found).toEqual([]);
    await page.close();
  });
});

describe("the building blocks", () => {
  it("pages, sorts and searches a table, and runs a row action", async () => {
    const page = await open("/admin/#blocks");
    const table = page.locator(".apb-block-table");
    await expect.poll(() => table.locator("tbody tr").count()).toBe(10);
    await table.getByRole("button", { name: "Next" }).click();
    await expect.poll(() => table.locator("tbody tr").first().textContent()).toContain("g10");
    await table.getByRole("button", { name: "moves" }).click();
    await table.getByRole("button", { name: "moves" }).click();
    await expect.poll(() => table.locator("tbody tr").first().textContent()).toContain("g29");
    await table.getByRole("searchbox").fill("sam");
    await expect.poll(() => page.locator(".apb-block-table .apb-pager").textContent()).toContain("of 15");
    await table.getByRole("button", { name: /End: / }).first().click();
    await expect.poll(() => table.locator(".apb-result").textContent()).toMatch(/Ended g\d+\./);
    await page.close();
  });

  it("lists feed entries newest first, and applies a profile", async () => {
    const page = await open("/admin/#blocks");
    const feed = page.getByRole("list", { name: "Disconnects" });
    await expect.poll(() => feed.locator("li").first().textContent()).toContain("player=sam");
    const profile = page.locator("article", { has: page.getByRole("heading", { name: "Quiet evening" }) });
    await profile.getByRole("button", { name: "Apply" }).click();
    await profile.getByRole("button", { name: /click again/ }).click();
    await expect.poll(() => panel.get("message")?.value).toBe("Back soon");
    await page.close();
  });

  it("draws a histogram and a heatmap as HTML a screen reader can read", async () => {
    const page = await open("/admin/#blocks");
    await expect.poll(() => page.locator(".apb-heatmap .apb-heat-cell").count()).toBe(4);
    await expect.poll(() => page.locator(".apb-key-row").count()).toBeGreaterThan(2);
    await page.close();
  });

  it("runs an action with input, and refuses what the field refuses", async () => {
    const page = await open("/admin/#text");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Ban player" }) });
    await card.getByRole("button", { name: "Ban player", exact: true }).click();
    await expect.poll(() => card.locator(".apb-result").textContent()).toBe("Player is required.");
    await card.getByLabel("player", { exact: true }).fill("sam");
    await card.getByRole("button", { name: "Ban player", exact: true }).click();
    await expect.poll(() => card.locator(".apb-result").textContent()).toBe("Banned sam.");
    await page.close();
  });

  it("turns an edit that needs approval into a proposal a second operator approves", async () => {
    const page = await open("/admin/#text");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Guarded limit" }) });
    await card.getByRole("spinbutton").fill("42");
    await card.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => card.getByRole("alert").textContent()).toMatch(/needs a reason/);
    await card.getByRole("textbox", { name: "Guarded limit: Reason" }).fill("more players tonight");
    await card.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => card.textContent()).toContain("Proposed");
    expect(panel.get("guarded-limit")?.value).toBe(5);
    const reviewer = await browser.newContext({ extraHTTPHeaders: { "x-user": "second" } });
    const other = await reviewer.newPage();
    await other.goto(`${base}/admin/#text`);
    await other.locator("article", { has: other.getByRole("heading", { name: "Guarded limit" }) }).getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => panel.get("guarded-limit")?.value).toBe(42);
    await reviewer.close();
    await page.close();
  });

  it("applies a change for a while and says when it reverts", async () => {
    const page = await open("/admin/#text");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Send rate" }) });
    await card.getByRole("spinbutton").fill("120");
    await card.locator("select.apb-duration").selectOption({ label: "For 15 min" });
    await card.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => card.textContent()).toMatch(/Reverts to 50 at/);
    await page.close();
  });
});

describe("finding things", () => {
  it("searches across groups into a results tab", async () => {
    const page = await open("/admin/");
    await page.getByRole("searchbox", { name: "Search the panel" }).fill("greet");
    await expect.poll(() => page.getByRole("tab", { name: "Search results" }).getAttribute("aria-selected")).toBe("true");
    await expect.poll(() => page.getByRole("tabpanel").getByRole("heading", { name: "Greeting" }).count()).toBe(1);
    await page.close();
  });

  it("pins a card to a Pinned tab that is still there after a reload", async () => {
    const page = await open("/admin/");
    await page.getByRole("button", { name: "Pin: Players online" }).first().click();
    await expect.poll(() => page.getByRole("tab", { name: "Pinned" }).isVisible()).toBe(true);
    await page.reload();
    await expect.poll(() => page.getByRole("tab", { name: "Pinned" }).isVisible()).toBe(true);
    await page.close();
  });

  it("streams updates when the listener offers a stream", async () => {
    const page = await open("/admin/");
    await expect.poll(() => page.locator(".apb-status").textContent(), { timeout: 10_000 }).toBe("Live (streaming)");
    await page.close();
  });
});

describe("operator workflows on the page", () => {
  it("schedules a change for later, shows it with who and when, and cancels it", async () => {
    const page = await open("/admin/#later");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Banner" }) });
    await card.getByRole("textbox", { name: "Banner" }).fill("Maintenance tonight");
    await card.getByText("Later", { exact: true }).click();
    const when = new Date(Date.now() + 3_600_000);
    const local = new Date(when.getTime() - when.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await card.locator("input.apb-at").fill(local);
    await card.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => card.locator(".apb-scheduled").textContent()).toMatch(/Changes to Maintenance tonight at .*Scheduled by tester\./);
    expect(panel.get("banner")?.value).toBe("hello");
    await card.getByRole("button", { name: /^Cancel: Banner/ }).click();
    await expect.poll(() => card.locator(".apb-scheduled li").count()).toBe(0);
    await page.close();
  });

  it("keeps a timeline of a text value's recent changes", async () => {
    const page = await open("/admin/#later");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Banner" }) });
    await card.getByRole("textbox", { name: "Banner" }).fill("Welcome back");
    await card.getByRole("button", { name: "Apply" }).click();
    await card.getByText("Lately").click();
    await expect.poll(() => card.locator(".apb-timeline-list").textContent()).toMatch(/Welcome back · .* · tester/);
    await page.close();
  });

  it("disables a setting while its condition holds, and says why", async () => {
    const page = await open("/admin/#later");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Batch size" }) });
    panel.get("mode")?.set("maintenance");
    await expect.poll(() => card.locator(".apb-disabled-reason").textContent()).toBe("Cannot be changed right now: maintenance is on");
    expect(await card.getByRole("button", { name: "Apply" }).isDisabled()).toBe(true);
    panel.get("mode")?.set("normal");
    await expect.poll(() => card.getByRole("button", { name: "Apply" }).isDisabled()).toBe(false);
    await page.close();
  });

  it("says when a value on the visible tab turns bad", async () => {
    const page = await open("/admin/#later");
    // The first card in the document is on a hidden tab; wait for this tab's.
    await page.getByRole("heading", { name: "Load" }).waitFor();
    await page.waitForTimeout(600);
    load.value = 95;
    await expect.poll(() => page.locator(".apb-announcer").textContent(), { timeout: 8000 }).toBe("Load is now Bad.");
    load.value = 10;
    await page.close();
  });

  it("filters a feed by level and text, and holds it still", async () => {
    const page = await open("/admin/#blocks");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Disconnects" }) });
    const list = page.getByRole("list", { name: "Disconnects" });
    await expect.poll(() => list.locator("li").count()).toBe(2);
    await card.getByRole("combobox", { name: /Levels/ }).selectOption("warn");
    await expect.poll(() => list.locator("li").count()).toBe(1);
    await card.getByRole("combobox", { name: /Levels/ }).selectOption("");
    await card.getByRole("searchbox", { name: "Filter Disconnects" }).fill("first");
    await expect.poll(() => list.textContent()).toContain("first entry");
    await card.getByRole("searchbox", { name: "Filter Disconnects" }).fill("");
    await card.getByRole("button", { name: "Pause" }).click();
    await page.waitForTimeout(300);
    await expect.poll(() => card.locator(".apb-hint[aria-live]").first().textContent()).toMatch(/Paused\. 0 new entries are waiting\./);
    await page.close();
  });

  it("exports settings and shows what an import would change before applying it", async () => {
    const page = await open("/admin/");
    await page.getByRole("tab", { name: "Activity" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download settings" }).click();
    expect((await download).suggestedFilename()).toBe("Browser-test-settings.json");
    const file = page.locator(".apb-file input[type=file]");
    await file.setInputFiles({ name: "settings.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ settings: { "send-rate": 77 } })) });
    await expect.poll(() => page.locator(".apb-import-diff").textContent()).toMatch(/Send rate: \d+ → 77/);
    expect(panel.get("send-rate")?.value).not.toBe(77);
    await page.getByRole("button", { name: "Apply 1 changes" }).click();
    await page.getByRole("button", { name: /click again/ }).click();
    await expect.poll(() => panel.get("send-rate")?.value).toBe(77);
    await page.close();
  });
});

describe("changes with reasons", () => {
  it("repeats a change every day at a time, says so in the viewer's words, and cancels it", async () => {
    const page = await open("/admin/#later");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Banner" }) });
    await card.getByRole("textbox", { name: "Banner", exact: true }).fill("Nightly restart");
    await card.getByText("Later", { exact: true }).click();
    await card.locator("input.apb-at").fill("2026-12-01T02:00");
    await card.getByRole("combobox", { name: "Repeat" }).selectOption("day");
    await card.getByText("Why (optional)").click();
    await card.getByRole("textbox", { name: "Banner: Why (optional)" }).fill("restart window");
    await card.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => card.locator(".apb-scheduled").textContent()).toMatch(/Changes to Nightly restart every day at 02:00 \(.+\); next .* Why: restart window/);
    await card.getByRole("button", { name: /^Cancel: Banner/ }).click();
    await expect.poll(() => card.locator(".apb-scheduled li").count()).toBe(0);
    await page.close();
  });

  it("runs a cannot-be-undone action only once its name is typed", async () => {
    const page = await open("/admin/#later");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Drop cache" }) });
    const button = card.getByRole("button", { name: "Drop cache", exact: true });
    expect(await button.isDisabled()).toBe(true);
    await card.getByRole("textbox", { name: "Type “Drop cache” to confirm" }).fill("Drop cach");
    expect(await button.isDisabled()).toBe(true);
    await card.getByRole("textbox", { name: "Type “Drop cache” to confirm" }).fill("Drop cache");
    await button.click();
    await expect.poll(() => card.locator(".apb-result").textContent()).toBe("Dropped.");
    await page.close();
  });

  it("proposes an action that needs approval, and a second operator runs it with the input it was given", async () => {
    const page = await open("/admin/#later");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Refund" }) });
    await card.getByLabel("order", { exact: true }).fill("A-17");
    await card.getByRole("textbox", { name: "Refund: Reason" }).fill("double charge");
    await card.getByRole("button", { name: "Refund", exact: true }).click();
    // Proposals reach pages on the next frame or poll: give a busy browser a few seconds, not one.
    await expect.poll(() => card.locator("p.apb-result").textContent(), { timeout: 5000 }).toMatch(/Proposed/);
    await expect.poll(() => card.locator(".apb-pending").textContent(), { timeout: 5000 }).toMatch(/tester proposed running Refund\. Why: double charge/);
    const reviewer = await browser.newContext({ extraHTTPHeaders: { "x-user": "second" } });
    const other = await reviewer.newPage();
    await other.goto(`${base}/admin/#later`);
    await other.locator("article", { has: other.getByRole("heading", { name: "Refund" }) }).getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => panel.changes().find((change) => change.label === "Refund" && change.kind === "action")?.outcome, { timeout: 5000 }).toBe("Refunded A-17.");
    await reviewer.close();
    await page.close();
  });

  it("applies a profile for a while, and shows its reason under Activity", async () => {
    const page = await open("/admin/#later");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Night" }) });
    await card.locator("select.apb-duration").selectOption({ label: "For 1 h" });
    await card.getByText("Why (optional)").click();
    await card.getByRole("textbox", { name: "Night: Why (optional)" }).fill("quiet test");
    await card.getByRole("button", { name: "Apply" }).click();
    await card.getByRole("button", { name: /click again/ }).click();
    await expect.poll(() => panel.get("quiet-hours")?.value).toBe(true);
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect.poll(() => page.getByRole("tabpanel").textContent()).toMatch(/Night — Why: quiet test/);
    await page.close();
  });
});

describe("keyboard and viewer preferences", () => {
  it("focuses search on /, opens the go-to list on Ctrl+K and goes where it is told", async () => {
    const page = await open("/admin/");
    await page.waitForSelector(".apb-card");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label"))).toBe("Search the panel");
    await page.keyboard.press("Escape");
    await page.locator("h1").first().click();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Go to" });
    await expect.poll(() => dialog.isVisible()).toBe(true);
    await page.keyboard.type("batch");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("tab", { name: /^Later/ }).getAttribute("aria-selected")).toBe("true");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-card"))).toBe("value:batch-size");
    await page.keyboard.press("?");
    await expect.poll(() => page.getByRole("dialog", { name: "Keyboard shortcuts" }).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await page.locator("h1").first().click();
    await page.keyboard.press("g");
    await page.keyboard.press("2");
    await expect.poll(() => page.getByRole("tab", { name: /^Text/ }).getAttribute("aria-selected")).toBe("true");
    await page.close();
  });

  it("steps through a chart's samples with the arrow keys and reads each out", async () => {
    const page = await open("/admin/");
    const plot = page.getByRole("group", { name: /Players online\. Arrow keys step/ });
    await plot.focus();
    await page.keyboard.press("End");
    await expect.poll(() => page.locator(".apb-chart-readout").first().textContent()).toMatch(/^Players online: \d+, /);
    await page.keyboard.press("Home");
    await expect.poll(() => page.locator(".apb-cursor").count()).toBeGreaterThan(0);
    await page.close();
  });

  it("lets a viewer choose light or dark for themselves, and remembers it", async () => {
    const page = await open("/admin/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("combobox", { name: "Colours" }).selectOption("dark");
    expect(await page.locator(".apb-root").getAttribute("data-scheme")).toBe("dark");
    await page.reload();
    await expect.poll(() => page.locator(".apb-root").getAttribute("data-scheme")).toBe("dark");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("combobox", { name: "Colours" }).selectOption("");
    await page.close();
  });

  it("leaves no English word on a German page outside the application's own labels and values", async () => {
    const page = await open("/de/");
    await page.getByRole("heading", { name: "Grenze" }).waitFor();
    // The settings dialog open, so its words are read too.
    await page.getByRole("button", { name: "Einstellungen" }).click();
    await page.waitForTimeout(1200);
    const text = await page.evaluate(() => {
      const root = document.querySelector(".apb-root") as HTMLElement;
      const words: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node.parentElement?.closest("option, script") === null) words.push(node.textContent ?? "");
      for (const element of Array.from(root.querySelectorAll("[aria-label], [placeholder]"))) words.push(element.getAttribute("aria-label") ?? "", element.getAttribute("placeholder") ?? "");
      return words.join(" ");
    });
    // The panel's own words about its own machinery are in the list too: a notice, the frame around a
    // reading that failed, and what the listener does not allow.
    const english = ["Apply", "Search", "Activity", "Changed", "ago", "Pinned", "Collapse", "until changed", "Later", "modifiable", "Unchanged", "Colours", "Language", "Warning", "Pin", "Settings", "Theme", "Motion", "Animations", "Layout", "Compact", "reading", "threw", "Editing", "switched off", "too large"];
    expect(english.filter((word) => new RegExp(`\\b${word}\\b`).test(text))).toEqual([]);
    await page.close();
  });

  it("lets a viewer read the page in another language, and remembers it", async () => {
    const page = await open("/de/");
    await page.getByRole("button", { name: "Einstellungen" }).click();
    await page.getByRole("combobox", { name: "Sprache" }).selectOption("pl");
    await expect.poll(() => page.getByRole("tab", { name: "Aktywność" }).count()).toBe(1);
    await page.reload();
    await expect.poll(() => page.getByRole("tab", { name: "Aktywność" }).count()).toBe(1);
    await page.getByRole("button", { name: "Ustawienia" }).click();
    await page.getByRole("combobox", { name: "Język" }).selectOption("de");
    await expect.poll(() => page.getByRole("tab", { name: "Aktivität" }).count()).toBe(1);
    await page.close();
  });

  it("says its own words in German too: what it could not read, and the notice about it", async () => {
    const page = await open("/de/");
    const broken = page.locator('[data-card="value:kaputt"] .apb-value');
    // The frame is the panel's and is said in German; the application's own message is left as it is.
    await expect.poll(() => broken.textContent(), { timeout: 8000 }).toBe("Kaputt konnte nicht gelesen werden: Datenbank antwortet nicht");
    await page.getByRole("tab", { name: "Aktivität" }).click();
    await expect.poll(() => page.locator(".apb-notice").first().textContent()).toMatch(/Das Lesen von Kaputt hat einen Fehler geworfen/);
    // And what the listener does not allow, which the page is told in parts as well.
    expect(await page.locator(".apb-note").first().textContent()).toMatch(/Aktionen sind auf diesem Listener abgeschaltet/);
    // And in the viewer's own language when they choose another.
    await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await page.getByRole("combobox", { name: "Sprache" }).selectOption("pl");
    await expect.poll(() => page.locator('[data-card="value:kaputt"] .apb-value').textContent(), { timeout: 8000 }).toBe("nie udało się odczytać Kaputt: Datenbank antwortet nicht");
    await page.close();
  });

  it("speaks German when the panel does, refusals included", async () => {
    const page = await open("/de/");
    await expect.poll(() => page.getByRole("tab", { name: "Aktivität" }).count()).toBe(1);
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Grenze" }) });
    await card.getByRole("spinbutton").fill("50");
    await card.evaluate((node) => {
      // Past the page's own check, to see the server's refusal said in German.
      (node.querySelector("input[type=number]") as HTMLInputElement).removeAttribute("max");
    });
    await page.evaluate(async () => {
      const response = await fetch("/de/api/values/grenze", { method: "POST", headers: { "content-type": "application/json" }, body: '{"value":50}' });
      (window as unknown as { refusal: unknown }).refusal = await response.json();
    });
    expect(await page.evaluate(() => (window as unknown as { refusal: unknown }).refusal)).toMatchObject({ code: "invalid", key: "refuseAtMost", params: { label: "Grenze", max: 10 } });
    await page.close();
  });
});

describe("the page at a glance", () => {
  it("shows the numbers under the pointer in a tip beside the cursor", async () => {
    const page = await open("/admin/");
    // A chart of one sample has nothing under the pointer to report: give it a few, and wait for
    // the page to have drawn them.
    for (const value of [5, 9, 14, 11]) players.value = value;
    const plot = page.getByRole("group", { name: /Players online\. Arrow keys step/ }).locator(".apb-plot");
    await plot.waitFor({ state: "visible" });
    await expect.poll(() => plot.locator("svg .apb-line").count()).toBeGreaterThan(0);
    // The card takes its size from what it holds, and the chart is drawn again on every update,
    // which replaces the plot: wait for a box that is the same twice running before pointing at it.
    let box = await plot.boundingBox();
    let same = 0;
    for (let tries = 0; same < 2 && tries < 40; tries += 1) {
      await page.waitForTimeout(150);
      const again = await plot.boundingBox();
      same = again !== null && box !== null && again.x === box.x && again.y === box.y && again.height === box.height ? same + 1 : 0;
      box = again;
    }
    if (box === null) throw new Error("no plot");
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
    // A second move once the page has settled: a tip follows the pointer, and the pointer only
    // reports where it is when it moves.
    await page.waitForTimeout(200);
    await page.mouse.move(box.x + box.width * 0.9 - 2, box.y + box.height / 2);
    await expect.poll(() => page.locator(".apb-tip").first().textContent()).toMatch(/Players online\s*\d/);
    await page.mouse.move(box.x + box.width / 2, box.y - 60);
    await expect.poll(() => page.locator(".apb-tip").count()).toBe(0);
    await page.close();
  });

  it("marks an edit not applied yet, and Escape puts the panel's value back", async () => {
    const page = await open("/admin/");
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Max players" }) });
    const before = await card.getByRole("spinbutton").inputValue();
    await card.getByRole("spinbutton").fill("123");
    await expect.poll(() => card.locator(".apb-editor[data-dirty]").count()).toBe(1);
    await card.getByRole("spinbutton").press("Escape");
    await expect.poll(() => card.locator(".apb-editor[data-dirty]").count()).toBe(0);
    expect(await card.getByRole("spinbutton").inputValue()).toBe(before);
    await page.close();
  });

  it("keeps a viewer's settings in their browser: compact cards, a theme of the panel's, no flashing", async () => {
    const page = await open("/admin/");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await page.getByRole("button", { name: "Settings" }).click();
    await settings.getByRole("switch", { name: "Compact cards" }).click();
    await settings.getByRole("switch", { name: "Flash values when they change" }).click();
    // A theme registered in code is offered beside the built-in ones, and applies without a reload.
    await settings.getByRole("combobox", { name: "Theme" }).selectOption("brand");
    const root = page.locator(".apb-root");
    expect(await root.getAttribute("data-density")).toBe("compact");
    expect(await root.getAttribute("data-flash")).toBe("off");
    expect(await root.getAttribute("data-theme")).toBe("brand");
    expect(await root.evaluate((node) => getComputedStyle(node).getPropertyValue("--apb-accent").trim())).toBe("#6a1b9a");
    await page.reload();
    await expect.poll(() => root.getAttribute("data-theme")).toBe("brand");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect.poll(() => settings.getByRole("switch", { name: "Compact cards" }).getAttribute("aria-checked")).toBe("true");
    await settings.getByRole("button", { name: "Reset my settings" }).click();
    expect(await root.getAttribute("data-density")).toBeNull();
    expect(await root.getAttribute("data-theme")).toBeNull();
    expect(await root.getAttribute("data-flash")).toBeNull();
    await page.close();
  });

  it("arranges a group's cards, keeps them for one viewer, and saves them for everybody", async () => {
    const page = await open("/admin/");
    // The button arranges the tab that is open, and is offered only where there is a group to arrange.
    const arrange = page.getByRole("button", { name: "Arrange the cards on this tab" });
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect.poll(() => arrange.isDisabled()).toBe(true);
    await page.getByRole("tab", { name: /^Game/ }).click();
    await expect.poll(() => arrange.isDisabled()).toBe(false);
    const players = page.locator("article", { has: page.getByRole("heading", { name: "Players online" }) });
    const before = await players.getAttribute("data-size");
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    await page.getByRole("button", { name: "Make Players online wider" }).click();
    await page.getByRole("button", { name: "Make Players online taller" }).click();
    await expect.poll(() => page.getByRole("region", { name: /^Arranging/ }).textContent()).toMatch(/Players online: \d+ by \d+, place 1 of \d+/);
    const grown = await players.getAttribute("data-size");
    expect(grown).not.toBe(before);
    // Cancel puts back what was there.
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await players.getAttribute("data-size")).toBe(before);
    // Kept for this viewer: after a reload, and not for anybody else.
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    await page.getByRole("button", { name: "Move Players online later" }).click();
    await page.getByRole("button", { name: "Make Players online wider" }).click();
    await page.getByRole("button", { name: "Save for me" }).click();
    await page.reload();
    await expect.poll(() => players.getAttribute("data-size")).not.toBe(before);
    const other = await open("/admin/");
    const theirs = other.locator("article", { has: other.getByRole("heading", { name: "Players online" }) });
    await expect.poll(() => theirs.getAttribute("data-size")).toBe(before);
    // Saved for everybody: the other viewer gets it, and it is in the change log.
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    await page.getByRole("button", { name: "Save for everybody" }).click();
    await expect.poll(() => panel.layout()?.game?.sizes?.["value:players-online"]).toBeDefined();
    await other.reload();
    await expect.poll(() => theirs.getAttribute("data-size")).not.toBe(before);
    expect(panel.changes().at(-1)?.kind).toBe("layout");
    // Back to the layout in code, for the tests after this one.
    panel.saveLayout(null, "test");
    await other.close();
    await page.close();
  });

  it("leaves arranging on Escape, and when another tab is opened", async () => {
    const page = await open("/admin/", 1300);
    const arranging = () => page.locator("[data-arranging]").count();
    const players = page.locator("article", { has: page.getByRole("heading", { name: "Players online" }) });
    const before = await players.getAttribute("data-size");
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    await page.getByRole("button", { name: "Make Players online taller" }).click();
    await expect.poll(() => players.getAttribute("data-size")).not.toBe(before);
    // Escape does what Cancel does: out of arranging, with what was there put back.
    await page.keyboard.press("Escape");
    await expect.poll(arranging).toBe(0);
    expect(await players.getAttribute("data-size")).toBe(before);
    // So does opening another tab: nobody can finish arranging a tab they cannot see.
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    await page.getByRole("button", { name: "Make Players online taller" }).click();
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect.poll(arranging).toBe(0);
    expect(await page.getByRole("region", { name: /^Arranging/ }).count()).toBe(0);
    await page.getByRole("tab", { name: /^Game/ }).click();
    await expect.poll(() => players.getAttribute("data-size")).toBe(before);
    await page.close();
  });

  it("gives back the room of a card folded away, and hands it back when the card is opened", async () => {
    const page = await open("/admin/", 1300);
    const players = page.locator("article", { has: page.getByRole("heading", { name: "Players online" }) });
    const height = async () => Math.round(((await players.boundingBox()) as { height: number }).height);
    const tall = await height();
    await page.getByRole("button", { name: "Collapse: Players online" }).click();
    // Its heading and nothing else, and the name is still there to say what was folded away.
    await expect.poll(height).toBeLessThan(tall / 2);
    expect(await players.getByRole("heading", { name: "Players online" }).isVisible()).toBe(true);
    await page.getByRole("button", { name: "Collapse: Players online" }).click();
    await expect.poll(height, { timeout: 4000 }).toBe(tall);
    await page.close();
  });

  it("sets a reading that is words as words, says when there is none, and asks for a reason before the button", async () => {
    const page = await open("/admin/", 1300);
    await page.getByRole("tab", { name: "Text" }).click();
    const card = (name: string) => page.locator("article", { has: page.getByRole("heading", { name }) });
    const size = async (name: string) => card(name).locator(".apb-value").evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
    // A sentence is not a figure: it is set smaller than a reading that is one.
    await expect.poll(() => card("Sentence reading").locator(".apb-value").getAttribute("data-long")).toBe("sentence");
    expect(await size("Sentence reading")).toBeLessThan(await size("Send rate"));
    // Nothing set says so, rather than leaving a line of no height.
    await expect.poll(() => card("Empty reading").locator(".apb-value").textContent()).toBe("—");
    // A reason that must be given comes before the button, and what the panel answers right under it.
    const parts = await card("Reasoned limit").locator(".apb-editor > *").evaluateAll((nodes) => nodes.map((node) => node.className));
    const reason = parts.findIndex((name) => name.includes("apb-reason-field"));
    const button = parts.findIndex((name) => name.includes("apb-button"));
    const answer = parts.findIndex((name) => name.includes("apb-error"));
    expect(reason).toBeGreaterThanOrEqual(0);
    expect(reason).toBeLessThan(button);
    expect(answer).toBeGreaterThan(button);
    await page.close();
  });

  it("packs cards without overlapping, and tells each how much it may show", async () => {
    const page = await open("/admin/#blocks", 1300);
    await page.locator(".apb-block-table").waitFor();
    const boxes = await page.locator(".apb-pane:not([hidden]) .apb-grid > .apb-card").evaluateAll((cards) =>
      cards.map((card) => {
        const box = card.getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, detail: (card as HTMLElement).dataset.detail };
      }),
    );
    expect(boxes.length).toBeGreaterThan(3);
    for (const [index, a] of boxes.entries()) {
      expect(["brief", "normal", "full"]).toContain(a.detail);
      for (const b of boxes.slice(index + 1)) expect(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1).toBe(true);
    }
    await page.close();
  });

  it("drags a card by the mouse to another place while arranging, and shows less when it is made small", async () => {
    const page = await open("/admin/", 1300);
    const players = page.locator("article", { has: page.getByRole("heading", { name: "Players online" }) });
    const queue = page.locator("article", { has: page.getByRole("heading", { name: "Queue" }) });
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    const order = () => page.locator(".apb-pane:not([hidden]) .apb-grid > .apb-card").evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.card));
    const first = await order();
    const from = (await players.boundingBox()) as { x: number; y: number; width: number; height: number };
    const to = (await queue.boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.move(from.x + from.width / 2, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + 30, { steps: 3 });
    await expect.poll(() => page.locator(".apb-drop-slot").count()).toBe(1);
    await page.mouse.move(to.x + to.width - 10, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => page.locator(".apb-drop-slot").count()).toBe(0);
    const moved = await order();
    expect(moved).not.toEqual(first);
    expect(moved.indexOf("value:players-online")).toBeGreaterThan(moved.indexOf("value:queue"));
    // Made as narrow and short as it goes, a card shows its name and reading only.
    for (let i = 0; i < 12; i += 1) await page.getByRole("button", { name: "Make Guests allowed narrower" }).click();
    for (let i = 0; i < 6; i += 1) await page.getByRole("button", { name: "Make Guests allowed shorter" }).click();
    const guests = page.locator("article", { has: page.getByRole("heading", { name: "Guests allowed" }) });
    await expect.poll(() => guests.getAttribute("data-detail")).toBe("brief");
    // The page holds still while arranging: a new reading waits until arranging ends.
    const reading = players.locator(".apb-value");
    const shown = await reading.textContent();
    (panel.get("players-online") as { value: number }).value = 777;
    await page.waitForTimeout(1500);
    expect(await reading.textContent()).toBe(shown);
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await order()).toEqual(first);
    await expect.poll(() => reading.textContent()).not.toBe(shown);
    await page.close();
  });

  it("shows less when a card is smaller than what it holds, and more when it has room to spare", async () => {
    const page = await open("/admin/", 1300);
    const card = (name: string) => page.locator("article", { has: page.getByRole("heading", { name }) });
    const guests = card("Guests allowed");
    const sessions = card("Sessions");
    const rows = async (node: ReturnType<typeof card>) => (await node.evaluate((element) => element.getBoundingClientRect().height)) as number;
    const before = await sessions.locator(".apb-value").evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    // As small as it goes: it shows its name and reading only, scrolls what is left, and stays that size.
    for (let i = 0; i < 10; i += 1) await page.getByRole("button", { name: "Make Guests allowed narrower" }).click();
    for (let i = 0; i < 6; i += 1) await page.getByRole("button", { name: "Make Guests allowed shorter" }).click();
    // Far more room than the reading needs: the reading is centred and the number grows.
    for (let i = 0; i < 5; i += 1) await page.getByRole("button", { name: "Make Sessions taller" }).click();
    await page.getByRole("button", { name: "Save for me" }).click();
    await expect.poll(() => guests.getAttribute("data-detail")).toBe("brief");
    await expect.poll(() => guests.getAttribute("data-tight")).not.toBeNull();
    expect(await rows(guests)).toBeLessThan(120);
    await expect.poll(() => sessions.getAttribute("data-room")).toBe("top");
    expect(await sessions.locator(".apb-value").evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThan(before);
    // Nothing else was stretched by either of them: a row is its own height.
    expect(await rows(card("Max players"))).toBeLessThan(400);
    // Arranging over, a card is no longer a thing to drag: what it holds answers again.
    await card("Max players").getByRole("spinbutton").fill("123");
    expect(await card("Max players").getByRole("spinbutton").inputValue()).toBe("123");
    await page.close();
  });

  it("stops drawing a chart a card has no room for, and draws it again when the room comes back", async () => {
    const page = await open("/admin/", 1300);
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Players online" }) });
    const drawn = async () => card.locator(".apb-chart-body").evaluate((node) => node.checkVisibility());
    const reading = card.locator(".apb-value").first();
    expect(await drawn()).toBe(true);
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    for (let i = 0; i < 4; i += 1) await page.getByRole("button", { name: "Make Players online shorter" }).click();
    await page.getByRole("button", { name: "Save for me" }).click();
    // Too small to say anything as a drawing: the card says it in numbers instead.
    await expect.poll(() => card.getAttribute("data-drawing")).toBe("off");
    expect(await drawn()).toBe(false);
    expect(await reading.isVisible()).toBe(true);
    // The way to the numbers behind it stays open, however small the card is.
    expect(await card.locator(".apb-table-view > summary").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    for (let i = 0; i < 6; i += 1) await page.getByRole("button", { name: "Make Players online taller" }).click();
    await page.getByRole("button", { name: "Save for me" }).click();
    // Room again: the chart is drawn again.
    await expect.poll(() => card.getAttribute("data-drawing")).toBeNull();
    await expect.poll(drawn).toBe(true);
    await page.close();
  });

  it("uses the room a card is given: a chart fills it, and what is done with it goes to the foot", async () => {
    const page = await open("/admin/", 1300);
    const card = (name: string) => page.locator("article", { has: page.getByRole("heading", { name }) });
    const chart = card("Players online");
    const setting = card("Max players");
    const plot = chart.locator(".apb-plot").first();
    const drawn = async () => (await plot.evaluate((node) => node.getBoundingClientRect().height)) as number;
    const before = await drawn();
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    for (let i = 0; i < 4; i += 1) await page.getByRole("button", { name: "Make Players online taller" }).click();
    for (let i = 0; i < 6; i += 1) await page.getByRole("button", { name: "Make Max players shorter" }).click();
    for (let i = 0; i < 4; i += 1) await page.getByRole("button", { name: "Make Max players taller" }).click();
    await page.getByRole("button", { name: "Save for me" }).click();
    // The chart takes the room, rather than stopping part-way down the card.
    await expect.poll(drawn).toBeGreaterThan(before);
    await expect.poll(async () => {
      const body = await chart.locator(".apb-card-body").evaluate((node) => node.getBoundingClientRect().bottom);
      const bottom = await plot.evaluate((node) => node.getBoundingClientRect().bottom);
      return body - bottom;
    }).toBeLessThan(80);
    // A setting cannot grow into it: what is read stays at the top and the editor goes to the foot.
    await expect.poll(() => setting.getAttribute("data-room")).toBe("ends");
    // How much of the card is left under the last thing on it.
    const under = async (): Promise<number> =>
      await setting.evaluate((node) => {
        const body = node.querySelector<HTMLElement>(".apb-card-body");
        const last = node.querySelector<HTMLElement>(".apb-editor");
        return body === null || last === null ? -1 : Math.round(body.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom);
      });
    expect(await under()).toBeLessThan(8);
    // Far more room than the card holds: spreading it that far is a hole, so what it holds stays
    // together at the top instead.
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    for (let i = 0; i < 4; i += 1) await page.getByRole("button", { name: "Make Max players taller" }).click();
    await page.getByRole("button", { name: "Save for me" }).click();
    await expect.poll(() => setting.getAttribute("data-room")).toBe("near");
    expect(await under()).toBeGreaterThan(80);
    await page.close();
  });

  it("shows a chart's numbers in the room there is, without moving the cards around it", async () => {
    const page = await open("/admin/", 1300);
    const grid = page.locator(".apb-pane:not([hidden]) .apb-grid");
    // What each card holds against the room it has, and what it paints under itself.
    const spilling = async () =>
      grid.evaluate((node) =>
        [...node.querySelectorAll<HTMLElement>(".apb-card")]
          .map((card) => {
            const body = card.querySelector<HTMLElement>(".apb-card-body");
            const box = card.getBoundingClientRect();
            let paints = false;
            for (const step of [4, 16, 40]) {
              for (const share of [0.2, 0.5, 0.8]) {
                const found = document.elementFromPoint(box.left + box.width * share, box.bottom + step);
                if (found !== null && card.contains(found)) paints = true;
              }
            }
            const scrolls = body !== null && !body.hidden && body.scrollHeight > body.clientHeight;
            return { name: card.dataset.card ?? "", paints, unreachable: scrolls && body?.getAttribute("tabindex") === null };
          })
          .filter((card) => card.paints || card.unreachable),
      );
    const card = page.locator("article", { has: page.getByRole("heading", { name: "Players online" }) });
    const rows = async () => Number(await card.evaluate((node) => node.style.getPropertyValue("--apb-h")));
    // The card settles as what it holds arrives: the size to compare against is the settled one.
    let before = await rows();
    for (let tries = 0; tries < 20; tries += 1) {
      await page.waitForTimeout(250);
      const again = await rows();
      if (again === before) break;
      before = again;
    }
    const places = async () =>
      grid.evaluate((node) =>
        [...node.querySelectorAll<HTMLElement>(".apb-card")].map((one) => `${one.dataset.card ?? ""} ${one.style.getPropertyValue("--apb-x")} ${one.style.getPropertyValue("--apb-w")}`),
      );
    const laid = await places();
    const drawn = async () => card.locator(".apb-chart-body").evaluate((node) => node.checkVisibility());
    // The control, not its words: they change to say what pressing it does now.
    const table = card.locator(".apb-table-view > summary");
    await table.click();
    // The numbers stand where the chart stood: the card keeps its rows, so nothing around it moves.
    await expect.poll(() => card.locator(".apb-table-view table tbody tr").count()).toBeGreaterThan(0);
    // The rows arrive before the card has been measured against them: the swap is what to wait for.
    await expect.poll(drawn, { timeout: 4000 }).toBe(false);
    expect(await rows()).toBe(before);
    expect(await spilling()).toEqual([]);
    // And every card kept the column and the width it had, whatever order they are read in now.
    expect((await places()).sort()).toEqual([...laid].sort());
    await table.click();
    // Closed: the chart is back, and still nothing moved.
    await expect.poll(drawn).toBe(true);
    expect(await rows()).toBe(before);
    expect(await spilling()).toEqual([]);

    // Given more room than the chart needs, the numbers go under it and the chart stays drawn.
    await page.getByRole("button", { name: "Arrange the cards on this tab" }).click();
    for (let i = 0; i < 4; i += 1) await page.getByRole("button", { name: "Make Players online taller" }).click();
    await page.getByRole("button", { name: "Save for me" }).click();
    await expect.poll(rows).toBeGreaterThan(before);
    const roomy = await rows();
    await table.click();
    await expect.poll(() => card.locator(".apb-table-view table tbody tr").count()).toBeGreaterThan(0);
    expect(await drawn()).toBe(true);
    expect(await rows()).toBe(roomy);
    expect(await spilling()).toEqual([]);
    await page.close();
  });

  it("shows the search key, and lines numbers up on the right in a table", async () => {
    const page = await open("/admin/#blocks");
    await expect.poll(() => page.locator(".apb-search-key").isVisible()).toBe(true);
    const table = page.locator(".apb-block-table");
    await expect.poll(() => table.locator("th.apb-num").count()).toBe(1);
    expect(await table.locator("tbody tr").first().locator("td.apb-num").count()).toBe(1);
    await page.close();
  });
});

describe("smaller pages", () => {
  it("never loads the chart and table code on a panel without charts or tables", async () => {
    requested.length = 0;
    const page = await open("/plain-host");
    await expect.poll(() => page.locator(".apb-card").count()).toBe(1);
    expect(requested.some((url) => url.includes("client-extras"))).toBe(false);
    await page.close();
    requested.length = 0;
    const charts = await open("/");
    await expect.poll(() => charts.locator(".apb-plot").count()).toBeGreaterThan(0);
    expect(requested.filter((url) => url.includes("client-extras"))).toHaveLength(1);
    await charts.close();
  });

  it("mounts several fragments from one script, one of them a single group without chrome", async () => {
    const page = await open("/two");
    await expect.poll(() => page.locator("[data-apb-root]").count()).toBe(2);
    await expect.poll(() => page.locator(".apb-card").count()).toBeGreaterThan(2);
    expect(await page.locator("[data-apb-root]").first().locator(".apb-header").count()).toBe(0);
    expect(await page.locator("[data-apb-root]").first().getByRole("heading", { name: "Max players" }).count()).toBe(1);
    expect(await page.locator("[data-apb-root]").first().getByRole("heading", { name: "Greeting" }).count()).toBe(0);
    await page.close();
  });

  it("turns table rows into cards on a phone, without sideways scrolling", async () => {
    const page = await open("/admin/#blocks", 360);
    await expect.poll(() => page.locator(".apb-block-table tbody tr").count()).toBe(10);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await page.locator(".apb-block-table tbody td").first().evaluate((cell) => getComputedStyle(cell, "::before").content)).toBe('"id"');
    await page.close();
  });

  it("shows one group, cards only, from element attributes", async () => {
    const page = await open("/element-compact");
    await expect.poll(() => page.evaluate(() => document.querySelector("admin-panel")?.shadowRoot?.querySelectorAll(".apb-card").length ?? 0)).toBe(8);
    expect(await page.evaluate(() => document.querySelector("admin-panel")?.shadowRoot?.querySelectorAll('[role="tab"]').length ?? -1)).toBe(0);
    await page.close();
  });
});

describe("embedded", () => {
  it("renders a fragment under a host CSP of 'self' alone", async () => {
    const page = await open("/");
    await expect.poll(() => page.locator(".apb-card").count()).toBeGreaterThan(3);
    await page.close();
  });

  it("renders the custom element inside its shadow root", async () => {
    const page = await open("/element");
    await expect.poll(() => page.evaluate(() => document.querySelector("admin-panel")?.shadowRoot?.querySelectorAll(".apb-card").length ?? 0)).toBeGreaterThan(3);
    await page.close();
  });

  it("logged no errors on any page", () => {
    expect(errors).toEqual([]);
  });
});
