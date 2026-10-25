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

## Who reads the result

What an action answers can be something only the operator who ran it should see: a password-reset link, a
one-time code, a customer's details. So by default the result and the input belong to that operator:

```ts
action("Reset link", ({ input }) => resetLink(input.user), { input: { user: {} } });              // "self", the default
action("Requeue mail", () => `requeued ${mail.requeue()} messages`, { visibility: "everyone" });
action("Rotate key", () => keys.rotate(), { visibility: "runners" });
```

- `"self"` — the operator who ran it; for an approved run, the one who proposed it and the one who approved.
- `"runners"` — every operator who may run actions in its group (`controls.actions` and their grants).
- `"everyone"` — every operator who sees its group, which is how every run was shown before there was a choice.

Everybody who sees the group still sees *that* it ran — who, when, and whether it worked — in Activity; the
others read "The result is shown only to whoever ran it." The filtering is done by the server, per
operator, in `/api/changes`: what is not yours to read is never sent. `createAdminPanel({ actionVisibility })`
sets the default for every action and row action that does not say. Code (`panel.changes()`, the `change`
event), the change log and its audit sinks keep the full record: they are the audit trail, not a screen
other operators read. A proposal waiting for approval shows its input to the operators who may decide it,
because deciding needs it.

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
  draws the button as destructive. `confirm: "type"` asks for the action's label to be typed before the
  button works, for what cannot be taken back. It is a page safeguard; a script calling the API is not
  asked.
- **Two people when it matters.** `approval: true` makes a run a proposal: the input and the reason are
  kept, a second operator approves, and the action runs then, with that input, attributed to both. The
  proposer cannot approve their own.
- **With a reason.** `reason: "required"` refuses a run that does not say why; otherwise the page offers
  an optional one. The function receives it as `reason`, and it is kept on the change record.

## Related

- [Changes and notices](../operations/changes-and-notices.md) — where runs are recorded.
- [HTTP API](../reference/http-api.md) — `POST /api/actions/:id`.
