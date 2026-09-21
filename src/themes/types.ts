/**
 * What a theme is: two sets of colours and one shape.
 *
 * A theme is data rather than a stylesheet. The panel's layout is one stylesheet written once
 * against custom properties, and a theme fills those properties in, so a theme cannot break the
 * layout, a custom theme gets every screen the built-in ones get, and switching theme at run
 * time is swapping a few dozen declarations. The escape hatch for the thing tokens cannot say
 * is `css`, appended after the layout.
 *
 * Dark is a separate set of colours rather than an inversion of the light one: a measured
 * restatement, where each colour is chosen for its contrast on the dark surface it sits on.
 */

/** Colours that change between light and dark. Every one is required; `defineTheme` fills gaps from the theme it extends. */
export interface ThemeColors {
  /** The page behind everything. */
  background: string;
  /** Cards and panels. */
  surface: string;
  /** Inputs, table headers, anything raised off a surface. */
  surfaceRaised: string;
  border: string;
  /** Body text. At least 4.5:1 on `surface`. */
  ink: string;
  /** Labels and secondary text. At least 4.5:1 on `surface`. */
  inkSecondary: string;
  /** Hints and axis labels. At least 4.5:1 on `surface`, so it is still text. */
  muted: string;
  /** Focus rings, sliders, chart emphasis: accent as a shape, measured at 3:1. */
  accent: string;
  /** Accent as text — the selected tab, "Show as a table" — at least 4.5:1 on `surface` and `background`. */
  link: string;
  /** Filled buttons. A colour of its own because white on some accents measures under 4.5:1. */
  accentStrong: string;
  /** Text on `accentStrong`. */
  onAccent: string;
  /** The keyboard focus ring. */
  focus: string;
  /** A switch in its on position. */
  switchOn: string;
  ok: string;
  warn: string;
  bad: string;
  /** The bar across the top. */
  headerBackground: string;
  headerInk: string;
  /** Chart gridlines. */
  grid: string;
  /** Card elevation, as a `box-shadow` value, or `none`. */
  shadow: string;
  /** Eight chart colours. Adjacent slots stay apart under the common colour vision deficiencies. */
  chart: readonly [string, string, string, string, string, string, string, string];
}

/** What stays the same in light and dark. */
export interface ThemeShape {
  font: string;
  monoFont: string;
  /** Base font size, as a CSS length. */
  fontSize: string;
  /** Corner radius of cards. */
  radius: string;
  /** Corner radius of buttons and inputs. */
  radiusSmall: string;
  /** The spacing unit every gap is a multiple of, as a CSS length. */
  spacing: string;
  /** Button label case: Material writes them in capitals, Apple does not. */
  buttonCase: "none" | "uppercase";
  /** Font weight of headings and button labels. */
  strongWeight: string;
}

export interface Theme {
  /** A slug: what `configure({ theme: "…" })` and the page's `data-theme-name` say. */
  readonly name: string;
  /** What a person reads. */
  readonly label: string;
  readonly light: ThemeColors;
  readonly dark: ThemeColors;
  readonly shape: ThemeShape;
  /** Appended after the layout stylesheet. Validated so it cannot end the element it is served in. */
  readonly css: string;
}

/** What `defineTheme` takes: a name, and whatever differs from the theme it extends. */
export interface ThemeDefinition {
  name: string;
  label?: string | undefined;
  /** The starting point. Default: the Material theme. */
  extends?: Theme | undefined;
  light?: Partial<ThemeColors> | undefined;
  dark?: Partial<ThemeColors> | undefined;
  shape?: Partial<ThemeShape> | undefined;
  css?: string | undefined;
}
