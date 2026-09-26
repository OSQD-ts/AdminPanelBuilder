/**
 * The look of the sibling dashboards, for a panel that sits beside them.
 *
 * Colours are hackerpot's and bothandlerjs's dashboard tokens (the same values, so a
 * deployment running all three reads as one product), with their eight chart slots in their
 * order. Dense, square-ish, the system font.
 */
import type { Theme } from "./types.js";

export const osqdTheme: Theme = {
  name: "osqd",
  label: "OSQD",
  light: {
    background: "#f4f5f7",
    surface: "#ffffff",
    surfaceRaised: "#f3f4f6",
    border: "#e4e6ea",
    ink: "#0b0d12",
    inkSecondary: "#3c414b",
    muted: "#5f646e",
    accent: "#2a78d6",
    link: "#1b5fb0",
    accentStrong: "#1b5fb0",
    onAccent: "#ffffff",
    focus: "#2a78d6",
    switchOn: "#1b5fb0",
    ok: "#006300",
    warn: "#6d4700",
    bad: "#b02525",
    headerBackground: "#ffffff",
    headerInk: "#0b0d12",
    grid: "#eceef1",
    shadow: "0 1px 2px rgba(11,13,18,.06), 0 1px 8px rgba(11,13,18,.04)",
    shadowRaised: "0 1px 3px rgba(11,13,18,.06), 0 6px 18px rgba(11,13,18,.08)",
    chart: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  },
  dark: {
    background: "#0d0f12",
    surface: "#16181d",
    surfaceRaised: "#1b1e24",
    border: "#272b33",
    ink: "#f2f4f7",
    inkSecondary: "#c4cad3",
    muted: "#8b929c",
    accent: "#3987e5",
    link: "#86b6ef",
    accentStrong: "#2364b4",
    onAccent: "#ffffff",
    focus: "#86b6ef",
    switchOn: "#3987e5",
    ok: "#4ec97a",
    warn: "#fab219",
    bad: "#ff8078",
    headerBackground: "#16181d",
    headerInk: "#f2f4f7",
    grid: "#23272e",
    shadow: "none",
    shadowRaised: "0 1px 3px rgba(0,0,0,.4), 0 6px 20px rgba(0,0,0,.45)",
    chart: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  },
  shape: {
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    monoFont: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "13px",
    radius: "6px",
    radiusSmall: "4px",
    spacing: "6px",
    buttonCase: "none",
    strongWeight: "600",
  },
  css: "",
};
