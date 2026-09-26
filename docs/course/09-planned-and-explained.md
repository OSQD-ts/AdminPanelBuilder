# 9. Planned and explained

Changes for later and on a rule, reasons, conditions, and alerts.

← [The course](index.md)

---

The game server runs a tournament every Saturday and takes its database down for maintenance every
night. Until now an operator stayed up to flip the switch. Now the panel does it, says why, and wakes
somebody only when something is actually wrong.

```ts
export const maintenance = panel.modifiable(false, { label: "Maintenance mode", group: "Operations", persist: true });
export const mode = panel.modifiable("normal", { label: "Mode", group: "Operations", options: ["normal", "tournament"], reason: "required" });
export const workers = panel.modifiable(8, { label: "Tournament workers", group: "Operations", min: 1, max: 64, visibleWhen: () => mode.value === "tournament" });
export const maxPlayers = panel.modifiable(1000, { id: "max-players", label: "Max players", min: 10, max: 5000, persist: true, disabledWhen: () => (maintenance.value ? "maintenance is on" : false) });
panel.profile("Tournament night", [[mode, "tournament"], [maxPlayers, 5000]], { group: "Operations", approval: true });
export const queue = panel.viewable(() => matchmaker.queue.length, { label: "Queue", group: "Games", status: { warn: 200, bad: 1000 }, alert: { forMs: 60_000 } });
panel.on("alert", notifySink(pager).alert);
```

Run it and try each:

- **Later, and on a rule.** On *Maintenance mode*, open **Later**, pick tonight at 02:00, choose *Every
  day at that time*, and set *For 1 h*. The card now says when it next runs, in your time zone; the
  panel turns maintenance on at two every night and off at three, and each run is in Activity as
  "ada (repeating)". **Cancel** stops it. From a script: `apb set $PANEL maintenance-mode true --repeat
  "daily 02:00" --tz Europe/Warsaw --for 1h`.
- **Why.** *Mode* has `reason: "required"`: Apply is refused until the reason field says why, and the
  reason is kept with the change, in the change log and in every sink. Every other change can say why
  under **Why (optional)**.
- **Only when it means something.** Switch *Mode* to tournament and *Tournament workers* appears; back
  to normal and it is gone. Turn maintenance on and *Max players* says it cannot be changed right now,
  and why — the API refuses it with the same sentence.
- **A second pair of eyes for the big one.** *Tournament night* needs approval: applying it asks for a
  reason and becomes a proposal; somebody else approves it, and it is applied whole. Scheduled for
  Saturday 18:00 and approved on Friday, it waits for its time.
- **Woken for the right thing.** When the queue passes 1,000 and stays there for a minute, one alert
  goes to the pager. A queue flapping around 1,000 is one alert per ten minutes, not sixty.

An operator who changes their mind about last night's tournament profile has **Undo** on it in
Activity: every value it set goes back, as one change, unless something changed one of them since.

## Related

- [Changes and notices](../operations/changes-and-notices.md) · [Values: conditions](../concepts/values.md#conditions)
