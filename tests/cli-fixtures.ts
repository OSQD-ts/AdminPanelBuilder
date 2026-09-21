/** A panel on a real port with editing on, for the command-line suites. */
import { type AdminPanel, createAdminPanel, fileChangeLog } from "../src/index.js";
import { listenPanel, type PanelServer } from "../src/adapters/listen.js";
import { TOKEN } from "./helpers.js";

export { createAdminPanel, fileChangeLog };

export async function listenPanelFor(declare: (panel: AdminPanel) => unknown): Promise<{ panel: AdminPanel; server: PanelServer }> {
  const panel = createAdminPanel();
  declare(panel);
  const server = await listenPanel(panel, { port: 0, auth: { token: TOKEN }, controls: { edit: true, actions: true } });
  return { panel, server };
}
