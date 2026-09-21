# bothandlerjs

What the bot handler decides, and the settings worth changing live.

← [Serving overview](index.md)

---

Runnable: [`examples/bothandlerjs.ts`](../../examples/bothandlerjs.ts).

```ts
import { BotHandler } from "@osqd/bothandlerjs";
import { createAdminPanel } from "@osqd/admin-panel-builder";
import { botHandlerPanel } from "@osqd/admin-panel-builder/presets";

const handler = new BotHandler({ /* … */ });
const panel = createAdminPanel({ title: "bothandlerjs", theme: "osqd" });
botHandlerPanel(panel, handler, { applyChallengeScore: (score) => updatePolicy({ challengeAt: score }) });
await panel.listen({ port: 9780, auth, controls: { edit: true } });
```

The preset declares Traffic, Guard and Policy groups on your panel; `prefix` renames them if the panel
shows more than the bot handler.

The handler is taken structurally — anything with `on("decision", …)` and `on("downgrade", …)` — so the
panel code imports nothing from bothandlerjs.

- **Counters with rates.** Requests assessed, requests denied and downgrades are `counter()`s, each with
  its rate charted beside it, and exported as Prometheus counters when metrics are on.
- **Feeds of recent denials and downgrades**, each with the rule that fired.
- **Verdicts and actions over keys**, so a new verdict appears as a new bar without a code change.
- **Downgrades get a chart of their own**, because the guard refusing a rule's terminal action is the
  number worth watching; bothandlerjs's own docs name it as the series to alert on.
- **The challenge threshold** is a modifiable whose `onChange` hands the new score to the policy.
  bothandlerjs reads its policy live, so the change applies to the next request.

Run this panel on its own port rather than on a path of the site the handler protects: a mitigation
served to that site must never lock you out of the tool you are watching it with.

## Related

- [Actions](../concepts/actions.md) · [On a port](own-port.md)
