/**
 * The configuration layer: the shipped file is the defaults, the reader is strict, the
 * environment has the last word and is checked like the file, printing redacts, a reload is a
 * plan, and the parser fails only with ConfigError on anything.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyEnvironment, ConfigError, DEFAULT_CONFIG, listenOptions, loadConfig, parseToml, planReload, printConfig, readConfig, Section } from "../src/config/index.js";

const read = (text: string) => readConfig(parseToml(text));

describe("the shipped admin-panel.toml", () => {
  it("is every default written out, so deleting it changes nothing", () => {
    expect(read(readFileSync(new URL("../admin-panel.toml", import.meta.url), "utf8"))).toEqual(DEFAULT_CONFIG);
    expect(read("")).toEqual(DEFAULT_CONFIG);
  });
});

describe("the TOML subset", () => {
  it("reads sections, dotted keys, strings, numbers, booleans and arrays across lines", () => {
    const table = parseToml(`# comment\ntitle = "a \\"b\\" \\u00e9" # trailing\nliteral = 'C:\\\\path'\n[a.b]\nn = 1_000\nf = -1.5e3\non = true\nlist = [\n  "x", # one\n  "y",\n]\n"quoted key" = 2\n`);
    expect(table).toEqual({ title: 'a "b" é', literal: "C:\\\\path", a: { b: { n: 1000, f: -1500, on: true, list: ["x", "y"], "quoted key": 2 } } });
  });

  it("refuses what it does not support by name, with the line", () => {
    for (const [text, pattern] of [
      ["a = { b = 1 }", /inline tables/],
      ["a = 1979-05-27", /dates/],
      ["[[x]]", /arrays of tables/],
      ['a = """x"""', /multi-line strings/],
      ["a = 1\na = 2", /line 2: a is set twice/],
      ["[s]\n[s]", /appears twice/],
      ["a = bare", /needs quotes/],
      ["a = 99999999999999999999", /too large/],
    ] as const) {
      expect(() => parseToml(text)).toThrow(pattern);
    }
  });
});

describe("the reader", () => {
  it("refuses a key nothing reads, naming the nearest real one", () => {
    expect(() => read("[stream]\nmax_veiwers = 3")).toThrow(/stream.max_veiwers is not a setting; did you mean stream.max_viewers\?/);
    expect(() => read("[strem]\nenabled = true")).toThrow(/strem is not a setting; did you mean stream\?/);
  });

  it("checks each kind: ports, enums, grants, booleans without quotes", () => {
    expect(() => read("[listen]\nport = 70000")).toThrow(/at most 65535/);
    expect(() => read('[auth]\nmode = "basic"')).toThrow(/one of "none", "token"/);
    expect(() => read('[stream]\nenabled = "yes"')).toThrow(/without quotes/);
    expect(() => read("[controls]\nedit = []")).toThrow(/non-empty list/);
    expect(read('[auth]\nmode = "token"\ntoken = "a-token-long-enough-1"\n[controls]\nedit = ["Game"]').controls.edit).toEqual(["Game"]);
  });

  it("reads patterns bare or as /source/flags, dropping g and y", () => {
    const section = new Section({ a: "/x+/gi", b: "y+", c: "(" }, "s");
    expect(section.regexp("a", undefined)?.flags).toBe("i");
    expect(section.regexp("b", undefined)?.source).toBe("y+");
    expect(() => section.regexp("c", undefined)).toThrow(/not a valid pattern/);
  });

  it("refuses combinations that would hurt somebody, in the file or after the environment", () => {
    expect(() => read("[controls]\nedit = true")).toThrow(/needs auth even on loopback/);
    expect(() => read('[listen]\nhost = "0.0.0.0"')).toThrow(/without auth/);
    expect(() => read('[auth]\nmode = "token"')).toThrow(/put it in PANEL_TOKEN/);
    expect(() => applyEnvironment(DEFAULT_CONFIG, { HOST: "0.0.0.0" })).toThrow(/without auth/);
  });
});

describe("the environment", () => {
  it("has the last word, trimmed, empty meaning unset, through the same checks", async () => {
    const config = await loadConfig({ text: "[listen]\nport = 9000\n", env: { PORT: " 9100 ", HOST: "", PANEL_TOKEN: "a-token-long-enough-1" } });
    expect(config.listen).toMatchObject({ port: 9100, host: "127.0.0.1" });
    expect(config.auth).toEqual({ mode: "token", token: "a-token-long-enough-1" });
    await expect(loadConfig({ text: "", env: { PORT: "http" } })).rejects.toThrow(/PORT is "http"/);
    await expect(loadConfig({ file: "/nonexistent/admin-panel.toml", env: {} })).rejects.toThrow(/could not be read/);
  });

  it("turns into listen() options", async () => {
    const config = await loadConfig({ text: '[controls]\nedit = true\n[view]\ngroups = ["Game"]\n[metrics]\nenabled = true', env: { PANEL_TOKEN: "a-token-long-enough-1" } });
    expect(listenOptions(config)).toMatchObject({ port: 9780, auth: { token: "a-token-long-enough-1" }, controls: { edit: true, actions: false }, groups: ["Game"], metrics: { prefix: "admin_panel" }, writeLimit: { perMinute: 60 } });
  });
});

describe("printing and reloading", () => {
  it("redacts credentials by name and keeps set distinguishable from not set", () => {
    const shown = printConfig(applyEnvironment(DEFAULT_CONFIG, { PANEL_TOKEN: "a-token-long-enough-1" }));
    expect(shown).not.toContain("a-token-long-enough-1");
    expect(shown).toContain('"token": "(set)"');
    expect(printConfig(DEFAULT_CONFIG)).toContain('"token": "(not set)"');
  });

  it("plans a reload as data before anything applies, with who asked", () => {
    const next = applyEnvironment(read("[listen]\nport = 9100\n[write_limit]\nper_minute = 10"), {});
    const plan = planReload(DEFAULT_CONFIG as never, next, "SIGHUP");
    expect(plan.by).toBe("SIGHUP");
    expect(plan.applied).toEqual(["write_limit.per_minute"]);
    expect(plan.requiresRestart).toEqual([{ key: "listen.port", reason: "the socket is bound to the old port" }]);
    expect(plan.unchanged).toContain("stream.enabled");
  });
});

describe("fuzzing the parser", () => {
  /** A seeded generator: the same inputs on every run, so a failure is a bug, not a flaky test. */
  function random(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
      return state / 2 ** 31;
    };
  }
  const pieces = ["[", "]", "=", '"', "'", "\\", "\n", " ", "#", ",", "a", "listen", "port", "1", "_", ".", "{", "}", "true", "-", "e", "\\u", "0", "[[", "x", "\r\n", "\t", "é", "\u0000"];

  it("parses or fails with ConfigError on every input, never anything else", () => {
    const next = random(42);
    const inputs: string[] = [];
    for (let i = 0; i < 3000; i += 1) {
      let text = "";
      const length = Math.floor(next() * 30);
      for (let j = 0; j < length; j += 1) text += pieces[Math.floor(next() * pieces.length)];
      inputs.push(text);
    }
    const corpus = new URL("./fixtures/config-corpus/", import.meta.url);
    for (const name of readdirSync(corpus)) inputs.push(readFileSync(new URL(name, corpus), "latin1"));
    for (const text of inputs) {
      try {
        readConfig(parseToml(text));
      } catch (error) {
        if (!(error instanceof ConfigError)) throw new Error(`${JSON.stringify(text)} threw ${String(error)}`);
      }
    }
  });
});
