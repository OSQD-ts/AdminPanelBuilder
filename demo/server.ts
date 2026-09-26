/**
 * The whole library from source, on fixed local ports, with the shipped components only — so
 * what you see here is what you get in your own deployment.
 *
 *   npm run demo
 *
 *   http://127.0.0.1:9780/?token=demo-token-0123456789   examples/service.ts on a port of its own:
 *                                                        every kind of chart, a paged table, a feed
 *   http://127.0.0.1:9781/                               examples/embedding.ts: a host application
 *                                                        with the panel at /admin, embedded as a
 *                                                        fragment, as compact cards, and as a snapshot
 *
 * The token is fixed so the URL above works every time; never ship a token in source. The host
 * application admits loopback callers through `auth.check`, which is how a real application plugs in
 * its own sign-in.
 *
 * `npm run simulate` pokes both panels through their APIs, the way an operator's clicks would.
 */
import { createServer } from "node:http";
import { buildEmbeddedPanel } from "../examples/embedding.js";
import { buildServicePanel } from "../examples/service.js";

export const DEMO_TOKEN = "demo-token-0123456789";

const service = buildServicePanel();
const serviceServer = await service.panel.listen({ port: 9780, auth: { token: DEMO_TOKEN, name: "demo" }, controls: { edit: true, actions: true } });

const shop = buildEmbeddedPanel({ token: DEMO_TOKEN });
const host = createServer(shop.app);
await new Promise<void>((resolve) => host.listen(9781, "127.0.0.1", resolve));

const timer = setInterval(() => {
  service.tick();
  shop.tick();
}, 500);

console.log(`${serviceServer.url}?token=${DEMO_TOKEN}`);
console.log("http://127.0.0.1:9781/");
console.error("The service panel on 9780 (token in the URL), the shop's host application on 9781. Ctrl+C stops both.");

process.once("SIGINT", () => {
  clearInterval(timer);
  service.panel.close();
  shop.panel.close();
  host.close();
  void serviceServer.close().then(() => process.exit(0));
});
