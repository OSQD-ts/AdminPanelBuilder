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
}

export async function listenPanel(panel: AdminPanel, options: ListenOptions = {}): Promise<PanelServer> {
  const { port = DEFAULT_PORT, host = DEFAULT_HOST, ...serve } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new AdminPanelConfigError(`panel.listen(): port ${port} is not a TCP port (0 to 65535)`);
  if (typeof host !== "string" || host === "") throw new AdminPanelConfigError("panel.listen(): host must be an address");
  const router = createRouter(panel, serve, { boundHost: host, where: "panel.listen()" });
  const handler = nodeHandler(panel, router);
  const { createServer } = await import("node:http");
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeAllConnections?.();
      }),
  };
}
