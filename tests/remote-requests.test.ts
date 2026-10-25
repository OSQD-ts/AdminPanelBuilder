/**
 * A remote panel's own origin, anti-forgery and header rules, and the headers it sends upstream;
 * the listener file's origin settings; and the page's header resolver.
 */
import { request as httpRequest, createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { listenPanel, remotePanelHandler } from "../src/adapters/index.js";
import { type HeaderDocument, headerResolver } from "../src/client/headers.js";
import { ConfigError, listenOptions, loadConfig, RELOADABLE } from "../src/config/index.js";
import { createAdminPanel } from "../src/index.js";
import { TOKEN } from "./helpers.js";

async function serve(handler: (request: never, response: never) => void) {
  const server: Server = createServer((request, response) => handler(request as never, response as never));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** A raw request, so headers a fetch implementation might rewrite (Origin, Host) go as written. */
function post(port: number, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("a remote panel", () => {
  it("checks a write's origin and token itself, says its own page headers, and sends its gateway headers upstream", async () => {
    const panel = createAdminPanel({ title: "Worker" });
    panel.modifiable(10, { label: "Rate", group: "Mail" });
    const upstream = await listenPanel(panel, { port: 0, auth: { tokens: { gateway: TOKEN }, delegates: ["gateway"] }, controls: { edit: true }, requestHeaders: { "x-upstream-only": "u" } });
    const sentUpstream: Array<Record<string, string>> = [];
    const handler = remotePanelHandler({
      upstream: upstream.url,
      token: TOKEN,
      auth: { check: () => "ada" },
      controls: { edit: true },
      allowedOrigins: ["https://ops.example.com"],
      csrf: { header: "x-csrf", cookie: "csrf" },
      upstreamHeaders: { "X-Gateway-Key": "g1" },
      fetch: ((url: string, init: RequestInit = {}) => {
        sentUpstream.push(init.headers as Record<string, string>);
        return fetch(url, init);
      }) as typeof fetch,
    });
    const remote = await serve(handler as never);
    try {
      const schema = (await (await fetch(`${remote.url}/api/schema`)).json()) as { schema: { requestHeaders?: unknown } };
      // The page talks to this handler: the upstream's own page headers are not its business.
      expect(schema.schema.requestHeaders).toEqual([{ name: "x-csrf", cookie: "csrf" }]);
      expect(sentUpstream.every((headers) => headers["x-gateway-key"] === "g1" && headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
      const ok = { origin: "https://ops.example.com", cookie: "csrf=t1", "x-csrf": "t1" };
      expect((await post(remote.port, "/api/values/rate", ok, '{"value":12}')).status).toBe(200);
      const wrongOrigin = await post(remote.port, "/api/values/rate", { ...ok, origin: "https://evil.example" }, '{"value":13}');
      expect(wrongOrigin.status).toBe(403);
      expect(wrongOrigin.text).toContain("allowedOrigins");
      // A malformed origin is a refusal, not a failure of the handler.
      expect((await post(remote.port, "/api/values/rate", { ...ok, origin: "%%" }, '{"value":13}')).status).toBe(403);
      expect((await post(remote.port, "/api/values/rate", { ...ok, "x-csrf": "nope" }, '{"value":13}')).status).toBe(403);
      expect(panel.get("rate")?.value).toBe(12);
      expect(() => remotePanelHandler({ upstream: upstream.url, token: TOKEN, auth: { check: () => "a" }, upstreamHeaders: { authorization: "x" } })).toThrow(/sets it itself/);
      expect(() => remotePanelHandler({ upstream: upstream.url, token: TOKEN, auth: { check: () => "a" }, upstreamHeaders: { "x-apb-on-behalf-of": "x" } })).toThrow(/cannot set/);
    } finally {
      await remote.close();
      await upstream.close();
      panel.close();
    }
  });
});

describe("the listener file", () => {
  it("reads allowed_origins and trusted_proxies, applies them without a restart, and refuses ones that are not", async () => {
    const config = await loadConfig({ text: '[listen]\nallowed_origins = ["https://admin.example.com"]\ntrusted_proxies = ["10.0.0.0/8", "fd00::/8"]\n', env: {} });
    expect(listenOptions(config)).toMatchObject({ allowedOrigins: ["https://admin.example.com"], trustedProxies: ["10.0.0.0/8", "fd00::/8"] });
    expect(listenOptions(await loadConfig({ text: "", env: {} }))).not.toHaveProperty("allowedOrigins");
    expect(RELOADABLE).toContain("listen.allowed_origins");
    expect(RELOADABLE).toContain("listen.trusted_proxies");
    await expect(loadConfig({ text: '[listen]\nallowed_origins = ["admin.example.com"]\n', env: {} })).rejects.toThrow(ConfigError);
    await expect(loadConfig({ text: '[listen]\ntrusted_proxies = ["10.0.0.0/40"]\n', env: {} })).rejects.toThrow(/trusted_proxies contains entries/);
  });
});

describe("the page's request headers", () => {
  const doc = (cookie: string, metas: Record<string, string>) =>
    ({ cookie, querySelector: (selector: string) => {
      const name = /meta\[name="([^"]+)"\]/.exec(selector)?.[1];
      return name !== undefined && name in metas ? { content: metas[name] } : null;
    } }) as HeaderDocument;

  it("reads each source when a request is sent, and adds the host page's own", () => {
    const page = doc("a=1; csrf=tok%20en", { "request-token": "m1" });
    let host: Record<string, string> = { "X-Host": "h1" };
    const headers = headerResolver(page, () => [{ name: "x-fixed", value: "v" }, { name: "x-csrf", cookie: "csrf" }, { name: "x-meta", meta: "request-token" }, { name: "x-missing", cookie: "nope" }], () => () => host);
    expect(headers()).toEqual({ "x-fixed": "v", "x-csrf": "tok en", "x-meta": "m1", "x-host": "h1" });
    host = { "X-Host": "h2" };
    expect(headers()["x-host"]).toBe("h2");
  });

  it("drops, with one warning each, names a page cannot set and values that are not one line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const headers = headerResolver(doc("", {}), () => undefined, () => ({ Cookie: "x", "x-ok": "y", "x-bad": "a\nb", "bad name": "z" }));
    expect(headers()).toEqual({ "x-ok": "y" });
    headers();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
