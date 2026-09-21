# Values

`viewable`, `modifiable`, `bind`: handles, sources, kinds and constraints.

← [Documentation](../index.md)

---

## The handle

```ts
const players = viewable(10, "Players online");
players.value += 1;          // write
players.set(12);             // write
players.update((n) => n + 1);
players.value;               // read
`${players} online`;         // "13 online": converts where JavaScript asks for a string
```

A declaration returns a `PanelValue`, because a primitive cannot be observed: `const x = 10` copies the
number and nothing can see `x` change. Writes go through `.value`, `set()` or `update()`, which is the
moment the panel needs to hear about. In TypeScript, read through `.value` too; plain JavaScript and
template strings convert the handle to its value.

## Three sources

| Declaration | Source | Announces changes | Editable |
| --- | --- | --- | --- |
| `viewable(10)` | its own cell | yes | no |
| `modifiable(10, { … })` | its own cell | yes | yes |
| `viewable(() => queue.length)` | a function, read on every look | no: charted on a timer | no |
| `bind(config, "maxPlayers", { editable: true })` | a property of your object | no: charted on a timer | when `editable` |

`bind` is the way into an existing codebase: the object stays the source of truth, so code that reads
`config.maxPlayers` sees an operator's change at once, and nothing else has to change.

## Kinds

Inferred from the starting value, or set with `kind`:

| Kind | From | Edited with |
| --- | --- | --- |
| `number` | a number | a number field, plus a slider when both `min` and `max` are set |
| `string` | a string | a text field, or a text area with `multiline` |
| `boolean` | a boolean | a switch that applies on click |
| `enum` | anything with `options` | a select |
| `json` | anything else | a JSON text area |

## Options

| Option | For | Meaning |
| --- | --- | --- |
| `id` | all | Stable id. Default: from the label, or `value-<n>` by order of declaration |
| `label`, `description` | all | What the page says. A string as the second argument is the label |
| `group`, `order` | all | See [groups](groups.md) |
| `unit`, `format`, `decimals` | all | How a number is written; `format` is `plain`, `integer`, `percent` (a fraction), `bytes`, `duration` (ms) or `timestamp` |
| `chart` | all | See [charts](charts.md) |
| `sensitive` | all | Never sent to a browser; a modifiable one can be replaced but not read back |
| `status` | all | `{ warn, bad, below? }` or a function: the value is flagged with a word and a colour past a threshold |
| `alert` | all | `{ at?: "warn" \| "bad", forMs?, cooldownMs? }`: say so, once, when the status reaches that level and holds; see [alerts](../operations/changes-and-notices.md#alerts). Needs `status` |
| `visibleWhen` | all | `() => boolean`: the card is hidden while it answers false, and an edit is refused |
| `disabledWhen` | all | `() => reason or false`: shown, but not changeable, with the reason beside the controls |
| `timeline` | all | Recent changes kept to show beside the card: default 20 for text, choices and switches, 0 for numbers (which get a chart), never for sensitive values |
| `span` | all | Grid columns the card takes: 1, 2, 3 or `"full"` |
| `min`, `max` | all | Range; for a viewable, only the scale of a gauge |
| `step`, `integer` | modifiable | Accepted numbers are `min + k × step`; whole numbers only |
| `options` | modifiable | The accepted values |
| `maxLength`, `pattern`, `multiline` | modifiable | Text constraints. `maxLength` defaults to 10,000; `g` and `y` are dropped from a pattern |
| `validate` | modifiable | `(next) => sentence or undefined`, after the declared constraints |
| `validateAsync`, `validateTimeoutMs` | modifiable | `async (next) => sentence or undefined`: a check that needs I/O (is this name taken?). Listeners run it before the edit, within `validateTimeoutMs` (default 5 s; past it the edit is refused); `panel.edit()` from code does not, so code calling it runs `panel.checkAsync()` first |
| `onChange` | modifiable | Called after an operator's change, isolated from the request |
| `persist` | modifiable | See [persistence](../operations/persistence.md) |
| `confirm` | modifiable | The page asks for a second click |
| `approval` | modifiable | A change is a proposal until a second operator approves it; see [changes](../operations/changes-and-notices.md#approvals) |
| `timed` | modifiable | Offer "for a while" on the page; the change reverts itself. Default true |
| `editable` | bind | Offer the bound property for editing |

## Thresholds

```ts
viewable(queue.length, { label: "Queue", status: { warn: 100, bad: 1000 } });
viewable(freeDiskGb, { label: "Free disk", status: { warn: 20, bad: 5, below: true } });
viewable(link, { label: "Link", status: (state: string) => (state === "down" ? "bad" : "ok") });
```

The page shows the word — OK, Warning, Bad — beside the value and colours the card's edge; colour is
never the only signal. A rule that could never read as declared (warning above bad on a rising scale,
neither threshold given) is refused. A function that throws means no status, never a failed update.

## Conditions

```ts
const mode = modifiable("simple", { label: "Mode", options: ["simple", "advanced"] });
modifiable(8, { label: "Workers", visibleWhen: () => mode.value === "advanced" });
modifiable(100, { label: "Batch size", disabledWhen: () => (maintenance.value ? "maintenance is on" : false) });
action("Deploy", deploy, { disabledWhen: () => (deploying ? "a deploy is running" : false) });
```

A setting that does nothing in the current mode says so instead of looking live. Conditions are asked
on every update and apply on the server as well as the page: an edit to a hidden or disabled value, or a
run of a disabled action, is refused with the reason. A condition that throws hides and disables
nothing — a bug in one must not lock an operator out.

## What is refused at declaration

A declaration that cannot do what it appears to promise throws `AdminPanelConfigError` on the line that
declared it:

- an option nothing reads (`maximum`, `presist`), with a suggestion;
- a minimum above the maximum, a step that is not positive, an empty or duplicated list of options;
- a starting value its own constraints refuse, which would be refused the first time anybody pressed
  Apply without changing it;
- numeric constraints on a string, text constraints on a number;
- two values with one id;
- `persist` without a store, or without an id or label to store it under;
- a function passed to `modifiable`, which has nowhere to put a new value.

A viewable shows whatever it is given: refusing to display something is worse than displaying it oddly.
A modifiable's constraints hold for code as well as for operators.

## Related

- [Groups](groups.md) · [Charts](charts.md) · [Actions](actions.md)
- [Data shapes](../reference/data-shapes.md) — how a value travels.
