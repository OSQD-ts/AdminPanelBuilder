/** Every shipped language has every key, and keeps every placeholder the English text has. */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { ENGLISH, LOCALES } from "../src/i18n/messages.js";

const require = createRequire(import.meta.url);

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

describe("every server refusal", () => {
  const read = (path: string) => (require("node:fs") as typeof import("node:fs")).readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const list = (directory: string): string[] => (require("node:fs") as typeof import("node:fs")).readdirSync(new URL(`../src/${directory}/`, import.meta.url)).filter((name) => name.endsWith(".ts"));
  const sources = { server: list("server"), adapters: list("adapters"), panel: list("panel") };

  it("is made from a key: no sentence is written inline anywhere that answers a request", () => {
    expect(read("src/core.ts").match(/ok: false, reason: "[a-z-]+", message: [`"]/g) ?? []).toEqual([]);
    expect(read("src/server/router.ts").match(/json\(\d+, \{ error:/g) ?? []).toEqual([]);
    // Wherever it is written: a body with a sentence of its own carries no key, so a page cannot say
    // it in the viewer's language and a caller cannot branch on it.
    const inline: string[] = [];
    for (const [directory, files] of Object.entries(sources)) {
      for (const file of files) {
        const path = `src/${directory}/${file}`;
        for (const line of read(path).split("\n")) if (/\berror: ["`]|\.error = ["`]/.test(line) && !line.trimStart().startsWith("*")) inline.push(`${path}: ${line.trim().slice(0, 60)}`);
      }
    }
    expect(inline).toEqual([]);
    for (const path of ["src/values/kinds.ts", "src/values/input.ts"]) {
      const unkeyed = read(path).split("new ValueError(").slice(1).filter((call) => !/^[\s\S]*?\{ key: "refuse/.test(call.slice(0, 400)));
      expect({ path, unkeyed: unkeyed.length }).toEqual({ path, unkeyed: 0 });
    }
  });

  it("carries a key the page has a message for, and the English sentence made from it", async () => {
    const { testPanel } = await import("../src/testing.js");
    const { panel, request, as } = testPanel({ serve: { auth: { token: "a-token-long-enough-1" }, controls: { edit: true } } });
    panel.modifiable(1, { label: "Level", max: 5, validate: (next: number) => (next === 3 ? "three is unlucky" : undefined) });
    const answers = [
      await request("POST", "/api/values/level", { value: 9 }, as("a-token-long-enough-1")),
      await request("POST", "/api/values/level", { value: 3 }, as("a-token-long-enough-1")),
      await request("POST", "/api/values/nope", { value: 1 }, as("a-token-long-enough-1")),
      await request("POST", "/api/values/level", "not json", { ...as("a-token-long-enough-1"), "content-type": "application/json" }),
      await request("GET", "/api/nowhere", undefined, as("a-token-long-enough-1")),
      await request("GET", "/api/schema"),
    ];
    for (const answer of answers) {
      const body = answer.json as { error: string; key: string; params: Record<string, string | number> };
      expect(Object.hasOwn(ENGLISH, body.key)).toBe(true);
      const { format } = await import("../src/i18n/messages.js");
      expect(format(ENGLISH[body.key as keyof typeof ENGLISH], body.params)).toBe(body.error);
    }
    expect((answers[1]?.json as { key: string }).key).toBe("refuseApp");
  });
});

describe("choosing a viewer's language", () => {
  it("takes the viewer's choice, then the panel's, then under auto the browser's first shipped one", async () => {
    const { chooseLocale } = await import("../src/client/i18n.js");
    const shipped = ["en", "pl", "de"];
    expect(chooseLocale("pl", "de", shipped, [])).toBe("de");
    expect(chooseLocale("pl", "xx", shipped, [])).toBe("pl");
    expect(chooseLocale("auto", undefined, shipped, ["fr-FR", "de-AT", "pl"])).toBe("de");
    expect(chooseLocale("auto", undefined, shipped, ["fr"])).toBe("en");
  });

  it("is sent with the schema only for the language asked for", async () => {
    const { createAdminPanel } = await import("../src/index.js");
    expect(createAdminPanel().schema().translations).toBeUndefined();
    expect(createAdminPanel({ locale: "de" }).schema().translations?.activity).toBe("Aktivität");
    const auto = createAdminPanel({ locale: "auto" }).schema();
    expect([auto.locale, auto.translations, auto.locales]).toEqual(["auto", undefined, ["en", "pl", "de"]]);
  });
});
