# 8. Operating it

Persistence, metrics, the command line, and a checklist.

← [The course](index.md)

---

```ts
import { createAdminPanel, fileChangeLog, fileStore } from "@osqd/admin-panel-builder";

export const panel = createAdminPanel({
  title: "Game server", instance: process.env.HOSTNAME,
  store: fileStore("data/panel.json"), changeLog: fileChangeLog("data/changes.jsonl"),
});
export const maxPlayers = panel.modifiable(1000, { id: "max-players", label: "Max players", min: 10, max: 5000, persist: true });
await panel.ready;
await panel.listen({ auth: { tokens: { ada: process.env.ADA_TOKEN!, deploy: process.env.DEPLOY_TOKEN! } }, controls: { edit: true }, metrics: { prefix: "game" } });
```

- **Persistence.** An operator's choice survives a restart; the code's own writes are never stored. A
  stored value the declaration no longer accepts is refused with a notice, not applied.
- **Metrics.** `/metrics` exposes every numeric value to Prometheus, behind the same token; alert on
  `game_changes_total{ok="false"}`.
- **Scripts.** A deploy runs `apb set $PANEL max-players 200 --for 20m --token $DEPLOY_TOKEN` before a
  migration; the change is attributed to "deploy" and reverts itself if the script dies.

## A checklist before production

1. Every modifiable value has a range, options or a validator, and a label a stranger would understand.
2. Editing and actions are granted only on listeners with `auth`, and only in the groups each needs.
3. The panel is on loopback, a private network, or behind your administrator sign-in — not on a public
   site your own defences could lock you out of.
4. Values that must survive a restart have `persist` and a stable `id`; everything else deliberately does not.
5. Anything with money or safety attached has `approval: true`.
6. Changes go to a change log and to wherever your other records go.
7. Nothing sensitive is shown: keys and passwords are `sensitive: true`.
8. `npm run check` passes in your own test suite with `createAdminPanel()` and a `ManualClock`.

## Related

- [Security](../operations/security.md) · [Testing your panel](../testing/your-panel.md)
