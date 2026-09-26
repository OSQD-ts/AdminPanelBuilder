/**
 * Signed session cookies: the way an application that already signs people in hands the panel a
 * name without a second user list, and the way the OIDC sign-in remembers who came back.
 *
 * A cookie is `base64url(payload).base64url(HMAC-SHA256(payload))`, the payload `{ n, e, j, g? }` — a
 * name, an expiry, a random id and, optionally, the operator's grants. Nothing in it is secret;
 * everything in it is signed, so a viewer can read their own name and cannot change it. Web Crypto,
 * so it runs behind the Fetch adapter too.
 *
 * Two ways to end a session before it expires. Revoke its id (`revoked(id)` is asked on every
 * request; signing out adds the id to a list kept until the cookie would have expired anyway), or
 * rotate the secret: `secret` may be a list, the first signing and every one verifying, so a new
 * secret can be introduced without signing everybody out, and an old one dropped to do exactly that.
 */
import { AdminPanelConfigError } from "../errors.js";
import type { Grants } from "../panel/scope.js";

/** A signing secret shorter than this can be brute-forced offline from one cookie. */
export const MIN_SESSION_SECRET_LENGTH = 32;
export const SESSION_COOKIE = "apb_session";

/** One secret, or several: the first signs, every one verifies. */
export type SessionSecret = string | readonly string[];

/** Checks a secret or a list of them, returning the list, signing secret first. */
export function checkSecret(secret: unknown, where: string): string[] {
  const list = Array.isArray(secret) ? secret : [secret];
  if (list.length === 0) throw new AdminPanelConfigError(`${where}: the session secret list is empty, which would verify nothing`);
  for (const entry of list) {
    if (typeof entry !== "string" || entry.length < MIN_SESSION_SECRET_LENGTH) {
      throw new AdminPanelConfigError(`${where}: the session secret must be at least ${MIN_SESSION_SECRET_LENGTH} characters, because a short one can be guessed from a single cookie`);
    }
  }
  return list as string[];
}

/** What a signed session says. */
export interface SessionInfo {
  name: string;
  /** Random, per sign-in: what `revoked(id)` is asked about. */
  id: string;
  expires: number;
  grants?: Grants | undefined;
}

export interface SignSessionOptions {
  ttlMs?: number | undefined;
  /** Narrows what this operator may see and do, below what the listener allows. */
  grants?: Grants | undefined;
  now?: number | undefined;
}

/**
 * Signs a value for a cookie. The application's own sign-in calls this with the operator's name
 * and sets the result as the `apb_session` cookie (or the name it configured). The fourth
 * argument may be the options, or, as before, a number for `now`.
 */
export async function signSession(secret: SessionSecret, name: string, ttlOrOptions: number | SignSessionOptions = {}, now?: number): Promise<string> {
  const [signing] = checkSecret(secret, "signSession()") as [string];
  if (typeof name !== "string" || name.trim() === "" || name.length > 200) throw new AdminPanelConfigError("signSession(): the name must be non-empty text of at most 200 characters");
  const options = typeof ttlOrOptions === "number" ? { ttlMs: ttlOrOptions, now } : ttlOrOptions;
  const at = options.now ?? Date.now();
  const payload: { n: string; e: number; j: string; g?: Grants } = { n: name, e: at + (options.ttlMs ?? 8 * 3_600_000), j: randomId() };
  if (options.grants !== undefined) payload.g = checkGrants(options.grants, "signSession()");
  return seal(signing, payload);
}

/** The name in a signed session, or undefined when it is missing, forged or expired. */
export async function readSession(secret: SessionSecret, cookie: string | undefined, now = Date.now()): Promise<string | undefined> {
  return (await sessionInfo(secret, cookie, now))?.name;
}

/** Everything a valid session says, or undefined when it is missing, forged or expired. */
export async function sessionInfo(secret: SessionSecret, cookie: string | undefined, now = Date.now()): Promise<SessionInfo | undefined> {
  const payload = await unseal<{ n?: unknown; e?: unknown; j?: unknown; g?: unknown }>(secret, cookie);
  if (payload === undefined || typeof payload.n !== "string" || payload.n === "" || typeof payload.e !== "number" || payload.e <= now) return undefined;
  const info: SessionInfo = { name: payload.n, id: typeof payload.j === "string" ? payload.j : "", expires: payload.e };
  if (payload.g !== undefined && payload.g !== null && typeof payload.g === "object") info.grants = payload.g as Grants;
  return info;
}

/** Grants as a sign-in states them: lists of group names or booleans, nothing else. */
export function checkGrants(grants: Grants, where: string): Grants {
  if (grants === null || typeof grants !== "object") throw new AdminPanelConfigError(`${where}: grants must be an object of groups, edit and actions`);
  for (const key of Object.keys(grants)) if (key !== "groups" && key !== "edit" && key !== "actions") throw new AdminPanelConfigError(`${where}: grants has "${key}", which grants nothing`);
  const list = (value: unknown): boolean => Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry !== "");
  if (grants.groups !== undefined && !list(grants.groups)) throw new AdminPanelConfigError(`${where}: grants.groups is a list of group names`);
  for (const key of ["edit", "actions"] as const) {
    const value = grants[key];
    if (value !== undefined && typeof value !== "boolean" && !list(value)) throw new AdminPanelConfigError(`${where}: grants.${key} is true, false or a list of group names`);
  }
  return grants;
}

export async function seal(secret: string, payload: unknown): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${base64url(await hmac(secret, body))}`;
}

/** Opens a sealed value signed by any of the secrets. */
export async function unseal<T>(secret: SessionSecret, sealed: string | undefined): Promise<T | undefined> {
  if (sealed === undefined || sealed.length > 8192) return undefined;
  const dot = sealed.indexOf(".");
  if (dot <= 0) return undefined;
  const body = sealed.slice(0, dot);
  let given: Uint8Array;
  try {
    given = fromBase64url(sealed.slice(dot + 1));
  } catch {
    return undefined;
  }
  let matched = false;
  for (const candidate of typeof secret === "string" ? [secret] : secret) {
    const expected = await hmac(candidate, body);
    if (given.length !== expected.length) continue;
    let difference = 0;
    for (let i = 0; i < given.length; i += 1) difference |= (given[i] as number) ^ (expected[i] as number);
    if (difference === 0) matched = true;
  }
  if (!matched) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(body))) as T;
  } catch {
    return undefined;
  }
}

/** Most signed-out sessions remembered at once; past it the one expiring soonest is forgotten first. */
export const MAX_REVOKED_SESSIONS = 10_000;

/**
 * Session ids signed out on this process, kept until the cookie would have expired anyway. A
 * process of its own: replicas that must honour each other's sign-outs pass `revoked` instead.
 */
export class RevocationList {
  private readonly ids = new Map<string, number>();

  add(id: string, expires: number): void {
    if (id === "") return;
    this.ids.set(id, expires);
    if (this.ids.size > MAX_REVOKED_SESSIONS) {
      let soonest: string | undefined;
      let at = Number.POSITIVE_INFINITY;
      for (const [key, expiry] of this.ids) if (expiry < at) [soonest, at] = [key, expiry];
      if (soonest !== undefined) this.ids.delete(soonest);
    }
  }

  has(id: string, now: number): boolean {
    const expires = this.ids.get(id);
    if (expires === undefined) return false;
    if (expires <= now) {
      this.ids.delete(id);
      return false;
    }
    return true;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function hmac(secret: string, text: string): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

export function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function sessionCookie(name: string, value: string, path: string, maxAgeSeconds: number, secure = false): string {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}${secure ? "; Secure" : ""}`;
}

/**
 * Whether the browser reached the panel over TLS: what the front end knows of its own socket, or
 * what the proxy in front of it says in `x-forwarded-proto`. A cookie set on such a request carries
 * `Secure`, so the browser never sends that credential back over plain HTTP; a panel served over
 * HTTP — a loopback listener, most of them — sets it without, or the browser would drop it and
 * nobody could sign in.
 */
export function overTls(request: { secure?: boolean | undefined; headers: Readonly<Record<string, string | undefined>> }): boolean {
  if (request.secure === true) return true;
  const forwarded = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim().toLowerCase();
  return forwarded === "https";
}

/**
 * Where signed-out sessions are remembered so every replica refuses them: `auth.session.revocations`
 * or `auth.oidc.revocations`. Signing out adds the session's id until it would have expired anyway;
 * every request asks. Either method may reject: a failed `has` refuses the session, a failed `add`
 * is reported and the local list still holds it.
 */
export interface RevocationStore {
  add(id: string, expires: number): Promise<void>;
  has(id: string): Promise<boolean>;
}

/**
 * Revocations in Redis, one key per session id expiring with the session: `SET key 1 PX ttl` and
 * `EXISTS key`. ioredis's argument form by default, node-redis's with `{ style: "node-redis" }`.
 */
export function redisRevocations(redis: { set(...args: unknown[]): Promise<unknown>; exists(key: string): Promise<number> }, options: { prefix?: string | undefined; style?: "ioredis" | "node-redis" | undefined; now?: (() => number) | undefined } = {}): RevocationStore {
  const prefix = options.prefix ?? "apb:revoked:";
  const now = options.now ?? (() => Date.now());
  return {
    async add(id, expires) {
      const ttl = Math.max(1000, Math.ceil(expires - now()));
      if (options.style === "node-redis") await redis.set(prefix + id, "1", { PX: ttl });
      else await redis.set(prefix + id, "1", "PX", ttl);
    },
    has: async (id) => (await redis.exists(prefix + id)) > 0,
  };
}
