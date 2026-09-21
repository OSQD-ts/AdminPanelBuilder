# Other frameworks

Hono, Next.js, NestJS, React and Vue.

← [Serving overview](index.md)

---

## Hono

```ts
const handle = panel.fetchHandler({ basePath: "/admin", auth, controls: { edit: true } });
app.all("/admin", (c) => handle(c.req.raw));
app.all("/admin/*", (c) => handle(c.req.raw));
```

Runnable and tested: [`examples/hono.ts`](../../examples/hono.ts).

## Next.js (app router)

```ts
// app/admin/[[...path]]/route.ts
import { panel } from "@/lib/panel";
const handle = panel.fetchHandler({ basePath: "/admin", auth: { session: { secret: process.env.PANEL_SECRET! } } });
export const GET = handle;
export const POST = handle;
export const dynamic = "force-dynamic";   // never cache a panel
```

Keep the panel in a module of your own so every route shares it. Runnable and tested:
[`examples/next-route.ts`](../../examples/next-route.ts).

## NestJS

NestJS on Express is Express: mount the Node handler in `main.ts` before `app.listen()`.

```ts
const app = await NestFactory.create(AppModule);
app.use("/admin", panel.handler({ basePath: "/admin", auth, controls: { edit: true } }));
```

On the Fastify platform, use [`fastifyPanel`](koa-fastify.md) with `app.getHttpAdapter().getInstance()`.

## React and Vue

```ts
import * as React from "react";
import { createAdminPanelComponent } from "@osqd/admin-panel-builder/react";
export const AdminPanel = createAdminPanelComponent(React);
// <AdminPanel src="/admin" scheme="dark" />
```

```ts
import * as Vue from "vue";
import { createAdminPanelVueComponent } from "@osqd/admin-panel-builder/vue";
export const AdminPanel = createAdminPanelVueComponent(Vue);
// compilerOptions.isCustomElement: (tag) => tag === "admin-panel"
```

You hand in your React or Vue; the package imports neither, so there is never a second copy or a version
to disagree about. Both render [`<admin-panel>`](embedding.md#the-custom-element) and define it on first
mount, which keeps them safe in a server render.

## Related

- [On an edge runtime](fetch.md) · [Embedded as HTML](embedding.md)
