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

describe("docs/reference/limits.md", () => {
  it("states every cap at the value the code holds", () => {
    const rows = [...read("docs/reference/limits.md").matchAll(/^\| `([A-Z_]+)` \| (\d+) \|/gm)].map((match) => [match[1], Number(match[2])] as const);
    const exported = { ...root, ...adapters, ...config } as unknown as Record<string, unknown>;
    expect(rows.length).toBeGreaterThan(10);
    for (const [name, value] of rows) expect([name, exported[name as string]]).toEqual([name, value]);
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
