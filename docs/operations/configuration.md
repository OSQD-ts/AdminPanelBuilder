# Configuration

A listener's settings from a TOML file and the environment, for deployments that would rather not
change code to move a port.

← [Operations](index.md)

---

```ts
import { listenOptions, loadConfig } from "@osqd/admin-panel-builder/config";

const config = await loadConfig();          // APB_CONFIG, or ./admin-panel.toml when it exists, then the environment
await panel.listen(listenOptions(config));
```

**Precedence is built-in defaults < file < environment.** An image bakes in a file; a deployment
adjusts the last mile with `-e`. The environment is read as deployment facts, flat and unprefixed:

| Variable | Sets |
| --- | --- |
| `PORT` | `listen.port` |
| `HOST` | `listen.host` |
| `BASE_PATH` | `listen.base_path` |
| `PANEL_TOKEN` | the token, and `auth.mode = "token"` |
| `APB_CONFIG` | which file to read (the one prefixed name: it locates the configuration rather than being part of it) |

Values are trimmed and an empty one means unset. An override goes through the same checks as the file,
and the checks that combine settings run after it — a `HOST` of `0.0.0.0` with no token is refused
whichever of the two set it. Keep the token in the environment: a printed configuration shows only
whether it is set.

## The file

The package ships [`admin-panel.toml`](../../admin-panel.toml): every setting, at its default, with what
changing it does. Deleting it changes nothing; a test holds it to the built-in defaults. The sections are
`[listen]`, `[auth]`, `[controls]`, `[view]`, `[stream]`, `[metrics]`, `[throttle]` and `[write_limit]`.

The reader is strict. A key nothing reads is an error naming the nearest real one (`stream.max_veiwers
is not a setting; did you mean stream.max_viewers?`), a port is 0 to 65535, a boolean has no quotes, and
the parser supports the TOML a configuration needs — sections, strings, numbers, booleans, arrays — and
refuses the rest (inline tables, dates, multi-line strings) by name rather than misreading it. Every
failure is a `ConfigError` naming the line.

```bash
apb config admin-panel.toml     # the configuration as it resolves, credentials redacted
```

## Reloading

What can change while running is planned as data before anything is applied:

```ts
const plan = planReload(current, await loadConfig(), "SIGHUP");
for (const { key, reason } of plan.requiresRestart) log.warn(`${key} needs a restart: ${reason}`);
// plan.applied: the settings a new handler takes on the next request; plan.unchanged: the rest
```

`RESTART_REQUIRED` names each setting that cannot change under a running listener and why (the socket is
bound to the old port; open streams keep their pace); `RELOADABLE` lists the rest. `by` says who asked,
because a reload whose author is unknown is half an audit trail.

## Related

- [Security](security.md) · [Serving it](../integration/index.md)
