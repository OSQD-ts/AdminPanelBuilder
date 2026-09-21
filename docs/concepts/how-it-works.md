# How it works

The panel, the router, the front ends, and what travels between them.

← [Documentation](../index.md)

---

```
  your code ──set()──▶ PanelValue ──▶ AdminPanel ──schema()/state()──▶ router ──▶ Node handler  ─▶ Express, node:http
                                        │  ▲                             │     ├─▶ listen()       ─▶ its own port
                                        │  └──edit()/run()───────────────┘     └─▶ fetchHandler() ─▶ Workers, Deno, Bun
                                        └──────────────── html() ────────────────▶ a fragment in your page
```

**The panel** (`AdminPanel`) is a registry: values, groups, charts and actions. It answers two questions
— what is there (`schema()`) and what it is now (`state()`) — and takes two kinds of fact: an edit with
who made it, and an action with who ran it. It never sees a request.

**The router** turns HTTP into those facts. It checks, in a fixed order, the auth throttle, the `Host`
header, that a write comes from the panel's own page, and the credentials; only then does it route. It
returns a status, headers and a body, and never writes to a socket.

**The front ends** translate. `panel.handler()` adapts Node's request and response, `panel.listen()` is
that handler on a server of its own, `panel.fetchHandler()` adapts `Request` and `Response`. Because the
rules live in the router, a request gets the same answer through all three.

**The page** is a bundled client that reads the schema and polls the state, every second by default.
With `?since=` it receives only values changed since its last answer, plus every live value; with
`?after=` only the chart samples it does not hold. When the schema's structure changes — a value declared,
a group moved — it fetches the schema again and redraws.

## What happens on `set()`

1. The value is stored (in its cell, or on the bound object).
2. For a modifiable value, the constraints and the validator run first; a refusal throws `ValueError`
   and nothing changes.
3. The panel's version counter moves, and the value records it.
4. Every history charting the value on change records a sample in the current one-second bucket,
   replacing an earlier sample in the same bucket.
5. Listeners registered with `value.on()` hear the change, each isolated from the others.

That is the whole cost on your application's hot path: a comparison, a counter, and a typed-array write
per chart.

## Related

- [Values](values.md) — the handle and its three sources.
- [HTTP API](../reference/http-api.md) — every route the router answers.
- [Design decisions](../design/decisions.md) — why polling, why one router.
