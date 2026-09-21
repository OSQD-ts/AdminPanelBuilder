/**
 * The theme playground: every widget in every theme, light and dark, with each theme's contrast
 * measured on the page, and the `defineTheme()` call to start a theme of your own from it.
 *
 *   npm run playground          → http://127.0.0.1:9786/
 *
 * Each theme is a snapshot of the same sample panel, so what you compare is the theme and nothing
 * else. The contrast table uses `contrastRatio`, the function the theme tests use, so the page and
 * the test suite cannot disagree about a number.
 */
import { createAdminPanel } from "../core.js";
import { BUILT_IN_THEMES } from "../themes/index.js";
import { contrastRatio } from "../themes/contrast.js";
import type { Theme, ThemeColors } from "../themes/types.js";
import { clientScript, escapeHtml } from "./html.js";

const PAIRS: Array<[keyof ThemeColors, keyof ThemeColors, number]> = [
  ["ink", "surface", 4.5],
  ["inkSecondary", "surface", 4.5],
  ["muted", "surface", 4.5],
  ["link", "background", 4.5],
  ["onAccent", "accentStrong", 4.5],
  ["headerInk", "headerBackground", 4.5],
  ["bad", "surface", 4.5],
  ["warn", "surface", 3],
  ["accent", "surface", 3],
];

/** A whole document. `nonce` goes on every inline style and script it carries. */
export function themePlaygroundHtml(themes: readonly Theme[] = Object.values(BUILT_IN_THEMES), nonce?: string): string {
  const sections: string[] = [];
  for (const theme of themes) {
    for (const scheme of ["light", "dark"] as const) {
      const panel = createAdminPanel({ title: `${theme.label} · ${scheme}`, theme, colorScheme: scheme });
      const players = panel.viewable(412, { label: "Players online", group: "Sample", chart: true, status: { warn: 400, bad: 900 } });
      for (const reading of [120, 180, 260, 330, 412]) players.value = reading;
      panel.modifiable(200, { label: "Largest rating gap", group: "Sample", min: 50, max: 1000, step: 50 });
      panel.modifiable(true, { label: "Guests may play", group: "Sample" });
      panel.viewable({ blitz: 30, rapid: 12, classical: 4 }, { label: "Waiting", group: "Sample", chart: { over: "keys" } });
      panel.action("End abandoned games", () => undefined, { group: "Sample", destructive: true });
      const rows = PAIRS.map(([text, surface, minimum]) => {
        const ratio = contrastRatio(theme[scheme][text] as string, theme[scheme][surface] as string);
        const verdict = ratio === undefined ? "not measured" : ratio >= minimum ? "passes" : "FAILS";
        return `<tr><td>${text} on ${surface}</td><td>${ratio === undefined ? "—" : ratio.toFixed(2)}:1</td><td>${minimum}:1</td><td>${verdict}</td></tr>`;
      }).join("");
      sections.push(
        `<section class="pg-theme"><h2>${escapeHtml(theme.label)} — ${scheme}</h2>${panel.html({ snapshot: true, script: false, ...(nonce === undefined ? {} : { nonce }) })}<table class="pg-contrast"><caption>Measured contrast</caption><thead><tr><th scope="col">Pair</th><th scope="col">Ratio</th><th scope="col">Needs</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table></section>`,
      );
      panel.close();
    }
  }
  const nonceAttribute = nonce === undefined ? "" : ` nonce="${escapeHtml(nonce)}"`;
  const snippet = `import { defineTheme, materialTheme } from "@osqd/admin-panel-builder";\n\nexport const brand = defineTheme({\n  name: "brand",\n  extends: materialTheme,\n  light: { accent: "#6a1b9a", link: "#6a1b9a", accentStrong: "#6a1b9a" },\n  dark: { accent: "#ce93d8", link: "#ce93d8" },\n  shape: { radius: "6px" },\n});`;
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Theme playground</title>',
    `<style${nonceAttribute}>body { margin: 0; font-family: system-ui, sans-serif; } .pg-intro { padding: 16px 24px; max-width: 70ch; } .pg-theme { margin: 0 0 32px; } .pg-theme > h2 { padding: 0 24px; } .pg-contrast { margin: 12px 24px; border-collapse: collapse; } .pg-contrast td, .pg-contrast th { border: 1px solid #999; padding: 4px 8px; text-align: left; } pre { background: #f4f4f4; padding: 12px; overflow: auto; }</style>`,
    "</head><body><main>",
    `<div class="pg-intro"><h1>Theme playground</h1><p>Every built-in theme, light and dark, drawing the same sample panel. Under each, its text colours measured against the surfaces they sit on. Start a theme of your own from this:</p><pre>${escapeHtml(snippet)}</pre></div>`,
    ...sections,
    // One client for every snapshot above: it mounts each of them.
    clientScript(nonce === undefined ? {} : { nonce }),
    "</main></body></html>",
  ].join("\n");
}
