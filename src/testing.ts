/**
 * `@osqd/admin-panel-builder/testing`: test your own panel the way this library tests itself.
 *
 *   import { testPanel } from "@osqd/admin-panel-builder/testing";
 *   const { panel, clock, request, as } = testPanel({ serve: { auth: { token: "a-token-long-enough-1" }, controls: { edit: true } } });
 *   declareMyPanel(panel);
 *   const answer = await request("POST", "/api/values/max-players", { value: 5 }, as("a-token-long-enough-1"));
 *   expect(answer.status).toBe(400);
 *
 * A panel on a `ManualClock`, and a request helper that goes through the same router every
 * listener uses — authentication, scopes, the same-origin check, the refusals — without a socket.
 * Errors the panel isolates are collected in `errors` rather than printed, so a test can assert
 * there were none.
 */
import { type AdminPanel, type AdminPanelOptions, createAdminPanel } from "./core.js";
import { ManualClock } from "./internal/clock.js";
import type { PanelScope } from "./panel/scope.js";
import { createRouter, type Router } from "./server/router.js";
import type { PanelRequest, ServeOptions } from "./server/types.js";

/** Every group, and every control: for calling `panel.edit` and `panel.run` directly in a test. */
export const EVERYTHING: PanelScope = Object.freeze({ groups: undefined, edit: true, actions: true, restrictions: [] });

export interface TestAnswer {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** The body parsed, when it is JSON. */
  json: unknown;
}

export interface TestPanel {
  panel: AdminPanel;
  clock: ManualClock;
  router: Router;
  /** What the panel reported through `onError`, oldest first. */
  errors: Array<{ error: unknown; source: string }>;
  /** A request through the router. An object body is sent as JSON. */
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<TestAnswer>;
  /** Headers that authenticate with a bearer token. */
  as(token: string): Record<string, string>;
}

export function testPanel(options: { panel?: Omit<AdminPanelOptions, "clock" | "onError"> | undefined; serve?: ServeOptions | undefined; start?: number | undefined } = {}): TestPanel {
  const clock = new ManualClock(options.start ?? Date.UTC(2026, 0, 1));
  const errors: TestPanel["errors"] = [];
  const panel = createAdminPanel({ ...options.panel, clock, onError: (error, source) => errors.push({ error, source }) });
  const router = createRouter(panel, { clock, ...options.serve }, { boundHost: "127.0.0.1", where: "testPanel()" });
  return {
    panel,
    clock,
    router,
    errors,
    as: (token) => ({ authorization: `Bearer ${token}` }),
    async request(method, path, body, headers = {}) {
      const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
      const lower: Record<string, string> = { host: "127.0.0.1" };
      if (body !== undefined && typeof body !== "string") lower["content-type"] = "application/json";
      for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = value;
      const request: PanelRequest = { method, url: path, headers: lower, address: "127.0.0.1", body: async () => text };
      const response = await router.route(request);
      let json: unknown;
      try {
        json = JSON.parse(response.body);
      } catch {
        json = undefined;
      }
      return { status: response.status, headers: response.headers, body: response.body, json };
    },
  };
}

export { ManualClock };
