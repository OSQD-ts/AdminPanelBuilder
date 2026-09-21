/**
 * The panel as a Fastify route handler, over the Node handler.
 *
 *   fastify.all("/admin", fastifyPanel(panel, { basePath: "/admin", auth }));
 *   fastify.all("/admin/*", fastifyPanel(panel, { basePath: "/admin", auth }));
 *
 * The handler hijacks the reply and answers on the raw response; a body Fastify parsed is handed
 * on. Fastify is described structurally, so nothing here imports it.
 */
import type { AdminPanel } from "../core.js";
import type { ServeOptions } from "../server/types.js";
import { createPanelHandler, type NodeLikeRequest, type NodeLikeResponse } from "./node.js";

export interface FastifyLikeRequest {
  raw: NodeLikeRequest;
  body?: unknown;
}

export interface FastifyLikeReply {
  raw: NodeLikeResponse;
  hijack(): unknown;
}

export type FastifyPanelHandler = (request: FastifyLikeRequest, reply: FastifyLikeReply) => void;

export function fastifyPanel(panel: AdminPanel, options: ServeOptions = {}): FastifyPanelHandler {
  const handler = createPanelHandler(panel, options, "fastifyPanel()");
  return (request, reply) => {
    reply.hijack();
    if (request.body !== undefined && request.raw.body === undefined) request.raw.body = request.body;
    handler(request.raw, reply.raw);
  };
}
