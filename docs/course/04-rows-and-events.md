# 4. Rows and events

A table of games, a feed of disconnects, counters.

← [The course](index.md)

---

```ts
import { counter, feed, percentiles, table } from "@osqd/admin-panel-builder";

table("Games in progress", {
  group: "Games",
  columns: ["id", "white", "black", { key: "moves", format: "integer" }, { key: "started", format: "timestamp" }],
  rows: () => [...activeGames.values()],
});
export const disconnects = feed("Disconnects", { group: "Games" });
export const started = counter("Games started", { group: "Games" });
export const moveTime = percentiles("Server move time", { group: "Games", unit: "ms" });
```

In the server: `disconnects.push({ player, game }, "warn")` when a socket drops, `started.inc()` when a
game begins, `moveTime.record(ms)` after each move is processed.

**Run it.** The table pages, sorts and searches the games the server holds; the feed lists disconnects
newest first; "Games started" shows its total and, beside it, games started per second over the last ten
seconds; the move-time card charts p50, p95 and p99 together.

**Things to notice.** When the table is a database table, use `fetch` instead of `rows` and answer one
page for `{ offset, limit, sort, direction, search }` — the whole set never reaches the panel. A feed
keeps its newest 200 entries and accepts at most 50 a second; past that it drops and counts, and says so
on the page, rather than queueing. A counter reads a restart as a reset, not as a negative rate.

Next: [doing things](05-doing-things.md).
