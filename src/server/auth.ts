/**
 * Who is asking, and whether they have asked wrongly too often.
 *
 * Credentials are compared in constant time over SHA-256 digests, so neither the length nor
 * the content of a guess changes how long the answer takes. Web Crypto rather than
 * `node:crypto`, because this runs behind the Fetch adapter too, on runtimes without Node's
 * modules.
 */
import { AdminPanelConfigError } from "../errors.js";
import type { Clock } from "../internal/clock.js";
import { rejectUnknown } from "../internal/options.js";
import type { Grants } from "../panel/scope.js";
import { type AuthContext, createOidc } from "./oidc.js";
import { checkGrants, checkSecret, RevocationList, SESSION_COOKIE, sessionCookie, sessionInfo } from "./session.js";
import type { AuthRequest, PanelAuth, PanelResponse } from "./types.js";

/** The header a delegate token names the operator it acts for in. */
export const ON_BEHALF_HEADER = "x-apb-on-behalf-of";

/** Shorter tokens are refused at construction: sixteen characters is the floor the sibling libraries hold too. */
export const MIN_TOKEN_LENGTH = 16;

/** The cookie a browser holds after opening the panel once with `?token=`. */
export const TOKEN_COOKIE = "apb_token";

export type AuthResult = { ok: true; actor: string; grants?: Grants | undefined } | { ok: false; challenge?: string; redirect?: string; setCookie?: string };

export interface Authenticator {
  readonly kind: "none" | "token" | "basic" | "check" | "session" | "oidc";
  authenticate(request: AuthRequest): Promise<AuthResult>;
  /** Whether `candidate` is one of the tokens, for the `?token=` exchange. */
  isToken(candidate: string): Promise<string | undefined>;
  /** Routes the authenticator answers itself, before any other: a sign-in flow's own paths. */
  handle?(context: AuthContext & { address: string }, actor: string | undefined): Promise<PanelResponse | undefined>;
}

export function createAuthenticator(auth: PanelAuth | undefined, where: string): Authenticator {
  if (auth === undefined) {
    return { kind: "none", authenticate: async () => ({ ok: true, actor: "anonymous" }), isToken: async () => undefined };
  }
  if (auth === null || typeof auth !== "object") throw new AdminPanelConfigError(`${where}: auth must be an object ({ token }, { tokens }, { basic } or { check })`);
  const keys = Object.keys(auth);
  const kinds = keys.filter((key) => ["token", "tokens", "basic", "check", "session", "oidc"].includes(key));
  if (kinds.length !== 1) throw new AdminPanelConfigError(`${where}: auth takes exactly one of token, tokens, basic, check, session or oidc (got ${keys.join(", ") || "nothing"})`);

  if ("session" in auth) {
    rejectUnknown(auth, ["session"], `${where}: auth`);
    rejectUnknown(auth.session, ["secret", "cookie", "revoked", "now"], `${where}: auth.session`);
    const secret = checkSecret(auth.session.secret, `${where}: auth.session`);
    const cookie = auth.session.cookie ?? SESSION_COOKIE;
    const revoked = auth.session.revoked;
    if (revoked !== undefined && typeof revoked !== "function") throw new AdminPanelConfigError(`${where}: auth.session.revoked must be a function of a session id`);
    const now = auth.session.now ?? (() => Date.now());
    const signedOut = new RevocationList();
    const read = async (header: string | undefined) => {
      const info = await sessionInfo(secret, readCookie(header, cookie), now());
      if (info === undefined || signedOut.has(info.id, now())) return undefined;
      // A revocation check that fails has not admitted anybody.
      if (revoked !== undefined && (await Promise.resolve().then(() => revoked(info.id)).catch(() => true))) return undefined;
      return info;
    };
    return {
      kind: "session",
      isToken: async () => undefined,
      async authenticate(request) {
        const info = await read(request.headers.cookie);
        return info === undefined ? { ok: false } : { ok: true, actor: info.name, grants: info.grants };
      },
      async handle(context) {
        if (context.path !== "/auth/logout") return undefined;
        const info = await read(context.headers.cookie);
        if (info !== undefined) signedOut.add(info.id, info.expires);
        return { status: 303, headers: { location: `${context.basePath}/`, "set-cookie": sessionCookie(cookie, "", context.basePath || "/", 0), "cache-control": "no-store" }, body: "" };
      },
    };
  }

  if ("oidc" in auth) {
    rejectUnknown(auth, ["oidc"], `${where}: auth`);
    const oidc = createOidc(auth.oidc, where);
    return {
      kind: "oidc",
      isToken: async () => undefined,
      async authenticate(request) {
        const info = await oidc.session(request.headers.cookie);
        return info === undefined ? { ok: false, redirect: "auth/login" } : { ok: true, actor: info.name, grants: info.grants };
      },
      handle: (context) => oidc.handle(context),
    };
  }

  if ("token" in auth || "tokens" in auth) {
    const grantsOf = new Map<string, Grants>();
    const entries: Array<[string, string]> =
      "token" in auth
        ? [[auth.name ?? "token", auth.token]]
        : Object.entries(auth.tokens).map(([name, entry]) => {
            if (entry !== null && typeof entry === "object") {
              rejectUnknown(entry, ["token", "grants"], `${where}: auth.tokens.${name}`);
              if (entry.grants !== undefined) grantsOf.set(name, checkGrants(entry.grants, `${where}: auth.tokens.${name}`));
              return [name, entry.token] as [string, string];
            }
            return [name, entry as string];
          });
    if ("token" in auth) rejectUnknown(auth, ["token", "name"], `${where}: auth`);
    else rejectUnknown(auth, ["tokens", "delegates"], `${where}: auth`);
    const delegates = new Set("delegates" in auth && auth.delegates !== undefined ? auth.delegates : []);
    for (const name of delegates) if (!entries.some(([entry]) => entry === name)) throw new AdminPanelConfigError(`${where}: auth.delegates names "${name}", which is not one of the tokens, so it would delegate nothing`);
    if (entries.length === 0) throw new AdminPanelConfigError(`${where}: auth.tokens is empty, which would admit nobody while looking configured`);
    for (const [name, token] of entries) {
      if (typeof name !== "string" || name.trim() === "") throw new AdminPanelConfigError(`${where}: every token needs a name; it is who the change history says made each change`);
      if (typeof token !== "string" || token.length < MIN_TOKEN_LENGTH) {
        throw new AdminPanelConfigError(`${where}: the token for "${name}" is ${typeof token === "string" ? token.length : 0} characters; a token must be at least ${MIN_TOKEN_LENGTH}, because a short one can be guessed`);
      }
    }
    const digests = Promise.all(entries.map(async ([name, token]) => ({ name, digest: await digest(token) })));
    const find = async (candidate: string): Promise<string | undefined> => {
      const wanted = await digest(candidate);
      let found: string | undefined;
      // Every entry is compared, so the time taken does not say which one matched.
      for (const entry of await digests) if (equalBytes(entry.digest, wanted) && found === undefined) found = entry.name;
      return found;
    };
    return {
      kind: "token",
      isToken: find,
      async authenticate(request) {
        const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1]?.trim();
        const candidate = bearer ?? readCookie(request.headers.cookie, TOKEN_COOKIE);
        if (candidate === undefined || candidate === "") return { ok: false };
        const name = await find(candidate);
        if (name === undefined) return { ok: false };
        // A delegate (a remote panel in front of this one) says whom it acts for; anyone else cannot.
        const onBehalf = request.headers[ON_BEHALF_HEADER];
        if (onBehalf !== undefined && delegates.has(name)) {
          const operator = onBehalf.replace(/[^\p{L}\p{N} ._@+-]/gu, "").slice(0, 64).trim();
          if (operator !== "") return { ok: true, actor: `${operator} via ${name}`, grants: grantsOf.get(name) };
        }
        return { ok: true, actor: name, grants: grantsOf.get(name) };
      },
    };
  }

  if ("basic" in auth) {
    const users = Array.isArray(auth.basic) ? auth.basic : [auth.basic];
    if (users.length === 0) throw new AdminPanelConfigError(`${where}: auth.basic lists no users, which would admit nobody while looking configured`);
    for (const user of users as ReadonlyArray<{ username: string; password: string }>) {
      rejectUnknown(user, ["username", "password"], `${where}: auth.basic`);
      if (typeof user.username !== "string" || user.username === "" || user.username.includes(":")) throw new AdminPanelConfigError(`${where}: a basic-auth username must be non-empty and contain no colon`);
      if (typeof user.password !== "string" || user.password === "") throw new AdminPanelConfigError(`${where}: the basic-auth password for "${user.username}" is empty`);
    }
    const digests = Promise.all(users.map(async (user) => ({ name: user.username, digest: await digest(`${user.username}:${user.password}`) })));
    return {
      kind: "basic",
      isToken: async () => undefined,
      async authenticate(request) {
        const encoded = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(request.headers.authorization ?? "")?.[1];
        const challenge = 'Basic realm="admin panel", charset="UTF-8"';
        if (encoded === undefined) return { ok: false, challenge };
        let decoded: string;
        try {
          decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
        } catch {
          return { ok: false, challenge };
        }
        const wanted = await digest(decoded);
        let found: string | undefined;
        for (const entry of await digests) if (equalBytes(entry.digest, wanted) && found === undefined) found = entry.name;
        return found === undefined ? { ok: false, challenge } : { ok: true, actor: found };
      },
    };
  }

  if ("check" in auth) {
    if (typeof auth.check !== "function") throw new AdminPanelConfigError(`${where}: auth.check must be a function returning the operator's name`);
    const check = auth.check;
    return {
      kind: "check",
      isToken: async () => undefined,
      async authenticate(request) {
        let actor: unknown;
        try {
          actor = await check(request);
        } catch {
          // A check that throws has not admitted anybody.
          return { ok: false };
        }
        if (typeof actor === "string") return actor.trim() !== "" ? { ok: true, actor } : { ok: false };
        if (actor !== null && typeof actor === "object") {
          const { name, grants } = actor as { name?: unknown; grants?: Grants };
          if (typeof name !== "string" || name.trim() === "") return { ok: false };
          try {
            return { ok: true, actor: name, grants: grants === undefined ? undefined : checkGrants(grants, "auth.check") };
          } catch {
            // Grants the panel cannot read admit nobody rather than everything.
            return { ok: false };
          }
        }
        return { ok: false };
      },
    };
  }

  throw new AdminPanelConfigError(`${where}: auth takes one of token, tokens, basic, check, session or oidc (got ${keys.join(", ")})`);
}

/**
 * Failed authentications per address, bounded.
 *
 * Keyed by the socket address, which a client cannot choose. Bounded at `MAX_TRACKED`: past it
 * the address that failed longest ago is forgotten first, because it is the one least likely
 * to be the one still guessing. 4,096 addresses at roughly 100 bytes each is under half a
 * megabyte.
 */
const MAX_TRACKED = 4096;

export class AuthThrottle {
  private readonly failures = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  /** Seconds until the address may try again, or 0 when it may now. */
  retryAfter(address: string): number {
    const entry = this.failures.get(address);
    if (entry === undefined) return 0;
    const elapsed = this.clock.now() - entry.since;
    if (elapsed >= this.windowMs) {
      this.failures.delete(address);
      return 0;
    }
    return entry.count >= this.limit ? Math.ceil((this.windowMs - elapsed) / 1000) : 0;
  }

  fail(address: string): void {
    const now = this.clock.now();
    const entry = this.failures.get(address);
    if (entry === undefined || now - entry.since >= this.windowMs) {
      this.failures.delete(address);
      this.failures.set(address, { count: 1, since: now });
      if (this.failures.size > MAX_TRACKED) {
        const oldest = this.failures.keys().next().value;
        if (oldest !== undefined) this.failures.delete(oldest);
      }
      return;
    }
    entry.count += 1;
  }

  succeed(address: string): void {
    this.failures.delete(address);
  }
}

/**
 * Where a throttle keeps its counts when several replicas must share them, so an address cannot
 * spread its guesses across them. Every method may reject; the throttle then lets the request
 * through to authentication, which still has to succeed, and reports the failure.
 */
export interface ThrottleStore {
  /** Counts one failure for `key`, returning the failures in the current window and the milliseconds left in it. */
  fail(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
  /** The failures in the current window, or undefined when there is none. */
  peek(key: string): Promise<{ count: number; resetMs: number } | undefined>;
  clear(key: string): Promise<void>;
}

/** The few Redis commands a shared throttle uses; ioredis and node-redis both fit. */
export interface RedisThrottleLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

/** A throttle store in Redis: one counter per address, expiring with its window. */
export function redisThrottleStore(redis: RedisThrottleLike, prefix = "apb:throttle:"): ThrottleStore {
  return {
    async fail(key, windowMs) {
      const name = prefix + key;
      const count = await redis.incr(name);
      if (count === 1) await redis.pexpire(name, windowMs);
      let resetMs = await redis.pttl(name);
      // A counter that lost its expiry (a crash between INCR and PEXPIRE) would lock the address out for good.
      if (resetMs < 0) {
        await redis.pexpire(name, windowMs);
        resetMs = windowMs;
      }
      return { count, resetMs };
    },
    async peek(key) {
      const name = prefix + key;
      const raw = await redis.get(name);
      if (raw === null) return undefined;
      const resetMs = await redis.pttl(name);
      return { count: Number(raw) || 0, resetMs: Math.max(0, resetMs) };
    },
    async clear(key) {
      await redis.del(prefix + key);
    },
  };
}

/** What the router asks of a throttle, in memory or shared. */
export interface Throttle {
  retryAfter(address: string): number | Promise<number>;
  fail(address: string): void | Promise<void>;
  succeed(address: string): void | Promise<void>;
}

/** A throttle whose counts live in a `ThrottleStore`. */
export class SharedThrottle implements Throttle {
  /** Addresses last seen with failures, so a successful sign-in costs a round trip only when there is something to clear. */
  private readonly failing = new Set<string>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly store: ThrottleStore,
    private readonly onError: (error: unknown) => void,
  ) {}

  async retryAfter(address: string): Promise<number> {
    try {
      const entry = await this.store.peek(address);
      if (entry === undefined) this.failing.delete(address);
      else if (this.failing.size < MAX_TRACKED) this.failing.add(address);
      return entry !== undefined && entry.count >= this.limit ? Math.max(1, Math.ceil(entry.resetMs / 1000)) : 0;
    } catch (error) {
      this.onError(error);
      return 0;
    }
  }

  async fail(address: string): Promise<void> {
    if (this.failing.size < MAX_TRACKED) this.failing.add(address);
    await this.store.fail(address, this.windowMs).then(() => undefined, this.onError);
  }

  async succeed(address: string): Promise<void> {
    if (!this.failing.delete(address)) return;
    await this.store.clear(address).catch(this.onError);
  }
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Constant time for equal lengths, and SHA-256 digests are always equal in length. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] as number) ^ (b[i] as number);
  return difference === 0;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
