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
import { createAdminPanel, type AdminPanel } from "../../src/index.js";

const TOKEN = "browser-token-0123456789";
const engines = { chromium, firefox, webkit };
const engine = engines[(process.env.BROWSER_ENGINE ?? "chromium") as keyof typeof engines];

let browser: Browser;
let panel: AdminPanel;
let plain: AdminPanel;
let german: AdminPanel;
let load: { value: number };
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
  panel = createAdminPanel({ title: "Browser test", theme: "material" });
  const players = panel.viewable(3, { label: "Players online", group: "Game", chart: true });
  panel.modifiable(100, { label: "Max players", group: "Game", min: 2, max: 500 });
  panel.modifiable(true, { label: "Guests allowed", group: "Game" });
  panel.viewable({ blitz: 4, rapid: 2 }, { label: "Queue", group: "Game", chart: { over: "keys" } });
  panel.modifiable("hello", { label: "Greeting", group: "Text", maxLength: 20 });
  panel.action("Flush", () => "Flushed.", { group: "Text" });
  panel.modifiable(5, { label: "Guarded limit", group: "Text", approval: true, max: 100 });
  panel.modifiable(50, { label: "Send rate", group: "Text", min: 1, max: 500 });
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
    await page.getByRole("combobox", { name: "Colours" }).selectOption("dark");
    expect(await page.locator(".apb-root").getAttribute("data-scheme")).toBe("dark");
    await page.reload();
    await expect.poll(() => page.locator(".apb-root").getAttribute("data-scheme")).toBe("dark");
    await page.getByRole("combobox", { name: "Colours" }).selectOption("");
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
    await expect.poll(() => page.evaluate(() => document.querySelector("admin-panel")?.shadowRoot?.querySelectorAll(".apb-card").length ?? 0)).toBe(4);
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
