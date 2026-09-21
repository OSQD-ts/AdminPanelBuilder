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
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await withDeadline(send(options.url, { method: "POST", headers, body }), options.timeoutMs ?? 5000, "the audit webhook");
          if (response.ok) return;
          if (response.status < 500 && response.status !== 429) throw new Refused(`the audit webhook refused the record (${response.status})`);
          throw new Error(`the audit webhook answered ${response.status}`);
        } catch (error) {
          if (error instanceof Refused || attempt >= retries) throw error;
          state.retried += 1;
          await sleep(1000 * 2 ** attempt * (0.5 + Math.random() / 2));
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
