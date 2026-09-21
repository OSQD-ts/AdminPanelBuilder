/**
 * The panel as Koa middleware, over the Node handler. Adapted from hackerpot's shape.
 *
 *   app.use(koaPanel(panel, { basePath: "/admin", auth, controls: { edit: true } }));
 *
 * Requests under the base path are answered by the panel, which takes the raw response over
 * (`ctx.respond = false`); everything else goes to the next middleware. A body Koa's body parser
 * already read is handed on, since the stream is spent. Koa is described structurally, so nothing
 * here imports it.
 */
import type { AdminPanel } from "../core.js";
import type { ServeOptions } from "../server/types.js";
import { createPanelHandler, type NodeLikeRequest, type NodeLikeResponse } from "./node.js";

export interface KoaLikeContext {
  path: string;
  req: NodeLikeRequest;
  res: NodeLikeResponse;
  request?: { body?: unknown } | undefined;
  respond?: boolean | undefined;
}

export type KoaPanelMiddleware = (context: KoaLikeContext, next: () => Promise<unknown>) => Promise<unknown>;

export function koaPanel(panel: AdminPanel, options: ServeOptions = {}): KoaPanelMiddleware {
  const handler = createPanelHandler(panel, options, "koaPanel()");
  const base = handler.router.basePath;
  return async (context, next) => {
    if (base !== "" && context.path !== base && !context.path.startsWith(`${base}/`)) return next();
    context.respond = false;
    if (context.request?.body !== undefined && context.req.body === undefined) context.req.body = context.request.body;
    await new Promise<void>((resolve) => {
      const response = context.res;
      const end = response.end.bind(response);
      response.end = (body?: string) => {
        const result = end(body);
        resolve();
        return result;
      };
      // A stream never ends on its own; the middleware is done once its headers are out.
      const flush = response.flushHeaders?.bind(response);
      if (flush !== undefined) {
        response.flushHeaders = () => {
          flush();
          resolve();
        };
      }
      handler(context.req, response);
    });
    return undefined;
  };
}
