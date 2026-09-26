# Audit

Keeping every change, and sending it where your other records go.

← [Operations](index.md)

---

```ts
import { createAdminPanel, fileChangeLog, jsonLineSink, webhookSink } from "@osqd/admin-panel-builder";

const panel = createAdminPanel({ changeLog: fileChangeLog("data/panel-changes.jsonl") });
panel.on("change", jsonLineSink());                                            // one JSON line per change, to stdout
panel.on("change", webhookSink({ url: process.env.AUDIT_URL!, secret: process.env.AUDIT_SECRET }));
```

**The change log** keeps every change record, not just the page's last `MAX_CHANGES`, across restarts.
It seeds the page's history and the id counter on start, so a change id is never reused: "undo change
42" cannot mean a different change after a restart. `fileChangeLog` appends JSON lines asynchronously,
reads at most the last megabyte on start, and skips a torn last line left by a crash. A store that fails
is a notice, never a failed change.

**The chain.** Every record carries `hash`, SHA-256 over the previous record's hash and its own
content, and `prevHash`. Deleting, editing, inserting or reordering a stored line breaks the chain at
that line:

```bash
apb verify-log data/panel-changes.jsonl
# apb: record 42 (line 17) breaks the chain: its content does not match its hash: it was edited
```

`verifyChain(records)` does the same in code. It proves the log is internally consistent, not that
nobody rewrote all of it from some point on: send records to a sink somebody else keeps for that.
`fileChangeLog(path, { rotate: { maxBytes } | { daily: true }, keep: { files, days } })` starts a new file
past a size or at a new day, renaming the old one `<path>.<timestamp>`, and deletes rotated files past the
count or the age. The chain runs on across files; `apb verify-log <path>` checks the rotated files with
it, and names a missing one as a gap. `redisChangeLog(redis)` keeps the log in Redis for [several replicas](replicas.md). Await
`panel.flushed()` before a planned exit so the last records are written.

**Sinks** are change listeners, isolated like any other:

| Sink | Sends | When the other end is slow |
| --- | --- | --- |
| `jsonLineSink(write?)` | `{"ts":…,"kind":"panel-change","change":"edit",…}` per line; a newline inside a value is escaped, so a value cannot forge a line | — |
| `webhookSink({ url, secret?, maxInFlight?, timeoutMs?, retries?, fetch? })` | a POST of the record, signed as `x-apb-signature: sha256=<hex>` when `secret` is set | no answer, a 5xx or a 429 is retried `retries` times (default 3, at most `MAX_WEBHOOK_RETRIES`) after 1 s, 2 s, 4 s… with jitter, counted in `sink.retried`; another 4xx is not retried. A record being retried still counts against `maxInFlight` (default 4); past it a record is dropped and counted in `sink.dropped`; failures in `sink.failed` |
| `notifySink(notifier)` | `notify({ title, message, level, data })`: a NotifyJS notifier or anything with that shape | the notifier's business |
| `syslogSink({ host?, port?, protocol?, appName?, hostname?, facility? })` | RFC 5424 lines, MSGID `panel-change` or `panel-alert`, the record as JSON; over UDP, or TCP octet-counted | a TCP connection that is still sending drops and counts |
| `otelLogSink(loggerOrProvider)` | OpenTelemetry log records: a sentence as the body, the record's fields as `panel.*` attributes | the exporter's business |

Every sink also has `.alert`, for [alerts](changes-and-notices.md#alerts):
`panel.on("alert", sink.alert)` writes a `"panel-alert"` line, posts `{ kind: "alert", … }`, or notifies.

A record carries who (`by`), what (`kind`, `target`, `label`), when (`at`), `from` and `to` for an edit
(never for a sensitive value), what an action answered, and whether it succeeded. See
[data shapes](../reference/data-shapes.md#changerecord).

## Related

- [Changes and notices](changes-and-notices.md) · [Metrics](metrics.md)
