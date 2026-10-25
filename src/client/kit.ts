/**
 * Which component-kit classes each of the panel's own classes is drawn with.
 *
 * The page is built from `@osqd/ui`'s components: a button here is an `oq-btn`, a field an
 * `oq-input`, the band of tabs an `oq-tabs`. The panel's own class names stay on every element
 * beside the kit's — they are what the layout positions, what the tests find, and what a theme's
 * `css` may already target — and `el()` adds the kit's from this one table, so no call site has to
 * remember both. A class that is not here is the panel's own drawing (the grid of cards, arranging,
 * the charts' geometry, how much a card shows at each width), which the kit has no equivalent for.
 *
 * scripts/build-kit-css.mjs reads the kit classes written below to decide which of the kit's rules
 * the page needs, so a class used only through this table still reaches the stylesheet.
 */
export const KIT_CLASSES: Readonly<Record<string, string>> = {
  "apb-button": "oq-btn",
  "apb-button-destructive": "oq-btn--outline oq-danger",
  "apb-button-quiet": "oq-btn--outline oq-neutral",
  "apb-tool": "oq-btn oq-btn--outline oq-neutral oq-sm",
  "apb-tool-destructive": "oq-danger",
  "apb-icon": "oq-btn oq-btn--icon oq-btn--ghost oq-neutral oq-sm",
  "apb-input": "oq-input",
  "apb-select": "oq-select",
  "apb-textarea": "oq-textarea",
  "apb-checkbox": "oq-checkbox",
  "apb-range": "oq-range",
  "apb-input-label": "oq-label",
  "apb-hint": "oq-help",
  "apb-error": "oq-help is-error",
  "apb-card": "oq-card",
  "apb-card-tools": "oq-card__tools",
  "apb-badge": "oq-chip oq-chip--outline oq-neutral oq-sm",
  "apb-count": "oq-badge oq-neutral",
  "apb-tabs": "oq-tabs",
  "apb-tab": "oq-tab",
  "apb-note": "oq-alert oq-warning",
  "apb-table": "oq-table oq-table--hover",
  "apb-table-wrap": "oq-table-wrap",
  "apb-dialog": "oq-dialog",
  "apb-dialog-head": "oq-dialog__header",
  "apb-dialog-body": "oq-dialog__body",
  "apb-settings-foot": "oq-dialog__footer",
  "apb-search-key": "oq-kbd",
  "apb-sr": "oq-sr-only",
  "apb-skip": "oq-skip-link",
  "apb-legend": "oq-chart__legend",
  "apb-legend-item": "oq-chart__legend-item",
  "apb-tip": "oq-chart__tooltip",
  "apb-table-view": "oq-chart__table",
};

/** `className` with the kit's classes added after the panel's own, each once. */
export function withKit(className: string): string {
  const own = className.split(/\s+/).filter(Boolean);
  const added: string[] = [];
  for (const name of own) {
    const kit = KIT_CLASSES[name];
    if (kit === undefined) continue;
    for (const extra of kit.split(" ")) if (!own.includes(extra) && !added.includes(extra)) added.push(extra);
  }
  return added.length === 0 ? own.join(" ") : `${own.join(" ")} ${added.join(" ")}`;
}
