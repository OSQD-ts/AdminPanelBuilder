/**
 * Alerts: a value whose status turned bad, said once, where the other alerts go.
 *
 * Checked once a second on the panel's timer. An alert fires when the status reaches the rule's
 * level and has held for `forMs`, then stays quiet until the status recovers and the cooldown has
 * passed — a spike lasting an hour is one event, not sixty, and a value flapping across its
 * threshold is one event per cooldown.
 */
import { AdminPanelConfigError } from "../errors.js";
import type { Alert, AlertOptions, Status, StatusRule } from "../types.js";
import type { PanelValue } from "../values/handle.js";
import { toJson } from "../values/kinds.js";
import { statusOf } from "../values/status.js";

const DEFAULT_COOLDOWN_MS = 600_000;

interface Rule {
  value: PanelValue<unknown>;
  at: "warn" | "bad";
  forMs: number;
  cooldownMs: number;
  since: number | undefined;
  lastAlert: number | undefined;
  raised: boolean;
}

export function checkAlert(label: string, alert: AlertOptions | undefined, status: StatusRule | undefined): AlertOptions | undefined {
  if (alert === undefined) return undefined;
  if (status === undefined) throw new AdminPanelConfigError(`"${label}" has an alert but no status, so it could never fire; give it status thresholds`);
  for (const key of Object.keys(alert)) if (!["at", "forMs", "cooldownMs"].includes(key)) throw new AdminPanelConfigError(`"${label}" has an alert option "${key}" that nothing reads`);
  if (alert.at !== undefined && alert.at !== "warn" && alert.at !== "bad") throw new AdminPanelConfigError(`"${label}" alerts at ${JSON.stringify(alert.at)}; it is "warn" or "bad"`);
  for (const [name, ms] of [["forMs", alert.forMs], ["cooldownMs", alert.cooldownMs]] as const) {
    if (ms !== undefined && (!Number.isFinite(ms) || ms < 0)) throw new AdminPanelConfigError(`"${label}" has an alert ${name} of ${ms}; it is a number of milliseconds, zero or more`);
  }
  return alert;
}

export class AlertMonitor {
  private readonly rules: Rule[] = [];

  constructor(
    private readonly read: (value: PanelValue<unknown>) => unknown,
    private readonly raise: (alert: Alert) => void,
  ) {}

  get size(): number {
    return this.rules.length;
  }

  add(value: PanelValue<unknown>, options: AlertOptions): void {
    this.rules.push({ value, at: options.at ?? "bad", forMs: options.forMs ?? 0, cooldownMs: options.cooldownMs ?? DEFAULT_COOLDOWN_MS, since: undefined, lastAlert: undefined, raised: false });
  }

  check(now: number): void {
    for (const rule of this.rules) {
      const reading = this.read(rule.value);
      const status = statusOf(rule.value.definition.status, reading);
      const reached = status === "bad" || (rule.at === "warn" && status === "warn");
      if (!reached) {
        rule.since = undefined;
        rule.raised = false;
        continue;
      }
      rule.since ??= now;
      if (rule.raised || now - rule.since < rule.forMs) continue;
      if (rule.lastAlert !== undefined && now - rule.lastAlert < rule.cooldownMs) continue;
      rule.raised = true;
      rule.lastAlert = now;
      this.raise(describeAlert(rule.value, status as Status, reading, rule.since, now));
    }
  }
}

function describeAlert(value: PanelValue<unknown>, status: Status, reading: unknown, since: number, now: number): Alert {
  const rule = value.definition.status;
  const threshold = typeof rule === "object" && rule !== null ? (status === "bad" ? rule.bad : rule.warn) : undefined;
  const held = Math.round((now - since) / 1000);
  const shown = value.definition.sensitive ? "(hidden)" : JSON.stringify(toJson(reading));
  const alert: Alert = {
    target: value.id,
    label: value.label,
    status: status === "bad" ? "bad" : "warn",
    reading: value.definition.sensitive ? null : toJson(reading),
    since,
    at: now,
    message: `${value.label} is ${status === "bad" ? "bad" : "at warning"}: ${shown}${threshold === undefined ? "" : ` (threshold ${threshold})`}${held > 0 ? `, for ${held} s` : ""}.`,
  };
  if (threshold !== undefined) alert.threshold = threshold;
  return alert;
}
