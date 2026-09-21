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

**Order.** Tabs by `order`, then by first mention. Within a tab, by each item's `order`, then values
before the group's own charts before actions, then by declaration.

**Moving is live.** A move changes the schema's structure number, and every open page redraws on its next
poll. A group left empty disappears from the page rather than showing an empty tab.

**Layout.** `group("Logs", { layout: "list" })` draws one card per row rather than a grid. A card's
`span` (1, 2, 3 or `"full"`) sets how many grid columns it takes; tables and shared charts take the
whole row by default, feeds two columns. On a narrow screen everything takes the whole row.

**Per viewer.** Each card can be collapsed and pinned; both are remembered in the viewer's own browser,
and pinned cards gather in a Pinned tab. A search box finds any card by its label or description.

**Groups are also what a listener shows.** `handler({ groups: ["Customers"] })` serves only that group:
the others are withheld on the server, not hidden on the page. See [security](../operations/security.md).

## Related

- [Charts](charts.md) — charts shared by a group.
- [BIS](../integration/bis.md) — two listeners showing different groups of one panel.
