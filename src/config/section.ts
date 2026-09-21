/**
 * The validating reader over a parsed table: one typed accessor per kind of setting, each taking
 * its default inline and recording the key it read, and `done()` at the end of every section,
 * which refuses any key the schema did not read — a misspelt `max_veiwers` is an error with the
 * nearest real name, not a default quietly left in place.
 */
import { ConfigError, type TomlTable, type TomlValue } from "./toml.js";

export class Section {
  private readonly read = new Set<string>();

  constructor(
    private readonly table: TomlTable,
    readonly path: string,
  ) {}

  static root(table: TomlTable): Section {
    return new Section(table, "");
  }

  private name(key: string): string {
    return this.path === "" ? key : `${this.path}.${key}`;
  }

  private raw(key: string): TomlValue | undefined {
    this.read.add(key);
    return Object.hasOwn(this.table, key) ? this.table[key] : undefined;
  }

  section(key: string): Section {
    const value = this.raw(key);
    if (value === undefined) return new Section(Object.create(null) as TomlTable, this.name(key));
    if (typeof value !== "object" || Array.isArray(value)) throw new ConfigError(`${this.name(key)} must be a [section]`);
    return new Section(value, this.name(key));
  }

  string(key: string, fallback: string): string {
    const value = this.raw(key);
    if (value === undefined) return fallback;
    if (typeof value !== "string") throw new ConfigError(`${this.name(key)} must be a string in quotes`);
    return value;
  }

  enum<T extends string>(key: string, options: readonly T[], fallback: T): T {
    const value = this.string(key, fallback);
    if (!options.includes(value as T)) throw new ConfigError(`${this.name(key)} is "${value}"; it is one of ${options.map((option) => `"${option}"`).join(", ")}`);
    return value as T;
  }

  number(key: string, fallback: number, bounds: { min?: number; max?: number } = {}): number {
    const value = this.raw(key);
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new ConfigError(`${this.name(key)} must be a number`);
    if (bounds.min !== undefined && value < bounds.min) throw new ConfigError(`${this.name(key)} is ${value}; it is at least ${bounds.min}`);
    if (bounds.max !== undefined && value > bounds.max) throw new ConfigError(`${this.name(key)} is ${value}; it is at most ${bounds.max}`);
    return value;
  }

  integer(key: string, fallback: number, bounds: { min?: number; max?: number } = {}): number {
    const value = this.number(key, fallback, bounds);
    if (!Number.isInteger(value)) throw new ConfigError(`${this.name(key)} is ${value}; it must be a whole number`);
    return value;
  }

  /** 0 to 65535; 0 asks the system for a free port. */
  port(key: string, fallback: number): number {
    return this.integer(key, fallback, { min: 0, max: 65535 });
  }

  boolean(key: string, fallback: boolean): boolean {
    const value = this.raw(key);
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") throw new ConfigError(`${this.name(key)} must be true or false, without quotes`);
    return value;
  }

  stringArray(key: string, fallback: readonly string[]): string[] {
    const value = this.raw(key);
    if (value === undefined) return [...fallback];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) throw new ConfigError(`${this.name(key)} must be a list of non-empty strings`);
    return value as string[];
  }

  /** `true`, `false`, or a list of group names: what a control grants. */
  grant(key: string, fallback: boolean | readonly string[]): boolean | string[] {
    const value = this.raw(key);
    if (value === undefined) return typeof fallback === "boolean" ? fallback : [...fallback];
    if (typeof value === "boolean") return value;
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item !== "")) return value as string[];
    throw new ConfigError(`${this.name(key)} must be true, false, or a non-empty list of group names`);
  }

  /** A bare string or `/pattern/flags`; `g` and `y` are dropped, because they make `.test()` remember where it stopped. */
  regexp(key: string, fallback: RegExp | undefined): RegExp | undefined {
    const value = this.raw(key);
    if (value === undefined) return fallback;
    if (typeof value !== "string") throw new ConfigError(`${this.name(key)} must be a pattern in quotes`);
    const match = /^\/(.*)\/([a-z]*)$/s.exec(value);
    try {
      return match === null ? new RegExp(value) : new RegExp(match[1] as string, (match[2] as string).replace(/[gy]/g, ""));
    } catch (error) {
      throw new ConfigError(`${this.name(key)} is not a valid pattern: ${(error as Error).message}`);
    }
  }

  /** Refuses every key nothing read, naming the nearest one that exists. */
  done(): void {
    for (const key of Object.keys(this.table)) {
      if (this.read.has(key)) continue;
      const near = [...this.read].map((known) => ({ known, distance: distance(key, known) })).sort((a, b) => a.distance - b.distance)[0];
      throw new ConfigError(`${this.name(key)} is not a setting${near !== undefined && near.distance <= 3 ? `; did you mean ${this.name(near.known)}?` : ""}`);
    }
  }
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] as number;
      row[j] = Math.min(current + 1, (row[j - 1] as number) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length] as number;
}
