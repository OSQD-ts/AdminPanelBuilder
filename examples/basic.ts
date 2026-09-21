/**
 * The smallest useful panel: two values and a switch, on a port of its own.
 *
 *   npm run example
 *
 * prints a URL; open it. "Requests handled" climbs and draws its own chart; "Greeting" and
 * "Maintenance mode" can be changed from the page, and every change shows up under Activity
 * with who made it. Try setting the rate limit to 5000: the page refuses it with the same
 * sentence the code would get.
 */
import { createAdminPanel } from "../src/index.js";
import { isMain, runExample } from "./run.js";

export function buildBasicPanel() {
  const panel = createAdminPanel({ title: "My service" });

  // const requests = viewable(0) with the default panel; an explicit panel keeps the example self-contained.
  const requests = panel.viewable(0, { label: "Requests handled", format: "integer", chart: true });
  const greeting = panel.modifiable("Hello", { label: "Greeting", maxLength: 80, description: "What the home page says first." });
  const rateLimit = panel.modifiable(100, { label: "Rate limit", unit: "req/min", min: 1, max: 1000, step: 1 });
  const maintenance = panel.modifiable(false, { label: "Maintenance mode", confirm: true, description: "Serves a holding page to everyone but operators." });

  const tick = (): void => {
    if (!maintenance.value) requests.value += Math.floor(Math.random() * Math.min(20, rateLimit.value));
  };
  return { panel, tick, values: { requests, greeting, rateLimit, maintenance } };
}

if (isMain(import.meta.url)) {
  const { panel, tick } = buildBasicPanel();
  await runExample(panel, tick);
}
