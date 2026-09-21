# Contributing

## Scripts

| Script | What it answers |
| --- | --- |
| `npm run check` | Does it type-check, lint, pass its tests and keep every doc link? Run before a pull request. |
| `npm run test:browser` | Does the page work under a keyboard, a narrow screen and axe? Run when the client, the layout or a theme changed. |
| `npm run check:package` | Does the packed tarball install and load? Run when `package.json`, `tsup.config.ts` or an entry changed. |
| `npm run bench:guard` | Is the write path still within budget? Run when `core.ts`, `values/` or `blocks/` changed. |
| `npm run shared:check` | Do the helpers copied from the sibling repositories still match? |
| `npm run demo` / `npm run simulate` / `npm run playground` | Does it look and behave right? |

## The layer map

```
src/
  index.ts                the root entry's barrel; every export is pinned in tests/entry-points.test.ts
  core.ts                 the panel: declarations, schema, state, edits, approvals, reverts, undo, sampling
  change-log.ts           change records, their ids, and the stores that keep them
  audit.ts                sinks for change records: JSON lines, webhooks, notifiers
  metrics.ts              Prometheus exposition
  cli.ts, apb.ts          the `apb` command line
  react.ts, vue.ts        wrappers around the element (browser code)
  blocks/
    table.ts              tables: rows or fetch, sort, search, pages, row actions
    feed.ts               bounded event lists
    counter.ts            counters, rates, percentiles
  presets/                bothandlerjs and hackerpot sections
  i18n/messages.ts        the page's own words, by language
  default-panel.ts        the bare viewable()/modifiable()/… on a lazily created panel
  actions.ts              PanelAction and its deadline
  errors.ts               AdminPanelConfigError (structural) and ValueError (a refused value)
  types.ts                the declaration options and every wire shape
  version.ts              VERSION, kept equal to package.json by a test
  values/
    handle.ts             PanelValue: the handle, its three sources, the single write path
    kinds.ts              kind inference, constraints, checkValue, the JSON encoding
    status.ts             thresholds
    input.ts              action input fields
    history.ts            the sample ring and its memory budget
  server/
    router.ts             every route and every pre-routing check; framework-neutral
    auth.ts               tokens, basic, custom checks, sessions, OIDC, delegates, the throttle
    session.ts, oidc.ts   signed cookies and OpenID Connect sign-in
    stream.ts             server-sent events
    types.ts              serve options, PanelRequest, PanelResponse
  adapters/
    node.ts               Node middleware over the router
    listen.ts             a listener of its own; the only import of node:http
    fetch.ts              (Request) => Response over the router
    koa.ts, fastify.ts    wrappers over the Node handler
    remote.ts             another process's panel, proxied
  render/
    html.ts               the page, the fragment, escaping
    layout.ts             the one stylesheet, written against tokens only
    playground.ts         every theme on one page
  themes/                 token types, the three themes, defineTheme and the preamble
  stores/                 memory and file stores
  client/                 the browser client, bundled into client.generated.ts
  element/                <admin-panel>
  internal/               ids, strict options, and the shared clock/emitter/async
```

## Recipes

**Adding a value option**

1. Add it to the options interface in `src/types.ts` with a doc comment stating the invariant.
2. Add its key to the right list in `src/core.ts` (`VIEWABLE_KEYS`, `MODIFIABLE_KEYS`), or it is refused as unknown.
3. Resolve and validate it in `declare()`; refuse what could never work with an `AdminPanelConfigError`.
4. If the page needs it, add it to `ValueSchema` and `docs/reference/data-shapes.md` in the same change.
5. Document it in `docs/concepts/values.md` and test it in `tests/values.test.ts`.

**Adding a chart kind**

1. Add it to `ChartKind` and `CHART_KINDS`.
2. Draw it in `src/client/charts.ts`, with its legend, table and screen-reader sentence.
3. Run `npm run test:browser`, and add it to `docs/concepts/charts.md`.

**Adding a theme**

1. A file in `src/themes/` with both schemes filled in; add it to `BUILT_IN_THEMES`.
2. `tests/themes.test.ts` measures it; fix colours until it passes rather than lowering a threshold.
3. List it in `docs/operations/themes.md`.

## Hard rules

- **The client never assembles markup.** `textContent` only; the build refuses the sinks.
- **No inline `style` attributes.** Geometry goes through the CSSOM; the CSP refuses the rest.
- **Anything keyed by input needs a bound**, and the bound is exported and listed in
  `docs/reference/limits.md`.
- **Unknown options are errors.** A new options object gets `rejectUnknown`.
- **Nothing rejects into the host application.** A handler answers; a listener's failure is reported.
- **No timer keeps a process alive.** `unref` every one.

## Before a pull request

- `npm run check`, always.
- `npm run test:browser` when `src/client/`, `src/render/` or `src/themes/` changed.
- `npm run check:package` when an entry or the build changed.
- The CHANGELOG's `[Unreleased]` section, as a bolded claim and the story behind it.

## Commits

Conventional prefixes with a scope (`feat(charts):`, `fix(router):`, `docs(themes):`), a lowercase subject
in the repository's voice, and a body explaining what was wrong and what happens now.

## Licensing of contributions

admin-panel-builder is under the [OSQD Non-Resale License](LICENSE) — free to use and modify, but not to
sell — and the copyright is held by Michał Płatosz rather than by "the contributors" collectively. A single
holder is what makes it possible to grant separate commercial terms to someone who asks, and to change the
license later without tracking down every past contributor.

By opening a pull request you agree that your contribution is licensed under the same terms as the
project, and that the copyright holder may also license it under different terms (including commercial
ones). If you are not comfortable with that, say so in the PR before it is merged rather than after.
