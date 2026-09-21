# 2. Something to change

`modifiable`, constraints, and why editing needs a token.

← [The course](index.md)

---

```ts
import { defaultPanel, modifiable, viewable } from "@osqd/admin-panel-builder";

export const players = viewable(0, "Players online");
export const maxPlayers = modifiable(1000, { label: "Max players", min: 10, max: 5000, step: 10 });
export const maintenance = modifiable(false, { label: "Maintenance mode", confirm: true });

await defaultPanel().listen({ auth: { token: process.env.PANEL_TOKEN! }, controls: { edit: true } });
```

The server reads `maxPlayers.value` where it admits a player, and `maintenance.value` where it starts a
game. There is no glue: the next read sees the operator's change.

**Run it** with `PANEL_TOKEN=$(openssl rand -hex 16) npx tsx panel.ts`, open `…/?token=<token>` once (the
token is swapped for a cookie and removed from the address bar), and change Max players. Try 7000: the
page refuses it with "Max players must be at most 5000", the same sentence `maxPlayers.set(7000)` would
throw in code. Switch Maintenance mode: the switch asks for a second click, because you said `confirm`.

**Why a token.** Take `auth` away and keep `controls: { edit: true }`: the listener refuses to start.
Editing without knowing who is asking lets anyone who reaches the port change the server, and leaves
nobody to name afterwards. That holds on loopback too — other processes and, through DNS rebinding, web
pages reach loopback. Under **Activity**, every change you made is listed as made by "token"; with
`tokens: { ada: …, sam: … }` each person gets their name.

Next: [groups and charts](03-groups-and-charts.md).
