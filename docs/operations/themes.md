# Themes

Material, Apple, OSQD, and your own.

← [Operations](index.md)

---

```ts
createAdminPanel({ theme: "apple", colorScheme: "auto" });
panel.configure({ theme: "osqd", colorScheme: "dark" });     // applies on every page's next poll
```

| Theme | After | Look |
| --- | --- | --- |
| `material` (default) | Material Design as MUI ships it | Roboto where installed, MUI's palette, 4px corners, elevation 1, capitalised buttons, a primary-coloured app bar |
| `apple` | Apple's Human Interface Guidelines | the system font, system colours, grouped inset cards on a grey background, 10px corners, green switches |
| `osqd` | the hackerpot and bothandlerjs dashboards | their exact tokens and chart slots, dense, system font |
| `fluent` | Microsoft Fluent 2 | Segoe UI, communication blue, 4px controls on 8px cards, soft two-layer shadow |
| `carbon` | IBM Carbon (g10 and g100) | IBM Plex Sans where installed, square corners, no shadows, the dark shell header |
| `high-contrast` | WCAG AAA | every text colour at 7:1 or more, solid borders, thick focus rings; dark is yellow on black |

`npm run playground` serves every theme in both schemes on one page, drawing the same sample panel, with
each theme's contrast measured underneath and a `defineTheme()` snippet to start from.
`themePlaygroundHtml()` returns the same page for your own themes.

`colorScheme` is `"auto"` (the viewer's system), `"light"` or `"dark"`, and an explicit one wins over the
system in both directions. Dark is a separate palette in every theme, chosen for contrast on its own
surfaces, not an inversion. No font is fetched from anywhere: the CSP allows nothing external.

## Your own

```ts
import { appleTheme, defineTheme } from "@osqd/admin-panel-builder";

const brand = defineTheme({
  name: "brand",
  extends: appleTheme,                          // default: material
  light: { accent: "#6a1b9a", link: "#6a1b9a", accentStrong: "#6a1b9a", headerBackground: "#6a1b9a", headerInk: "#ffffff" },
  dark: { accent: "#ce93d8", link: "#ce93d8" },
  shape: { radius: "2px", font: "Inter, system-ui, sans-serif" },
  css: ".apb-title { letter-spacing: .04em; }",
});
createAdminPanel({ theme: brand });
```

Everything left out comes from the theme it extends. `defineTheme` refuses a token it does not know
(`bakground`) by name — CSS would drop it silently — and a value that could end its declaration or its
element (`;`, `{`, `}`, `<`, `>`, a comment). Extra `css` may not contain `</` or `<!--`.

## Chosen by each viewer

The page's Settings (the button in the header) lets each viewer pick a theme for themselves, kept in
their browser. Every built-in theme is offered beside the panel's own; themes of your own join the list
with `themes`, and `themes: false` keeps everybody on the panel's:

```ts
createAdminPanel({ theme: "material", themes: [brand] });   // material first, then brand and the built-ins
createAdminPanel({ theme: brand, themes: false });           // brand for everybody, no choice
```

The page carries every offered theme's tokens in its one stylesheet, scoped to `data-theme`, so a choice
applies at once and nothing is fetched — the CSP would refuse a second stylesheet. A theme's extra `css`
applies only where it is the panel's own theme. The same dialog holds the viewer's colours, language,
compact cards, whether values flash when they change, animations and trend chips.

## The @osqd/ui themes

Five more themes match pages built with the @osqd/ui kit, so a panel served beside them reads as the same
product. They are opt-in: pass them in `themes` to offer them, or one as `theme`.

```ts
import { OSQD_UI_THEMES, osqdUiTheme } from "@osqd/admin-panel-builder";

createAdminPanel({ theme: osqdUiTheme, themes: OSQD_UI_THEMES });   // all five in Settings, osqd-ui first
```

| Theme | Light | Dark |
| --- | --- | --- |
| `osqd-ui` | warm white on soft grey | warm greys |
| `osqd-ui-graphite` | cool light greys, blue lead | cool neutral greys, blue lead |
| `osqd-ui-midnight` | cool light greys, blue lead | deep navy |
| `osqd-ui-paper` | warm off-white | warm greys |
| `osqd-ui-contrast` | warm white on soft grey | black and white, yellow focus ring |

Each kit palette is one scheme, so the five pair them by temperature. The chart slots are the kit's series
palette, and the panel's spacing unit stays 6px, the density of `osqd`. The palettes are copies (the
panel has no runtime dependencies); `OSQD_UI_PALETTES` exports them as the kit names them, and
`tests/osqd-ui-themes.test.ts` compares them with the kit whenever its folder sits beside this one.
Because they are not built in, a theme name in a configuration file cannot reach them: pass the objects.

## Tokens

Colours, set for `light` and for `dark`: `background`, `surface`, `surfaceRaised`, `border`, `ink`,
`inkSecondary`, `muted`, `accent`, `link`, `accentStrong`, `onAccent`, `focus`, `switchOn`, `ok`, `warn`,
`bad`, `headerBackground`, `headerInk`, `grid`, `shadow`, `shadowRaised`, and `chart`, eight colours.

Shape, shared by both: `font`, `monoFont`, `fontSize`, `radius`, `radiusSmall`, `spacing`, `buttonCase`
(`"none"` or `"uppercase"`), `strongWeight`.

Each becomes a custom property, `--apb-<name>` in kebab case, on `.apb-root` and `:host` — never on the
host page's `:root`, so an embedded panel styles itself and nothing around it.

**Contrast is measured.** `tests/themes.test.ts` checks every built-in theme: `ink`, `inkSecondary`,
`muted`, `link` and `bad` at 4.5:1 on their surfaces, `onAccent` at 4.5:1 on `accentStrong`, `accent`
and `warn` at 3:1, and the high-contrast theme at 7:1 throughout. `contrastRatio(a, b)` is the function
it uses; hold a theme of your own to the same numbers.

## Drawn with the @osqd/ui components

The page's controls are the @osqd/ui kit's components: a button is an `oq-btn`, a field an `oq-input`,
the tabs an `oq-tabs`, a dialog an `oq-dialog`. Every theme above draws them, because each scheme's
tokens also carry the kit's names, derived from the theme's own:

| Kit property | From |
| --- | --- |
| `--oq-bg`, `--oq-surface`, `--oq-raised`, `--oq-border` | `background`, `surface`, `surfaceRaised`, `border` |
| `--oq-text`, `--oq-text-muted`, `--oq-text-faint` | `ink`, `inkSecondary`, `muted` |
| `--oq-primary` / `--oq-on-primary` | `accentStrong` / `onAccent` |
| `--oq-secondary`, `--oq-info` | `link` |
| `--oq-success`, `--oq-warning`, `--oq-danger`, `--oq-neutral` | `ok`, `warn`, `bad`, `muted` |
| `--oq-on-<intent>` | black or white, whichever reads better on that fill (4.5:1 at least, tested) |
| `--oq-hover`, `--oq-border-strong`, `--oq-selection`, `--oq-overlay` | mixed from the colours above |
| `--oq-focus`, `--oq-shadow-sm` / `-md` / `-lg` | `focus`, `shadow`, `shadowRaised` |
| `--oq-series-1` … `-8`, `--oq-seq-0` … `-12`, `--oq-ord-1` … `-5` | `chart`, and ramps from `surface` to `accentStrong` |
| `--oq-font-sans`, `--oq-font-mono`, `--oq-text-xs` … `-3xl` | `font`, `monoFont`, steps from `fontSize` |
| `--oq-radius-sm` / `-md` / `-lg`, `--oq-space`, `--oq-control-*` | `radiusSmall`, `radius`, half of `spacing`, multiples of `spacing` |

A theme therefore stays a theme of this panel — `defineTheme`, its keys and the `--apb-*` names are
unchanged — and reaches the components without knowing they exist. `buttonCase` and `strongWeight`
still letter the buttons and tabs.

A theme's `css` can target either name: the panel's classes (`.apb-button`) stay on every element beside
the kit's (`.oq-btn`), and the kit's rules come before the layout's and the theme's, so both win ties
against the kit. Only the kit rules the page uses are served (`src/render/kit-css.generated.ts`, built
from the installed kit by `npm run kit:build`, checked by `npm run check`).

## Words

`createAdminPanel({ locale: "pl" })` writes the page's own words — buttons, empty states, the connection
status — in Polish; English is the default. `messages: { apply: "Save" }` replaces any of them, and a key
the page never shows is refused. Values, labels and descriptions are yours and are never translated;
the server's refusal sentences stay English.

## Related

- [Charts](../concepts/charts.md) — the chart slots.
