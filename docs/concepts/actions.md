# Actions

Buttons that run code in the application, with deadlines and attribution.

← [Documentation](../index.md)

---

```ts
action("Flush cache", () => {
  cache.clear();
  return "Cache flushed.";                      // shown to the operator
}, { group: "Maintenance" });

action("Purge the queue", () => queue.purge(), { destructive: true, description: "Deletes without sending." });

action("Rebuild index", async ({ by, signal }) => {
  await rebuild({ signal });                    // honour the signal and a timed-out run can stop
  return `Rebuilt for ${by}.`;
}, { timeoutMs: 120_000 });
```

## Asking for input

```ts
action("Ban player", ({ input, by }) => bans.add(input.player, input.days, by), {
  destructive: true,
  input: {
    player: { maxLength: 40, pattern: /^[a-z0-9_]+$/ },
    days: { kind: "number", min: 1, max: 365, integer: true, default: 7 },
    reason: { optional: true, maxLength: 200 },
  },
});
```

Each field is checked the way a modifiable value is — the same kinds, constraints and sentences — before
the action runs; an unknown field, a missing required one, or a value outside its field is refused and
the action never sees it. A default the field itself refuses is refused at declaration. What was entered
is recorded with the run.

## Rules

- **Usable only where granted.** A listener shows actions disabled unless `controls: { actions: true }`,
  which requires `auth`.
- **Attributed.** The function receives `by`, the operator's name, and every run is recorded under
  Activity with what it returned or why it failed.
- **Deadlined.** After `timeoutMs` (default 30 seconds) the operator's request is answered with a failure
  and `signal` is aborted. JavaScript cannot cancel the function; a late result is ignored.
- **Never rejects into the request.** A throw or a rejection becomes a sentence for the operator and a
  report on the panel's error channel.
- **Confirmed when asked.** `confirm: true` asks for a second click; `destructive: true` implies it and
  draws the button as destructive.

## Related

- [Changes and notices](../operations/changes-and-notices.md) — where runs are recorded.
- [HTTP API](../reference/http-api.md) — `POST /api/actions/:id`.
