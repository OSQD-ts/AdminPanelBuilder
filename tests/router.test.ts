/**
 * The router's rules, tested without a server: every front end is a translation of this.
 */
import { describe, expect, it } from "vitest";
import { AdminPanelConfigError, ManualClock } from "../src/index.js";
import { bearer, call, jsonWrite, panelAt, routerFor, TOKEN } from "./helpers.js";

function fixture() {
  const { panel, clock } = panelAt();
  panel.viewable(3, { label: "Players", group: "Game" });
  panel.modifiable(100, { label: "Limit", group: "Game", min: 1, max: 500 });
  panel.modifiable("secret", { label: "Revenue note", group: "Finance" });
  panel.action("Flush", () => "flushed", { group: "Game" });
  return { panel, clock };
}

describe("refusing to start in a configuration that would hurt somebody", () => {
  it("refuses editing or actions without auth, even on loopback", () => {
    const { panel } = fixture();
    expect(() => routerFor(panel, { controls: { edit: true } })).toThrow(/controls.edit needs auth, even on loopback/);
    expect(() => routerFor(panel, { controls: { actions: true } })).toThrow(/controls.actions needs auth/);
  });

  it("refuses a non-loopback listener without auth", () => {
    const { panel } = fixture();
    expect(() => routerFor(panel, {}, "0.0.0.0")).toThrow(/listening on 0.0.0.0 without auth/);
  });

  it("refuses a short token, an empty token list and an empty basic password", () => {
    const { panel } = fixture();
    expect(() => routerFor(panel, { auth: { token: "short" } })).toThrow(/at least 16/);
    expect(() => routerFor(panel, { auth: { tokens: {} } })).toThrow(/admit nobody while looking configured/);
    expect(() => routerFor(panel, { auth: { basic: { username: "ada", password: "" } } })).toThrow(/password for "ada" is empty/);
  });

  it("refuses a misspelt option rather than leaving its default in place", () => {
    const { panel } = fixture();
    expect(() => routerFor(panel, { contorls: { edit: true } } as never)).toThrow(/did you mean "controls"/);
    expect(() => routerFor(panel, { auth: { token: TOKEN }, controls: { edits: true } } as never)).toThrow(/"edits" that nothing reads/);
    expect(() => routerFor(panel, { basePath: "admin" })).toThrow(AdminPanelConfigError);
    expect(() => routerFor(panel, { groups: [] })).toThrow(/would show nothing/);
  });
});

describe("every response", () => {
  it("carries the four security headers and no CORS header", async () => {
    const { panel } = fixture();
    const router = routerFor(panel);
    for (const path of ["/", "/api/schema", "/nope"]) {
      const response = await call(router, "GET", path);
      expect(response.headers["cache-control"]).toBe("no-store, max-age=0");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(Object.keys(response.headers).some((name) => name.startsWith("access-control-"))).toBe(false);
    }
  });

  it("is an object with one named key, or { error, code } with a sentence and what kind of failure it is", async () => {
    const { panel } = fixture();
    const router = routerFor(panel);
    expect(Object.keys((await call(router, "GET", "/api/schema")).json)).toEqual(["schema"]);
    expect(Object.keys((await call(router, "GET", "/api/state")).json)).toEqual(["state"]);
    expect(Object.keys((await call(router, "GET", "/api/changes")).json)).toEqual(["changes"]);
    expect(Object.keys((await call(router, "GET", "/api/notices")).json)).toEqual(["notices"]);
    const missing = await call(router, "GET", "/api/nothing");
    expect(missing.status).toBe(404);
    expect(missing.json).toEqual({ error: "there is nothing at /api/nothing", code: "not-found" });
  });
});

describe("the page", () => {
  it("is served under a fresh nonce CSP built from default-src 'none'", async () => {
    const { panel } = fixture();
    const router = routerFor(panel);
    const first = await call(router, "GET", "/");
    const second = await call(router, "GET", "/");
    const csp = first.headers["content-security-policy"] as string;
    expect(csp).toMatch(/^default-src 'none'; script-src 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toBe(second.headers["content-security-policy"]);
    const nonce = /nonce-([^']+)/.exec(csp)?.[1];
    expect(first.body).toContain(`<script nonce="${nonce}">`);
  });

  it("carries nothing that can end its script element, whatever the values say", async () => {
    const { panel } = panelAt();
    panel.viewable("</script><script>alert(1)</script>", "Player name");
    panel.viewable(1, "<img src=x onerror=alert(1)>");
    const page = await call(routerFor(panel), "GET", "/");
    const bootstrap = /<script type="application\/json" data-apb-bootstrap>(.*?)<\/script>/s.exec(page.body)?.[1] ?? "";
    expect(bootstrap).not.toContain("<");
    expect(page.body).not.toContain("<img");
    expect(JSON.parse(bootstrap).state.values[0].value).toBe("</script><script>alert(1)</script>");
  });

  it("answers under its base path, with or without the prefix a surrounding router strips", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { basePath: "/admin/" }, undefined);
    expect((await call(router, "GET", "/admin/api/schema")).status).toBe(200);
    expect((await call(router, "GET", "/api/schema")).status).toBe(200);
    expect((await call(router, "GET", "/admin")).headers["content-type"]).toMatch(/text\/html/);
  });
});

describe("authentication", () => {
  it("gives an unauthenticated caller the same refusal for every path, so the API cannot be mapped", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { token: TOKEN } });
    const answers = await Promise.all(["/", "/api/schema", "/api/nothing", "/panel.css"].map((path) => call(router, "GET", path)));
    expect(new Set(answers.map((answer) => `${answer.status} ${answer.body}`)).size).toBe(1);
    expect(answers[0]?.status).toBe(401);
  });

  it("admits a bearer token and names the operator by the token's name", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { tokens: { ada: TOKEN } }, controls: { edit: true } });
    const edit = await call(router, "POST", "/api/values/limit", { headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: '{"value":7}' });
    expect(edit.json.value.by).toBe("ada");
    expect(panel.changes()[0]).toMatchObject({ kind: "edit", target: "limit", by: "ada", from: 100, to: 7 });
  });

  it("swaps ?token= for an HttpOnly cookie and a URL without it", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { token: TOKEN }, basePath: "/admin" }, undefined);
    const exchange = await call(router, "GET", `/admin/?token=${TOKEN}`);
    expect(exchange.status).toBe(303);
    expect(exchange.headers.location).toBe("/admin/");
    expect(exchange.headers["set-cookie"]).toMatch(/^apb_token=.+; Path=\/admin; HttpOnly; SameSite=Strict$/);
    const cookie = (exchange.headers["set-cookie"] as string).split(";")[0] as string;
    expect((await call(router, "GET", "/admin/api/schema", { headers: { cookie } })).status).toBe(200);
    expect((await call(router, "GET", "/admin/?token=wrong-token-of-some-length")).status).toBe(401);
  });

  it("challenges for basic credentials and admits the right ones", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { basic: [{ username: "ada", password: "lovelace" }] } });
    const refused = await call(router, "GET", "/api/schema");
    expect(refused.headers["www-authenticate"]).toMatch(/^Basic realm=/);
    const admitted = await call(router, "GET", "/api/schema", { headers: { authorization: `Basic ${btoa("ada:lovelace")}` } });
    expect(admitted.status).toBe(200);
    expect((await call(router, "GET", "/api/schema", { headers: { authorization: `Basic ${btoa("ada:wrong")}` } })).status).toBe(401);
  });

  it("treats an empty name, a false and a throw from a custom check as refusals", async () => {
    const { panel } = fixture();
    const refusing: Array<() => string | false | undefined | Promise<string>> = [() => "", () => false, () => undefined, () => Promise.reject(new Error("session store down"))];
    for (const check of refusing) {
      const router = routerFor(panel, { auth: { check } });
      expect((await call(router, "GET", "/api/schema")).status).toBe(401);
    }
    const router = routerFor(panel, { auth: { check: async (request) => (request.headers.cookie === "session=1" ? "ada" : false) } });
    expect((await call(router, "GET", "/api/schema", { headers: { cookie: "session=1" } })).status).toBe(200);
  });

  it("throttles an address that keeps failing, and says when to come back", async () => {
    const { panel } = fixture();
    const clock = new ManualClock(0);
    const router = routerFor(panel, { auth: { token: TOKEN }, authThrottle: { failures: 3, windowMs: 60_000 }, clock });
    for (let i = 0; i < 3; i += 1) await call(router, "GET", "/api/schema", { address: "203.0.113.9" });
    const throttled = await call(router, "GET", "/api/schema", { address: "203.0.113.9", headers: bearer });
    expect(throttled.status).toBe(429);
    expect(throttled.headers["retry-after"]).toBe("60");
    expect((await call(router, "GET", "/api/schema", { address: "198.51.100.1", headers: bearer })).status).toBe(200);
    clock.advance(60_000);
    expect((await call(router, "GET", "/api/schema", { address: "203.0.113.9", headers: bearer })).status).toBe(200);
  });
});

describe("before credentials", () => {
  it("refuses a Host header a loopback listener was not addressed by, which is what DNS rebinding sends", async () => {
    const { panel } = fixture();
    const router = routerFor(panel);
    expect((await call(router, "GET", "/api/schema", { headers: { host: "attacker.example" } })).status).toBe(421);
    expect((await call(router, "GET", "/api/schema", { headers: { host: "localhost:9780" } })).status).toBe(200);
  });

  it("refuses a write from another site however it is authenticated", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { token: TOKEN }, controls: { edit: true } });
    const forged = await call(router, "POST", "/api/values/limit", { headers: { ...jsonWrite, origin: "https://attacker.example" }, body: '{"value":1}' });
    expect(forged.status).toBe(403);
    const crossSite = await call(router, "POST", "/api/values/limit", { headers: { ...jsonWrite, "sec-fetch-site": "cross-site" }, body: '{"value":1}' });
    expect(crossSite.status).toBe(403);
    const same = await call(router, "POST", "/api/values/limit", { headers: { ...jsonWrite, origin: "http://127.0.0.1:9780" }, body: '{"value":1}' });
    expect(same.status).toBe(200);
  });
});

describe("writes", () => {
  const edit = { auth: { token: TOKEN }, controls: { edit: true, actions: true } } as const;

  it("are refused with the option that grants them when the control is off", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { token: TOKEN } });
    const value = await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: '{"value":5}' });
    expect(value.status).toBe(403);
    expect(value.json.error).toMatch(/controls: \{ edit: true \}/);
    expect((await call(router, "POST", "/api/actions/flush", { headers: jsonWrite, body: "{}" })).json.error).toMatch(/controls: \{ actions: true \}/);
  });

  it("must be JSON, which an HTML form cannot send", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, edit);
    const form = await call(router, "POST", "/api/values/limit", { headers: { ...bearer, "content-type": "application/x-www-form-urlencoded" }, body: "value=5" });
    expect(form.status).toBe(415);
  });

  it("answer a malformed body, a missing value, a refused value and an unknown id each in their own words", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, edit);
    expect((await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: "{" })).status).toBe(400);
    expect((await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: "[]" })).json.error).toMatch(/JSON object/);
    expect((await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: "{}" })).json.error).toMatch(/"value"/);
    const refused = await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: '{"value":9000}' });
    expect(refused).toMatchObject({ status: 400, json: { error: "Limit must be at most 500" } });
    expect((await call(router, "POST", "/api/values/players", { headers: jsonWrite, body: '{"value":1}' })).status).toBe(403);
    expect((await call(router, "POST", "/api/values/ghost", { headers: jsonWrite, body: '{"value":1}' })).status).toBe(404);
    expect((await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: JSON.stringify({ value: "x".repeat(70_000) }) })).status).toBe(413);
  });

  it("are only accepted on the two write paths", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, edit);
    expect((await call(router, "POST", "/api/schema", { headers: jsonWrite, body: "{}" })).status).toBe(405);
    expect((await call(router, "GET", "/api/values/limit", { headers: bearer })).status).toBe(405);
    expect((await call(router, "DELETE", "/api/values/limit", { headers: bearer })).status).toBe(405);
  });

  it("run an action and report what it said", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, edit);
    const ran = await call(router, "POST", "/api/actions/flush", { headers: jsonWrite, body: "{}" });
    expect(ran.json).toEqual({ result: { message: "flushed" } });
  });
});

describe("a listener that shows some groups", () => {
  it("withholds the others on the server: from the schema, the state, the changes and the write paths", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { token: TOKEN }, controls: { edit: true }, groups: ["Game"] });
    const schema = (await call(router, "GET", "/api/schema", { headers: bearer })).json.schema;
    expect(schema.groups.map((group: { title: string }) => group.title)).toEqual(["Game"]);
    const state = (await call(router, "GET", "/api/state", { headers: bearer })).body;
    expect(state).not.toContain("secret");
    expect((await call(router, "POST", "/api/values/revenue-note", { headers: jsonWrite, body: '{"value":"x"}' })).status).toBe(404);
    panel.edit("revenue-note", "changed", "someone", { groups: undefined, edit: true, actions: true, restrictions: [] });
    expect((await call(router, "GET", "/api/changes", { headers: bearer })).json.changes).toEqual([]);
  });

  it("says so when it names a group nothing is declared in", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { groups: ["Gmae"] });
    await call(router, "GET", "/api/schema");
    expect(panel.notices().some((notice) => notice.message.includes('"Gmae"'))).toBe(true);
  });

  it("tells the page why modifiable values are read-only here", async () => {
    const { panel } = fixture();
    const schema = (await call(routerFor(panel), "GET", "/api/schema")).json.schema;
    expect(schema.controls).toEqual({ edit: false, actions: false });
    expect(schema.restrictions).toEqual([
      "Editing is switched off on this listener (controls.edit is not granted), so modifiable values are shown read-only.",
      "Actions are switched off on this listener (controls.actions is not granted), so their buttons are disabled.",
    ]);
  });
});

describe("state", () => {
  it("sends only what changed since a version, plus every live value", async () => {
    const { panel } = panelAt();
    const a = panel.viewable(1, "a");
    panel.viewable(2, "b");
    panel.viewable(() => 3, "c");
    const router = routerFor(panel);
    const first = (await call(router, "GET", "/api/state")).json.state;
    a.value = 10;
    const next = (await call(router, "GET", `/api/state?since=${first.version}`)).json.state;
    expect(next.values.map((value: { id: string }) => value.id)).toEqual(["a", "c"]);
    expect((await call(router, "GET", "/api/state?since=abc")).status).toBe(400);
  });
});
