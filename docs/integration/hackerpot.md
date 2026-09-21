# hackerpot

Hits by detector, and detector switches.

← [Serving overview](index.md)

---

Runnable: [`examples/hackerpot.ts`](../../examples/hackerpot.ts).

```ts
import { hackerpotPanel } from "@osqd/admin-panel-builder/presets";

const engine = new HoneypotEngine({ /* … */ });
const { enabled } = hackerpotPanel(panel, engine, detectorIds);
// the detectors consult `enabled[id]` on every request
```

- **A counter of hits with its rate, a feed of recent hits, and a table of sources** (address, hits, total
  score flagged past 50 and 100, last seen).
- **Hits by detector, over keys**, and the ten most probed paths. Paths are attacker-written text; the page
  shows them as text, and the preset keeps at most `MAX_TRACKED` (1,000) distinct paths and sources, because a map keyed by what an
  attacker sends must have a ceiling.
- **Detector switches** are `bind(enabled, id, { editable: true, confirm: true })` in a loop over the
  detector list, so a new detector gets a switch with no panel change.
- **Dark by default** (`colorScheme: "dark"`) and the OSQD theme, so it sits beside hackerpot's own
  dashboard as one product.

hackerpot's dashboard remains the place to read incidents; this panel is for the handful of numbers and
switches an operator wants beside the application.

## Related

- [Themes](../operations/themes.md) — the OSQD theme.
