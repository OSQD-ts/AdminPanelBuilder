import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { fastifyPanel, koaPanel, listenPanel, remotePanelHandler } from "../src/adapters/index.js";
import { duration, main } from "../src/cli.js";
import { createAdminPanel, type NodeLikeRequest, type NodeLikeResponse } from "../src/index.js";
import { bearer, call, panelAt, routerFor, TOKEN } from "./helpers.js";

describe("the live stream", () => {
  it("sends a state frame at once, then one when something changes", async () => {
    const { panel } = panelAt();
    const players = panel.viewable(1, "Players");
    const router = routerFor(panel);
    const response = await router.route({ method: "GET", url: "/api/stream", headers: { host: "127.0.0.1" }, address: "127.0.0.1", body: async () => "" });
    expect(response.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    const chunks: string[] = [];
    const stop = response.stream?.start({ send: (text) => chunks.push(text), ready: () => true, close: () => undefined });
    expect(chunks.join("")).toMatch(/event: state\ndata: \{.*"players".*\}\n\n/s);
    chunks.length = 0;
    players.value = 2;
    await vi.waitFor(() => expect(chunks.join("")).toContain('"value":2'), { timeout: 2000 });
    stop?.();
  });

  it("skips frames for a viewer still sending the last one, and says how many", async () => {
    const { panel } = panelAt();
    const players = panel.viewable(1, "Players");
    const response = await routerFor(panel).route({ method: "GET", url: "/api/stream", headers: { host: "127.0.0.1" }, address: "127.0.0.1", body: async () => "" });
    let ready = false;
    const chunks: string[] = [];
    const stop = response.stream?.start({ send: (text) => chunks.push(text), ready: () => ready, close: () => undefined });
    players.value = 5;
    await new Promise((resolve) => setTimeout(resolve, 700));
    ready = true;
    await vi.waitFor(() => expect(chunks.join("")).toMatch(/event: thinned\ndata: \{"skipped":\d+\}/), { timeout: 2000 });
    stop?.();
  });

  it("turns away viewers past its limit, and is absent when switched off", async () => {
    const { panel } = panelAt();
    const router = routerFor(panel, { stream: { maxViewers: 1 } });
    const request = { method: "GET", url: "/api/stream", headers: { host: "127.0.0.1" }, address: "127.0.0.1", body: async () => "" };
    const first = await router.route(request);
    const stop = first.stream?.start({ send: () => undefined, ready: () => true, close: () => undefined });
    expect((await router.route(request)).status).toBe(503);
    stop?.();
    expect((await call(routerFor(panel, { stream: false }), "GET", "/api/stream")).status).toBe(404);
    expect((await call(routerFor(panel), "GET", "/api/schema")).json.schema.stream).toBe(true);
  });

  it("streams over a real socket", async () => {
    const panel = createAdminPanel();
    panel.viewable(7, "Seven");
    const server = await listenPanel(panel, { port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${server.url}api/stream`, { signal: controller.signal });
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      let text = "";
      while (!text.includes("event: state")) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain('"seven"');
    } finally {
      controller.abort();
      await server.close();
    }
  });
});

describe("Prometheus metrics", () => {
  it("expose numeric values as gauges, counters as counters, and the change totals from the first scrape", async () => {
    const { panel } = panelAt();
    panel.viewable(12, { label: 'Players "online"\nnow', group: "Games" });
    panel.viewable("text", "Not a number");
    panel.modifiable("secret", { label: "Key", sensitive: true });
    panel.counter("Hits").inc(3);
    const router = routerFor(panel, { auth: { token: TOKEN }, metrics: { prefix: "ch3ss" } });
    const response = await call(router, "GET", "/metrics", { headers: bearer });
    expect(response.headers["content-type"]).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(response.body).toContain('ch3ss_value{id="players-online-now",label="Players \\"online\\"\\nnow",group="Games"} 12');
    expect(response.body).toContain('ch3ss_count_total{id="hits",label="Hits",group="General"} 3');
    expect(response.body).toContain('ch3ss_changes_total{kind="edit",ok="true"} 0');
    expect(response.body).not.toContain("secret");
    expect(response.body).toContain("# TYPE ch3ss_value gauge");
    expect((await call(routerFor(panel, { auth: { token: TOKEN } }), "GET", "/metrics", { headers: bearer })).status).toBe(404);
    expect(() => routerFor(panel, { metrics: { prefix: "bad-name" } })).toThrow(/not a Prometheus name/);
    panel.close();
  });
});

function nodeDouble(method: string, url: string, headers: Record<string, string> = {}, body?: object): NodeLikeRequest {
  const request = new EventEmitter() as EventEmitter & NodeLikeRequest;
  Object.assign(request, { method, url, headers: { host: "127.0.0.1", ...headers }, socket: { remoteAddress: "127.0.0.1" } });
  if (body !== undefined) request.body = body;
  else request.on("newListener", (event: string) => event === "end" && queueMicrotask(() => request.emit("end")));
  return request;
}

function responseDouble(): NodeLikeResponse & { done: Promise<void>; text: string; headers: Record<string, string> } {
  let finish: () => void = () => undefined;
  const response = {
    statusCode: 200,
    headersSent: false,
    text: "",
    headers: {} as Record<string, string>,
    done: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    setHeader(name: string, value: string) {
      response.headers[name] = value;
    },
    end(body?: string) {
      response.text = body ?? "";
      response.headersSent = true;
      finish();
    },
  };
  return response;
}

describe("the Koa adapter", () => {
  it("answers under its base path and passes everything else on", async () => {
    const { panel } = panelAt();
    panel.modifiable(1, "a");
    const middleware = koaPanel(panel, { basePath: "/admin", auth: { token: TOKEN }, controls: { edit: true } });
    const res = responseDouble();
    const context = { path: "/admin/api/values/a", req: nodeDouble("POST", "/admin/api/values/a", { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }), res, request: { body: { value: 5 } }, respond: true };
    await middleware(context, async () => undefined);
    expect(context.respond).toBe(false);
    expect(panel.get("a")?.value).toBe(5);
    let passed = false;
    await middleware({ path: "/shop", req: nodeDouble("GET", "/shop"), res: responseDouble() }, async () => {
      passed = true;
    });
    expect(passed).toBe(true);
  });
});

describe("the Fastify adapter", () => {
  it("hijacks the reply and answers on the raw response with the parsed body", async () => {
    const { panel } = panelAt();
    panel.modifiable(1, "a");
    const handler = fastifyPanel(panel, { basePath: "/admin", auth: { token: TOKEN }, controls: { edit: true } });
    const raw = responseDouble();
    let hijacked = false;
    handler({ raw: nodeDouble("POST", "/admin/api/values/a", { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }), body: { value: 9 } }, { raw, hijack: () => (hijacked = true) });
    await raw.done;
    expect(hijacked).toBe(true);
    expect(panel.get("a")?.value).toBe(9);
  });
});

describe("a remote panel", () => {
  it("renders the upstream's panel here, forwards writes with its token and the operator's name", async () => {
    const upstream = createAdminPanel({ title: "Worker" });
    upstream.modifiable(1, "Limit");
    const server = await listenPanel(upstream, { port: 0, auth: { tokens: { gateway: TOKEN }, delegates: ["gateway"] }, controls: { edit: true } });
    try {
      const handler = remotePanelHandler({ upstream: server.url, token: TOKEN, basePath: "/workers/one", auth: { check: () => "ada" }, controls: { edit: true } });
      const page = responseDouble();
      handler(nodeDouble("GET", "/workers/one/"), page);
      await page.done;
      expect(page.text).toContain('"title":"Worker"');
      expect(page.text).toContain('data-api="/workers/one"');
      expect(page.text).not.toContain(TOKEN);
      const write = responseDouble();
      handler(nodeDouble("POST", "/workers/one/api/values/limit", { "content-type": "application/json" }, { value: 4 }), write);
      await write.done;
      expect(write.statusCode).toBe(200);
      expect(upstream.changes().at(-1)?.by).toBe("ada via gateway");
      const readOnly = remotePanelHandler({ upstream: server.url, token: TOKEN, auth: { check: () => "sam" } });
      const refused = responseDouble();
      readOnly(nodeDouble("POST", "/api/values/limit", { "content-type": "application/json" }, { value: 5 }), refused);
      await refused.done;
      expect(refused.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });
});

describe("the command line", () => {
  async function run(argv: string[], fetcher: typeof fetch = fetch, env: Record<string, string> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, { out: (line) => out.push(line), err: (line) => err.push(line), env, fetch: fetcher });
    return { code, out, err };
  }

  it("reads, sets and runs against a real panel, with the token from the environment", async () => {
    const panel = createAdminPanel();
    panel.modifiable(10, { label: "Limit", max: 100 });
    panel.action("Flush", () => "Flushed.");
    const server = await listenPanel(panel, { port: 0, auth: { token: TOKEN }, controls: { edit: true, actions: true } });
    const env = { PANEL_TOKEN: TOKEN };
    try {
      expect(await run(["get", server.url], fetch, env)).toMatchObject({ code: 0, out: ["General\tlimit\t10"] });
      expect(await run(["get", server.url, "limit"], fetch, env)).toMatchObject({ code: 0, out: ["10"] });
      expect(await run(["set", server.url, "limit", "42", "--for", "10m"], fetch, env)).toMatchObject({ code: 0, out: ["42"] });
      expect(panel.state().values[0]?.revertAt).toBeDefined();
      const refused = await run(["set", server.url, "limit", "500"], fetch, env);
      expect(refused.code).toBe(1);
      expect(refused.err[0]).toMatch(/Limit must be at most 100 \(400\)/);
      expect(await run(["run", server.url, "flush"], fetch, env)).toMatchObject({ code: 0, out: ["Flushed."] });
      expect((await run(["changes", server.url, "--json"], fetch, env)).out.join("")).toContain('"changes"');
    } finally {
      panel.close();
      await server.close();
    }
  });

  it("refuses bad arguments with exit code 2 and unknown commands with 1, on stderr", async () => {
    expect((await run(["get"])).code).toBe(2);
    expect((await run(["frobnicate", "http://x"])).code).toBe(1);
    const bad = await run(["set", "http://x", "a", "1", "--for", "soon"]);
    expect(bad.code).toBe(2);
    expect(bad.err[0]).toMatch(/--for takes a time like 30s/);
    expect((await run(["--nope"])).code).toBe(2);
    expect((await run(["--version"])).out[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("reads durations exactly", () => {
    expect([duration("30s"), duration("10m"), duration("2h"), duration("1d")]).toEqual([30_000, 600_000, 7_200_000, 86_400_000]);
  });
});

describe("the command line, against refusals and shapes", () => {
  it("applies profiles, proposes approval values, answers JSON, and says what is missing", async () => {
    const panel = createAdminPanel();
    const flag = panel.modifiable(false, "Flag");
    panel.modifiable(1, { label: "Guarded", approval: true });
    panel.profile("On", [[flag, true]]);
    panel.viewable("secret", { label: "Key", sensitive: true });
    const server = await listenPanel(panel, { port: 0, auth: { token: TOKEN }, controls: { edit: true } });
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (line: string) => out.push(line), err: (line: string) => err.push(line), env: { PANEL_TOKEN: TOKEN }, fetch };
    try {
      expect(await main(["apply", server.url, "on"], io)).toBe(0);
      expect(flag.value).toBe(true);
      expect(await main(["set", server.url, "guarded", "5"], io)).toBe(0);
      expect(err.at(-1)).toMatch(/proposed/);
      expect(await main(["get", server.url, "key"], io)).toBe(0);
      expect(out.at(-1)).toBe("(hidden)");
      expect(await main(["get", server.url, "ghost"], io)).toBe(1);
      expect(await main(["get", server.url, "--json"], io)).toBe(0);
      expect(JSON.parse(out.at(-1) as string).values.length).toBeGreaterThan(0);
      expect(await main(["set", server.url, "flag", "maybe"], io)).toBe(1);
      expect(await main(["run", server.url], io)).toBe(2);
      expect(await main(["apply", server.url], io)).toBe(2);
      expect(await main(["set", server.url, "flag", "true", "--token=wrong-token-0123456789"], { ...io, env: {} })).toBe(1);
      expect(await main(["run", server.url, "nope", "--input", "novalue"], io)).toBe(2);
    } finally {
      panel.close();
      await server.close();
    }
  });

  it("says an unreachable panel is unreachable, with exit code 2", async () => {
    const err: string[] = [];
    const code = await main(["get", "http://127.0.0.1:1"], { out: () => undefined, err: (line) => err.push(line), env: {}, fetch });
    expect(code).toBe(2);
    expect(err[0]).toMatch(/could not be reached/);
  });
});

describe("the Fetch adapter, streaming and not", () => {
  it("streams server-sent events through a ReadableStream, and answers HEAD without a body", async () => {
    const { panel } = panelAt();
    panel.viewable(3, "Three");
    const handle = panel.fetchHandler({ address: () => "127.0.0.1" });
    const controller = new AbortController();
    const stream = await handle(new Request("http://127.0.0.1/api/stream", { signal: controller.signal }));
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    let text = "";
    while (!text.includes("event: state")) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('"three"');
    await reader.cancel();
    controller.abort();
    const head = await handle(new Request("http://127.0.0.1/api/schema", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});

describe("a remote panel's other paths", () => {
  it("forwards reads, refuses what it must, and says when the upstream is gone", async () => {
    const upstream = createAdminPanel({ title: "Worker" });
    upstream.viewable(5, "Five");
    upstream.action("Go", () => "went");
    const server = await listenPanel(upstream, { port: 0, auth: { token: TOKEN }, controls: { actions: true } });
    try {
      const handler = remotePanelHandler({ upstream: server.url, token: TOKEN, auth: { check: (request) => (request.headers.cookie === "ok" ? "ada" : false) }, controls: { actions: true } });
      const forward = async (method: string, url: string, headers: Record<string, string> = { cookie: "ok" }, body?: object) => {
        const response = responseDouble();
        handler(nodeDouble(method, url, headers, body), response);
        await response.done;
        return response;
      };
      expect((await forward("GET", "/api/schema")).text).toContain('"edit":false');
      expect((await forward("GET", "/api/state")).text).toContain('"five"');
      expect((await forward("GET", "/client.js")).statusCode).toBe(200);
      expect((await forward("GET", "/api/state", {})).statusCode).toBe(401);
      expect((await forward("GET", "/elsewhere")).statusCode).toBe(404);
      expect((await forward("POST", "/api/actions/go", { cookie: "ok", "content-type": "text/plain" }, {})).statusCode).toBe(415);
      expect((await forward("POST", "/api/actions/go", { cookie: "ok", "content-type": "application/json", origin: "https://evil.example", host: "127.0.0.1" }, {})).statusCode).toBe(403);
      expect((await forward("POST", "/api/actions/go", { cookie: "ok", "content-type": "application/json" }, {})).text).toContain("went");
      expect((await forward("POST", "/api/values/five", { cookie: "ok", "content-type": "application/json" }, { value: 1 })).statusCode).toBe(403);
    } finally {
      await server.close();
    }
    const gone = remotePanelHandler({ upstream: "http://127.0.0.1:1", token: TOKEN, auth: { check: () => "ada" } });
    const response = responseDouble();
    gone(nodeDouble("GET", "/api/state"), response);
    await response.done;
    expect(response.statusCode).toBe(502);
    expect(() => remotePanelHandler({ upstream: "nope", token: TOKEN, auth: { check: () => "a" } })).toThrow(/upstream/);
  });
});
