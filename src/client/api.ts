/**
 * The client's only network access: its own panel's API, same-origin, never cached.
 *
 * A failure surfaces the server's `{ error }` sentence, so what the operator reads is what the
 * server decided rather than a status code.
 */
import type { ChangeRecord, JsonValue, Notice, PanelLayout, PanelSchema, PanelState, PendingChange, RepeatRuleShape, SettingDiff, TableRowsAnswer, WireValue } from "../types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** What kind of failure: "invalid", "not-allowed", "rate-limited"… */
    readonly code?: string,
    /** For refusals the page's messages translate: the key, and what fills it. */
    readonly key?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class Api {
  constructor(private readonly base: string) {}

  schema(): Promise<PanelSchema> {
    return this.get<{ schema: PanelSchema }>("/api/schema").then((body) => body.schema);
  }

  state(since?: number, after?: number, feed?: number): Promise<PanelState> {
    return this.get<{ state: PanelState }>(`/api/state${stateQuery(since, after, feed)}`).then((body) => body.state);
  }

  /** The URL of the live stream from a position, for EventSource. */
  streamUrl(since?: number, after?: number, feed?: number): string {
    return `${this.base}/api/stream${stateQuery(since, after, feed)}`;
  }

  table(id: string, query: { offset: number; limit: number; sort?: string | undefined; dir: "asc" | "desc"; q: string }): Promise<TableRowsAnswer> {
    const params = new URLSearchParams({ offset: String(query.offset), limit: String(query.limit), dir: query.dir, q: query.q });
    if (query.sort !== undefined) params.set("sort", query.sort);
    return this.get<{ table: TableRowsAnswer }>(`/api/tables/${encodeURIComponent(id)}?${params.toString()}`).then((body) => body.table);
  }

  changes(): Promise<ChangeRecord[]> {
    return this.get<{ changes: ChangeRecord[] }>("/api/changes").then((body) => body.changes);
  }

  notices(): Promise<Notice[]> {
    return this.get<{ notices: Notice[] }>("/api/notices").then((body) => body.notices);
  }

  /** A changed value, or a proposal waiting for a second operator; `change` says for how long, when, by what rule and why. */
  edit(id: string, value: unknown, change: ChangeFields = {}): Promise<{ value?: WireValue; pending?: PendingChange }> {
    return this.post<{ value?: WireValue; pending?: PendingChange }>(`/api/values/${encodeURIComponent(id)}`, { value, ...fields(change) });
  }

  cancelScheduled(id: string): Promise<void> {
    return this.post(`/api/schedules/${encodeURIComponent(id)}/cancel`, {}).then(() => undefined);
  }

  /** The page's words in another shipped language. */
  messages(locale: string): Promise<Record<string, string>> {
    return this.get<{ messages: Record<string, string> }>(`/api/messages/${encodeURIComponent(locale)}`).then((body) => body.messages);
  }

  settings(): Promise<Record<string, JsonValue>> {
    return this.get<{ settings: Record<string, JsonValue> }>("/api/settings").then((body) => body.settings);
  }

  diffSettings(settings: unknown): Promise<{ diff: SettingDiff[]; unknown: string[] }> {
    return this.post("/api/settings/diff", { settings });
  }

  importSettings(settings: unknown, reason?: string): Promise<number> {
    return this.post<{ changed: number }>("/api/settings/apply", { settings, ...fields({ reason }) }).then((body) => body.changed);
  }

  /** Saves the layout every viewer gets; null goes back to the one in code. Answers the layout as this viewer now sees it. */
  saveLayout(layout: PanelLayout | null): Promise<PanelLayout | null> {
    return this.post<{ layout: PanelLayout | null }>("/api/layout", { layout }).then((body) => body.layout);
  }

  /** An action's answer, or undefined when it was proposed for a second operator to approve. */
  run(id: string, input?: Record<string, JsonValue>, reason?: string): Promise<string | undefined> {
    return this.post<{ result?: { message: string } }>(`/api/actions/${encodeURIComponent(id)}`, { ...(input === undefined ? {} : { input }), ...fields({ reason }) }).then((body) => body.result?.message);
  }

  runRow(table: string, action: string, row: string): Promise<string> {
    return this.post<{ result: { message: string } }>(`/api/tables/${encodeURIComponent(table)}/actions/${encodeURIComponent(action)}`, { row }).then((body) => body.result.message);
  }

  /** Applied, or proposed (`pending`) when the profile needs approval. */
  applyProfile(id: string, change: ChangeFields = {}): Promise<{ pending?: PendingChange }> {
    return this.post<{ pending?: PendingChange }>(`/api/profiles/${encodeURIComponent(id)}`, fields(change));
  }

  decide(pending: string, verdict: "approve" | "reject"): Promise<void> {
    return this.post(`/api/pending/${encodeURIComponent(pending)}/${verdict}`, {}).then(() => undefined);
  }

  undo(change: number): Promise<void> {
    return this.post(`/api/changes/${change}/undo`, {}).then(() => undefined);
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, { ...init, credentials: "same-origin", cache: "no-store" });
    } catch {
      throw new ApiError("The panel could not be reached.", 0, "unreachable");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      const failure = (body ?? {}) as { error?: unknown; code?: unknown; key?: unknown; params?: unknown };
      const sentence = typeof failure.error === "string" ? capitalise(failure.error) : `The panel answered ${response.status}.`;
      const params = failure.params !== null && typeof failure.params === "object" ? (failure.params as Record<string, string | number>) : undefined;
      throw new ApiError(sentence, response.status, typeof failure.code === "string" ? failure.code : undefined, typeof failure.key === "string" ? failure.key : undefined, params);
    }
    return body as T;
  }
}

/** For how long, when, by what rule, and why: the fields any change may carry. */
export interface ChangeFields {
  revertAfterMs?: number | undefined;
  at?: number | undefined;
  repeat?: RepeatRuleShape | undefined;
  reason?: string | undefined;
}

function fields(change: ChangeFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["revertAfterMs", "at", "repeat", "reason"] as const) if (change[key] !== undefined) out[key] = change[key];
  return out;
}

/** Server sentences are lower-case so they read inside other sentences; on their own they start with a capital and end with a stop. */
export function capitalise(sentence: string): string {
  const text = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function stateQuery(since?: number, after?: number, feed?: number): string {
  const query = new URLSearchParams();
  if (since !== undefined) query.set("since", String(since));
  if (after !== undefined) query.set("after", String(Math.max(0, Math.floor(after))));
  if (feed !== undefined) query.set("feed", String(feed));
  return query.size > 0 ? `?${query.toString()}` : "";
}
