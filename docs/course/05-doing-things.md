# 5. Doing things

Actions, input, profiles.

← [The course](index.md)

---

```ts
import { action, profile } from "@osqd/admin-panel-builder";

action("End abandoned games", () => `Ended ${endAbandoned()} games.`, { group: "Games", destructive: true });
action("Ban player", ({ input, by }) => ban(String(input.player), Number(input.days), by), {
  group: "Games",
  input: { player: { maxLength: 40, pattern: /^[a-z0-9_]+$/ }, days: { kind: "number", min: 1, max: 365, integer: true, default: 7 } },
});
profile("Tournament mode", [[maxPlayers, 500], [maintenance, false]], { group: "Limits" });
```

Add `actions: true` to the listener's `controls`.

**Run it.** "End abandoned games" is drawn as destructive and asks for a second click that names what
it will do. "Ban player" asks for a player and a number of days, checks them the way a setting is checked,
and passes them to your function already validated. "Tournament mode" sets both values in one step, whole
or not at all, with one entry under Activity.

**Things to notice.** An action gets the operator's name and an abort signal; after 30 seconds (or its
`timeoutMs`) the operator is told it failed and the signal fires. What it returns is what the operator
reads. A table can have row actions too: `actions: [{ label: "Adjudicate draw", run: (id) => … }]`.

Next: [inside your application](06-inside-your-application.md).
