# Changes and notices

Who changed what, and what the panel wants you to know.

← [Operations](index.md)

---

## Changes

Every edit and every action run from the panel is a `ChangeRecord`: what, who, when, from what to what
(never for a sensitive value), and for an action what it answered. The page lists the newest 200 under
Activity. Writes from code are not recorded.

For a real audit trail, keep them in a [change log and forward them to sinks](audit.md).

## Undo

Every edit that recorded what it replaced has an **Undo** under Activity (and `POST /api/changes/:id/undo`).
Undo writes the old value back through the same checks as any edit, attributed to whoever undid it — so
it can itself be undone, and a value declared with `approval` turns an undo into a proposal. It is
refused when the value has changed since, because undoing would overwrite the later change, and for a
sensitive value, whose old value was never recorded.

## Timed changes

An operator can apply a change **for** five minutes, fifteen, an hour, four hours or a day (or any time
up to `MAX_REVERT_MS` through the API's `revertAfterMs`). The page shows what it reverts to and when; the
revert is recorded as a change of its own ("ada (timed change ended)"); any later change cancels it. For
a persisted value the pending revert is stored too, so a restart does not strand it — and one whose time
passed while the process was down reverts on start. `timed: false` on a value turns the option off.

## Scheduled changes

"Maintenance on at 22:00." Under **Later** on a value's card, or `at` in the API (`apb set … --at
2026-10-01T22:00:00Z`), a change waits for its time, up to `MAX_SCHEDULE_AHEAD_MS` (thirty days) ahead
and `MAX_SCHEDULED` at once. The card lists each with what, when, how long until and who scheduled it,
and a **Cancel** (`POST /api/schedules/:id/cancel`). When it fires it is recorded as a change of its own
("ada (scheduled)"), through the same checks as any edit. For a persisted value the schedule is stored,
and one whose time passed while the process was down is applied on start with a notice saying it was
late. A scheduled change to a value declared with `approval` is proposed now and, once approved, waits
for its time.

## Approvals

A value declared with `approval: true` changes only when two operators agree. An edit becomes a
**proposal**, answered 202 with `{ pending }` and shown on the value and under Activity; a different
operator approves it (`POST /api/pending/:id/approve`) and it is applied, recorded as "ada, approved by
sam". The proposer cannot approve their own change. Anyone who may edit the value can turn it down. A
proposal lapses after `APPROVAL_TTL_MS` (an hour), at most `MAX_PENDING` wait at once, and a profile may not
include an approval value — it would be a way around the second operator.

## Settings as a file

Under Activity, **Download settings** saves every modifiable value you may see as JSON (sensitive values
left out: an export is a file people pass around). **Choose a file to import** shows what importing it
would change, value by value, with the reason any would be refused; nothing is applied until you press
the button under the list. The import is one change, applied whole or not at all like a profile, and
refused whole if any value fails its constraints, needs approval, or is not a setting this listener may
change. `apb export` and `apb import --dry-run` do the same from a script.

## The timeline

Text, choices and switches cannot be charted, so their card keeps the last changes (value, when, who)
under **Lately**. See the `timeline` option in [values](../concepts/values.md#options).

## Alerts

```ts
viewable(() => queue.length, { label: "Queue", status: { warn: 100, bad: 1000 }, alert: { forMs: 60_000 } });
panel.on("alert", notifySink(notifier).alert);
```

A value with `alert` is checked once a second. When its status reaches the level (`"bad"` by default,
or `"warn"`) and holds for `forMs`, the panel raises a notice and an `alert` event naming the value, the
reading, the threshold and how long it has held. It says nothing more until the status recovers and
`cooldownMs` (default ten minutes) has passed, so a spike lasting an hour is one alert and a value
flapping across its threshold is one per cooldown. Every [audit sink](audit.md) takes alerts through
`.alert`.

## Notices

Something an operator should know that is not an error. A notice has a stable id, so the same condition
noticed again updates it rather than adding another. They appear under Activity and are emitted as
`notice` events. Current notices:

| Notice | Means |
| --- | --- |
| Values have no label | They are named by order of declaration, which changes when declarations move |
| Reading X threw | A getter or bound property failed; the page shows the failure in its place |
| The change handler for X failed | The new value was applied; what `onChange` was meant to do may not have happened |
| Stored choices could not be loaded / X could not be saved / the stored value of X was refused | See [persistence](persistence.md) |
| A listener lists a group nothing is declared in | Its `groups` option shows nothing for that name |
| The change log could not be loaded or written | The page's history starts from this start, or a change is missing from the log after a restart |
| X could not be reverted / changed as scheduled | A timed or scheduled change was refused by the value's current constraints |
| X was changed late, on start | A scheduled change's time passed while the process was down |
| X is bad / at warning | An [alert](#alerts) |
| X looks like it holds a secret | Its id or label says password, token, key…; declare it `sensitive` if it is one |
| A change could not be sent to the other replicas / was refused here | See [several processes](replicas.md) |

## Errors

Failures that must not reach your application — a throwing getter or listener, a store that cannot be
written, an action that threw — go to the panel's `onError` (default `console.error`) and are emitted as
`error` events.

## Related

- [Data shapes](../reference/data-shapes.md) — `ChangeRecord` and `Notice`.
