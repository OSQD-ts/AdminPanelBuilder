/**
 * Inside another application: the panel as part of pages the application already serves.
 *
 *   npx tsx examples/embedding.ts
 *
 * One panel, mounted once as a handler at /admin, shown five ways:
 *
 * - /admin/      the panel's own page;
 * - /            the application's page with the panel embedded as a fragment — it loads its
 *                stylesheet and script from /admin, so the host's CSP needs nothing but 'self';
 * - /dashboard   two fragments of one group each, without the panel's header ("compact"), side by
 *                side in the host's own layout, sharing one script tag;
 * - /report      a snapshot: the values as they are now, inline, updating nothing — for an email or a
 *                report generated at night — under a CSP that allows only its nonce;
 * - the same panel through the Fetch API, the way Hono, Next.js route handlers, Deno, Bun and edge
 *   runtimes serve it: `fetchRoutes` below.
 *
 * The custom element is one more way: load `dist/element.js` from the package and write
 * `<admin-panel src="/admin" group="Orders" compact></admin-panel>`; it renders in a shadow root.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { clientScript, createAdminPanel } from "../src/index.js";
import { isMain } from "./run.js";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function buildEmbeddedPanel(options: { token: string }) {
  const panel = createAdminPanel({ title: "Shop", instance: "shop-1", theme: "apple" });
  const orders = panel.group("Orders", { order: 0 });
  const placed = orders.counter("Orders placed");
  const basket = orders.viewable(0, { label: "Average basket", unit: "EUR", decimals: 2, chart: "sparkline" });
  const stock = panel.group("Stock", { order: 1 });
  const low = stock.viewable<Record<string, number>>({ tea: 12, coffee: 40, cocoa: 3 }, { label: "Stock by product", chart: { over: "keys" } });
  const reorder = stock.modifiable(5, { label: "Reorder below", min: 0, max: 100, integer: true });
  stock.action("Reorder everything low", () => {
    const due = Object.entries(low.value).filter(([, count]) => count < reorder.value);
    return due.length === 0 ? "Nothing is below the reorder level." : `Ordered ${due.map(([product]) => product).join(", ")}.`;
  });

  // The application's own sign-in decides who reaches /admin: here, anyone on this machine.
  const handler = panel.handler({ basePath: "/admin", auth: { check: (request) => (LOOPBACK.has(request.address) ? "shop-owner" : false) }, controls: { edit: true, actions: true } });

  // For runtimes that speak Request and Response: one function serves every route of the panel.
  const handle = panel.fetchHandler({ basePath: "/edge", auth: { token: options.token }, controls: { edit: true } });
  const fetchRoutes = {
    /** Hono: `app.all("/edge/*", (c) => fetchRoutes.hono(c))`. */
    hono: (context: { req: { raw: Request } }): Promise<Response> => handle(context.req.raw),
    /** Next.js, `app/edge/[[...path]]/route.ts`: `export const { GET, POST } = fetchRoutes.next;` and `dynamic = "force-dynamic"`. */
    next: { GET: handle, POST: handle },
    /** Deno.serve, Bun.serve, a Worker's `fetch`: the handler as it is. */
    serve: handle,
  };

  const tick = (): void => {
    if (Math.random() < 0.5) {
      placed.inc();
      basket.value = 20 + Math.random() * 60;
    }
    const next = { ...low.value };
    for (const product of Object.keys(next)) next[product] = Math.max(0, (next[product] ?? 0) - (Math.random() < 0.2 ? 1 : 0));
    low.value = next;
  };

  /** The host application's pages. */
  const app = (request: IncomingMessage, response: ServerResponse): void => {
    const url = request.url ?? "/";
    if (url === "/admin" || url.startsWith("/admin/") || url.startsWith("/admin?")) return handler(request, response);
    const page = (title: string, body: string, csp = "default-src 'self'"): void => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp });
      response.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><header><strong>Shop</strong> · <a href="/">embedded</a> · <a href="/dashboard">dashboard</a> · <a href="/report">report</a> · <a href="/admin/">panel page</a></header>${body}</body></html>`,
      );
    };
    if (url === "/dashboard") {
      // Two fragments with script: false, and the script once: it mounts every fragment on the page.
      const orders = panel.html({ api: "/admin", group: "Orders", compact: true, script: false });
      const stock = panel.html({ api: "/admin", group: "Stock", compact: true, script: false });
      return page("Dashboard", `<h1>Today</h1><div class="columns"><section>${orders}</section><section>${stock}</section></div>${clientScript({ api: "/admin" })}`);
    }
    if (url === "/report") {
      const nonce = "report-nonce";
      return page("Nightly report", `<h1>Nightly report</h1>${panel.html({ snapshot: true, nonce })}`, `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`);
    }
    page("Shop", `<h1>Our back office</h1><p>The panel below is a fragment from <code>panel.html({ api: "/admin" })</code>.</p>${panel.html({ api: "/admin" })}`);
  };
  return { panel, tick, app, fetchRoutes };
}

if (isMain(import.meta.url)) {
  const { panel, tick, app } = buildEmbeddedPanel({ token: process.env.PANEL_TOKEN ?? "edge-token-0123456789" });
  const server = createServer(app);
  const timer = setInterval(tick, 500);
  server.listen(Number(process.env.PORT ?? 9788), "127.0.0.1", () => {
    const address = server.address();
    console.log(`http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 9788}/`);
    console.error("The host application; its pages link to the four ways the panel is shown. Ctrl+C stops it.");
  });
  process.once("SIGINT", () => {
    clearInterval(timer);
    panel.close();
    server.close(() => process.exit(0));
  });
}
