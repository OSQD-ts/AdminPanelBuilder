/**
 * The panel as a Next.js route handler: `app/admin/[[...path]]/route.ts`.
 *
 *   export const { GET, POST } = panelRoutes;
 *   export const dynamic = "force-dynamic";   // never cache a panel
 *
 * A route handler is `(request: Request) => Response`, which is exactly the Fetch handler. The
 * panel is a module-level singleton so every request sees the same values; in development, Next's
 * hot reload may create a second one, which is why the application's own module should own it.
 */
import { createAdminPanel } from "../src/index.js";

export function buildNextRoutes(token: string) {
  const panel = createAdminPanel({ title: "Next app" });
  panel.viewable(() => process.uptime() * 1000, { label: "Uptime", format: "duration" });
  const handle = panel.fetchHandler({ basePath: "/admin", auth: { token } });
  return { panel, panelRoutes: { GET: handle, POST: handle } };
}
