/**
 * The examples, run the way somebody following the documentation runs them: as a process, then
 * asked over HTTP. Compiling them is not enough — an example that type-checks and fails on start is
 * documentation that lies. Each example is also held to what its header says it shows.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { buildAccessPanel } from "../examples/access.js";
import { buildChangeControlPanel } from "../examples/change-control.js";
import { buildConfiguredPanel } from "../examples/configuration.js";
import { buildEmbeddedPanel } from "../examples/embedding.js";
import { buildFleet } from "../examples/fleet.js";
import { buildQuickstart } from "../examples/quickstart.js";
import { buildServicePanel } from "../examples/service.js";
import { EVERYTHING } from "../src/testing.js";

const TOKEN = "example-token-0123456789";
const running: ChildProcess[] = [];
afterEach(() => {
  for (const child of running.splice(0)) child.kill("SIGINT");
});

/** Starts an example on a free port and resolves with the first line it prints: its URL. */
function start(file: string, env: Record<string, string> = {}): Promise<string> {
  const child = spawn(process.execPath, ["--import", "tsx", file], { env: { ...process.env, PORT: "0", PANEL_TOKEN: TOKEN, ...env }, stdio: ["ignore", "pipe", "pipe"] });
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

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
type Schema = { groups: Array<{ title: string; items: Array<{ id: string; type: string; kind?: string }> }>; controls: { edit: boolean; actions: boolean } };
const schemaOf = async (response: Response): Promise<Schema> => ((await response.json()) as { schema: Schema }).schema;

describe.each(["examples/quickstart.ts", "examples/service.ts", "examples/change-control.ts"])("%s", (file) => {
  it("starts, prints its URL on stdout, and serves its panel to the token", { timeout: 30_000 }, async () => {
    const url = await start(file);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=/);
    const base = url.split("?")[0] as string;
    const schema = await schemaOf(await fetch(`${base}api/schema`, { headers: bearer(TOKEN) }));
    expect(schema.groups.length).toBeGreaterThan(0);
    expect(schema.controls.edit).toBe(true);
  });
});

describe("every example's panel", () => {
  it("builds and survives its own simulation without a warning", () => {
    const panels = [buildQuickstart(), buildServicePanel(), buildChangeControlPanel(), buildAccessPanel({ secret: "s".repeat(40), monitorToken: TOKEN }), buildEmbeddedPanel({ token: TOKEN }), buildConfiguredPanel(), ...buildFleet(2)];
    for (const { panel, tick } of panels) {
      for (let i = 0; i < 60; i += 1) tick();
      expect(panel.schema().groups.length).toBeGreaterThan(0);
      expect(panel.notices().filter((notice) => notice.level === "warning")).toEqual([]);
      panel.close();
    }
  });
});

describe("examples/service.ts", () => {
  it("draws every kind of chart, a paged table and a feed, and offers its own theme", () => {
    const { panel, tick } = buildServicePanel();
    for (let i = 0; i < 40; i += 1) tick();
    const items = panel.schema(EVERYTHING).groups.flatMap((group) => group.items);
    const kinds = new Set(items.filter((item) => item.type === "chart").map((item) => (item as { kind: string }).kind));
    expect([...kinds]).toEqual(expect.arrayContaining(["line", "area", "bar", "histogram", "heatmap", "gauge", "sparkline"]));
    expect(items.some((item) => item.type === "table")).toBe(true);
    expect(items.some((item) => item.type === "feed")).toBe(true);
    expect(panel.schema().theme.offered?.map((theme) => theme.name)).toContain("harbor");
    panel.close();
  });
});

describe("examples/change-control.ts", () => {
  it("guards its settings: approval, a required reason, the application's own check, and code after a change", async () => {
    const { panel, switches } = buildChangeControlPanel();
    expect(panel.edit("refund-limit", 1000, "ada", EVERYTHING, { reason: "peak season" })).toMatchObject({ ok: true, pending: { by: "ada" } });
    expect(panel.edit("daily-payout-cap", 50_000, "ada", EVERYTHING)).toMatchObject({ ok: false, refusal: { key: "refuseReasonRequired" } });
    expect(panel.edit("daily-payout-cap", 2000, "ada", EVERYTHING, { reason: "test" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(panel.edit("card-provider", "adyen", "ada", EVERYTHING)).toMatchObject({ ok: true });
    await expect.poll(() => switches).toEqual(["ada moved cards from stripe to adyen"]);
    expect(panel.edit("maintenance-banner", "Back soon", "ada", EVERYTHING)).toMatchObject({ ok: false, reason: "not-allowed" });
    panel.close();
  });

  it("keeps a chained change log and verifies it from the page", { timeout: 30_000 }, async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const log = join(await mkdtemp(join(tmpdir(), "apb-log-")), "changes.jsonl");
    const url = await start("examples/change-control.ts", { APB_LOG: log });
    const base = url.split("?")[0] as string;
    const post = (path: string, body: object) => fetch(`${base}${path}`, { method: "POST", headers: { ...bearer(TOKEN), "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post("api/values/retry-attempts", { value: 5 })).status).toBe(200);
    const verified = (await (await post("api/actions/verify-the-change-log", {})).json()) as { result: { message: string } };
    expect(verified.result.message).toMatch(/^The chain holds over [1-9]\d* records\.$/);
  });
});

describe("examples/access.ts", () => {
  it("narrows each person by their grants, revokes a signed-out session, and serves monitoring apart", { timeout: 30_000 }, async () => {
    const base = await start("examples/access.ts", { MONITOR_TOKEN: TOKEN });
    const signIn = async (name: string): Promise<string> => {
      const response = await fetch(`${base}login?as=${name}`, { redirect: "manual" });
      return (response.headers.get("set-cookie") ?? "").split(";")[0] as string;
    };
    const as = async (cookie: string) => fetch(`${base}panel/api/schema`, { headers: { cookie } });
    const ada = await schemaOf(await as(await signIn("ada")));
    const sam = await schemaOf(await as(await signIn("sam")));
    const lin = await schemaOf(await as(await signIn("lin")));
    expect(ada.groups.map((group) => group.title)).toEqual(["Customers", "Finance", "Service"]);
    expect([sam.groups.map((group) => group.title), sam.controls.edit]).toEqual([["Customers"], false]);
    expect([lin.groups.map((group) => group.title), lin.controls.edit, lin.controls.actions]).toEqual([["Customers", "Finance"], true, false]);
    const leaving = await signIn("ada");
    await fetch(`${base}logout`, { headers: { cookie: leaving }, redirect: "manual" });
    expect((await as(leaving)).status).toBe(401);
    const monitoring = await schemaOf(await fetch(`${base}status/api/schema`, { headers: bearer(TOKEN) }));
    expect(monitoring.groups.map((group) => group.title)).toEqual(["Service"]);
    expect((await fetch(`${base}status/healthz`)).status).toBe(200);
    expect(await (await fetch(`${base}status/metrics`, { headers: bearer(TOKEN) })).text()).toMatch(/^# (HELP|TYPE) /m);
  });
});

describe("examples/fleet.ts", () => {
  it("carries a change between replicas, and a proposal made on one is approved on another", async () => {
    const [one, two] = buildFleet(2) as [ReturnType<typeof buildFleet>[number], ReturnType<typeof buildFleet>[number]];
    expect(one.panel.edit("rate-limit", 250, "ada", EVERYTHING)).toMatchObject({ ok: true });
    await expect.poll(() => two.panel.get("rate-limit")?.value).toBe(250);
    const proposal = one.panel.edit("session-length", 60, "ada", EVERYTHING, { reason: "longer shifts" });
    const id = proposal.ok && "pending" in proposal ? proposal.pending.id : "";
    await expect.poll(() => two.panel.pending().map((change) => change.id)).toContain(id);
    expect(await two.panel.approve(id, "sam", EVERYTHING)).toMatchObject({ ok: true });
    await expect.poll(() => one.panel.get("session-length")?.value).toBe(60);
    one.panel.close();
    two.panel.close();
  });

  it("serves a fleet page of every replica and a narrowed gateway in front of one", { timeout: 30_000 }, async () => {
    const base = await start("examples/fleet.ts");
    const page = await (await fetch(base, { headers: bearer(TOKEN) })).text();
    for (const name of ["web-1", "web-2", "web-3"]) expect(page).toContain(name);
    const gateway = await schemaOf(await fetch(`${base}settings/api/schema`, { headers: bearer(TOKEN) }));
    expect(gateway.groups.map((group) => group.title)).toEqual(["Settings"]);
  });
});

describe("examples/embedding.ts", () => {
  it("embeds the panel in the host's pages, as a snapshot, and serves it through the Fetch API", { timeout: 30_000 }, async () => {
    const base = await start("examples/embedding.ts");
    expect(await (await fetch(base)).text()).toContain('data-api="/admin"');
    const dashboard = await (await fetch(`${base}dashboard`)).text();
    expect(dashboard.match(/data-compact/g)).toHaveLength(2);
    expect(dashboard.match(/client\.js/g)).toHaveLength(1);
    const report = await fetch(`${base}report`);
    expect(report.headers.get("content-security-policy")).toContain("nonce-report-nonce");
    expect(await report.text()).toContain("Stock by product");

    const { panel, fetchRoutes } = buildEmbeddedPanel({ token: TOKEN });
    const post = new Request("http://shop.example/edge/api/values/reorder-below", { method: "POST", headers: { ...bearer(TOKEN), "content-type": "application/json", host: "shop.example" }, body: '{"value":9}' });
    expect((await fetchRoutes.hono({ req: { raw: post } })).status).toBe(200);
    expect(panel.get("reorder-below")?.value).toBe(9);
    const schema = await schemaOf(await fetchRoutes.next.GET(new Request("http://shop.example/edge/api/schema", { headers: bearer(TOKEN) })));
    expect(schema.groups.map((group) => group.title)).toEqual(["Orders", "Stock"]);
    panel.close();
  });
});

describe("examples/configuration.ts", () => {
  it("takes its listener from a file and the environment, and reloads on SIGHUP", { timeout: 30_000 }, async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const file = join(await mkdtemp(join(tmpdir(), "apb-configured-")), "admin-panel.toml");
    await writeFile(file, "[controls]\nedit = true\n");
    const base = await start("examples/configuration.ts", { APB_CONFIG: file });
    const schema = async () => schemaOf(await fetch(`${base}api/schema`, { headers: bearer(TOKEN) }));
    expect((await schema()).controls.edit).toBe(true);
    await writeFile(file, "[controls]\nedit = false\n");
    running.at(-1)?.kill("SIGHUP");
    await expect.poll(async () => (await schema()).controls.edit, { timeout: 5000 }).toBe(false);
  });
});
