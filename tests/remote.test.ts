/**
 * A remote panel narrowed to some of the upstream's groups, and its forwarded live stream, over
 * real sockets on both sides.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { listenPanel, remotePanelHandler } from "../src/adapters/index.js";
import { createAdminPanel } from "../src/index.js";
import { TOKEN } from "./helpers.js";

async function gateway(options: Omit<Parameters<typeof remotePanelHandler>[0], "token" | "auth">) {
  const handler = remotePanelHandler({ token: TOKEN, auth: { check: () => "ada" }, ...options });
  const server: Server = createServer((request, response) => handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function upstreamPanel() {
  const panel = createAdminPanel({ title: "Worker" });
  const sent = panel.viewable(1, { label: "Sent", group: "Mail", chart: true });
  panel.modifiable(10, { label: "Rate", group: "Mail" });
  panel.modifiable("hunter", { label: "Payroll note", group: "Finance" });
  panel.action("Pay", () => "paid", { group: "Finance" });
  const server = await listenPanel(panel, { port: 0, auth: { tokens: { gateway: TOKEN }, delegates: ["gateway"] }, controls: { edit: true, actions: true } });
  return { panel, sent, server };
}

describe("a remote panel narrowed to some groups", () => {
  it("shows, lists and accepts writes for those groups only, and never forwards the rest", async () => {
    const { panel, server } = await upstreamPanel();
    const remote = await gateway({ upstream: server.url, groups: ["Mail"], controls: { edit: true, actions: true } });
    const json = { "content-type": "application/json" };
    try {
      panel.edit("payroll-note", "raise", "ops", { groups: undefined, edit: true, actions: true, restrictions: [] });
      const schema = (await (await fetch(`${remote.url}/api/schema`)).json()) as { schema: { groups: Array<{ title: string }>; stream?: boolean } };
      expect(schema.schema.groups.map((group) => group.title)).toEqual(["Mail"]);
      expect(schema.schema.stream).toBe(true);
      const state = await (await fetch(`${remote.url}/api/state`)).text();
      expect(state).toContain('"rate"');
      expect(state).not.toContain("hunter");
      expect(state).not.toContain("raise");
      const changes = await (await fetch(`${remote.url}/api/changes`)).text();
      expect(changes).not.toContain("payroll");
      expect(await (await fetch(`${remote.url}/api/settings`)).json()).toEqual({ settings: { rate: 10 } });
      const page = await (await fetch(`${remote.url}/`)).text();
      expect(page).not.toContain("Payroll");
      expect((await fetch(`${remote.url}/api/values/rate`, { method: "POST", headers: json, body: '{"value":12}' })).status).toBe(200);
      expect((await fetch(`${remote.url}/api/values/payroll-note`, { method: "POST", headers: json, body: '{"value":"x"}' })).status).toBe(404);
      expect((await fetch(`${remote.url}/api/actions/pay`, { method: "POST", headers: json, body: "{}" })).status).toBe(404);
      expect((await fetch(`${remote.url}/api/settings/apply`, { method: "POST", headers: json, body: '{"settings":{"payroll-note":"x"}}' })).status).toBe(404);
      expect(panel.get("payroll-note")?.value).toBe("raise");
      expect(panel.get("rate")?.value).toBe(12);
      expect(() => remotePanelHandler({ upstream: server.url, token: TOKEN, auth: { check: () => "a" }, groups: [] })).toThrow(/show nothing/);
    } finally {
      await remote.close();
      await server.close();
      panel.close();
    }
  });

  it("forwards the upstream's live stream, filtered frame by frame", async () => {
    const { panel, sent, server } = await upstreamPanel();
    const remote = await gateway({ upstream: server.url, groups: ["Mail"] });
    const controller = new AbortController();
    try {
      const response = await fetch(`${remote.url}/api/stream`, { signal: controller.signal });
      expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let text = "";
      sent.value = 42;
      while (!/"value":42/.test(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      expect(text).toMatch(/^id: \d+\.\d+\.\d+$/m);
      expect(text).toContain('"sent"');
      expect(text).not.toContain("payroll");
      controller.abort();
      const off = await gateway({ upstream: server.url, stream: false });
      expect((await fetch(`${off.url}/api/stream`)).status).toBe(404);
      await off.close();
    } finally {
      controller.abort();
      await remote.close();
      await server.close();
      panel.close();
    }
  });
});

describe("a narrowed remote panel's cost", () => {
  it("answers a poll with one upstream request, and fetches the schema again when the structure changes", async () => {
    const { panel, server } = await upstreamPanel();
    const paths: string[] = [];
    const counting = (async (url: string, init?: RequestInit) => {
      paths.push(new URL(url).pathname);
      return fetch(url, init);
    }) as typeof fetch;
    const remote = await gateway({ upstream: server.url, groups: ["Mail"], fetch: counting });
    try {
      await fetch(`${remote.url}/api/schema`);
      paths.length = 0;
      await fetch(`${remote.url}/api/state`);
      await fetch(`${remote.url}/api/state`);
      expect(paths).toEqual(["/api/state", "/api/state"]);
      panel.modifiable(1, { label: "New", group: "Mail" });
      paths.length = 0;
      const state = await (await fetch(`${remote.url}/api/state`)).text();
      expect(paths).toEqual(["/api/state", "/api/schema"]);
      expect(state).toContain('"new"');
    } finally {
      await remote.close();
      await server.close();
      panel.close();
    }
  });
});
