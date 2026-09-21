# On a port

`panel.listen()`, loopback by default.

← [Serving overview](index.md)

---

```ts
const server = await panel.listen({
  port: 9780,                                    // the default
  host: "127.0.0.1",                             // the default
  auth: { tokens: { ada: process.env.ADA_TOKEN!, sam: process.env.SAM_TOKEN! } },
  controls: { edit: true, actions: true },
});
console.log(server.url);                         // http://127.0.0.1:9780/
await server.close();
```

- **Loopback unless told otherwise**, and any other address refuses to start without `auth`.
- **9780 by default**, clear of hackerpot's 9500 and 9501 and bothandlerjs's 9674, so all three
  dashboards can run on one machine without editing a port. `port: 0` takes a free one.
- **A loopback listener answers only to loopback names** in the `Host` header, which is what stops a page
  on another site from reaching it through DNS rebinding. Add names with `allowedHosts`.
- **Tokens by name.** With `tokens`, each operator's changes are recorded under their token's name.
  Open the page once as `…/?token=…`; the token is swapped for an HttpOnly cookie and the URL cleaned.

## Related

- [Security](../operations/security.md) — the full list of refusals.
