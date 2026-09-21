# BIS

A panel inside an application that already has users.

← [Serving overview](index.md)

---

Runnable: [`examples/bis.ts`](../../examples/bis.ts). Open `http://127.0.0.1:9785/`, sign in as either
user, and follow the links.

BIS was not available when this was written. The example assumes a typical business system — users,
tickets, invoices — behind its own session sign-in, and the wiring is the point:

```ts
const admin = panel.handler({
  basePath: "/admin/panel",
  auth: { check: (request) => (userOf(request.headers.cookie)?.role === "admin" ? userOf(request.headers.cookie)!.name : false) },
  controls: { edit: true, actions: true },
});
const support = panel.handler({
  basePath: "/support/panel",
  auth: { check: (request) => userOf(request.headers.cookie)?.name ?? false },
  groups: ["Customers"],
});
```

- **No second user list.** `auth.check` asks BIS who is signed in; the returned name is who each change is
  recorded under.
- **Two listeners, not roles.** Administrators get every group and may change things. Support gets the
  Customers group and may change nothing. The Finance group never leaves the process for a support
  session: it is absent from the schema, the state and the API.
- **Embedded in BIS's own admin page** with `panel.html({ api: "/admin/panel" })`, under BIS's CSP of
  `default-src 'self'`.

## Related

- [Security](../operations/security.md) · [Embedded as HTML](embedding.md) · [Groups](../concepts/groups.md)
