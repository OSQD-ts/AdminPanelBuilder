/**
 * The themes, on their own entry so a build step can render a stylesheet without a panel.
 */
import { AdminPanelConfigError } from "../errors.js";
import { appleTheme } from "./apple.js";
import { carbonTheme } from "./carbon.js";
import { fluentTheme } from "./fluent.js";
import { highContrastTheme } from "./high-contrast.js";
import { materialTheme } from "./material.js";
import { osqdTheme } from "./osqd.js";
import type { Theme } from "./types.js";

export { appleTheme } from "./apple.js";
export { carbonTheme } from "./carbon.js";
export { contrastRatio } from "./contrast.js";
export { fluentTheme } from "./fluent.js";
export { highContrastTheme } from "./high-contrast.js";
export { materialTheme } from "./material.js";
export { osqdTheme } from "./osqd.js";
export { defineTheme, themeStylesheet, tokenName } from "./define.js";
export type { Theme, ThemeColors, ThemeDefinition, ThemeShape } from "./types.js";

/** The themes that ship, by name. Public so a settings screen can offer them without hard-coding the list. */
export const BUILT_IN_THEMES: Readonly<Record<string, Theme>> = Object.freeze({
  material: materialTheme,
  apple: appleTheme,
  osqd: osqdTheme,
  fluent: fluentTheme,
  carbon: carbonTheme,
  "high-contrast": highContrastTheme,
});

/** A theme, or the name of a built-in one. An unknown name is refused rather than falling back to the default. */
export function resolveTheme(theme: Theme | string | undefined): Theme {
  if (theme === undefined) return materialTheme;
  if (typeof theme !== "string") return theme;
  const found = BUILT_IN_THEMES[theme];
  if (found === undefined) throw new AdminPanelConfigError(`there is no built-in theme called "${theme}" (there are ${Object.keys(BUILT_IN_THEMES).join(", ")}); pass a theme from defineTheme to use your own`);
  return found;
}
