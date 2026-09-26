# Examples

Seven runnable panels, each going deep into one part of the engine.

← [Documentation](index.md)

---

Every example is a file in [`examples/`](../examples/) that exports the function building its panel
and runs it when started directly. Each prints a URL on its first line; the ones on a port of their own
put a token in it (`PANEL_TOKEN` sets it, otherwise a random one is printed). `tests/examples.test.ts`
starts every one as a process and checks what it claims to show, so none of them can drift from the
code.

| Example | Run | Goes into |
| --- | --- | --- |
| [Quickstart](#quickstart) | `npm run example` | the default panel, from anywhere in an application |
| [A service at a glance](#a-service-at-a-glance) | `npx tsx examples/service.ts` | every chart kind, tables, feeds, alerts, layout and themes |
| [Changing production safely](#changing-production-safely) | `npx tsx examples/change-control.ts` | every guard between an operator and a setting |
| [Who sees what](#who-sees-what) | `npx tsx examples/access.ts` | sign-in, grants, listeners, limits, metrics |
| [Replicas and a fleet](#replicas-and-a-fleet) | `npx tsx examples/fleet.ts` | sync between replicas, the fleet page, a remote panel |
| [Inside another application](#inside-another-application) | `npx tsx examples/embedding.ts` | fragments, snapshots, the Fetch API |
| [Configured from a file](#configured-from-a-file) | `APB_CONFIG=admin-panel.toml npx tsx examples/configuration.ts` | the listener in TOML, reloaded on SIGHUP |

## Quickstart

[`examples/quickstart.ts`](../examples/quickstart.ts). A counter that charts itself, two settings and an
action, declared with the module-level functions (`viewable`, `modifiable`, `action`) of the default
panel: nothing to pass around, declared where the value lives.

## A service at a glance

[`examples/service.ts`](../examples/service.ts). A storefront in five groups, each declared through its
group handle.

- **Traffic**: a counter and its rate, values sharing a chart, a stacked chart, bars over the keys
  of a record, a heatmap of a week by hour.
- **Latency**: percentiles, a value plotted against another, a histogram, a limit drawn across a
  chart from a setting (changing it marks the chart).
- **Errors**: a status with an alert that must hold before it fires, a feed with levels, alerts
  written into it.
- **Capacity**: a gauge, values read on a timer, a rate of a total kept elsewhere.
- **Jobs**: a table paged, sorted and searched by the application, with row actions.

The layout is the panel's own, with one size given in cells; viewers may pick a custom theme,
"Harbor", from Settings. See [groups](concepts/groups.md) and [charts](concepts/charts.md).

## Changing production safely

[`examples/change-control.ts`](../examples/change-control.ts). A payments service's settings:

- bounds and steps, and a check of the application's own (`validate`);
- a second operator (`approval`) and a required reason;
- changes that persist across restarts, and changes that undo themselves after a while;
- `onChange`, `visibleWhen`, `disabledWhen`, and a slow check (`validateAsync`);
- JSON settings, and a secret that is never shown;
- profiles, one of them approved;
- an action with a form that needs approval, and one that asks for its name to be typed.

With `APB_LOG=changes.jsonl` it keeps a hash-chained change log on disk and verifies it from the page,
and every change goes to stderr as a JSON line. See [values](concepts/values.md) and
[audit](operations/audit.md).

## Who sees what

[`examples/access.ts`](../examples/access.ts). An application with its own users signs them in and hands
the panel a signed session with grants:

- an administrator sees everything;
- support sees one group, read-only, and the others never leave the process;
- finance may change one group and run nothing.

Signing out revokes the session. A second listener serves one group to a monitoring token, with
Prometheus metrics and a health check. Writes are limited per operator and failed sign-ins throttled,
and the page speaks each viewer's language. See [security](operations/security.md).

## Replicas and a fleet

[`examples/fleet.ts`](../examples/fleet.ts). Three replicas on one sync channel. A change on one is
applied on all, a proposal made on one is approved from another, a schedule fires once, and a layout
saved for everybody reaches every page. A fleet page lists them and the settings they disagree on.
A remote panel shows one group of a replica to people who should not reach it. See
[replicas](operations/replicas.md).

## Inside another application

[`examples/embedding.ts`](../examples/embedding.ts). One handler at `/admin`, shown as:

- the panel's own page;
- a fragment in the host's page;
- two compact single-group fragments sharing a script;
- a nightly snapshot under a nonce CSP.

The same panel is also served through `fetchHandler()` as Hono, Next.js and Deno/Bun routes. See
[embedding](integration/embedding.md) and [the Fetch API](integration/fetch.md).

## Configured from a file

[`examples/configuration.ts`](../examples/configuration.ts). The declarations in code, the listener in
`admin-panel.toml` and the environment; `kill -HUP` applies what can change without a restart. See
[configuration](operations/configuration.md).
