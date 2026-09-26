# API

Every exported function, class and constant.

← [Documentation](../index.md)

---

## `@osqd/admin-panel-builder`

### Declaring on the default panel

| Export | Does |
| --- | --- |
| `viewable(initial, options?)` | Shows a value, or a function read on every look. Returns a `PanelValue`. |
| `modifiable(initial, options?)` | Shows a value an operator may change within its constraints. |
| `bind(object, key, options?)` | Shows a property of an object you have; `editable: true` lets it be changed. |
| `action(label, run, options?)` | A button that runs `run({ by, signal, input })`. Returns a `PanelAction`. |
| `table(label, options)` | Rows, paged, sorted and searched, with row actions. Returns a `PanelTable`. |
| `feed(label, options?)` | A bounded list of events: `feed.push(text or fields, level)`. Returns a `PanelFeed`. |
| `profile(label, settings, options?)` | Several modifiable values set at once. Returns its id. |
| `counter(label, options?)` | A count with its rate: `.inc()`, `.reset()`, `.total`, `.rate`. |
| `rate(label, read, options?)` | The rate of a total the application keeps. |
| `percentiles(label, options?)` | `.record(observation)`; p50, p95, p99 charted together. |
| `group(name, options?)` | A group, created on first mention: `.add(...)`, `.configure()`, and every declaration above. |
| `chart({ title, series, … })` | A chart shared by a group. Returns its id. |
| `configure(options)` | Settings for the default panel; the store, clock, change log, locale and error channel only before the first declaration. |
| `defaultPanel()` | The default panel, created on first use. |

Options for each: [values](../concepts/values.md), [charts](../concepts/charts.md), [groups](../concepts/groups.md), [actions](../concepts/actions.md), [tables, feeds and profiles](../concepts/blocks.md), [counters](../concepts/counters.md).

### The panel

`createAdminPanel(options?)` or `new AdminPanel(options?)`. Options: `title`, `instance`, `theme`,
`colorScheme`, `pollIntervalMs`, `defaultGroup`, `store`, `changeLog`, `locale`, `messages`, `clock`,
`onError`, `sync` (changes carried between replicas), `keepHistory` (chart histories kept in the store).

| Member | Does |
| --- | --- |
| every declaration above | On this panel. |
| `move(item, group)` | Moves a value or an action. |
| `configure({ title, instance, theme, colorScheme, pollIntervalMs })` | Applies on the next update; refused whole if any part is invalid. |
| `handler(options?)`, `listen(options?)`, `fetchHandler(options?)` | Serving it. See [serving](../integration/index.md). |
| `html({ api } \| { snapshot, nonce?, groups?, document? }, and script?, group?, compact?)` | The panel as HTML. See [embedding](../integration/embedding.md). |
| `schema(scope?)`, `state(scope?, since?, after?, feed?)` | What a page is sent. |
| `edit(id, value, by, scope, { revertAfterMs?, at?, repeat?, reason? })` | An operator's change; a proposal for a value declared with `approval`; scheduled with `at`, repeating with `repeat`. |
| `checkAsync([[id, value], …])` | Runs the `validateAsync` checks of the values about to change; the first refusal, or nothing. Listeners run it before `edit`. |
| `cancelScheduled(id, by, scope)` | Cancels a scheduled or repeating change before its (next) time. |
| `exportSettings(scope)`, `diffSettings(settings, scope)`, `importSettings(settings, by, scope, { reason? })` | Settings as JSON: what they are, what importing would change, and importing whole or not at all. |
| `await approve(pendingId, by, scope)`, `await reject(pendingId, by, scope, { reason? })` | Deciding a proposal: a value's change is applied, a profile applied, an action run with its input. With replicas, exactly one decides. |
| `pendingKind(id)` | Whether a proposal is a value's, an action's or a profile's. |
| `undo(changeId, by, scope, { reason? })` | Writes back what an edit, a profile or an import replaced. |
| `applyProfile(id, by, scope, { revertAfterMs?, at?, repeat?, reason? })` | Applies a profile whole, or nothing of it: now, for a while, later, or by a rule. |
| `run(id, by, scope, input?, { reason? })`, `runRowAction(table, action, row, by, scope)` | Running actions; an action declared with `approval` answers `{ pending }`. |
| `tableRows(id, query, scope)` | A page of a table. |
| `get(id)`, `changes()`, `pending()`, `notices()`, `currentTheme()` | Reading back. |
| `on("change" \| "notice" \| "error" \| "alert", listener)` | Subscribing; returns the way to stop. |
| `tick()` | Runs due samples and periodic updates now. |
| `ready` | Settles once stored choices, the change log and saved chart histories are loaded. Never rejects. |
| `flushed()` | Settles once every change so far is in the change log store: await it before a planned exit. |
| `close()` | Stops the timers, saves kept chart histories and leaves the sync channel. |

`ChangeOptions` is the options object `edit` and `applyProfile` take; `RepeatRule` is `{ every: "day" |
"week", at: "HH:MM", weekday?, timeZone }`. `canEdit(scope, group)` and `canRun(scope, group)` answer what a scope allows; `narrowScope(scope,
grants)` is a scope narrowed to one operator's grants, never widened.

### `PanelValue`

`value` (get and set), `get()`, `set(next)`, `update(fn)`, `on(listener)`, `moveTo(group)`, and `id`,
`label`, `kind`, `editable`, `live`. Converts to its value in template strings and `JSON.stringify`.

### Themes, stores, audit, sign-in, time, errors

| Export | |
| --- | --- |
| `materialTheme`, `appleTheme`, `osqdTheme`, `fluentTheme`, `carbonTheme`, `highContrastTheme`, `BUILT_IN_THEMES` | The themes that ship. |
| `defineTheme(definition)`, `contrastRatio(a, b)`, `themePlaygroundHtml(themes?, nonce?)` | A theme of your own, measured. See [themes](../operations/themes.md). |
| `memoryStore(initial?)`, `fileStore(path)`, `redisStore(redis, options?)` | Stores for `persist`. See [persistence](../operations/persistence.md). |
| `memoryChangeLog()`, `fileChangeLog(path, { rotate?, keep? })`, `redisChangeLog(redis, options?)` | Where every change is kept; the file log rotates by size or day. See [audit](../operations/audit.md). |
| `verifyChain(records)` | Checks a stored log's hash chain; the first record that breaks it. See [audit](../operations/audit.md). |
| `memorySync()`, `redisSync({ publisher, subscriber, channel?, claim? })`, `redisClaim(client, options?)` | Carry changes, proposals and schedules between replicas, and decide once. See [several processes](../operations/replicas.md). |
| `redisRevocations(redis, options?)` | Sign-outs every replica honours: `auth.session.revocations`. |
| `clientScript({ api? , nonce? })` | The one script tag for a page of fragments rendered with `script: false`. |
| `jsonLineSink(write?)`, `webhookSink(options)`, `notifySink(notifier)`, `syslogSink(options?)`, `otelLogSink(logger)` | Audit sinks for `panel.on("change", …)`; each has `.alert` for `panel.on("alert", …)`. |
| `otelMetrics(panel, meterOrProvider, { prefix?, groups? })` | The `/metrics` series through OpenTelemetry. See [metrics](../operations/metrics.md). |
| `signSession(secret, name, { ttlMs?, grants? })`, `sessionInfo(secret, cookie)` | A cookie value for `auth: { session }`, and what one says. `secret` may be a list, to rotate. See [security](../operations/security.md). |
| `redisThrottleStore(redis, prefix?)` | Shares failed sign-ins between replicas: `authThrottle: { store }`. |
| `LOCALES` | The page's own words in each shipped language. |
| `ManualClock`, `systemClock` | Time, injectable. See [testing your panel](../testing/your-panel.md). |
| `AdminPanelConfigError`, `ValueError` | The two refusals. |
| `PanelGroup`, `PanelAction`, `PanelTable`, `PanelFeed` | What the declarations return. |
| `VERSION` | The package version. |
| `MAX_HISTORY_POINTS`, `MIN_SAMPLE_INTERVAL_MS`, `MIN_POLL_INTERVAL_MS`, `MAX_SERIES`, `MAX_CHANGES`, `MAX_NOTICES`, `MAX_WIRE_BYTES`, `DEFAULT_MAX_LENGTH`, `MIN_TOKEN_LENGTH`, `DEFAULT_ACTION_TIMEOUT_MS`, `DEFAULT_PORT`, `MAX_PAGE_SIZE`, `MAX_SEARCH_LENGTH`, `MAX_FEED_CAPACITY`, `MAX_ENTRY_TEXT`, `MAX_REVERT_MS`, `APPROVAL_TTL_MS`, `MAX_PENDING`, `MIN_SESSION_SECRET_LENGTH`, `MAX_SCHEDULED`, `MAX_SCHEDULE_AHEAD_MS`, `MAX_SYNC_MESSAGE_BYTES`, `MAX_WEBHOOK_RETRIES`, `MAX_REVOKED_SESSIONS`, `DEFAULT_WRITES_PER_MINUTE`, `MAX_REASON_LENGTH`, `MIN_ROTATE_BYTES`, `MAX_GRID_COLUMNS`, `MAX_CARD_ROWS`, `MAX_LAYOUT_BYTES`, `MAX_LAYOUT_ENTRIES` | See [limits](limits.md). |

## `@osqd/admin-panel-builder/adapters`

`createPanelHandler(panel, options?)`, `listenPanel(panel, options?)`, `createFetchHandler(panel, options?)`
— the same as the panel's methods — `koaPanel(panel, options?)` and `fastifyPanel(panel, options?)`,
`remotePanelHandler(options)` for [another process's panel](../integration/remote.md),
`renderMetrics(panel, scope, prefix)`, and `createRouter(panel, options, context)`, the
framework-neutral router they share, with `MAX_BODY_BYTES` and `DEFAULT_PORT`.
`createFleet(options)` and `fleetHandler(options)` serve [one page for every replica](../operations/replicas.md#one-page-for-the-fleet),
with `MAX_FLEET_PANELS`.

Serve options: `basePath`, `auth`, `controls: { edit, actions }` (each `true` or a list of groups),
`groups`, `allowedHosts`, `authThrottle` (with `store` to share it), `writeLimit`, `stream`, `metrics`,
`health`, `clock`; `listen` adds `port` and `host`, `fetchHandler` adds `address`. The server `listen`
returns has `reload(options, { by })`: see [configuration](../operations/configuration.md#reloading). `remotePanelHandler` also
takes `groups` and `stream`.

## `@osqd/admin-panel-builder/client`

`panelClient({ url, token?, onBehalfOf?, timeoutMs?, fetch? })`: every route of the HTTP API as a typed
call — `schema()`, `state()`, `changes()`, `notices()`, `settings()`, `openApi()`, `table()`, `set(id,
value, { revertAfterMs?, at? })`, `cancelScheduled()`, `run()`, `runRowAction()`, `applyProfile()`,
`approve()`, `reject()`, `undo()`, `diffSettings()`, `importSettings()`, `watch(onState, { intervalMs?,
signal? })`. A refusal rejects with `PanelApiError` (`status`, and the panel's sentence as `message`).
See [the command line](../integration/cli.md), which is written on it.

## `@osqd/admin-panel-builder/testing`

`testPanel({ panel?, serve?, start? })` → `{ panel, clock, router, errors, request(method, path, body?,
headers?), as(token) }`; `EVERYTHING`, the scope with every control; `ManualClock`. See
[testing your panel](../testing/your-panel.md).

## `@osqd/admin-panel-builder/config`

`loadConfig({ text?, file?, env? })`, `listenOptions(config)`, `printConfig(config)`,
`planReload(current, next, by)` with `RESTART_REQUIRED` and `RELOADABLE`, `reloadListener(server,
current, next, by, log?)` to apply one; the parts: `parseToml(text)`,
`readConfig(table)`, `applyEnvironment(config, env)`, `envBoolean(text)`, `Section`, `ConfigError`,
`DEFAULT_CONFIG`, `MAX_CONFIG_LENGTH`. See [configuration](../operations/configuration.md).

## `@osqd/admin-panel-builder/themes`

The themes, `defineTheme`, `contrastRatio`, `resolveTheme(name or theme)`, `themeStylesheet(theme)` and
`tokenName(key)`.

## `@osqd/admin-panel-builder/presets`

`botHandlerPanel(panel, handler, options?)` and `hackerpotPanel(panel, engine, detectors, options?)`,
with `MAX_TRACKED`. See the [bothandlerjs](../integration/bothandlerjs.md) and [hackerpot](../integration/hackerpot.md) recipes.

## `@osqd/admin-panel-builder/cli`

`main(argv, io?)`, which `apb` runs, and `duration(text, flag?)`. See [the command line](../integration/cli.md).

## `@osqd/admin-panel-builder/element`, `/react`, `/vue`

`defineAdminPanelElement(name = "admin-panel")` and `ELEMENT_NAME`; `createAdminPanelComponent(React)`;
`createAdminPanelVueComponent(Vue)`. See [embedding](../integration/embedding.md).

## Related

- [Data shapes](data-shapes.md) · [HTTP API](http-api.md)
