/**
 * The panel in a Hono application, through the Fetch handler — no adapter needed.
 *
 *   import { Hono } from "hono";
 *   const app = new Hono();
 *   app.all("/admin/*", (c) => handle(c.req.raw));
 *   app.all("/admin", (c) => handle(c.req.raw));
 *
 * Hono is not a dependency of this repository, so the test drives `honoRoute` with the one thing
 * Hono hands it — a context whose `req.raw` is a standard Request — which is the whole contract.
 */
import { createAdminPanel } from "../src/index.js";

export function buildHonoPanel(token: string) {
  const panel = createAdminPanel({ title: "Hono app" });
  panel.modifiable(10, { label: "Limit", min: 1, max: 100 });
  const handle = panel.fetchHandler({ basePath: "/admin", auth: { token }, controls: { edit: true } });
  const honoRoute = (context: { req: { raw: Request } }): Promise<Response> => handle(context.req.raw);
  return { panel, honoRoute };
}
