/**
 * The @osqd/ui themes, for a panel that sits beside pages built with that kit.
 *
 * The palettes are copied from @osqd/ui (`src/theme/index.ts`) rather than imported, because the
 * panel has no runtime dependencies; tests/osqd-ui-themes.test.ts checks the copies against the
 * kit whenever the two folders sit side by side. The chart slots are the kit's series palette
 * (`styles/charts.css`), one set for dark schemes and one for light.
 *
 * Each @osqd/ui theme is one scheme, light or dark, and a panel theme needs both, so the seven
 * are paired by temperature: warm greys with warm greys, cool with cool. The themes are opt-in —
 * pass them in `themes` (or one as `theme`) — so the built-in set and its screenshots stay as they are.
 */
import { defineTheme } from "./define.js";
import type { Theme, ThemeColors, ThemeShape } from "./types.js";

/** The @osqd/ui palette keys this file copies. */
export interface OsqdUiPalette {
  bg: string;
  surface: string;
  raised: string;
  hover: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
  success: string;
  onSuccess: string;
  warning: string;
  onWarning: string;
  danger: string;
  onDanger: string;
  info: string;
  onInfo: string;
  neutral: string;
  onNeutral: string;
  focus: string;
  selection: string;
  overlay: string;
}

interface OsqdUiScheme {
  mode: "light" | "dark";
  palette: OsqdUiPalette;
  shadow: { sm: string; md: string; lg: string };
}

/** The seven @osqd/ui themes as published by the kit, by their names there. */
export const OSQD_UI_PALETTES: Readonly<Record<"dark" | "light" | "graphite" | "midnight" | "contrast" | "paper" | "slate", OsqdUiScheme>> = {
  dark: {
    mode: "dark",
    palette: {
      bg: "#221f22",
      surface: "#2d2a2e",
      raised: "#363337",
      hover: "#403e41",
      border: "#403e41",
      borderStrong: "#5b595c",
      text: "#fcfcfa",
      textMuted: "#c1c0c0",
      textFaint: "#a19fa1",
      primary: "#78dce8",
      onPrimary: "#19181a",
      secondary: "#ab9df2",
      onSecondary: "#19181a",
      success: "#a9dc76",
      onSuccess: "#19181a",
      warning: "#ffd866",
      onWarning: "#19181a",
      danger: "#ff6188",
      onDanger: "#19181a",
      info: "#fc9867",
      onInfo: "#19181a",
      neutral: "#5b595c",
      onNeutral: "#fcfcfa",
      focus: "#78dce8",
      selection: "rgba(120, 220, 232, 0.16)",
      overlay: "rgba(25, 24, 26, 0.72)",
    },
    shadow: {
      sm: "0 1px 2px rgba(0, 0, 0, 0.35)",
      md: "0 4px 12px rgba(0, 0, 0, 0.4)",
      lg: "0 12px 32px rgba(0, 0, 0, 0.5)",
    },
  },
  light: {
    mode: "light",
    palette: {
      bg: "#f4f4f2",
      surface: "#ffffff",
      raised: "#fafaf9",
      hover: "#ececea",
      border: "#e3e2df",
      borderStrong: "#c4c2be",
      text: "#2d2a2e",
      textMuted: "#5b595c",
      textFaint: "#716f72",
      primary: "#0e6f7c",
      onPrimary: "#ffffff",
      secondary: "#5e49c2",
      onSecondary: "#ffffff",
      success: "#3f6e17",
      onSuccess: "#ffffff",
      warning: "#8a5a00",
      onWarning: "#ffffff",
      danger: "#c01b48",
      onDanger: "#ffffff",
      info: "#b04a14",
      onInfo: "#ffffff",
      neutral: "#5b595c",
      onNeutral: "#ffffff",
      focus: "#0e6f7c",
      selection: "rgba(14, 111, 124, 0.12)",
      overlay: "rgba(45, 42, 46, 0.45)",
    },
    shadow: {
      sm: "0 1px 2px rgba(45, 42, 46, 0.08)",
      md: "0 4px 12px rgba(45, 42, 46, 0.12)",
      lg: "0 12px 32px rgba(45, 42, 46, 0.18)",
    },
  },
  graphite: {
    mode: "dark",
    palette: {
      bg: "#16181d",
      surface: "#1e2128",
      raised: "#262a32",
      hover: "#2e333c",
      border: "#2e333c",
      borderStrong: "#454b56",
      text: "#e8eaef",
      textMuted: "#b4b9c3",
      textFaint: "#8e94a0",
      primary: "#6cb6ff",
      onPrimary: "#0d1117",
      secondary: "#b392f0",
      onSecondary: "#0d1117",
      success: "#6bd99a",
      onSuccess: "#0d1117",
      warning: "#f0c060",
      onWarning: "#0d1117",
      danger: "#ff7b86",
      onDanger: "#0d1117",
      info: "#f69d50",
      onInfo: "#0d1117",
      neutral: "#4a505c",
      onNeutral: "#e8eaef",
      focus: "#6cb6ff",
      selection: "rgba(108, 182, 255, 0.16)",
      overlay: "rgba(10, 12, 16, 0.72)",
    },
    shadow: {
      sm: "0 1px 2px rgba(0, 0, 0, 0.35)",
      md: "0 4px 12px rgba(0, 0, 0, 0.4)",
      lg: "0 12px 32px rgba(0, 0, 0, 0.5)",
    },
  },
  midnight: {
    mode: "dark",
    palette: {
      bg: "#0b1020",
      surface: "#121a2e",
      raised: "#19223a",
      hover: "#212b46",
      border: "#212b46",
      borderStrong: "#34405f",
      text: "#e6ebf5",
      textMuted: "#aab4c8",
      textFaint: "#8292b0",
      primary: "#82a8ff",
      onPrimary: "#0b1020",
      secondary: "#b79cff",
      onSecondary: "#0b1020",
      success: "#8fd16a",
      onSuccess: "#0b1020",
      warning: "#e6b45c",
      onWarning: "#0b1020",
      danger: "#ff7a93",
      onDanger: "#0b1020",
      info: "#ff9c6b",
      onInfo: "#0b1020",
      neutral: "#3b4663",
      onNeutral: "#e6ebf5",
      focus: "#82a8ff",
      selection: "rgba(130, 168, 255, 0.18)",
      overlay: "rgba(5, 8, 16, 0.75)",
    },
    shadow: {
      sm: "0 1px 2px rgba(0, 0, 0, 0.45)",
      md: "0 4px 12px rgba(0, 0, 0, 0.5)",
      lg: "0 12px 32px rgba(0, 0, 0, 0.6)",
    },
  },
  contrast: {
    mode: "dark",
    palette: {
      bg: "#000000",
      surface: "#0a0a0a",
      raised: "#141414",
      hover: "#242424",
      border: "#3a3a3a",
      borderStrong: "#8a8a8a",
      text: "#ffffff",
      textMuted: "#e0e0e0",
      textFaint: "#bdbdbd",
      primary: "#5ce1ff",
      onPrimary: "#000000",
      secondary: "#c9a6ff",
      onSecondary: "#000000",
      success: "#7dff9a",
      onSuccess: "#000000",
      warning: "#ffe04d",
      onWarning: "#000000",
      danger: "#ff6b8b",
      onDanger: "#000000",
      info: "#ffa64d",
      onInfo: "#000000",
      neutral: "#5e5e5e",
      onNeutral: "#ffffff",
      focus: "#ffe04d",
      selection: "rgba(92, 225, 255, 0.25)",
      overlay: "rgba(0, 0, 0, 0.85)",
    },
    shadow: {
      sm: "0 0 0 1px #3a3a3a",
      md: "0 0 0 1px #8a8a8a",
      lg: "0 0 0 1px #8a8a8a, 0 12px 32px rgba(0, 0, 0, 0.8)",
    },
  },
  paper: {
    mode: "light",
    palette: {
      bg: "#f3efe6",
      surface: "#fbf8f1",
      raised: "#f7f3ea",
      hover: "#ebe5d8",
      border: "#e2dbcc",
      borderStrong: "#c4bba8",
      text: "#2b2620",
      textMuted: "#5a5246",
      textFaint: "#6b6354",
      primary: "#9a4a0e",
      onPrimary: "#ffffff",
      secondary: "#6b4fa0",
      onSecondary: "#ffffff",
      success: "#3d6b1f",
      onSuccess: "#ffffff",
      warning: "#855800",
      onWarning: "#ffffff",
      danger: "#b3261e",
      onDanger: "#ffffff",
      info: "#1f6a8a",
      onInfo: "#ffffff",
      neutral: "#5a5246",
      onNeutral: "#ffffff",
      focus: "#9a4a0e",
      selection: "rgba(154, 74, 14, 0.14)",
      overlay: "rgba(43, 38, 32, 0.45)",
    },
    shadow: {
      sm: "0 1px 2px rgba(43, 38, 32, 0.08)",
      md: "0 4px 12px rgba(43, 38, 32, 0.12)",
      lg: "0 12px 32px rgba(43, 38, 32, 0.18)",
    },
  },
  slate: {
    mode: "light",
    palette: {
      bg: "#eef1f5",
      surface: "#ffffff",
      raised: "#f7f9fb",
      hover: "#e6eaf0",
      border: "#dde2ea",
      borderStrong: "#b8c0cc",
      text: "#1c2430",
      textMuted: "#4a5566",
      textFaint: "#5f6a7b",
      primary: "#2457c5",
      onPrimary: "#ffffff",
      secondary: "#6a3fc4",
      onSecondary: "#ffffff",
      success: "#1f7a45",
      onSuccess: "#ffffff",
      warning: "#8a5600",
      onWarning: "#ffffff",
      danger: "#c2203a",
      onDanger: "#ffffff",
      info: "#0b6e8f",
      onInfo: "#ffffff",
      neutral: "#4a5566",
      onNeutral: "#ffffff",
      focus: "#2457c5",
      selection: "rgba(36, 87, 197, 0.12)",
      overlay: "rgba(28, 36, 48, 0.45)",
    },
    shadow: {
      sm: "0 1px 2px rgba(28, 36, 48, 0.08)",
      md: "0 4px 12px rgba(28, 36, 48, 0.12)",
      lg: "0 12px 32px rgba(28, 36, 48, 0.18)",
    },
  },
};

const DARK_SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"] as const;
const LIGHT_SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"] as const;

/** One @osqd/ui scheme as the panel's colours. Every pairing passes tests/themes.test.ts as it is. */
function colors(scheme: OsqdUiScheme): ThemeColors {
  const p = scheme.palette;
  return {
    background: p.bg,
    surface: p.surface,
    surfaceRaised: p.raised,
    border: p.border,
    ink: p.text,
    inkSecondary: p.textMuted,
    muted: p.textFaint,
    accent: p.primary,
    link: p.primary,
    accentStrong: p.primary,
    onAccent: p.onPrimary,
    focus: p.focus,
    switchOn: p.primary,
    ok: p.success,
    warn: p.warning,
    bad: p.danger,
    headerBackground: p.surface,
    headerInk: p.text,
    grid: p.border,
    shadow: scheme.shadow.sm,
    shadowRaised: scheme.shadow.md,
    chart: scheme.mode === "dark" ? DARK_SERIES : LIGHT_SERIES,
  };
}

/**
 * The kit's type, radii and density. Spacing is the panel's own unit rather than the kit's 4px:
 * the panel's gaps are small multiples of it, and 6px gives the same density the OSQD theme has.
 */
const shape: ThemeShape = {
  font: "\"Inter\", \"Segoe UI\", system-ui, -apple-system, \"Helvetica Neue\", Arial, sans-serif",
  monoFont: "\"JetBrains Mono\", \"Fira Code\", \"Cascadia Code\", ui-monospace, \"SF Mono\", Menlo, Consolas, monospace",
  fontSize: "14px",
  radius: "8px",
  radiusSmall: "5px",
  spacing: "6px",
  buttonCase: "none",
  strongWeight: "600",
};

function pair(name: string, label: string, light: OsqdUiScheme, dark: OsqdUiScheme): Theme {
  return defineTheme({ name, label, light: colors(light), dark: colors(dark), shape, css: "" });
}

const P = OSQD_UI_PALETTES;

/** Warm greys: the kit's default light and dark. */
export const osqdUiTheme = pair("osqd-ui", "OSQD UI", P.light, P.dark);
/** Cool neutral greys with a blue lead: slate by day, graphite by night. */
export const osqdUiGraphiteTheme = pair("osqd-ui-graphite", "OSQD UI Graphite", P.slate, P.graphite);
/** Deep navy for dark rooms, with slate as its light side. */
export const osqdUiMidnightTheme = pair("osqd-ui-midnight", "OSQD UI Midnight", P.slate, P.midnight);
/** Warm off-white for reading-heavy panels, with the warm dark greys. */
export const osqdUiPaperTheme = pair("osqd-ui-paper", "OSQD UI Paper", P.paper, P.dark);
/** Black and white with a yellow focus ring in dark; the kit has no high-contrast light, so light is its default. */
export const osqdUiContrastTheme = pair("osqd-ui-contrast", "OSQD UI Contrast", P.light, P.contrast);

/** All five, for `createAdminPanel({ themes: OSQD_UI_THEMES })`. */
export const OSQD_UI_THEMES: readonly Theme[] = Object.freeze([osqdUiTheme, osqdUiGraphiteTheme, osqdUiMidnightTheme, osqdUiPaperTheme, osqdUiContrastTheme]);
