/**
 * Changing production safely: every guard the engine puts between an operator and a setting.
 *
 *   npx tsx examples/change-control.ts
 *   APB_LOG=changes.jsonl npx tsx examples/change-control.ts   # keep a chained change log on disk
 *
 * A payments service's settings, from the harmless to the dangerous:
 *
 * - Limits — bounds and steps the page checks and the server checks again; a check of the
 *   application's own (`validate`); a change that needs a second operator (`approval`); one that
 *   needs a reason; persisted changes that survive a restart; "for a while" changes that undo
 *   themselves; a setting charted as it changes, so its changes are marked in time.
 * - Features — a choice from a list, with code run after a change (`onChange`); a switch; a setting
 *   shown only while another is on (`visibleWhen`) and one refused while another is off
 *   (`disabledWhen`); a URL checked by something slow (`validateAsync`); rules edited as JSON.
 * - Secrets — replaced from the page, never shown by it, and only with a second operator.
 * - Incidents — profiles that change several settings as one change, one needing approval; an
 *   action with a form, proposed and approved like a value; one that asks for its name to be typed.
 * - Log — with `APB_LOG`, a hash-chained change log on disk, verified from the page, and every
 *   change as a JSON line on stderr (an audit sink; a file, syslog or a webhook take the same place).
 *
 * Every change lists who made it and why under Activity, and the ones that can be undone can be.
 */
import { readFile } from "node:fs/promises";
import { createAdminPanel, fileChangeLog, jsonLineSink, memoryStore, type ValueStore, verifyChain } from "../src/index.js";
import { isMain, runExample } from "./run.js";

const PROVIDERS = ["stripe", "adyen", "mollie"] as const;

export function buildChangeControlPanel(options: { store?: ValueStore; logFile?: string | undefined; audit?: (line: string) => void } = {}) {
  const panel = createAdminPanel({
    title: "Payments",
    instance: "eu-1",
    // A file store in production (fileStore("data/panel.json")); memory keeps the example stateless.
    store: options.store ?? memoryStore(),
    // Chart histories outlive a restart too.
    keepHistory: true,
    changeLog: options.logFile === undefined ? undefined : fileChangeLog(options.logFile, { rotate: { daily: true }, keep: { days: 90 } }),
  });
  if (options.audit !== undefined) panel.on("change", jsonLineSink(options.audit));

  // ---- Limits ---------------------------------------------------------------------------------
  const limits = panel.group("Limits", { order: 0, description: "What one payment, one refund and one day may come to." });
  const refundLimit = limits.modifiable(500, {
    label: "Refund limit",
    unit: "EUR",
    min: 0,
    max: 10_000,
    step: 50,
    approval: true,
    persist: true,
    chart: "step",
    description: "Refunds above this need a second person. Changing it needs one too.",
  });
  limits.modifiable(20_000, {
    label: "Daily payout cap",
    unit: "EUR",
    min: 1000,
    max: 1_000_000,
    integer: true,
    confirm: true,
    reason: "required",
    persist: true,
    validate: (cap) => (cap < refundLimit.value * 10 ? `The cap must cover at least ten refunds at the limit (${refundLimit.value * 10} EUR).` : undefined),
  });
  const retries = limits.modifiable(3, { label: "Retry attempts", min: 0, max: 10, integer: true, description: "Change it for a while from the page: it goes back by itself." });

  // ---- Features -------------------------------------------------------------------------------
  const features = panel.group("Features", { order: 1 });
  const switches: string[] = [];
  const provider = features.modifiable<(typeof PROVIDERS)[number]>("stripe", {
    label: "Card provider",
    options: PROVIDERS,
    confirm: true,
    persist: true,
    onChange: (next, { previous, by }) => {
      switches.push(`${by} moved cards from ${previous} to ${next}`);
    },
  });
  const threeDs = features.modifiable(true, { label: "Require 3-D Secure", confirm: true, reason: "required", description: "Off lowers friction and raises fraud. Say why." });
  const newCheckout = features.modifiable(false, { label: "New checkout flow" });
  features.modifiable(0.1, { label: "New checkout rollout", format: "percent", min: 0, max: 1, step: 0.05, visibleWhen: () => newCheckout.value, description: "Share of sessions that get the new flow." });
  const maintenance = features.modifiable(false, { label: "Maintenance mode", confirm: true, reason: "required" });
  const banner = features.modifiable("", {
    label: "Maintenance banner",
    multiline: true,
    maxLength: 280,
    disabledWhen: () => (maintenance.value ? false : "the banner shows only during maintenance"),
  });
  features.modifiable("https://hooks.example.com/payments", {
    label: "Webhook URL",
    pattern: /^https:\/\//,
    // Something slow: a real check would request the URL. The page waits for the answer.
    validateAsync: async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return /localhost|127\.0\.0\.1/.test(url) ? "A webhook on this machine would never be reached by the provider." : undefined;
    },
  });
  features.modifiable<Record<string, string>>({ eu: "adyen", us: "stripe", default: "stripe" }, { label: "Routing rules", description: "Which provider takes cards by region, as JSON." });

  // ---- Secrets --------------------------------------------------------------------------------
  const secrets = panel.group("Secrets", { order: 2 });
  secrets.modifiable("", { id: "provider-api-key", label: "Provider API key", sensitive: true, approval: true, timed: false, description: "Replaced here, never shown here, and only once a second operator approves." });

  // ---- Incidents ------------------------------------------------------------------------------
  const incidents = panel.group("Incidents", { order: 3, description: "Several settings at once, as one change you can undo." });
  incidents.profile(
    "Provider degraded",
    [
      [provider, "adyen"],
      [retries, 1],
      [threeDs, true],
    ],
    { approval: true, description: "Moves cards to Adyen, stops retrying and keeps 3-D Secure on." },
  );
  incidents.profile("Maintenance window", [
    [maintenance, true],
    [banner, "Payments are paused for maintenance. Nothing is charged twice."],
  ]);
  const refunds: string[] = [];
  incidents.action(
    "Refund an order",
    ({ input, by, reason }) => {
      refunds.push(`${String(input.order)}: ${String(input.amount)} EUR by ${by} (${reason ?? "no reason"})`);
      return `Refunded ${String(input.amount)} EUR on ${String(input.order)}.`;
    },
    {
      approval: true,
      input: { order: { label: "Order", pattern: /^ord_[a-z0-9]{6,}$/, maxLength: 40 }, amount: { label: "Amount (EUR)", kind: "number", min: 1, max: 10_000 }, notify: { label: "Tell the customer", kind: "boolean", default: true } },
      description: "Refunds go through a second operator, with the order and amount as proposed.",
    },
  );
  const idempotencyKeys = new Set(Array.from({ length: 1200 }, (_, index) => `key-${index}`));
  incidents.action(
    "Purge idempotency keys",
    () => {
      const purged = idempotencyKeys.size;
      idempotencyKeys.clear();
      return `Purged ${purged} keys. Retried requests may now be charged twice.`;
    },
    { confirm: "type", destructive: true, description: "Cannot be undone: type its name to run it." },
  );

  // ---- Log ------------------------------------------------------------------------------------
  const logFile = options.logFile;
  if (logFile !== undefined) {
    panel.group("Log", { order: 4 }).action(
      "Verify the change log",
      async () => {
        await panel.flushed();
        const lines = (await readFile(logFile, "utf8").catch(() => "")).split("\n").filter((line) => line.trim() !== "");
        const result = await verifyChain(lines.map((line) => JSON.parse(line)));
        return result.ok ? `The chain holds over ${result.checked} records.` : `Record ${result.id} breaks the chain: ${result.reason}.`;
      },
      { description: "Checks that no line of the log was deleted, edited or reordered." },
    );
  }

  const volume = limits.viewable(0, { label: "Payments a minute", format: "integer", chart: true });
  const tick = (): void => {
    volume.value = Math.round((maintenance.value ? 0 : 300) + Math.random() * 60);
  };
  return { panel, tick, switches, refunds };
}

if (isMain(import.meta.url)) {
  const { panel, tick } = buildChangeControlPanel({ logFile: process.env.APB_LOG, audit: (line) => process.stderr.write(`${line}\n`) });
  await runExample(panel, tick);
}
