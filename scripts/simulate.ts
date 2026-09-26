/**
 * Pokes a running demo through its API, the way an operator's clicks would: edits that are
 * accepted, edits that are refused, an action, and a write from another origin that must be
 * turned away. Each line printed says what was sent and what came back.
 *
 *   npm run demo        (in one terminal)
 *   npm run simulate    (in another)
 */
export {};

const TOKEN = "demo-token-0123456789";
const SERVICE = "http://127.0.0.1:9780";
const SHOP = "http://127.0.0.1:9781/admin";

async function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  console.log(`${response.status}  POST ${base}${path} ${JSON.stringify(body)}\n     ${await response.text()}`);
}

const bearer = { authorization: `Bearer ${TOKEN}` };
try {
  await post(SERVICE, "/api/values/latency-objective", { value: 180 }, bearer);
  await post(SERVICE, "/api/values/latency-objective", { value: 185 }, bearer);
  await post(SERVICE, "/api/values/latency-objective", { value: 5000 }, bearer);
  await post(SERVICE, "/api/actions/retry-every-failed-job", {}, bearer);
  await post(SERVICE, "/api/values/latency-objective", { value: 200 }, { ...bearer, origin: "https://attacker.example" });
  await post(SERVICE, "/api/values/latency-objective", { value: 200 });
  await post(SHOP, "/api/values/reorder-below", { value: 15 });
  await post(SHOP, "/api/actions/reorder-everything-low", {});
} catch (error) {
  console.error(`The demo does not seem to be running (${error instanceof Error ? error.message : String(error)}). Start it with npm run demo.`);
  process.exit(1);
}
