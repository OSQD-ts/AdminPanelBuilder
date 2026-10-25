/**
 * The @osqd/ui themes are copies, so they are checked against the kit they were copied from.
 *
 * The kit is a sibling folder in the OSQD workspace, not a dependency, so this suite runs only
 * where that folder exists and says so when it does not. The kit's theme module has no imports,
 * which is what lets it load straight from its source.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES, OSQD_UI_THEMES } from "../src/index.js";
import { OSQD_UI_PALETTES } from "../src/themes/osqd-ui.js";

const KIT = fileURLToPath(new URL("../../OSQD-UI/src/theme/index.ts", import.meta.url));
const present = existsSync(KIT);

describe("the @osqd/ui themes", () => {
  it("are opt-in, not built in", () => {
    for (const theme of OSQD_UI_THEMES) expect(BUILT_IN_THEMES[theme.name]).toBeUndefined();
  });

  it("have names a configuration can use", () => {
    expect(OSQD_UI_THEMES.map((theme) => theme.name)).toEqual(["osqd-ui", "osqd-ui-graphite", "osqd-ui-midnight", "osqd-ui-paper", "osqd-ui-contrast"]);
  });

  it.skipIf(!present)("still match the kit (../OSQD-UI)", async () => {
    const kit = (await import(pathToFileURL(KIT).href)) as { themes: Record<string, { mode: string; palette: Record<string, string>; shadow: Record<string, string> }> };
    expect(Object.keys(OSQD_UI_PALETTES).sort()).toEqual(Object.keys(kit.themes).sort());
    for (const [name, copy] of Object.entries(OSQD_UI_PALETTES)) {
      const source = kit.themes[name];
      expect([name, copy.mode]).toEqual([name, source?.mode]);
      expect([name, copy.palette]).toEqual([name, source?.palette]);
      expect([name, copy.shadow]).toEqual([name, source?.shadow]);
    }
  });

  it.runIf(!present)("skip the comparison with the kit, which is not beside this folder", () => {
    expect(present).toBe(false);
  });
});
