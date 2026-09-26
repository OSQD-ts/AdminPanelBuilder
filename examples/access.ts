/**
 * Who sees what: a panel inside an application that has its own users.
 *
 *   npx tsx examples/access.ts      # then open the printed URL and sign in as one of three people
 *
 * The application signs people in itself and hands the panel a signed session (`signSession`), with
 * what each may see and do narrowed by grants:
 *
 * - ada, an administrator: every group, every setting, every action.
 * - sam, in support: the Customers group only, read-only. Finance never leaves the process for him:
 *   the server withholds it, it is not hidden by the page.
 * - lin, in finance: Customers and Finance, changing Finance only, running nothing.
 *
 * Signing out revokes the session, so a copied cookie stops working. A second listener serves a
 * read-only status view to a monitoring token, with Prometheus metrics and a health check for a load
 * balancer. Changes are limited per operator per minute, repeated failed sign-ins are slowed down,
 * and the page speaks each viewer's language where it ships one (`locale: "auto"`).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createAdminPanel, sessionInfo, signSession } from "../src/index.js";
import { isMain } from "./run.js";

/** The application's own users, and what the panel lets each of them do. */
export const PEOPLE = {
  ada: { role: "administrator", grants: undefined },
  sam: { role: "support", grants: { groups: ["Customers"], edit: false, actions: false } },
  lin: { role: "finance", grants: { groups: ["Customers", "Finance"], edit: ["Finance"], actions: false } },
} as const;

export function buildAccessPanel(options: { secret: string; monitorToken: string }) {
  const panel = createAdminPanel({ title: "Back office", instance: "production", locale: "auto" });

  const customers = panel.group("Customers", { order: 0 });
  const signedIn = customers.viewable(0, { label: "Signed-in customers", format: "integer", chart: true });
  const tickets = customers.viewable(0, { label: "Open support tickets", format: "integer", status: { warn: 20, bad: 50 }, chart: "sparkline" });
  customers.modifiable("", { label: "Banner for all customers", maxLength: 200, description: "Shown at the top of every page. Empty shows nothing." });
  customers.action("Resend a password reset", ({ input }) => `A reset link is on its way to ${String(input.email)}.`, { input: { email: { label: "Email", pattern: /^[^@\s]+@[^@\s]+$/, maxLength: 200 } } });

  const finance = panel.group("Finance", { order: 1, description: "Withheld from support: their sessions never receive it." });
  const invoices = finance.counter("Invoices issued");
  const revenue = finance.viewable(0, { label: "Revenue today", unit: "EUR", decimals: 2, chart: { kind: "area" } });
  finance.modifiable(0.23, { label: "Default VAT rate", format: "percent", min: 0, max: 0.5, step: 0.01, confirm: true, reason: "required" });

  const service = panel.group("Service", { order: 2 });
  service.viewable(() => process.memoryUsage().heapUsed, { label: "Heap in use", format: "bytes", chart: { sampleEveryMs: 2000 } });
  service.viewable(() => process.uptime() * 1000, { label: "Uptime", format: "duration" });
  service.action("Rebuild the search index", async ({ signal }) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return signal.aborted ? "Stopped before it finished." : "The search index is rebuilt.";
  });

  // Sessions signed out before they expire. A shared store (redisRevocations) does this across replicas.
  const revoked = new Set<string>();
  const operators = panel.handler({
    basePath: "/panel",
    auth: { session: { secret: options.secret, revoked: (id) => revoked.has(id) } },
    controls: { edit: true, actions: true },
    writeLimit: { perMinute: 30 },
    authThrottle: { failures: 5, windowMs: 60_000 },
    stream: true,
  });
  // Monitoring: one group, read-only, with metrics for Prometheus and a health check for the balancer.
  const monitoring = panel.handler({
    basePath: "/status",
    auth: { tokens: { monitor: options.monitorToken } },
    groups: ["Service"],
    metrics: true,
    health: true,
  });

  const tick = (): void => {
    signedIn.value = Math.max(0, signedIn.value + Math.round(Math.random() * 10 - 4));
    tickets.value = Math.max(0, tickets.value + Math.round(Math.random() * 2 - 0.9));
    if (Math.random() < 0.3) {
      invoices.inc();
      revenue.value += 50 + Math.random() * 950;
    }
  };

  /** The application: sign-in and sign-out, the two listeners, and a home page linking them. */
  const app = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://app.local");
    if (url.pathname === "/panel" || url.pathname.startsWith("/panel/")) return operators(request, response);
    if (url.pathname === "/status" || url.pathname.startsWith("/status/")) return monitoring(request, response);
    if (url.pathname === "/login") {
      const name = url.searchParams.get("as") as keyof typeof PEOPLE | null;
      if (name === null || !(name in PEOPLE)) return void response.writeHead(400).end("Nobody by that name.");
      const cookie = await signSession(options.secret, name, { ttlMs: 8 * 3_600_000, grants: PEOPLE[name].grants });
      response.writeHead(303, { "set-cookie": `apb_session=${cookie}; Path=/; HttpOnly; SameSite=Strict`, location: "/panel/" });
      return void response.end();
    }
    if (url.pathname === "/logout") {
      const cookie = /(?:^|;\s*)apb_session=([^;]+)/.exec(request.headers.cookie ?? "")?.[1];
      const info = await sessionInfo(options.secret, cookie);
      if (info !== undefined) revoked.add(info.id);
      response.writeHead(303, { "set-cookie": "apb_session=; Path=/; Max-Age=0", location: "/" });
      return void response.end();
    }
    const links = Object.entries(PEOPLE)
      .map(([name, person]) => `<li><a href="/login?as=${name}">Sign in as ${name}</a> (${person.role})</li>`)
      .join("");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'" });
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Back office</title></head><body><h1>Back office</h1><ul>${links}</ul><p><a href="/logout">Sign out</a> · <a href="/status/">Status view</a> (token in the Authorization header)</p></body></html>`);
  };
  return { panel, tick, app, operators, monitoring };
}

if (isMain(import.meta.url)) {
  const secret = process.env.SESSION_SECRET ?? "example-session-secret-change-me-0123456789";
  const monitorToken = process.env.MONITOR_TOKEN ?? "monitor-token-0123456789";
  const { panel, tick, app } = buildAccessPanel({ secret, monitorToken });
  const server = createServer((request, response) => void app(request, response));
  const timer = setInterval(tick, 500);
  server.listen(Number(process.env.PORT ?? 9785), "127.0.0.1", () => {
    const address = server.address();
    console.log(`http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 9785}/`);
    console.error("Sign in as ada, sam or lin from the page. Ctrl+C stops it.");
  });
  process.once("SIGINT", () => {
    clearInterval(timer);
    panel.close();
    server.close(() => process.exit(0));
  });
}
