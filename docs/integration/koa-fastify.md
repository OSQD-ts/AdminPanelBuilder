# Koa and Fastify

The panel in a Koa or Fastify application.

← [Serving overview](index.md)

---

```ts
import { koaPanel } from "@osqd/admin-panel-builder/adapters";
app.use(koaPanel(panel, { basePath: "/admin", auth, controls: { edit: true } }));
```

```ts
import { fastifyPanel } from "@osqd/admin-panel-builder/adapters";
const handler = fastifyPanel(panel, { basePath: "/admin", auth, controls: { edit: true } });
fastify.all("/admin", handler);
fastify.all("/admin/*", handler);
```

Both are thin wrappers over the Node handler, so they share its behaviour exactly: the same router, the
same refusals, streaming included. Koa's middleware answers paths under the base and calls `next()` for
everything else; Fastify's handler hijacks the reply and answers on the raw response. A body the
framework already parsed (`koa-bodyparser`, Fastify's JSON parser) is handed on, since the stream is
spent.

Neither framework is imported: each adapter describes the objects it needs (`KoaLikeContext`,
`FastifyLikeRequest`, `FastifyLikeReply`) and the tests drive them with doubles of exactly those shapes.

## Related

- [On a path](mounting.md) — Express, Connect and `node:http`.
