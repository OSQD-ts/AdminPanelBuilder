# Groups

Grouping at declaration and after the fact, and what a group controls.

← [Documentation](../index.md)

---

Every value and action is in exactly one group, and each group is a tab on the page. Anything declared
without a group goes into `"General"` (or the panel's `defaultGroup`).

```ts
modifiable(10, { group: "red" });           // at declaration

const x = viewable(3);
group("red").add(x);                          // after the fact, from the panel
x.moveTo("blue");                             // or from the value

group("red", { title: "Matchmaking", description: "Who waits, and for how long.", order: 1 });

const matchmaking = group("Matchmaking");     // declare straight into a group
matchmaking.modifiable(200, { label: "Largest rating gap", min: 50, max: 1000 });
```

The handle has every declaration the panel has — `viewable`, `modifiable`, `bind`, `action`, `table`,
`feed`, `counter`, `rate`, `percentiles`, `profile` and `chart` — each with the group filled in.

**Order.** Tabs by `order`, then by first mention. Within a tab, by each item's `order`, then values
before the group's own charts before actions, then by declaration.

**Moving is live.** A move changes the schema's structure number, and every open page redraws on its next
poll. A group left empty disappears from the page rather than showing an empty tab.

**A grid of cells.** Each group is laid out in a grid: 12 columns across, rows 72 pixels tall, unless the
panel (`createAdminPanel({ grid: { columns, rowHeight } })`) or the group (`group("Games", { grid: {
columns: 8 } })`) says otherwise. Every card takes a number of cells, `size: { w, h }` — `w` columns and
`h` rows — on any value, chart, table, feed, action or profile:

```ts
panel.viewable(players, { label: "Players online", size: { w: 3, h: 2 } });   // a quarter of the width
panel.viewable(latency, { label: "Move latency", chart: true, size: { w: 6, h: 4 } });
panel.table("Games", { columns, rows, size: { w: 12, h: 6 } });
```

`h` is a minimum: a row grows when what a card shows needs more room, so a size never cuts anything off.
Without a size, a card gets one from what it shows: a number 3×2, an editable value 4×3, a value with its
chart 6×4, a table 12×5, a feed 6×5. The older `span` (1, 2, 3 or `"full"`) still works and becomes a
width of 3, 6, 9 or 12.

**Packed without holes.** The panel places the cards itself rather than leaving it to the browser.
Without a layout, it gathers related cards — single numbers, settings, charts, actions, tables and feeds,
each kind where it first appears, and cards whose names share their first words (*Server move time p50,
p95, p99*) side by side — then fills the grid from its lowest open stretch, so nothing can be left empty
under a card. Each kind has a preferred, smallest and largest size: a card is widened to use a stretch no
other card fits, lined up with its neighbour's bottom where its range allows, and at the end the cards on
the bottom edge grow so the dashboard ends square. Nothing grows past its largest size, and a size set in
code, or chosen while arranging, is kept exactly.

A card shows as much as fits the room it is given, and the panel measures what it holds to decide.
Small (brief), it shows its name and reading and leaves out what is only read — description, badges,
history, a chart's legend and axis — but never a control: every field and button a card offers stays.
Large (full), it shows everything, with the low, average and high of a charted value. In between, its
description is cut to three lines. Padding and spacing follow the same three levels.

Room to spare goes to what can use it: a chart's line or bars grow into it, a table or a feed shows
more. A card holding a reading alone centres it and lets the number grow. An editor or a button is
left where it is rather than stretched, and a gauge or a button is given no more rows than it holds.

A card with more room than it needs uses it rather than leaving it under what it holds: a chart's
line fills the card, bars are drawn heavier and spread over the height, and a table's or a feed's box
grows into room for more rows. A card that holds none of those is read corner to corner — what is
read at the top, with a number that grows into the space, and what is done with it at the foot. Past
a few rows to spare, corner to corner would be a hole through the middle, so the card keeps what it
holds together at the top instead.

A reading is drawn to the room its card has, in steps, not only to the card's width, and where the
card holds nothing else, what it says about the number sits at the foot of it. A reading that is
words rather than a figure — a choice named in a phrase, a line of text — is set at a size meant for
reading, and one that is not set at all shows a dash. The widths a card lays itself out by are read
in em, so a card at twice the text size lays out as the narrow card it is. A table's or a feed's
rows are what takes the room: given less than they need they scroll, and the pager stays in view.

A chart too small to read is not drawn at all: where a card cannot hold the drawing even after
dropping what it need not show, the card says what it can in numbers and words, and the numbers
behind the chart stay one press away. It is drawn again as soon as the card has the room back.

Anything opened on a card is held by the card, so that nothing on the page moves while it is being
read. The room comes, in this order, from what the card has spare; from the drawing the numbers can
stand in for — *Show as a table* is a change of view, and the chart is back when it is closed; and
from what the card need not show meanwhile, its description and what it says about its reading. What
is left over scrolls inside the card, and the card's body takes the keyboard so it can be scrolled
without a pointer.

Once the cards have settled, a card whose content grows — the numbers behind a chart opened, a longer
reading — takes the rows it needs and the cards under it move down; every card keeps the column and
the width it had, so nothing rearranges itself under the hand.

On a phone, where the grid gives in to a single column, a card is as tall as what it holds: there is
nothing beside it for it to stretch, so nothing is cut off.

A card given less room than what it holds needs — because a size was set in code or chosen on the page
— shows one level less and then scrolls inside itself: a row is exactly its height, so no card can
stretch a row and every card beside it. A card with room to spare centres its reading and lets the
number grow when that is all it holds, and spreads what it holds over the room when there is more.

**Narrower screens.** The grid follows its own width, not the window's. Below 900 pixels a 12-column grid
has four columns (a third, so quarters and halves stay whole), below 560 one, and every width is scaled
to them. `group("Logs", { layout: "list" })` draws one card per row whatever the width.

**Arranging on the page.** *Arrange*, the button in the header, arranges the tab that is open (it is
pressed while you arrange, and pressing it again stops): pick a card up anywhere and drop
it where it belongs — a placeholder shows the place, and the other cards make room as it moves — or drag
its corner to resize it in whole cells; Escape puts a dragged card back, and Escape with nothing in hand
leaves arranging and puts back what was there, as *Cancel* does. Opening another tab leaves it the same
way. The buttons on each card do the
same from the keyboard, and a finger drags by the handle, so the page still scrolls. Only what you change
is kept: the other cards go on filling the space around it.
*Save for me* keeps the layout in that viewer's browser. *Save for everybody* — offered where the viewer
may edit — stores it on the panel (in its `store`, when it has one, so it outlives a restart), records it
in the change log and carries it to replicas; `POST /api/layout` and `client.saveLayout()` do the same.
A viewer's own layout wins over the one for everybody, which wins over the sizes in code; each can be put
back.

**Per viewer.** Each card can be collapsed and pinned; both are remembered in the viewer's own browser,
and pinned cards gather in a Pinned tab. A collapsed card is its heading and nothing else — whatever size
it was given — and the cards below it come up into the room it leaves. A search box finds any card by its label or description.

**Groups are also what a listener shows.** `handler({ groups: ["Customers"] })` serves only that group:
the others are withheld on the server, not hidden on the page. See [security](../operations/security.md).

## Related

- [Charts](charts.md) — charts shared by a group.
- [Who sees what](../examples.md#who-sees-what) — two listeners showing different groups of one panel.
