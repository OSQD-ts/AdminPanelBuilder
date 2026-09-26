/**
 * The listener configured by a file and the environment, and reconfigured without a restart.
 *
 *   APB_CONFIG=admin-panel.toml PANEL_TOKEN=… npx tsx examples/configuration.ts
 *   kill -HUP <pid>      # after editing the file: what can change applies, the rest is logged
 *
 * The declarations are code, as they always are; who may reach the panel, from where, and what they
 * may change is operations' business, and lives in `admin-panel.toml` (every key and its default is
 * in the repository's own copy). `PANEL_TOKEN` and the other `APB_*` variables override the file.
 */
import { listenOptions, loadConfig, reloadListener } from "../src/config/index.js";
import { createAdminPanel } from "../src/index.js";
import { isMain } from "./run.js";

export function buildConfiguredPanel() {
  const panel = createAdminPanel({ title: "Configured service" });
  const requests = panel.counter("Requests");
  panel.modifiable(100, { label: "Rate limit", unit: "req/min", min: 1, max: 1000 });
  panel.modifiable(false, { label: "Maintenance mode", confirm: true });
  const tick = (): void => requests.inc(Math.round(Math.random() * 20));
  return { panel, tick };
}

if (isMain(import.meta.url)) {
  const { panel, tick } = buildConfiguredPanel();
  let config = await loadConfig();
  const server = await panel.listen(listenOptions(config));
  const timer = setInterval(tick, 500);
  console.log(server.url);
  console.error("Edit the configuration file and send SIGHUP to apply it; Ctrl+C stops it.");
  process.on("SIGHUP", () => {
    void loadConfig().then(
      (next) => {
        config = reloadListener(server, config, next, "SIGHUP");
        console.error("admin panel: configuration reloaded");
      },
      (error: unknown) => console.error(`admin panel: the configuration was not reloaded: ${error instanceof Error ? error.message : String(error)}`),
    );
  });
  process.once("SIGINT", () => {
    clearInterval(timer);
    panel.close();
    void server.close().then(() => process.exit(0));
  });
}
