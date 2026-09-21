/**
 * The front ends: each is a translation of the router, so these check the translation — the
 * request reaches the router whole, the answer comes back whole — against hand-built doubles.
 * Each adapter declares the shape it needs structurally, so a double that satisfies it is the
 * contract, and testing through a real framework would test the framework.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createFetchHandler, createPanelHandler, listenPanel } from "../src/adapters/index.js";
import type { NodeLikeRequest, NodeLikeResponse } from "../src/index.js";
import { panelAt, TOKEN } from "./helpers.js";

function nodeRequest(method: string, url: string, headers: Record<string, string>, body?: string | object): NodeLikeRequest {
  const emitter = new EventEmitter() as EventEmitter & NodeLikeRequest;
  Object.assign(emitter, { method, url, headers: { host: "127.0.0.1", ...headers }, socket: { remoteAddress: "127.0.0.1" } });
  if (typeof body === "object") {
    emitter.body = body;
    return emitter;
  }
  // Like a real IncomingMessage, the stream is paused until somebody listens for its end: the
  // router authenticates before it reads, so the body must still be there when it does.
  emitter.on("newListener", (event: string) => {
    if (event !== "end") return;
    queueMicrotask(() => {
      if (body !== undefined) emitter.emit("data", Buffer.from(body));
      emitter.emit("end");
    });
  });
  return emitter;
}

function nodeResponse(): NodeLikeResponse & { done: Promise<void>; headers: Record<string, string>; text: string } {
  let finish: () => void = () => undefined;
  const response = {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    text: "",
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

function panelWithLimit() {
  const { panel } = panelAt();
  const limit = panel.modifiable(10, { label: "Limit", min: 0, max: 100 });
  return { panel, limit };
}

describe("the Node handler", () => {
  it("reads a streamed body and answers through the response it was given", async () => {
    const { panel, limit } = panelWithLimit();
    const handler = createPanelHandler(panel, { auth: { token: TOKEN }, controls: { edit: true } });
    const response = nodeResponse();
    handler(nodeRequest("POST", "/api/values/limit", { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, '{"value":42}'), response);
    await response.done;
    expect(response.statusCode).toBe(200);
    expect(limit.value).toBe(42);
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });

  it("uses a body express.json() already parsed, since the stream is spent", async () => {
    const { panel, limit } = panelWithLimit();
    const handler = createPanelHandler(panel, { auth: { token: TOKEN }, controls: { edit: true } });
    const response = nodeResponse();
    handler(nodeRequest("POST", "/api/values/limit", { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, { value: 7 }), response);
    await response.done;
    expect(limit.value).toBe(7);
  });

  it("routes by Express's originalUrl when mounted under a prefix", async () => {
    const { panel } = panelWithLimit();
    const handler = createPanelHandler(panel, { basePath: "/admin" });
    const request = nodeRequest("GET", "/api/schema", {});
    request.originalUrl = "/admin/api/schema";
    const response = nodeResponse();
    handler(request, response);
    await response.done;
    expect(JSON.parse(response.text).schema.groups).toHaveLength(1);
  });

  it("sends headers and no body for HEAD", async () => {
    const { panel } = panelWithLimit();
    const response = nodeResponse();
    createPanelHandler(panel)(nodeRequest("HEAD", "/api/schema", {}), response);
    await response.done;
    expect(response.statusCode).toBe(200);
    expect(response.text).toBe("");
  });
});

describe("the Fetch handler", () => {
  it("answers a Request with a Response carrying the router's status, headers and body", async () => {
    const { panel, limit } = panelWithLimit();
    const handler = createFetchHandler(panel, { auth: { token: TOKEN }, controls: { edit: true }, basePath: "/admin" });
    const response = await handler(
      new Request("http://127.0.0.1/admin/api/values/limit", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: '{"value":3}' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(limit.value).toBe(3);
  });

  it("refuses a declared body past the limit before reading it", async () => {
    const { panel } = panelWithLimit();
    const handler = createFetchHandler(panel, { auth: { token: TOKEN }, controls: { edit: true } });
    const response = await handler(
      new Request("http://127.0.0.1/api/values/limit", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "content-length": "999999" }, body: "{}" }),
    );
    expect(response.status).toBe(413);
  });
});

describe("a listener of its own", () => {
  it("serves on a real socket and stops when closed", async () => {
    const { panel } = panelWithLimit();
    const server = await listenPanel(panel, { port: 0 });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const response = await fetch(`${server.url}api/schema`);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { schema: { title: string } }).schema.title).toBe("Admin panel");
    } finally {
      await server.close();
    }
  });

  it("refuses a port that is not a port, before binding anything", async () => {
    const { panel } = panelWithLimit();
    await expect(listenPanel(panel, { port: 70_000 })).rejects.toThrow(/port 70000 is not a TCP port/);
  });

  it("refuses to listen beyond loopback without auth", async () => {
    const { panel } = panelWithLimit();
    await expect(panel.listen({ host: "0.0.0.0", port: 0 })).rejects.toThrow(/without auth would show this application's state/);
  });
});
