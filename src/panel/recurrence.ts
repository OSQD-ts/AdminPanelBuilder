/**
 * When a repeating change runs next: every day, or every week on one weekday, at a wall-clock time
 * in a named time zone.
 *
 * Wall-clock, because "maintenance every night at 02:00" means 02:00 on the clock on the wall
 * whatever the offset from UTC is that night. Two nights a year that time is not simple:
 *
 * - When the clocks go forward, 02:30 may not exist. The run happens at the first instant after the
 *   gap — 03:00 — rather than being skipped or moved an hour late.
 * - When the clocks go back, 02:30 happens twice. The run happens once, at the first of them.
 *
 * `Intl` knows every zone's rules, so nothing here carries a table of its own.
 */
import { AdminPanelConfigError } from "../errors.js";

export interface RepeatRule {
  every: "day" | "week";
  /** "HH:MM", 24-hour. */
  at: string;
  /** For `every: "week"`: 0 is Sunday, as in `Date#getDay`. */
  weekday?: number | undefined;
  /** An IANA zone: "Europe/Warsaw", "UTC". */
  timeZone: string;
}

/** Checks a rule as an operator or a caller wrote it; the sentence says what is wrong. */
export function checkRepeat(raw: unknown): RepeatRule {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new AdminPanelConfigError("repeat must be { every, at, timeZone, weekday? }");
  const rule = raw as Partial<RepeatRule>;
  for (const key of Object.keys(rule)) if (!["every", "at", "weekday", "timeZone"].includes(key)) throw new AdminPanelConfigError(`repeat has "${key}", which nothing reads`);
  if (rule.every !== "day" && rule.every !== "week") throw new AdminPanelConfigError('repeat.every is "day" or "week"');
  if (typeof rule.at !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.at)) throw new AdminPanelConfigError('repeat.at is a 24-hour time like "02:00"');
  if (rule.every === "week" && (!Number.isInteger(rule.weekday) || (rule.weekday as number) < 0 || (rule.weekday as number) > 6)) throw new AdminPanelConfigError("repeat.weekday is 0 (Sunday) to 6 for a weekly change");
  if (rule.every === "day" && rule.weekday !== undefined) throw new AdminPanelConfigError("repeat.weekday is for a weekly change only");
  if (typeof rule.timeZone !== "string" || !validZone(rule.timeZone)) throw new AdminPanelConfigError(`repeat.timeZone ${JSON.stringify(rule.timeZone)} is not a time zone this runtime knows`);
  const out: RepeatRule = { every: rule.every, at: rule.at, timeZone: rule.timeZone };
  if (rule.every === "week") out.weekday = rule.weekday as number;
  return out;
}

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The first run of `rule` strictly after `after`. */
export function nextRun(rule: RepeatRule, after: number): number {
  const [hours, minutes] = rule.at.split(":").map(Number) as [number, number];
  const today = wall(after, rule.timeZone);
  // Eight days covers a weekly rule whatever today is.
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (rule.every === "week" && day.getUTCDay() !== rule.weekday) continue;
    const at = instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hours, minutes, rule.timeZone);
    if (at > after) return at;
  }
  throw new Error("no run within eight days, which a daily or weekly rule cannot produce");
}

/** Describes a rule in English for the change log: "every day at 02:00 (Europe/Warsaw)". */
export function describeRepeat(rule: RepeatRule): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return `${rule.every === "day" ? "every day" : `every ${days[rule.weekday ?? 0]}`} at ${rule.at} (${rule.timeZone})`;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wall(instant: number, zone: string): Wall {
  let format = formatters.get(zone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    formatters.set(zone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

/** The zone's offset from UTC at an instant, in milliseconds, to the minute. */
function offsetAt(instant: number, zone: string): number {
  const local = wall(instant, zone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

/** The instant a wall-clock time happens: the first of two when it repeats, the end of the gap when it does not exist. */
function instantOf(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const matches = (instant: number): boolean => {
    const local = wall(instant, zone);
    return local.year === year && local.month === month && local.day === day && local.hour === hour && local.minute === minute;
  };
  // Offsets either side of a transition are at most a day apart; trying both finds every reading.
  const candidates = [...new Set([naive - offsetAt(naive - 86_400_000, zone), naive - offsetAt(naive + 86_400_000, zone), naive - offsetAt(naive, zone)])].filter(matches).sort((a, b) => a - b);
  if (candidates.length > 0) return candidates[0] as number;
  // In the gap: the first instant whose wall time is at or past the one asked for.
  let low = naive - offsetAt(naive - 86_400_000, zone);
  let high = naive - offsetAt(naive + 86_400_000, zone);
  if (low > high) [low, high] = [high, low];
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const wallValue = (instant: number): number => {
    const local = wall(instant, zone);
    return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  };
  while (high - low > 60_000) {
    const middle = low + Math.floor((high - low) / 120_000) * 60_000;
    if (wallValue(middle) >= target) high = middle;
    else low = middle;
  }
  return high;
}
