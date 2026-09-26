/**
 * The panel mounted on a Node server: Express, Connect, or `node:http` directly.
 *
 * `app.use("/admin", panel.handler({ basePath: "/admin", auth }))` — the router accepts paths
 * with or without the prefix, so it works whether or not the framework strips it.
 *
 * Nothing here imports `node:http`: the request and response are described structurally, so a
 * test double that satisfies these interfaces is exactly the contract, and a framework whose
 * objects extend Node's works without an adapter of its own.
 *
 * The handler never rejects into the host application. An async middleware that rejects is
 * not caught by Express 4 and the request hangs until it times out; every failure here becomes
 * a response instead, and a failure to even write one is reported on the panel's error channel.
 */
import type { AdminPanel } from "../core.js";
import { createRouter, type Router } from "../server/router.js";
import { BodyTooLargeError, type PanelRequest, type PanelResponse, type ServeOptions } from "../server/types.js";

/** The parts of `http.IncomingMessage` the handler reads. */
export interface NodeLikeRequest {
  method?: string | undefined;
  url?: string | undefined;
  /** Express rewrites `url` under a mount point and keeps the original here. */
  originalUrl?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | undefined; encrypted?: boolean | undefined } | undefined;
  on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  /** A parsed body a framework already consumed the stream for (express.json()). */
  body?: unknown;
}

/** The parts of `http.ServerResponse` the handler writes. The last three are only needed for streaming. */
export interface NodeLikeResponse {
  headersSent?: boolean | undefined;
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
  write?(chunk: string): unknown;
  writableNeedDrain?: boolean | undefined;
  flushHeaders?(): void;
  on?(event: "close", listener: () => void): unknown;
}

export type PanelRequestHandler = ((request: NodeLikeRequest, response: NodeLikeResponse, next?: (error?: unknown) => void) => void) & { readonly router: Router };

export function createPanelHandler(panel: AdminPanel, options?: ServeOptions, where = "panel.handler()"): PanelRequestHandler {
  const router = createRouter(panel, options, { boundHost: undefined, where });
  return nodeHandler(panel, router);
}

/** @internal Shared with the listener, which builds its router with the address it is bound to. */
export function nodeHandler(panel: AdminPanel, router: Router): PanelRequestHandler {
  const handler = (request: NodeLikeRequest, response: NodeLikeResponse): void => {
    router
      .route(toPanelRequest(request))
      .then((answer) => write(response, answer, (request.method ?? "GET").toUpperCase() === "HEAD", request))
      .catch((error: unknown) => {
        panel.reportError(error, "writing a panel response");
        try {
          if (response.headersSent !== true) {
            response.statusCode = 500;
            response.end();
          }
        } catch {
          // The connection is gone; there is nobody left to tell.
        }
      });
  };
  return Object.assign(handler, { router });
}

function toPanelRequest(request: NodeLikeRequest): PanelRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  return {
    method: request.method ?? "GET",
    url: request.originalUrl ?? request.url ?? "/",
    headers,
    address: request.socket?.remoteAddress ?? "",
    // `encrypted` is what a TLS socket has and a plain one does not.
    secure: request.socket?.encrypted === true,
    body: (limit) => readBody(request, limit),
  };
}

function readBody(request: NodeLikeRequest, limit: number): Promise<string> {
  // express.json() and friends have consumed the stream already and left the result here.
  if (request.body !== undefined) {
    const text = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    return text.length > limit ? Promise.reject(new BodyTooLargeError(limit)) : Promise.resolve(text);
  }
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let done = false;
    request.on("data", (chunk) => {
      if (done) return;
      const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
      size += bytes.byteLength;
      if (size > limit) {
        done = true;
        reject(new BodyTooLargeError(limit));
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      if (done) return;
      done = true;
      const all = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(new TextDecoder().decode(all));
    });
    request.on("error", (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

function write(response: NodeLikeResponse, answer: PanelResponse, head: boolean, request: NodeLikeRequest): void {
  if (response.headersSent === true) return;
  response.statusCode = answer.status;
  for (const [name, value] of Object.entries(answer.headers)) response.setHeader(name, value);
  const stream = answer.stream;
  // A response object that cannot write in pieces cannot stream; the page falls back to polling.
  if (stream === undefined || head || response.write === undefined) {
    response.end(head || stream !== undefined ? undefined : answer.body);
    return;
  }
  response.flushHeaders?.();
  const stop = stream.start({
    send: (text) => void response.write?.(text),
    ready: () => response.writableNeedDrain !== true,
    close: () => void response.end(),
  });
  const onClose = (): void => stop();
  response.on?.("close", onClose);
  (request as { on(event: "close", listener: () => void): unknown }).on("close", onClose);
}
