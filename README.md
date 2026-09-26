# 🎛️ admin-panel-builder

**Admin panels for Node applications, declared next to the variables they show.** Write
`viewable(players)` where the number already lives, `modifiable(100, { min: 2, max: 1000 })` where a
setting is read, and the panel exists: grouped, charted, themed, and served on a path of your server, on a
port of its own, or embedded in a page you already have.

```ts
import { defaultPanel, modifiable, viewable } from "@osqd/admin-panel-builder";

const players = viewable(0, { label: "Players online", group: "Games", chart: true });
const maxPlayers = modifiable(100, { label: "Max players", group: "Games", min: 2, max: 1000 });

players.value += 1;                   // the panel sees it, and the chart moves
if (players.value > maxPlayers.value) refuseNewGames();

await defaultPanel().listen({ auth: { token: process.env.PANEL_TOKEN! }, controls: { edit: true } });
```

A panel sits inside the application it changes, so it is built around one promise:

> **A panel never looks configured when it is not, and never lets anyone change the application without
> knowing who they are.**

A misspelt option, a range that refuses its own starting value, a chart that could never draw, a theme
token CSS would silently drop: each is refused with a sentence when it is declared, not discovered in
production. Editing and actions are off unless a listener turns them on, and turning them on requires
authentication, even on loopback. Every change is recorded with the name of whoever made it.

```bash
npm install @osqd/admin-panel-builder
```

---

## Documentation

The README is the argument and the shortest path to a working panel. Everything else lives in
**[`docs/`](docs/index.md)**, a page per question.

| | |
| --- | --- |
| **[The course](docs/course/index.md)** | One running panel, from a first number to a deployment you can defend. Start here if the library is new to you. |
| **Start here** | [Installation](docs/start/installation.md) · [Your first panel](docs/start/first-panel.md) · [Upgrading](docs/start/upgrading.md) |
| **Concepts** | [How it works](docs/concepts/how-it-works.md) · [Values](docs/concepts/values.md) · [Groups](docs/concepts/groups.md) · [Charts](docs/concepts/charts.md) · [Actions](docs/concepts/actions.md) · [Tables, feeds and profiles](docs/concepts/blocks.md) · [Counters](docs/concepts/counters.md) · [Using the page](docs/concepts/the-page.md) |
| **[Serving it](docs/integration/index.md)** | [On a path](docs/integration/mounting.md) · [On a port](docs/integration/own-port.md) · [Embedded as HTML](docs/integration/embedding.md) · [On an edge runtime](docs/integration/fetch.md) · [Koa and Fastify](docs/integration/koa-fastify.md) · [Another process](docs/integration/remote.md) · [Other frameworks](docs/integration/frameworks.md) · [The command line](docs/integration/cli.md) |
| **Examples and recipes** | [Seven runnable examples](docs/examples.md) · [bothandlerjs](docs/integration/bothandlerjs.md) · [hackerpot](docs/integration/hackerpot.md) |
| **[Operations](docs/operations/index.md)** | [Security](docs/operations/security.md) · [Themes](docs/operations/themes.md) · [Persistence](docs/operations/persistence.md) · [Changes and notices](docs/operations/changes-and-notices.md) · [Audit](docs/operations/audit.md) · [Metrics](docs/operations/metrics.md) · [Configuration](docs/operations/configuration.md) · [Several processes](docs/operations/replicas.md) |
| **Testing** | [Testing your panel](docs/testing/your-panel.md) · [Trying it locally](docs/testing/try-it.md) |
| **Reference** | [API](docs/reference/api.md) · [HTTP API](docs/reference/http-api.md) · [Data shapes](docs/reference/data-shapes.md) · [Limits](docs/reference/limits.md) · [Design decisions](docs/design/decisions.md) |

---

## Why this design

**The panel is declared where the value lives.** An admin panel built as a separate application needs an
API for every number it shows and every setting it changes, and drifts from the code it describes.
Declaring the value at the variable means the panel cannot show something that no longer exists, and
adding a number to it is one line in the file that already has the number.

**A handle, not a magic variable.** JavaScript copies a primitive on assignment and nothing observes a
local variable, so `viewable(10)` returns a handle and the price is `.value`. Two other sources cover
what the application already keeps elsewhere: a function (`viewable(() => queue.length)`) and a property
of an existing object (`bind(config, "maxPlayers")`), so a panel can be added to a codebase without
rewriting how it stores anything.

**What a viewer may see and what they may do are separate, and doing is off by default.**

|                     | Groups (seeing)                                   | Controls (doing)                                 |
| ------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Default             | every group                                       | nothing                                          |
| Turned off          | withheld on the server, never sent                | the page says why, the API answers 403           |
| Needs auth          | only off loopback                                 | always, even on loopback                         |
| Per listener        | yes: a support listener can show one group        | yes: a read-only listener beside an editing one  |

**One router, three front ends.** The panel never touches a request or a response. A framework-neutral
router turns HTTP into facts and answers; the Node handler, the standalone listener and the Fetch handler
only translate. So the panel behaves the same in Express, on its own port and on a Worker, and its
security rules are tested once.

**The page is an operator's tool, built like one.** A nonce CSP from `default-src 'none'`, no CORS, no
framing, every value placed with `textContent`, a client bundle whose build refuses `innerHTML`, a legend
*and* a table under every chart, and an axe pass in the browser suite. Values are text somebody else
wrote (a player's name, an email subject), and the page treats them that way.

**Themes are data.** One layout stylesheet written against custom properties, and six themes that fill
them in: Material (the default), Apple, Fluent, Carbon, the OSQD dashboards' own, and a high-contrast
theme held to 7:1. A custom theme is `defineTheme()`
over any of them and reaches every screen the built-in ones do; every text colour is measured at 4.5:1
by the test suite.

The trade-offs, and what each costs, are in [the design decisions](docs/design/decisions.md).

---

## Try it

```bash
npm run demo        # a service dashboard on :9780, a shop with the panel embedded three ways on :9781
npm run example     # the smallest panel, on :9780
npm run playground  # every theme, light and dark, with contrast measured, on :9786
```

## License

[OSQD Non-Resale License](LICENSE). © Michał Płatosz.
