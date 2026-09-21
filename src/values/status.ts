/**
 * Thresholds: when a number is worth attention.
 *
 * Checked at declaration, because a rule that can never fire looks configured and is not: a
 * `warn` above `bad` on a rising scale means the value is "bad" before it is ever "warn", and a
 * rule on a string never fires at all.
 */
import { AdminPanelConfigError } from "../errors.js";
import type { Status, StatusRule } from "../types.js";

export function checkStatusRule(label: string, rule: StatusRule | undefined): StatusRule | undefined {
  if (rule === undefined || typeof rule === "function") return rule;
  if (rule === null || typeof rule !== "object") throw new AdminPanelConfigError(`"${label}" has a status that is neither thresholds nor a function`);
  for (const key of Object.keys(rule)) if (!["warn", "bad", "below"].includes(key)) throw new AdminPanelConfigError(`"${label}" has a status option "${key}" that nothing reads; it takes warn, bad and below`);
  const { warn, bad, below } = rule;
  if (warn === undefined && bad === undefined) throw new AdminPanelConfigError(`"${label}" has a status with neither warn nor bad, so it would never fire`);
  for (const [name, threshold] of [["warn", warn], ["bad", bad]] as const) {
    if (threshold !== undefined && !Number.isFinite(threshold)) throw new AdminPanelConfigError(`"${label}" has a status ${name} of ${threshold}, which no number can be compared against`);
  }
  if (warn !== undefined && bad !== undefined && (below === true ? warn < bad : warn > bad)) {
    throw new AdminPanelConfigError(`"${label}" warns at ${warn} but is bad at ${bad}; ${below === true ? "falling" : "rising"}, it would be bad before it ever warned`);
  }
  return rule;
}

/** A value's status, or undefined. A throwing function is no status: a rule must never take the poll down. */
export function statusOf(rule: StatusRule | undefined, value: unknown): Status | undefined {
  if (rule === undefined) return undefined;
  if (typeof rule === "function") {
    try {
      const result = rule(value as never);
      return result === "ok" || result === "warn" || result === "bad" ? result : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const past = (threshold: number | undefined): boolean => threshold !== undefined && (rule.below === true ? value <= threshold : value >= threshold);
  if (past(rule.bad)) return "bad";
  if (past(rule.warn)) return "warn";
  return "ok";
}
