# Counters, rates and percentiles

The numbers an operator most often wants, and most often gets wrong by hand.

← [Documentation](../index.md)

---

```ts
const requests = panel.counter("Requests", { group: "Traffic" });   // declares the total and its rate
requests.inc();                                                      // on the hot path: an addition

panel.rate("Messages per second", () => mailer.sentTotal);          // a total you already keep

const latency = panel.percentiles("Move latency", { unit: "ms" });   // p50, p95, p99, charted together
latency.record(elapsedMs);                                           // a store into a ring
```

**A counter only goes up.** `inc(by)` refuses a negative step; `reset()` starts again from zero. Its
rate is the increase over a sliding window (`windowMs`, default 10 seconds) per second or per minute,
computed once a second on the panel's timer and charted beside it.

**A drop is a reset, not a negative rate.** When a total falls — the process behind it restarted, or
somebody called `reset()` — the value after the drop is counted as the increase, the way Prometheus's
`rate()` reads a reset. A rate never shows a large negative spike for a restart.

**Percentiles are over the most recent observations**, `window` of them (default 1024), kept in a
fixed ring and sorted once a second when something new arrived. That is exact for the window and
costs a store per observation; the window is counted in observations, not in time, so a quiet period
keeps older observations in it.

A counter is exported as a Prometheus counter (`_count_total`) rather than a gauge when
[metrics](../operations/metrics.md) are on.

## Related

- [Charts](charts.md) · [Metrics](../operations/metrics.md)
