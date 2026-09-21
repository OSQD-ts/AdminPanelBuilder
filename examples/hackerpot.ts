/**
 * A panel for hackerpot, built from the preset in `@osqd/admin-panel-builder/presets`.
 *
 *   npx tsx examples/hackerpot.ts
 *
 * With a real engine: `const { enabled } = hackerpotPanel(panel, engine, detectorIds)` and have the
 * detectors consult `enabled[id]`. Serve it on its own port rather than on a path of the site the
 * honeypot protects: a mitigation served to that site must never lock you out of the tool you are
 * watching it with.
 */
import { createAdminPanel } from "../src/index.js";
import { hackerpotPanel, type HoneypotEngineLike } from "../src/presets/index.js";
import { isMain, runExample } from "./run.js";

export function buildHoneypotPanel(engine: HoneypotEngineLike, detectors: readonly string[]) {
  const panel = createAdminPanel({ title: "hackerpot", theme: "osqd", colorScheme: "dark" });
  const { enabled } = hackerpotPanel(panel, engine, detectors);
  return { panel, enabled };
}

const DETECTORS = ["decoy-path", "scanner-ua", "sql-injection", "path-traversal", "credential-stuffing"];
const PATHS = ["/.env", "/wp-login.php", "/.git/config", "/admin", "/phpmyadmin/", "/api/v1/users?id=1' OR '1'='1", "/../../etc/passwd"];
const ADDRESSES = ["203.0.113.9", "198.51.100.23", "192.0.2.77", "203.0.113.140"];

function simulatedEngine(enabled: () => Record<string, boolean>): HoneypotEngineLike & { emitSome(): void } {
  const listeners: Array<(hit: never) => void> = [];
  return {
    on(_event: string, listener: (hit: never) => void) {
      listeners.push(listener);
      return () => undefined;
    },
    emitSome() {
      for (let i = 0; i < Math.random() * 6; i += 1) {
        const detector = DETECTORS[Math.floor(Math.random() * DETECTORS.length)] as string;
        if (!enabled()[detector]) continue;
        const hit = { ip: ADDRESSES[Math.floor(Math.random() * ADDRESSES.length)], path: PATHS[Math.floor(Math.random() * PATHS.length)] as string, score: 10 + Math.random() * 40, detections: [{ detector }] };
        for (const listener of listeners) listener(hit as never);
      }
    },
  } as HoneypotEngineLike & { emitSome(): void };
}

if (isMain(import.meta.url)) {
  let switches: Record<string, boolean> = {};
  const engine = simulatedEngine(() => switches);
  const { panel, enabled } = buildHoneypotPanel(engine, DETECTORS);
  switches = enabled;
  await runExample(panel, () => engine.emitSome(), Number(process.env.PORT ?? 9784));
}
