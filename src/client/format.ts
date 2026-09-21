/**
 * How a value is written on the page. Pure, so it is unit-tested without a document.
 *
 * The stored value is never rounded or converted: formatting is only what a person reads. The
 * table view under each chart uses the same functions, so the chart, the value and the table
 * cannot disagree about a number.
 */
import type { JsonValue, ValueFormat, ValueKind } from "../types.js";

export interface FormatSpec {
  kind?: ValueKind | undefined;
  format?: ValueFormat | undefined;
  unit?: string | undefined;
  decimals?: number | undefined;
}

export function formatNumber(value: number, spec: FormatSpec = {}): string {
  if (!Number.isFinite(value)) return String(value);
  const decimals = spec.decimals;
  const fixed = (n: number, fallback: number): string => n.toLocaleString(undefined, { maximumFractionDigits: decimals ?? fallback, minimumFractionDigits: decimals ?? 0 });
  let text: string;
  switch (spec.format) {
    case "integer":
      text = Math.round(value).toLocaleString();
      break;
    case "percent":
      // A fraction: 0.25 is 25 %. Declared once here so every surface agrees.
      text = `${fixed(value * 100, 1)}%`;
      break;
    case "bytes":
      text = formatBytes(value, decimals);
      break;
    case "duration":
      text = formatDuration(value);
      break;
    case "timestamp":
      text = new Date(value).toLocaleString();
      break;
    default:
      text = fixed(value, Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 2 : 4);
  }
  return spec.unit === undefined || spec.format === "percent" ? text : `${text} ${spec.unit}`;
}

/** Binary units, labelled as such: 1536 is 1.5 KiB, not 1.5 KB. */
export function formatBytes(bytes: number, decimals?: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const sign = bytes < 0 ? "-" : "";
  return `${sign}${value.toLocaleString(undefined, { maximumFractionDigits: decimals ?? (unit === 0 ? 0 : 1) })} ${units[unit]}`;
}

/** Milliseconds as the two largest units that matter: "850 ms", "4.2 s", "3 min 5 s", "2 h 10 min", "3 d 4 h". */
export function formatDuration(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  if (abs < 1000) return `${sign}${Math.round(abs)} ms`;
  if (abs < 60_000) return `${sign}${(abs / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
  const units: Array<[string, number]> = [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["min", 60_000],
    ["s", 1000],
  ];
  const parts: string[] = [];
  let rest = abs;
  for (const [name, size] of units) {
    if (parts.length === 2) break;
    const count = Math.floor(rest / size);
    if (count === 0 && parts.length === 0) continue;
    parts.push(`${count} ${name}`);
    rest -= count * size;
  }
  return sign + parts.join(" ");
}

/** "just now", "12 s ago", "5 min ago", "3 h ago", then the date. */
export function formatAgo(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < 2000) return "just now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)} s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} h ago`;
  return new Date(at).toLocaleDateString();
}

/** A value as the page shows it. `null` is a dash, which the page labels "no value" for screen readers. */
export function formatValue(value: JsonValue, spec: FormatSpec = {}): string {
  if (value === null) return "—";
  if (typeof value === "number") return formatNumber(value, spec);
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string") {
    if (spec.format === "timestamp") {
      const at = Date.parse(value);
      if (!Number.isNaN(at)) return new Date(at).toLocaleString();
    }
    return value;
  }
  return JSON.stringify(value, null, 2);
}

/** The entries of a record or an array, for a chart over keys: numbers only, anything else skipped. */
export function numericEntries(value: JsonValue): Array<[string, number]> {
  if (value === null || typeof value !== "object") return [];
  const entries: Array<[string, number]> = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (typeof entry === "number" && Number.isFinite(entry)) entries.push([String(index), entry]);
      else if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number") entries.push([entry[0], entry[1]]);
      else if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
        const record = entry as Record<string, JsonValue>;
        const label = record.label ?? record.name ?? record.key;
        const number = record.value ?? record.count;
        if (typeof label === "string" && typeof number === "number") entries.push([label, number]);
      }
    });
    return entries;
  }
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "number" && Number.isFinite(entry)) entries.push([key, entry]);
  return entries;
}
