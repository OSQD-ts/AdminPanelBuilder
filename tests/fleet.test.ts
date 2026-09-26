/** The fleet page: every replica's panel, whether it answers, behind its own sign-in. */
import { describe, expect, it } from "vitest";
import { createFleet, listenPanel } from "../src/adapters/index.js";
import { createAdminPanel } from "../src/index.js";
import { TOKEN } from "./helpers.js";

describe("the fleet page", () => {
  it("lists each panel with whether it answers, its title and its warnings, and holds the tokens back", async () => {
    const web = createAdminPanel({ title: "Web", instance: "web-1" });
    web.modifiable("x", "API key");
    const server = await listenPanel(web, { port: 0, auth: { token: TOKEN } });
    try {
      const fleet = createFleet({
        panels: [
          { name: "web-1", url: server.url, token: TOKEN, link: "https://ops.example/web-1" },
          { name: "web-2", url: "http://127.0.0.1:1", token: TOKEN },
        ],
        auth: { check: (request) => (request.headers.cookie === "ok" ? "ada" : false) },
        timeoutMs: 1000,
      });
      const entries = await fleet.status();
      expect(entries[0]).toMatchObject({ name: "web-1", reachable: true, title: "Web", instance: "web-1", warnings: 1 });
      expect(entries[1]).toMatchObject({ name: "web-2", reachable: false, problem: expect.any(String) });
      const handle = fleet.fetchHandler();
      const page = await handle(new Request("http://fleet.local/", { headers: { cookie: "ok" } }));
      const html = await page.text();
      expect(page.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
      expect(html).toContain('href="https://ops.example/web-1"');
      expect(html).toContain("1 not answering");
      expect(html).not.toContain(TOKEN);
      expect(html).not.toContain("<script");
      const json = (await (await handle(new Request("http://fleet.local/api/fleet", { headers: { cookie: "ok" } }))).json()) as { panels: unknown[] };
      expect(json.panels).toHaveLength(2);
      // Refused the way every panel route refuses: the sentence, the kind, and the key that translates it.
      const refused = await handle(new Request("http://fleet.local/"));
      expect([refused.status, await refused.json()]).toEqual([401, { error: "sign in to see this panel", code: "unauthenticated", key: "refuseSignIn", params: {} }]);
      // Mounted under a prefix it is not told, every path but its API is the page itself.
      expect((await handle(new Request("http://fleet.local/anything", { headers: { cookie: "ok" } }))).headers.get("content-type")).toMatch(/text\/html/);
      const posted = await handle(new Request("http://fleet.local/", { method: "POST", headers: { cookie: "ok" } }));
      expect([posted.status, posted.headers.get("allow"), ((await posted.json()) as { key: string }).key]).toEqual([405, "GET", "refuseMethod"]);
      expect(() => createFleet({ panels: [], auth: { check: () => "a" } })).toThrow(/list nothing/);
      expect(() => createFleet({ panels: [{ name: "a", url: "x" }], auth: { check: () => "a" } })).toThrow(/http/);
      expect(() => createFleet({ panels: [{ name: "a", url: "http://a" }, { name: "a", url: "http://b" }], auth: { check: () => "a" } })).toThrow(/two panels/);
      expect(() => createFleet({ panels: [{ name: "a", url: "http://a" }] } as never)).toThrow(/auth is required/);
    } finally {
      web.close();
      await server.close();
    }
  });
});

describe("the fleet page, round two", () => {
  it("lists settings that differ, says since when a panel answers, and refreshes itself", async () => {
    const one = createAdminPanel({ title: "One" });
    const two = createAdminPanel({ title: "Two" });
    one.modifiable(10, "Limit");
    two.modifiable(20, "Limit");
    one.modifiable("a", "Only here");
    const first = await listenPanel(one, { port: 0, auth: { token: TOKEN } });
    const second = await listenPanel(two, { port: 0, auth: { token: TOKEN } });
    let now = 1_000_000;
    try {
      const fleet = createFleet({ panels: [{ name: "one", url: first.url, token: TOKEN }, { name: "two", url: second.url, token: TOKEN }], auth: { check: () => "ada" }, refreshSeconds: 30, now: () => now });
      const survey = await fleet.survey();
      expect(survey.drift).toEqual([
        { id: "limit", values: { one: 10, two: 20 } },
        { id: "only-here", values: { one: "a" } },
      ]);
      expect(survey.panels[0]?.since).toBeUndefined();
      now += 120_000;
      expect((await fleet.survey()).panels[0]?.since).toBe(1_000_000);
      const html = await (await fleet.fetchHandler()(new Request("http://fleet.local/"))).text();
      expect(html).toContain('<meta http-equiv="refresh" content="30">');
      expect(html).toContain("Settings that differ");
      expect(html).toContain("not set here");
      expect(() => createFleet({ panels: [{ name: "a", url: "http://a" }], auth: { check: () => "a" }, refreshSeconds: 1 })).toThrow(/at least 5/);
    } finally {
      one.close();
      two.close();
      await first.close();
      await second.close();
    }
  });
});
