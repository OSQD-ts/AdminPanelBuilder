/**
 * The smallest useful panel, declared the shortest way: through the default panel, from anywhere in
 * the application, with no panel object passed around.
 *
 *   npm run example
 *
 * prints a URL; open it. "Requests handled" climbs and draws its own chart. "Greeting" and "Rate
 * limit" can be changed from the page and every change is listed under Activity with who made it;
 * try a rate limit of 5000 and the page refuses it with the sentence the code would get. "Clear the
 * cache" runs code in the application and says what it did.
 */
import { action, configure, defaultPanel, modifiable, viewable } from "../src/index.js";
import { isMain, runExample } from "./run.js";

export function buildQuickstart() {
  configure({ title: "My service" });

  // Declared where the value lives: `requests.value += 1` anywhere updates every open page.
  const requests = viewable(0, { label: "Requests handled", format: "integer", chart: true });
  const greeting = modifiable("Hello", { label: "Greeting", maxLength: 80, description: "What the home page says first." });
  const rateLimit = modifiable(100, { label: "Rate limit", unit: "req/min", min: 1, max: 1000 });
  const cache = new Map<string, string>();
  action("Clear the cache", () => {
    const entries = cache.size;
    cache.clear();
    return `Cleared ${entries} cached pages.`;
  });

  const tick = (): void => {
    requests.value += Math.floor(Math.random() * Math.min(20, rateLimit.value));
    cache.set(`page-${requests.value % 50}`, greeting.value);
  };
  return { panel: defaultPanel(), tick };
}

if (isMain(import.meta.url)) {
  const { panel, tick } = buildQuickstart();
  await runExample(panel, tick);
}
