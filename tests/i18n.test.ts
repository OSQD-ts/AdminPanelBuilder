/** Every shipped language has every key, and keeps every placeholder the English text has. */
import { describe, expect, it } from "vitest";
import { ENGLISH, LOCALES } from "../src/i18n/messages.js";

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();

describe.each(Object.keys(LOCALES))("the %s messages", (locale) => {
  const table = LOCALES[locale] as Record<string, string>;
  it("have every key and no other", () => {
    expect(Object.keys(table).sort()).toEqual(Object.keys(ENGLISH).sort());
  });
  it("keep every placeholder", () => {
    for (const [key, english] of Object.entries(ENGLISH)) expect({ key, found: placeholders(table[key] ?? "") }).toEqual({ key, found: placeholders(english) });
  });
});

describe("refusal keys", () => {
  it("exist for every key the server sends", async () => {
    const source = (await import("node:fs")).readFileSync(new URL("../src/values/kinds.ts", import.meta.url), "utf8");
    const keys = [...source.matchAll(/key: "(\w+)"/g)].map((match) => match[1] as string);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) expect(Object.hasOwn(ENGLISH, key)).toBe(true);
  });
});
