# admin-panel-builder

A TypeScript library that turns values declared in an application (`viewable`, `modifiable`, `bind`,
`action`) into an admin panel, served on a path, on its own port, on an edge runtime, or embedded as HTML.

## Stack

- TypeScript (strict, `exactOptionalPropertyTypes`), ESM + CJS via tsup, Node >= 20. Biome for lint,
  Vitest for tests, Playwright + axe for the browser suite. No runtime dependencies.
- Conventions: `../CONVENTIONS.md`, drawn from hackerpot and bothandlerjs. Read it before changing
  structure.

## Commands

```
npm run check            # typecheck + lint + tests + docs:check, in that order
npm run typecheck        # tsc over src, tests, examples, scripts, demo; and the browser project
npm test                 # vitest run (the browser suite is excluded)
npm run test:browser     # the page in a real browser; BROWSER_ENGINE picks chromium/firefox/webkit
npm run lint             # biome check .   (npm run format applies fixes)
npm run docs:check       # every local markdown link and anchor resolves
npm run build            # tsup + declarations
npm run check:package    # pack, install into an empty project, load every entry as ESM and CJS
npm run demo             # :9780 and :9781, see demo/server.ts
npm run simulate         # pokes the running demo through its API
npm run playground       # every theme, light and dark, on :9786
npm run bench:guard      # write-path budgets, ratios against a reference loop
npm run shared:check     # the helpers shared with hackerpot/bothandlerjs still match
npm run apb -- <command> # the CLI from source
```

`npm install` needs `legacy-peer-deps` on npm 9 (set in `.npmrc`). `client:build` runs before build,
test and typecheck: `src/client.generated.ts` is generated from `src/client/` and never hand-edited.

## Layout

- `src/core.ts` — the panel: registry, schema, state, edits, imports; it coordinates `src/panel/`
  (charts, approvals, the schedule of timed and scheduled changes, profiles, alerts, scopes and grants,
  sync between replicas).
- `src/blocks/` — tables, feeds, counters. `src/presets/` — bothandlerjs and hackerpot sections.
- `src/change-log.ts` (hash-chained), `src/audit.ts`, `src/metrics.ts`, `src/cli.ts` (written on
  `src/sdk.ts`, the typed client), `src/testing.ts`, `src/config/` (TOML layer; `admin-panel.toml` is
  every default and a test holds it there).
- `src/values/` — the handle, kinds and constraints, the history ring.
- `src/server/` — the framework-neutral router, authentication (tokens, basic, check, session, OIDC),
  streams. `src/adapters/` — Node, listen, Fetch, Koa, Fastify, remote.
- `src/render/` — the page, the fragment, the layout stylesheet. `src/themes/` — themes as tokens.
- `src/client/` — the browser client (DOM; checked by `tsconfig.browser.json`), built as two bundles:
  the client, and `extras.ts` (charts and tables) which only panels that draw them load. The build fails
  if chart or table code leaks into the main bundle. `src/element/` — `<admin-panel>`.
- `src/stores/` — persistence (file, memory, Redis). `src/internal/` — helpers; `clock.ts`, `emitter.ts` and `async.ts` are
  byte-identical copies from hackerpot and bothandlerjs and must stay so.
- `examples/` — one panel per consumer project, run as processes by `tests/examples.test.ts`.
- `docs/` — the documentation; README.md is the argument and the index.

## Commit and attribution rules

- Never mention Claude, Claude Code, Anthropic or any AI assistant in commits, PRs, changelogs or
  comments. No `Co-Authored-By` or other attribution trailers, no generated-with footers, no emoji markers.
- Commit messages describe the change in the repository's voice. The human author is the sole author.

## Working agreements

- Do not commit, push or tag unless explicitly asked.
- Match the surrounding code's style, naming and comment density rather than inventing conventions.
- Run `npm run check` before reporting work as done; run `npm run test:browser` when `src/client/`,
  `src/render/` or a theme changed.
- Every limit is exported and listed in `docs/reference/limits.md`; `tests/docs.test.ts` checks the page.
