# On an edge runtime

`panel.fetchHandler()` for Workers, Deno, Bun and Fetch routers.

← [Serving overview](index.md)

---

```ts
const handle = panel.fetchHandler({
  basePath: "/admin",
  auth: { token: env.PANEL_TOKEN },
  controls: { edit: true },
  address: (request) => request.headers.get("cf-connecting-ip") ?? "",
});

export default { fetch: (request: Request) => handle(request) };
```

The same router as the Node handler, taking a `Request` and returning a `Response`. It uses only the
Fetch globals and Web Crypto.

**The client's address comes from the platform.** A Fetch runtime has no socket, so the auth throttle
keys on what `address` returns. Without it, every caller shares one bucket. Use the platform's own value
(Cloudflare sets `cf-connecting-ip` itself), never a forwarded header a client can write.

**State is per isolate.** A Worker may run many isolates; each holds its own values and history. A panel
on an edge runtime shows the isolate that answered.

## Related

- [Installation](../start/installation.md) — which entries load where.
