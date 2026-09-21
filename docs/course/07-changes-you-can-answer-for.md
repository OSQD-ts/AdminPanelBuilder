# 7. Changes you can answer for

Timed changes, approvals, undo, the change log.

← [The course](index.md)

---

```ts
import { createAdminPanel, fileChangeLog, jsonLineSink } from "@osqd/admin-panel-builder";

export const panel = createAdminPanel({ changeLog: fileChangeLog("data/changes.jsonl") });
panel.on("change", jsonLineSink());
export const maxPlayers = panel.modifiable(1000, { label: "Max players", min: 10, max: 5000, step: 10 });
export const payoutRate = panel.modifiable(0.8, { label: "Prize payout rate", format: "percent", min: 0, max: 1, step: 0.01, approval: true });
```

**Run it.** Beside Apply there is now a duration: raise Max players "for 1 h" and the card says what it
reverts to and when; the revert happens on its own and is recorded. Change the payout rate: it becomes a
proposal. Sign in as someone else and approve it; it applies as "ada, approved by sam". Under Activity,
**Undo** any change whose value nothing has changed since.

**Things to notice.** Every change is in `data/changes.jsonl` and on stdout as one JSON line, and survives
a restart — so the change ids undo refers to are never reused. A proposal lapses after an hour, and the
proposer cannot approve it. A profile cannot include an approval value; it would be a way around the
second person.

Next: [operating it](08-operating-it.md).
