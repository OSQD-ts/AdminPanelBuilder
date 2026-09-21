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
      expect((await handle(new Request("http://fleet.local/"))).status).toBe(401);
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
