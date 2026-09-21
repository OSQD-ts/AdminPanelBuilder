# Charts

Alone or shared, over time, over keys or against another value, and what a history costs.

← [Documentation](../index.md)

---

```ts
viewable(0, { label: "Players", chart: true });                          // a line over time, beside the value
viewable(0, { label: "Queue", chart: "area" });                         // another kind over time
viewable({ blitz: 3, rapid: 1 }, { label: "Waiting", chart: { over: "keys" } });   // one bar per key
viewable(0, { label: "Latency", chart: { over: players } });             // against another value
viewable(0, { label: "Sent", chart: { in: "Throughput" } });            // shared by the group
viewable(0, { label: "Bounced", chart: { in: "Throughput" } });         // …drawn on the same chart
modifiable(50, { label: "Send rate", max: 500, chart: "gauge" });        // how full, against max

chart({ title: "Load", series: [players, games], kind: "area", group: "Games" });   // declared explicitly
```

## Alone or in the group

A value's chart is drawn beside it, in its card. `in: "Title"` instead puts the value on a chart shared
by its group, created the first time a title is named; every value naming the same title in the same
group is another series on it. `chart({ … })` declares a shared chart over values that already exist.

## What is on the horizontal axis

| `over` | Draws | History |
| --- | --- | --- |
| `"time"` (default) | the value's samples over time | yes |
| `"keys"` | the entries of the current value: a record's keys, an array's items, `[label, n]` pairs, or `{ label, value }` objects | none |
| another numeric value | this value against that one, as points | yes, sampled together |

## Kinds

`line`, `area`, `step` (holds each value until the next, the honest drawing of a setting), `bar`,
`sparkline` (a small line without axes), `gauge` (how full, against `max`), `histogram` (the numbers
in an array, binned — `bins`, or Sturges' rule) and `heatmap` (a record of records: rows of columns,
drawn as a shaded table with every number in it). Every chart has a legend naming each series with its
latest value, a table view of its samples, and a sentence for screen readers: colour is never the only
signal.

## Stacking, lines and marks

```ts
panel.chart({ title: "Sent by provider", series: [ses, postmark, smtp], kind: "area", stacked: true,
  lines: [{ value: sendRate, label: "Send rate limit" }, { value: 400, label: "Contract" }] });
```

- **`stacked`** draws the series of a shared area or bar chart on top of each other, for shares of a
  whole. Refused anywhere else.
- **`lines`** are horizontal lines across a chart over time: a fixed number, or another value's current
  reading, so a limit an operator changes moves on the chart of what it limits.
- **Marks.** Every operator change to a charted value, or to a line's value, is marked on the chart at
  the moment it happened, with who made it. `annotate: false` turns that off.

## Pausing, zooming, exporting

A chart over time has a toolbar: **Pause** holds what it shows while it keeps collecting; a range
select narrows it to the last minute, five, fifteen or an hour; **dragging across it** zooms into that
stretch, and **Show everything** undoes it; **Download CSV** saves every sample (a cell a spreadsheet
would run as a formula is defused). The drawing is downsampled to about 600 points (largest triangle
three buckets, which keeps the peaks); the table and the CSV carry every sample.

## Sampling

A value with its own cell is sampled when it changes, into one-second buckets: the newest write in a
bucket wins, so a counter written ten thousand times a second costs one slot a second. A value read from
a function or a bound property cannot announce a change, so it is sampled every second by the panel's own
timer (unref'd, so it never keeps a process alive). `sampleEveryMs` samples any value on a timer instead.

## What a history costs

A sample is 16 bytes (24 against another value), in typed arrays allocated once. The default 300 samples
— five minutes of one-second buckets — cost 4.7 KB per charted value; the most a chart may keep,
10,000, costs 160 KB. See [limits](../reference/limits.md).

## Refused at declaration

A string over time, a number over keys, a histogram or heatmap over time, stacking outside a shared
area or bar chart, a line on a chart that is not over time, a gauge with no maximum, a ninth series (there are eight colour
slots), more than 10,000 points, sampling faster than every 250 ms, and a chart of a sensitive value —
a chart of a secret is the secret.

## Related

- [Themes](../operations/themes.md) — the eight chart colours.
- [Data shapes](../reference/data-shapes.md) — `ChartSchema` and `Sample`.
