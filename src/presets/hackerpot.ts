/**
 * A ready-made panel section for hackerpot: hits, what caught them, who sent them, and detector
 * switches.
 *
 *   import { HoneypotEngine } from "@osqd/hackerpot";
 *   import { hackerpotPanel } from "@osqd/admin-panel-builder/presets";
 *   const { enabled } = hackerpotPanel(panel, engine, detectorIds);
 *   // detectors consult enabled[id] on every request
 *
 * Every string here — a path, an address — was written by an attacker. The panel shows it as text,
 * and every map keyed by one is bounded: `MAX_TRACKED` paths and sources, the least recently seen
 * forgotten first.
 */
import type { AdminPanel } from "../core.js";
import { rejectUnknown } from "../internal/options.js";

export interface HoneypotEngineLike {
  on(event: "hit", listener: (hit: { ip?: string; path: string; score: number; detections: ReadonlyArray<{ detector: string }> }) => void): unknown;
}

/** Distinct paths and sources remembered. 1,000 entries of a short string and two numbers is well under a megabyte. */
export const MAX_TRACKED = 1000;

export interface HackerpotPanelOptions {
  prefix?: string | undefined;
}

export function hackerpotPanel(panel: AdminPanel, engine: HoneypotEngineLike, detectors: readonly string[], options: HackerpotPanelOptions = {}) {
  rejectUnknown(options, ["prefix"], "hackerpotPanel()");
  const prefix = options.prefix ?? "";
  const hitsGroup = `${prefix}Hits`;
  const byDetector: Record<string, number> = {};
  const byPath = new Map<string, number>();
  const sources = new Map<string, { hits: number; score: number; last: number }>();
  const enabled = Object.fromEntries(detectors.map((id) => [id, true])) as Record<string, boolean>;

  const hits = panel.counter("Hits", { group: hitsGroup, chart: "area" });
  panel.viewable(() => ({ ...byDetector }), { label: "Hits by detector", group: hitsGroup, chart: { over: "keys" } });
  panel.viewable(() => Object.fromEntries([...byPath].sort((a, b) => b[1] - a[1]).slice(0, 10)), {
    label: "Most probed paths",
    group: hitsGroup,
    chart: { over: "keys" },
    description: `The ten most requested of the last ${MAX_TRACKED} distinct paths. Paths are attacker-written text and are shown as text.`,
  });
  const recent = panel.feed("Recent hits", { group: hitsGroup, capacity: 200, perSecond: 50 });
  panel.table("Sources", {
    group: hitsGroup,
    rowId: "ip",
    columns: [{ key: "ip", label: "Address" }, { key: "hits", label: "Hits", format: "integer" }, { key: "score", label: "Total score", format: "integer", status: { warn: 50, bad: 100 } }, { key: "last", label: "Last seen", format: "timestamp" }],
    rows: () => [...sources].map(([ip, entry]) => ({ ip, ...entry })),
    pageSize: 20,
  });

  engine.on("hit", (hit) => {
    hits.inc();
    for (const detection of hit.detections) byDetector[detection.detector] = (byDetector[detection.detector] ?? 0) + 1;
    remember(byPath, hit.path, (byPath.get(hit.path) ?? 0) + 1);
    if (hit.ip !== undefined) {
      const entry = sources.get(hit.ip) ?? { hits: 0, score: 0, last: 0 };
      remember(sources, hit.ip, { hits: entry.hits + 1, score: entry.score + hit.score, last: Date.now() });
    }
    recent.push({ path: hit.path, ip: hit.ip ?? "", score: Math.round(hit.score), detectors: hit.detections.map((d) => d.detector).join(",") }, hit.score >= 50 ? "bad" : "warn");
  });

  panel.group(`${prefix}Detectors`, { description: "Read by the engine on every request, so a switch applies to the next one." });
  for (const id of detectors) panel.bind(enabled, id, { label: id, group: `${prefix}Detectors`, editable: true, confirm: true });

  return { enabled, hits, recent };
}

/** Moves a key to the newest position, forgetting the least recently seen past the cap. */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_TRACKED) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}
