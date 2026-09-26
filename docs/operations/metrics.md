# Metrics

The panel's numbers in Prometheus, from the same declarations.

← [Operations](index.md)

---

```ts
await panel.listen({ auth: { token }, metrics: { prefix: "ch3ss" } });
```

```text
# TYPE ch3ss_value gauge
ch3ss_value{id="players-online",label="Players online",group="Games"} 1018
# TYPE ch3ss_count_total counter
ch3ss_count_total{id="games-started",label="Games started",group="Games"} 5210
# TYPE ch3ss_changes_total counter
ch3ss_changes_total{kind="edit",ok="true"} 12
# TYPE ch3ss_notices gauge
ch3ss_notices 1
```

- **Off by default**, and behind the listener's `auth` like everything else: scrape with a bearer token.
- **One family per kind, the value as a label**: every numeric or boolean value is a sample of
  `<prefix>_value`, and every [counter](../concepts/counters.md) a sample of `<prefix>_count_total`.
- **`_changes_total{kind,ok}` exists from the first scrape**, every combination at zero if need be: a
  series an alert watches must exist before it is needed. It is counted in memory, so it never goes
  backwards when the page's history trims.
- **Label values are escaped** (backslash, quote, newline): a label is somebody's text, and an unescaped
  newline would let what follows read as another sample.
- **Withheld means withheld**: sensitive values are never exported, and a listener's `groups` apply.

**OpenTelemetry.** The same series without a scrape: `otelMetrics(panel, meterProvider, { prefix,
groups })` registers observable instruments — `<prefix>.value`, `.count`, `.changes`, `.notices` — read
when your SDK collects, never on the write path. The package imports no OpenTelemetry; your provider is
typed by the few methods used.

The number worth alerting on is `_changes_total{ok="false"}`: an action failing, a proposal turned
down. A counter cannot tell you a number is unusual; `_value` with your own thresholds can.

## Related

- [Audit](audit.md)
