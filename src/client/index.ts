/**
 * The bundled client's entry: mounts every panel on the page.
 *
 * A page can hold several panels (fragments embedded side by side), each an element marked
 * `data-apb-root`, each mounted once. The bootstrap, when there is one, is JSON in a
 * non-executing `<script type="application/json">` inside the element, so it needs no nonce and
 * cannot run.
 */
import { mount } from "./app.js";
import type { PanelSchema, PanelState } from "../types.js";

function mountAll(): void {
  for (const container of Array.from(document.querySelectorAll<HTMLElement>("[data-apb-root]"))) {
    if (container.dataset.apbMounted === "true") continue;
    container.dataset.apbMounted = "true";
    const data = container.querySelector("script[data-apb-bootstrap]");
    let bootstrap: { schema: PanelSchema; state: PanelState } | undefined;
    if (data !== null) {
      try {
        bootstrap = JSON.parse(data.textContent ?? "") as { schema: PanelSchema; state: PanelState };
      } catch {
        container.textContent = "The panel's data could not be read.";
        continue;
      }
    }
    const api = container.dataset.api;
    if (bootstrap === undefined && api === undefined) {
      container.textContent = "This panel has neither data nor an API to ask.";
      continue;
    }
    mount({ root: container, container, api, bootstrap, standalone: container.classList.contains("apb-standalone"), group: container.dataset.group, compact: container.dataset.compact !== undefined });
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll, { once: true });
else mountAll();
