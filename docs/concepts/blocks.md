# Tables, feeds and profiles

The cards that are not a single value: rows, events, and several settings at once.

← [Documentation](../index.md)

---

## Tables

```ts
panel.table("Games in progress", {
  group: "Games",
  columns: ["id", "white", "black", { key: "moves", format: "integer", status: { warn: 150 } }, { key: "started", format: "timestamp" }],
  rows: () => [...games.values()],             // the panel sorts, searches and pages
  actions: [{ label: "Adjudicate draw", confirm: true, run: (id, { by }) => endGame(id, by) }],
});

panel.table("Queued mail", {
  columns: ["id", "to", "subject"],
  // For a set too big to hold: answer one page, as a query with LIMIT and OFFSET would.
  fetch: ({ offset, limit, sort, direction, search }) => db.queued({ offset, limit, sort, direction, search }),
});
```

- **`rows` or `fetch`, exactly one.** `rows` (an array, or a function returning one) is sorted,
  searched (case-insensitively, across every shown column) and paged by the panel. `fetch` is handed
  `{ offset, limit, sort, direction, search }` and answers `{ rows, total }`; the whole set never
  reaches the panel, let alone a browser.
- **Bounded.** A page is at most `MAX_PAGE_SIZE` rows whatever the page asks, a search at most
  `MAX_SEARCH_LENGTH` characters, and a source that does not answer within `timeoutMs` (default 10 s)
  fails with a sentence rather than holding the page.
- **Columns** are a key, or `{ key, label, format, unit, decimals, sortable, status }`. `sortable`
  defaults to true; the page cannot sort by a column that says false. `status` flags a numeric cell
  with a word and a colour, like a value's.
- **Row actions** get the row's id (the `rowId` property, default `"id"`) and the operator's name, are
  gated by `controls.actions` for the table's group, have a deadline, and are recorded as
  "End (Games: g12)".
- **The page refetches a table only when something changed** and only while its tab is showing: a
  `fetch` may be a database query, and a poll a second per viewer would be a query a second per viewer.

## Feeds

```ts
const bounces = panel.feed("Bounces", { capacity: 200, perSecond: 50 });
bounces.push("user@example.com: mailbox full");
bounces.push({ to: "user@example.com", code: 550 }, "warn");   // fields, shown as key=value
```

A bounded list, newest first. Two bounds for two floods: `capacity` entries are kept (the oldest
leaves, which is retention rather than loss), and `perSecond` are accepted (past it an entry is
dropped and counted, never queued). The page shows how many were dropped and why — a thinned feed
must never look like a quiet one. `level` is `"info"`, `"warn"` or `"bad"`, shown as a word as well as
a colour. Entries are text somebody may have written; the page shows them as text.

## Profiles

```ts
panel.profile("Tournament mode", [
  [featured, "classical"],
  [guests, false],
  [ratingGap, 100],
], { group: "Maintenance", description: "Classical featured, guests off, tight pairings." });
```

Several modifiable values set in one step:

- **Whole or not at all.** Every setting is checked before any is written; one refusal applies none.
- **Only where every value may be edited.** A listener that may edit some of the values but not all
  cannot apply the profile, and the button says so.
- **One change record** listing every value it set, from what to what.
- **In force** is shown while every setting still holds.
- **Refused at declaration**: a setting its value would refuse, a value that is not modifiable, and a
  value declared with `approval` — a profile would be a way around the second operator.
- The page asks for a second click by default (`confirm: false` turns it off).
- **For a while, later, or by a rule**, like a value: *For 1 h* reverts every value it set; **Later** applies
  it at a time or every day or week at one; the card lists what is scheduled, with Cancel.
- **`approval: true`** makes applying it a proposal a second operator approves; **`reason: "required"`**
  refuses an application that does not say why.
- **Undo** under Activity puts back every value it set, as one change, unless one has changed since.

## Related

- [Actions](actions.md) — buttons, and actions that ask for input.
- [Data shapes](../reference/data-shapes.md) — `TableSchema`, `FeedEntry`, `ProfileSchema`.
