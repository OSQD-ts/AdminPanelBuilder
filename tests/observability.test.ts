/** OpenTelemetry metrics and logs, syslog, and the opt-in health endpoint. */
import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { otelLogSink, otelMetrics, syslogSink } from "../src/index.js";
import { EVERYTHING } from "../src/testing.js";
import { call, panelAt, routerFor, TOKEN } from "./helpers.js";

function fakeMeter() {
  const instruments = new Map<string, { kind: string; callbacks: Set<(result: { observe(value: number, attributes?: Record<string, unknown>): void }) => void> }>();
  const create = (kind: string) => (name: string) => {
    const instrument = { kind, callbacks: new Set<(result: { observe(value: number, attributes?: Record<string, unknown>): void }) => void>() };
    instruments.set(name, instrument);
    return { addCallback: (callback: never) => instrument.callbacks.add(callback), removeCallback: (callback: never) => instrument.callbacks.delete(callback) };
  };
  const collect = () => {
    const seen: Record<string, Array<[number, Record<string, unknown> | undefined]>> = {};
    for (const [name, instrument] of instruments) {
      seen[name] = [];
      for (const callback of instrument.callbacks) callback({ observe: (value, attributes) => seen[name]?.push([value, attributes]) });
    }
    return seen;
  };
  return { meter: { createObservableGauge: create("gauge"), createObservableCounter: create("counter") }, instruments, collect };
}

describe("OpenTelemetry metrics", () => {
  it("observe the same series as /metrics when collected, leave out sensitive values and withheld groups, and stop", () => {
    const { panel } = panelAt();
    panel.viewable(7, { label: "Players", group: "Games" });
    panel.viewable(3, { label: "Revenue", group: "Finance" });
    panel.viewable(42, { label: "Secret", group: "Games", sensitive: true });
    panel.counter("Requests", { group: "Games" }).inc();
    panel.modifiable(1, "Level");
    panel.edit("level", 2, "ada", EVERYTHING);
    const { meter, collect, instruments } = fakeMeter();
    const stop = otelMetrics(panel, { getMeter: () => meter as never }, { prefix: "game", groups: ["Games"] });
    const seen = collect();
    expect(seen["game.value"]).toContainEqual([7, { id: "players", label: "Players", group: "Games" }]);
    expect((seen["game.value"] ?? []).map(([, attributes]) => attributes?.id)).not.toContain("secret");
    expect((seen["game.value"] ?? []).map(([, attributes]) => attributes?.group)).not.toContain("Finance");
    expect(seen["game.count"]).toEqual([[1, { id: "requests", label: "Requests", group: "Games" }]]);
    expect(seen["game.changes"]).toContainEqual([1, { kind: "edit", ok: true }]);
    expect(seen["game.changes"]).toContainEqual([0, { kind: "import", ok: false }]);
    expect(seen["game.notices"]?.[0]?.[0]).toBe(panel.notices().length);
    stop();
    expect([...instruments.values()].every((instrument) => instrument.callbacks.size === 0)).toBe(true);
    expect(() => otelMetrics(panel, meter as never, { prefix: "9 bad" })).toThrow(/instrument name/);
  });
});

describe("log sinks", () => {
  it("write RFC 5424 syslog lines for changes and alerts, a value unable to forge a second line", () => {
    const lines: string[] = [];
    const sink = syslogSink({ send: (line) => void lines.push(line), hostname: "web-1", appName: "chess server", facility: 13 });
    const { panel, clock } = panelAt();
    panel.on("change", sink);
    panel.on("alert", sink.alert);
    panel.modifiable("x", "Note");
    panel.viewable(200, { label: "Queue", status: { bad: 100 }, alert: {} });
    panel.edit("note", "line\n<14>1 forged", "ada", EVERYTHING, { reason: "test" });
    clock.advance(1000);
    panel.tick();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^<109>1 \d{4}-\d\d-\d\dT[\d:.]+Z web-1 chess-server \d+ panel-change - \{.*"reason":"test".*\}$/);
    expect(lines[0]?.includes("\n")).toBe(false);
    expect(lines[1]).toMatch(/^<107>1 .* panel-alert - \{.*"status":"bad"/);
    expect(() => syslogSink({ facility: 30 })).toThrow(/0 to 23/);
  });

  it("send over UDP and, octet-counted, over TCP", async () => {
    const udp = createSocket("udp4");
    const received = new Promise<string>((resolve) => udp.once("message", (message) => resolve(message.toString())));
    await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
    const overUdp = syslogSink({ port: (udp.address() as AddressInfo).port });
    const { panel } = panelAt();
    panel.modifiable(1, "Level");
    panel.on("change", overUdp);
    panel.edit("level", 2, "ada", EVERYTHING);
    expect(await received).toMatch(/panel-change - \{/);
    udp.close();

    let text = "";
    const got = new Promise<void>((resolve) => {
      const server = createServer((socket) =>
        socket.on("data", (chunk) => {
          text += chunk.toString();
          if (/^\d+ <\d+>1 /.test(text)) {
            socket.destroy();
            server.close();
            resolve();
          }
        }),
      );
      server.listen(0, "127.0.0.1", () => {
        const overTcp = syslogSink({ protocol: "tcp", port: (server.address() as AddressInfo).port });
        panel.on("change", overTcp);
        panel.edit("level", 3, "ada", EVERYTHING);
      });
    });
    await got;
    const [length, rest] = [Number(text.split(" ")[0]), text.slice(text.indexOf(" ") + 1)];
    expect(Buffer.byteLength(rest)).toBeGreaterThanOrEqual(length);
  });

  it("emit OpenTelemetry log records with the record's fields as attributes", () => {
    const records: Array<Record<string, unknown>> = [];
    const sink = otelLogSink({ getLogger: () => ({ emit: (record) => void records.push(record) }) });
    const { panel, clock } = panelAt();
    panel.on("change", sink);
    panel.on("alert", sink.alert);
    panel.modifiable(1, "Level");
    panel.viewable(200, { label: "Queue", status: { warn: 100 }, alert: { at: "warn" } });
    panel.edit("level", 2, "ada", EVERYTHING, { reason: "load" });
    clock.advance(1000);
    panel.tick();
    expect(records[0]).toMatchObject({ severityText: "INFO", body: "ada changed Level", attributes: { "panel.kind": "edit", "panel.by": "ada", "panel.reason": "load", "panel.to": 2 } });
    expect(records[1]).toMatchObject({ severityText: "WARN", attributes: { "panel.kind": "alert", "panel.target": "queue" } });
    const broken = otelLogSink({ emit: () => {
      throw new Error("exporter down");
    } });
    broken({ id: 1, kind: "edit", target: "a", label: "a", by: "b", at: 1, ok: true });
    expect(broken.failed).toBe(1);
  });
});

describe("the health endpoint", () => {
  it("answers without auth only when switched on, with only ok and a count of warnings", async () => {
    const { panel } = panelAt();
    panel.modifiable("x", "API key");
    const on = routerFor(panel, { auth: { token: TOKEN }, health: true });
    const answer = await call(on, "GET", "/healthz");
    expect([answer.status, answer.body, answer.headers["content-type"]]).toEqual([200, "ok, 1 warning", "text/plain; charset=utf-8"]);
    expect((await call(routerFor(panel, { auth: { token: TOKEN } }), "GET", "/healthz")).status).toBe(401);
    expect((await call(on, "POST", "/healthz", { headers: { "content-type": "application/json" } })).status).toBe(401);
    const quiet = routerFor(panelAt().panel, { auth: { token: TOKEN }, health: true });
    expect((await call(quiet, "GET", "/healthz")).body).toBe("ok");
  });
});
