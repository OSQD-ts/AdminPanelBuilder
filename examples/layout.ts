/**
 * A tab with many values, made readable: sections, list cards, a divider and emphasis.
 *
 *   npx tsx examples/layout.ts
 *
 * The "Server" tab holds about forty values. Declared one card each they are a wall of identical
 * boxes, every one as loud as the next (pass `{ divided: false }` to buildLayoutPanel to see that).
 * Here the same values are:
 *
 * - in sections — Right now, Matches, Moderation, Limits, Health — each with a heading and a line
 *   about it, the last two closed until somebody opens them; the tab lists the sections at the top;
 * - the many small settings gathered into list cards, one row each, with their fields inline;
 * - the two numbers people open the panel for marked `primary`, standing out from the rest;
 * - a divider between the game's readings and the machines';
 * - a filter box over the tab, since it holds more than a screen of values.
 *
 * Nothing about the values themselves changes: the same declarations, with `section`, `card` and
 * `emphasis` added.
 */
import { createAdminPanel } from "../src/index.js";
import { isMain, runExample } from "./run.js";

export function buildLayoutPanel(options: { divided?: boolean } = {}) {
  const divided = options.divided !== false;
  const panel = createAdminPanel({ title: "Game server" });
  const server = panel.group("Server");
  const where = (section: string, extra: Record<string, unknown> = {}) => (divided ? { section, ...extra } : {});

  if (divided) {
    server.section("Right now", { description: "What the servers are doing this minute." });
    server.section("Matches", { description: "How games are made and played." });
    server.section("Moderation", { description: "Reports, bans and the queue behind them." });
    server.section("Limits", { description: "Rate limits and sessions for the API.", collapsed: true });
    server.section("Health", { description: "Every dependency the game needs.", collapsed: true, density: "compact" });
    server.card("Move latency", { section: "Right now", layout: "grid", span: "half" });
    server.card("Load", { section: "Right now", layout: "grid", span: "half" });
    server.card("Rules", { section: "Matches", layout: "columns:2", description: "Changed at the start of the next match." });
    server.card("Features", { section: "Matches", layout: "columns:2" });
    server.card("Queue", { section: "Moderation", layout: "list" });
    server.card("API", { section: "Limits", layout: "list" });
    server.card("Dependencies", { section: "Health", layout: "grid" });
  }

  const players = server.viewable(1243, { label: "Players online", format: "integer", ...where("Right now", { emphasis: "primary" }) });
  const matches = server.viewable(87, { label: "Matches running", format: "integer", ...where("Right now", { emphasis: "primary" }) });
  const latencies = ["p50", "p95", "p99"].map((p, index) => server.viewable([18, 64, 130][index] as number, { label: divided ? p : `Move latency ${p}`, unit: "ms", ...where("Right now", divided ? { card: "Move latency" } : {}) }));
  if (divided) server.divider({ section: "Right now", label: "Machines" });
  const cpu = server.viewable(42.5, { label: "CPU", unit: "%", ...where("Right now", divided ? { card: "Load" } : {}) });
  const memory = server.viewable(61, { label: "Memory", unit: "%", ...where("Right now", divided ? { card: "Load" } : {}) });

  server.modifiable(200, { label: "Largest rating gap", min: 50, max: 1000, description: "How far apart two players may be rated and still meet.", ...where("Matches") });
  server.modifiable(30, { label: "Queue timeout", unit: "s", min: 5, max: 120, ...where("Matches") });
  server.modifiable("eu-west", { label: "Default region", options: ["eu-west", "us-east", "ap-south"], ...where("Matches") });
  const rules: Array<[string, number]> = [["Max players per match", 10], ["Min players per match", 2], ["Warmup", 15], ["Overtime", 60], ["Respawn delay", 5], ["Max ping", 180], ["Kick idle after", 120], ["Vote kick threshold", 60]];
  for (const [label, value] of rules) server.modifiable(value, { label, min: 0, max: 600, ...where("Matches", divided ? { card: "Rules" } : {}) });
  for (const label of ["Ranked", "Chat", "Voice", "Spectators", "Crossplay", "Replays", "Strict anti-cheat"]) server.modifiable(true, { label, ...where("Matches", divided ? { card: "Features" } : {}) });
  server.modifiable(false, { label: "Maintenance mode", description: "Stops new matches; running ones finish.", ...where("Matches") });

  const reports = server.viewable(7, { label: "Reports open", format: "integer", ...where("Moderation", { emphasis: "primary" }) });
  for (const label of ["Bans today", "Reports closed today", "Refunds pending", "Tickets open", "Tickets escalated"]) server.viewable(3, { label, format: "integer", ...where("Moderation", divided ? { card: "Queue" } : {}) });

  for (const label of ["Requests per minute", "Burst", "Login attempts", "Session length", "Idle timeout"]) server.modifiable(60, { label, min: 1, max: 1000, ...where("Limits", divided ? { card: "API" } : {}) });
  for (const label of ["Build", "Region", "Database", "Cache", "Queue broker", "Mail"]) server.viewable("ok", { label, ...where("Health", divided ? { card: "Dependencies" } : {}) });

  const tick = (): void => {
    players.value = Math.max(0, players.value + Math.round((Math.random() - 0.5) * 40));
    matches.value = Math.max(0, matches.value + Math.round((Math.random() - 0.5) * 4));
    for (const latency of latencies) latency.value = Math.max(1, Math.round(latency.value * (0.95 + Math.random() * 0.1)));
    cpu.value = Math.round(Math.min(100, Math.max(0, cpu.value + (Math.random() - 0.5) * 6)) * 10) / 10;
    memory.value = Math.round(Math.min(100, Math.max(0, memory.value + (Math.random() - 0.5) * 2)));
    if (Math.random() < 0.1) reports.value = Math.max(0, reports.value + (Math.random() < 0.6 ? 1 : -1));
  };
  return { panel, tick };
}

if (isMain(import.meta.url)) {
  const { panel, tick } = buildLayoutPanel();
  await runExample(panel, tick);
}
