/**
 * The extras bundle's entry: the chart, table and QR code drawing, registered for the main bundle
 * to find.
 * See `registry.ts`.
 */
import { buildChart } from "./charts.js";
import { drawQr } from "./qr-view.js";
import { registerExtras } from "./registry.js";
import { buildTable } from "./table.js";

registerExtras({ buildChart, buildTable, drawQr });
