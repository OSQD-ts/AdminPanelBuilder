/**
 * Builders several suites were already writing identically: a panel on a manual clock, a
 * request as the router sees it, and a router over a panel.
 */
import { createAdminPanel, ManualClock, type AdminPanel, type AdminPanelOptions } from "../src/index.js";
import { createRouter, type Router } from "../src/server/router.js";
import type { PanelRequest, ServeOptions } from "../src/server/types.js";

export const TOKEN = "a-token-that-is-long-enough";

export function panelAt(start = 1_000_000, options: AdminPanelOptions = {}): { panel: AdminPanel; clock: ManualClock } {
  const clock = new ManualClock(start);
  const errors: unknown[] = [];
  const panel = createAdminPanel({ clock, onError: (error) => errors.push(error), ...options });
  return { panel, clock };
}

export function request(method: string, url: string, init: { headers?: Record<string, string>; body?: string; address?: string } = {}): PanelRequest {
  const headers: Record<string, string | undefined> = { host: "127.0.0.1:9780", ...lower(init.headers ?? {}) };
  return {
    method,
    url,
    headers,
    address: init.address ?? "127.0.0.1",
    body: async (limit) => {
      const text = init.body ?? "";
      if (new TextEncoder().encode(text).byteLength > limit) {
        const { BodyTooLargeError } = await import("../src/server/types.js");
        throw new BodyTooLargeError(limit);
      }
      return text;
    },
  };
}

export const bearer = { authorization: `Bearer ${TOKEN}` };
export const jsonWrite = { ...bearer, "content-type": "application/json" };

export function routerFor(panel: AdminPanel, options: ServeOptions = {}, boundHost: string | undefined = "127.0.0.1"): Router {
  return createRouter(panel, options, { boundHost, where: "test" });
}

export async function call(router: Router, method: string, url: string, init: Parameters<typeof request>[2] = {}): Promise<{ status: number; headers: Record<string, string>; body: string; json: any }> {
  const response = await router.route(request(method, url, init));
  let json: unknown;
  try {
    json = JSON.parse(response.body);
  } catch {
    json = undefined;
  }
  return { ...response, json };
}

function lower(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}
