# Testing your panel

A manual clock, the router without a server, and asserting on the schema.

← [Documentation](../index.md)

---

```ts
import { createAdminPanel, ManualClock } from "@osqd/admin-panel-builder";

const clock = new ManualClock(0);
const panel = createAdminPanel({ clock });
const players = panel.viewable(0, { label: "Players", chart: true });

clock.advance(1000);
players.value = 5;

const [key] = Object.keys(panel.state().series);
expect(panel.state().series[key]).toEqual([[0, 0], [1000, 5]]);
```

- **Time is injected.** `ManualClock` only moves when told, so a chart's history, a timed sample
  (`panel.tick()`) and "changed 5 s ago" are ordinary assertions with no sleeping.
- **Ask the panel, not a page.** `panel.schema()` is what the page draws, `panel.state()` what it shows,
  `panel.edit(id, value, by, scope)` and `panel.run(id, by, scope)` what an operator does.
- **The router needs no server.** `createRouter(panel, options, { boundHost, where })` from
  `@osqd/admin-panel-builder/adapters` takes a plain request object and returns a status, headers and a
  body.
- **Or take the harness.** `@osqd/admin-panel-builder/testing` wires the three together:

  ```ts
  import { testPanel } from "@osqd/admin-panel-builder/testing";
  const { panel, clock, request, as, errors } = testPanel({ serve: { auth: { token: TOKEN }, controls: { edit: true } } });
  declareMyPanel(panel);
  expect((await request("POST", "/api/values/max-players", { value: 5000 }, as(TOKEN))).status).toBe(400);
  expect(errors).toEqual([]);   // nothing the panel isolated, like a throwing getter
  ```

- **Use `createAdminPanel()` in tests**, not the default panel, so each test starts empty.
- **Close what you open**: `panel.close()` stops the sampling timer, and a listener's `close()` its socket.

## Related

- [Trying it locally](try-it.md)
