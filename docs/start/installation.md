# Installation

The package, its entries, and what each needs from your runtime.

← [Documentation](../index.md)

---

```bash
npm install @osqd/admin-panel-builder
```

Node 20 or later. No runtime dependencies.

## Entries

| Import | What it is | Needs |
| --- | --- | --- |
| `@osqd/admin-panel-builder` | The panel, `viewable`/`modifiable`/`bind`/`action`, themes, stores, the clock | Nothing beyond Web Crypto and `setInterval`; loads on any runtime |
| `@osqd/admin-panel-builder/adapters` | `createPanelHandler`, `listenPanel`, `createFetchHandler`, the router | `listenPanel` imports `node:http` when called |
| `@osqd/admin-panel-builder/themes` | The themes alone, and `themeStylesheet` | Nothing |
| `@osqd/admin-panel-builder/element` | `<admin-panel>` | A browser; safe to import during a server render, where it does nothing |

The root entry never imports a Node module at load time. `fileStore` imports `node:fs` the first time it
is used and `panel.listen()` imports `node:http` when called, so an application that uses neither can run
the panel on a Worker.

## Related

- [Your first panel](first-panel.md) — what to write next.
- [On an edge runtime](../integration/fetch.md) — the Fetch handler.
