/**
 * Themes as a contract. Every text colour a theme sets is measured against the surface it sits
 * on, so a theme cannot ship a grey that looks fine on the author's monitor and fails a reader;
 * and every custom property the layout uses must be one a theme defines, so a renamed token
 * cannot leave half the page unstyled while every screenshot still looks right.
 */
import { describe, expect, it } from "vitest";
import { AdminPanelConfigError, appleTheme, BUILT_IN_THEMES, defineTheme, highContrastTheme, materialTheme, type Theme, type ThemeColors, themePlaygroundHtml } from "../src/index.js";
import { LAYOUT_CSS } from "../src/render/layout.js";
import { themeStylesheet } from "../src/themes/define.js";

function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const channel = (shift: number): number => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Text colour, the surface it is read on, and the ratio it must reach. */
const PAIRS: Array<[keyof ThemeColors, keyof ThemeColors, number]> = [
  ["ink", "surface", 4.5],
  ["ink", "background", 4.5],
  ["inkSecondary", "surface", 4.5],
  ["inkSecondary", "background", 4.5],
  ["muted", "surface", 4.5],
  ["accent", "surface", 3],
  ["link", "surface", 4.5],
  ["link", "background", 4.5],
  ["onAccent", "accentStrong", 4.5],
  ["headerInk", "headerBackground", 4.5],
  ["bad", "surface", 4.5],
  ["warn", "surface", 3],
];

describe.each(Object.values(BUILT_IN_THEMES).map((theme) => [theme.name, theme] as [string, Theme]))("the %s theme", (_name, theme) => {
  for (const scheme of ["light", "dark"] as const) {
    it(`reads clearly in ${scheme}`, () => {
      const colors = theme[scheme];
      const failures = PAIRS.filter(([text, surface, minimum]) => contrast(colors[text] as string, colors[surface] as string) < minimum).map(
        ([text, surface, minimum]) => `${text} on ${surface}: ${contrast(colors[text] as string, colors[surface] as string).toFixed(2)} < ${minimum}`,
      );
      expect(failures).toEqual([]);
    });
  }

  it("has eight chart colours in each scheme", () => {
    expect(theme.light.chart).toHaveLength(8);
    expect(theme.dark.chart).toHaveLength(8);
  });
});

describe("the high-contrast theme", () => {
  it("holds every text colour to 7:1, not 4.5:1", () => {
    for (const scheme of ["light", "dark"] as const) {
      const colors = highContrastTheme[scheme];
      for (const [text, surface] of [["ink", "surface"], ["inkSecondary", "surface"], ["muted", "surface"], ["link", "background"], ["onAccent", "accentStrong"], ["headerInk", "headerBackground"], ["bad", "surface"], ["warn", "surface"], ["ok", "surface"]] as const) {
        expect([scheme, text, contrast(colors[text] as string, colors[surface] as string) >= 7]).toEqual([scheme, text, true]);
      }
    }
  });
});

describe("the theme playground", () => {
  it("draws every theme in both schemes, with the measured table and a nonce on every inline element", () => {
    const html = themePlaygroundHtml(undefined, "n0nce");
    for (const theme of Object.values(BUILT_IN_THEMES)) {
      expect(html).toContain(`${theme.label} — light`);
      expect(html).toContain(`${theme.label} — dark`);
    }
    expect(html).not.toContain("FAILS");
    // JSON data blocks never execute, so they need no nonce; everything that runs or styles does.
    expect(html.match(/<(script|style)(?![^>]*nonce="n0nce")(?![^>]*application\/json)[^>]*>/g) ?? []).toEqual([]);
  });
});

describe("the claims the theme files make", () => {
  it("are the measured ratios", () => {
    expect(contrast("#ffffff", "#1976d2")).toBeCloseTo(4.6, 1);
    expect(contrast("#ffffff", "#007aff")).toBeCloseTo(4.0, 1);
    expect(contrast("#ffffff", "#0a84ff")).toBeCloseTo(3.65, 2);
    expect(contrast("#ffffff", "#0064d1")).toBeGreaterThanOrEqual(5.3);
  });
});

describe("the layout and the tokens", () => {
  it("use no custom property that neither a theme nor the layout itself defines", () => {
    const defined = new Set([...themeStylesheet(materialTheme).matchAll(/(--apb-[a-z0-9-]+):/g)].map((match) => match[1]));
    defined.add("--apb-series");
    // The layout's own measures (gutter, page width, control height) are derived from tokens, and a theme never sets them.
    const own = [...LAYOUT_CSS.matchAll(/(--apb-[a-z0-9-]+):/g)].map((match) => match[1]);
    for (const name of own) defined.add(name);
    expect(own.filter((name) => themeStylesheet(materialTheme).includes(`${name}:`))).toEqual([]);
    const used = new Set([...LAYOUT_CSS.matchAll(/var\((--apb-[a-z0-9-]+)\)/g)].map((match) => match[1]));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("contain no colour literal, so no theme can be half applied", () => {
    expect(LAYOUT_CSS.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("let an explicit scheme beat the viewer's system in both directions", () => {
    const css = themeStylesheet(materialTheme);
    expect(css).toContain('.apb-root:not([data-scheme="light"])');
    expect(css).toContain('.apb-root[data-scheme="dark"]');
  });
});

describe("a theme of your own", () => {
  it("fills everything it does not set from the theme it extends", () => {
    const brand = defineTheme({ name: "brand", extends: appleTheme, light: { accent: "#6a1b9a" }, shape: { radius: "2px" } });
    expect(brand.light.accent).toBe("#6a1b9a");
    expect(brand.light.surface).toBe(appleTheme.light.surface);
    expect(brand.dark).toBe(appleTheme.dark);
    expect(brand.shape.radius).toBe("2px");
    expect(brand.shape.font).toBe(appleTheme.shape.font);
  });

  it("refuses a misspelt token by name rather than ignoring it the way CSS would", () => {
    expect(() => defineTheme({ name: "x", light: { bakground: "#fff" } as never })).toThrow(/sets light.bakground, which is not a theme colour/);
    expect(() => defineTheme({ name: "x", shape: { radious: "2px" } as never })).toThrow(/shape.radious, which is not a shape property/);
  });

  it("refuses a value that could end its declaration or its element", () => {
    expect(() => defineTheme({ name: "x", light: { accent: "red; } body { display: none" } })).toThrow(AdminPanelConfigError);
    expect(() => defineTheme({ name: "x", light: { accent: "</style><script>" } })).toThrow(AdminPanelConfigError);
    expect(() => defineTheme({ name: "x", css: ".a{}</style><script>alert(1)</script>" })).toThrow(/would end the <style> element/);
  });

  it("refuses a palette that is not eight colours, and a name that is not a slug", () => {
    expect(() => defineTheme({ name: "x", light: { chart: ["#000"] as never } })).toThrow(/exactly eight/);
    expect(() => defineTheme({ name: "Brand Theme" })).toThrow(/lower-case letters/);
  });

  it("appends its CSS after the theme it extends", () => {
    const brand = defineTheme({ name: "brand", extends: appleTheme, css: ".apb-title { letter-spacing: .1em; }" });
    expect(brand.css.startsWith(appleTheme.css)).toBe(true);
    expect(brand.css).toContain("letter-spacing");
  });
});
