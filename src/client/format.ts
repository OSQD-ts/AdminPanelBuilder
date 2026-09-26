/**
 * How a value is written on the page. Pure, so it is unit-tested without a document.
 *
 * The stored value is never rounded or converted: formatting is only what a person reads. The
 * table view under each chart uses the same functions, so the chart, the value and the table
 * cannot disagree about a number.
 *
 * `locale` is the page's language. Numbers are written with its separators; relative times and
 * durations in a language other than English go through `Intl`, so "vor 5 Minuten" needs no table
 * of ours. English keeps the page's own compact forms ("5 min ago"), which read better in a card.
 */
import type { JsonValue, ValueFormat, ValueKind } from "../types.js";

export interface FormatSpec {
  kind?: ValueKind | undefined;
  format?: ValueFormat | undefined;
  unit?: string | undefined;
  decimals?: number | undefined;
  /** The page's language, for separators, times and durations. Absent: the browser's. */
  locale?: string | undefined;
  /** How a switch reads: "On" and "Off" unless the page's language says otherwise. */
  on?: string | undefined;
  off?: string | undefined;
}

/** English, or unknown: the page's own forms. Anything else goes through Intl. */
function intlLocale(locale: string | undefined): string | undefined {
  return locale === undefined || locale === "en" || locale.startsWith("en-") ? undefined : locale;
}

export function formatNumber(value: number, spec: FormatSpec = {}): string {
  if (!Number.isFinite(value)) return String(value);
  const decimals = spec.decimals;
  const locale = spec.locale;
  const fixed = (n: number, fallback: number): string => n.toLocaleString(locale, { maximumFractionDigits: decimals ?? fallback, minimumFractionDigits: decimals ?? 0 });
  let text: string;
  switch (spec.format) {
    case "integer":
      text = Math.round(value).toLocaleString(locale);
      break;
    case "percent":
      // A fraction: 0.25 is 25 %. Declared once here so every surface agrees.
      text = `${fixed(value * 100, 1)}%`;
      break;
    case "bytes":
      text = formatBytes(value, decimals, locale);
      break;
    case "duration":
      text = formatDuration(value, locale);
      break;
    case "timestamp":
      text = new Date(value).toLocaleString(locale);
      break;
    default:
      text = fixed(value, Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 2 : 4);
  }
  return spec.unit === undefined || spec.format === "percent" ? text : `${text} ${spec.unit}`;
}

/** Binary units, labelled as such: 1536 is 1.5 KiB, not 1.5 KB. */
export function formatBytes(bytes: number, decimals?: number, locale?: string): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const sign = bytes < 0 ? "-" : "";
  return `${sign}${value.toLocaleString(locale, { maximumFractionDigits: decimals ?? (unit === 0 ? 0 : 1) })} ${units[unit]}`;
}

/** Milliseconds as the two largest units that matter: "850 ms", "4.2 s", "3 min 5 s", "2 h 10 min", "3 d 4 h". */
export function formatDuration(ms: number, locale?: string): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const intl = intlLocale(locale);
  if (intl !== undefined) return sign + intlDuration(abs, intl);
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
    // "15 min", not "15 min 0 s".
    if (rest < 1000) break;
  }
  return sign + parts.join(" ");
}

/** The two largest units, each written by Intl in the page's language: "3 Min., 5 Sek.". */
function intlDuration(abs: number, locale: string): string {
  const unit = (count: number, name: string): string => new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "short", maximumFractionDigits: name === "second" && abs < 60_000 ? 1 : 0 }).format(count);
  if (abs < 1000) return unit(Math.round(abs), "millisecond");
  if (abs < 60_000) return unit(abs / 1000, "second");
  const units: Array<[string, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  const parts: string[] = [];
  let rest = abs;
  for (const [name, size] of units) {
    if (parts.length === 2) break;
    const count = Math.floor(rest / size);
    if (count === 0 && parts.length === 0) continue;
    parts.push(unit(count, name));
    rest -= count * size;
    if (rest < 1000) break;
  }
  return parts.join(" ");
}

/** "just now", "12 s ago", "5 min ago", "3 h ago", then the date; in another language, Intl's relative time. */
export function formatAgo(at: number, now: number, locale?: string): string {
  const elapsed = Math.max(0, now - at);
  const intl = intlLocale(locale);
  if (intl !== undefined) {
    if (elapsed >= 86_400_000) return new Date(at).toLocaleDateString(intl);
    const relative = new Intl.RelativeTimeFormat(intl, { numeric: "auto", style: "short" });
    if (elapsed < 2000) return relative.format(0, "second");
    if (elapsed < 60_000) return relative.format(-Math.floor(elapsed / 1000), "second");
    if (elapsed < 3_600_000) return relative.format(-Math.floor(elapsed / 60_000), "minute");
    return relative.format(-Math.floor(elapsed / 3_600_000), "hour");
  }
  if (elapsed < 2000) return "just now";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)} s ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} h ago`;
  return new Date(at).toLocaleDateString(locale);
}

/** A value as the page shows it. `null` is a dash, which the page labels "no value" for screen readers. */
export function formatValue(value: JsonValue, spec: FormatSpec = {}): string {
  if (value === null) return "—";
  if (typeof value === "number") return formatNumber(value, spec);
  if (typeof value === "boolean") return value ? (spec.on ?? "On") : (spec.off ?? "Off");
  if (typeof value === "string") {
    if (spec.format === "timestamp") {
      const at = Date.parse(value);
      if (!Number.isNaN(at)) return new Date(at).toLocaleString(spec.locale);
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

/** Up to two letters for a name: "Ada Lovelace" → "AL", "ada" → "AD", "ops-bot" → "OB". */
export function initialsOf(name: string): string {
  const words = name.split(/[\s._@-]+/).filter((word) => word !== "");
  const letters = words.length >= 2 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : (words[0] ?? name).slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** A chart colour slot for a name, the same for the same name on every page. */
export function slotOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return (hash % 8) + 1;
}
