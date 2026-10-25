import type { PanelSchema } from "../types.js";

/**
 * Whether a schema draws anything the client's extras bundle holds: a chart, a table, or a value
 * shown as a QR code. The one rule both sides use — the server to decide whether a page carries the
 * extras inline (render/html.ts), the page to decide whether to load them (client/registry.ts) —
 * so the two can never disagree about a panel.
 */
export function usesExtras(schema: PanelSchema): boolean {
  return schema.groups.some((group) => group.items.some((item) => item.type === "chart" || item.type === "table" || (item.type === "value" && item.format === "qr")));
}
