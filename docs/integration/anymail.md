# anymail

Queues, providers and limits for a mail service.

← [Serving overview](index.md)

---

Runnable: [`examples/anymail.ts`](../../examples/anymail.ts). The demo embeds it three ways on port 9781.

| Group | What | How it is declared |
| --- | --- | --- |
| Queue | Queued messages | `viewable(() => queue.length, { chart: { kind: "area", sampleEveryMs: 1000 } })` |
| Queue | Sent and bounced per second | two viewables on a shared `Throughput` chart |
| Queue | Bounce rate | `format: "percent"`, a sparkline |
| Queue | Retry failed, purge the queue | actions; purge is `destructive` |
| Limits | Send rate, retries, default provider | `bind(config, …, { editable: true, … })` |
| Providers | One switch per provider | `bind(config.providers, name, { editable: true, confirm: true })` in a loop |
| Providers | SMTP password | `modifiable("", { sensitive: true })` |

**`bind` keeps the service's own configuration the source of truth.** The sender reads
`config.sendRatePerSecond` on every message, as it did before the panel; an operator's change lands in
that object, so it applies to the next message with no glue code. The send rate also draws as a gauge
against its declared maximum.

**The password is never sent to a browser**, not in the state, not in the change history, and replacing
it needs a second operator's approval. An operator can replace it and cannot read it back.

It also shows **throughput stacked by provider** with the configured send rate drawn across it, a
**table of the queue** answered one page at a time through `fetch` (the way a database query would), a
**feed of bounces**, a **counter** of messages sent, **provider latency percentiles**, and an
"Incident: SES degraded" **profile** that moves traffic to Postmark and slows sending in one step.

## Related

- [Values](../concepts/values.md) — the three sources.
- [Embedded as HTML](embedding.md)
