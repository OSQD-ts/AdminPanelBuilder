/**
 * Sign-in with an OpenID Connect provider: Google, Microsoft Entra, Okta, Keycloak, Authentik.
 *
 * The authorization code flow with PKCE. A page request with no session is sent to the provider;
 * the provider sends the operator back to `<basePath>/auth/callback` with a code; the code is
 * exchanged for an ID token, whose signature, issuer, audience, expiry and nonce are all checked
 * before `allow(claims)` decides who this is. The answer becomes a signed session cookie.
 *
 * What would make this unsafe, and how each is refused: a callback nobody started (the `state`
 * must match a signed, short-lived cookie set when the flow began); a replayed ID token (the
 * `nonce` in it must match that cookie); a token for another application (`aud`); a token from
 * another issuer (`iss`); an unsigned or HMAC-signed token (`alg` must be RS256 or ES256, verified
 * against the provider's published keys). API calls without a session get 401, not a redirect.
 */
import { AdminPanelConfigError } from "../errors.js";
import { withDeadline } from "../internal/async.js";
import { type Grants, unionGrants } from "../panel/scope.js";
import type { PanelResponse } from "./types.js";
import { base64url, checkGrants, checkSecret, fromBase64url, RevocationList, SESSION_COOKIE, type SessionInfo, seal, sessionCookie, sessionInfo, unseal } from "./session.js";

export interface OidcOptions {
  /** The provider's issuer URL, as it appears in its tokens: `https://accounts.google.com`. */
  issuer: string;
  clientId: string;
  /** For a confidential client. Sent as HTTP Basic to the token endpoint. */
  clientSecret?: string | undefined;
  /** Where this panel is reached from outside, base path included: `https://ops.example.com/admin`. */
  baseUrl: string;
  /** Signs the session and flow cookies. At least 32 characters; a list rotates, the first signing and all verifying. */
  secret: string | readonly string[];
  /** Default `["openid", "email", "profile"]`. */
  scopes?: readonly string[] | undefined;
  /**
   * Who a signed-in person is on this panel, or `false` to refuse them. Default: anyone the
   * provider signs in, named by email. Restrict it: `(claims) => claims.email?.endsWith("@example.com") ? claims.email : false`.
   */
  allow?: ((claims: Record<string, unknown>) => string | { name: string; grants?: Grants | undefined } | false | undefined) | undefined;
  /**
   * What each of the provider's groups may do here: `{ grants: { "ops-admins": { edit: true }, "support": { groups: ["Mail"] } } }`.
   * An operator in several gets what any of them allows; one in none is refused. `claim` names where
   * the provider lists groups; default `"groups"`.
   */
  groups?: { claim?: string | undefined; grants: Readonly<Record<string, Grants>> } | undefined;
  /** Whether a revoked session id is refused; asked on every request. */
  revoked?: ((id: string) => boolean | Promise<boolean>) | undefined;
  /** How long a session lasts. Default 8 hours. */
  sessionTtlMs?: number | undefined;
  fetch?: typeof fetch | undefined;
  /** For tests. */
  now?: (() => number) | undefined;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  /** RP-initiated logout, where the provider offers it. */
  end_session_endpoint?: string | undefined;
  jwks_uri: string;
  issuer: string;
}

/** A published key, as much of it as this module reads; the rest goes to `importKey` as it came. */
type Jwk = { kty?: string; kid?: string; alg?: string; use?: string } & Record<string, unknown>;

const FLOW_COOKIE = "apb_oidc";
const FLOW_TTL_MS = 10 * 60_000;
const KEY_CACHE_MS = 10 * 60_000;

export interface AuthContext {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Readonly<Record<string, string | undefined>>;
  basePath: string;
}

export function createOidc(options: OidcOptions, where: string) {
  for (const key of Object.keys(options)) {
    if (!["issuer", "clientId", "clientSecret", "baseUrl", "secret", "scopes", "allow", "groups", "revoked", "sessionTtlMs", "fetch", "now"].includes(key)) throw new AdminPanelConfigError(`${where}: auth.oidc has an option "${key}" that nothing reads`);
  }
  if (typeof options.issuer !== "string" || !/^https?:\/\//.test(options.issuer)) throw new AdminPanelConfigError(`${where}: auth.oidc.issuer must be the provider's URL`);
  if (typeof options.clientId !== "string" || options.clientId === "") throw new AdminPanelConfigError(`${where}: auth.oidc.clientId is empty`);
  if (typeof options.baseUrl !== "string" || !/^https?:\/\//.test(options.baseUrl)) throw new AdminPanelConfigError(`${where}: auth.oidc.baseUrl must be the URL this panel is reached at, base path included`);
  const secret = checkSecret(options.secret, `${where}: auth.oidc`);
  const [signing] = secret as [string];
  const groupGrants = options.groups;
  if (groupGrants !== undefined) {
    if (groupGrants === null || typeof groupGrants !== "object" || groupGrants.grants === null || typeof groupGrants.grants !== "object" || Object.keys(groupGrants.grants).length === 0) {
      throw new AdminPanelConfigError(`${where}: auth.oidc.groups.grants names no provider group, which would admit nobody`);
    }
    for (const [name, grants] of Object.entries(groupGrants.grants)) checkGrants(grants, `${where}: auth.oidc.groups.grants.${name}`);
  }
  const signedOut = new RevocationList();
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  const issuer = options.issuer.replace(/\/+$/, "");
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const ttl = options.sessionTtlMs ?? 8 * 3_600_000;
  let discovery: Promise<Discovery> | undefined;
  let keys: { at: number; set: Promise<Array<Jwk>> } | undefined;

  const discover = (): Promise<Discovery> => {
    discovery ??= getJson<Discovery>(send, `${issuer}/.well-known/openid-configuration`).catch((error: unknown) => {
      discovery = undefined;
      throw error;
    });
    return discovery;
  };
  const jwks = async (refresh: boolean): Promise<Array<Jwk>> => {
    if (refresh || keys === undefined || now() - keys.at > KEY_CACHE_MS) {
      const set = discover().then((doc) => getJson<{ keys: Array<Jwk> }>(send, doc.jwks_uri)).then((body) => body.keys ?? []);
      keys = { at: now(), set };
      set.catch(() => {
        keys = undefined;
      });
    }
    return keys.set;
  };

  return {
    async session(cookieHeader: string | undefined): Promise<SessionInfo | undefined> {
      const info = await sessionInfo(secret, readCookie(cookieHeader, SESSION_COOKIE), now());
      if (info === undefined || signedOut.has(info.id, now())) return undefined;
      const revoked = options.revoked;
      if (revoked !== undefined && (await Promise.resolve().then(() => revoked(info.id)).catch(() => true))) return undefined;
      return info;
    },

    async handle(context: AuthContext): Promise<PanelResponse | undefined> {
      const cookiePath = context.basePath || "/";
      if (context.path === "/auth/login" && context.method === "GET") {
        const doc = await discover();
        const state = random();
        const nonce = random();
        const verifier = random() + random();
        const challenge = base64url(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
        const flow = await seal(signing, { state, nonce, verifier, e: now() + FLOW_TTL_MS });
        const url = new URL(doc.authorization_endpoint);
        url.search = new URLSearchParams({
          response_type: "code",
          client_id: options.clientId,
          redirect_uri: `${baseUrl}/auth/callback`,
          scope: (options.scopes ?? ["openid", "email", "profile"]).join(" "),
          state,
          nonce,
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString();
        return redirect(url.toString(), sessionCookie(FLOW_COOKIE, flow, cookiePath, FLOW_TTL_MS / 1000));
      }
      if (context.path === "/auth/logout" && context.method === "GET") {
        const info = await sessionInfo(secret, readCookie(context.headers.cookie, SESSION_COOKIE), now());
        if (info !== undefined) signedOut.add(info.id, info.expires);
        const cleared = sessionCookie(SESSION_COOKIE, "", cookiePath, 0);
        // Signing out of the panel alone would leave the provider's session, and the next visit would
        // sign straight back in. Where the provider offers logout, it is asked too.
        let doc: Discovery | undefined;
        try {
          doc = await discover();
        } catch {
          doc = undefined;
        }
        if (doc?.end_session_endpoint !== undefined) {
          const url = new URL(doc.end_session_endpoint);
          url.searchParams.set("client_id", options.clientId);
          url.searchParams.set("post_logout_redirect_uri", `${baseUrl}/`);
          return redirect(url.toString(), cleared);
        }
        return redirect(`${context.basePath}/`, cleared);
      }
      if (context.path !== "/auth/callback" || context.method !== "GET") return undefined;
      const flow = await unseal<{ state?: string; nonce?: string; verifier?: string; e?: number }>(secret, readCookie(context.headers.cookie, FLOW_COOKIE));
      const state = context.query.get("state");
      const code = context.query.get("code");
      if (flow === undefined || typeof flow.e !== "number" || flow.e <= now() || state === null || state !== flow.state || code === null) {
        return refuse(400, "this sign-in was not started here, or took longer than ten minutes; start again");
      }
      const doc = await discover();
      const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${baseUrl}/auth/callback`, client_id: options.clientId, code_verifier: flow.verifier ?? "" });
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
      if (options.clientSecret !== undefined) headers.authorization = `Basic ${btoa(`${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`)}`;
      const response = await withDeadline(send(doc.token_endpoint, { method: "POST", headers, body: form.toString() }), 10_000, "the token endpoint");
      if (!response.ok) return refuse(502, `the provider refused the sign-in (${response.status})`);
      const token = ((await response.json()) as { id_token?: unknown }).id_token;
      if (typeof token !== "string") return refuse(502, "the provider answered without an ID token");
      let claims: Record<string, unknown>;
      try {
        claims = await verifyIdToken(token, { issuer: doc.issuer ?? issuer, audience: options.clientId, nonce: flow.nonce ?? "", now: now(), keys: jwks });
      } catch (error) {
        return refuse(401, `the ID token was refused: ${error instanceof Error ? error.message : String(error)}`);
      }
      const answer = options.allow === undefined ? (typeof claims.email === "string" ? claims.email : typeof claims.sub === "string" ? claims.sub : false) : options.allow(claims);
      const allowed = typeof answer === "object" && answer !== null ? answer.name : answer;
      if (typeof allowed !== "string" || allowed.trim() === "") return refuse(403, "you signed in, but this panel does not admit that account");
      let grants = typeof answer === "object" && answer !== null && answer.grants !== undefined ? checkGrants(answer.grants, "auth.oidc.allow") : undefined;
      if (groupGrants !== undefined) {
        const listed = claims[groupGrants.claim ?? "groups"];
        const member = (Array.isArray(listed) ? listed : typeof listed === "string" ? [listed] : []).filter((group): group is string => typeof group === "string" && Object.hasOwn(groupGrants.grants, group));
        if (member.length === 0) return refuse(403, "you signed in, but you are in none of the groups this panel admits");
        const fromGroups = unionGrants(member.map((group) => groupGrants.grants[group] as Grants));
        // `allow` may narrow further; it never widens what the groups grant.
        grants = grants === undefined ? fromGroups : { ...fromGroups, ...narrowGrants(fromGroups, grants) };
      }
      const payload: { n: string; e: number; j: string; g?: Grants } = { n: allowed, e: now() + ttl, j: random() };
      if (grants !== undefined) payload.g = grants;
      const session = await seal(signing, payload);
      return { status: 303, headers: { location: `${context.basePath}/`, "set-cookie": sessionCookie(SESSION_COOKIE, session, cookiePath, ttl / 1000), "cache-control": "no-store" }, body: "" };
    },
  };
}

/** Verifies a compact JWS ID token: RS256 or ES256, against the provider's keys, and its claims. */
export async function verifyIdToken(
  token: string,
  expected: { issuer: string; audience: string; nonce: string; now: number; keys: (refresh: boolean) => Promise<Array<Jwk>> },
): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("it is not a signed token");
  const [head, body, signature] = parts as [string, string, string];
  const header = JSON.parse(new TextDecoder().decode(fromBase64url(head))) as { alg?: string; kid?: string };
  const algorithm = header.alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : header.alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } : undefined;
  if (algorithm === undefined) throw new Error(`it is signed with ${header.alg ?? "nothing"}; only RS256 and ES256 are accepted`);
  const find = async (refresh: boolean) => (await expected.keys(refresh)).find((key) => (header.kid === undefined || key.kid === header.kid) && (header.alg === "RS256" ? key.kty === "RSA" : key.kty === "EC"));
  // A provider rotates keys; an unknown kid is worth one refresh of the key set, and no more.
  const jwk = (await find(false)) ?? (await find(true));
  if (jwk === undefined) throw new Error("no published key matches it");
  const { kid: _kid, ...keyData } = jwk;
  const key = await globalThis.crypto.subtle.importKey("jwk", keyData as never, algorithm, false, ["verify"]);
  const valid = await globalThis.crypto.subtle.verify(algorithm, key, fromBase64url(signature), new TextEncoder().encode(`${head}.${body}`));
  if (!valid) throw new Error("its signature does not verify");
  const claims = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as Record<string, unknown>;
  if (claims.iss !== expected.issuer) throw new Error(`it was issued by ${String(claims.iss)}, not ${expected.issuer}`);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(expected.audience)) throw new Error("it was issued for another application");
  const seconds = expected.now / 1000;
  if (typeof claims.exp !== "number" || claims.exp <= seconds - 60) throw new Error("it has expired");
  if (typeof claims.iat === "number" && claims.iat > seconds + 300) throw new Error("it was issued in the future");
  if (claims.nonce !== expected.nonce) throw new Error("its nonce does not match this sign-in, so it may be a replay");
  return claims;
}

/** The grants both allow. */
function narrowGrants(a: Grants, b: Grants): Grants {
  const out: Grants = {};
  if (a.groups !== undefined || b.groups !== undefined) out.groups = a.groups === undefined ? b.groups : b.groups === undefined ? a.groups : a.groups.filter((group) => (b.groups as readonly string[]).includes(group));
  for (const key of ["edit", "actions"] as const) {
    const [x, y] = [a[key], b[key]];
    if (x === undefined || x === true) out[key] = y ?? x;
    else if (y === undefined || y === true) out[key] = x;
    else if (x === false || y === false) out[key] = false;
    else out[key] = x.filter((group) => y.includes(group));
  }
  return out;
}

async function getJson<T>(send: typeof fetch, url: string): Promise<T> {
  const response = await withDeadline(send(url, { headers: { accept: "application/json" } }), 10_000, url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

function random(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function redirect(location: string, cookie: string): PanelResponse {
  return { status: 302, headers: { location, "set-cookie": cookie, "cache-control": "no-store", "referrer-policy": "no-referrer" }, body: "" };
}

function refuse(status: number, error: string): PanelResponse {
  return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify({ error }) };
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}
