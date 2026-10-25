/**
 * The bridge from a theme to the component kit's custom properties.
 *
 * The page is drawn with the `@osqd/ui` component classes (`oq-btn`, `oq-input`, `oq-tabs` …),
 * which read `--oq-*` properties, while a theme here is written in its own terms (`--apb-*`, a
 * light and a dark scheme, a shape). Rather than ask a theme for a second vocabulary, every scheme's
 * declarations carry the kit's names as well, derived from the theme's own colours: the theme API,
 * its token names and `defineTheme` stay exactly as they were, and a custom theme reaches the kit's
 * components without knowing they exist.
 *
 * Most names map one to one. The kit has a few the theme does not — a hover fill, a second border,
 * the text colour on each intent — and those are derived here. The text colours are chosen when the
 * stylesheet is built, black or white, whichever reads better on that fill; the theme tests hold every
 * pair to 4.5:1 (tests/themes.test.ts).
 */
import type { ThemeColors, ThemeShape } from "./types.js";

const BLACK = "#000000";
const WHITE = "#ffffff";

/** `#rgb` or `#rrggbb` as linear-light luminance, or undefined for anything else (a theme may write any CSS colour). */
export function luminance(colour: string): number | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim());
  if (match === null) return undefined;
  let hex = match[1] as string;
  if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join("");
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast between two colours, or undefined when either is not a hex colour. */
export function contrast(a: string, b: string): number | undefined {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === undefined || lb === undefined) return undefined;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The text colour for a fill: black or white, whichever contrasts more. One of the two always
 * reaches 4.58:1, so this is never the reason a pair fails. A fill that is not a hex colour falls
 * back to the theme's own text-on-accent.
 */
export function textOn(fill: string, fallback: string): string {
  const black = contrast(fill, BLACK);
  const white = contrast(fill, WHITE);
  if (black === undefined || white === undefined) return fallback;
  return black >= white ? BLACK : WHITE;
}

/** The kit's intents, each with the theme colour it is drawn in. */
export function kitIntents(colors: ThemeColors): Record<"primary" | "secondary" | "success" | "warning" | "danger" | "info" | "neutral", string> {
  return {
    primary: colors.accentStrong,
    // The theme measures `link` as text on its surfaces, which is what the kit's second and
    // informational intents are mostly used as.
    secondary: colors.link,
    success: colors.ok,
    warning: colors.warn,
    danger: colors.bad,
    info: colors.link,
    neutral: colors.muted,
  };
}

const SEQ = [6, 14, 22, 30, 37, 45, 53, 61, 69, 76, 84, 92, 100];
const ORD = [32, 49, 66, 83, 100];

/** One scheme's colours in the kit's names. */
export function kitColorDeclarations(colors: ThemeColors, dark: boolean): string {
  const intents = kitIntents(colors);
  const lines: string[] = [
    `--oq-bg: ${colors.background};`,
    `--oq-surface: ${colors.surface};`,
    `--oq-raised: ${colors.surfaceRaised};`,
    `--oq-hover: color-mix(in srgb, ${colors.ink} 6%, ${colors.surface});`,
    `--oq-border: ${colors.border};`,
    `--oq-border-strong: color-mix(in srgb, ${colors.border} 55%, ${colors.muted});`,
    `--oq-text: ${colors.ink};`,
    `--oq-text-muted: ${colors.inkSecondary};`,
    `--oq-text-faint: ${colors.muted};`,
  ];
  for (const [name, fill] of Object.entries(intents)) {
    const on = name === "primary" ? colors.onAccent : textOn(fill, colors.onAccent);
    lines.push(`--oq-${name}: ${fill};`, `--oq-on-${name}: ${on};`);
  }
  lines.push(
    `--oq-focus: ${colors.focus};`,
    `--oq-selection: color-mix(in srgb, ${colors.accent} 22%, transparent);`,
    `--oq-overlay: color-mix(in srgb, ${dark ? colors.background : colors.ink} ${dark ? 72 : 40}%, transparent);`,
    `--oq-shadow-sm: ${colors.shadow};`,
    `--oq-shadow-md: ${colors.shadowRaised};`,
    `--oq-shadow-lg: ${colors.shadowRaised};`,
  );
  colors.chart.forEach((colour, index) => {
    lines.push(`--oq-series-${index + 1}: ${colour};`);
  });
  SEQ.forEach((share, index) => {
    lines.push(`--oq-seq-${index}: color-mix(in oklab, ${colors.accentStrong} ${share}%, ${colors.surface});`);
  });
  ORD.forEach((share, index) => {
    lines.push(`--oq-ord-${index + 1}: color-mix(in oklab, ${colors.accentStrong} ${share}%, ${colors.surface});`);
  });
  return lines.join(" ");
}

/** The kit's type scale, radii, spacing and control heights from the theme's shape. */
export function kitShapeDeclarations(shape: ThemeShape): string {
  // The kit's scale is steps from its base size; written as calc() so a size in any unit works.
  const steps: Array<[string, string]> = [
    ["xs", "- 3px"],
    ["sm", "- 1px"],
    ["md", "+ 0px"],
    ["lg", "+ 2px"],
    ["xl", "+ 4px"],
    ["2xl", "+ 8px"],
    ["3xl", "+ 14px"],
  ];
  return [
    `--oq-font-sans: ${shape.font};`,
    `--oq-font-mono: ${shape.monoFont};`,
    "--oq-line-height: 1.5;",
    ...steps.map(([name, step]) => `--oq-text-${name}: calc(${shape.fontSize} ${step});`),
    `--oq-radius-sm: ${shape.radiusSmall};`,
    `--oq-radius-md: ${shape.radiusSmall};`,
    `--oq-radius-lg: ${shape.radius};`,
    // The kit counts in 4px steps; a theme's spacing is the gap between two controls (6–8px).
    `--oq-space: calc(${shape.spacing} / 2);`,
    `--oq-control-sm: calc(${shape.spacing} * 3.5);`,
    `--oq-control-md: calc(${shape.spacing} * 4.5);`,
    `--oq-control-lg: calc(${shape.spacing} * 5.5);`,
    "--oq-motion: 150ms;",
  ].join(" ");
}
