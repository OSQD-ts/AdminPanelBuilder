/**
 * The documentation, checked against the code. Adapted from bothandlerjs: a number the prose states as
 * fact is derived from the data here, so the page cannot keep saying 10000 after the cap moves.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as adapters from "../src/adapters/index.js";
import * as config from "../src/config/index.js";
import * as root from "../src/index.js";
import * as sdk from "../src/sdk.js";
import * as testing from "../src/testing.js";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the source itself", () => {
  it("is text: no control character makes a file binary to grep", () => {
    const { readdirSync, readFileSync, statSync } = require("node:fs") as typeof import("node:fs");
    const walk = (directory: string): string[] =>
      readdirSync(new URL(`../${directory}/`, import.meta.url)).flatMap((name) => {
        const path = `${directory}/${name}`;
        if (statSync(new URL(`../${path}`, import.meta.url)).isDirectory()) return walk(path);
        return name.endsWith(".ts") || name.endsWith(".mjs") ? [path] : [];
      });
    // A NUL in a source file is legal TypeScript and invisible in an editor, and it makes `grep`,
    // `file` and every tool that sniffs for text call the file binary and skip it.
    const binary = walk("src")
      .concat(walk("scripts"))
      .filter((path) => path !== "src/client.generated.ts")
      .filter((path) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")));
    expect(binary).toEqual([]);
  });
});

describe("docs/reference/limits.md", () => {
  const exported = { ...root, ...adapters, ...config, ...sdk, ...testing } as unknown as Record<string, unknown>;

  it("states every cap at the value the code holds", () => {
    const rows = [...read("docs/reference/limits.md").matchAll(/^\| `([A-Z_]+)` \| (\d+) \|/gm)].map((match) => [match[1], Number(match[2])] as const);
    expect(rows.length).toBeGreaterThan(10);
    for (const [name, value] of rows) expect([name, exported[name as string]]).toEqual([name, value]);
  });

  it("lists every cap the code exports, so a new one cannot ship undocumented", () => {
    const listed = new Set([...read("docs/reference/limits.md").matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1] as string));
    const caps = Object.entries(exported).filter(([name, value]) => /^(MAX|MIN|DEFAULT)_/.test(name) && typeof value === "number");
    expect(caps.filter(([name]) => !listed.has(name)).map(([name]) => name)).toEqual([]);
    expect([...listed].filter((name) => !(name in exported))).toEqual([]);
  });
});

describe("docs/reference/api.md", () => {
  it("mentions every runtime export of the root, adapters, config, client and testing entries", () => {
    const page = read("docs/reference/api.md");
    const missing = [...Object.keys(root), ...Object.keys(adapters), ...Object.keys(config), ...Object.keys(sdk), ...Object.keys(testing)].filter((name) => !page.includes(`\`${name}`) && !page.includes(`${name},`) && !page.includes(`${name}(`));
    expect(missing).toEqual([]);
  });
});

describe("docs/operations/themes.md", () => {
  it("lists every theme token", () => {
    const page = read("docs/operations/themes.md");
    const theme = root.materialTheme;
    const missing = [...Object.keys(theme.light), ...Object.keys(theme.shape)].filter((key) => !page.includes(`\`${key}\``));
    expect(missing).toEqual([]);
  });
});
