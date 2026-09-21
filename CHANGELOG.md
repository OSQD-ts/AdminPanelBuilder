# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Values declared where they live.** `viewable()`, `modifiable()` and `bind()` return a handle the
  panel observes; a value can hold its own state, be read from a function on every look, or be a
  property of an object the application already keeps, so a panel can be added to a codebase without
  changing how it stores anything.
- **Groups at declaration and after the fact.** `{ group: "red" }`, `group("red").add(x)` or
  `x.moveTo("red")`; a move reaches every open page on its next poll.
- **Charts alone or shared, over time, over keys or against another value**, in six kinds, each with a
  legend, a table view and a sentence for screen readers. Histories are fixed typed-array rings with
  their memory budget written down, coalesced into one-second buckets so a hot counter costs one slot a
  second.
- **Actions**: buttons that run a function in the application, with a deadline, an abort signal, and a
  record of who ran them and what they answered.
- **Three ways to serve one panel.** `panel.handler()` on a path of your server, `panel.listen()` on a
  port of its own, `panel.fetchHandler()` on an edge runtime — one router behind all three — plus
  `panel.html()` for a live fragment or a snapshot, and `<admin-panel>` for any framework.
- **Themes as data**: Material (the default), Apple and OSQD, each with a measured dark palette, and
  `defineTheme()` for your own, which refuses a misspelt token rather than letting CSS drop it.
- **Security that refuses rather than warns.** Controls are off unless granted and need auth even on
  loopback; a non-loopback listener needs auth; writes must be same-origin JSON; the page runs under a
  nonce CSP from `default-src 'none'`; a withheld group never leaves the process.
- **Persistence of an operator's choices** with `persist: true`, a file store that writes atomically and
  asynchronously, and restored values checked against the declaration that restores them.
- **Examples for ch3ss, anymail, bothandlerjs, hackerpot and BIS**, each run as a process by the test
  suite, and a demo that serves two of them four ways.
- **Tables, feeds and profiles.** `table()` pages, sorts and searches rows the panel holds, or hands a
  query to your own `fetch` so a database table never crosses into the panel, with row actions and
  thresholded cells. `feed()` keeps a bounded list of events and drops and counts past its rate rather
  than queueing. `profile()` sets several values in one step, whole or not at all.
- **Counters, rates and percentiles.** `counter()` and `rate()` read a reset as a reset rather than a
  negative spike; `percentiles()` charts p50, p95 and p99 of the recent observations.
- **Actions that ask for input**, checked field by field the way modifiable values are.
- **Statuses**: `status: { warn, bad }` flags a value, or a table cell, with a word and a colour.
- **Changes you can answer for.** Per-group controls, timed changes that revert themselves (and survive
  a restart when persisted), two-person approval, undo from the change history, a change log that keeps
  every record across restarts, and audit sinks for JSON lines, webhooks and notifiers.
- **Sign-in**: signed session cookies for applications that already sign people in, OpenID Connect with
  PKCE and a verified ID token, and delegated tokens for a panel in front of another process's panel.
- **Charts, round two**: histograms, heatmaps, stacked areas and bars, threshold lines, marks for every
  operator change, pause, zoom, CSV export, and downsampling of long histories for drawing.
- **Delivery**: a live stream of server-sent events with polling underneath, Koa and Fastify adapters,
  a remote panel for another process, recipes for Hono, Next.js and NestJS, React and Vue wrappers,
  Prometheus exposition, and `apb`, a command line for scripts.
- **Themes and the page**: Fluent, Carbon and a high-contrast theme held to 7:1, a theme playground,
  search across the panel, pinned cards, collapsible cards, spans and list layouts, and the page's own
  words in Polish as well as English, replaceable by key.
- **Presets for bothandlerjs and hackerpot** under `/presets`, typed structurally.
- **Quality gates**: a performance ratchet for the write path, the browser suite across Chromium, Firefox
  and WebKit, release automation, and a numbered course in `docs/course/`.
- **Several processes, one truth.** `redisSync()` carries an operator's change to every replica, which
  applies it through its own checks and says where it came from; `redisStore()` and `redisChangeLog()`
  keep settings and the change log in Redis; `keepHistory` keeps chart histories across restarts;
  `fleetHandler()` lists every replica's panel with whether it answers; `redisThrottleStore()` shares the
  sign-in throttle.
- **Operator workflows.** Changes scheduled for a time, cancellable and surviving a restart; alerts when
  a status reaches its level and holds, sent once per cooldown to the audit sinks; settings exported,
  diffed and imported whole or not at all, on the page and with `apb export` / `apb import`;
  `visibleWhen` and `disabledWhen` on values and actions; `validateAsync` for checks that need I/O; a
  timeline of recent changes for values that cannot be charted; feed filters and pause.
- **Access control, deeper.** Grants per operator from tokens, `auth.check`, signed sessions and OIDC
  provider groups, narrowing the listener's scope and never widening it; sessions revoked by id or by
  rotating the secret; OIDC logout at the provider; a per-operator write limit; a notice for a value that
  looks like a secret but is not declared sensitive; a hash-chained change log with `apb verify-log`;
  bounded webhook retries.
- **The page.** Tables that turn into stacked cards on a phone and grow with the page on a wide one; a
  per-viewer light/dark choice; `/`, `Ctrl K` and `g 1–9` shortcuts with a go-to list; arrow-key
  exploration of charts; an announcement when a visible value turns bad; German; refusals said in the
  page's language; one client script for several fragments; the chart and table code loaded only by
  panels that draw them; `group` and `compact` for fragments and `<admin-panel>`.
- **API and tooling.** `/api/openapi.json`, checked against the router; a typed client at `/client`,
  which the CLI and the fleet page use; streams that resume from `Last-Event-ID`; a remote panel that
  streams and can be narrowed to some groups; `apb watch`, `apb cancel`, `apb config` and shell
  completion; every error body carries a `code`.
- **Maintainability.** The panel split into modules under `src/panel/`, the page's view into cards,
  activity, palette and announcer; a TOML configuration layer at `/config` with a strict reader, a
  shipped file of every default, and reloads planned as data; `testPanel()` at `/testing`; live values
  read once per quarter second however many viewers ask.
