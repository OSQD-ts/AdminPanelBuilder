/**
 * The one stylesheet every theme fills in.
 *
 * Written against `--apb-*` custom properties only: no colour, font or radius appears here as
 * a literal, so a theme cannot be half-applied and a custom theme reaches every screen. Every
 * selector is under `.apb-root` (or is `:host`), so a panel embedded in somebody else's page
 * styles itself and nothing around it.
 *
 * No inline `style` attributes anywhere: the page's CSP refuses them, and geometry the client
 * computes (a bar's width, a gridline's position) goes through the CSSOM instead.
 */

/** Chart colour slots, as utility classes generated from the slot count rather than written out eight times. */
function slotClasses(): string {
  const lines: string[] = [];
  for (let slot = 1; slot <= 8; slot += 1) lines.push(`.apb-root .apb-slot-${slot}, :host .apb-slot-${slot} { --apb-series: var(--apb-chart-${slot}); }`);
  return lines.join("\n");
}

export const LAYOUT_CSS = `
.apb-root { box-sizing: border-box; font-family: var(--apb-font); font-size: var(--apb-font-size); line-height: 1.45; color: var(--apb-ink); background: var(--apb-background); -webkit-text-size-adjust: 100%; }
.apb-root *, .apb-root *::before, .apb-root *::after { box-sizing: inherit; }
.apb-root.apb-standalone { min-height: 100vh; }
.apb-compact .apb-header, .apb-compact .apb-activity { display: none; }
.apb-root :focus-visible { outline: 2px solid var(--apb-focus); outline-offset: 2px; }
/* Resets under :where(), which adds no specificity: a reset that outranks the component rules
   once gave every button the ink colour and put black text on the accent. */
:where(.apb-root) :where(h1, h2, h3, p) { margin: 0; }
:where(.apb-root) :where(button, input, select, textarea) { font: inherit; color: inherit; }
.apb-root [hidden] { display: none !important; }

.apb-skip { position: absolute; left: -10000px; top: 0; }
.apb-skip:focus { left: calc(var(--apb-spacing) * 2); top: calc(var(--apb-spacing) * 2); z-index: 10; background: var(--apb-surface); color: var(--apb-ink); padding: var(--apb-spacing); border-radius: var(--apb-radius-small); }
.apb-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

.apb-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--apb-spacing) calc(var(--apb-spacing) * 2); padding: calc(var(--apb-spacing) * 2) calc(var(--apb-spacing) * 3); background: var(--apb-header-background); color: var(--apb-header-ink); }
.apb-title { font-size: 1.35em; font-weight: var(--apb-strong-weight); }
.apb-instance { opacity: .85; }
.apb-status { margin-left: auto; font-size: .9em; }
.apb-status::before { content: ""; display: inline-block; width: .6em; height: .6em; border-radius: 50%; margin-right: .4em; background: currentColor; vertical-align: middle; }

.apb-notes { display: grid; gap: var(--apb-spacing); margin-bottom: calc(var(--apb-spacing) * 2); }
.apb-note { padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.5); border-left: 3px solid var(--apb-warn); background: var(--apb-surface); border-radius: var(--apb-radius-small); color: var(--apb-ink-secondary); }

.apb-tabs { display: flex; gap: calc(var(--apb-spacing) / 2); overflow-x: auto; padding: 0; margin: 0 0 calc(var(--apb-spacing) * 3); border-bottom: 1px solid var(--apb-border); }
.apb-tab { appearance: none; background: none; border: 0; border-bottom: 2px solid transparent; padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.5); cursor: pointer; color: var(--apb-ink-secondary); white-space: nowrap; font-weight: var(--apb-strong-weight); text-transform: var(--apb-button-case); }
.apb-tab[aria-selected="true"] { color: var(--apb-link); border-bottom-color: var(--apb-accent); }
.apb-tab .apb-count { color: var(--apb-muted); font-weight: normal; margin-left: .3em; }

.apb-main { padding: calc(var(--apb-spacing) * 3); }
.apb-pane[hidden] { display: none; }
.apb-pane-description { color: var(--apb-ink-secondary); margin-bottom: calc(var(--apb-spacing) * 2); max-width: 70ch; }
.apb-grid { display: grid; gap: calc(var(--apb-spacing) * 2); grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); align-items: start; }
.apb-card { background: var(--apb-surface); border: 1px solid var(--apb-border); border-radius: var(--apb-radius); box-shadow: var(--apb-shadow); padding: calc(var(--apb-spacing) * 2); display: grid; gap: var(--apb-spacing); min-width: 0; }
.apb-card-wide { grid-column: 1 / -1; }
.apb-card-head { display: flex; align-items: baseline; gap: var(--apb-spacing); flex-wrap: wrap; }
.apb-label { font-size: 1em; font-weight: var(--apb-strong-weight); color: var(--apb-ink-secondary); }
.apb-badge { font-size: .78em; color: var(--apb-muted); border: 1px solid var(--apb-border); border-radius: 999px; padding: 0 .55em; }
.apb-description { color: var(--apb-muted); font-size: .92em; }
.apb-value { font-size: 1.6em; font-weight: var(--apb-strong-weight); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.apb-value-text { font-size: 1.1em; font-weight: normal; white-space: pre-wrap; }
.apb-value-json { font-family: var(--apb-mono-font); font-size: .85em; font-weight: normal; white-space: pre; overflow: auto; max-height: 16em; background: var(--apb-surface-raised); border-radius: var(--apb-radius-small); padding: var(--apb-spacing); margin: 0; }
.apb-value-empty { color: var(--apb-muted); }
.apb-value-error { color: var(--apb-bad); font-size: 1em; font-weight: normal; }
.apb-meta { color: var(--apb-muted); font-size: .85em; }

.apb-editor { display: flex; flex-wrap: wrap; gap: var(--apb-spacing); align-items: center; }
.apb-input, .apb-select, .apb-textarea { background: var(--apb-surface-raised); border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); padding: calc(var(--apb-spacing) * .75) var(--apb-spacing); min-width: 0; flex: 1 1 8em; }
.apb-textarea { width: 100%; min-height: 6em; font-family: var(--apb-mono-font); font-size: .9em; flex-basis: 100%; }
.apb-range { flex: 1 1 100%; accent-color: var(--apb-accent); }
.apb-button { appearance: none; border: 1px solid var(--apb-accent-strong); background: var(--apb-accent-strong); color: var(--apb-on-accent); border-radius: var(--apb-radius-small); padding: calc(var(--apb-spacing) * .75) calc(var(--apb-spacing) * 2); cursor: pointer; font-weight: var(--apb-strong-weight); text-transform: var(--apb-button-case); letter-spacing: .02em; }
.apb-button:disabled { opacity: .55; cursor: not-allowed; }
/* Outlined rather than filled: the intent colours are measured as text on a surface, and a filled
   red would need a text colour of its own in every theme. The word says it too. */
.apb-button[data-armed="true"] { background: var(--apb-surface); border-color: var(--apb-warn); color: var(--apb-warn); }
.apb-button-destructive { background: var(--apb-surface); border-color: var(--apb-bad); color: var(--apb-bad); }
.apb-switch { appearance: none; position: relative; width: 3em; height: 1.6em; border-radius: 999px; border: 1px solid var(--apb-border); background: var(--apb-surface-raised); cursor: pointer; padding: 0; flex: none; }
.apb-switch::after { content: ""; position: absolute; top: .15em; left: .15em; width: 1.2em; height: 1.2em; border-radius: 50%; background: var(--apb-muted); transition: transform .15s ease; }
.apb-switch[aria-checked="true"] { background: var(--apb-switch-on); border-color: var(--apb-switch-on); }
.apb-switch[aria-checked="true"]::after { transform: translateX(1.4em); background: var(--apb-surface); }
.apb-switch:disabled { opacity: .55; cursor: not-allowed; }
.apb-error { color: var(--apb-bad); font-size: .9em; flex-basis: 100%; }
.apb-error:empty, .apb-result:empty { display: none; }
.apb-result { font-size: .9em; color: var(--apb-ink-secondary); }
.apb-result[data-ok="false"] { color: var(--apb-bad); }
.apb-hint { color: var(--apb-muted); font-size: .85em; flex-basis: 100%; }

.apb-chart { margin: 0; display: grid; gap: calc(var(--apb-spacing) / 2); }
.apb-chart-title { font-weight: var(--apb-strong-weight); color: var(--apb-ink-secondary); }
.apb-plot { position: relative; height: 160px; margin-left: 3.5em; border-left: 1px solid var(--apb-grid); border-bottom: 1px solid var(--apb-grid); }
.apb-plot-sparkline { height: 36px; margin-left: 0; border: 0; }
.apb-plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.apb-gridline { stroke: var(--apb-grid); stroke-width: 1; vector-effect: non-scaling-stroke; }
.apb-line { fill: none; stroke: var(--apb-series); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.apb-area { fill: var(--apb-series); opacity: .18; stroke: none; }
.apb-bar { fill: var(--apb-series); }
.apb-dot { fill: none; stroke: var(--apb-series); stroke-width: 7; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.apb-tick { position: absolute; right: calc(100% + .4em); transform: translateY(-50%); font-size: .75em; color: var(--apb-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.apb-axis { margin-top: .35em; display: flex; justify-content: space-between; margin-left: 3.5em; font-size: .75em; color: var(--apb-muted); gap: var(--apb-spacing); }
.apb-legend { display: flex; flex-wrap: wrap; gap: calc(var(--apb-spacing) / 2) calc(var(--apb-spacing) * 2); list-style: none; margin: 0; padding: 0; font-size: .85em; color: var(--apb-ink-secondary); }
.apb-swatch { display: inline-block; width: .9em; height: .9em; border-radius: 2px; background: var(--apb-series); margin-right: .4em; vertical-align: -.1em; }
.apb-legend-value { color: var(--apb-ink); font-variant-numeric: tabular-nums; margin-left: .3em; }
.apb-keys { display: grid; gap: calc(var(--apb-spacing) / 2); }
.apb-key-row { display: grid; grid-template-columns: minmax(4em, 30%) 1fr auto; gap: var(--apb-spacing); align-items: center; font-size: .9em; }
.apb-key-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--apb-ink-secondary); }
.apb-key-track { height: .9em; background: var(--apb-surface-raised); border-radius: 2px; overflow: hidden; }
.apb-key-bar { height: 100%; width: 0; background: var(--apb-series); }
.apb-key-value { font-variant-numeric: tabular-nums; }
.apb-gauge-track { height: 1em; border-radius: 999px; background: var(--apb-surface-raised); border: 1px solid var(--apb-border); overflow: hidden; }
.apb-gauge-fill { height: 100%; width: 0; background: var(--apb-series); }
.apb-gauge-scale { display: flex; justify-content: space-between; font-size: .75em; color: var(--apb-muted); }
.apb-empty { color: var(--apb-muted); font-size: .9em; }
.apb-table-view summary { cursor: pointer; color: var(--apb-link); font-size: .85em; }
.apb-table-wrap { max-height: 16em; overflow: auto; margin-top: var(--apb-spacing); }
.apb-table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: .85em; font-variant-numeric: tabular-nums; }
.apb-table th, .apb-table td { text-align: left; padding: calc(var(--apb-spacing) / 2) var(--apb-spacing); border-bottom: 1px solid var(--apb-border); }
.apb-table th { position: sticky; top: 0; background: var(--apb-surface-raised); font-weight: var(--apb-strong-weight); color: var(--apb-ink-secondary); }

.apb-activity { display: grid; gap: calc(var(--apb-spacing) * 3); }
.apb-activity h2 { font-size: 1.1em; font-weight: var(--apb-strong-weight); margin-bottom: var(--apb-spacing); }
.apb-notice { padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.5); border-left: 3px solid var(--apb-accent); background: var(--apb-surface); border-radius: var(--apb-radius-small); margin-bottom: var(--apb-spacing); }
.apb-notice[data-level="warning"] { border-left-color: var(--apb-warn); }
.apb-notice-level { font-weight: var(--apb-strong-weight); margin-right: .4em; }

.apb-toolbar { display: flex; gap: var(--apb-spacing); margin-bottom: var(--apb-spacing); }
.apb-search { flex: 0 1 22em; }
.apb-grid-list { grid-template-columns: 1fr; }
.apb-span-2 { grid-column: span 2; }
.apb-span-3 { grid-column: span 3; }
.apb-span-full { grid-column: 1 / -1; }
.apb-card-head { position: relative; }
.apb-badges { display: inline-flex; gap: calc(var(--apb-spacing) / 2); flex-wrap: wrap; }
.apb-card-tools { margin-left: auto; display: inline-flex; gap: calc(var(--apb-spacing) / 2); }
.apb-icon { appearance: none; background: none; border: 0; color: var(--apb-muted); cursor: pointer; padding: 0 .25em; font-size: 1em; line-height: 1; }
.apb-icon[aria-pressed="true"] { color: var(--apb-link); }
.apb-card-body { display: grid; gap: var(--apb-spacing); min-width: 0; }
.apb-card-body[hidden] { display: none; }
.apb-status-word:empty { display: none; }
.apb-status-word { font-weight: var(--apb-strong-weight); font-size: .9em; }
.apb-card[data-status="warn"] { border-left: 4px solid var(--apb-warn); }
.apb-card[data-status="warn"] .apb-status-word, [data-status="warn"] > .apb-status-word, .apb-feed-entry[data-level="warn"] .apb-status-word { color: var(--apb-warn); }
.apb-card[data-status="bad"] { border-left: 4px solid var(--apb-bad); }
.apb-card[data-status="bad"] .apb-status-word, [data-status="bad"] > .apb-status-word, .apb-feed-entry[data-level="bad"] .apb-status-word { color: var(--apb-bad); }
.apb-card[data-status="ok"] .apb-status-word { color: var(--apb-ok); }
td[data-status="warn"] { color: var(--apb-warn); }
td[data-status="bad"] { color: var(--apb-bad); }
.apb-pending:empty { display: none; }
.apb-pending .apb-note, .apb-activity .apb-note { display: flex; flex-wrap: wrap; gap: var(--apb-spacing); align-items: center; }
.apb-duration { flex: 0 1 auto; }
.apb-tool { appearance: none; background: var(--apb-surface-raised); border: 1px solid var(--apb-border); color: var(--apb-ink); border-radius: var(--apb-radius-small); padding: calc(var(--apb-spacing) / 4) var(--apb-spacing); cursor: pointer; font-size: .85em; }
.apb-tool[aria-pressed="true"], .apb-tool[data-armed="true"] { border-color: var(--apb-warn); color: var(--apb-warn); }
.apb-tool-destructive { color: var(--apb-bad); border-color: var(--apb-bad); }
.apb-tool:disabled { opacity: .55; cursor: not-allowed; }
.apb-chart-tools { display: flex; flex-wrap: wrap; gap: calc(var(--apb-spacing) / 2); justify-content: flex-end; }
.apb-chart-tools:empty { display: none; }
.apb-threshold { stroke: var(--apb-bad); stroke-width: 1.5; stroke-dasharray: 6 4; vector-effect: non-scaling-stroke; }
.apb-threshold-label { position: absolute; right: 0; transform: translateY(15%); font-size: .75em; color: var(--apb-bad); background: var(--apb-surface); padding: 0 .3em; }
.apb-mark { stroke: var(--apb-muted); stroke-width: 1; stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }
.apb-zoom-band { position: absolute; top: 0; bottom: 0; background: var(--apb-accent); opacity: .15; pointer-events: none; }
.apb-plot { touch-action: pan-y; cursor: crosshair; }
.apb-plot-sparkline { cursor: default; }
.apb-heatmap { border-collapse: collapse; font-size: .8em; font-variant-numeric: tabular-nums; }
.apb-heatmap th { font-weight: var(--apb-strong-weight); color: var(--apb-ink-secondary); padding: 2px 6px; text-align: left; }
.apb-heat-cell { position: relative; min-width: 3em; padding: 2px 6px; text-align: right; border: 1px solid var(--apb-grid); }
.apb-heat { position: absolute; inset: 0; background: var(--apb-series); }
.apb-heat-value { position: relative; }
.apb-table-controls { display: flex; gap: var(--apb-spacing); }
.apb-table-controls:empty { display: none; }
.apb-sort { appearance: none; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; font-weight: var(--apb-strong-weight); }
th[aria-sort="ascending"] .apb-sort::after { content: " ▲"; }
th[aria-sort="descending"] .apb-sort::after { content: " ▼"; }
.apb-row-actions { white-space: nowrap; }
.apb-row-actions .apb-tool + .apb-tool { margin-left: calc(var(--apb-spacing) / 2); }
.apb-pager { display: flex; gap: var(--apb-spacing); align-items: center; }
.apb-feed-list { list-style: none; margin: 0; padding: 0; max-height: 22em; overflow: auto; display: grid; gap: 2px; }
.apb-feed-entry { display: flex; gap: var(--apb-spacing); font-size: .88em; padding: 2px 0; border-bottom: 1px solid var(--apb-grid); }
.apb-feed-entry[data-level="warn"] { border-left: 3px solid var(--apb-warn); padding-left: 4px; }
.apb-feed-entry[data-level="bad"] { border-left: 3px solid var(--apb-bad); padding-left: 4px; }
.apb-feed-time { color: var(--apb-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.apb-feed-text { overflow-wrap: anywhere; font-family: var(--apb-mono-font); }
.apb-profile-settings { margin: 0; padding-left: 1.2em; color: var(--apb-ink-secondary); font-size: .9em; }
.apb-inputs { display: grid; gap: calc(var(--apb-spacing) / 2); }
.apb-input-label { font-size: .9em; color: var(--apb-ink-secondary); }
.apb-checkbox { accent-color: var(--apb-accent); width: 1.2em; height: 1.2em; }
.apb-block-table .apb-table-wrap { max-height: none; }
.apb-scheme { width: auto; flex: 0 0 auto; margin-left: auto; font-size: .85em; background: var(--apb-surface); color: var(--apb-ink); border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); padding: 2px 4px; }
.apb-status + .apb-scheme { margin-left: 0; }
.apb-feed-tools { display: flex; flex-wrap: wrap; gap: calc(var(--apb-spacing) / 2); margin-bottom: calc(var(--apb-spacing) / 2); }
.apb-feed-filter { flex: 1 1 10em; min-width: 0; }
.apb-feed-levels { width: auto; flex: 0 1 auto; }
.apb-scheduled { list-style: none; margin: 0; padding: 0; display: grid; gap: calc(var(--apb-spacing) / 2); }
.apb-scheduled:empty { display: none; }
.apb-timeline summary, .apb-when summary { cursor: pointer; color: var(--apb-link); font-size: .85em; }
.apb-timeline-list { margin: calc(var(--apb-spacing) / 2) 0 0; padding-left: 1.2em; font-size: .85em; color: var(--apb-ink-secondary); }
.apb-timeline-value { color: var(--apb-ink); font-weight: var(--apb-strong-weight); }
.apb-when { flex-basis: 100%; }
.apb-when[open] { display: grid; gap: calc(var(--apb-spacing) / 2); }
.apb-disabled-reason { color: var(--apb-warn); }
.apb-file { display: inline-block; position: relative; }
.apb-file:focus-within { outline: 2px solid var(--apb-focus); outline-offset: 2px; }
.apb-import-diff { margin: calc(var(--apb-spacing) / 2) 0; padding-left: 1.2em; font-size: .9em; }
.apb-chart-body { border-radius: var(--apb-radius-small); }
.apb-cursor { stroke: var(--apb-ink); stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-dasharray: 3 3; }
.apb-dialog { max-width: min(40rem, calc(100vw - 32px)); width: 100%; border: 1px solid var(--apb-border); border-radius: var(--apb-radius); background: var(--apb-surface); color: var(--apb-ink); padding: calc(var(--apb-spacing) * 2); box-shadow: var(--apb-shadow); }
.apb-dialog::backdrop { backdrop-filter: brightness(.6); }
.apb-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: var(--apb-spacing); margin-bottom: var(--apb-spacing); }
.apb-dialog-body { display: grid; gap: var(--apb-spacing); }
.apb-palette-list { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow: auto; }
.apb-palette-item { padding: calc(var(--apb-spacing) / 2) var(--apb-spacing); border-radius: var(--apb-radius-small); cursor: pointer; }
.apb-palette-item[aria-selected="true"] { background: var(--apb-surface-raised); outline: 2px solid var(--apb-focus); outline-offset: -2px; }
.apb-shortcuts { display: grid; grid-template-columns: auto 1fr; gap: calc(var(--apb-spacing) / 2) calc(var(--apb-spacing) * 2); margin: 0; }
.apb-shortcuts dd { margin: 0; }
.apb-shortcuts kbd { font-family: var(--apb-mono-font); border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); padding: 0 .35em; }
.apb-main-compact { padding: 0; }
.apb-compact-group + .apb-compact-group { margin-top: calc(var(--apb-spacing) * 2); }

@media (max-width: 900px) { .apb-span-3 { grid-column: 1 / -1; } }
@media (max-width: 600px) {
  .apb-span-2, .apb-span-3 { grid-column: 1 / -1; }
  .apb-header, .apb-main { padding-left: calc(var(--apb-spacing) * 1.5); padding-right: calc(var(--apb-spacing) * 1.5); }
  .apb-status { margin-left: 0; flex-basis: 100%; }
  .apb-scheme { margin-left: 0; }
  /* Each row a card of labelled lines: no sideways scrolling on a phone, however many columns. */
  .apb-table-stacking thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .apb-table-stacking, .apb-table-stacking tbody, .apb-table-stacking tr, .apb-table-stacking td { display: block; width: 100%; }
  .apb-table-stacking tr { border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); margin-bottom: var(--apb-spacing); padding: calc(var(--apb-spacing) / 2); }
  .apb-table-stacking td { display: grid; grid-template-columns: minmax(6em, 40%) 1fr; gap: var(--apb-spacing); border-bottom: 0; overflow-wrap: anywhere; }
  .apb-table-stacking td::before { content: attr(data-label); color: var(--apb-ink-secondary); font-weight: var(--apb-strong-weight); }
  .apb-table-stacking td[data-label=""] { grid-template-columns: 1fr; }
  .apb-table-stacking td[data-label=""]::before { content: none; }
  .apb-table-wrap { overflow-x: visible; }
}
@media (prefers-reduced-motion: reduce) { .apb-switch::after { transition: none; } }
${slotClasses()}
`;
