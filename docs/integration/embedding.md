# Embedded as HTML

`panel.html()`, snapshots, and `<admin-panel>`.

← [Serving overview](index.md)

---

## A live fragment

```ts
app.use("/admin/panel", panel.handler({ basePath: "/admin/panel", auth, controls: { edit: true } }));

app.get("/admin", (request, response) => {
  response.send(renderAdminPage({ body: panel.html({ api: "/admin/panel" }) }));
});
```

The fragment is a `<link>` to `/admin/panel/panel.css`, an element the client mounts into, and a
`<script src>` for `/admin/panel/client.js`. It carries **no data**: the client asks the handler at `api`
for the schema and the state, so that handler's `auth`, `controls` and `groups` decide what the fragment
shows and allows. A host page with a CSP of `default-src 'self'` needs nothing more. The chart and table
code is a second script the client loads from the handler only when the panel draws charts or tables.

Several fragments can sit on one page. Render them with `script: false` and put one `clientScript({ api
})` on the page: it mounts every fragment. `group: "Games"` shows one group; `compact: true` shows only
the cards, without the heading, tabs and Activity — a card of one panel inside a page about something else:

```ts
panel.html({ api: "/admin/panel", script: false, group: "Games", compact: true }) + clientScript({ api: "/admin/panel" });
```

## A snapshot

```ts
const html = panel.html({ snapshot: true, nonce: response.locals.nonce });
const report = panel.html({ snapshot: true, document: true, groups: ["Revenue"] });
```

The values as they are now, inline, read-only, never updating: for a nightly report or a page generated
at build time. It inlines its stylesheet and script (with the chart and table code only when it draws
charts or tables), so a host CSP needs the `nonce`. `groups` limits what it contains.

`panel.html()` with neither `api` nor `snapshot` is refused: it would render and never change, which looks
live and is not.

## The custom element

```ts
import { defineAdminPanelElement } from "@osqd/admin-panel-builder/element";
defineAdminPanelElement();
```

```html
<admin-panel src="/admin/panel" scheme="dark"></admin-panel>
<admin-panel src="/admin/panel" group="Games" compact></admin-panel>
```

It draws into a shadow root and talks to the handler at `src`. `scheme` overrides the panel's colour
scheme; `group` and `compact` work as for a fragment. The entry is safe to import during a server render: the element class is created inside
`defineAdminPanelElement()`, which does nothing where there is no `customElements`.

**A shadow root is a styling boundary, not a security boundary.** Scripts on the host page can read
everything inside it. Embed a panel only in a page you would trust with what it shows.

## Related

- [Themes](../operations/themes.md) — the panel styles only itself; nothing leaks into the host page.
