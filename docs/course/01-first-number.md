# 1. A first number

`viewable`, `listen`, and what the page shows.

← [The course](index.md)

---

```ts
// panel.ts
import { defaultPanel, viewable } from "@osqd/admin-panel-builder";

export const players = viewable(0, "Players online");

const server = await defaultPanel().listen();
console.log(server.url);
```

Somewhere the server already counts players, write `players.value += 1` and `players.value -= 1`.

**Run it** with `npx tsx panel.ts` and open the URL. One card, "Players online", with its value and
"Unchanged since the panel started" until the first change, then "Changed 3 s ago". The page asks for
new values once a second, or streams them: the header says **Live** or **Live (streaming)**.

**What just happened.** `viewable(0, …)` returned a handle holding 0; writing `.value` is how the panel
hears a change. `listen()` bound `127.0.0.1:9780` — loopback, so nothing off this machine can reach it,
and read-only, so nothing that reaches it can change anything.

**Try** `players.value = "lots"`. A viewable shows whatever it is given; refusing to display something is
worse than displaying it oddly.

Next: [something to change](02-something-to-change.md).
