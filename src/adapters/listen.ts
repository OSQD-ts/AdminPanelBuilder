/**
 * The panel on a port of its own.
 *
 * Loopback by default. Any other address needs `auth`, and the listener refuses to start
 * without it rather than starting and showing the application's state to whoever finds the
 * port. `node:http` is imported here and nowhere else, and only when a listener is started, so
 * the rest of the package loads on runtimes without it.
 */
import type { AdminPanel } from "../core.js";
import { AdminPanelConfigError } from "../errors.js";
import { createRouter } from "../server/router.js";
import type { ListenOptions } from "../server/types.js";
import { nodeHandler } from "./node.js";

/** Clear of hackerpot (9500, 9501) and bothandlerjs (9674), so all three dashboards run side by side without editing a port. */
export const DEFAULT_PORT = 9780;
const DEFAULT_HOST = "127.0.0.1";

export interface PanelServer {
  /** Where the page is, e.g. `http://127.0.0.1:9780/`. */
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
  /**
   * Takes new settings without a restart where it can: auth, controls, groups, hosts, throttles,
   * limits and metrics apply to the next request. The port, the address, the base path and the
   * stream are bound when the listener starts; a change to one is refused with the reason and the
   * rest still applies. New settings that do not validate are refused whole, and the old stay.
   * Every reload that changes something is a notice saying who asked.
   */
  reload(options: ListenOptions, meta: { by: string }): ReloadResult;
}

export interface ReloadResult {
  by: string;
  /** Applied from the next request. */
  applied: string[];
  /** Left as they were, each with why. */
  requiresRestart: Array<{ key: string; reason: string }>;
  /** Refused whole: the sentence the settings were refused with. */
  refused?: string | undefined;
}

/** What a running listener cannot change, and why. */
const BOUND_AT_START: Readonly<Record<string, string>> = {
  port: "the socket is bound to the old port",
  host: "the socket is bound to the old address",
  basePath: "pages already open use the old path for every request",
  stream: "open streams keep the settings they started with",
};

export async function listenPanel(panel: AdminPanel, options: ListenOptions = {}): Promise<PanelServer> {
  const { port = DEFAULT_PORT, host = DEFAULT_HOST, ...serve } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new AdminPanelConfigError(`panel.listen(): port ${port} is not a TCP port (0 to 65535)`);
  if (typeof host !== "string" || host === "") throw new AdminPanelConfigError("panel.listen(): host must be an address");
  const router = createRouter(panel, serve, { boundHost: host, where: "panel.listen()" });
  let handler = nodeHandler(panel, router);
  let current: ListenOptions = { ...options, port, host };
  const { createServer } = await import("node:http");
  // The handler is looked up per request, so a reload swaps it for the next one and leaves those in flight alone.
  const server = createServer((request, response) => handler(request, response));
  // Slow clients hold a socket, not the process: a panel's requests are small and quick.
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const shownHost = host.includes(":") ? `[${host}]` : host;
  return {
    url: `http://${shownHost}:${actualPort}${router.basePath}/`,
    port: actualPort,
    reload(next, meta) {
      const by = typeof meta?.by === "string" && meta.by.trim() !== "" ? meta.by : "unknown";
      const result: ReloadResult = { by, applied: [], requiresRestart: [] };
      const keys = new Set([...Object.keys(current), ...Object.keys(next)].filter((key) => key !== "clock"));
      const merged: Record<string, unknown> = { ...current };
      for (const key of keys) {
        const before = (current as Record<string, unknown>)[key];
        const after = (next as Record<string, unknown>)[key];
        if (stable(before) === stable(after)) continue;
        const reason = BOUND_AT_START[key];
        if (reason !== undefined) result.requiresRestart.push({ key, reason });
        else {
          merged[key] = after;
          result.applied.push(key);
        }
      }
      if (result.applied.length === 0) return result;
      const { port: _port, host: _host, ...serveNext } = merged as ListenOptions;
      try {
        handler = nodeHandler(panel, createRouter(panel, serveNext, { boundHost: host, where: "server.reload()" }));
      } catch (error) {
        return { by, applied: [], requiresRestart: result.requiresRestart, refused: error instanceof Error ? error.message : String(error) };
      }
      current = merged as ListenOptions;
      const held = result.requiresRestart.map((entry) => entry.key).join(", ");
      panel.notice("info", "listener-reload", held === "" ? "noticeReload" : "noticeReloadPartly", { by, applied: result.applied.join(", "), restart: held });
      return result;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections?.();
      }),
  };
}

/** A comparison of options that sees functions and patterns as themselves, not as `{}`. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => (typeof inner === "function" ? `fn:${inner.toString()}` : inner instanceof RegExp ? `/${inner.source}/${inner.flags}` : inner));
}
