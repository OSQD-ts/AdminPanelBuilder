/**
 * The client's only way of putting something into the document.
 *
 * `textContent`, always. Every string that reaches this file — a label, a value, a player's
 * name, an email subject — was written by the application or by somebody it serves, and one
 * `innerHTML` anywhere turns a value into script running in an operator's browser.
 * `scripts/build-client.mjs` refuses to bundle any of the ways to do that.
 *
 * Unlike the sibling dashboards there is no module-level root here: one page may hold several
 * panels (fragments embedded side by side), so every lookup goes through the root its panel
 * was mounted on, passed in.
 */

export type Root = HTMLElement | ShadowRoot;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string | null, text?: string | number | null): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== null && className !== "") node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

const SVG = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

/** An element the panel's own markup declares. A miss is a rename that went wrong, not a condition. */
export function $<T extends Element = HTMLElement>(root: Root, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (node === null) throw new Error(`admin-panel: no element ${selector}`);
  return node;
}

/**
 * Whether somebody is typing into something inside `node`, so an incoming poll does not replace
 * what they typed. `activeElement` is read from the root, because embedded in a shadow root the
 * document's `activeElement` is the host.
 */
export function holdsFocus(root: Root, node: Element): boolean {
  const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
  return active !== null && node.contains(active);
}

/**
 * A document-unique id, for `aria-controls`, `aria-describedby` and `<label for>`. The counter lives
 * on the global object because the page may run two bundles (the client and its extras), and two
 * module-level counters would hand out the same ids.
 */
export function uid(prefix: string): string {
  const holder = globalThis as { __apbIds?: number };
  holder.__apbIds = (holder.__apbIds ?? 0) + 1;
  return `apb-${prefix}-${holder.__apbIds}`;
}
