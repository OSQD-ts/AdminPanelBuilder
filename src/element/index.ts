/**
 * `<admin-panel src="/admin">`: the panel as a custom element, for an admin page built in any
 * framework.
 *
 *   import { defineAdminPanelElement } from "@osqd/admin-panel-builder/element";
 *   defineAdminPanelElement();
 *   // <admin-panel src="/admin"></admin-panel>
 *
 *   <admin-panel src="/admin" group="Games" compact></admin-panel>   one group, cards only
 *
 * The element draws into a shadow root, loads the stylesheet from `src` and asks `src` for the
 * schema and the state, so the handler mounted there decides what it shows and allows. A
 * shadow root is a styling boundary, not a security boundary: the host page's scripts can read
 * everything in it, so embed a panel only in pages you would trust with it.
 *
 * Nothing here extends `HTMLElement` at module scope. The class is created inside
 * `defineAdminPanelElement()`, so importing this entry in a server-rendered framework, where
 * `HTMLElement` does not exist, does not throw — a failure one of the sibling repositories
 * shipped once. `npm run check:package` loads this entry under Node to keep it that way.
 */
import { mount, type MountedPanel } from "../client/app.js";
// The element draws charts and tables from its own bundle rather than loading the extras.
import "../client/extras.js";

export const ELEMENT_NAME = "admin-panel";

/**
 * Registers the element. Safe to call more than once and in a server-side render, where it
 * does nothing. Returns the constructor, or undefined where there is no `customElements`.
 */
export function defineAdminPanelElement(name: string = ELEMENT_NAME): CustomElementConstructor | undefined {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined") return undefined;
  const existing = customElements.get(name);
  if (existing !== undefined) return existing;

  class AdminPanelElement extends HTMLElement {
    static get observedAttributes(): string[] {
      return ["src", "scheme", "group", "compact"];
    }

    private mounted: MountedPanel | undefined;
    private container: HTMLElement | undefined;

    connectedCallback(): void {
      this.start();
    }

    disconnectedCallback(): void {
      this.mounted?.destroy();
      this.mounted = undefined;
    }

    attributeChangedCallback(attribute: string): void {
      if (!this.isConnected) return;
      if (attribute === "scheme") {
        this.applyScheme();
        return;
      }
      this.mounted?.destroy();
      this.mounted = undefined;
      this.start();
    }

    private start(): void {
      const src = this.getAttribute("src");
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      while (shadow.firstChild !== null) shadow.removeChild(shadow.firstChild);
      if (src === null || src === "") {
        console.warn(`admin-panel: <${name}> needs a src attribute naming where panel.handler() is mounted`);
        return;
      }
      const base = src.replace(/\/+$/, "");
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${base}/panel.css`;
      const container = document.createElement("div");
      container.className = "apb-root";
      shadow.append(link, container);
      this.container = container;
      this.applyScheme();
      const group = this.getAttribute("group");
      this.mounted = mount({ root: shadow, container, api: base, standalone: false, group: group === null || group === "" ? undefined : group, compact: this.hasAttribute("compact") });
    }

    /** `scheme="dark"` on the element beats both the panel's setting and the viewer's system. */
    private applyScheme(): void {
      const scheme = this.getAttribute("scheme");
      if (this.container === undefined) return;
      if (scheme === "light" || scheme === "dark") this.container.dataset.scheme = scheme;
    }
  }

  customElements.define(name, AdminPanelElement);
  return AdminPanelElement;
}
