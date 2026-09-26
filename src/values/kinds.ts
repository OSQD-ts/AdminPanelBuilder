/**
 * What a value is, what it may become, and how it travels.
 *
 * Three jobs, kept in one module because they must agree: the kind inferred from an initial
 * value decides which constraints make sense, the constraints decide what a write may be, and
 * the wire encoding decides what the page is told. A constraint checked here and not on the
 * page is still enforced; a constraint checked on the page and not here is decoration, so every
 * write — from an operator, from code, from a store at start-up — comes through `checkValue`.
 */
import { AdminPanelConfigError, ValueError } from "../errors.js";
import { ENGLISH, format } from "../i18n/messages.js";
import type { JsonValue, ModifiableOptions, ValueConstraints, ValueKind } from "../types.js";

/**
 * Longest string accepted when a value declares no `maxLength`. A panel field is somebody
 * typing; ten thousand characters is a page of text and far below anything that would make a
 * request body, a store or a change record a problem.
 */
export const DEFAULT_MAX_LENGTH = 10_000;

/**
 * Most bytes of JSON one value may put on the wire. Past it the page is told the value was too
 * large to send, rather than a poll carrying a megabyte every second to every viewer. 64 KB
 * is a large leaderboard or a long configuration object; a value bigger than that belongs in a
 * table the panel pages through, not in one cell.
 */
export const MAX_WIRE_BYTES = 64 * 1024;

export function inferKind(initial: unknown, options: { kind?: ValueKind | undefined; options?: readonly unknown[] | undefined }): ValueKind {
  if (options.kind !== undefined) return options.kind;
  if (options.options !== undefined) return "enum";
  switch (typeof initial) {
    case "number":
      return "number";
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    default:
      return "json";
  }
}

/**
 * The declared constraints, checked for being able to hold at all.
 *
 * Every refusal here is a declaration that would render and then misbehave: a minimum above
 * its maximum refuses every number, an initial value outside its own range is refused the
 * first time anybody submits the form unchanged, and a pattern carrying `g` would accept a
 * value on one write and refuse the same value on the next.
 */
export function resolveConstraints(label: string, kind: ValueKind, options: ModifiableOptions<unknown>): ValueConstraints {
  const constraints: ValueConstraints = {};
  const { min, max, step } = options;
  if (min !== undefined || max !== undefined || step !== undefined || options.integer === true) {
    if (kind !== "number") throw new AdminPanelConfigError(`"${label}" declares a numeric range but is a ${kind} value: min, max, step and integer only constrain numbers`);
  }
  if (min !== undefined && !Number.isFinite(min)) throw new AdminPanelConfigError(`"${label}" has a minimum of ${min}, which no number can be compared against`);
  if (max !== undefined && !Number.isFinite(max)) throw new AdminPanelConfigError(`"${label}" has a maximum of ${max}, which no number can be compared against`);
  if (min !== undefined && max !== undefined && min > max) throw new AdminPanelConfigError(`"${label}" has a minimum of ${min} above its maximum of ${max}, so no value could ever be accepted`);
  if (step !== undefined && (!Number.isFinite(step) || step <= 0)) throw new AdminPanelConfigError(`"${label}" has a step of ${step}; a step must be a positive number`);
  if (min !== undefined) constraints.min = min;
  if (max !== undefined) constraints.max = max;
  if (step !== undefined) constraints.step = step;
  if (options.integer === true || options.format === "integer") constraints.integer = true;

  if (options.options !== undefined) {
    if (options.options.length === 0) throw new AdminPanelConfigError(`"${label}" offers an empty list of options, so nothing could ever be chosen`);
    const seen = new Set<string>();
    const wire: JsonValue[] = [];
    for (const option of options.options) {
      const encoded = toJson(option);
      const key = JSON.stringify(encoded);
      if (seen.has(key)) throw new AdminPanelConfigError(`"${label}" lists the option ${key} twice`);
      seen.add(key);
      wire.push(encoded);
    }
    constraints.options = wire;
  }

  if (options.maxLength !== undefined || options.pattern !== undefined || options.multiline === true) {
    if (kind !== "string" && kind !== "json") throw new AdminPanelConfigError(`"${label}" declares text constraints but is a ${kind} value: maxLength, pattern and multiline only constrain text`);
  }
  if (options.maxLength !== undefined && (!Number.isInteger(options.maxLength) || options.maxLength < 1)) {
    throw new AdminPanelConfigError(`"${label}" has a maxLength of ${options.maxLength}; it must be a whole number of characters above zero`);
  }
  if (kind === "string" || kind === "json") constraints.maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (options.pattern !== undefined) {
    const pattern = statelessPattern(options.pattern);
    constraints.pattern = { source: pattern.source, flags: pattern.flags };
  }
  if (options.multiline === true) constraints.multiline = true;
  return constraints;
}

/**
 * A copy of the pattern without `g` or `y`. Both make `RegExp.prototype.test` remember where
 * it stopped, so the same value would be accepted on one write and refused on the next.
 */
export function statelessPattern(pattern: RegExp): RegExp {
  return /[gy]/.test(pattern.flags) ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "")) : pattern;
}

/** Checks a candidate against the kind and the declared constraints. Throws `ValueError` with the sentence an operator reads. */
export function checkValue(label: string, kind: ValueKind, constraints: ValueConstraints, candidate: unknown, pattern: RegExp | undefined): void {
  switch (kind) {
    case "number": {
      if (typeof candidate !== "number" || !Number.isFinite(candidate)) throw new ValueError(`${label} must be a finite number`, { key: "refuseNumber", params: { label } });
      if (constraints.integer === true && !Number.isInteger(candidate)) throw new ValueError(`${label} must be a whole number`, { key: "refuseWhole", params: { label } });
      if (constraints.min !== undefined && candidate < constraints.min) throw new ValueError(`${label} must be at least ${constraints.min}`, { key: "refuseAtLeast", params: { label, min: constraints.min } });
      if (constraints.max !== undefined && candidate > constraints.max) throw new ValueError(`${label} must be at most ${constraints.max}`, { key: "refuseAtMost", params: { label, max: constraints.max } });
      if (constraints.step !== undefined && !onStep(candidate, constraints.min ?? 0, constraints.step)) {
        throw new ValueError(
          `${label} must be ${constraints.min === undefined ? "a multiple of" : `${constraints.min} plus a multiple of`} ${constraints.step}`,
          constraints.min === undefined ? { key: "refuseStep", params: { label, step: constraints.step } } : { key: "refuseStepFrom", params: { label, min: constraints.min, step: constraints.step } },
        );
      }
      return;
    }
    case "boolean":
      if (typeof candidate !== "boolean") throw new ValueError(`${label} must be true or false`, { key: "refuseBoolean", params: { label } });
      return;
    case "string":
      if (typeof candidate !== "string") throw new ValueError(`${label} must be text`, { key: "refuseText", params: { label } });
      checkText(label, constraints, candidate, pattern);
      return;
    case "enum": {
      const key = JSON.stringify(toJson(candidate));
      if (!(constraints.options ?? []).some((option) => JSON.stringify(option) === key)) {
        throw new ValueError(`${label} must be one of ${(constraints.options ?? []).map((option) => JSON.stringify(option)).join(", ")}`, { key: "refuseOneOf", params: { label, options: (constraints.options ?? []).map((option) => JSON.stringify(option)).join(", ") } });
      }
      return;
    }
    case "json": {
      const encoded = JSON.stringify(toJson(candidate));
      if (encoded.length > (constraints.maxLength ?? DEFAULT_MAX_LENGTH)) throw new ValueError(`${label} is ${encoded.length} characters of JSON, above its limit of ${constraints.maxLength ?? DEFAULT_MAX_LENGTH}`, { key: "refuseJsonLong", params: { label, length: encoded.length, limit: constraints.maxLength ?? DEFAULT_MAX_LENGTH } });
      return;
    }
  }
}

function checkText(label: string, constraints: ValueConstraints, candidate: string, pattern: RegExp | undefined): void {
  const limit = constraints.maxLength ?? DEFAULT_MAX_LENGTH;
  if (candidate.length > limit) throw new ValueError(`${label} is ${candidate.length} characters long, above its limit of ${limit}`, { key: "refuseTooLong", params: { label, length: candidate.length, limit } });
  if (pattern !== undefined && !pattern.test(candidate)) throw new ValueError(`${label} must match ${String(pattern)}`, { key: "refusePattern", params: { label, pattern: String(pattern) } });
}

/** Tolerant of binary fractions: 0.1 + 0.2 is on a step of 0.1. */
function onStep(value: number, base: number, step: number): boolean {
  const steps = (value - base) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9 * Math.max(1, Math.abs(steps));
}

/**
 * A value as JSON, the way the page will see it. Maps become objects, sets become arrays,
 * dates become ISO strings, bigints become strings, and anything that cannot be represented
 * (a function, a symbol, a cycle) becomes a description of itself rather than a throw — a
 * viewable holding something odd must not take the poll down for every other value.
 */
export function toJson(value: unknown, depth = 0, seen: Set<object> = new Set()): JsonValue {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? value : null;
    case "string":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
      return "[function]";
    case "symbol":
      return value.toString();
    default:
      break;
  }
  const object = value as object;
  if (seen.has(object)) return "[circular]";
  if (depth > 32) return "[too deep]";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof RegExp) return String(value);
  seen.add(object);
  try {
    if (value instanceof Map) {
      const out: { [key: string]: JsonValue } = {};
      for (const [key, entry] of value) out[String(key)] = toJson(entry, depth + 1, seen);
      return out;
    }
    if (value instanceof Set || Array.isArray(value)) {
      const out: JsonValue[] = [];
      for (const entry of value as Iterable<unknown>) out.push(toJson(entry, depth + 1, seen));
      return out;
    }
    if (typeof (value as { toJSON?: unknown }).toJSON === "function") return toJson((value as { toJSON(): unknown }).toJSON(), depth + 1, seen);
    const out: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === "function") continue;
      out[key] = toJson(entry, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(object);
  }
}

/** The wire half of a value: its JSON, plus a note when the JSON alone would mislead. */
export function encodeForWire(value: unknown): { value: JsonValue; text?: string; textKey?: string; textParams?: Record<string, string | number> } {
  if (typeof value === "number" && !Number.isFinite(value)) return { value: null, text: String(value) };
  const json = toJson(value);
  if (typeof json === "string" ? json.length > MAX_WIRE_BYTES : typeof json === "object" && json !== null && JSON.stringify(json).length > MAX_WIRE_BYTES) {
    const kb = MAX_WIRE_BYTES / 1024;
    return { value: null, text: format(ENGLISH.valueTooLarge, { kb }), textKey: "valueTooLarge", textParams: { kb } };
  }
  return { value: json };
}

/** A number to plot, or undefined when the value is not one. Booleans plot as 0 and 1. */
export function plottable(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value ? 1 : 0;
  return undefined;
}
