/**
 * Where the chart and table code is found: in the same bundle, or in a second one loaded only by
 * panels that draw charts or tables.
 *
 * The page's main bundle leaves out `charts.ts` and `table.ts`; `extras.ts` bundles them and
 * registers them here, on the global object, because the two bundles share nothing else. A
 * standalone page and a snapshot carry the extras inline when their schema needs them; a fragment
 * that polls a handler loads `client-extras.js` from it the first time a schema asks, with the
 * nonce the main script ran under so a nonce CSP admits it. The custom element imports the extras
 * directly and never loads anything.
 */
import type { PanelSchema } from "../types.js";
import type { buildChart } from "./charts.js";
import type { buildTable } from "./table.js";

export interface Extras {
  buildChart?: typeof buildChart | undefined;
  buildTable?: typeof buildTable | undefined;
}

const KEY = "__apbExtras";

/** Captured while the main script runs: `currentScript` is null once it has returned. */
const NONCE = typeof document === "undefined" ? "" : ((document.currentScript as HTMLScriptElement | null)?.nonce ?? "");

export function extras(): Extras {
  return ((globalThis as Record<string, unknown>)[KEY] as Extras | undefined) ?? {};
}

export function registerExtras(found: Required<Extras>): void {
  (globalThis as Record<string, unknown>)[KEY] = found;
}

/** Whether a schema draws anything the extras hold. */
export function needsExtras(schema: PanelSchema): boolean {
  return schema.groups.some((group) => group.items.some((item) => item.type === "chart" || item.type === "table"));
}

let loading: Promise<void> | undefined;

/** Loads the extras from a mounted handler, once per page. */
export function loadExtras(api: string): Promise<void> {
  if (extras().buildChart !== undefined) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${api}/client-extras.js`;
    if (NONCE !== "") script.nonce = NONCE;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        loading = undefined;
        reject(new Error("The panel's chart and table code could not be loaded."));
      },
      { once: true },
    );
    document.head.append(script);
  });
  return loading;
}
