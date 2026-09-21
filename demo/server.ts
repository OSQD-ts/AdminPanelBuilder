/**
 * The whole library from source, on fixed local ports, with the shipped components only — so
 * what you see here is what you get in your own deployment.
 *
 *   npm run demo
 *
 *   http://127.0.0.1:9780/?token=demo-token-0123456789   ch3ss, on a port of its own (Material)
 *   http://127.0.0.1:9781/                               a host application with the anymail
 *                                                        panel mounted at /admin (Apple), shown
 *                                                        three ways: the page itself at /admin/,
 *                                                        embedded as a fragment at /embedded,
 *                                                        and as a snapshot at /snapshot
 *
 * The token is fixed so the URL above works every time; never ship a token in source. The host
 * application admits loopback callers as "demo" through `auth.check`, which is how a real
 * application plugs in its own sign-in.
 *
 * `npm run simulate` pokes both panels through their APIs, the way an operator's clicks would.
 */
import { createServer } from "node:http";
import { buildMailPanel } from "../examples/anymail.js";
import { buildChessPanel } from "../examples/ch3ss.js";

export const DEMO_TOKEN = "demo-token-0123456789";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const chess = buildChessPanel();
const chessServer = await chess.panel.listen({ port: 9780, auth: { token: DEMO_TOKEN, name: "demo" }, controls: { edit: true, actions: true } });

const mail = buildMailPanel();
const handler = mail.panel.handler({
  basePath: "/admin",
  auth: { check: (request) => (LOOPBACK.has(request.address) ? "demo" : false) },
  controls: { edit: true, actions: true },
});
const host = createServer((request, response) => {
  const url = request.url ?? "/";
  if (url === "/admin" || url.startsWith("/admin/") || url.startsWith("/admin?")) return handler(request, response);
  const shell = (title: string, body: string, csp: string): void => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp });
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><header><strong>Host application</strong> · <a href="/admin/">panel page</a> · <a href="/embedded">embedded</a> · <a href="/snapshot">snapshot</a></header>${body}</body></html>`);
  };
  if (url === "/embedded") return shell("Embedded panel", `<h1>Our admin page</h1><p>The panel below is a fragment from panel.html({ api: "/admin" }).</p>${mail.panel.html({ api: "/admin" })}`, "default-src 'self'");
  if (url === "/snapshot") return shell("Snapshot", `<h1>Nightly report</h1>${mail.panel.html({ snapshot: true, nonce: "demo-nonce" })}`, "default-src 'none'; script-src 'nonce-demo-nonce'; style-src 'nonce-demo-nonce'");
  return shell("Host application", "<h1>Host application</h1><p>Open one of the links above.</p>", "default-src 'self'");
});
await new Promise<void>((resolve) => host.listen(9781, "127.0.0.1", resolve));

const timer = setInterval(() => {
  chess.tick();
  mail.tick();
}, 500);

console.log(`${chessServer.url}?token=${DEMO_TOKEN}`);
console.log("http://127.0.0.1:9781/");
console.error("ch3ss on 9780 (token in the URL), the anymail host application on 9781. Ctrl+C stops both.");

process.once("SIGINT", () => {
  clearInterval(timer);
  chess.panel.close();
  mail.panel.close();
  host.close();
  void chessServer.close().then(() => process.exit(0));
});
