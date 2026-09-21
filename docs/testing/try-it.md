# Trying it locally

The demo, the examples, and the simulator.

← [Documentation](../index.md)

---

```bash
npm run demo       # :9780 ch3ss on its own port · :9781 a host application with anymail at /admin
npm run simulate   # in another terminal: edits accepted and refused, an action, a forged write
npm run example    # the smallest panel, on :9780
npx tsx examples/bis.ts   # a panel inside an application with its own users, on :9785
npm run playground  # every theme in both schemes, contrast measured, on :9786
npm run bench       # what each write-path call costs here; npm run bench:guard is the ratchet
```

The demo prints the URLs, token included. On :9781 the same panel is shown three ways: its own page at
`/admin/`, embedded as a live fragment at `/embedded`, and as a snapshot at `/snapshot`.

## Related

- [Recipes](../integration/index.md) — what each example shows.
