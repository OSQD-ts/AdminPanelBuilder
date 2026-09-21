# Your first panel

A value, a setting and a listener, and what each line does.

← [Documentation](../index.md)

---

```ts
import { action, defaultPanel, modifiable, viewable } from "@osqd/admin-panel-builder";

const requests = viewable(0, { label: "Requests handled", format: "integer", chart: true });
const rateLimit = modifiable(100, { label: "Rate limit", unit: "req/min", min: 1, max: 1000 });
const maintenance = modifiable(false, { label: "Maintenance mode", confirm: true });
action("Flush cache", () => { cache.clear(); return "Cache flushed."; });

const server = await defaultPanel().listen({
  auth: { token: process.env.PANEL_TOKEN! },
  controls: { edit: true, actions: true },
});
console.log(server.url);
```

**`viewable(0, …)`** declares a value on the default panel and returns a handle holding `0`. Write
`requests.value += 1` wherever a request is handled; the panel sees the write, and `chart: true` draws its
history beside it. The label becomes the id (`requests-handled`), which the API and the store use.

**`modifiable(100, …)`** declares a value an operator may change within `min` and `max`. The code reads
`rateLimit.value` where it needs the limit, so a change applies on the next read. The constraints hold for
code too: `rateLimit.set(5000)` throws the same sentence the page shows.

**`confirm: true`** makes the page ask for a second click on a button that says what it is about to do.

**`action(…)`** is a button that runs a function in the application. What it returns is shown to the
operator.

**`listen(…)`** serves the panel on `127.0.0.1:9780`. Editing and actions are off unless `controls` turns
them on, and turning them on requires `auth`. Open the printed URL with `?token=<your token>` once; the
token is exchanged for a cookie and removed from the address bar.

## Related

- [Values](../concepts/values.md) — every option a value takes.
- [Serving overview](../integration/index.md) — a path of your server, or a page you already have.
- [Security](../operations/security.md) — what `auth` and `controls` protect against.
