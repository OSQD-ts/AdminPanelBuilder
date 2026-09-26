/**
 * Replicas and a fleet: one application running three times, one panel each, kept in agreement.
 *
 *   npx tsx examples/fleet.ts      # prints the fleet page's URL; the token is in the header it asks for
 *
 * Every replica declares the same panel and joins one sync channel (`memorySync` here, in one
 * process; `redisSync` across machines). Then:
 *
 * - a change made on any replica is applied on the others, attributed to who made it there;
 * - a proposal made on one can be approved from another, once;
 * - a scheduled change fires on exactly one replica (they claim it), even if its maker is gone;
 * - a layout saved for everybody reaches every replica's page.
 *
 * Each replica's own numbers (its requests, its memory) stay its own: a panel reports one process.
 * The fleet page lists every replica, whether it answers, and which settings disagree between them.
 * A remote panel in front of the first replica shows one group of it to people who should not reach
 * the replica itself, asking the replica on their behalf.
 */
import { createServer } from "node:http";
import { createFleet, remotePanelHandler } from "../src/adapters/index.js";
import { createAdminPanel, memorySync, type PanelSync } from "../src/index.js";
import { isMain } from "./run.js";

/** One replica of the application: its own numbers, the shared settings. */
export function buildReplica(name: string, sync: PanelSync) {
  const panel = createAdminPanel({ title: "Checkout", instance: name, sync });
  const traffic = panel.group("Traffic", { order: 0 });
  const requests = traffic.counter("Requests");
  traffic.viewable(() => process.memoryUsage().heapUsed, { label: "Heap in use", format: "bytes" });
  const settings = panel.group("Settings", { order: 1, description: "The same on every replica: a change here reaches all of them." });
  const limit = settings.modifiable(100, { label: "Rate limit", unit: "req/s", min: 1, max: 1000, reason: "optional" });
  settings.modifiable(false, { label: "Read-only mode", confirm: true });
  settings.modifiable(30, { label: "Session length", unit: "min", min: 5, max: 480, integer: true, approval: true, description: "Needs a second operator, who may approve it from any replica." });
  const tick = (): void => {
    requests.inc(Math.round(Math.random() * limit.value * 0.2));
  };
  return { panel, tick };
}

export function buildFleet(count = 3) {
  const bus = memorySync();
  return Array.from({ length: count }, (_, index) => buildReplica(`web-${index + 1}`, bus.connect()));
}

if (isMain(import.meta.url)) {
  const token = process.env.PANEL_TOKEN ?? "fleet-token-0123456789";
  const gatewayToken = process.env.GATEWAY_TOKEN ?? `${token}-gateway`;
  const replicas = buildFleet();
  // Each replica on a port of its own, as it would be on its own machine. The gateway token may act
  // for an operator (`delegates`): the remote panel below says who is asking.
  const servers = await Promise.all(
    replicas.map(({ panel }) => panel.listen({ port: 0, auth: { tokens: { operator: token, gateway: gatewayToken }, delegates: ["gateway"] }, controls: { edit: true, actions: true } })),
  );
  const fleet = createFleet({
    title: "Checkout fleet",
    panels: servers.map((server, index) => ({ name: `web-${index + 1}`, url: server.url, token })),
    auth: { token, name: "operator" },
    refreshSeconds: 10,
  });
  const fleetPage = fleet.handler();
  // Settings only, read-only, for whoever reaches the gateway: the replica never sees them directly.
  const gateway = remotePanelHandler({
    upstream: servers[0]?.url as string,
    token: gatewayToken,
    basePath: "/settings",
    auth: { token, name: "gateway-viewer" },
    groups: ["Settings"],
  });
  const front = createServer((request, response) => {
    const url = request.url ?? "/";
    if (url === "/settings" || url.startsWith("/settings/")) return gateway(request, response);
    return fleetPage(request, response);
  });
  const timer = setInterval(() => {
    for (const replica of replicas) replica.tick();
  }, 500);
  front.listen(Number(process.env.PORT ?? 9787), "127.0.0.1", () => {
    const address = front.address();
    const port = typeof address === "object" && address !== null ? address.port : 9787;
    console.log(`http://127.0.0.1:${port}/`);
    console.error(`The fleet page and, at /settings/, the gateway. Replicas: ${servers.map((server) => server.url).join(", ")} — the token is PANEL_TOKEN or "${token}". Ctrl+C stops it.`);
  });
  process.once("SIGINT", () => {
    clearInterval(timer);
    for (const { panel } of replicas) panel.close();
    void Promise.all(servers.map((server) => server.close())).then(() => front.close(() => process.exit(0)));
  });
}
