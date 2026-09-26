# Persistence

Remembering an operator's choices across restarts.

← [Operations](index.md)

---

```ts
import { createAdminPanel, fileStore } from "@osqd/admin-panel-builder";

const panel = createAdminPanel({ store: fileStore("data/panel.json") });
const gap = panel.modifiable(200, { id: "max-rating-gap", label: "Largest rating gap", min: 50, max: 1000, persist: true });
await panel.ready;                               // stored choices applied; never rejects
```

- **Only an operator's choice is stored.** What the code sets is the code's business, so a counter can
  never become a disk write per increment.
- **Restored through the same checks.** A stored value the declaration no longer accepts (the maximum
  was lowered) is refused with a notice, and the declared default kept.
- **A store failure costs the memory of a change, never the change.** A failed load leaves every value
  at its default and says so; a failed save leaves the change applied and says it will not survive a
  restart.
- **A stable name is required.** `persist` without an `id` or `label` is refused, because an id derived
  from the order of declaration would attach the stored value to a different setting when declarations
  move.

`fileStore` writes asynchronously (never `writeFileSync` inside your server), serialises writes, and
writes to a temporary file that is flushed to the disk and renamed over the real one, so a crash
mid-write — or a power cut — leaves the previous file rather than half a document. A write that fails
takes its temporary file with it.
`memoryStore` is for tests. A store of your own implements two methods:

```ts
interface ValueStore {
  load(): Promise<Record<string, JsonValue>>;
  save(id: string, value: JsonValue): Promise<void>;
}
```

Either may reject; the panel treats a rejection as "no answer".

## Related

- [Changes and notices](changes-and-notices.md) — where store failures are reported.
