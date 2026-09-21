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

## Tokens

Colours, set for `light` and for `dark`: `background`, `surface`, `surfaceRaised`, `border`, `ink`,
`inkSecondary`, `muted`, `accent`, `link`, `accentStrong`, `onAccent`, `focus`, `switchOn`, `ok`, `warn`,
`bad`, `headerBackground`, `headerInk`, `grid`, `shadow`, and `chart`, eight colours.

Shape, shared by both: `font`, `monoFont`, `fontSize`, `radius`, `radiusSmall`, `spacing`, `buttonCase`
(`"none"` or `"uppercase"`), `strongWeight`.

Each becomes a custom property, `--apb-<name>` in kebab case, on `.apb-root` and `:host` — never on the
host page's `:root`, so an embedded panel styles itself and nothing around it.

**Contrast is measured.** `tests/themes.test.ts` checks every built-in theme: `ink`, `inkSecondary`,
`muted`, `link` and `bad` at 4.5:1 on their surfaces, `onAccent` at 4.5:1 on `accentStrong`, `accent`
and `warn` at 3:1, and the high-contrast theme at 7:1 throughout. `contrastRatio(a, b)` is the function
it uses; hold a theme of your own to the same numbers.

## Words

`createAdminPanel({ locale: "pl" })` writes the page's own words — buttons, empty states, the connection
status — in Polish; English is the default. `messages: { apply: "Save" }` replaces any of them, and a key
the page never shows is refused. Values, labels and descriptions are yours and are never translated;
the server's refusal sentences stay English.

## Related

- [Charts](../concepts/charts.md) — the chart slots.
