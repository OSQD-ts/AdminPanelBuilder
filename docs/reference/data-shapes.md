# Data shapes

Every shape that leaves the process.

← [Documentation](../index.md)

---

The same objects reach the page, an embedded fragment, the custom element and anybody reading the API.
**Every string in them may have been written by somebody the application serves** — a player's name, an
email subject, a probed path. Render them as text, never as markup.

## PanelSchema

What is there. Changes when anything is declared, moved or reconfigured; `structure` says when.

```ts
{
  title: string; instance?: string; version: string; structure: number;
  theme: { name: string; scheme: "auto" | "light" | "dark"; offered?: Array<{ name: string; label: string }> };
  grid: { columns: number; rowHeight: number };   // every group's, unless it has its own
  layout?: Record<string, { order?: string[]; sizes?: Record<string, { w: number; h: number }> }>;
  layoutWritable?: boolean;        // this viewer may save a layout for everybody
  pollMs: number;
  controls: { edit: boolean; actions: boolean };
  restrictions: Restriction[];     // what this listener does not allow, and why: { text, key, params? }
  groups: Array<{ id: string; title: string; description?: string; grid?: { columns: number; rowHeight: number }; items: ItemSchema[] }>;
}
```

`ItemSchema` is one of:

- **`{ type: "value", id, label, description?, kind, unit?, format?, decimals?, editable, live, sensitive, confirm, constraints, chart? }`**
  — `constraints` holds `min`, `max`, `step`, `integer`, `options`, `maxLength`, `pattern: { source, flags }`, `multiline` as declared.
- **`{ type: "chart", id, title, description?, kind, over, series, min?, max?, placement, points, unit?, format? }`**
  — `over` is `"time"`, `"keys"` or `{ value, label }`; each series is `{ value, label, slot, history? }`.
- **`{ type: "action", id, label, description?, confirm, destructive, runnable, input?, span? }`** — each
  input field is `{ name, label, description?, kind, constraints, optional, default? }`.
- **`{ type: "table", id, title, description?, columns, pageSize, searchable, actions, runnable, span? }`** —
  a column is `{ key, label, format?, unit?, decimals?, sortable }`, an action `{ id, label, confirm, destructive }`.
- **`{ type: "feed", id, title, description?, capacity, perSecond, span? }`**
- **`{ type: "profile", id, title, description?, confirm, writable, settings, span? }`** — a setting is
  `{ value, label, to? }`, `to` absent for a sensitive value.

A value item also carries `writable` (this listener lets the viewer change it), `approval`, `timed` and
`span`; every item carries `size` (`{ w, h }`) when code gave one; a chart carries `stacked`, `lines` (`{ label, value? , from? }`) and `bins` when set. A group
carries `layout`. The schema carries `locale`, `messages` when replaced, and `stream: true` when the
listener streams.

## PanelState

What it is now.

```ts
{
  version: number; structure: number; now: number;
  values: WireValue[];
  series: Record<string, Sample[]>;
  feeds: Record<string, { entries: FeedEntry[]; dropped: number; total: number }>;
  feedSeq: number;
  pending: PendingChange[];
  activeProfiles: string[];
  marks: Record<string, Array<{ at: number; text: string }>>;
  actionStates: Record<string, { hidden?: boolean; disabled?: string }>;
}
```

A `WireValue` may also carry `status` (`"ok"`, `"warn"`, `"bad"`); while a timed change is in force,
`revertAt` and `revertTo` (`revertTo` absent when sensitive); `scheduled`, the changes waiting for their
time (`{ id, at, by, to? }`); `recent`, its timeline (`{ at, value, by? }`, oldest first); and `hidden:
true` or `disabled: "<reason>"` while a condition holds. `actionStates` lists only actions a condition
currently hides or disables.

**`FeedEntry`**: `{ seq, at, level: "info" | "warn" | "bad", text, fields? }`. `text` is capped at 1,000
characters; `fields` is present when the entry was pushed as fields and fits in 4 KB of JSON.

**`PendingChange`**: `{ id, kind?, target, label, to?, by, at, expiresAt, reason?, applyAt? }`; `kind` is
`"action"` or `"profile"` for those, absent for a value's.

**`ScheduledChange`**: `{ id, at, by, to?, reason?, repeat?, revertAfterMs? }`; `at` is the next run of a
repeating one. `PanelState.profileSchedules` lists them by profile id.

**`WireValue`**: `{ id, value, text?, textKey?, textParams?, error?, errorKey?, errorParams?, masked?, at, by?, version }`.
`value` is JSON; it is `null` with `text` set for a non-finite number or a value over 64 KB of JSON,
`null` with `masked: true` for a sensitive value, and `null` with `error` when reading it failed.
`error` is the English sentence, as it has always been; `errorKey` and `errorParams` are the same
sentence in parts (`readFailed`, `{ label, reason }`), so a page says the frame around the
application's own message in the viewer's language; `textKey` and `textParams` do the same for a note
the panel wrote about the value (`valueTooLarge`), and are absent where `text` is a number's own
spelling (`"NaN"`, `"Infinity"`).

**`Restriction`**: `{ text, key, params? }` — a sentence about what a listener does not allow: the
English, and the key that says it in the viewer's language.

**`Sample`**: `[t, y]` over time, `[t, y, x]` against another value. `t` is the start of the sample's
one-second bucket; a re-sent newest bucket has the same `t` and replaces the one held.

## Tables

`GET /api/tables/:id` answers `{ table: { rows, total, offset, limit } }`, each row
`{ id, cells: Record<column, JsonValue>, status?: Record<column, Status> }`.

## ChangeRecord

```ts
{
  id: number; kind: "edit" | "action" | "profile" | "revert" | "approval" | "scheduled" | "import";
  target: string; label: string; by: string; at: number;
  from?: JsonValue; to?: JsonValue; outcome?: string; ok: boolean; revertible?: boolean;
  origin?: string;    // the replica that made it, when it arrived from another
  reason?: string;    // why, in the words of whoever made it
  hash?: string; prevHash?: string;   // the tamper-evident chain; see operations/audit.md
}
```

`from` and `to` are absent for a sensitive value; for a profile they are records by value id; for an
action `to` holds the input it was given. `revertible` is computed when the list is read.

## Notice

```ts
{ id: string; level: "info" | "warning"; message: string; key?: string; params?: Record<string, string | number>; at: number }
```

`message` is English, as every caller has always been sent it. `key` and `params` are there when the
panel wrote the notice about its own machinery — a store that could not be written, a replica that
could not be reached, a getter that threw — so a page says it in the viewer's language; they are
absent for words the panel did not write itself, such as an alert's sentence, which reads the same
here, in the change log and in a webhook.

## Related

- [HTTP API](http-api.md) — where each shape is served.
