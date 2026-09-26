/**
 * Building a theme of your own, and turning any theme into custom properties.
 *
 * `defineTheme` is strict in the ways a stylesheet is not. A misspelt token (`bakground`) is
 * refused by name rather than ignored, because CSS ignores it too and the result is a theme
 * that looks applied and is not. A value that could close its declaration (`;`, `{`, `}`) or
 * the element it is served in (`<`) is refused, because a theme is configuration and should not
 * be able to become markup. Everything left out comes from the theme it extends, so a custom
 * theme is as complete as a built-in one.
 */
import { AdminPanelConfigError } from "../errors.js";
import { materialTheme } from "./material.js";
import type { Theme, ThemeColors, ThemeDefinition, ThemeShape } from "./types.js";

const COLOR_KEYS: ReadonlyArray<keyof ThemeColors> = [
  "background",
  "surface",
  "surfaceRaised",
  "border",
  "ink",
  "inkSecondary",
  "muted",
  "accent",
  "link",
  "accentStrong",
  "onAccent",
  "focus",
  "switchOn",
  "ok",
  "warn",
  "bad",
  "headerBackground",
  "headerInk",
  "grid",
  "shadow",
  "shadowRaised",
  "chart",
];

const SHAPE_KEYS: ReadonlyArray<keyof ThemeShape> = ["font", "monoFont", "fontSize", "radius", "radiusSmall", "spacing", "buttonCase", "strongWeight"];

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

export function defineTheme(definition: ThemeDefinition): Theme {
  const base = definition.extends ?? materialTheme;
  if (typeof definition.name !== "string" || !NAME.test(definition.name)) {
    throw new AdminPanelConfigError(`a theme name must be lower-case letters, digits and hyphens, starting with a letter (got ${JSON.stringify(definition.name)})`);
  }
  const light = mergeColors(definition.name, "light", base.light, definition.light);
  const dark = mergeColors(definition.name, "dark", base.dark, definition.dark);
  const shape = mergeShape(definition.name, base.shape, definition.shape);
  const css = definition.css === undefined ? base.css : `${base.css}${checkCss(definition.name, definition.css)}`;
  return Object.freeze({ name: definition.name, label: definition.label ?? definition.name, light, dark, shape, css });
}

function mergeColors(theme: string, scheme: string, base: ThemeColors, overrides: Partial<ThemeColors> | undefined): ThemeColors {
  if (overrides === undefined) return base;
  for (const key of Object.keys(overrides)) {
    if (!(COLOR_KEYS as readonly string[]).includes(key)) throw new AdminPanelConfigError(`theme "${theme}" sets ${scheme}.${key}, which is not a theme colour (the colours are ${COLOR_KEYS.join(", ")})`);
  }
  const merged = { ...base, ...stripUndefined(overrides) } as ThemeColors;
  for (const key of COLOR_KEYS) {
    if (key === "chart") continue;
    checkToken(theme, `${scheme}.${key}`, merged[key]);
  }
  if (!Array.isArray(merged.chart) || merged.chart.length !== 8) {
    throw new AdminPanelConfigError(`theme "${theme}" gives ${scheme}.chart ${Array.isArray(merged.chart) ? merged.chart.length : "no"} colours; a chart palette has exactly eight, one per series slot`);
  }
  merged.chart.forEach((colour, index) => {
    checkToken(theme, `${scheme}.chart[${index}]`, colour);
  });
  return Object.freeze(merged);
}

function mergeShape(theme: string, base: ThemeShape, overrides: Partial<ThemeShape> | undefined): ThemeShape {
  if (overrides === undefined) return base;
  for (const key of Object.keys(overrides)) {
    if (!(SHAPE_KEYS as readonly string[]).includes(key)) throw new AdminPanelConfigError(`theme "${theme}" sets shape.${key}, which is not a shape property (they are ${SHAPE_KEYS.join(", ")})`);
  }
  const merged = { ...base, ...stripUndefined(overrides) } as ThemeShape;
  for (const key of SHAPE_KEYS) checkToken(theme, `shape.${key}`, merged[key]);
  if (merged.buttonCase !== "none" && merged.buttonCase !== "uppercase") throw new AdminPanelConfigError(`theme "${theme}" sets shape.buttonCase to ${JSON.stringify(merged.buttonCase)}; it is "none" or "uppercase"`);
  return Object.freeze(merged);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/** A token becomes the right-hand side of one declaration, so it may not end that declaration or the element around it. */
function checkToken(theme: string, where: string, value: unknown): void {
  if (typeof value !== "string" || value.trim() === "") throw new AdminPanelConfigError(`theme "${theme}" leaves ${where} empty`);
  if (/[;{}<>]/.test(value) || value.includes("/*")) throw new AdminPanelConfigError(`theme "${theme}" sets ${where} to ${JSON.stringify(value)}, which could end its declaration: a token is one CSS value, without ; { } < > or comments`);
}

/**
 * Extra CSS is the author's own, so it is not sanitised as CSS. It is refused only where it
 * could stop being CSS: `</` would close the `<style>` element the page serves it in, and `<!--`
 * opens a comment the HTML parser reads first.
 */
function checkCss(theme: string, css: string): string {
  if (css.includes("</") || css.includes("<!--")) throw new AdminPanelConfigError(`theme "${theme}" has CSS containing "</" or "<!--", which would end the <style> element it is served in`);
  return css.endsWith("\n") ? css : `${css}\n`;
}

/** The custom property names, in one place so the layout, the tests and the docs agree. */
export function tokenName(key: keyof ThemeColors | keyof ThemeShape): string {
  return `--apb-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** One scheme's colours as declarations. */
export function colorDeclarations(colors: ThemeColors): string {
  const lines: string[] = [];
  for (const key of COLOR_KEYS) {
    if (key === "chart") continue;
    lines.push(`${tokenName(key)}: ${colors[key]};`);
  }
  colors.chart.forEach((colour, index) => {
    lines.push(`--apb-chart-${index + 1}: ${colour};`);
  });
  lines.push(`color-scheme: ${isDark(colors) ? "dark" : "light"};`);
  return lines.join(" ");
}

export function shapeDeclarations(shape: ThemeShape): string {
  return SHAPE_KEYS.map((key) => `${tokenName(key)}: ${shape[key]};`).join(" ");
}

/** Whether a scheme is dark, from its surface's luminance, so `color-scheme` tells the browser the truth about form controls. */
function isDark(colors: ThemeColors): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(colors.surface.trim());
  if (hex === null) return false;
  const value = Number.parseInt(hex[1] as string, 16);
  const luminance = 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255);
  return luminance < 128;
}

/**
 * A theme's tokens under `data-theme="<name>"`, for a page that offers it beside its own: a viewer's
 * choice then applies by setting one attribute, without a second stylesheet (which the page's CSP
 * would refuse). Every selector is one step more specific than its counterpart in
 * `themeStylesheet`, so the chosen theme wins in light, in dark and under the system's setting.
 * Tokens only: a theme's extra `css` applies where it is the panel's own theme.
 */
export function scopedThemeStylesheet(theme: Theme): string {
  const light = colorDeclarations(theme.light);
  const dark = colorDeclarations(theme.dark);
  const shape = shapeDeclarations(theme.shape);
  const name = `[data-theme="${theme.name}"]`;
  return [
    `.apb-root${name}, :host(${name}) { ${shape} ${light} }`,
    `@media (prefers-color-scheme: dark) { .apb-root${name}:not([data-scheme="light"]), :host(${name}:not([data-scheme="light"])) { ${dark} } }`,
    `.apb-root${name}[data-scheme="dark"], :host(${name}[data-scheme="dark"]) { ${dark} }`,
    "",
  ].join("\n");
}

/**
 * A theme as the stylesheet preamble every surface uses.
 *
 * The selector is `.apb-root, :host` rather than the family's `:root, :host`, and the reason is
 * embedding: a panel dropped into somebody's page as a fragment must not set properties on
 * that page's root, and `.apb-root` is the element the panel owns in every mode. `:host` covers
 * the custom element, where the tokens are set on the host so they inherit into the shadow tree.
 *
 * `data-scheme` beats `prefers-color-scheme` in both directions: an explicit light panel on a
 * dark system stays light, and the reverse.
 */
export function themeStylesheet(theme: Theme): string {
  const light = colorDeclarations(theme.light);
  const dark = colorDeclarations(theme.dark);
  const shape = shapeDeclarations(theme.shape);
  return [
    `.apb-root, :host { ${shape} ${light} }`,
    `@media (prefers-color-scheme: dark) { .apb-root:not([data-scheme="light"]), :host(:not([data-scheme="light"])) { ${dark} } }`,
    `.apb-root[data-scheme="dark"], :host([data-scheme="dark"]) { ${dark} }`,
    "",
  ].join("\n");
}
