/**
 * High contrast: the theme somebody may need rather than prefer.
 *
 * Every text colour measures at least 7:1 against its surface (WCAG AAA), borders are solid ink
 * rather than grey, focus rings are thick, and nothing depends on a shadow or a tint to be seen.
 * Dark is yellow on black, the pairing low-vision users most often choose. `tests/themes.test.ts`
 * holds it to 7:1, not the 4.5:1 of the others.
 */
import type { Theme } from "./types.js";

export const highContrastTheme: Theme = {
  name: "high-contrast",
  label: "High contrast",
  light: {
    background: "#ffffff",
    surface: "#ffffff",
    surfaceRaised: "#ffffff",
    border: "#000000",
    ink: "#000000",
    inkSecondary: "#000000",
    muted: "#333333",
    accent: "#0000cc",
    link: "#0000cc",
    accentStrong: "#000000",
    onAccent: "#ffffff",
    focus: "#000000",
    switchOn: "#000000",
    ok: "#005a00",
    warn: "#6b3e00",
    bad: "#a00000",
    headerBackground: "#000000",
    headerInk: "#ffffff",
    grid: "#767676",
    shadow: "none",
    shadowRaised: "none",
    chart: ["#0000cc", "#a00000", "#005a00", "#6b3e00", "#6600cc", "#004c66", "#8b0045", "#333333"],
  },
  dark: {
    background: "#000000",
    surface: "#000000",
    surfaceRaised: "#000000",
    border: "#ffffff",
    ink: "#ffffff",
    inkSecondary: "#ffffff",
    muted: "#e0e0e0",
    accent: "#ffff00",
    link: "#ffff00",
    accentStrong: "#ffff00",
    onAccent: "#000000",
    focus: "#ffff00",
    switchOn: "#ffff00",
    ok: "#7cfc00",
    warn: "#ffd700",
    bad: "#ff9090",
    headerBackground: "#000000",
    headerInk: "#ffffff",
    grid: "#aaaaaa",
    shadow: "none",
    shadowRaised: "none",
    chart: ["#ffff00", "#00ffff", "#7cfc00", "#ff80ff", "#ffa500", "#80c0ff", "#ff9090", "#ffffff"],
  },
  shape: {
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    monoFont: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "16px",
    radius: "4px",
    radiusSmall: "4px",
    spacing: "8px",
    buttonCase: "none",
    strongWeight: "700",
  },
  css: ".apb-root :focus-visible { outline-width: 3px; }\n.apb-card { border-width: 2px; }\n.apb-button, .apb-input, .apb-select, .apb-textarea { border-width: 2px; }\n",
};
