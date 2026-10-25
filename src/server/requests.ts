/**
 * Who may write, judged before credentials are: the origin a write came from, the anti-forgery
 * token it carries, and the headers the page is told to send with every request.
 *
 * Each option is checked once, when the listener is built, and refused there with a sentence
 * naming it: an allowed origin that is not an origin, a proxy range that matches nothing, a
 * header a browser will not let a page set — each would look configured and do nothing.
 */
import { AdminPanelConfigError } from "../errors.js";
import { IpRangeSet, normalizeIp, stripPort } from "../internal/ip.js";
import type { AuthRequest, CsrfOptions, RequestHeaderSource } from "./types.js";

/** What a write's origin is compared with. */
export interface OriginPolicy {
  /** Exactly these origins, when set: `https://admin.example.com`. */
  origins: ReadonlySet<string> | undefined;
  /** Proxies whose `X-Forwarded-Host` and `X-Forwarded-Proto` are believed. */
  proxies: IpRangeSet | undefined;
}

export type OriginVerdict = { ok: true } | { ok: false; origin: string; expected: string };

/** The listener's origin policy, refusing an entry that is not an origin or not an address. */
export function resolveOriginPolicy(allowedOrigins: readonly string[] | undefined, trustedProxies: readonly string[] | undefined, where: string): OriginPolicy {
  let origins: Set<string> | undefined;
  if (allowedOrigins !== undefined) {
    if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) throw new AdminPanelConfigError(`${where}: allowedOrigins is empty, which would refuse every write from a browser; leave it out to compare with the Host header`);
    origins = new Set(allowedOrigins.map((entry) => checkOrigin(entry, where)));
  }
  let proxies: IpRangeSet | undefined;
  if (trustedProxies !== undefined) {
    if (!Array.isArray(trustedProxies) || trustedProxies.length === 0) throw new AdminPanelConfigError(`${where}: trustedProxies is empty; leave it out, or list the addresses or CIDRs of the proxies in front of this panel`);
    proxies = new IpRangeSet(trustedProxies.map((entry) => (typeof entry === "string" ? entry.trim() : String(entry))));
    if (proxies.invalid.length > 0) {
      throw new AdminPanelConfigError(`${where}: trustedProxies contains entries that are not addresses or CIDRs: ${proxies.invalid.join(", ")}. A range that matches nothing is a proxy that is never believed`);
    }
  }
  return { origins, proxies };
}

/** `https://admin.example.com`, as `URL.origin` writes it: lower-cased, default port dropped. */
function checkOrigin(entry: unknown, where: string): string {
  if (typeof entry !== "string") throw new AdminPanelConfigError(`${where}: every entry in allowedOrigins is a string like "https://admin.example.com"`);
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new AdminPanelConfigError(`${where}: ${JSON.stringify(entry)} in allowedOrigins is not an origin; write it as "https://admin.example.com"`);
  }
  const bare = url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !bare) {
    throw new AdminPanelConfigError(`${where}: ${JSON.stringify(entry)} in allowedOrigins is not an origin: an origin is a scheme and a host, like "https://admin.example.com", with no path`);
  }
  return url.origin;
}

/**
 * Whether a write was addressed by the panel's own page. A browser names the page a write came
 * from in `Origin` (and `Sec-Fetch-Site`); a client that is not a browser sends neither, and is
 * judged by its credentials alone.
 *
 * The page's origin is the one in `allowedOrigins` when the listener names some. Otherwise it is the
 * `Host` header, or — when the connection comes from a `trustedProxies` address — the host and
 * scheme that proxy forwarded, because a proxy that rewrites `Host` would otherwise make every
 * write from the real page look like it came from somewhere else.
 */
export function checkOriginOf(request: { headers: Readonly<Record<string, string | undefined>>; address: string; secure?: boolean | undefined }, policy: OriginPolicy): OriginVerdict {
  const site = request.headers["sec-fetch-site"];
  const origin = request.headers.origin;
  if (site !== undefined && site !== "same-origin" && site !== "none") return { ok: false, origin: origin ?? site, expected: expectedOf(request, policy) };
  if (origin === undefined) return { ok: true };
  let parsed: URL;
  try {
    if (origin === "null") throw new Error("opaque");
    parsed = new URL(origin);
  } catch {
    return { ok: false, origin, expected: expectedOf(request, policy) };
  }
  if (policy.origins !== undefined) return policy.origins.has(parsed.origin) ? { ok: true } : { ok: false, origin: parsed.origin, expected: expectedOf(request, policy) };
  const forwarded = forwardedOf(request, policy);
  if (forwarded !== undefined) {
    const sameHost = parsed.host.toLowerCase() === forwarded.host;
    const sameScheme = forwarded.proto === undefined || parsed.protocol === `${forwarded.proto}:`;
    return sameHost && sameScheme ? { ok: true } : { ok: false, origin: parsed.origin, expected: expectedOf(request, policy) };
  }
  return parsed.host.toLowerCase() === (request.headers.host ?? "").toLowerCase() ? { ok: true } : { ok: false, origin: parsed.origin, expected: expectedOf(request, policy) };
}

/** The host and scheme a trusted proxy forwarded, or undefined when the peer is not one of them. */
function forwardedOf(request: { headers: Readonly<Record<string, string | undefined>>; address: string }, policy: OriginPolicy): { host: string; proto: string | undefined } | undefined {
  if (policy.proxies === undefined) return undefined;
  const peer = normalizeIp(stripPort(request.address));
  if (peer === null || !policy.proxies.contains(peer)) return undefined;
  // The rightmost entry is the one the nearest proxy — ours — wrote; anything left of it came from further out.
  const host = lastEntry(request.headers["x-forwarded-host"])?.toLowerCase();
  if (host === undefined) return undefined;
  const proto = lastEntry(request.headers["x-forwarded-proto"])?.toLowerCase();
  return { host, proto: proto === "http" || proto === "https" ? proto : undefined };
}

function lastEntry(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const entries = value
    .slice(0, 1024)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return entries[entries.length - 1];
}

/** What the page's origin was taken to be, for the sentence that refuses a write. */
function expectedOf(request: { headers: Readonly<Record<string, string | undefined>>; address: string; secure?: boolean | undefined }, policy: OriginPolicy): string {
  if (policy.origins !== undefined) return [...policy.origins].join(", ");
  const forwarded = forwardedOf(request, policy);
  if (forwarded !== undefined) return `${forwarded.proto ?? (request.secure === true ? "https" : "http")}://${forwarded.host}`;
  const host = request.headers.host ?? "";
  return host === "" ? "(no Host header)" : `${request.secure === true ? "https" : "http"}://${host}`;
}

// -------------------------------------------------------------------------------------------
// Headers the page sends
// -------------------------------------------------------------------------------------------

/** A header name as RFC 9110 writes a token. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
/**
 * Names a page cannot set (a browser drops them, so the option would do nothing) or must not (they
 * belong to the transport, to this panel, or to the browser's own judgement of the request).
 */
const FORBIDDEN = new Set([
  "accept-charset",
  "accept-encoding",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "last-event-id",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
  "x-apb-on-behalf-of",
]);
const FORBIDDEN_PREFIXES = ["proxy-", "sec-", "access-control-"];
/** A value a header may carry: printable ASCII, no line breaks. */
const VALUE = /^[\t\x20-\x7e]{0,4096}$/;
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const META_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A header name, lower-cased, or a refusal naming why it cannot be one. */
export function checkHeaderName(name: unknown, where: string, option: string): string {
  if (typeof name !== "string" || !TOKEN.test(name)) throw new AdminPanelConfigError(`${where}: ${JSON.stringify(name)} in ${option} is not a header name`);
  const lower = name.toLowerCase();
  if (FORBIDDEN.has(lower) || FORBIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    throw new AdminPanelConfigError(`${where}: ${option} names "${name}", which a page cannot set (the browser or this panel owns it)`);
  }
  return lower;
}

/** One header the page sends, as the schema carries it: a fixed value, or where to read one. */
export interface HeaderSource {
  name: string;
  value?: string;
  cookie?: string;
  meta?: string;
}

/** The listener's `requestHeaders`, and the anti-forgery header when its token is read from a cookie. */
export function resolveHeaderSources(headers: Readonly<Record<string, RequestHeaderSource>> | undefined, csrf: ResolvedCsrf | undefined, where: string): HeaderSource[] {
  const out: HeaderSource[] = [];
  if (headers !== undefined) {
    if (headers === null || typeof headers !== "object" || Array.isArray(headers)) throw new AdminPanelConfigError(`${where}: requestHeaders is an object of header names`);
    for (const [name, source] of Object.entries(headers)) {
      const header = checkHeaderName(name, where, "requestHeaders");
      if (out.some((entry) => entry.name === header)) throw new AdminPanelConfigError(`${where}: requestHeaders names "${name}" twice`);
      out.push({ name: header, ...checkSource(source, `${where}: requestHeaders["${name}"]`) });
    }
  }
  // The token in a cookie is read by the page and sent back in the header: nothing to configure twice.
  if (csrf?.cookie !== undefined && !out.some((entry) => entry.name === csrf.header)) out.push({ name: csrf.header, cookie: csrf.cookie });
  return out;
}

function checkSource(source: unknown, where: string): Omit<HeaderSource, "name"> {
  if (typeof source === "string") {
    if (!VALUE.test(source)) throw new AdminPanelConfigError(`${where} is not a header value: printable text without line breaks, at most 4096 characters`);
    return { value: source };
  }
  if (source !== null && typeof source === "object" && !Array.isArray(source)) {
    const keys = Object.keys(source);
    const entry = source as { cookie?: unknown; meta?: unknown };
    if (keys.length === 1 && keys[0] === "cookie") {
      if (typeof entry.cookie !== "string" || !COOKIE_NAME.test(entry.cookie)) throw new AdminPanelConfigError(`${where}.cookie is not a cookie name`);
      return { cookie: entry.cookie };
    }
    if (keys.length === 1 && keys[0] === "meta") {
      if (typeof entry.meta !== "string" || !META_NAME.test(entry.meta)) throw new AdminPanelConfigError(`${where}.meta is not a <meta name>: letters, digits, "_", ".", ":" and "-"`);
      return { meta: entry.meta };
    }
  }
  throw new AdminPanelConfigError(`${where} is a fixed value, { cookie: "<name>" } or { meta: "<name>" }`);
}

// -------------------------------------------------------------------------------------------
// The anti-forgery check
// -------------------------------------------------------------------------------------------

export interface ResolvedCsrf {
  header: string;
  cookie: string | undefined;
  verify: CsrfOptions["verify"];
}

export function resolveCsrf(csrf: CsrfOptions | undefined, where: string): ResolvedCsrf | undefined {
  if (csrf === undefined) return undefined;
  if (csrf === null || typeof csrf !== "object") throw new AdminPanelConfigError(`${where}: csrf is { header, cookie } or { header, verify }`);
  for (const key of Object.keys(csrf)) if (key !== "header" && key !== "cookie" && key !== "verify") throw new AdminPanelConfigError(`${where}: csrf has no option "${key}"; it takes header, and cookie or verify`);
  const header = checkHeaderName(csrf.header, where, "csrf.header");
  const hasCookie = csrf.cookie !== undefined;
  const hasVerify = csrf.verify !== undefined;
  if (hasCookie === hasVerify) throw new AdminPanelConfigError(`${where}: csrf takes exactly one of cookie (the double-submit check) and verify (your own)`);
  if (hasCookie && (typeof csrf.cookie !== "string" || !COOKIE_NAME.test(csrf.cookie))) throw new AdminPanelConfigError(`${where}: csrf.cookie is not a cookie name`);
  if (hasVerify && typeof csrf.verify !== "function") throw new AdminPanelConfigError(`${where}: csrf.verify is a function from the token and the request to true or false`);
  return { header, cookie: csrf.cookie, verify: csrf.verify };
}

/**
 * Whether a write carries its anti-forgery token. A request with a bearer token is exempt: no
 * browser attaches one by itself, so a forged request cannot carry it.
 */
export async function checkCsrf(csrf: ResolvedCsrf, request: AuthRequest): Promise<boolean> {
  if (/^bearer\s/i.test(request.headers.authorization ?? "")) return true;
  const token = request.headers[csrf.header];
  if (token === undefined || token === "") return false;
  if (csrf.verify !== undefined) {
    try {
      return (await csrf.verify(token, request)) === true;
    } catch {
      return false;
    }
  }
  const cookie = readCookie(request.headers.cookie, csrf.cookie as string);
  return cookie !== undefined && cookie !== "" && sameText(cookie, token);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim() !== name) continue;
    const raw = part.slice(at + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/** Compares in time that does not depend on where the strings first differ. */
function sameText(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return difference === 0;
}
