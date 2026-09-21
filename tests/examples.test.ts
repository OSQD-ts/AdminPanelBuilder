/**
 * The examples, run the way somebody following the documentation runs them: as a process,
 * then asked over HTTP. Compiling them is not enough — an example that type-checks and fails
 * on start is documentation that lies.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { buildMailPanel } from "../examples/anymail.js";
import { buildBasicPanel } from "../examples/basic.js";
import { buildBisPanel } from "../examples/bis.js";
import { buildBotPanel } from "../examples/bothandlerjs.js";
import { buildChessPanel } from "../examples/ch3ss.js";
import { buildHoneypotPanel } from "../examples/hackerpot.js";
import { buildHonoPanel } from "../examples/hono.js";
import { buildNextRoutes } from "../examples/next-route.js";

const TOKEN = "example-token-0123456789";
const running: ChildProcess[] = [];
afterEach(() => {
  for (const child of running.splice(0)) child.kill("SIGINT");
});

/** Starts an example on a free port and resolves with the first line it prints: its URL. */
function start(file: string): Promise<string> {
  const child = spawn(process.execPath, ["--import", "tsx", file], { env: { ...process.env, PORT: "0", PANEL_TOKEN: TOKEN }, stdio: ["ignore", "pipe", "pipe"] });
  running.push(child);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${file} printed nothing within 15s`)), 15_000);
    createInterface({ input: child.stdout as NodeJS.ReadableStream }).once("line", (line) => {
      clearTimeout(timer);
      resolve(line.trim());
    });
    child.once("exit", (code) => reject(new Error(`${file} exited with ${code}`)));
  });
}

describe.each(["examples/basic.ts", "examples/ch3ss.ts", "examples/anymail.ts", "examples/bothandlerjs.ts", "examples/hackerpot.ts"])("%s", (file) => {
  it("starts, prints its URL on stdout, and serves its panel to the token", { timeout: 30_000 }, async () => {
    const url = await start(file);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=/);
    const base = url.split("?")[0] as string;
    const response = await fetch(`${base}api/schema`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(response.status).toBe(200);
    const { schema } = (await response.json()) as { schema: { groups: unknown[]; controls: { edit: boolean } } };
    expect(schema.groups.length).toBeGreaterThan(0);
    expect(schema.controls.edit).toBe(true);
  });
});

describe("examples/bis.ts", () => {
  it("serves an admin listener and a support listener that withholds Finance", { timeout: 30_000 }, async () => {
    const base = await start("examples/bis.ts");
    const admin = await fetch(`${base}admin/panel/api/schema`, { headers: { cookie: "bis_session=admin-session" } });
    const support = await fetch(`${base}support/panel/api/schema`, { headers: { cookie: "bis_session=support-session" } });
    const refused = await fetch(`${base}admin/panel/api/schema`, { headers: { cookie: "bis_session=support-session" } });
    const titles = async (response: Response) => ((await response.json()) as { schema: { groups: Array<{ title: string }> } }).schema.groups.map((group) => group.title);
    expect(await titles(admin)).toEqual(["Customers", "Finance", "Operations"]);
    expect(await titles(support)).toEqual(["Customers"]);
    expect(refused.status).toBe(401);
    const page = await (await fetch(`${base}admin`)).text();
    expect(page).toContain('data-api="/admin/panel"');
  });
});

describe("every example's panel", () => {
  it("builds and survives its own simulation without a notice", () => {
    const panels = [buildBasicPanel(), buildChessPanel(), buildMailPanel(), buildBisPanel()];
    for (const { panel, tick } of panels) {
      for (let i = 0; i < 30; i += 1) tick();
      expect(panel.schema().groups.length).toBeGreaterThan(0);
      expect(panel.notices().filter((notice) => notice.level === "warning")).toEqual([]);
      panel.close();
    }
    const bot = buildBotPanel({ handler: { on: () => undefined }, applyChallengeScore: () => undefined });
    const pot = buildHoneypotPanel({ on: () => undefined }, ["decoy-path"]);
    expect(bot.panel.schema().groups.map((group) => group.title)).toEqual(["Traffic", "Guard", "Policy"]);
    expect(pot.panel.schema().groups.map((group) => group.title)).toEqual(["Hits", "Detectors"]);
    bot.panel.close();
    pot.panel.close();
  });
});

describe("framework recipes that need no adapter", () => {
  it("serve a Hono route through the Fetch handler", async () => {
    const { panel, honoRoute } = buildHonoPanel(TOKEN);
    const response = await honoRoute({ req: { raw: new Request("http://app.example/admin/api/values/limit", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", host: "app.example" }, body: '{"value":42}' }) } });
    expect(response.status).toBe(200);
    expect(panel.get("limit")?.value).toBe(42);
  });

  it("serve a Next.js route handler", async () => {
    const { panel, panelRoutes } = buildNextRoutes(TOKEN);
    const response = await panelRoutes.GET(new Request("http://app.example/admin/api/schema", { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(((await response.json()) as { schema: { title: string } }).schema.title).toBe("Next app");
    panel.close();
  });
});
