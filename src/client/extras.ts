/**
 * The extras bundle's entry: the chart and table code, registered for the main bundle to find.
 * See `registry.ts`.
 */
import { buildChart } from "./charts.js";
import { registerExtras } from "./registry.js";
import { buildTable } from "./table.js";

registerExtras({ buildChart, buildTable });
