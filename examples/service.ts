/**
 * A web service at a glance: what the engine draws, and how a panel is laid out.
 *
 *   npx tsx examples/service.ts
 *
 * Five groups, declared through their handles so no declaration repeats a group's name:
 *
 * - Traffic — a counter with its rate, values sharing one chart ("Load"), a stacked chart of
 *   several values, bars over the keys of a record, a heatmap of a week by hour.
 * - Latency — percentiles from observations, a value plotted against another, a histogram, a
 *   limit drawn across a chart from a setting (change it, and the change is marked on the chart).
 * - Errors — a status that colours a value and raises an alert when it holds, a feed with levels,
 *   and the panel's own alerts written into that feed.
 * - Capacity — a gauge, values read from functions on a timer, a rate of a total kept elsewhere.
 * - Jobs — a table paged, sorted and searched by the application (as a database query would),
 *   with actions on each row, beside a chart of the same queue by state.
 *
 * One size is given in cells, where the default would not suit (the stacked chart takes half the row
 * rather than all of it); everything else is sized and placed by the panel. Viewers may switch to a custom theme,
 * "Harbor", from Settings, next to the built-in ones.
 */
import { createAdminPanel, defineTheme, type TableQuery } from "../src/index.js";
import { isMain, runExample } from "./run.js";

const ENDPOINTS = ["/", "/search", "/product", "/checkout", "/api/orders", "/api/users"] as const;
const REGIONS = ["eu-west", "us-east", "ap-south"] as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const JOB_KINDS = ["send-receipt", "resize-image", "sync-inventory", "rebuild-search"] as const;

interface Job {
  id: string;
  kind: (typeof JOB_KINDS)[number];
  state: "queued" | "running" | "failed" | "done";
  attempts: number;
  queued: number;
  region: (typeof REGIONS)[number];
}

/** A theme of the application's own, offered to viewers beside the built-in ones. */
export const harbor = defineTheme({
  name: "harbor",
  label: "Harbor",
  light: { accent: "#00796b", link: "#00695c", accentStrong: "#00796b", onAccent: "#ffffff", focus: "#00796b", switchOn: "#00796b", headerBackground: "#004d40", headerInk: "#ffffff" },
  dark: { accent: "#4db6ac", link: "#80cbc4", accentStrong: "#4db6ac", onAccent: "#00251a", focus: "#4db6ac", switchOn: "#4db6ac", headerBackground: "#00302a" },
  shape: { radius: "10px", radiusSmall: "6px", buttonCase: "none" },
});

export function buildServicePanel() {
  const panel = createAdminPanel({ title: "Storefront", instance: "web-1", themes: [harbor] });

  // ---- Traffic --------------------------------------------------------------------------------
  const traffic = panel.group("Traffic", { order: 0, description: "Who is arriving, where from, and for what." });
  const requests = traffic.counter("Requests");
  const inFlight = traffic.viewable(0, { label: "In flight", format: "integer", status: { warn: 150, bad: 300 }, alert: { at: "warn", forMs: 30_000 }, chart: { in: "Load", kind: "area" } });
  const users = traffic.viewable(0, { label: "Signed-in users", format: "integer", chart: { in: "Load", kind: "area" } });
  const byRegion = REGIONS.map((region) => traffic.viewable(0, { label: `Requests from ${region}`, unit: "req/s", decimals: 1 }));
  traffic.chart({ title: "Requests by region", series: byRegion, kind: "area", stacked: true, size: { w: 6, h: 5 } });
  const byEndpoint = traffic.viewable<Record<string, number>>({}, { label: "Requests by endpoint", chart: { over: "keys" } });
  // A week of history to start from: busy in the day, quiet at night, quieter at the weekend.
  const week = Object.fromEntries(
    DAYS.map((day, index) => [day, Object.fromEntries(Array.from({ length: 24 }, (_, hour) => [String(hour).padStart(2, "0"), Math.round((index >= 5 ? 600 : 1000) * Math.max(0.05, Math.sin(((hour - 6) / 24) * Math.PI * 2) + 0.4) * (0.8 + Math.random() * 0.4))]))]),
  ) as Record<string, Record<string, number>>;
  traffic.viewable(() => week, { label: "Requests by day and hour", chart: { kind: "heatmap" } });

  // ---- Latency --------------------------------------------------------------------------------
  const latency = panel.group("Latency", { order: 1, description: "How long answers take, and what makes them slow." });
  const response = latency.percentiles("Response time", { unit: "ms" });
  const objective = latency.modifiable(250, { label: "Latency objective", unit: "ms", min: 50, max: 2000, step: 10, description: "A response slower than this counts against the objective. Drawn across the database chart." });
  const database = latency.viewable(0, { label: "Database time", unit: "ms", decimals: 1, chart: { lines: [{ value: objective, label: "Objective" }] } });
  const underLoad = latency.viewable(0, { label: "p95 under load", unit: "ms", decimals: 0, chart: { over: inFlight, title: "Response time against requests in flight" } });
  const sizes: number[] = [];
  latency.viewable(() => sizes.slice(-400), { label: "Response size (KB)", chart: { kind: "histogram", bins: 14 } });

  // ---- Errors ---------------------------------------------------------------------------------
  const errors = panel.group("Errors", { order: 2, description: "What went wrong, newest first." });
  const errorRate = errors.viewable(0, { label: "Error rate", format: "percent", status: { warn: 0.01, bad: 0.05 }, alert: { forMs: 20_000 }, chart: "sparkline" });
  const byStatus = errors.viewable<Record<string, number>>({ "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 }, { label: "Responses by status", chart: { over: "keys" } });
  const log = errors.feed("Errors", { capacity: 300, perSecond: 30 });
  // The panel's own alerts join the log: one line when a status holds, not one per poll.
  panel.on("alert", (alert) => log.push({ alert: alert.message }, alert.status));

  // ---- Capacity -------------------------------------------------------------------------------
  const capacity = panel.group("Capacity", { order: 3 });
  const cpu = capacity.viewable(0, { label: "CPU", format: "percent", status: { warn: 0.75, bad: 0.9 }, chart: { kind: "gauge", min: 0, max: 1 } });
  capacity.viewable(() => process.memoryUsage().heapUsed, { label: "Heap in use", format: "bytes", chart: { sampleEveryMs: 2000 } });
  capacity.viewable(() => process.uptime() * 1000, { label: "Uptime", format: "duration" });
  let opened = 0;
  capacity.rate("Connections opened", () => opened, { per: "second" });

  // ---- Jobs -----------------------------------------------------------------------------------
  const queue = panel.group("Jobs", { order: 4, description: "The background queue. Search it, sort it, retry or cancel a job." });
  const jobs: Job[] = [];
  let jobNumber = 0;
  queue.table<Job>("Jobs", {
    pageSize: 15,
    columns: [{ key: "id", label: "Job" }, "kind", "state", { key: "attempts", format: "integer", status: { warn: 3, bad: 5 } }, "region", { key: "queued", format: "timestamp" }],
    // A database answers this with WHERE, ORDER BY, LIMIT and OFFSET: the whole queue never reaches the panel.
    fetch: (query: TableQuery) => {
      const needle = query.search.toLowerCase();
      const matched = needle === "" ? jobs : jobs.filter((job) => `${job.id} ${job.kind} ${job.state} ${job.region}`.toLowerCase().includes(needle));
      const key = query.sort as keyof Job | undefined;
      const sorted = key === undefined ? matched : [...matched].sort((a, b) => String(a[key]).localeCompare(String(b[key]), undefined, { numeric: true }) * (query.direction === "desc" ? -1 : 1));
      return { rows: sorted.slice(query.offset, query.offset + query.limit), total: matched.length };
    },
    actions: [
      {
        label: "Retry",
        run: (id) => {
          const job = jobs.find((entry) => entry.id === id);
          if (job === undefined || job.state !== "failed") return `${id} has not failed; nothing to retry.`;
          job.state = "queued";
          return `${id} is queued again.`;
        },
      },
      {
        label: "Cancel",
        destructive: true,
        run: (id) => {
          const at = jobs.findIndex((entry) => entry.id === id);
          if (at === -1) return `${id} has already left the queue.`;
          jobs.splice(at, 1);
          return `${id} is cancelled.`;
        },
      },
    ],
  });
  const byState = queue.viewable<Record<string, number>>({}, { label: "Jobs by state", chart: { over: "keys" } });
  queue.action(
    "Retry every failed job",
    () => {
      const failed = jobs.filter((job) => job.state === "failed");
      for (const job of failed) job.state = "queued";
      return failed.length === 0 ? "No job had failed." : `Queued ${failed.length} failed jobs again.`;
    },
    { description: "Each goes back to the end of the queue with its attempts kept." },
  );

  // ---- The simulation -------------------------------------------------------------------------
  let t = 0;
  const tick = (): void => {
    t += 1;
    const wave = 0.5 + 0.5 * Math.sin(t / 25);
    const arriving = Math.round(40 + 160 * wave + Math.random() * 20);
    requests.inc(arriving);
    inFlight.value = Math.round(arriving * (0.8 + Math.random() * 0.6));
    users.value = Math.round(800 + 2000 * wave + Math.random() * 50);
    for (const [index, region] of byRegion.entries()) region.value = arriving * ([0.5, 0.35, 0.15][index] ?? 0) * (0.9 + Math.random() * 0.2);
    const endpoints = { ...byEndpoint.value };
    for (let i = 0; i < 8; i += 1) {
      const endpoint = ENDPOINTS[Math.floor(Math.random() ** 2 * ENDPOINTS.length)] as string;
      endpoints[endpoint] = (endpoints[endpoint] ?? 0) + 1;
    }
    byEndpoint.value = endpoints;
    const now = new Date();
    const day = DAYS[(now.getDay() + 6) % 7] as string;
    const hour = String(now.getHours()).padStart(2, "0");
    (week[day] as Record<string, number>)[hour] = ((week[day] as Record<string, number>)[hour] ?? 0) + arriving;

    for (let i = 0; i < 10; i += 1) response.record(Math.round(40 + Math.random() * 120 + inFlight.value * Math.random()));
    database.value = 15 + inFlight.value * 0.4 + Math.random() * 20;
    underLoad.value = 60 + inFlight.value * 0.9 + Math.random() * 30;
    for (let i = 0; i < 5; i += 1) sizes.push(Math.round(2 + Math.random() ** 3 * 400));

    const failures = Math.random() < 0.08 ? Math.round(Math.random() * 12) : 0;
    errorRate.value = failures / Math.max(1, arriving);
    const statuses = { ...byStatus.value };
    statuses["2xx"] = (statuses["2xx"] ?? 0) + arriving - failures;
    statuses["4xx"] = (statuses["4xx"] ?? 0) + (failures > 0 ? 1 : 0);
    statuses["5xx"] = (statuses["5xx"] ?? 0) + Math.max(0, failures - 1);
    byStatus.value = statuses;
    if (failures > 0) log.push({ status: 500 + Math.floor(Math.random() * 4), path: ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)] as string, took: `${Math.round(200 + Math.random() * 800)} ms` }, failures > 6 ? "bad" : "warn");

    cpu.value = Math.min(1, 0.2 + 0.6 * wave + Math.random() * 0.1);
    opened += Math.round(arriving / 10);

    if (Math.random() < 0.6) {
      jobNumber += 1;
      jobs.push({ id: `job-${jobNumber}`, kind: JOB_KINDS[jobNumber % JOB_KINDS.length] as Job["kind"], state: "queued", attempts: 0, queued: Date.now(), region: REGIONS[jobNumber % REGIONS.length] as Job["region"] });
    }
    for (const job of jobs) {
      if (job.state === "queued" && Math.random() < 0.3) job.state = "running";
      else if (job.state === "running" && Math.random() < 0.4) {
        job.attempts += 1;
        job.state = Math.random() < 0.15 ? "failed" : "done";
      }
    }
    while (jobs.length > 400) jobs.shift();
    const counts: Record<string, number> = {};
    for (const job of jobs) counts[job.state] = (counts[job.state] ?? 0) + 1;
    byState.value = counts;
  };
  return { panel, tick };
}

if (isMain(import.meta.url)) {
  const { panel, tick } = buildServicePanel();
  await runExample(panel, tick);
}
