/**
 * A panel for anymail, a mail-sending service: queues, providers and their limits.
 *
 *   npx tsx examples/anymail.ts
 *
 * Shows: `bind()` of an existing configuration object, a gauge against a declared maximum, a
 * throughput chart stacked by provider with the configured send rate drawn across it, a table of
 * the queue answered one page at a time (as a database query would), a feed of bounces, a counter
 * and send-latency percentiles, a sensitive value that needs a second operator's approval, a
 * profile for an incident, and actions that report what they did.
 */
import { createAdminPanel, type TableQuery } from "../src/index.js";
import { isMain, runExample } from "./run.js";

/** What anymail already has: its runtime configuration, read on every send. */
export interface MailConfig {
  sendRatePerSecond: number;
  maxRetries: number;
  defaultProvider: "ses" | "postmark" | "smtp";
  providers: Record<"ses" | "postmark" | "smtp", boolean>;
}

interface Queued {
  id: string;
  to: string;
  subject: string;
  attempts: number;
  queued: number;
}

const PROVIDERS = ["ses", "postmark", "smtp"] as const;

export function buildMailPanel(config: MailConfig = { sendRatePerSecond: 50, maxRetries: 5, defaultProvider: "ses", providers: { ses: true, postmark: true, smtp: false } }) {
  const panel = createAdminPanel({ title: "anymail", theme: "apple" });
  const queue: Queued[] = [];
  let failed = 0;
  let messageNumber = 0;

  panel.group("Queue", { order: 0 });
  panel.viewable(() => queue.length, { label: "Queued messages", group: "Queue", format: "integer", status: { warn: 500, bad: 5000 }, chart: { kind: "area", sampleEveryMs: 1000 } });
  const sent = panel.counter("Messages sent", { group: "Queue" });
  const byProvider = Object.fromEntries(PROVIDERS.map((name) => [name, panel.viewable(0, { label: `Sent via ${name.toUpperCase()}`, group: "Queue", unit: "msg/s", decimals: 1 })])) as Record<(typeof PROVIDERS)[number], ReturnType<typeof panel.viewable<number>>>;
  const bounceRate = panel.viewable(0, { label: "Bounce rate", group: "Queue", format: "percent", status: { warn: 0.03, bad: 0.08 }, chart: "sparkline" });
  panel.viewable(() => failed, { label: "Failed permanently", group: "Queue", format: "integer" });
  const latency = panel.percentiles("Provider latency", { group: "Queue", unit: "ms" });
  const bounces = panel.feed("Bounces", { group: "Queue", perSecond: 20 });
  panel.table<Queued>("Queued", {
    group: "Queue",
    columns: [{ key: "id", label: "Message" }, "to", "subject", { key: "attempts", format: "integer", status: { warn: 3 } }, { key: "queued", format: "timestamp" }],
    // A database would do this with WHERE, ORDER BY, LIMIT and OFFSET; the whole queue never reaches the panel.
    fetch: (query: TableQuery) => {
      const needle = query.search.toLowerCase();
      const matched = needle === "" ? queue : queue.filter((message) => `${message.to} ${message.subject}`.toLowerCase().includes(needle));
      const sorted = query.sort === undefined ? matched : [...matched].sort((a, b) => String(a[query.sort as keyof Queued]).localeCompare(String(b[query.sort as keyof Queued]), undefined, { numeric: true }) * (query.direction === "desc" ? -1 : 1));
      return { rows: sorted.slice(query.offset, query.offset + query.limit), total: matched.length };
    },
    actions: [
      {
        label: "Drop",
        destructive: true,
        run: (id) => {
          const index = queue.findIndex((message) => message.id === id);
          if (index === -1) return "That message has already left the queue.";
          queue.splice(index, 1);
          return `Dropped ${id}.`;
        },
      },
    ],
  });

  panel.group("Limits", { order: 1, description: "Read by the sender on every message, so a change applies to the next one." });
  const rate = panel.bind(config, "sendRatePerSecond", { label: "Send rate", group: "Limits", editable: true, unit: "msg/s", min: 1, max: 500, confirm: true, chart: { kind: "gauge" } });
  panel.bind(config, "maxRetries", { label: "Retries before giving up", group: "Limits", editable: true, min: 0, max: 20, integer: true });
  panel.bind(config, "defaultProvider", { label: "Default provider", group: "Limits", editable: true, options: PROVIDERS });
  panel.chart({ title: "Throughput by provider", group: "Queue", series: Object.values(byProvider), kind: "area", stacked: true, lines: [{ value: rate, label: "Send rate limit" }] });

  panel.group("Providers", { order: 2 });
  const switches = PROVIDERS.map((name) => panel.bind(config.providers, name, { label: `${name.toUpperCase()} enabled`, group: "Providers", editable: true, confirm: true }));
  panel.modifiable("", { id: "smtp-password", label: "SMTP password", group: "Providers", sensitive: true, approval: true, timed: false, description: "Replaced here, never shown here, and only once a second operator approves." });
  panel.profile(
    "Incident: SES degraded",
    [
      [switches[0] as (typeof switches)[number], false],
      [switches[1] as (typeof switches)[number], true],
      [rate, 20],
    ],
    { group: "Providers", description: "Moves traffic to Postmark and slows sending while SES recovers." },
  );

  panel.action(
    "Retry failed messages",
    () => {
      const retried = failed;
      for (let i = 0; i < failed; i += 1) enqueue();
      failed = 0;
      return `Requeued ${retried} messages.`;
    },
    { group: "Queue" },
  );
  panel.action(
    "Purge the queue",
    () => {
      const purged = queue.length;
      queue.length = 0;
      return `Dropped ${purged} queued messages.`;
    },
    { group: "Queue", destructive: true, description: "Queued messages are deleted without being sent." },
  );

  function enqueue(): void {
    messageNumber += 1;
    queue.push({ id: `m${messageNumber}`, to: `user${messageNumber % 997}@example.com`, subject: ["Your receipt", "Password reset", "Weekly digest", "Welcome"][messageNumber % 4] as string, attempts: 0, queued: Date.now() });
  }

  const tick = (): void => {
    for (let i = 0; i < 20 + Math.random() * 60; i += 1) enqueue();
    const live = PROVIDERS.filter((name) => config.providers[name]);
    const capacity = live.length === 0 ? 0 : config.sendRatePerSecond / 2;
    const out = Math.min(queue.length, Math.round(capacity));
    queue.splice(0, out);
    sent.inc(out);
    for (const name of PROVIDERS) (byProvider[name] as { value: number }).value = live.includes(name) ? (out * 2) / live.length : 0;
    for (let i = 0; i < Math.min(out, 20); i += 1) latency.record(40 + Math.random() * 120);
    const bounced = Math.round(out * (0.01 + Math.random() * 0.03));
    for (let i = 0; i < Math.min(bounced, 3); i += 1) bounces.push({ to: `user${Math.floor(Math.random() * 997)}@example.com`, code: 550, reason: "mailbox unavailable" }, "warn");
    bounceRate.value = out === 0 ? 0 : bounced / out;
    for (const message of queue.slice(0, 5)) message.attempts += Math.random() < 0.1 ? 1 : 0;
    if (Math.random() < 0.2) failed += 1;
  };
  return { panel, tick, config };
}

if (isMain(import.meta.url)) {
  const { panel, tick } = buildMailPanel();
  await runExample(panel, tick, Number(process.env.PORT ?? 9782));
}
