# Another process's panel

Serve, here, the panel a worker or another replica runs there.

← [Serving overview](index.md)

---

```ts
// On the worker: its own panel, with a token the gateway may use on behalf of operators.
await workerPanel.listen({
  host: "10.0.0.7",
  auth: { tokens: { gateway: process.env.GATEWAY_TOKEN! }, delegates: ["gateway"] },
  controls: { edit: true },
});

// On the operator-facing server:
import { remotePanelHandler } from "@osqd/admin-panel-builder/adapters";
app.use("/workers/mailer", remotePanelHandler({
  upstream: "http://10.0.0.7:9780",
  token: process.env.GATEWAY_TOKEN!,
  basePath: "/workers/mailer",
  auth: { check: (request) => sessionUser(request)?.name ?? false },
  controls: { edit: true },
}));
```

- **The page is rendered here** from the worker's schema and state, and every API call is forwarded with
  the worker's token. The token stays on this server; the browser never sees it.
- **This listener can only narrow.** Its own `auth` runs first, and its `controls` switch off editing or
  actions the worker would allow; it can never allow what the worker does not.
- **Who did it.** The operator's name travels in `x-apb-on-behalf-of`. The worker believes that header
  only from a token it lists in `auth.delegates`, and records the change as "ada via gateway". From any
  other token the header is ignored.
- **Some groups only.** `groups: ["Mail"]` filters the worker's schema, state, stream, changes and
  settings here, before anything reaches a browser, and refuses a write to anything outside those groups
  without forwarding it. What each operator may see is cached by the upstream's structure number, so a
  poll costs one upstream request.
- **Live.** The worker's stream is forwarded frame by frame, filtered the same way, and resumes where it
  was after a reconnect. `stream: false` makes the page poll instead.
- **One remote panel shows one process.** Nothing is aggregated across replicas, and the header names the
  process shown. For every replica at a glance, see the [fleet page](../operations/replicas.md#one-page-for-the-fleet).

## Related

- [Security](../operations/security.md#delegated-tokens)
