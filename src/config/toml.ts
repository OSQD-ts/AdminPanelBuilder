/**
 * The part of TOML a listener's configuration uses, parsed by hand so the library keeps no
 * dependencies: comments, `[section]` and `[section.sub]` headers, bare and quoted keys, basic and
 * literal strings, integers (with `_` separators), floats, booleans, and arrays of those, on one
 * line or several. Inline tables, dates and multi-line strings are refused by name rather than
 * misread, so a file written for full TOML fails loudly here instead of meaning something else.
 *
 * Every failure is a `ConfigError` naming the line; nothing here throws anything else, which the
 * fuzz test in tests/config.test.ts holds it to.
 */
import { AdminPanelConfigError } from "../errors.js";

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export class ConfigError extends AdminPanelConfigError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Longest file read, in characters: a configuration, not a data set. */
export const MAX_CONFIG_LENGTH = 256 * 1024;

export function parseToml(text: string, source = "the configuration"): TomlTable {
  if (typeof text !== "string") throw new ConfigError(`${source} is not text`);
  if (text.length > MAX_CONFIG_LENGTH) throw new ConfigError(`${source} is ${text.length} characters, above the ${MAX_CONFIG_LENGTH} a configuration may be`);
  const root: TomlTable = Object.create(null) as TomlTable;
  let table = root;
  const defined = new Set<string>();
  let position = 0;
  let line = 1;

  const fail = (message: string): never => {
    throw new ConfigError(`${source}, line ${line}: ${message}`);
  };
  const peek = (): string => text[position] ?? "";
  const skipSpaces = (): void => {
    while (peek() === " " || peek() === "\t") position += 1;
  };
  const skipComment = (): void => {
    if (peek() === "#") while (position < text.length && peek() !== "\n") position += 1;
  };
  /** Spaces, comments and newlines: inside an array. */
  const skipBlank = (): void => {
    for (;;) {
      skipSpaces();
      skipComment();
      if (peek() === "\n") {
        position += 1;
        line += 1;
      } else if (peek() === "\r" && text[position + 1] === "\n") {
        position += 2;
        line += 1;
      } else return;
    }
  };
  const endOfLine = (): void => {
    skipSpaces();
    skipComment();
    if (position >= text.length) return;
    if (peek() === "\r" && text[position + 1] === "\n") position += 1;
    if (peek() !== "\n") fail(`unexpected ${JSON.stringify(peek())} after the value`);
    position += 1;
    line += 1;
  };

  const key = (): string => {
    skipSpaces();
    const quote = peek();
    if (quote === '"' || quote === "'") return string();
    const start = position;
    while (/[A-Za-z0-9_-]/.test(peek())) position += 1;
    if (position === start) fail(`expected a key, found ${peek() === "" ? "the end of the file" : JSON.stringify(peek())}`);
    return text.slice(start, position);
  };
  const dottedKey = (): string[] => {
    const parts = [key()];
    for (;;) {
      skipSpaces();
      if (peek() !== ".") return parts;
      position += 1;
      parts.push(key());
    }
  };

  const string = (): string => {
    const quote = peek();
    if (text.startsWith(quote.repeat(3), position)) fail("multi-line strings are not supported here; write the value on one line");
    position += 1;
    let out = "";
    for (;;) {
      const character = peek();
      if (character === "" || character === "\n") fail("a string is not closed on its line");
      position += 1;
      if (character === quote) return out;
      if (quote === "'" || character !== "\\") {
        out += character;
        continue;
      }
      const escaped = peek();
      position += 1;
      const simple: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
      if (simple[escaped] !== undefined) out += simple[escaped];
      else if (escaped === "u" || escaped === "U") {
        const length = escaped === "u" ? 4 : 8;
        const hex = text.slice(position, position + length);
        if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(hex)) fail(`\\${escaped} needs ${length} hex digits`);
        const code = Number.parseInt(hex, 16);
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail(`\\${escaped}${hex} is not a character`);
        out += String.fromCodePoint(code);
        position += length;
      } else fail(`\\${escaped} is not an escaped TOML knows`);
    }
  };

  const value = (depth: number): TomlValue => {
    skipSpaces();
    const character = peek();
    if (character === '"' || character === "'") return string();
    if (character === "[") {
      if (depth > 16) fail("arrays are nested too deeply");
      position += 1;
      const items: TomlValue[] = [];
      for (;;) {
        skipBlank();
        if (peek() === "]") {
          position += 1;
          return items;
        }
        items.push(value(depth + 1));
        skipBlank();
        if (peek() === ",") {
          position += 1;
          continue;
        }
        if (peek() === "]") {
          position += 1;
          return items;
        }
        fail(`expected "," or "]" in an array, found ${peek() === "" ? "the end of the file" : JSON.stringify(peek())}`);
      }
    }
    if (character === "{") fail("inline tables are not supported here; use a [section]");
    const start = position;
    while (position < text.length && !/[\s,\]#]/.test(peek())) position += 1;
    const word = text.slice(start, position);
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "") fail("a key needs a value");
    if (/^\d{4}-\d{2}-\d{2}/.test(word)) fail("dates are not supported here; write a number of milliseconds or a string");
    if (/^[+-]?(0|[1-9](_?\d)*)$/.test(word)) {
      const number = Number(word.replace(/_/g, ""));
      if (!Number.isSafeInteger(number)) fail(`${word} is too large to be exact`);
      return number;
    }
    if (/^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/.test(word)) return Number(word.replace(/_/g, ""));
    if (/^[+-]?(inf|nan)$/.test(word)) fail(`${word} is not a usable number here`);
    return fail(`${JSON.stringify(word)} is not a value; a string needs quotes`);
  };

  const assign = (target: TomlTable, path: string[], item: TomlValue): void => {
    let into = target;
    for (const part of path.slice(0, -1)) {
      const next = into[part];
      if (next === undefined) {
        const created: TomlTable = Object.create(null) as TomlTable;
        into[part] = created;
        into = created;
      } else if (typeof next === "object" && !Array.isArray(next)) into = next;
      else fail(`${path.join(".")} extends ${part}, which is already a value`);
    }
    const last = path[path.length - 1] as string;
    if (Object.hasOwn(into, last)) fail(`${path.join(".")} is set twice`);
    into[last] = item;
  };

  while (position < text.length) {
    skipBlank();
    if (position >= text.length) break;
    if (peek() === "[") {
      position += 1;
      if (peek() === "[") fail("arrays of tables ([[...]]) are not supported here");
      const path = dottedKey();
      skipSpaces();
      if (peek() !== "]") fail('a section header must end with "]"');
      position += 1;
      const name = path.join(".");
      if (defined.has(name)) fail(`[${name}] appears twice`);
      defined.add(name);
      table = root;
      for (const part of path) {
        const next = table[part];
        if (next === undefined) {
          const created: TomlTable = Object.create(null) as TomlTable;
          table[part] = created;
          table = created;
        } else if (typeof next === "object" && !Array.isArray(next)) table = next;
        else fail(`[${name}] names ${part}, which is already a value`);
      }
      endOfLine();
      continue;
    }
    const path = dottedKey();
    skipSpaces();
    if (peek() !== "=") fail(`expected "=" after ${path.join(".")}`);
    position += 1;
    const item = value(0);
    assign(table, path, item);
    endOfLine();
  }
  return root;
}
