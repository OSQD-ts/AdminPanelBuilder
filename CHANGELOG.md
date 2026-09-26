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
- **A release is a merge.** CI runs the committed client bundle check, lint, types, tests, the build
  and a command-line smoke test on Node 20, 22 and 24, then the package as a consumer sees it (no
  runtime dependencies, no advisory at any level, nothing but `node:` and relative paths imported, a
  tarball under its size budget, every entry loading from the packed tarball), the documentation's
  links, the page in Chromium, Firefox and WebKit, the write-path budgets and the coverage ratchet.
  Publishing runs the same verification from scratch on the commit being released, derives the
  version from the commits since the last tag, and publishes to npm with provenance; a pushed `v*`
  tag publishes exactly that version, and a prerelease goes to the `next` dist-tag.
- **The panel says its own words in the viewer's language.** A notice about the panel's own machinery
  and the frame around a reading that failed travel as a message key and what fills it, beside the
  English sentence they have always carried, so a German or Polish page says them in German or
  Polish and the application's own message inside them is left as it is. Words the panel did not
  write itself — an alert's sentence — stay one language, the same here, in the change log and in a
  webhook.
- **What a listener does not allow is said in the page's language**: each restriction travels as the
  English sentence and the key that says it, and so does the note on a value too large to send.
- **What an import would refuse is said in the page's language too**: each line of a settings diff
  carries the key and parameters beside the English sentence, including a value's own constraint
  refusal.
- **A refusal is said in the page's language again.** The translator handed to the view forwarded the
  call and the locale but not `has`, so every keyed refusal fell back to "Refused: <English>" however
  well the page was translated.
- **`[health]` in the listener's configuration.** `enabled = true` offers `GET /healthz` from a file
  or an image, where the health check was reachable only from code before; it reloads without a
  restart, like the metrics settings.
- **The two-person rule counts the operator, not the route.** A change proposed as "ada" cannot be
  approved by "ada via gateway": a delegate token records the way in, and it is still the same person.
- **The file store flushes before it renames**, so its promise that a crash leaves the previous file
  holds for a power cut and not only for a process that dies, and a write that fails takes its
  temporary file with it.
- **`/healthz` and `/metrics` are in the OpenAPI document** on a listener that switched them on, so a
  generated client and a monitoring setup see every route the listener answers, not only the API.
- **Cookies marked `Secure` where the browser is on TLS.** The token cookie `?token=` is exchanged
  for, and the OIDC session and flow cookies, are `Secure` when the panel is reached over TLS — from
  the socket, or from `x-forwarded-proto` where a proxy terminates it — and plain where it is not, so
  a credential is never sent back over plain HTTP and a panel on loopback still signs people in.
- **An audit webhook's deadline cancels the request**, rather than only stopping the wait: an endpoint
  that takes a connection and says nothing no longer holds one open per record while the retries open
  more.
- **The stream's "no room for another viewer" is a refusal like every other**: the key, the parameters
  and the sentence, in every language the page speaks, where it was hard-coded English before.
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
- **Replicas, the rest of the way.** Proposals and scheduled changes travel between replicas: a
  proposal made on one is decided on any, and a schedule fires once even after the replica that made it
  is gone, through `claim` (`redisClaim`). `redisRevocations` makes a sign-out count on every replica.
  The fleet page lists settings that differ between panels, says since when each answers, and can
  refresh itself; a narrowed remote panel caches what each operator may see.
- **Changes with reasons.** Every change can carry a reason, required where declared and always for
  approval. Actions and profiles take `approval: true`; an approved action runs with the input it was
  proposed with. Profiles and imports can be undone as one change. Changes and profiles repeat daily or
  weekly on a wall clock in a named time zone, correct across daylight-saving changes; profiles can be
  scheduled and applied for a while. `confirm: "type"` asks for an action's name before it runs.
- **Every word in the page's language.** German joins English and Polish; the page's remaining English
  words, times, durations and numbers follow the locale; every server refusal carries a key and its
  parameters, and the page says it in its own language. `locale: "auto"` and a **Language** choice in the
  header let each viewer read the page in theirs, and the client carries only English itself.
- **Scale and cost.** Stream viewers of one view share one frame; `bench:guard` budgets the read path
  too. The file change log rotates by size or day, keeps what it is told, and chains across files.
  `server.reload()` and `reloadListener` apply configuration without a restart where they can. The
  package is 1.3 MB instead of 2.5 (ESM code split, CJS without maps), and core.ts is split further.
- **Proving it keeps working.** Screenshots per theme, light and dark, wide and phone, compared in the
  browser suite; API answers checked against the OpenAPI document; course chapters 9 and 10; the
  examples use the newer features; the React and Vue wrappers take `group` and `compact`.
- **The page, redrawn.** Elevation in layers: cards on the page, a band of tabs and search that stays
  in reach while the cards scroll under it, the bar across the top, and dialogs, with a second
  elevation token, `shadowRaised`, in every theme. The content widens with the screen up to a page
  width and then centres; charts take two columns and grow to fill the rows beside them; the grid
  follows the width it has, not the window's, so a panel in a sidebar lays out as a narrow one. The
  connection state is a shape as well as a word, a value past a threshold carries a bar on its card,
  controls grow to thumb size on touch screens, and the page prints without its controls.
- **The page tells you what is happening.** A value flashes when it changes and a charted one shows
  its trend; while the connection is down a banner says so and the values grey out; buttons turn busy
  while their request runs, and results say ✓ or ✕. Charts answer the pointer with a cursor and a tip,
  wherever it is over the plot — a value carried to now moves with every drawing, and the tip follows
  it rather than disappearing — their legends hide and show series, lines end in a dot and areas fade. An edit not applied yet is
  marked and Escape puts the value back; sliders show their range. The tab strip keeps the selected tab
  in view and fades where it continues, the floating band casts a shadow, a card reached from Go to is
  outlined, each tab remembers its scroll, and the search box shows its `/` key. Viewers can choose
  compact cards; Windows contrast themes and `prefers-contrast: more` are supported. Tables right-align
  numbers, and the change log shows before and after, with who made each change at a glance.
- **Settings for each viewer.** One Settings button in the header opens a dialog with everything that
  belongs to the person looking: theme (every built-in one, plus themes registered with `themes`;
  `themes: false` keeps the panel's), colours, language, compact cards, whether values flash when they
  change, animations and trend chips, with a reset. Kept in their browser; nothing reaches the server.
- **A dashboard laid out in cells.** Each group is a grid of 12 columns and 72-pixel rows (`grid` on the
  panel or a group changes both); every card takes `size: { w, h }` cells, set in code or chosen from
  what it shows, and `span` still works. The grid follows its own width — a third of its columns on a
  tablet, one on a phone — and each card adapts to the cells it is given. Cards can be arranged on the
  page, dragged and resized or moved with buttons from the keyboard, then saved for one viewer or, with
  edit rights, for everybody: `POST /api/layout` and `client.saveLayout()`, kept in the store, recorded
  as a `layout` change and carried to replicas.
- **Layouts that fill themselves.** The panel packs each group's grid itself, from its lowest open
  stretch, so no cell is left empty under a card; related cards are gathered (numbers, settings,
  charts, actions, lists, and names that start alike), every kind has a preferred, smallest and largest
  size, cards widen and lengthen to fill the space and line up with their neighbours, and the bottom
  ends square where the cards can grow. A card shows as much as its room allows — brief, normal or full,
  with the low, average and high of a charted value when it is large. While arranging, a card is picked
  up anywhere and dropped where it belongs, with a placeholder and the grid repacking around it.
- **Every declaration on the group handle.** `group("Games")` now also has `bind`, `counter`, `rate`,
  `percentiles`, `profile` and `chart`, so a group's declarations never repeat its name; the examples
  declare through handles.
- **Cards that suit the room they are given.** What a card shows is chosen by measuring what it holds
  against the room it has, not by its size in pixels alone: too small, it shows one level less and then
  scrolls inside itself, so a row is exactly its height and no card stretches its neighbours; with room
  to spare, it hands that room to what can use it — a chart's line or bars grow, a table or a feed
  shows more — and a card holding a reading alone centres it and lets the number grow. Nothing is
  pushed apart to fill a card any more, and what cannot grow, an editor or a button, is left where it
  is. A gauge, a sparkline and a button are sized to what they hold rather than to the chart beside
  them, and a card is never stretched past its largest size unless what it holds grows into the room. Brief now
  drops only what is read, never a control, and padding and spacing follow the level. A card is
  draggable while it is being arranged and at no other time.
- **Opening a detail does not rearrange the page.** Once the cards have settled, content that grows —
  the numbers behind a chart, a longer reading — moves the cards under it down and leaves every card
  in the column and at the width it had. A card that cannot grow, because its size was set in code or
  chosen on the page, scrolls what it holds instead of hiding what was just opened, and a chart's
  table of numbers is a box of its own rather than a second page of card. A heatmap, already a table
  of numbers, no longer offers to show one.
- **One card to a row on a phone.** Below the width where the grid gives in to a single column, a
  card is as tall as what it holds: nothing is cut off mid-row, since there is nothing beside it to
  stretch. A heatmap that narrow labels every sixth hour rather than clipping every other one, a
  number in a stacked table row keeps its label beside it, and the buttons on such a row sit side by
  side.
- **Anything opened on a card is held by the card.** The room comes, in this order, from what the card
  has spare, from the drawing the numbers can stand in for — *Show as a table* is a change of view, so
  the table takes the room the chart had and the chart comes back when it is closed — and from what the
  card need not show while you are reading it: its description, what it says about its reading. What is
  left over scrolls inside the card, where it was scrolled to stays there as the panel updates, and the
  card keeps the size it had throughout. Nothing on the page moves because somebody opened something.
- **A card with more room than it needs uses it.** A chart's line fills the card rather than stopping
  part-way down it; bars are drawn heavier and spread over the height; a table's or a feed's box grows,
  so what is left over reads as room for more rows rather than as a hole under the card. What cannot
  grow is read corner to corner rather than floated in the middle: what is read stays at the top of the
  card, with a number that grows into the space, and what is done with it — a field, a button, a
  schedule — sits at the foot. Past a few rows to spare, spreading a card's parts that far apart is a
  hole rather than a layout, so what the card holds stays together at the top instead.
- **Every kind of card, at every size.** A reading is drawn to the room it has, in steps, not only to
  the width of its card, and where the card holds nothing else what it says about the number sits at
  the foot. A table's or a feed's rows are what takes the room at any size: given more, the box grows;
  given less, the rows scroll and the pager and its count stay in view, and a card too small for both
  a search box and its rows keeps the rows. The labels beside bars keep to a column however wide the
  card is. A card that is scrolling says so with a shadow at the edge there is more past.
- **A table with nothing in it says so, rather than saying nothing matches.** A search that finds
  nothing and a table that holds nothing are not the same thing, and each says which it is.
- **A reading that is words is set as words.** A phrase steps down from the display size and a
  sentence is set as text, however much room the card has: a choice named in a sentence is readable
  rather than a wall. A value that is not set says so with a dash, rather than leaving a line of no
  height where the reading goes.
- **A reason that must be given comes before the button**, where it is part of the change rather than
  something to find under it, and what the panel answers — a refusal, or why the button cannot be
  pressed — reads directly under the button.
- **A card is narrow when it is narrow for its text.** The widths a card lays itself out by are read
  in em rather than pixels, so a page at twice the text size lays its cards out as narrow cards: the
  name keeps its line, the badges take their own, and nothing collides with the tools in the corner.
  A sparkline, which is a line without an axis, keeps the size that reads as one on a phone.
- **A chart too small to read is not drawn.** Where a card cannot hold a drawing even after it has
  dropped what it need not show, the drawing goes and the card says what it can in numbers and words,
  with the way to the numbers behind it still open. It is drawn again as soon as the card has the room
  it wanted, with enough slack that a card on the edge of it does not flicker. A sparkline, which is
  made for a small card, is left alone, and so is a drawing that is the whole card — a chart over keys
  has no numbers beside it to fall back on.
- **The fold says what pressing it does**: *Show as a table* becomes *Hide the table* while the numbers
  are shown, in every language the page speaks.
- **A card at its briefest still offers the numbers behind its chart** — on a card that small they are
  the readable half of it.
- **Content that arrives without a click** — a reason field after an edit, a longer reading — is
  noticed the same way, a card folded away is as tall as its heading rather than keeping the rows it
  had — whatever size it was given, with the page closing up around it and opening again when the card
  does — and a block with nothing in it yet takes no room and leaves no gap.
- **A card never paints outside itself.** What a card holds is laid out within it, and a card smaller
  than its content scrolls, with its body in the tab order so a keyboard can reach what is below the
  fold.
- **The Activity tab reads as a page.** Two columns of equal height rather than three ragged ones, a
  change waiting for approval across the top with its buttons at the end of the row, counts beside
  *Recent changes* and *Notices*, column widths that give the width to what happened, and room for a
  page of changes before the list scrolls.
- **No gap beside a card sized in code.** Where the next card needs more columns than are left beside
  one that cannot be widened, the packer brings forward the next card that fits, and closes what is
  left by growing the cards above or widening a neighbour, so a hole stays at the bottom of a page or
  nowhere.
- **Arranging from the header.** *Arrange*, beside Settings, arranges the tab that is open and is
  pressed while you do; it is offered only where there is a group to arrange. Settings keeps *Forget my
  layout*.
- **Arranging holds the page still.** Updates pause while cards are arranged and rows keep exactly their
  cell height; starting to arrange no longer scrolls back to the top. A heatmap no longer overflows its card.
- **Arranging ends where you leave it.** Escape puts back what was there, as Cancel does, and so does
  opening another tab: an arrangement of a tab nobody is looking at is not one anybody can finish.
  During a drag, Escape still puts that one card back and arranging goes on.
- **A chart on its own is named where every other card is named.** Its title and description are the
  card's heading and description rather than a caption under an empty heading line, so the name is
  there when the card is folded away, and the drawing has the whole card to grow into.
- **Examples of the whole engine.** The per-project examples (ch3ss, anymail, BIS, bothandlerjs,
  hackerpot, Hono, Next.js) are replaced by seven generic ones, each going deep into one area: a
  quickstart on the default panel; a service dashboard with every chart kind, tables, feeds, alerts,
  layout and a custom theme; change control with every guard (approval, reasons, validation, conditions,
  secrets, profiles, a verified change log); access with sessions, grants, two listeners, metrics and
  health; replicas with a fleet page and a remote panel; embedding as fragments, snapshots and Fetch
  routes; and a listener configured from a file. `docs/examples.md` describes them; the demo runs two.
- **Cards sized by what they show.** The grid measures each card's content on the page and never gives
  it fewer rows, so one tall card no longer stretches its neighbours into empty space; a stretch no card
  fits is taken by the card beside it, and a card may grow a row or two past its largest size rather
  than leave a hole between cards.
- **Observability.** `otelMetrics` for OpenTelemetry, `syslogSink` and `otelLogSink` for logs (with
  alerts), and an opt-in `/healthz` for load balancers.
