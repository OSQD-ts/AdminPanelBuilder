/**
 * `@osqd/admin-panel-builder/client`: a running panel's HTTP API as typed calls.
 *
 *   import { panelClient } from "@osqd/admin-panel-builder/client";
 *   const panel = panelClient({ url: "https://ops.example/admin", token: process.env.PANEL_TOKEN });
 *   await panel.set("max-players", 200, { revertAfterMs: 3_600_000 });
 *
 * The CLI, the remote panel and the fleet page are written on it, so a script calling it gets the
 * same answers they do. Every call resolves to the API's own answer, typed, or rejects with a
 * `PanelApiError` carrying the status and the panel's sentence. Fetch only, so it runs anywhere
 * `fetch` does.
 */
import type { ChangeRecord, JsonValue, Notice, PanelLayout, PanelSchema, PanelState, PendingChange, RepeatRuleShape, SettingDiff, TableRowsAnswer, WireValue } from "./types.js";

/** How a change is made: for a while, at a time, by a rule, and why. */
export interface ChangeRequest {
  revertAfterMs?: number | undefined;
  at?: number | string | undefined;
  repeat?: RepeatRuleShape | undefined;
  reason?: string | undefined;
}

export interface PanelClientOptions {
  /** The panel's URL, base path included: `https://ops.example/admin`. */
  url: string;
  /** Sent as `Authorization: Bearer …`. */
  token?: string | undefined;
  /** For a delegate token: the operator this call is made for, recorded as "ada via gateway". */
  onBehalfOf?: string | undefined;
  /** Default 10 seconds. */
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
}

/** A refusal or a failure, with the panel's own sentence. */
export class PanelApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PanelApiError";
  }
}

export type SetAnswer = { value: WireValue } | { pending: PendingChange };

export interface PanelClient {
  readonly url: string;
  schema(): Promise<PanelSchema>;
  state(position?: { since?: number | undefined; after?: number | undefined; feed?: number | undefined }): Promise<PanelState>;
  changes(): Promise<ChangeRecord[]>;
  notices(): Promise<Notice[]>;
  settings(): Promise<Record<string, JsonValue>>;
  openApi(): Promise<Record<string, unknown>>;
  table(id: string, query?: { offset?: number; limit?: number; sort?: string; dir?: "asc" | "desc"; q?: string }): Promise<TableRowsAnswer>;
  /** Changes a value. `at` schedules it; `revertAfterMs` makes it temporary. A value that needs approval answers `{ pending }`. */
  set(id: string, value: unknown, options?: ChangeRequest): Promise<SetAnswer>;
  cancelScheduled(id: string): Promise<WireValue>;
  /** Runs an action; one declared with approval answers `{ pending }` instead of a message. */
  run(action: string, input?: Record<string, unknown>, options?: { reason?: string | undefined }): Promise<string>;
  runRowAction(table: string, action: string, row: string): Promise<string>;
  applyProfile(id: string, options?: ChangeRequest): Promise<SetAnswer>;
  /** Approves a proposal; for an action, resolves to what it answered. */
  approve(pendingId: string): Promise<string | undefined>;
  reject(pendingId: string, options?: { reason?: string | undefined }): Promise<void>;
  undo(changeId: number, options?: { reason?: string | undefined }): Promise<void>;
  diffSettings(settings: Record<string, unknown>): Promise<{ diff: SettingDiff[]; unknown: string[] }>;
  importSettings(settings: Record<string, unknown>, options?: { reason?: string | undefined }): Promise<number>;
  /** Saves the layout every viewer gets (groups the caller may not edit keep theirs); null goes back to the one in code. */
  saveLayout(layout: PanelLayout | null, options?: { reason?: string | undefined }): Promise<PanelLayout | null>;
  /**
   * Calls `onState` with every change, polling `/api/state` from where the last answer left off.
   * Stops when `signal` aborts; rejects on the first refusal (a 401, a 403), retries a panel that
   * cannot be reached, waiting longer each time up to thirty seconds.
   */
  watch(onState: (state: PanelState) => void, options?: { intervalMs?: number | undefined; signal?: AbortSignal | undefined }): Promise<void>;
}

export function panelClient(options: PanelClientOptions): PanelClient {
  if (typeof options.url !== "string" || !/^https?:\/\//.test(options.url)) throw new TypeError("panelClient(): url must start with http:// or https://");
  const base = options.url.replace(/\/+$/, "");
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.token !== undefined && options.token !== "") headers.authorization = `Bearer ${options.token}`;
    if (options.onBehalfOf !== undefined) headers["x-apb-on-behalf-of"] = options.onBehalfOf;
    if (body !== undefined) headers["content-type"] = "application/json";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    (timer as { unref?: () => void }).unref?.();
    let response: Response;
    try {
      response = await send(`${base}${path}`, body === undefined ? { method: "GET", headers, signal: controller.signal } : { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    } catch (error) {
      throw controller.signal.aborted ? new Error(`the panel did not answer within ${timeoutMs / 1000} s`) : error;
    } finally {
      clearTimeout(timer);
    }
    const json = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
    if (!response.ok) throw new PanelApiError(response.status, typeof json?.error === "string" ? json.error : `the panel answered ${response.status}`);
    if (json === undefined) throw new PanelApiError(response.status, `the panel answered ${response.status} without JSON`);
    return json as T;
  };
  const segment = encodeURIComponent;

  const client: PanelClient = {
    url: base,
    schema: async () => (await request<{ schema: PanelSchema }>("/api/schema")).schema,
    state: async (position = {}) => {
      const query = new URLSearchParams();
      if (position.since !== undefined) query.set("since", String(position.since));
      if (position.after !== undefined) query.set("after", String(Math.floor(position.after)));
      if (position.feed !== undefined) query.set("feed", String(position.feed));
      const text = query.toString();
      return (await request<{ state: PanelState }>(`/api/state${text === "" ? "" : `?${text}`}`)).state;
    },
    changes: async () => (await request<{ changes: ChangeRecord[] }>("/api/changes")).changes,
    notices: async () => (await request<{ notices: Notice[] }>("/api/notices")).notices,
    settings: async () => (await request<{ settings: Record<string, JsonValue> }>("/api/settings")).settings,
    openApi: () => request<Record<string, unknown>>("/api/openapi.json"),
    table: async (id, query = {}) => {
      const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
      return (await request<{ table: TableRowsAnswer }>(`/api/tables/${segment(id)}?${search}`)).table;
    },
    set: (id, value, extra = {}) => request<SetAnswer>(`/api/values/${segment(id)}`, { value, ...changeBody(extra) }),
    cancelScheduled: async (id) => (await request<{ value: WireValue }>(`/api/schedules/${segment(id)}/cancel`, {})).value,
    run: async (action, input, extra = {}) => {
      const answer = await request<{ result?: { message: string }; pending?: PendingChange }>(`/api/actions/${segment(action)}`, { ...(input === undefined ? {} : { input }), ...changeBody(extra) });
      return answer.result?.message ?? "Proposed; it runs once another operator approves it.";
    },
    runRowAction: async (table, action, row) => (await request<{ result: { message: string } }>(`/api/tables/${segment(table)}/actions/${segment(action)}`, { row })).result.message,
    applyProfile: (id, extra = {}) => request<SetAnswer>(`/api/profiles/${segment(id)}`, changeBody(extra)),
    approve: async (id) => (await request<{ result?: { message: string } }>(`/api/pending/${segment(id)}/approve`, {})).result?.message,
    reject: async (id, extra = {}) => {
      await request(`/api/pending/${segment(id)}/reject`, changeBody(extra));
    },
    undo: async (id, extra = {}) => {
      await request(`/api/changes/${id}/undo`, changeBody(extra));
    },
    diffSettings: (settings) => request<{ diff: SettingDiff[]; unknown: string[] }>("/api/settings/diff", { settings }),
    importSettings: async (settings, extra = {}) => (await request<{ changed: number }>("/api/settings/apply", { settings, ...changeBody(extra) })).changed,
    saveLayout: async (layout, extra = {}) => (await request<{ layout: PanelLayout | null }>("/api/layout", { layout, ...changeBody(extra) })).layout,
    watch: async (onState, watchOptions = {}) => {
      const signal = watchOptions.signal;
      let position: { since?: number; after?: number; feed?: number } = {};
      let failures = 0;
      while (signal?.aborted !== true) {
        let interval = watchOptions.intervalMs;
        try {
          const state = await client.state(position);
          failures = 0;
          position = { since: state.version, after: state.now, feed: state.feedSeq };
          onState(state);
        } catch (error) {
          if (error instanceof PanelApiError && error.status >= 400 && error.status < 500 && error.status !== 429) throw error;
          failures += 1;
          interval = Math.min(30_000, (watchOptions.intervalMs ?? 1000) * 2 ** Math.min(failures, 5));
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, interval ?? 1000);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  };
  return client;
}

/** Only the fields that are set: an absent option is absent from the body. */
function changeBody(options: ChangeRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of ["revertAfterMs", "at", "repeat", "reason"] as const) if (options[key] !== undefined) body[key] = options[key];
  return body;
}
