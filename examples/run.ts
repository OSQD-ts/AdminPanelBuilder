/**
 * How every example starts its panel when run directly: on loopback, with a token from
 * `PANEL_TOKEN` or a random one printed once, and editing and actions granted.
 *
 * Kept out of the examples themselves so each one reads as what you would write in your own
 * application: the declarations, and nothing about how this repository runs them.
 */
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { AdminPanel } from "../src/index.js";

export function isMain(url: string): boolean {
  return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}

export async function runExample(panel: AdminPanel, tick: () => void, port = Number(process.env.PORT ?? 9780)): Promise<void> {
  const token = process.env.PANEL_TOKEN ?? randomBytes(18).toString("base64url");
  const server = await panel.listen({ port, auth: { token, name: "operator" }, controls: { edit: true, actions: true } });
  const timer = setInterval(tick, 500);
  // stdout carries the one line a script might want; the explanation goes to stderr.
  console.log(`${server.url}?token=${token}`);
  console.error("Open the URL above; the token is exchanged for a cookie and removed from the address bar. Ctrl+C stops it.");
  process.once("SIGINT", () => {
    clearInterval(timer);
    panel.close();
    void server.close().then(() => process.exit(0));
  });
}
