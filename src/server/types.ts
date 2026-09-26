/**
 * What a listener is told, and the framework-neutral request and response the router speaks.
 *
 * Kept free of `node:http` so the Fetch adapter, and the declarations the browser build sees,
 * do not drag it in.
 */
import type { Clock } from "../internal/clock.js";
import type { Grants } from "../panel/scope.js";

/** What a custom authentication check is shown of the request. */
export interface AuthRequest {
  method: string;
  path: string;
  /** Lower-cased names. */
  headers: Readonly<Record<string, string | undefined>>;
  /** The socket's address. Never a forwarded header: a client does not get to choose its own. */
  address: string;
}

/**
 * Who may reach the panel.
 *
 * - `{ token }` / `{ tokens }` — a bearer token, at least 16 characters, sent as
 *   `Authorization: Bearer …`, or opened once in a browser as `?token=…`, which swaps it for a
 *   cookie and redirects to a URL without it.
 * - `{ basic }` — HTTP Basic; the browser asks for it. The username is who made each change.
 * - `{ check }` — your own: return the operator's name to admit them, anything else to refuse.
 *   This is how a panel mounted inside an application reuses that application's sessions. An
 *   empty name is a refusal, so a lookup that returns `""` fails closed.
 */
export type PanelAuth =
  | { token: string; name?: string | undefined }
  /**
   * `delegates` names tokens that may act for another operator, sent in `x-apb-on-behalf-of`: a remote panel in front of this one.
   * A token given as `{ token, grants }` is narrowed to those grants.
   */
  | { tokens: Readonly<Record<string, string | { token: string; grants?: Grants | undefined }>>; delegates?: readonly string[] | undefined }
  /**
   * A signed cookie your own sign-in sets with `signSession()`. `secret` may be a list: the first signs,
   * all verify. `revoked(id)` is asked about every session; `true` refuses it.
   */
  | { session: { secret: string | readonly string[]; cookie?: string | undefined; revoked?: ((id: string) => boolean | Promise<boolean>) | undefined; revocations?: import("./session.js").RevocationStore | undefined; now?: (() => number) | undefined } }
  /** Sign-in with an OpenID Connect provider. */
  | { oidc: import("./oidc.js").OidcOptions }
  | { basic: { username: string; password: string } | ReadonlyArray<{ username: string; password: string }> }
  /** Return the operator's name, or `{ name, grants }` to narrow what they may see and do. */
  | { check: (request: AuthRequest) => CheckAnswer | Promise<CheckAnswer> };

export type CheckAnswer = string | { name: string; grants?: Grants | undefined } | false | null | undefined;

/**
 * What a viewer may do, separately from what they may see. Every control is off unless turned
 * on, and turning one on requires `auth`: a section reveals something the panel already shows,
 * a control reaches back into the application, so silence has to mean no.
 */
export interface PanelControls {
  /** Operators may change modifiable values and apply profiles: everywhere, or in the named groups. */
  edit?: boolean | readonly string[] | undefined;
  /** Operators may run actions and row actions: everywhere, or in the named groups. */
  actions?: boolean | readonly string[] | undefined;
}

export interface StreamOptions {
  /** Open streams at once; past it a viewer is told 503 and polls. Default 16. */
  maxViewers?: number | undefined;
  /** Frames a second per viewer, at most. Default 4. */
  framesPerSecond?: number | undefined;
}

export interface ServeOptions {
  /** The path the panel answers under. Default `"/"` on a listener of its own; set it when mounting under a prefix the router does not strip. */
  basePath?: string | undefined;
  auth?: PanelAuth | undefined;
  controls?: PanelControls | undefined;
  /**
   * The groups this listener shows, by name. Others are withheld on the server: absent from the
   * schema, the state and the API, not hidden on the page. Default: every group.
   */
  groups?: readonly string[] | undefined;
  /**
   * `Host` header values accepted, as `name` or `name:port`. A loopback listener accepts its own
   * loopback names by default, which is the defence against DNS rebinding; a mounted handler
   * accepts any host unless this says otherwise.
   */
  allowedHosts?: readonly string[] | undefined;
  /**
   * Failed authentications allowed per address before a 429. Default 10 a minute; `false` turns it off.
   * `store` shares the counts between replicas: see `redisThrottleStore`.
   */
  authThrottle?: { failures?: number | undefined; windowMs?: number | undefined; store?: import("./auth.js").ThrottleStore | undefined } | false | undefined;
  /**
   * `GET /healthz` without authentication, for a load balancer: "ok", or "ok, 2 warnings" when the
   * panel has warning notices, and nothing else. Off by default, because it answers anybody.
   */
  health?: boolean | undefined;
  /** Writes (edits, actions, approvals, imports) one operator may make a minute before a 429. Default 60; `false` turns it off. */
  writeLimit?: { perMinute?: number | undefined } | false | undefined;
  /** For tests. */
  clock?: Clock | undefined;
  /** Live updates over server-sent events at `/api/stream`. Default on; the page polls where it fails. */
  stream?: boolean | StreamOptions | undefined;
  /** Prometheus exposition of numeric values at `/metrics`, behind the same auth. Default off. */
  metrics?: boolean | { prefix?: string | undefined } | undefined;
}

export interface ListenOptions extends ServeOptions {
  /** Default 9780: clear of hackerpot's 9500/9501 and bothandlerjs's 9674, so all three can run side by side. */
  port?: number | undefined;
  /** Default `"127.0.0.1"`. Anything else requires `auth`. */
  host?: string | undefined;
}

/** A request, as every front end reduces it. */
export interface PanelRequest {
  method: string;
  /** Path and query, as received. */
  url: string;
  /** Lower-cased names. */
  headers: Readonly<Record<string, string | undefined>>;
  address: string;
  /** Whether the connection is TLS, as the front end knows it. A proxy says so in `x-forwarded-proto` instead. */
  secure?: boolean | undefined;
  /** The body as text, refusing past `limit` bytes with a `BodyTooLargeError`. */
  body(limit: number): Promise<string>;
}

export interface PanelResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** A response that stays open: server-sent events. The adapter calls `start` after writing the headers. */
  stream?: StreamBody | undefined;
}

/** What an adapter hands a stream: somewhere to write, whether writing now would pile up, and the way to end. */
export interface StreamSink {
  send(text: string): void;
  /** False while the connection is still sending what was written before. */
  ready(): boolean;
  close(): void;
}

export interface StreamBody {
  /** Starts writing. Returns the way to stop, which the adapter calls when the client goes away. */
  start(sink: StreamSink): () => void;
}

export class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`the request body is larger than ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}
