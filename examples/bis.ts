/**
 * A panel inside BIS, a business application with its own users and sessions.
 *
 *   npx tsx examples/bis.ts
 *
 * then open http://127.0.0.1:9785/ and follow the links. This is the shape for any application
 * that already has sign-in: the panel is mounted on paths of the application's own server and
 * asks the application who is signed in (`auth.check`), so there is no second user list.
 *
 * Two listeners over one panel show the two axes kept apart: `/admin/panel` shows everything
 * and lets an administrator change it; `/support/panel` shows only the Customers group and
 * changes nothing. The Finance group never leaves the process for a support session: it is
 * withheld on the server, not hidden on the page. The application's own admin page embeds the
 * panel with `panel.html({ api })`, under the application's CSP.
 *
 * BIS itself was not available when this was written; the values are placeholders for a
 * typical business system, and the wiring is the point.
 */
import { createServer, type IncomingMessage } from "node:http";
import { createAdminPanel } from "../src/index.js";
import { isMain } from "./run.js";

/** Stands in for BIS's session store: cookie value to user. */
const SESSIONS = new Map([
  ["admin-session", { name: "ada", role: "admin" }],
  ["support-session", { name: "sam", role: "support" }],
]);

function userOf(cookieHeader: string | undefined): { name: string; role: string } | undefined {
  const token = /(?:^|;\s*)bis_session=([^;]+)/.exec(cookieHeader ?? "")?.[1];
  return token === undefined ? undefined : SESSIONS.get(token);
}

export function buildBisPanel() {
  const panel = createAdminPanel({ title: "BIS", instance: "production", theme: "material" });

  panel.group("Customers", { order: 0 });
  const activeUsers = panel.viewable(0, { label: "Signed-in users", group: "Customers", format: "integer", chart: true });
  const openTickets = panel.viewable(0, { label: "Open support tickets", group: "Customers", format: "integer", chart: "sparkline" });
  panel.modifiable("", { label: "Banner for all users", group: "Customers", maxLength: 200, description: "Shown at the top of every page. Empty shows nothing." });

  panel.group("Finance", { order: 1, description: "Withheld from support sessions." });
  const invoicesToday = panel.viewable(0, { label: "Invoices issued today", group: "Finance", format: "integer" });
  const revenue = panel.viewable(0, { label: "Revenue today", group: "Finance", unit: "EUR", decimals: 2, chart: { kind: "area" } });
  panel.modifiable(0.23, { label: "Default VAT rate", group: "Finance", format: "percent", min: 0, max: 0.5, step: 0.01, confirm: true });

  panel.group("Operations", { order: 2 });
  panel.viewable(() => process.memoryUsage().heapUsed, { label: "Heap in use", group: "Operations", format: "bytes", chart: { sampleEveryMs: 2000 } });
  panel.viewable(() => process.uptime() * 1000, { label: "Uptime", group: "Operations", format: "duration" });
  panel.action("Rebuild search index", async ({ signal }) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (signal.aborted) return "Stopped.";
    return "Search index rebuilt.";
  }, { group: "Operations" });

  const tick = (): void => {
    activeUsers.value = Math.max(0, activeUsers.value + Math.round(Math.random() * 10 - 4));
    openTickets.value = Math.max(0, openTickets.value + Math.round(Math.random() * 2 - 0.8));
    if (Math.random() < 0.3) {
      invoicesToday.value += 1;
      revenue.value += 50 + Math.random() * 950;
    }
  };

  // The administrator's listener: everything, and the power to change it.
  const admin = panel.handler({
    basePath: "/admin/panel",
    auth: { check: (request) => (userOf(request.headers.cookie)?.role === "admin" ? (userOf(request.headers.cookie)?.name ?? false) : false) },
    controls: { edit: true, actions: true },
  });
  // Support's listener: one group, nothing to change. A second listener, not a role model.
  const support = panel.handler({
    basePath: "/support/panel",
    auth: { check: (request) => userOf(request.headers.cookie)?.name ?? false },
    groups: ["Customers"],
  });

  return { panel, tick, admin, support };
}

if (isMain(import.meta.url)) {
  const { panel, tick, admin, support } = buildBisPanel();
  const page = (title: string, body: string): string =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><nav><a href="/login?as=admin">Sign in as ada (admin)</a> · <a href="/login?as=support">Sign in as sam (support)</a> · <a href="/admin">BIS admin page</a> · <a href="/admin/panel/">Admin panel</a> · <a href="/support/panel/">Support panel</a></nav>${body}</body></html>`;
  const server = createServer((request: IncomingMessage, response) => {
    const url = request.url ?? "/";
    if (url.startsWith("/admin/panel")) return admin(request, response);
    if (url.startsWith("/support/panel")) return support(request, response);
    if (url.startsWith("/login")) {
      const as = new URL(url, "http://x").searchParams.get("as");
      response.writeHead(303, { "set-cookie": `bis_session=${as === "admin" ? "admin-session" : "support-session"}; Path=/; HttpOnly; SameSite=Strict`, location: "/" });
      return response.end();
    }
    if (url === "/admin") {
      // BIS's own admin page, with the panel embedded. Its CSP needs nothing but 'self'.
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'" });
      return response.end(page("BIS admin", `<h1>BIS administration</h1>${panel.html({ api: "/admin/panel" })}`));
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page("BIS", "<h1>BIS</h1><p>Sign in, then open a panel.</p>"));
  });
  setInterval(tick, 500).unref();
  server.listen(Number(process.env.PORT ?? 9785), "127.0.0.1", () => {
    const address = server.address();
    console.log(`http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 9785}/`);
  });
}
