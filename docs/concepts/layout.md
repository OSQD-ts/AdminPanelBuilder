# Layout

Sections, list cards, dividers and emphasis: a tab of forty values that still reads.

← [Documentation](../index.md)

---

A group is a tab, and every value in it is a card of its own. That is right for ten values and wrong
for forty: forty equal boxes, no headings, every reading as loud as the next, and a setting that is one
number taking the same room as a chart. Nothing below changes what a value is or how it is changed; it
changes where its card goes and how much room it takes.

```
before                                     after
┌────┬────┬────┬────┬────┬────┐            Right now — what the servers are doing
│ a  │ b  │ c  │ d  │ e  │ f  │            ┌──────────┬──────────┬──────────────────┐
├────┼────┼────┼────┼────┼────┤            │ PLAYERS  │ MATCHES  │ Move latency     │
│ g  │ h  │ i  │ j  │ k  │ l  │            │  1,243   │   87     │ p50  p95  p99    │
├────┼────┼────┼────┼────┼────┤            └──────────┴──────────┴──────────────────┘
│ m  │ n  │ o  │ p  │ q  │ r  │            ──────────── Machines ────────────
├────┼────┼────┼────┼────┼────┤            Matches — how games are made
│ …  thirty more, all alike   │            ┌ Rules ───────────────────────────────┐
                                           │ Max players  [10]   Warmup   [15]    │
                                           │ Min players   [2]   Overtime [60]    │
                                           └──────────────────────────────────────┘
                                           ▸ Limits        ▸ Health     (closed)
```

[`examples/layout.ts`](../../examples/layout.ts) is that tab, both ways.

## Sections

```ts
const server = panel.group("Server");
server.section("Right now", { description: "What the servers are doing this minute." });
server.section("Health", { collapsed: true, density: "compact" });

server.viewable(players, { label: "Players online", section: "Right now" });
server.viewable(dbStatus, { label: "Database", section: "Health" });
```

A section is a heading, a line about it, and its own grid of cards. Anything declared with
`section: name` is drawn in it — a value, an action, a table, a feed, a profile or a shared chart; what
names no section is drawn above the first one. `section(name, options)` only adds options, and may come
before or after the declarations; a section named only by `section:` on a value exists all the same.

| Option | Meaning |
| --- | --- |
| `title`, `description` | What the heading says (default: the name), and the line under it |
| `order` | Position in the group; lower first, then by first mention |
| `collapsed` | Closed when a viewer first sees it. Each viewer's opening and closing is kept in their browser, over this default |
| `collapsible` | `false` for a heading that cannot be closed; refused together with `collapsed: true` |
| `density` | `"compact"` or `"comfortable"`: the spacing inside it |
| `columns` | Its own grid's columns, over the group's |

The group decides how its sections are shown:

```ts
panel.group("Server", {
  sections: "tabs",   // one section at a time behind tabs of its own; "stack" (the default) is one under another
  outline: true,      // a row of links to the sections at the top; default from four sections up
  filter: true,       // a box narrowing the tab to what matches; default from 16 values up
  density: "compact", // the spacing of the whole tab
});
```

The filter matches a card's name and description and, for a row, its list card's name. It hides what
does not match, opens a closed section that has a match, and says so when nothing does. Sub-tabs move
with the arrow keys, Home and End.

## List cards

Many small settings are one card, not one card each:

```ts
server.card("Rules", { section: "Matches", layout: "columns:2", description: "From the next match." });
for (const [label, value] of rules) server.modifiable(value, { label, min: 0, max: 600, card: "Rules" });
```

Each value is a row — its name, its reading and, where it can be changed, its field — and is edited
where it is, with the same checks, confirmation, reasons, status colour and refusals as on a card of its
own. A row's own tools (history, pin) show on hover and focus.

| Option | Meaning |
| --- | --- |
| `layout` | `"list"` (the default), `"columns:2"`, `"columns:3"`, or `"grid"` for small tiles |
| `title`, `description` | What the card says |
| `span`, `size`, `emphasis` | As on any card |

Only values join a list card, at most `MAX_LIST_CARD_VALUES` (100). A card is in one section: a value
naming a card and a different section, or a card put in a section its values are not in, is refused at
startup. The card stands where its first value would.

## Dividers, spacers and breaks

```ts
server.viewable(players, { label: "Players online", section: "Right now" });
server.divider({ section: "Right now", label: "Machines" });
server.viewable(cpu, { label: "CPU", section: "Right now" });
server.spacer({ section: "Right now", size: "lg" });   // "sm", "md" (default) or "lg"
server.break({ section: "Health" });                  // the next card starts a row of its own
```

Each stands between the cards declared before and after it, in its section. A group with any of them
keeps the order its cards were declared in, rather than gathering them by kind, so that "before" and
"after" mean what they say. At most `MAX_LAYOUT_MARKS_PER_GROUP` (200) per group.

## Emphasis and width

`emphasis: "primary"` makes the number people open the tab for stand out: a coloured edge and a larger
reading. `"secondary"` quietens a card: no box, a smaller reading. Both work on any card or list card.

`span` names a width: `"quarter"`, `"third"`, `"half"`, `"two-thirds"`, `"three-quarters"` or
`"full"`, as well as the older 1, 2 and 3. A named span may take a card wider than its kind would
grow; `size: { w, h }` still sets cells exactly.

## Arranging and saved layouts

A tab drawn in parts is arranged one grid at a time: the first one on screen, its name beside the group
in the arranging bar. Saving keeps the other grids' order and sizes as they were, so a layout saved
before sections existed still applies to the cards it names. Cards a saved layout does not name go
where code put them.

## On a phone

Sections, their headings and list cards stack to one column; a list card's columns become one when the
card is narrower than about 30 characters' worth.

## In a configuration file

A configuration file sets the listener, not the declarations: values, groups and so their layout are in
code. See [configuration](../operations/configuration.md).

## Related

- [Groups](groups.md) — tabs, the grid of cells, sizes, ordering.
- [Using the page](the-page.md) — arranging, collapsing and pinning.
- [Examples](../examples.md#a-crowded-tab-made-readable) — the tab above, as code.
