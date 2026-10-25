/**
 * The headers every request of the page carries, worked out when each request is sent.
 *
 * Two places say what they are. The listener's `requestHeaders` arrive with the schema: a fixed
 * value, or a cookie or `<meta name>` of the host page to read the value from, which is where
 * applications keep an anti-forgery token. The host page may add its own, through the
 * `<admin-panel>` element's `headers` property. Read at send time, a token that changes is sent as
 * it is now. A name a page cannot set is dropped with a warning rather than sent and refused.
 */
import type { PanelSchema } from "../types.js";

/** Headers a host page supplies: an object, or a function asked before every request. */
export type HostHeaders = Readonly<Record<string, string>> | (() => Readonly<Record<string, string>> | undefined);

/** The part of a document the resolver reads, so it can be tested without a browser. */
export interface HeaderDocument {
  readonly cookie: string;
  querySelector(selector: string): unknown;
}

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
const FORBIDDEN = /^(accept-charset|accept-encoding|connection|content-length|content-type|cookie2?|date|dnt|expect|host|keep-alive|last-event-id|origin|referer|te|trailer|transfer-encoding|upgrade|via|x-apb-on-behalf-of|proxy-.*|sec-.*|access-control-.*)$/i;

export function headerResolver(doc: HeaderDocument, sources: () => PanelSchema["requestHeaders"], host: () => HostHeaders | undefined): () => Record<string, string> {
  const warned = new Set<string>();
  const usable = (name: string, value: unknown): value is string => {
    const ok = TOKEN.test(name) && !FORBIDDEN.test(name) && typeof value === "string" && !/[\r\n]/.test(value);
    if (!ok && !warned.has(name)) {
      warned.add(name);
      console.warn(`admin-panel: the header "${name}" is not sent: a page cannot set it, or its value is not text on one line`);
    }
    return ok;
  };
  return () => {
    const out: Record<string, string> = {};
    for (const source of sources() ?? []) {
      const value = source.value ?? (source.cookie !== undefined ? readCookie(doc, source.cookie) : source.meta !== undefined ? readMeta(doc, source.meta) : undefined);
      // Nothing to read is nothing to send: the server's refusal then names the header it wanted.
      if (value !== undefined && value !== "" && usable(source.name, value)) out[source.name] = value;
    }
    const given = host();
    const extra = typeof given === "function" ? given() : given;
    if (extra !== undefined && extra !== null && typeof extra === "object") {
      for (const [name, value] of Object.entries(extra)) if (usable(name, value)) out[name.toLowerCase()] = value;
    }
    return out;
  };
}

function readCookie(doc: HeaderDocument, name: string): string | undefined {
  for (const part of doc.cookie.split(";")) {
    const at = part.indexOf("=");
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    const raw = part.slice(at + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function readMeta(doc: HeaderDocument, name: string): string | undefined {
  // The name was checked by the listener to letters, digits, "_", ".", ":" and "-", so it needs no escaping here beyond the quotes.
  const meta = doc.querySelector(`meta[name="${name}"]`) as { content?: unknown } | null;
  return typeof meta?.content === "string" ? meta.content : undefined;
}
