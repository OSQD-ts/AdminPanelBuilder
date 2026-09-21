# ch3ss

Games, matchmaking and ratings for a chess server.

← [Serving overview](index.md)

---

Runnable: [`examples/ch3ss.ts`](../../examples/ch3ss.ts) (`npx tsx examples/ch3ss.ts`, or `npm run demo`).

| Group | What | How it is declared |
| --- | --- | --- |
| Games | Active games and players online, on one chart | two viewables with `chart: { in: "Load", kind: "area" }` |
| Games | Move latency against players online | `chart: { over: playersOnline }` |
| Games | Openings played today | a record, `chart: { over: "keys" }` |
| Matchmaking | Waiting per time control | a record over keys |
| Matchmaking | Largest rating gap | `modifiable(200, { min: 50, max: 1000, step: 50, persist: true })` |
| Matchmaking | Featured time control | `modifiable("blitz", { options: TIME_CONTROLS, persist: true })` |
| Matchmaking | Guests may play | a boolean with `confirm` |
| Ratings | Rating distribution | a record of buckets over keys |
| Maintenance | Maintenance mode, message of the day | a confirmed switch; `multiline`, `maxLength: 280` |
| Maintenance | End abandoned games | `action(…, { destructive: true })` |

**Wiring it into the server.** Each `.value = …` in the example sits where ch3ss already counts the thing:
`activeGames.value += 1` where a game starts, the matchmaker reads `ratingGap.value` when it pairs. The
queue record is replaced whole (`queue.value = { … }`) rather than mutated, which is what tells the panel
it changed.

It also has a **table of games in progress** with an "Adjudicate draw" row action, a **counter** of games
started with its rate, **server move-time percentiles**, a **histogram** of game lengths, a **heatmap** of
games by weekday and hour, a **feed** of disconnects, a **Ban player** action that asks for a player, a
number of days and an optional reason, and two **profiles**: "Tournament mode" and "Evening maintenance".

## Related

- [Charts](../concepts/charts.md) · [Persistence](../operations/persistence.md)
