# Several processes

One application running as several replicas, and one panel that tells the truth about all of them.

← [Operations](index.md)

---

A panel lives in the process it describes. Run three replicas behind a load balancer and there are three
panels, and an operator's change reaches whichever one the request landed on. Three things make that
safe.

## Changes reach every replica

```ts
import { createAdminPanel, redisSync } from "@osqd/admin-panel-builder";

const panel = createAdminPanel({
  instance: process.env.HOSTNAME,
  sync: redisSync({ publisher: redis, subscriber: redis.duplicate() }),
});
```

```ts
sync: redisSync({ publisher: redis, subscriber: redis.duplicate(), claim: redisClaim(redis) })
```

After an operator's change is applied, it is published on the channel (`apb:changes` by default).
Every other replica applies it through the same checks as a local edit, and shows it in its change list
with the replica it came from. A replica that refuses it (its declaration differs, say, mid-deploy) keeps
its own value and raises a notice saying the replicas now disagree. A publish that fails is a notice too:
the change stands on the replica that made it.

Only operator changes travel. Writes from code (`players.value += 1`) are each replica's own truth.
`memorySync()` does the same within one process, for tests.

## What operators start, any replica finishes

Proposals and scheduled changes travel too. A proposal made through one replica is listed on all of them
and can be approved or turned down on any; a schedule fires even if the replica that made it is gone.
Both must happen exactly once, so the replica acting first **claims** it — `claim: redisClaim(redis)`,
Redis `SET NX PX` — and only the claimant goes on. Without a claim, a schedule fires only on the replica
that made it, and two operators approving one proposal on two replicas at the same instant could both
succeed. A replica that joins later learns of proposals made after it started.

Sign-outs: with your own sign-in, `auth: { session: { secret, revocations: redisRevocations(redis) } }`
makes a sign-out on one replica refuse that session on all of them.

## Settings and the change log in one place

```ts
import { redisChangeLog, redisStore } from "@osqd/admin-panel-builder";

createAdminPanel({ store: redisStore(redis), changeLog: redisChangeLog(redis) });
```

`redisStore` keeps persisted values in one hash (`apb:values`); `redisChangeLog` keeps the change log in
one list (`apb:changes`, trimmed to the newest 10,000). Both take any client with the few methods they
use — ioredis and node-redis both fit — so the library still has no dependencies.

## Charts across restarts

`keepHistory: true` saves every chart's history to the store once a minute and on `close()`, and loads it
on start, so a deploy does not blank every chart. It needs a store.

## One page for the fleet

Each replica still serves its own panel. The fleet page lists them all, with whether each answers:

```ts
import { fleetHandler } from "@osqd/admin-panel-builder/adapters";
app.use("/fleet", fleetHandler({
  panels: replicas.map((host) => ({ name: host, url: `http://${host}:9780`, token: process.env.PANEL_TOKEN })),
  auth: { check: (request) => sessionUser(request)?.name ?? false },
}));
```

Each row says whether the panel answers (and why not) and since when, its title and instance, its
version, how many warnings it has, and how long it took, with a link to it. Below, **Settings that
differ** lists every setting whose value is not the same on every panel — a replica that refused a synced
change, or one running another version — with each panel's value. `refreshSeconds: 30` reloads the
page without a script. It aggregates nothing else: each panel stays
the truth about its own process. The page is rendered on the server with no script, so it works during
the outage you open it for, and it needs its own `auth` because it holds a token for every panel.
`GET /fleet/api/fleet` answers the same as JSON. To serve one replica's panel from another server, see
[another process](../integration/remote.md).

## Related

- [Persistence](persistence.md) — what `persist` keeps.
- [Audit](audit.md) — the change log and its hash chain.
