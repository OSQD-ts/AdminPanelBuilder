# Serving a panel

The three ways to serve a panel and when each fits.

← [Documentation](../index.md)

---

| | Call | Fits |
| --- | --- | --- |
| [On a path](mounting.md) | `panel.handler({ basePath, auth, controls })` | An application with a server already, especially one with its own sign-in |
| [On a port](own-port.md) | `await panel.listen({ port, auth, controls })` | A worker or a service without HTTP, or keeping the panel off the public server |
| [Embedded as HTML](embedding.md) | `panel.html({ api })`, `panel.html({ snapshot: true })`, `<admin-panel src>` | An admin page you already have; a report |
| [On an edge runtime](fetch.md) | `panel.fetchHandler({ … })` | Workers, Deno, Bun, Hono, a Next.js route handler |
| [Koa and Fastify](koa-fastify.md) | `koaPanel(panel, …)`, `fastifyPanel(panel, …)` | Those frameworks, sharing the Node handler's behaviour |
| [Another process](remote.md) | `remotePanelHandler({ upstream, token, … })` | A worker's panel shown from the operator-facing server |
| [Other frameworks](frameworks.md) | recipes | Hono, Next.js, NestJS, React, Vue |
| [The command line](cli.md) | `apb get/set/run/apply/changes` | Scripts and deploys |

**Live updates.** Every listener offers a stream of server-sent events at `/api/stream` (`stream: false`
turns it off; `{ maxViewers, framesPerSecond }` bounds it). The page uses it when it can and polls when
it cannot — a proxy that buffers, a stream that fails before its first frame, more viewers than the
limit. A frame is the same delta a poll fetches, so the page cannot tell them apart except in how
quickly changes arrive.

One panel can be served several ways at once, each with its own `auth`, `controls` and `groups`: a
read-only listener for support beside an editing one for administrators is two calls, not a role model.

## Related

- [Security](../operations/security.md) — what each option protects.
- [HTTP API](../reference/http-api.md) — what every front end answers.
