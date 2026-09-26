# On a path

`panel.handler()` in Express, Connect or `node:http`.

← [Serving overview](index.md)

---

```ts
import express from "express";
import { defaultPanel } from "@osqd/admin-panel-builder";

const app = express();
app.use("/admin", defaultPanel().handler({
  basePath: "/admin",
  auth: { check: (request) => sessionUser(request.headers.cookie)?.name ?? false },
  controls: { edit: true },
}));
```

```ts
import { createServer } from "node:http";

const panel = defaultPanel().handler({ basePath: "/admin", auth: { token: process.env.PANEL_TOKEN! } });
createServer((request, response) => {
  if (request.url?.startsWith("/admin")) return panel(request, response);
  app(request, response);
});
```

- **The prefix, with or without.** The router accepts `/admin/api/state` and `/api/state` alike, so it
  works whether or not the framework strips the mount path. Express's `originalUrl` is read when present.
- **A parsed body is used.** If `express.json()` ran first, the handler uses `request.body` instead of the
  spent stream.
- **It never rejects.** Every failure becomes a response; a failure to write one is reported on the
  panel's error channel. It never calls `next`: every path under the base belongs to the panel.
- **`auth.check` reuses your sessions.** Return the operator's name to admit them. An empty string, `false`,
  `undefined` or a throw is a refusal, so a lookup that fails closes the door.

Frameworks whose request and response extend Node's (Express, Connect, Polka, NestJS on Express) need
nothing more. Koa and Fastify have [adapters of their own](koa-fastify.md).

## Related

- [Who sees what](../examples.md#who-sees-what) and [Inside another application](../examples.md#inside-another-application) — full examples with two listeners and embedded pages.
- [Security](../operations/security.md) — why a panel should not be mounted in the application it reports on when that application is public.
