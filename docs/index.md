# Documentation

**admin-panel-builder**: admin panels for Node applications, declared next to the variables they show.

← [Back to the README](../README.md)

---

## Start here

**New to this?** [**The course**](course/index.md) builds one panel step by step, with something to run at every stage.

| | |
| --- | --- |
| [The course](course/index.md) | One running panel, from a first number to a deployment you can defend. |
| [Installation](start/installation.md) | The package, its entries, and what each needs from your runtime. |
| [Your first panel](start/first-panel.md) | A value, a setting and a listener, and what each line does. |
| [Upgrading](start/upgrading.md) | The part of the changelog that asks something of you. |

## The ideas the library is built on

| | |
| --- | --- |
| [How it works](concepts/how-it-works.md) | The panel, the router, the front ends, and what travels between them. |
| [Values](concepts/values.md) | `viewable`, `modifiable`, `bind`: handles, sources, kinds and constraints. |
| [Groups](concepts/groups.md) | Grouping at declaration and after the fact, and what a group controls. |
| [Charts](concepts/charts.md) | Alone or shared, over time, over keys or against another value, and what a history costs. |
| [Actions](concepts/actions.md) | Buttons that run code in the application, with deadlines, input and attribution. |
| [Tables, feeds and profiles](concepts/blocks.md) | Rows, events, and several settings at once. |
| [Counters, rates and percentiles](concepts/counters.md) | Counts that only go up, their rates, and latency's tail. |
| [Using the page](concepts/the-page.md) | The keyboard, a viewer's own colours, and the page's languages. |

## Serving it

| | |
| --- | --- |
| [Serving overview](integration/index.md) | The three ways to serve a panel and when each fits. |
| [On a path](integration/mounting.md) | `panel.handler()` in Express, Connect or `node:http`. |
| [On a port](integration/own-port.md) | `panel.listen()`, loopback by default. |
| [Embedded as HTML](integration/embedding.md) | `panel.html()`, snapshots, and `<admin-panel>`. |
| [On an edge runtime](integration/fetch.md) | `panel.fetchHandler()` for Workers, Deno, Bun and Fetch routers. |
| [Koa and Fastify](integration/koa-fastify.md) | Adapters sharing the Node handler's behaviour. |
| [Another process](integration/remote.md) | A worker's panel, served from the operator-facing server. |
| [Other frameworks](integration/frameworks.md) | Hono, Next.js, NestJS, React and Vue. |
| [The command line](integration/cli.md) | `apb`: read and change a panel from a script. |

## Recipes

| | |
| --- | --- |
| [Examples](examples.md) | Seven runnable panels, each going deep into one part of the engine. |
| [bothandlerjs](integration/bothandlerjs.md) | What the bot handler decides, and the settings worth changing live. |
| [hackerpot](integration/hackerpot.md) | Hits by detector, and detector switches. |

## Operations

| | |
| --- | --- |
| [Operations overview](operations/index.md) | Running a panel in production. |
| [Security](operations/security.md) | Authentication, controls, the page's own defences, and where not to mount a panel. |
| [Themes](operations/themes.md) | Material, Apple, OSQD, and your own. |
| [Persistence](operations/persistence.md) | Remembering an operator's choices across restarts. |
| [Configuration](operations/configuration.md) | Listener settings from a TOML file and the environment. |
| [Several processes](operations/replicas.md) | Replicas that share settings, the change log and chart history. |
| [Changes and notices](operations/changes-and-notices.md) | Who changed what, undo, approvals, timed changes, and notices. |
| [Audit](operations/audit.md) | Keeping every change, and sending it to logs, webhooks and notifiers. |
| [Metrics](operations/metrics.md) | The panel's numbers in Prometheus. |

## Testing

| | |
| --- | --- |
| [Testing your panel](testing/your-panel.md) | A manual clock, the router without a server, and asserting on the schema. |
| [Trying it locally](testing/try-it.md) | The demo, the examples, and the simulator. |

## Reference

| | |
| --- | --- |
| [API](reference/api.md) | Every exported function, class and constant. |
| [HTTP API](reference/http-api.md) | The routes a listener answers, and their status codes. |
| [Data shapes](reference/data-shapes.md) | Every shape that leaves the process. |
| [Limits](reference/limits.md) | Every cap, and why it is that number. |
| [Design decisions](design/decisions.md) | The trade-offs, and what each costs. |
