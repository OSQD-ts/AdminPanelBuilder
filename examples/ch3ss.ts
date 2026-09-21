/**
 * A panel for ch3ss, a chess server: games, matchmaking, ratings and maintenance.
 *
 *   npx tsx examples/ch3ss.ts
 *
 * Shows: a table of games in progress with row actions, a counter with its rate, move-time
 * percentiles, a shared stacked chart, latency against players online, a histogram of game lengths,
 * a heatmap of when people play, a feed of disconnects, an action that asks for input, a
 * profile that switches several settings at once, and the settings themselves — persisted,
 * confirmed, timed and thresholded. The numbers are simulated; in ch3ss each call sits where the
 * server already counts the thing.
 */
import { createAdminPanel, memoryStore } from "../src/index.js";
import { isMain, runExample } from "./run.js";

const TIME_CONTROLS = ["bullet", "blitz", "rapid", "classical"] as const;
const OPENINGS = ["Sicilian", "French", "Caro-Kann", "Queen's Gambit", "King's Indian", "Ruy Lopez"];
const NAMES = ["ada", "sam", "kasia", "tomek", "lena", "omar", "yuki", "ivan", "zoe", "piotr"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Game {
  id: string;
  white: string;
  black: string;
  control: string;
  moves: number;
  started: number;
}

export function buildChessPanel() {
  // A file store in production (fileStore("data/panel.json")); memory keeps the example stateless.
  const panel = createAdminPanel({ title: "ch3ss", instance: "eu-1", theme: "material", store: memoryStore() });
  const games = new Map<string, Game>();
  let gameNumber = 0;

  panel.group("Games", { order: 0, description: "What is being played right now." });
  const playersOnline = panel.viewable(0, { label: "Players online", group: "Games", format: "integer", status: { warn: 1200, bad: 1500 }, chart: { in: "Load", kind: "area", stacked: false } });
  const activeGames = panel.viewable(() => games.size, { label: "Active games", group: "Games", format: "integer", chart: { in: "Load", kind: "area" } });
  const started = panel.counter("Games started", { group: "Games" });
  const moveTime = panel.percentiles("Server move time", { group: "Games", unit: "ms" });
  const moveLatency = panel.viewable(0, { label: "Move latency (p95)", group: "Games", unit: "ms", decimals: 0, chart: { over: playersOnline, title: "Latency against players online" } });
  const openings = panel.viewable<Record<string, number>>({}, { label: "Openings played today", group: "Games", chart: { over: "keys" } });
  const gameLengths: number[] = [];
  panel.viewable(() => gameLengths.slice(-500), { label: "Game length (moves)", group: "Games", chart: { kind: "histogram", bins: 12 } });
  const heat = Object.fromEntries(DAYS.map((day) => [day, Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [String(hour).padStart(2, "0"), 0]))])) as Record<string, Record<string, number>>;
  panel.viewable(() => heat, { label: "Games started by day and hour", group: "Games", chart: { kind: "heatmap" }, span: "full" });
  panel.table("Games in progress", {
    group: "Games",
    rowId: "id",
    columns: [{ key: "id", label: "Game" }, "white", "black", { key: "control", label: "Time control" }, { key: "moves", format: "integer", status: { warn: 150 } }, { key: "started", format: "timestamp" }],
    rows: () => [...games.values()],
    actions: [
      {
        label: "Adjudicate draw",
        confirm: true,
        run: (id) => {
          const game = games.get(id);
          if (game === undefined) return "That game has already ended.";
          games.delete(id);
          return `Game ${id} between ${game.white} and ${game.black} was drawn by an operator.`;
        },
      },
    ],
  });
  const disconnects = panel.feed("Disconnects", { group: "Games", capacity: 100 });

  panel.group("Matchmaking", { order: 1, description: "Who is waiting, and how far apart the server may pair them." });
  const queue = panel.viewable<Record<string, number>>(Object.fromEntries(TIME_CONTROLS.map((control) => [control, 0])), { label: "Waiting per time control", group: "Matchmaking", chart: { over: "keys" } });
  const ratingGap = panel.modifiable(200, {
    id: "max-rating-gap",
    label: "Largest rating gap",
    group: "Matchmaking",
    min: 50,
    max: 1000,
    step: 50,
    persist: true,
    chart: "step",
    description: "Pairings further apart than this wait for a closer opponent. Wider means shorter queues and more lopsided games.",
  });
  const featured = panel.modifiable<(typeof TIME_CONTROLS)[number]>("blitz", { label: "Featured time control", group: "Matchmaking", options: TIME_CONTROLS, persist: true });
  const guests = panel.modifiable(true, { label: "Guests may play", group: "Matchmaking", confirm: true, description: "Switching this off ends no running game; new guests see the sign-up page." });

  panel.group("Ratings", { order: 2 });
  const distribution = panel.viewable<Record<string, number>>({}, { label: "Rating distribution", group: "Ratings", chart: { over: "keys" } });
  const provisional = panel.viewable(0, { label: "Provisional players", group: "Ratings", format: "integer" });
  panel.action("Ban player", ({ input, by }) => `${String(input.player)} is banned for ${String(input.days)} days (${by}). Reason: ${String(input.reason ?? "none given")}.`, {
    group: "Ratings",
    destructive: true,
    input: { player: { label: "Player", maxLength: 40, pattern: /^[a-z0-9_]+$/ }, days: { label: "Days", kind: "number", min: 1, max: 365, integer: true, default: 7 }, reason: { label: "Reason", optional: true, maxLength: 200 } },
  });

  panel.group("Maintenance", { order: 3 });
  const maintenance = panel.modifiable(false, { label: "Maintenance mode", group: "Maintenance", confirm: true, description: "Stops new games. Running games finish." });
  const motd = panel.modifiable("", { label: "Message of the day", group: "Maintenance", multiline: true, maxLength: 280, persist: true });
  panel.profile(
    "Tournament mode",
    [
      [featured, "classical"],
      [guests, false],
      [ratingGap, 100],
    ],
    { group: "Maintenance", description: "Classical featured, guests off, tight pairings." },
  );
  panel.profile(
    "Evening maintenance",
    [
      [maintenance, true],
      [motd, "Maintenance until 22:00. Running games will finish."],
    ],
    { group: "Maintenance" },
  );
  panel.action(
    "End abandoned games",
    () => {
      let ended = 0;
      for (const [id, game] of games) {
        if (game.moves < 3) {
          games.delete(id);
          ended += 1;
        }
      }
      return `Ended ${ended} games that never got going.`;
    },
    { group: "Maintenance", destructive: true, description: "Games with fewer than three moves are adjudicated as abandoned." },
  );

  let t = 0;
  const tick = (): void => {
    t += 1;
    const wave = 0.5 + 0.5 * Math.sin(t / 20);
    playersOnline.value = Math.round(400 + 600 * wave + Math.random() * 40);
    const target = maintenance.value ? 0 : Math.round(playersOnline.value * 0.02);
    while (games.size < target) {
      gameNumber += 1;
      const white = NAMES[Math.floor(Math.random() * NAMES.length)] as string;
      const black = NAMES[Math.floor(Math.random() * NAMES.length)] as string;
      games.set(`g${gameNumber}`, { id: `g${gameNumber}`, white, black, control: featured.value, moves: 0, started: Date.now() });
      started.inc();
      const now = new Date();
      const row = heat[DAYS[(now.getDay() + 6) % 7] as string] as Record<string, number>;
      const hour = String(now.getHours()).padStart(2, "0");
      row[hour] = (row[hour] ?? 0) + 1;
    }
    for (const [id, game] of games) {
      game.moves += 1 + Math.floor(Math.random() * 3);
      moveTime.record(5 + Math.random() * 40 + (Math.random() < 0.05 ? 200 : 0));
      if (Math.random() < 0.03 || games.size > target + 2) {
        games.delete(id);
        gameLengths.push(game.moves);
      }
      if (Math.random() < 0.005) disconnects.push({ player: game.white, game: id }, "warn");
    }
    moveLatency.value = 20 + playersOnline.value * 0.05 + Math.random() * 15;
    const opening = OPENINGS[t % OPENINGS.length] as string;
    openings.value = { ...openings.value, [opening]: (openings.value[opening] ?? 0) + 1 };
    queue.value = Object.fromEntries(TIME_CONTROLS.map((control) => [control, Math.max(0, Math.round((control === featured.value ? 30 : 10) * wave * (400 / ratingGap.value) + Math.random() * 5))]));
    if (t % 10 === 1) {
      distribution.value = Object.fromEntries([800, 1000, 1200, 1400, 1600, 1800, 2000, 2200].map((bucket) => [`${bucket}`, Math.round(900 * Math.exp(-(((bucket - 1450) / 350) ** 2)) + Math.random() * 20)]));
      provisional.value = Math.round((guests.value ? 120 : 60) + Math.random() * 10);
    }
    void activeGames;
  };
  return { panel, tick };
}

if (isMain(import.meta.url)) {
  const { panel, tick } = buildChessPanel();
  await runExample(panel, tick);
}
