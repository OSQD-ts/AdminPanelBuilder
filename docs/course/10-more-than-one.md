# 10. More than one

Replicas, a fleet page, a configuration file, and the page in another language.

← [The course](index.md)

---

The game server outgrew one process: three replicas behind a load balancer, each with its own panel.
An operator's change has to reach all three, the page must say which replica it is, and the settings
the operations team tunes should live in a file they can review, not in code.

```ts
import { createAdminPanel, redisChangeLog, redisClaim, redisRevocations, redisStore, redisSync } from "@osqd/admin-panel-builder";
import { listenOptions, loadConfig, reloadListener } from "@osqd/admin-panel-builder/config";

export const panel = createAdminPanel({
  title: "Game server", instance: process.env.HOSTNAME, locale: "auto",
  store: redisStore(redis), changeLog: redisChangeLog(redis), keepHistory: true,
  sync: redisSync({ publisher: redis, subscriber: redis.duplicate(), claim: redisClaim(redis) }),
});
let config = await loadConfig();                       // ./admin-panel.toml, then PORT, HOST, PANEL_TOKEN
const server = await panel.listen(listenOptions(config));
process.on("SIGHUP", async () => { config = reloadListener(server, config, await loadConfig(), "SIGHUP"); });
```

- **One change, every replica.** Edit *Max players* on the page, which the load balancer sent to
  replica two: replicas one and three apply it too, and their Activity says it came from replica two.
  A proposal made on one replica is approved on another; tonight's maintenance fires once, from
  whichever replica claims it, even if the one that scheduled it was replaced this afternoon.
- **Same settings, same history.** Persisted values and the change log live in Redis, so a new replica
  starts where the others are, and charts survive a deploy (`keepHistory`).
- **Signed out everywhere.** With your own sign-in, `auth: { session: { secret, revocations:
  redisRevocations(redis) } }` makes a sign-out on one replica count on all of them.
- **The whole fleet on one page.** `fleetHandler({ panels, auth })` lists every replica — answering or
  not, since when, how many warnings — and the settings on which they disagree, which is how a replica
  on an old deploy shows itself.
- **Settings in a file.** `admin-panel.toml` holds the listener's port, auth mode, controls and
  limits; every value in the shipped one is the default. `apb config` prints what the process will do,
  token redacted. Edit the file, `kill -HUP` the process, and the controls change without a restart;
  the port does not, and the log says so.
- **Their language.** `locale: "auto"` shows each operator the page in their browser's language, if
  the package ships it, and **Language** in the header lets them choose. Refusals come in that
  language too: "Max players darf höchstens 5000 sein."

## A checklist for more than one replica

1. Every replica has the same declarations; a replica that refuses a synced change raises a notice.
2. `redisSync` has a `claim`, so approvals and schedules happen exactly once.
3. Persisted values, the change log and revocations are in shared stores, not files.
4. The fleet page is behind its own auth: it holds a token for every panel it lists.

## Related

- [Several processes](../operations/replicas.md) · [Configuration](../operations/configuration.md) · [Using the page](../concepts/the-page.md)
