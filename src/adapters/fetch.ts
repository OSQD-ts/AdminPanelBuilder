/**
 * The panel as a Fetch handler: Cloudflare Workers, Deno, Bun, Hono, a Next.js route handler.
 *
 * `(request: Request) => Promise<Response>`. Uses only the Fetch globals, so it runs wherever
 * they exist. A Fetch runtime has no socket address to offer, so the throttle keys on whatever
 * `address` returns — by default nothing, which puts every caller in one bucket; pass the
 * platform's own (Cloudflare's `request.cf`, Deno's `info.remoteAddr`) to key it per client.
 */
import type { AdminPanel } from "../core.js";
import { createRouter } from "../server/router.js";
import { BodyTooLargeError, type ServeOptions } from "../server/types.js";

export interface FetchServeOptions extends ServeOptions {
  /** The client's address, from the platform. Never from a forwarded header the client wrote. */
  address?: ((request: Request) => string) | undefined;
}

export type PanelFetchHandler = (request: Request) => Promise<Response>;

export function createFetchHandler(panel: AdminPanel, options: FetchServeOptions = {}): PanelFetchHandler {
  const { address, ...serve } = options;
  const router = createRouter(panel, serve, { boundHost: undefined, where: "panel.fetchHandler()" });
  return async (request) => {
    const url = new URL(request.url);
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    const answer = await router.route({
      method: request.method,
      url: `${url.pathname}${url.search}`,
      headers,
      address: address?.(request) ?? "",
      secure: url.protocol === "https:",
      body: async (limit) => {
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > limit) throw new BodyTooLargeError(limit);
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > limit) throw new BodyTooLargeError(limit);
        return text;
      },
    });
    const head = request.method.toUpperCase() === "HEAD";
    const stream = answer.stream;
    if (stream !== undefined && !head) {
      let stop: (() => void) | undefined;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stop = stream.start({
            send: (text) => controller.enqueue(encoder.encode(text)),
            ready: () => (controller.desiredSize ?? 1) > 0,
            close: () => controller.close(),
          });
          request.signal?.addEventListener("abort", () => stop?.());
        },
        cancel() {
          stop?.();
        },
      });
      return new Response(body, { status: answer.status, headers: answer.headers });
    }
    return new Response(head || answer.status === 303 || answer.status === 302 ? null : answer.body, { status: answer.status, headers: answer.headers });
  };
}
