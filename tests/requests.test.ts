/**
 * Who may write, before credentials: the origin a write came from (behind a proxy that rewrites
 * Host too), the anti-forgery token, and the headers the page is told to send.
 */
import { describe, expect, it } from "vitest";
import { AdminPanelConfigError } from "../src/index.js";
import { panelClient } from "../src/sdk.js";
import { checkCsrf, checkOriginOf, resolveCsrf, resolveHeaderSources, resolveOriginPolicy } from "../src/server/requests.js";
import { createRouter } from "../src/server/router.js";
import type { ServeOptions } from "../src/server/types.js";
import { call, jsonWrite, panelAt, routerFor, TOKEN } from "./helpers.js";

/** Mounted on somebody else's server, which answers to whatever Host its proxy writes. */
const mounted = (panel: ReturnType<typeof fixture>, options: ServeOptions) => createRouter(panel, options, { boundHost: undefined, where: "test" });

function fixture() {
  const { panel } = panelAt();
  panel.modifiable(1, { label: "Limit", group: "Game" });
  return panel;
}

const write = { "content-type": "application/json" };

describe("the origin of a write", () => {
  it("is compared with the Host header by default, and the refusal names what it expected and the options to set", async () => {
    const router = mounted(fixture(), { auth: { token: TOKEN }, controls: { edit: true } });
    const refused = await call(router, "POST", "/api/values/limit", { headers: { ...jsonWrite, host: "panel.internal:9780", origin: "https://admin.example.com" }, body: '{"value":2}' });
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ key: "refuseCrossSite", params: { origin: "https://admin.example.com", expected: "http://panel.internal:9780" } });
    expect(refused.json.error).toMatch(/allowedOrigins/);
    expect(refused.json.error).toMatch(/trustedProxies/);
    const same = await call(router, "POST", "/api/values/limit", { headers: { ...jsonWrite, host: "panel.internal:9780", origin: "http://panel.internal:9780" }, body: '{"value":2}' });
    expect(same.status).toBe(200);
  });

  it("accepts exactly allowedOrigins when they are set, whatever Host a proxy wrote", async () => {
    const router = mounted(fixture(), { auth: { token: TOKEN }, controls: { edit: true }, allowedOrigins: ["https://Admin.Example.com:443"] });
    const from = (origin: string) => call(router, "POST", "/api/values/limit", { headers: { ...jsonWrite, host: "panel.internal:9780", origin }, body: '{"value":2}' });
    expect((await from("https://admin.example.com")).status).toBe(200);
    expect((await from("http://admin.example.com")).status).toBe(403);
    expect((await from("https://evil.example")).json).toMatchObject({ key: "refuseCrossSite", params: { expected: "https://admin.example.com" } });
    // Allowed origins are the only ones: the Host header no longer counts.
    expect((await from("http://panel.internal:9780")).status).toBe(403);
  });

  it("believes X-Forwarded-Host and -Proto only from trustedProxies", async () => {
    const router = mounted(fixture(), { auth: { token: TOKEN }, controls: { edit: true }, trustedProxies: ["10.0.0.0/8"] });
    const forwarded = { ...jsonWrite, host: "panel.internal:9780", origin: "https://admin.example.com", "x-forwarded-host": "admin.example.com", "x-forwarded-proto": "https" };
    expect((await call(router, "POST", "/api/values/limit", { headers: forwarded, body: '{"value":2}', address: "10.0.0.5" })).status).toBe(200);
    // The same headers from anywhere else are anybody's to send.
    expect((await call(router, "POST", "/api/values/limit", { headers: forwarded, body: '{"value":2}', address: "203.0.113.9" })).status).toBe(403);
    // The proxy's own entry is the rightmost; one prepended further out does not count.
    const prepended = { ...forwarded, "x-forwarded-host": "admin.example.com, evil.example" };
    expect((await call(router, "POST", "/api/values/limit", { headers: prepended, body: '{"value":2}', address: "10.0.0.5" })).status).toBe(403);
    // The scheme counts when the proxy forwarded one.
    expect((await call(router, "POST", "/api/values/limit", { headers: { ...forwarded, origin: "http://admin.example.com" }, body: '{"value":2}', address: "10.0.0.5" })).status).toBe(403);
    // An IPv4-mapped peer address is the same proxy.
    expect((await call(router, "POST", "/api/values/limit", { headers: forwarded, body: '{"value":2}', address: "::ffff:10.0.0.5" })).status).toBe(200);
  });

  it("refuses a browser's cross-site write and an opaque or unreadable origin, and lets a client without Origin through on its credentials", () => {
    const policy = resolveOriginPolicy(undefined, undefined, "test");
    const at = (headers: Record<string, string>) => checkOriginOf({ headers: { host: "a.example", ...headers }, address: "1.2.3.4" }, policy).ok;
    expect(at({ "sec-fetch-site": "cross-site" })).toBe(false);
    expect(at({ "sec-fetch-site": "same-site", origin: "https://b.a.example" })).toBe(false);
    expect(at({ origin: "null" })).toBe(false);
    expect(at({ origin: "http://[" })).toBe(false);
    expect(at({})).toBe(true);
    expect(at({ "sec-fetch-site": "same-origin", origin: "https://a.example" })).toBe(true);
  });

  it("refuses an allowed origin that is not one and a proxy range that matches nothing, at start-up", () => {
    const panel = fixture();
    const start = (options: object) => () => routerFor(panel, { auth: { token: TOKEN }, ...options });
    expect(start({ allowedOrigins: [] })).toThrow(/allowedOrigins is empty/);
    expect(start({ allowedOrigins: ["admin.example.com"] })).toThrow(/not an origin/);
    expect(start({ allowedOrigins: ["https://admin.example.com/admin"] })).toThrow(/no path/);
    expect(start({ allowedOrigins: ["ftp://admin.example.com"] })).toThrow(AdminPanelConfigError);
    expect(start({ trustedProxies: ["10.0.0.0/33"] })).toThrow(/not addresses or CIDRs: 10.0.0.0\/33/);
    expect(start({ trustedProxies: [] })).toThrow(/trustedProxies is empty/);
  });
});

describe("the anti-forgery token", () => {
  const cookieAuth = { check: () => "ada" };

  it("is required on a write when the double-submit cookie is configured, and must match it", async () => {
    const router = routerFor(fixture(), { auth: cookieAuth, controls: { edit: true }, csrf: { header: "X-CSRF-Token", cookie: "csrf" } });
    const send = (headers: Record<string, string>) => call(router, "POST", "/api/values/limit", { headers: { ...write, ...headers }, body: '{"value":2}' });
    const missing = await send({ cookie: "csrf=abc123" });
    expect(missing.status).toBe(403);
    expect(missing.json).toMatchObject({ key: "refuseCsrf", params: { header: "x-csrf-token" } });
    expect((await send({ cookie: "csrf=abc123", "x-csrf-token": "abc124" })).status).toBe(403);
    expect((await send({ "x-csrf-token": "abc123" })).status).toBe(403);
    expect((await send({ cookie: "other=1; csrf=abc123", "x-csrf-token": "abc123" })).status).toBe(200);
    // Reading needs no token.
    expect((await call(router, "GET", "/api/schema")).status).toBe(200);
  });

  it("exempts a request with a bearer token, which no browser attaches by itself", async () => {
    const router = routerFor(fixture(), { auth: { token: TOKEN }, controls: { edit: true }, csrf: { header: "x-csrf-token", cookie: "csrf" } });
    expect((await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: '{"value":2}' })).status).toBe(200);
  });

  it("asks verify, and treats a verify that throws as a refusal", async () => {
    const seen: string[] = [];
    const csrf = resolveCsrf({ header: "x-token", verify: (token, request) => (seen.push(`${request.method} ${token}`), token === "good") }, "test");
    if (csrf === undefined) throw new Error("expected a check");
    const request = (token?: string) => ({ method: "POST", path: "/api/values/x", headers: token === undefined ? {} : { "x-token": token }, address: "1.2.3.4" });
    expect(await checkCsrf(csrf, request("good"))).toBe(true);
    expect(await checkCsrf(csrf, request("bad"))).toBe(false);
    expect(await checkCsrf(csrf, request())).toBe(false);
    expect(seen).toEqual(["POST good", "POST bad"]);
    const throwing = resolveCsrf({ header: "x-token", verify: () => { throw new Error("down"); } }, "test");
    expect(await checkCsrf(throwing as NonNullable<typeof throwing>, request("good"))).toBe(false);
  });

  it("refuses a configuration that would not check anything", () => {
    expect(() => resolveCsrf({ header: "x-token" }, "test")).toThrow(/exactly one of cookie/);
    expect(() => resolveCsrf({ header: "x-token", cookie: "c", verify: () => true }, "test")).toThrow(/exactly one of cookie/);
    expect(() => resolveCsrf({ header: "cookie", cookie: "c" }, "test")).toThrow(/a page cannot set/);
    expect(() => resolveCsrf({ header: "x-token", cookie: "bad name" }, "test")).toThrow(/not a cookie name/);
    expect(() => resolveCsrf({ header: "x-token", cokie: "c" } as never, "test")).toThrow(/no option "cokie"/);
  });
});

describe("the headers the page sends", () => {
  it("travel in the schema, the anti-forgery cookie's among them", async () => {
    const router = routerFor(fixture(), {
      auth: { check: () => "ada" },
      csrf: { header: "x-csrf-token", cookie: "csrf" },
      requestHeaders: { "X-Tenant": "acme", "x-request-token": { meta: "request-token" }, "x-session": { cookie: "sid" } },
    });
    const schema = (await call(router, "GET", "/api/schema")).json.schema;
    expect(schema.requestHeaders).toEqual([
      { name: "x-tenant", value: "acme" },
      { name: "x-request-token", meta: "request-token" },
      { name: "x-session", cookie: "sid" },
      { name: "x-csrf-token", cookie: "csrf" },
    ]);
    // The rendered page carries the same, in its bootstrap.
    expect((await call(router, "GET", "/")).body).toContain('"requestHeaders":[{"name":"x-tenant","value":"acme"}');
  });

  it("are absent from the schema when none are configured", async () => {
    expect((await call(routerFor(fixture()), "GET", "/api/schema")).json.schema.requestHeaders).toBeUndefined();
  });

  it("refuse names a page cannot set, duplicates, and sources that are not one", () => {
    const sources = (headers: object) => () => resolveHeaderSources(headers as never, undefined, "test");
    for (const name of ["Cookie", "host", "Sec-Fetch-Site", "proxy-authorization", "x-apb-on-behalf-of", "content-type", "bad name", ""]) expect(sources({ [name]: "v" }), name).toThrow(AdminPanelConfigError);
    expect(sources({ "x-a": "v", "X-A": "w" })).toThrow(/twice/);
    expect(sources({ "x-a": "line\nbreak" })).toThrow(/not a header value/);
    expect(sources({ "x-a": { cookie: "bad name" } })).toThrow(/not a cookie name/);
    expect(sources({ "x-a": { meta: "<script>" } })).toThrow(/not a <meta name>/);
    expect(sources({ "x-a": { cookie: "a", meta: "b" } })).toThrow(/a fixed value/);
    expect(sources({ "x-a": 42 })).toThrow(/a fixed value/);
    // An explicitly configured header wins over the one the anti-forgery cookie would add.
    const csrf = resolveCsrf({ header: "x-csrf", cookie: "csrf" }, "test");
    expect(resolveHeaderSources({ "x-csrf": { meta: "csrf" } }, csrf, "test")).toEqual([{ name: "x-csrf", meta: "csrf" }]);
  });
});

describe("headers for a panel behind a gateway", () => {
  it("are sent by the typed client, which refuses ones it sets itself", async () => {
    const seen: Array<Record<string, string>> = [];
    const client = panelClient({
      url: "http://panel.test",
      token: TOKEN,
      headers: { "X-Gateway-Key": "k1" },
      fetch: (async (_url: string, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>);
        return new Response(JSON.stringify({ notices: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    await client.notices();
    expect(seen[0]).toMatchObject({ "x-gateway-key": "k1", authorization: `Bearer ${TOKEN}` });
    expect(() => panelClient({ url: "http://panel.test", headers: { Authorization: "x" } })).toThrow(/cannot set "Authorization"/);
    expect(() => panelClient({ url: "http://panel.test", headers: { "x-a": "b\r\nc" } })).toThrow(/line breaks/);
  });
});
