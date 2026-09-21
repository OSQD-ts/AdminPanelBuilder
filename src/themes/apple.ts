/**
 * A theme after Apple's Human Interface Guidelines: the grouped, inset look of Settings.
 *
 * System colours from the guidelines (systemBlue #007aff / #0a84ff, systemGreen, systemOrange,
 * systemRed), grouped backgrounds (#f2f2f7 behind #ffffff cards; #000000 behind #1c1c1e in
 * dark), 10px corners, no shadows, hairline separators, and the system font, which is San
 * Francisco on Apple hardware and the platform's own elsewhere. Switches are green when on, as
 * they are on iOS.
 *
 * One deliberate departure: filled buttons use a deeper blue than systemBlue, in both schemes.
 * White on #007aff measures 4.0:1 and on dark mode's #0a84ff 3.65:1, both under the 4.5:1 body
 * text needs; #0064d1 measures 5.3:1 and still reads as the same blue. Links and focus keep
 * systemBlue. `tests/themes.test.ts` measures every one of these.
 */
import type { Theme } from "./types.js";

export const appleTheme: Theme = {
  name: "apple",
  label: "Apple",
  light: {
    background: "#f2f2f7",
    surface: "#ffffff",
    surfaceRaised: "#f2f2f7",
    border: "#d1d1d6",
    ink: "#000000",
    inkSecondary: "#3c3c43",
    muted: "#6c6c70",
    accent: "#007aff",
    link: "#0064d1",
    accentStrong: "#0064d1",
    onAccent: "#ffffff",
    focus: "#007aff",
    switchOn: "#248a3d",
    ok: "#248a3d",
    warn: "#c93400",
    bad: "#d70015",
    headerBackground: "#f9f9f9",
    headerInk: "#000000",
    grid: "#e5e5ea",
    shadow: "none",
    chart: ["#007aff", "#ff9500", "#34c759", "#ff2d55", "#af52de", "#a2845e", "#30b0c7", "#5856d6"],
  },
  dark: {
    background: "#000000",
    surface: "#1c1c1e",
    surfaceRaised: "#2c2c2e",
    border: "#38383a",
    ink: "#ffffff",
    inkSecondary: "#ebebf5",
    muted: "#98989f",
    accent: "#0a84ff",
    link: "#409cff",
    accentStrong: "#0064d1",
    onAccent: "#ffffff",
    focus: "#0a84ff",
    switchOn: "#30d158",
    ok: "#30d158",
    warn: "#ff9f0a",
    bad: "#ff453a",
    headerBackground: "#1d1d1f",
    headerInk: "#ffffff",
    grid: "#2c2c2e",
    shadow: "none",
    chart: ["#0a84ff", "#ff9f0a", "#30d158", "#ff375f", "#bf5af2", "#ac8e68", "#40c8e0", "#5e5ce6"],
  },
  shape: {
    font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif',
    monoFont: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace',
    fontSize: "15px",
    radius: "10px",
    radiusSmall: "8px",
    spacing: "8px",
    buttonCase: "none",
    strongWeight: "600",
  },
  // Settings-style cards: no border, the grouped background does the separating.
  css: ".apb-card { border-color: transparent; }\n.apb-header { border-bottom: 1px solid var(--apb-border); }\n",
};
