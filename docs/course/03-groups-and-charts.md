# 3. Groups and charts

Tabs, charts beside a value and shared by a group, thresholds.

← [The course](index.md)

---

```ts
export const players = viewable(0, { label: "Players online", group: "Games", chart: { in: "Load", kind: "area" }, status: { warn: 4000, bad: 4800 } });
export const games = viewable(() => activeGames.size, { label: "Active games", group: "Games", chart: { in: "Load", kind: "area" } });
export const latency = viewable(0, { label: "Move latency", unit: "ms", group: "Games", chart: { over: players } });
export const openings = viewable<Record<string, number>>({}, { label: "Openings today", group: "Games", chart: { over: "keys" } });
export const maxPlayers = modifiable(1000, { label: "Max players", group: "Limits", min: 10, max: 5000, step: 10, chart: "step" });
```

**Run it.** Two tabs now, Games and Limits. "Load" draws players and games on one area chart; "Move
latency" is plotted against players online, so you can see whether it grows with load; "Openings today"
is one bar per key. Max players has a step chart, and every change you make to it is marked on it with
your name. Players online turns amber at 4000 and red at 4800, with the word beside it.

**Things to notice.** `viewable(() => activeGames.size)` is read on every look — nothing to keep in step
with the map you already have — and charted on a timer, since a function cannot announce a change. Each
chart has **Show as a table** and **Download CSV**, and a sentence a screen reader reads. Drag across a
chart to zoom; **Pause** holds it still while it keeps collecting.

**Try** `chart: { over: "keys" }` on a number. It is refused when the file loads, with a sentence saying
why: a chart that could never draw is a bug to find now, not a blank card to wonder about later.

Next: [rows and events](04-rows-and-events.md).
