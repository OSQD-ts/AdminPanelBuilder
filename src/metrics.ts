/**
 * Prometheus exposition of a panel's numbers, so the declarations that feed the page feed
 * monitoring too.
 *
 * One family per kind rather than one metric per value, with the value as a label: dimensions are
 * labels, not name fragments. `<prefix>_value{id,label,group}` is a gauge of every numeric or boolean
 * value; values declared with `counter()` are `<prefix>_count_total{…}` counters. Two more series
 * exist from the first scrape, at zero if need be, because a series an alert watches must exist
 * before it is needed: `<prefix>_changes_total{kind,ok}` and `<prefix>_notices`.
 *
 * Label values are escaped — backslash, quote and newline — because the format is line-oriented and
 * an unescaped newline in a label would let what follows be read as another sample. Sensitive values
 * are never exported; a withheld group is withheld here too.
 */
import type { AdminPanel, PanelScope } from "./core.js";

/** Every kind of change record, so each series exists from the first scrape. */
export const CHANGE_KINDS = ["edit", "action", "profile", "revert", "approval", "scheduled", "import", "layout"] as const;

export function renderMetrics(panel: AdminPanel, scope: PanelScope, prefix: string): string {
  const gauges: string[] = [];
  const counters: string[] = [];
  for (const entry of panel.metricValues(scope)) {
    const labels = `{id="${escapeLabel(entry.id)}",label="${escapeLabel(entry.label)}",group="${escapeLabel(entry.group)}"}`;
    (entry.counter ? counters : gauges).push(`${entry.counter ? `${prefix}_count_total` : `${prefix}_value`}${labels} ${number(entry.value)}`);
  }
  const lines: string[] = [];
  lines.push(`# HELP ${prefix}_value Numeric values shown on the admin panel.`, `# TYPE ${prefix}_value gauge`, ...gauges);
  lines.push(`# HELP ${prefix}_count_total Counters declared with counter() on the admin panel.`, `# TYPE ${prefix}_count_total counter`, ...counters);
  const tally = new Map<string, number>();
  for (const kind of CHANGE_KINDS) for (const ok of ["true", "false"]) tally.set(`${kind}|${ok}`, 0);
  for (const [key, count] of panel.changeTotals()) tally.set(key, count);
  lines.push(`# HELP ${prefix}_changes_total Operator changes since the process started, by kind and whether they succeeded.`, `# TYPE ${prefix}_changes_total counter`);
  for (const [key, count] of tally) {
    const [kind, ok] = key.split("|") as [string, string];
    lines.push(`${prefix}_changes_total{kind="${kind}",ok="${ok}"} ${count}`);
  }
  lines.push(`# HELP ${prefix}_notices Notices the panel currently holds.`, `# TYPE ${prefix}_notices gauge`, `${prefix}_notices ${panel.notices().length}`);
  return `${lines.join("\n")}\n`;
}

function escapeLabel(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

function number(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  if (value === Number.NEGATIVE_INFINITY) return "-Inf";
  return String(value);
}
