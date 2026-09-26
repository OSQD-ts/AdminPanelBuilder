/**
 * Audit sinks: where change records go besides the page.
 *
 *   panel.on("change", jsonLineSink());
 *   panel.on("change", webhookSink({ url, secret }));
 *
 * A sink is a change listener, so it is isolated like any other: one that throws cannot stop the
 * next from hearing the change. A sink that talks to the network drops and counts past its limit
 * rather than queueing, because an audit endpoint that stops answering must not grow the
 * application's memory without bound.
 */
import { withDeadline } from "./internal/async.js";
import type { Alert, ChangeRecord } from "./types.js";

/**
 * A change listener, and `.alert` for the panel's "alert" event, so alerts reach the same place
 * as changes: `panel.on("change", sink); panel.on("alert", sink.alert)`.
 */
export type AuditSink = ((record: ChangeRecord) => void) & { readonly dropped: number; readonly failed: number; readonly retried?: number; readonly alert: (alert: Alert) => void };

/** One JSON object per line, `ts` first and a `kind` of `"panel-change"`. Default output: stdout. */
export function jsonLineSink(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): AuditSink {
  const sink = (record: ChangeRecord): void => {
    // JSON.stringify escapes newlines inside values, so a value cannot end the line and forge another.
    const { kind, ...rest } = record;
    write(JSON.stringify({ ts: new Date(record.at).toISOString(), kind: "panel-change", change: kind, ...rest }));
  };
  const alert = (event: Alert): void => write(JSON.stringify({ ts: new Date(event.at).toISOString(), kind: "panel-alert", ...event }));
  return Object.assign(sink, { dropped: 0, failed: 0, alert });
}

export interface WebhookSinkOptions {
  url: string;
  /** Signs the body: `x-apb-signature: sha256=<hex HMAC>`. */
  secret?: string | undefined;
  /** Requests in flight before new records are dropped and counted. Default 4. */
  maxInFlight?: number | undefined;
  /** Default 5 seconds. */
  timeoutMs?: number | undefined;
  /**
   * Further attempts after a failure that may pass: no answer, a 5xx, a 429. A 4xx other than 429 is
   * the endpoint refusing the record, and is not retried. Waits 1 s, 2 s, 4 s… with jitter. Default 3.
   * A record being retried still counts against `maxInFlight`, so an endpoint that is down makes the
   * sink drop and count rather than queue.
   */
  retries?: number | undefined;
  /** For tests: how a retry waits. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  fetch?: typeof fetch | undefined;
}

/** Most retries a webhook sink may be told to make: past it, a record waits minutes behind a dead endpoint. */
export const MAX_WEBHOOK_RETRIES = 8;

class Refused extends Error {}

export function webhookSink(options: WebhookSinkOptions): AuditSink {
  const maxInFlight = options.maxInFlight ?? 4;
  const send = options.fetch ?? fetch;
  const retries = options.retries ?? 3;
  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_WEBHOOK_RETRIES) throw new RangeError(`webhookSink: retries is 0 to ${MAX_WEBHOOK_RETRIES}`);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => (setTimeout(resolve, ms) as { unref?: () => void }).unref?.()));
  let inFlight = 0;
  const state = { dropped: 0, failed: 0, retried: 0 };
  const post = (body: string): void => {
    if (inFlight >= maxInFlight) {
      state.dropped += 1;
      return;
    }
    inFlight += 1;
    void (async () => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options.secret !== undefined) headers["x-apb-signature"] = `sha256=${await hmacHex(options.secret, body)}`;
      const timeoutMs = options.timeoutMs ?? 5000;
      for (let attempt = 0; ; attempt += 1) {
        // The deadline cancels the request as well as stopping the wait: an endpoint that accepts a
        // connection and then says nothing would otherwise hold one open per record, for as long as
        // the runtime's own timeout, while the retries opened more.
        const stopped = new AbortController();
        const cancel = setTimeout(() => stopped.abort(), timeoutMs);
        (cancel as { unref?: () => void }).unref?.();
        try {
          const response = await withDeadline(send(options.url, { method: "POST", headers, body, signal: stopped.signal }), timeoutMs, "the audit webhook");
          if (response.ok) return;
          if (response.status < 500 && response.status !== 429) throw new Refused(`the audit webhook refused the record (${response.status})`);
          throw new Error(`the audit webhook answered ${response.status}`);
        } catch (error) {
          if (error instanceof Refused || attempt >= retries) throw error;
          state.retried += 1;
          await sleep(1000 * 2 ** attempt * (0.5 + Math.random() / 2));
        } finally {
          clearTimeout(cancel);
        }
      }
    })()
      .catch(() => {
        state.failed += 1;
      })
      .finally(() => {
        inFlight -= 1;
      });
  };
  const sink = (record: ChangeRecord): void => post(JSON.stringify(record));
  const alert = (event: Alert): void => post(JSON.stringify({ kind: "alert", ...event }));
  return Object.defineProperties(sink, {
    dropped: { get: () => state.dropped },
    failed: { get: () => state.failed },
    retried: { get: () => state.retried },
    alert: { value: alert },
  }) as AuditSink;
}

/** Anything with `notify(event)`, such as a NotifyJS notifier, typed structurally so nothing is imported. */
export interface NotifierLike {
  notify(event: { title: string; message: string; level: "info" | "warning"; data: ChangeRecord | Alert }): unknown;
}

export function notifySink(notifier: NotifierLike): AuditSink {
  const state = { dropped: 0, failed: 0 };
  const send = (event: Parameters<NotifierLike["notify"]>[0]): void => {
    let result: unknown;
    try {
      result = notifier.notify(event);
    } catch {
      state.failed += 1;
      return;
    }
    if (typeof (result as { catch?: unknown } | undefined)?.catch === "function") {
      (result as Promise<unknown>).catch(() => {
        state.failed += 1;
      });
    }
  };
  const sink = (record: ChangeRecord): void => {
    const verb = record.kind === "action" ? "ran" : record.kind === "profile" ? "applied" : "changed";
    send({ title: `${record.by} ${verb} ${record.label}`, message: record.outcome ?? (record.to === undefined ? "" : `now ${JSON.stringify(record.to)}`), level: record.ok ? "info" : "warning", data: record });
  };
  const alert = (event: Alert): void => send({ title: `${event.label}: ${event.status === "bad" ? "bad" : "warning"}`, message: event.message, level: "warning", data: event });
  return Object.defineProperties(sink, { dropped: { get: () => state.dropped }, failed: { get: () => state.failed }, alert: { value: alert } }) as AuditSink;
}

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface SyslogSinkOptions {
  /** Where to send; default 127.0.0.1:514 over UDP. */
  host?: string | undefined;
  port?: number | undefined;
  protocol?: "udp" | "tcp" | undefined;
  /** RFC 5424 APP-NAME. Default "admin-panel". */
  appName?: string | undefined;
  /** RFC 5424 HOSTNAME. Default: the machine's. */
  hostname?: string | undefined;
  /** Syslog facility number, 0–23. Default 13 (log audit). */
  facility?: number | undefined;
  /** Replaces the network: receives each framed message. For tests, and for a syslog library of your own. */
  send?: ((message: string) => void | Promise<void>) | undefined;
}

/**
 * Change records and alerts as RFC 5424 syslog messages: `<PRI>1 TIMESTAMP HOST APP PID MSGID - JSON`,
 * MSGID `panel-change` or `panel-alert`, severity notice for a change, warning for a failed one or
 * an alert at warning, error for an alert at bad. Over TCP each message is octet-counted (RFC 6587);
 * a connection that is down drops and counts rather than queueing, as the webhook sink does.
 */
export function syslogSink(options: SyslogSinkOptions = {}): AuditSink {
  const facility = options.facility ?? 13;
  if (!Number.isInteger(facility) || facility < 0 || facility > 23) throw new RangeError("syslogSink: facility is 0 to 23");
  const appName = (options.appName ?? "admin-panel").replace(/\s+/g, "-").slice(0, 48);
  const state = { dropped: 0, failed: 0 };
  let hostname = options.hostname;
  const transport = options.send ?? networkTransport(options, state);
  const emit = (severity: number, messageId: string, body: object, at: number): void => {
    hostname ??= typeof process !== "undefined" ? (process.env.HOSTNAME ?? "-") : "-";
    const pid = typeof process !== "undefined" ? String(process.pid) : "-";
    // JSON escapes every newline, so a value cannot end the message and forge another.
    const line = `<${facility * 8 + severity}>1 ${new Date(at).toISOString()} ${hostname.replace(/\s+/g, "-").slice(0, 255)} ${appName} ${pid} ${messageId} - ${JSON.stringify(body)}`;
    try {
      const sent = transport(line);
      if (sent !== undefined && typeof (sent as Promise<void>).catch === "function")
        (sent as Promise<void>).catch(() => {
          state.failed += 1;
        });
    } catch {
      state.failed += 1;
    }
  };
  const sink = (record: ChangeRecord): void => emit(record.ok ? 5 : 4, "panel-change", record, record.at);
  const alert = (event: Alert): void => emit(event.status === "bad" ? 3 : 4, "panel-alert", event, event.at);
  return Object.defineProperties(sink, { dropped: { get: () => state.dropped }, failed: { get: () => state.failed }, alert: { value: alert } }) as AuditSink;
}

/** UDP by default, TCP with octet counting; both imported on first use so the root entry loads without `node:dgram`. */
function networkTransport(options: SyslogSinkOptions, state: { dropped: number; failed: number }): (message: string) => Promise<void> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 514;
  if (options.protocol === "tcp") {
    let socket: import("node:net").Socket | undefined;
    let connecting: Promise<import("node:net").Socket> | undefined;
    const connect = (): Promise<import("node:net").Socket> => {
      connecting ??= import("node:net").then(
        ({ createConnection }) =>
          new Promise((resolve, reject) => {
            const opened = createConnection({ host, port }, () => resolve(opened));
            opened.once("error", (error) => {
              connecting = undefined;
              socket = undefined;
              reject(error);
            });
            opened.once("close", () => {
              connecting = undefined;
              socket = undefined;
            });
            opened.unref();
          }),
      );
      return connecting;
    };
    return async (message) => {
      socket ??= await connect();
      if (socket.writableNeedDrain) {
        state.dropped += 1;
        return;
      }
      socket.write(`${Buffer.byteLength(message)} ${message}`);
    };
  }
  let udp: Promise<import("node:dgram").Socket> | undefined;
  return async (message) => {
    udp ??= import("node:dgram").then(({ createSocket }) => {
      const created = createSocket(host.includes(":") ? "udp6" : "udp4");
      created.unref();
      return created;
    });
    const socket = await udp;
    await new Promise<void>((resolve, reject) => socket.send(message, port, host, (error) => (error === null ? resolve() : reject(error))));
  };
}

/** The parts of an OpenTelemetry `Logger` used. */
export interface OtelLoggerLike {
  emit(record: { severityNumber?: number; severityText?: string; body?: string; attributes?: Record<string, string | number | boolean>; timestamp?: number }): void;
}

export interface OtelLoggerProviderLike {
  getLogger(name: string, version?: string): OtelLoggerLike;
}

/**
 * Change records and alerts as OpenTelemetry log records: a sentence as the body, the record's fields
 * as attributes (`panel.kind`, `panel.target`, `panel.by`, `panel.reason`…), INFO for a change,
 * WARN for a failed one and for an alert, ERROR for an alert at bad.
 */
export function otelLogSink(logger: OtelLoggerLike | OtelLoggerProviderLike): AuditSink {
  const resolved: OtelLoggerLike = "getLogger" in logger ? logger.getLogger("@osqd/admin-panel-builder") : logger;
  const state = { dropped: 0, failed: 0 };
  const attributes = (fields: Record<string, unknown>): Record<string, string | number | boolean> => {
    const out: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      out[`panel.${key}`] = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : JSON.stringify(value);
    }
    return out;
  };
  const emit = (record: Parameters<OtelLoggerLike["emit"]>[0]): void => {
    try {
      resolved.emit(record);
    } catch {
      state.failed += 1;
    }
  };
  const sink = (record: ChangeRecord): void => {
    const verb = record.kind === "action" ? "ran" : record.kind === "profile" ? "applied" : "changed";
    emit({ severityNumber: record.ok ? 9 : 13, severityText: record.ok ? "INFO" : "WARN", body: `${record.by} ${verb} ${record.label}`, attributes: attributes({ ...record }), timestamp: record.at });
  };
  const alert = (event: Alert): void => emit({ severityNumber: event.status === "bad" ? 17 : 13, severityText: event.status === "bad" ? "ERROR" : "WARN", body: event.message, attributes: attributes({ ...event, kind: "alert" }), timestamp: event.at });
  return Object.defineProperties(sink, { dropped: { get: () => state.dropped }, failed: { get: () => state.failed }, alert: { value: alert } }) as AuditSink;
}
