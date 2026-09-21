/**
 * The default theme, after Material Design as MUI ships it.
 *
 * Colours are MUI's default palette (primary #1976d2, success #2e7d32, warning #ed6c02, error
 * #d32f2f in light; the 200-weight tones on #121212 in dark), the type is Roboto where it is
 * installed, corners are 4px, cards sit on elevation 1, and buttons are labelled in capitals.
 * No font is fetched: the panel's CSP allows nothing from elsewhere, and an operator's tool
 * should not tell a font CDN who is looking at it. Where Roboto is absent the system sans
 * stands in.
 *
 * Text in the accent uses MUI's primary.dark (#1565c0): primary itself measures 4.2:1 on the
 * grey page, under the 4.5:1 text needs, which an axe pass over the page caught.
 *
 * Chart colours are not MUI's: its palette puts red and green side by side, which reads as
 * one colour to one man in twelve. These are Okabe–Ito hues moved to MUI's tones.
 */
import type { Theme } from "./types.js";

export const materialTheme: Theme = {
  name: "material",
  label: "Material",
  light: {
    background: "#f5f5f5",
    surface: "#ffffff",
    surfaceRaised: "#fafafa",
    border: "#e0e0e0",
    ink: "#212121",
    inkSecondary: "#5f5f5f",
    muted: "#6b6b6b",
    accent: "#1976d2",
    link: "#1565c0",
    // White on #1976d2 measures 4.6:1, so MUI's primary can carry its own labels.
    accentStrong: "#1976d2",
    onAccent: "#ffffff",
    focus: "#1976d2",
    switchOn: "#1976d2",
    ok: "#2e7d32",
    warn: "#b35100",
    bad: "#d32f2f",
    headerBackground: "#1976d2",
    headerInk: "#ffffff",
    grid: "#eeeeee",
    shadow: "0 2px 1px -1px rgba(0,0,0,.2), 0 1px 1px 0 rgba(0,0,0,.14), 0 1px 3px 0 rgba(0,0,0,.12)",
    chart: ["#1976d2", "#e66a00", "#00897b", "#c2185b", "#5e35b1", "#8d6e00", "#0097a7", "#616161"],
  },
  dark: {
    background: "#121212",
    surface: "#1e1e1e",
    surfaceRaised: "#262626",
    border: "#333333",
    ink: "#ffffff",
    inkSecondary: "#c2c2c2",
    muted: "#a3a3a3",
    accent: "#90caf9",
    link: "#90caf9",
    accentStrong: "#90caf9",
    onAccent: "#0d1b2a",
    focus: "#90caf9",
    switchOn: "#90caf9",
    ok: "#66bb6a",
    warn: "#ffa726",
    bad: "#f44336",
    headerBackground: "#272727",
    headerInk: "#ffffff",
    grid: "#2c2c2c",
    shadow: "0 2px 1px -1px rgba(0,0,0,.4), 0 1px 1px 0 rgba(0,0,0,.28), 0 1px 3px 0 rgba(0,0,0,.24)",
    chart: ["#90caf9", "#ffb74d", "#4db6ac", "#f48fb1", "#b39ddb", "#e6c35c", "#4dd0e1", "#bdbdbd"],
  },
  shape: {
    font: 'Roboto, "Helvetica Neue", Arial, system-ui, sans-serif',
    monoFont: '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: "14px",
    radius: "4px",
    radiusSmall: "4px",
    spacing: "8px",
    buttonCase: "uppercase",
    strongWeight: "500",
  },
  css: "",
};
