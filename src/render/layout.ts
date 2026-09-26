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
/* ---- Frame -------------------------------------------------------------------------------
   Layers, back to front: the page, the cards on it, the band of tabs that stays in reach, the bar
   across the top, and dialogs. Each sits on its own elevation: --apb-shadow for what rests on the
   page, --apb-shadow-raised for what floats. The gutter grows with the screen, and past
   --apb-page-width the content stops widening and centres, while the bar still runs edge to edge. */
.apb-root {
  --apb-gutter: clamp(calc(var(--apb-spacing) * 1.5), 3vw, calc(var(--apb-spacing) * 4));
  --apb-page-width: 1760px;
  --apb-inline: max(var(--apb-gutter), calc((100% - var(--apb-page-width)) / 2));
  --apb-control: calc(var(--apb-spacing) * 4.5);
  --apb-hover: color-mix(in srgb, var(--apb-ink) 6%, transparent);
  --apb-hover-surface: color-mix(in srgb, var(--apb-ink) 5%, var(--apb-surface));
  --apb-edge: color-mix(in srgb, var(--apb-border) 55%, var(--apb-muted));
  box-sizing: border-box; font-family: var(--apb-font); font-size: var(--apb-font-size); line-height: 1.5; color: var(--apb-ink); background: var(--apb-background);
  -webkit-text-size-adjust: 100%; text-size-adjust: 100%; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility;
}
.apb-root *, .apb-root *::before, .apb-root *::after { box-sizing: inherit; }
.apb-root.apb-standalone { min-height: 100vh; min-height: 100dvh; overflow-x: clip; }
.apb-compact .apb-header, .apb-compact .apb-activity { display: none; }
.apb-root :focus-visible { outline: 2px solid var(--apb-focus); outline-offset: 2px; }
.apb-root ::selection { background: color-mix(in srgb, var(--apb-accent) 28%, transparent); }
/* Resets under :where(), which adds no specificity: a reset that outranks the component rules
   once gave every button the ink colour and put black text on the accent. */
:where(.apb-root) :where(h1, h2, h3, p) { margin: 0; }
:where(.apb-root) :where(button, input, select, textarea) { font: inherit; color: inherit; }
:where(.apb-root) :where(button, summary, select, input, a) { -webkit-tap-highlight-color: transparent; }
.apb-root [hidden] { display: none !important; }

.apb-skip { position: absolute; left: -10000px; top: 0; }
.apb-skip:focus { left: calc(var(--apb-spacing) * 2); top: calc(var(--apb-spacing) * 2); z-index: 10; background: var(--apb-surface); color: var(--apb-ink); padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.5); border-radius: var(--apb-radius-small); box-shadow: var(--apb-shadow-raised); }
.apb-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* ---- The bar across the top ---------------------------------------------------------------- */
.apb-header { position: relative; z-index: 3; display: flex; flex-wrap: wrap; align-items: center; gap: var(--apb-spacing) calc(var(--apb-spacing) * 1.5); min-height: calc(var(--apb-spacing) * 8); padding: calc(var(--apb-spacing) * 1.25) var(--apb-inline); background: var(--apb-header-background); color: var(--apb-header-ink); box-shadow: var(--apb-shadow-raised); border-bottom: 1px solid color-mix(in srgb, var(--apb-border) 50%, transparent); }
.apb-title { font-size: 1.3em; font-weight: var(--apb-strong-weight); line-height: 1.2; letter-spacing: -.01em; overflow-wrap: anywhere; min-width: 0; }
.apb-instance { font-family: var(--apb-mono-font); font-size: .8em; line-height: 1.6; padding: 0 .65em; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--apb-header-ink) 35%, transparent); white-space: nowrap; }
.apb-status { margin-left: auto; display: inline-flex; align-items: center; gap: .55em; font-size: .88em; line-height: 1.5; padding: .2em .8em .2em .7em; border-radius: 1em; border: 1px solid color-mix(in srgb, var(--apb-header-ink) 30%, transparent); min-width: 0; max-width: 100%; }
.apb-status:empty { border-color: transparent; }
/* The state is a shape as well as a word: a beating dot while live, a diamond in trouble, a ring
   when nothing is coming (a snapshot, or signed out). */
.apb-status::before { content: ""; flex: none; width: .55em; height: .55em; border-radius: 50%; background: currentColor; }
.apb-status[data-state="live"]::before { animation: apb-beat 2.4s ease-out infinite; }
.apb-status[data-state="trouble"]::before { border-radius: 1px; transform: rotate(45deg); }
.apb-status[data-state="snapshot"]::before, .apb-status[data-state="signed-out"]::before { background: transparent; box-shadow: inset 0 0 0 1.5px currentColor; }

/* The one button for the viewer's own settings: a sliders icon drawn in the text colour, and its word. */
.apb-settings-button { display: inline-flex; align-items: center; gap: .5em; flex: none; min-height: calc(var(--apb-control) - var(--apb-spacing) / 2); padding: 0 .85em; border-radius: var(--apb-radius-small); border: 1px solid color-mix(in srgb, var(--apb-header-ink) 35%, transparent); background: none; color: var(--apb-header-ink); font-size: .9em; cursor: pointer; transition: background-color .15s ease, border-color .15s ease; }
.apb-settings-button:hover { border-color: var(--apb-header-ink); }
.apb-settings-icon { position: relative; width: 1.1em; height: .95em; flex: none; background: linear-gradient(currentColor, currentColor) 0 0 / 100% 2px no-repeat, linear-gradient(currentColor, currentColor) 0 50% / 100% 2px no-repeat, linear-gradient(currentColor, currentColor) 0 100% / 100% 2px no-repeat; }
.apb-settings-icon::before, .apb-settings-icon::after { content: ""; position: absolute; width: .36em; height: .36em; border-radius: 50%; border: 2px solid currentColor; background: var(--apb-header-background); }
.apb-settings-icon::before { left: .12em; top: -.12em; }
.apb-settings-icon::after { right: .1em; bottom: -.12em; }

/* Beside it, the button that arranges the open tab's cards: a card and two smaller ones. */
.apb-arrange-button { display: inline-flex; align-items: center; gap: .5em; flex: none; min-height: calc(var(--apb-control) - var(--apb-spacing) / 2); padding: 0 .85em; border-radius: var(--apb-radius-small); border: 1px solid color-mix(in srgb, var(--apb-header-ink) 35%, transparent); background: none; color: var(--apb-header-ink); font-size: .9em; cursor: pointer; transition: background-color .15s ease, border-color .15s ease; }
.apb-arrange-button:hover:not(:disabled) { border-color: var(--apb-header-ink); }
.apb-arrange-button:disabled { opacity: .5; cursor: not-allowed; }
.apb-arrange-button[aria-pressed="true"] { background: var(--apb-header-ink); color: var(--apb-header-background); border-color: var(--apb-header-ink); }
.apb-arrange-icon { position: relative; width: 1.05em; height: .95em; flex: none; background: linear-gradient(currentColor, currentColor) 0 0 / 55% 100% no-repeat, linear-gradient(currentColor, currentColor) 100% 0 / 38% 45% no-repeat, linear-gradient(currentColor, currentColor) 100% 100% / 38% 45% no-repeat; }

/* ---- Tabs and search, in one band that stays in reach ----------------------------------------- */
.apb-main { padding: var(--apb-spacing) var(--apb-inline) calc(var(--apb-spacing) * 6); }
/* wrap-reverse: when the search no longer fits beside the tabs it moves above them, not below. */
.apb-nav { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap-reverse; align-items: center; gap: var(--apb-spacing) calc(var(--apb-spacing) * 3); margin-bottom: calc(var(--apb-spacing) * 3); padding-top: calc(var(--apb-spacing) * 1.5); background: color-mix(in srgb, var(--apb-background) 90%, transparent); -webkit-backdrop-filter: saturate(1.4) blur(12px); backdrop-filter: saturate(1.4) blur(12px); border-bottom: 1px solid var(--apb-border); }
/* Floating over the cards: a full-width band on a page of its own, with the raised shadow. */
.apb-nav[data-stuck] { box-shadow: var(--apb-shadow-raised); border-bottom-color: transparent; }
.apb-standalone .apb-nav[data-stuck] { margin-left: calc(50% - 50vw); margin-right: calc(50% - 50vw); padding-left: calc(50vw - 50%); padding-right: calc(50vw - 50%); }
.apb-nav > .apb-tabs { order: 1; flex: 1 1 auto; align-self: stretch; margin: 0; }
.apb-nav > .apb-toolbar { order: 2; flex: 1 1 16em; max-width: 26em; margin: 0 0 var(--apb-spacing) auto; }
.apb-toolbar { position: relative; display: flex; gap: var(--apb-spacing); margin-bottom: var(--apb-spacing); }
/* A magnifier drawn with two borders: no image, which a host page's CSP could refuse, and the
   theme's colour rather than one of its own. */
.apb-toolbar:has(> .apb-search)::before, .apb-toolbar:has(> .apb-search)::after { content: ""; position: absolute; z-index: 1; pointer-events: none; }
.apb-toolbar:has(> .apb-search)::before { left: .85em; top: 50%; width: .8em; height: .8em; margin-top: -.5em; border: 2px solid var(--apb-muted); border-radius: 50%; }
.apb-toolbar:has(> .apb-search)::after { left: 1.6em; top: 50%; width: 2px; height: .46em; margin-top: .26em; background: var(--apb-muted); border-radius: 1px; transform: rotate(-45deg); }
.apb-input.apb-search { flex: 1 1 22em; padding-left: 2.4em; padding-right: 2.6em; border-radius: 999px; background: var(--apb-surface); }
.apb-tabs { display: flex; gap: calc(var(--apb-spacing) / 4); overflow-x: auto; overflow-y: hidden; padding: 0; margin: 0 0 calc(var(--apb-spacing) * 3); scrollbar-width: none; overscroll-behavior-x: contain; }
.apb-tabs::-webkit-scrollbar { display: none; }
.apb-tab { position: relative; flex: none; display: inline-flex; align-items: center; gap: .5em; appearance: none; background: none; border: 0; border-radius: var(--apb-radius-small) var(--apb-radius-small) 0 0; min-height: calc(var(--apb-spacing) * 5.5); padding: 0 calc(var(--apb-spacing) * 1.5); cursor: pointer; color: var(--apb-ink-secondary); white-space: nowrap; font-weight: var(--apb-strong-weight); text-transform: var(--apb-button-case); letter-spacing: .02em; transition: color .15s ease, background-color .15s ease; }
.apb-tab::after { content: ""; position: absolute; left: calc(var(--apb-spacing) / 2); right: calc(var(--apb-spacing) / 2); bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--apb-accent); transform: scaleX(0); transition: transform .2s ease; }
.apb-tab:hover { color: var(--apb-ink); background: var(--apb-hover); }
.apb-tab:focus-visible { outline-offset: -2px; }
.apb-tab[aria-selected="true"] { color: var(--apb-link); }
.apb-tab[aria-selected="true"]::after { transform: scaleX(1); }
.apb-activity .apb-count:empty { display: none; }
.apb-tab .apb-count, .apb-activity .apb-count { min-width: 1.75em; padding: 0 .5em; border-radius: 999px; font-size: .78em; line-height: 1.6; text-align: center; letter-spacing: 0; font-weight: var(--apb-strong-weight); font-variant-numeric: tabular-nums; color: var(--apb-muted); background: var(--apb-surface); border: 1px solid var(--apb-border); }
.apb-tab[aria-selected="true"] .apb-count { color: var(--apb-on-accent); background: var(--apb-accent-strong); border-color: var(--apb-accent-strong); }

/* ---- Panes and the grid of cards ------------------------------------------------------------ */
.apb-notes { display: grid; gap: var(--apb-spacing); margin-bottom: calc(var(--apb-spacing) * 2); }
.apb-note { padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.5); border: 1px solid var(--apb-border); border-left: 3px solid var(--apb-warn); background: var(--apb-surface); border-radius: var(--apb-radius-small); color: var(--apb-ink-secondary); }
.apb-notes > .apb-note { box-shadow: var(--apb-shadow); }
.apb-pane[hidden] { display: none; }
.apb-pane:not([hidden]) { animation: apb-rise .22s ease-out; }
.apb-pane:focus-visible { outline-offset: calc(var(--apb-spacing) / 2); border-radius: var(--apb-radius); }
.apb-pane-description { color: var(--apb-ink-secondary); font-size: 1.02em; margin-bottom: calc(var(--apb-spacing) * 2.5); max-width: 75ch; }
/* The grid is a container, so a card's width follows the space the grid has, not the window's:
   a panel in a sidebar lays out as a narrow panel even on a wide screen. */
/* The grid of cells (src/client/grid.ts): the engine sets the column count it has room for and each
   card's width and height in cells; rows are a minimum height and grow when a card needs more. */
/* Rows are exactly their height: the grid gives every card the rows what it holds needs (measured
   in src/client/grid.ts), so no card can stretch a row, and its neighbours with it, on its own. */
.apb-grid { display: grid; gap: calc(var(--apb-spacing) * 2); grid-template-columns: repeat(var(--apb-cols, 12), minmax(0, 1fr)); grid-auto-rows: var(--apb-row, 72px); align-items: stretch; }
/* The packer (src/panel/layout.ts) gives every card its first column and row: nothing is left to
   the browser's auto-placement, which is what left holes beside tall cards. */
.apb-grid[data-single] { grid-auto-rows: minmax(var(--apb-row, 72px), auto); }
.apb-grid[data-single] > .apb-card > .apb-card-body { overflow: visible; }
.apb-grid > .apb-card, .apb-grid > .apb-drop-slot { grid-column: var(--apb-x, auto) / span var(--apb-w, 3); grid-row: var(--apb-y, auto) / span var(--apb-h, 2); }
.apb-grid > .apb-card { container: apb-card / inline-size; }

.apb-card { position: relative; background: var(--apb-surface); border: 1px solid var(--apb-border); border-radius: var(--apb-radius); box-shadow: var(--apb-shadow); padding: calc(var(--apb-spacing) * 2) calc(var(--apb-spacing) * 2.25) calc(var(--apb-spacing) * 2.25); display: grid; grid-template-rows: auto 1fr; align-content: start; gap: calc(var(--apb-spacing) * 1.25); min-width: 0; transition: box-shadow .2s ease, border-color .2s ease; }
/* Folded away, a card is its heading: it keeps the room that needs, not the room it had. */
.apb-card:has(> .apb-card-body[hidden]) { padding-bottom: var(--apb-spacing); }
@media (hover: hover) { .apb-card:hover { box-shadow: var(--apb-shadow-raised); border-color: var(--apb-edge); } }
/* One line: the name wraps within itself and the badges wrap among themselves, so pin and collapse
   stay in the corner however narrow the card. */
.apb-card-head { position: relative; display: flex; align-items: center; gap: var(--apb-spacing); min-height: 1.9em; }
.apb-card-head > .apb-badges { flex: 0 1 auto; min-width: 0; }
.apb-label { font-size: .95em; font-weight: var(--apb-strong-weight); line-height: 1.3; color: var(--apb-ink-secondary); min-width: 0; overflow-wrap: anywhere; }
.apb-badges { display: inline-flex; gap: calc(var(--apb-spacing) / 2); flex-wrap: wrap; }
.apb-badges:empty { display: none; }
.apb-badge { font-size: .72em; font-weight: var(--apb-strong-weight); line-height: 1.6; letter-spacing: .04em; text-transform: var(--apb-button-case); color: var(--apb-muted); border: 1px solid var(--apb-border); border-radius: 999px; padding: 0 .65em; white-space: nowrap; }
.apb-card-tools { margin-left: auto; margin-right: calc(var(--apb-spacing) * -.75); display: inline-flex; gap: 2px; }
.apb-icon { appearance: none; display: inline-grid; place-items: center; width: 1.9em; height: 1.9em; background: none; border: 0; border-radius: 999px; color: var(--apb-muted); cursor: pointer; padding: 0; font-size: 1em; line-height: 1; transition: background-color .15s ease, color .15s ease; }
.apb-icon:hover { background: var(--apb-hover); color: var(--apb-ink); }
.apb-icon[aria-pressed="true"] { color: var(--apb-link); }
.apb-card-body { display: grid; gap: var(--apb-spacing); align-content: start; min-width: 0; }
/* A block with nothing in it yet — a hint, a result, what is waiting — takes no room and no gap. */
.apb-card-body > :empty { display: none; }
.apb-card-body[hidden] { display: none; }
.apb-description { color: var(--apb-muted); font-size: .9em; line-height: 1.45; }
.apb-value { font-size: 2em; font-weight: var(--apb-strong-weight); line-height: 1.15; letter-spacing: -.02em; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.apb-value-text { font-size: 1.1em; font-weight: normal; line-height: 1.5; letter-spacing: 0; white-space: pre-wrap; }
.apb-value-json { font-family: var(--apb-mono-font); font-size: .85em; font-weight: normal; line-height: 1.5; letter-spacing: 0; white-space: pre; overflow: auto; max-height: 16em; background: var(--apb-surface-raised); border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.25); margin: 0; scrollbar-width: thin; }
.apb-value-empty { color: var(--apb-muted); }
.apb-value-error { color: var(--apb-bad); font-size: 1em; font-weight: normal; letter-spacing: 0; }
.apb-meta { color: var(--apb-muted); font-size: .82em; }

/* A value past a threshold: a bar down its leading edge and the word, as a shape and a colour. */
.apb-card[data-status="warn"]::before, .apb-card[data-status="bad"]::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: calc(var(--apb-radius) - 1px) 0 0 calc(var(--apb-radius) - 1px); background: var(--apb-warn); pointer-events: none; }
.apb-card[data-status="bad"]::before { background: var(--apb-bad); }
.apb-card[data-status="warn"] { border-color: color-mix(in srgb, var(--apb-warn) 40%, var(--apb-border)); }
.apb-card[data-status="bad"] { border-color: color-mix(in srgb, var(--apb-bad) 45%, var(--apb-border)); }
.apb-status-word:empty { display: none; }
.apb-status-word { display: inline-flex; align-items: center; gap: .4em; justify-self: start; font-weight: var(--apb-strong-weight); font-size: .8em; letter-spacing: .04em; text-transform: uppercase; }
.apb-status-word::before { content: ""; flex: none; width: .55em; height: .55em; border-radius: 50%; background: currentColor; }
td .apb-status-word, .apb-feed-entry .apb-status-word, .apb-activity .apb-status-word { margin-left: .4em; }
.apb-card[data-status="warn"] .apb-status-word, [data-status="warn"] > .apb-status-word, .apb-feed-entry[data-level="warn"] .apb-status-word { color: var(--apb-warn); }
.apb-card[data-status="bad"] .apb-status-word, [data-status="bad"] > .apb-status-word, .apb-feed-entry[data-level="bad"] .apb-status-word { color: var(--apb-bad); }
.apb-card[data-status="bad"] .apb-status-word::before { border-radius: 1px; transform: rotate(45deg); }
.apb-card[data-status="ok"] .apb-status-word { color: var(--apb-ok); }
td[data-status="warn"] { color: var(--apb-warn); }
td[data-status="bad"] { color: var(--apb-bad); }

/* ---- Controls ------------------------------------------------------------------------------ */
.apb-editor { display: flex; flex-wrap: wrap; gap: var(--apb-spacing); align-items: center; }
.apb-input, .apb-select, .apb-textarea { background: var(--apb-surface-raised); border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); min-height: var(--apb-control); padding: calc(var(--apb-spacing) / 2) calc(var(--apb-spacing) * 1.25); min-width: 0; flex: 1 1 8em; transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
.apb-select { cursor: pointer; padding-right: calc(var(--apb-spacing) * .75); }
.apb-input:hover, .apb-select:hover, .apb-textarea:hover { border-color: var(--apb-edge); }
.apb-input:focus, .apb-select:focus, .apb-textarea:focus { border-color: var(--apb-focus); background: var(--apb-surface); }
.apb-input:focus-visible, .apb-select:focus-visible, .apb-textarea:focus-visible { outline-offset: 0; box-shadow: 0 0 0 4px color-mix(in srgb, var(--apb-focus) 18%, transparent); }
.apb-input::placeholder, .apb-textarea::placeholder { color: var(--apb-muted); opacity: 1; }
.apb-input:disabled, .apb-select:disabled, .apb-textarea:disabled { opacity: .6; cursor: not-allowed; }
.apb-textarea { width: 100%; min-height: 6em; font-family: var(--apb-mono-font); font-size: .9em; line-height: 1.5; flex-basis: 100%; resize: vertical; }
.apb-range { flex: 1 1 100%; accent-color: var(--apb-accent); min-height: calc(var(--apb-spacing) * 3); cursor: pointer; }
.apb-button { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: .5em; min-height: var(--apb-control); border: 1px solid var(--apb-accent-strong); background: var(--apb-accent-strong); color: var(--apb-on-accent); border-radius: var(--apb-radius-small); padding: 0 calc(var(--apb-spacing) * 2); cursor: pointer; font-weight: var(--apb-strong-weight); line-height: 1.2; text-transform: var(--apb-button-case); letter-spacing: .03em; box-shadow: var(--apb-shadow); transition: background-color .15s ease, box-shadow .15s ease, transform .1s ease; }
/* Hover leans the fill towards the ink: darker in light, lighter in dark, which moves it away from
   the label's colour in both, so a hovered button never reads worse than a resting one. */
.apb-button:hover:not(:disabled) { background: color-mix(in srgb, var(--apb-accent-strong) 86%, var(--apb-ink)); box-shadow: var(--apb-shadow-raised); }
.apb-button:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
.apb-button:disabled { opacity: .55; cursor: not-allowed; box-shadow: none; }
/* Outlined rather than filled: the intent colours are measured as text on a surface, and a filled
   red would need a text colour of its own in every theme. The word says it too. */
.apb-button[data-armed="true"], .apb-button[data-armed="true"]:hover:not(:disabled) { background: var(--apb-surface); border-color: var(--apb-warn); color: var(--apb-warn); box-shadow: inset 0 0 0 1px var(--apb-warn); }
.apb-button-destructive { background: var(--apb-surface); border-color: var(--apb-bad); color: var(--apb-bad); box-shadow: none; }
.apb-button-destructive:hover:not(:disabled) { background: color-mix(in srgb, var(--apb-bad) 7%, var(--apb-surface)); box-shadow: inset 0 0 0 1px var(--apb-bad); }
.apb-switch { appearance: none; position: relative; width: 2.9em; height: 1.65em; border-radius: 999px; border: 1px solid var(--apb-edge); background: var(--apb-surface-raised); cursor: pointer; padding: 0; flex: none; transition: background-color .2s ease, border-color .2s ease; }
.apb-switch::after { content: ""; position: absolute; top: 50%; left: .17em; width: 1.2em; height: 1.2em; border-radius: 50%; background: var(--apb-muted); box-shadow: var(--apb-shadow); transform: translateY(-50%); transition: transform .2s ease, background-color .2s ease; }
.apb-switch[aria-checked="true"] { background: var(--apb-switch-on); border-color: var(--apb-switch-on); }
.apb-switch[aria-checked="true"]::after { transform: translate(1.24em, -50%); background: var(--apb-surface); }
.apb-switch:disabled { opacity: .55; cursor: not-allowed; }
.apb-checkbox { accent-color: var(--apb-accent); width: 1.2em; height: 1.2em; cursor: pointer; }
.apb-error { color: var(--apb-bad); font-size: .9em; flex-basis: 100%; }
.apb-error:empty, .apb-result:empty { display: none; }
.apb-result { font-size: .9em; color: var(--apb-ink-secondary); }
.apb-result[data-ok="false"] { color: var(--apb-bad); }
.apb-hint { color: var(--apb-muted); font-size: .85em; flex-basis: 100%; }
.apb-duration { flex: 0 1 auto; }
.apb-tool { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: .4em; min-height: calc(var(--apb-control) * .8); background: var(--apb-surface); border: 1px solid var(--apb-border); color: var(--apb-ink); border-radius: var(--apb-radius-small); padding: 0 calc(var(--apb-spacing) * 1.25); cursor: pointer; font-size: .85em; line-height: 1.2; white-space: nowrap; transition: background-color .15s ease, border-color .15s ease; }
.apb-tool:hover:not(:disabled) { background: var(--apb-hover-surface); border-color: var(--apb-edge); }
.apb-tool[aria-pressed="true"], .apb-tool[data-armed="true"] { border-color: var(--apb-warn); color: var(--apb-warn); box-shadow: inset 0 0 0 1px var(--apb-warn); }
.apb-tool-destructive { color: var(--apb-bad); border-color: var(--apb-bad); }
.apb-tool:disabled { opacity: .55; cursor: not-allowed; }
.apb-file { position: relative; }
.apb-file:focus-within { outline: 2px solid var(--apb-focus); outline-offset: 2px; }
.apb-pending:empty { display: none; }
.apb-pending .apb-note, .apb-activity .apb-note { display: flex; flex-wrap: wrap; gap: var(--apb-spacing); align-items: center; }
.apb-scheduled { list-style: none; margin: 0; padding: 0; display: grid; gap: calc(var(--apb-spacing) / 2); }
.apb-scheduled:empty { display: none; }
.apb-scheduled .apb-note { border-left-color: var(--apb-accent); }
.apb-inputs { display: grid; gap: calc(var(--apb-spacing) / 2); }
.apb-input-label { font-size: .88em; font-weight: var(--apb-strong-weight); color: var(--apb-ink-secondary); }
.apb-profile-settings { margin: 0; padding-left: 1.2em; color: var(--apb-ink-secondary); font-size: .9em; display: grid; gap: .15em; }
.apb-root summary { cursor: pointer; width: fit-content; color: var(--apb-link); font-size: .85em; font-weight: var(--apb-strong-weight); border-radius: var(--apb-radius-small); }
.apb-root summary:hover { text-decoration: underline; text-underline-offset: .2em; }
.apb-root summary::marker { color: var(--apb-muted); }
.apb-when, .apb-why, .apb-reason-field, .apb-type-confirm { flex-basis: 100%; }
.apb-why[open], .apb-reason-field, .apb-type-confirm { display: grid; gap: calc(var(--apb-spacing) / 2); }
.apb-when[open] { display: grid; gap: calc(var(--apb-spacing) / 2); }
.apb-timeline-list { margin: calc(var(--apb-spacing) / 2) 0 0; padding-left: 1.2em; font-size: .85em; color: var(--apb-ink-secondary); display: grid; gap: .2em; }
.apb-timeline-value { color: var(--apb-ink); font-weight: var(--apb-strong-weight); }
.apb-disabled-reason { color: var(--apb-warn); }
.apb-import-diff { margin: calc(var(--apb-spacing) / 2) 0; padding-left: 1.2em; font-size: .9em; }

/* A plot takes whatever height its card is given: a chart beside two rows of numbers fills them. */
.apb-card-body:has(> .apb-chart .apb-plot:not(.apb-plot-sparkline)) { display: flex; flex-direction: column; }
.apb-card-body:has(> .apb-chart .apb-plot:not(.apb-plot-sparkline)) > * { flex: none; align-self: stretch; }
.apb-card-body > .apb-chart:has(.apb-plot:not(.apb-plot-sparkline)) { flex: 1 1 auto; display: flex; flex-direction: column; }
.apb-chart:has(> div > .apb-plot:not(.apb-plot-sparkline)) > *, .apb-chart > div:has(> .apb-plot:not(.apb-plot-sparkline)) > * { flex: none; }
.apb-chart > div:has(> .apb-plot:not(.apb-plot-sparkline)) { flex: 1 1 auto; display: flex; flex-direction: column; }
.apb-chart > div > .apb-plot:not(.apb-plot-sparkline) { flex: 1 1 auto; height: auto; min-height: 180px; }

/* ---- Charts -------------------------------------------------------------------------------- */
.apb-chart { margin: 0; display: grid; gap: calc(var(--apb-spacing) * .75); min-width: 0; }
.apb-chart-body { border-radius: var(--apb-radius-small); padding-top: calc(var(--apb-spacing) / 2); }
.apb-plot { position: relative; height: 180px; margin-left: 3.5em; border-bottom: 1px solid var(--apb-border); touch-action: pan-y; cursor: crosshair; }
.apb-plot-sparkline { height: 40px; margin-left: 0; border: 0; cursor: default; }
.apb-plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.apb-gridline { stroke: var(--apb-grid); stroke-width: 1; vector-effect: non-scaling-stroke; }
.apb-line { fill: none; stroke: var(--apb-series); stroke-width: 2.25; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
.apb-area { fill: var(--apb-series); opacity: .16; stroke: none; }
.apb-bar { fill: var(--apb-series); }
.apb-dot { fill: none; stroke: var(--apb-series); stroke-width: 7; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.apb-area-fade { opacity: 1; }
.apb-fade-top { stop-color: var(--apb-series); stop-opacity: .34; }
.apb-fade-bottom { stop-color: var(--apb-series); stop-opacity: 0; }
.apb-dot-last { stroke-width: 8; }
/* The numbers at the pointer, in a tip beside the cursor that flips sides near the right edge. */
.apb-tip { position: absolute; top: .4em; z-index: 2; display: grid; gap: .2em; min-width: 8em; max-width: 18em; padding: .45em .7em; background: var(--apb-surface); color: var(--apb-ink); border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); box-shadow: var(--apb-shadow-raised); font-size: .8em; white-space: nowrap; pointer-events: none; transform: translateX(10px); }
.apb-tip[data-side="left"] { transform: translateX(calc(-100% - 10px)); }
.apb-tip-time { color: var(--apb-muted); font-variant-numeric: tabular-nums; }
.apb-tip-row { display: flex; align-items: center; gap: .45em; }
.apb-tip-label { color: var(--apb-ink-secondary); overflow: hidden; text-overflow: ellipsis; }
.apb-tip-value { margin-left: auto; padding-left: .8em; font-weight: var(--apb-strong-weight); font-variant-numeric: tabular-nums; }
.apb-tip .apb-swatch { margin-right: 0; }
.apb-tick { position: absolute; right: calc(100% + .5em); transform: translateY(-50%); font-size: .75em; color: var(--apb-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.apb-axis { display: flex; justify-content: space-between; margin-left: 3.5em; font-size: .75em; color: var(--apb-muted); gap: var(--apb-spacing); font-variant-numeric: tabular-nums; }
.apb-legend { display: flex; flex-wrap: wrap; gap: calc(var(--apb-spacing) / 2) calc(var(--apb-spacing) * 2); list-style: none; margin: 0; padding: 0; font-size: .85em; color: var(--apb-ink-secondary); }
.apb-swatch { display: inline-block; width: .85em; height: .85em; border-radius: 3px; background: var(--apb-series); margin-right: .45em; vertical-align: -.08em; }
.apb-legend-item { appearance: none; display: inline-flex; align-items: center; background: none; border: 0; margin: 0 -.45em; padding: .15em .45em; border-radius: var(--apb-radius-small); font: inherit; color: inherit; cursor: pointer; }
.apb-legend-item:hover { background: var(--apb-hover); }
.apb-legend-item[aria-pressed="false"] { color: var(--apb-muted); text-decoration: line-through; }
.apb-legend-item[aria-pressed="false"] .apb-swatch { background: transparent; box-shadow: inset 0 0 0 2px var(--apb-series); }
.apb-legend-item[aria-pressed="false"] .apb-legend-value { color: inherit; }
.apb-legend-value { color: var(--apb-ink); font-weight: var(--apb-strong-weight); font-variant-numeric: tabular-nums; margin-left: .35em; }
.apb-keys { display: grid; gap: calc(var(--apb-spacing) * .6); }
.apb-key-row { display: grid; grid-template-columns: minmax(4em, min(30%, 16em)) 1fr minmax(2.5em, auto); gap: var(--apb-spacing); align-items: center; font-size: .9em; }
.apb-key-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--apb-ink-secondary); }
.apb-key-track { height: .7em; background: var(--apb-grid); border-radius: 999px; overflow: hidden; }
.apb-key-bar { height: 100%; width: 0; background: var(--apb-series); border-radius: 999px; }
.apb-key-value { text-align: right; font-variant-numeric: tabular-nums; font-weight: var(--apb-strong-weight); }
.apb-gauge-track { height: .85em; border-radius: 999px; background: var(--apb-grid); overflow: hidden; }
.apb-gauge-fill { height: 100%; width: 0; background: var(--apb-series); border-radius: 999px; }
.apb-gauge-scale { display: flex; justify-content: space-between; font-size: .75em; color: var(--apb-muted); font-variant-numeric: tabular-nums; }
.apb-empty { color: var(--apb-muted); font-size: .9em; }
.apb-chart-tools { display: flex; flex-wrap: wrap; gap: calc(var(--apb-spacing) / 2); justify-content: flex-end; }
.apb-chart-tools:empty { display: none; }
.apb-threshold { stroke: var(--apb-bad); stroke-width: 1.5; stroke-dasharray: 6 4; vector-effect: non-scaling-stroke; }
.apb-threshold-label { position: absolute; right: 0; transform: translateY(15%); font-size: .75em; color: var(--apb-bad); background: var(--apb-surface); padding: 0 .35em; border-radius: var(--apb-radius-small); }
.apb-mark { stroke: var(--apb-muted); stroke-width: 1; stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }
.apb-zoom-band { position: absolute; top: 0; bottom: 0; background: var(--apb-accent); opacity: .15; pointer-events: none; }
.apb-cursor { stroke: var(--apb-ink); stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-dasharray: 3 3; }
.apb-heatmap { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 2px; font-size: .8em; font-variant-numeric: tabular-nums; }
.apb-heatmap thead td:first-child, .apb-heatmap tbody th { width: 3.2em; }
.apb-heatmap thead th { padding: 2px 0; text-align: center; overflow: hidden; text-overflow: clip; white-space: nowrap; }
.apb-heatmap th { font-weight: var(--apb-strong-weight); color: var(--apb-ink-secondary); padding: 2px 6px; text-align: left; }
.apb-heat-cell { position: relative; min-width: 0; padding: 3px 2px; text-align: right; border: 1px solid var(--apb-grid); border-radius: 3px; overflow: hidden; }
.apb-heat { position: absolute; inset: 0; background: var(--apb-series); }
.apb-heat-value { position: relative; }

/* ---- Tables and feeds ---------------------------------------------------------------------- */
.apb-table-view summary { margin-top: calc(var(--apb-spacing) / 4); }
.apb-card .apb-table-view .apb-table-wrap { max-height: 11em; }
/* Where the card has the room, the numbers go under the chart and nothing else changes. Where it
   does not, they stand where the chart stood (data-numbers="instead", decided by measuring): the
   card keeps the size it had, and nothing on the page below it moves because somebody read a table. */
.apb-card[data-numbers="instead"] > .apb-card-body { display: flex; flex-direction: column; }
.apb-card[data-numbers="instead"] > .apb-card-body > * { flex: none; align-self: stretch; }
.apb-card[data-numbers="instead"] > .apb-card-body > .apb-chart:has(> .apb-table-view[open]) { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.apb-card[data-numbers="instead"] .apb-chart:has(> .apb-table-view[open]) > * { flex: none; }
.apb-card[data-numbers="instead"] .apb-chart:has(> .apb-table-view[open]) > :is(.apb-chart-body, .apb-legend, .apb-chart-readout, .apb-empty) { display: none; }
/* What is inside a <details> is not a flex item of it in every engine, so the numbers cannot be
   shrunk to fit from the inside: the room left for them is measured and given to them (--apb-room),
   and they scroll within it, under their own headings. */
.apb-card[data-numbers="instead"] .apb-chart > .apb-table-view[open] { flex: 1 1 auto; min-height: 0; }
/* The numbers take exactly the room the chart had, and scroll if there are more of them than fit:
   the card is the size it was, whatever is being looked at inside it. */
.apb-card[data-numbers="instead"] .apb-chart > .apb-table-view[open] > .apb-table-wrap { max-height: var(--apb-room, 11em); margin-top: calc(var(--apb-spacing) / 2); }
.apb-table-wrap { max-height: 16em; overflow: auto; margin-top: var(--apb-spacing); border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); scrollbar-width: thin; }
.apb-block-table .apb-table-wrap { max-height: none; }
.apb-table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: .87em; font-variant-numeric: tabular-nums; }
.apb-table th, .apb-table td { text-align: left; padding: calc(var(--apb-spacing) * .75) calc(var(--apb-spacing) * 1.25); border-bottom: 1px solid var(--apb-border); vertical-align: top; }
.apb-table tbody tr:last-child td { border-bottom: 0; }
.apb-table th { position: sticky; top: 0; z-index: 1; background: var(--apb-surface-raised); font-weight: var(--apb-strong-weight); color: var(--apb-ink-secondary); white-space: nowrap; }
.apb-table tbody tr { transition: background-color .12s ease; }
.apb-table tbody tr:hover { background: var(--apb-hover); }
.apb-table-controls { display: flex; flex-wrap: wrap; gap: var(--apb-spacing); align-items: center; }
.apb-table-controls:empty { display: none; }
.apb-sort { appearance: none; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; font-weight: var(--apb-strong-weight); }
.apb-sort:hover { color: var(--apb-ink); }
th[aria-sort="ascending"] .apb-sort::after { content: " ▲"; color: var(--apb-link); }
th[aria-sort="descending"] .apb-sort::after { content: " ▼"; color: var(--apb-link); }
.apb-row-actions { white-space: nowrap; }
.apb-row-actions .apb-tool + .apb-tool { margin-left: calc(var(--apb-spacing) / 2); }
.apb-pager { display: flex; flex-wrap: wrap; gap: var(--apb-spacing); align-items: center; }
.apb-pager .apb-hint { flex-basis: auto; margin-right: auto; }
.apb-feed-tools { display: flex; flex-wrap: wrap; gap: calc(var(--apb-spacing) / 2); margin-bottom: calc(var(--apb-spacing) / 2); }
.apb-feed-filter { flex: 1 1 10em; min-width: 0; }
.apb-feed-levels { width: auto; flex: 0 1 auto; }
.apb-feed-list { list-style: none; margin: 0; padding: 0; max-height: 22em; overflow: auto; display: grid; align-content: start; border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); scrollbar-width: thin; }
.apb-feed-list:empty { display: none; }
.apb-feed-entry { display: flex; gap: var(--apb-spacing); align-items: baseline; font-size: .88em; padding: calc(var(--apb-spacing) / 2) var(--apb-spacing); border-bottom: 1px solid var(--apb-grid); border-left: 3px solid transparent; }
.apb-feed-entry:last-child { border-bottom: 0; }
.apb-feed-entry:hover { background: var(--apb-hover); }
.apb-feed-entry[data-level="warn"] { border-left-color: var(--apb-warn); }
.apb-feed-entry[data-level="bad"] { border-left-color: var(--apb-bad); }
.apb-feed-time { color: var(--apb-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.apb-feed-text { overflow-wrap: anywhere; font-family: var(--apb-mono-font); min-width: 0; }

/* ---- Activity ------------------------------------------------------------------------------ */
.apb-activity { display: grid; gap: calc(var(--apb-spacing) * 2); grid-template-columns: repeat(auto-fit, minmax(min(100%, 32rem), 1fr)); align-items: stretch; }
.apb-activity > section { background: var(--apb-surface); border: 1px solid var(--apb-border); border-radius: var(--apb-radius); box-shadow: var(--apb-shadow); padding: calc(var(--apb-spacing) * 2) calc(var(--apb-spacing) * 2.25); min-width: 0; display: grid; gap: var(--apb-spacing); align-content: start; }
.apb-activity > section:has(table), .apb-activity > .apb-approvals { grid-column: 1 / -1; }
.apb-activity h2 { display: flex; align-items: center; gap: .6em; font-size: 1.1em; font-weight: var(--apb-strong-weight); line-height: 1.3; }
/* The list of changes is what the tab is for: it is given the room to show a page of them. */
.apb-activity .apb-table-wrap { margin-top: 0; max-height: 28em; }
/* What is waiting reads across the row, with what can be done about it at the end of it. */
.apb-activity .apb-note > :first-child { flex: 1 1 20em; }
/* What happened is what the eye is looking for, so that column takes what the others do not need.
   Only where the table is a table: on a phone every row is stacked and each cell takes the width. */
@media (min-width: 601px) {
  .apb-activity .apb-table :is(th, td):nth-child(1) { width: 7.5em; }
  .apb-activity .apb-table :is(th, td):nth-child(2) { width: 15em; }
  .apb-activity .apb-table :is(th, td):nth-child(4) { width: 11em; }
  .apb-activity .apb-table :is(th, td):nth-child(5) { width: 1%; white-space: nowrap; }
}
/* Nothing to show is said in one readable column, not spread over the width of a section. */
.apb-activity .apb-empty { max-width: 44ch; margin-inline: auto; padding-block: calc(var(--apb-spacing) * 2); }
.apb-settings > div:not(.apb-import-preview) { display: flex; flex-wrap: wrap; gap: var(--apb-spacing); }
.apb-notice { padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.5); border: 1px solid var(--apb-border); border-left: 3px solid var(--apb-accent); background: var(--apb-surface); border-radius: var(--apb-radius-small); }
.apb-notice + .apb-notice { margin-top: var(--apb-spacing); }
.apb-notice[data-level="warning"] { border-left-color: var(--apb-warn); }
.apb-notice-level { font-weight: var(--apb-strong-weight); margin-right: .4em; }

/* ---- Dialogs ------------------------------------------------------------------------------- */
.apb-dialog { max-width: min(40rem, calc(100vw - 32px)); width: 100%; max-height: min(80vh, 44rem); border: 1px solid var(--apb-border); border-radius: calc(var(--apb-radius) * 1.5); background: var(--apb-surface); color: var(--apb-ink); padding: calc(var(--apb-spacing) * 2.5); box-shadow: var(--apb-shadow-raised); }
.apb-dialog[open] { animation: apb-pop .18s ease-out; }
.apb-dialog::backdrop { -webkit-backdrop-filter: brightness(.55) blur(3px); backdrop-filter: brightness(.55) blur(3px); }
.apb-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: var(--apb-spacing); margin-bottom: calc(var(--apb-spacing) * 1.5); }
.apb-dialog-head h2 { font-size: 1.15em; font-weight: var(--apb-strong-weight); }
.apb-dialog-body { display: grid; gap: var(--apb-spacing); }
.apb-palette-list { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow: auto; display: grid; gap: 2px; scrollbar-width: thin; }
.apb-palette-item { padding: calc(var(--apb-spacing) * .75) var(--apb-spacing); border-radius: var(--apb-radius-small); cursor: pointer; }
.apb-palette-item:hover { background: var(--apb-hover); }
.apb-palette-item[aria-selected="true"] { background: color-mix(in srgb, var(--apb-accent) 12%, var(--apb-surface)); outline: 2px solid var(--apb-focus); outline-offset: -2px; }
.apb-shortcuts { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--apb-spacing) calc(var(--apb-spacing) * 2); margin: 0; }
.apb-shortcuts dd { margin: 0; color: var(--apb-ink-secondary); }
.apb-shortcuts kbd { display: inline-block; min-width: 1.8em; text-align: center; font-family: var(--apb-mono-font); font-size: .9em; border: 1px solid var(--apb-border); border-bottom-width: 2px; border-radius: var(--apb-radius-small); padding: .05em .45em; background: var(--apb-surface-raised); }

.apb-main-compact { padding: 0; }
.apb-compact-group + .apb-compact-group { margin-top: calc(var(--apb-spacing) * 2); }

/* ---- What is happening -------------------------------------------------------------------- */
/* A value that just changed lights up and fades; the tint hugs the text rather than the card. */
.apb-value:not(.apb-value-json) { width: fit-content; max-width: 100%; border-radius: var(--apb-radius-small); }
.apb-value[data-changed] { animation: apb-changed 1.4s ease-out; }
.apb-trend { display: inline-flex; align-items: baseline; gap: .35em; width: fit-content; margin-top: calc(var(--apb-spacing) * -.5); font-size: .82em; font-weight: var(--apb-strong-weight); font-variant-numeric: tabular-nums; color: var(--apb-ink-secondary); }
.apb-trend-arrow { font-size: .8em; color: var(--apb-link); }
/* Out of date: the banner says why, the values go grey, the charts fade, so nothing on the page
   passes for a live reading while it is not one. */
.apb-stale { display: flex; align-items: center; gap: .65em; margin-top: calc(var(--apb-spacing) * 1.5); padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.5); background: var(--apb-surface); border: 1px solid var(--apb-warn); border-left-width: 4px; border-radius: var(--apb-radius-small); box-shadow: var(--apb-shadow); font-weight: var(--apb-strong-weight); }
.apb-stale::before { content: ""; flex: none; width: .6em; height: .6em; border-radius: 1px; transform: rotate(45deg); background: var(--apb-warn); }
.apb-root:is([data-connection="trouble"], [data-connection="signed-out"]) .apb-value { color: var(--apb-muted); }
.apb-root:is([data-connection="trouble"], [data-connection="signed-out"]) :is(.apb-plot svg, .apb-key-bar, .apb-gauge-fill, .apb-heat) { opacity: .45; }
/* Waiting for the server: a turning ring before the label, and no second press. */
:is(.apb-button, .apb-tool)[aria-busy="true"] { cursor: progress; }
:is(.apb-button, .apb-tool)[aria-busy="true"]:disabled { opacity: .8; }
:is(.apb-button, .apb-tool)[aria-busy="true"]::before { content: ""; flex: none; width: 1em; height: 1em; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: apb-spin .7s linear infinite; }
.apb-switch[aria-busy="true"]::after { animation: apb-breathe .8s ease-in-out infinite alternate; }
.apb-result[data-ok="true"]::before, .apb-result[data-ok="false"]::before { display: inline-block; margin-right: .4em; font-weight: var(--apb-strong-weight); }
.apb-result[data-ok="true"]::before { content: "✓"; content: "✓" / ""; color: var(--apb-ok); }
.apb-result[data-ok="false"]::before { content: "✕"; content: "✕" / ""; }
/* An edit not applied yet: a dot by the card's name, the field and Apply in the accent. */
.apb-card:has(.apb-editor[data-dirty]) > .apb-card-head .apb-label::after { content: ""; display: inline-block; width: .5em; height: .5em; margin-left: .45em; border-radius: 50%; background: var(--apb-accent); vertical-align: .1em; }
.apb-editor[data-dirty] > :first-child { border-color: var(--apb-accent); }
.apb-editor[data-dirty] > .apb-button:not(:disabled) { box-shadow: 0 0 0 3px color-mix(in srgb, var(--apb-accent) 30%, transparent); }
.apb-range-scale { flex: 1 1 100%; display: flex; justify-content: space-between; gap: var(--apb-spacing); margin-top: calc(var(--apb-spacing) * -.75); font-size: .75em; color: var(--apb-muted); font-variant-numeric: tabular-nums; }

/* ---- Finding your way ---------------------------------------------------------------------- */
.apb-nav-sentinel { height: 0; }
.apb-nav { transition: box-shadow .2s ease; }
.apb-search-key { position: absolute; right: .7em; top: 50%; transform: translateY(-50%); min-width: 1.6em; padding: 0 .4em; font-family: var(--apb-mono-font); font-size: .8em; line-height: 1.6; text-align: center; color: var(--apb-muted); background: var(--apb-surface-raised); border: 1px solid var(--apb-border); border-bottom-width: 2px; border-radius: var(--apb-radius-small); pointer-events: none; }
.apb-search:focus ~ .apb-search-key, .apb-search:not(:placeholder-shown) ~ .apb-search-key { display: none; }
/* The strip fades out at an end that has more tabs beyond it. */
.apb-tabs[data-more-after] { -webkit-mask-image: linear-gradient(to right, black calc(100% - 3em), transparent); mask-image: linear-gradient(to right, black calc(100% - 3em), transparent); }
.apb-tabs[data-more-before] { -webkit-mask-image: linear-gradient(to left, black calc(100% - 3em), transparent); mask-image: linear-gradient(to left, black calc(100% - 3em), transparent); }
.apb-tabs[data-more-before][data-more-after] { -webkit-mask-image: linear-gradient(to right, transparent, black 3em, black calc(100% - 3em), transparent); mask-image: linear-gradient(to right, transparent, black 3em, black calc(100% - 3em), transparent); }
.apb-card[data-reached] { animation: apb-reached 1.6s ease-out; }

/* ---- Tables and the change log, easier to scan --------------------------------------------- */
.apb-table .apb-num { text-align: right; }
.apb-table th.apb-num .apb-sort { text-align: right; }
.apb-who { display: inline-flex; align-items: center; gap: .5em; white-space: nowrap; }
.apb-initials { display: inline-grid; place-items: center; flex: none; width: 1.9em; height: 1.9em; border-radius: 50%; font-size: .78em; font-weight: var(--apb-strong-weight); letter-spacing: .02em; color: var(--apb-ink); background: color-mix(in srgb, var(--apb-series) 18%, var(--apb-surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--apb-series) 55%, transparent); }
.apb-change-label { color: var(--apb-ink-secondary); }
.apb-change-from { color: var(--apb-muted); text-decoration-color: var(--apb-muted); }
.apb-change-arrow { color: var(--apb-muted); }
.apb-change-to { text-decoration: none; font-weight: var(--apb-strong-weight); color: var(--apb-ink); }
/* Empty: a quiet line inside the frame, where the rows or entries would be. */
.apb-feed-list > .apb-empty, .apb-table-wrap > .apb-empty, .apb-activity .apb-empty { display: grid; justify-items: center; gap: var(--apb-spacing); padding: calc(var(--apb-spacing) * 2.5) calc(var(--apb-spacing) * 2); text-align: center; }
.apb-feed-list > .apb-empty::before, .apb-table-wrap > .apb-empty::before, .apb-activity .apb-empty::before { content: ""; width: 2.2em; height: 1.5em; border: 2px solid var(--apb-border); border-top-width: 5px; border-radius: var(--apb-radius-small); }
.apb-feed-list:has(> .apb-empty) { border-style: dashed; }

/* ---- A view for each viewer ---------------------------------------------------------------- */
.apb-root[data-density="compact"] .apb-grid { gap: var(--apb-spacing); grid-auto-rows: calc(var(--apb-row, 72px) * .8); }
.apb-root[data-density="compact"] .apb-card { padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.25) calc(var(--apb-spacing) * 1.25); gap: calc(var(--apb-spacing) / 2); }
.apb-root[data-density="compact"] .apb-card-body { gap: calc(var(--apb-spacing) / 2); }
.apb-root[data-density="compact"] .apb-grid > .apb-card .apb-value:not(.apb-value-json, .apb-value-text) { font-size: clamp(1.3em, 6.5cqi, 2.6em); }
.apb-root[data-density="compact"] .apb-label { font-size: .88em; }
.apb-root[data-density="compact"] .apb-nav { margin-bottom: calc(var(--apb-spacing) * 1.5); }
.apb-root[data-density="compact"] .apb-chart > div > .apb-plot:not(.apb-plot-sparkline) { min-height: 120px; }
.apb-root[data-density="compact"] .apb-pane-description { margin-bottom: var(--apb-spacing); }
/* Asked for more contrast: solid lines where there were hairlines, the band opaque, hints in the secondary ink. */
@media (prefers-contrast: more) {
  .apb-root { --apb-edge: var(--apb-ink-secondary); }
  .apb-card, .apb-input, .apb-select, .apb-textarea, .apb-tool, .apb-table-wrap, .apb-feed-list, .apb-badge, .apb-activity > section, .apb-note, .apb-notice { border-color: var(--apb-ink-secondary); }
  .apb-nav { background: var(--apb-background); -webkit-backdrop-filter: none; backdrop-filter: none; border-bottom-color: var(--apb-ink-secondary); }
  .apb-meta, .apb-hint, .apb-description, .apb-tick, .apb-axis, .apb-feed-time, .apb-tab .apb-count { color: var(--apb-ink-secondary); }
}
/* Windows contrast themes replace every colour with a few system ones. What is drawn with a
   background (bars, dots, marks) would vanish, so it is given a system colour itself. */
@media (forced-colors: active) {
  .apb-status::before, .apb-status-word::before, .apb-stale::before, .apb-swatch, .apb-key-bar, .apb-gauge-fill, .apb-tab::after, .apb-card[data-status]::before, .apb-switch::after, .apb-toolbar::after { forced-color-adjust: none; background: CanvasText; }
  .apb-tab[aria-selected="true"]::after, .apb-switch[aria-checked="true"] { forced-color-adjust: none; background: Highlight; }
  .apb-switch[aria-checked="true"]::after { background: HighlightText; }
  .apb-toolbar::before { forced-color-adjust: none; border-color: CanvasText; }
  .apb-key-track, .apb-gauge-track { border: 1px solid CanvasText; }
  .apb-plot svg { forced-color-adjust: none; }
  .apb-line, .apb-dot, .apb-cursor { stroke: CanvasText; }
  .apb-area, .apb-bar, .apb-heat { forced-color-adjust: none; fill: CanvasText; background: CanvasText; }
  .apb-gridline, .apb-mark { stroke: GrayText; }
  .apb-threshold { stroke: Highlight; }
  .apb-legend-item[aria-pressed="false"] .apb-swatch { background: Canvas; box-shadow: inset 0 0 0 2px CanvasText; }
  .apb-initials { forced-color-adjust: none; background: Canvas; color: CanvasText; box-shadow: inset 0 0 0 1px CanvasText; }
}

/* ---- The reading on a value's card ---------------------------------------------------------- */
.apb-reading { display: grid; gap: calc(var(--apb-spacing) / 2); justify-items: start; min-width: 0; }
.apb-reading > .apb-status-word, .apb-reading > .apb-meta { justify-self: start; }

/* ---- Settings ------------------------------------------------------------------------------ */
.apb-dialog { overflow: auto; }
.apb-settings-dialog { max-width: min(34rem, calc(100vw - 32px)); }
.apb-settings-section { display: grid; gap: calc(var(--apb-spacing) * 1.5); padding: calc(var(--apb-spacing) * 1.5) 0; border-top: 1px solid var(--apb-border); }
.apb-settings-section:first-child { border-top: 0; padding-top: 0; }
.apb-settings-heading { font-size: .78em; font-weight: var(--apb-strong-weight); letter-spacing: .06em; text-transform: uppercase; color: var(--apb-muted); }
.apb-setting { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--apb-spacing) * 2); }
.apb-setting-text { display: grid; gap: .15em; min-width: 0; }
.apb-setting-label { font-weight: var(--apb-strong-weight); }
.apb-setting-hint { color: var(--apb-muted); font-size: .85em; line-height: 1.4; }
.apb-setting > .apb-select { flex: 0 1 18em; min-width: 9em; }
.apb-setting > .apb-switch { flex: none; }
.apb-settings-actions { display: flex; flex-wrap: wrap; gap: var(--apb-spacing); }
.apb-settings-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--apb-spacing) calc(var(--apb-spacing) * 2); padding-top: calc(var(--apb-spacing) * 1.5); border-top: 1px solid var(--apb-border); }
.apb-settings-foot > .apb-hint { flex: 1 1 16em; }
@media (max-width: 600px) {
  .apb-settings-word, .apb-arrange-word { display: none; }
  .apb-settings-button, .apb-arrange-button { padding: 0 .7em; }
  .apb-setting { flex-wrap: wrap; }
  .apb-setting > .apb-select { flex: 1 1 100%; }
}
/* What a viewer turned off. */
.apb-root[data-flash="off"] .apb-value[data-changed] { animation: none; }
.apb-root[data-trends="off"] .apb-trend { display: none; }
.apb-root[data-motion="off"] *, .apb-root[data-motion="off"] *::before, .apb-root[data-motion="off"] *::after { animation: none !important; transition: none !important; }

/* ---- How much a card shows, by the room it has --------------------------------------------- */
/* The grid tells each card (data-detail): brief shows the name and the reading and nothing that
   would not fit; full shows everything, the low, average and high of a charted value among it. */
.apb-stats { display: none; }
.apb-card[data-detail="full"] .apb-stats { display: flex; }
.apb-stats { flex-wrap: wrap; gap: calc(var(--apb-spacing) / 2) calc(var(--apb-spacing) * 2); margin: 0; font-size: .82em; font-variant-numeric: tabular-nums; }
.apb-stats > div { display: flex; gap: .4em; align-items: baseline; }
.apb-stats dt { color: var(--apb-muted); }
.apb-stats dd { margin: 0; font-weight: var(--apb-strong-weight); color: var(--apb-ink); }
.apb-card[data-detail="normal"] .apb-description { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
/* A card with no room to draw in does not draw: what it says in words and numbers is what is left,
   and the way to the numbers behind the chart stays open. */
.apb-card[data-drawing="off"] .apb-chart > :is(.apb-chart-body, .apb-legend, .apb-chart-readout, .apb-chart-tools, .apb-empty) { display: none; }
/* Brief drops what is read, never what is used: every control a card offers stays, and so does the
   way to the numbers behind a chart — on a card this small they are the readable half of it. */
.apb-card[data-detail="brief"] :is(.apb-description, .apb-meta, .apb-trend, .apb-badges, .apb-chart-tools, .apb-legend, .apb-timeline, .apb-range-scale, .apb-axis, .apb-pane-description, .apb-table-controls, .apb-feed-tools) { display: none; }
/* Spacing follows how much room a card has: a small card gives its reading the space instead of its
   edges, a large one breathes. */
.apb-grid > .apb-card[data-detail="brief"] { padding: var(--apb-spacing) calc(var(--apb-spacing) * 1.25); gap: calc(var(--apb-spacing) / 2); }
.apb-grid > .apb-card[data-detail="brief"][data-tight] { padding: calc(var(--apb-spacing) * .75) var(--apb-spacing); }
.apb-grid > .apb-card[data-detail="full"] { padding: calc(var(--apb-spacing) * 2.25) calc(var(--apb-spacing) * 2.5) calc(var(--apb-spacing) * 2.5); gap: calc(var(--apb-spacing) * 1.5); }
.apb-card[data-detail="brief"] .apb-card-body { gap: calc(var(--apb-spacing) / 2); }
.apb-card[data-detail="brief"] .apb-card-head { min-height: 0; }
.apb-card[data-detail="brief"] .apb-reading { gap: calc(var(--apb-spacing) / 4); }
.apb-card[data-detail="full"] .apb-card-body { gap: calc(var(--apb-spacing) * 1.25); }
.apb-card[data-detail="full"] .apb-reading { gap: calc(var(--apb-spacing) * .75); }
/* A card with room to spare keeps what it holds off the edges rather than pinned to them. */
.apb-grid > .apb-card[data-room="top"] { padding-block: calc(var(--apb-spacing) * 2.25); }
/* The slack goes to what can use it — a chart's bars or line, a table, a feed — rather than being
   left between the blocks a card holds. */
.apb-card[data-room="spread"] > .apb-card-body { display: flex; flex-direction: column; row-gap: calc(var(--apb-spacing) * 1.25); }
.apb-card[data-room="spread"] > .apb-card-body > * { flex: none; align-self: stretch; }
.apb-card[data-room="spread"] > .apb-card-body > :is(.apb-chart, .apb-table-wrap, .apb-feed-list) { flex: 1 1 auto; min-height: 0; }
/* The rows of a table or a feed take the room the card has, whether that is more than they fill —
   the box grows, and what is left reads as room for more rows — or less, where they scroll and what
   is under them, the pager and what it says, stays in view. */
.apb-grid > .apb-card:has(> .apb-card-body > :is(.apb-block-table, .apb-feed)) > .apb-card-body { display: flex; flex-direction: column; }
.apb-grid > .apb-card > .apb-card-body > :is(.apb-block-table, .apb-feed) { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; gap: var(--apb-spacing); }
/* Everything in them keeps its own height — a hint is a line, not a share of the card. */
.apb-grid > .apb-card > .apb-card-body > :is(.apb-block-table, .apb-feed) > * { flex: none; }
.apb-grid > .apb-card > .apb-card-body > .apb-block-table > .apb-table-wrap { flex: 1 1 auto; min-height: 0; max-height: none; }
.apb-grid > .apb-card > .apb-card-body > .apb-feed > .apb-feed-list { flex: 1 1 auto; min-height: 0; max-height: none; }
/* Everything else in them keeps its own height — a hint is a line, not a share of the card. */
:is(.apb-block-table, .apb-feed) > :empty { display: none; }
/* The chart keeps its parts in order — a title, its tools, then what is drawn — and the drawing
   takes the slack, wherever in that order it comes. */
.apb-card[data-room="spread"] > .apb-card-body > .apb-chart { display: flex; flex-direction: column; }
.apb-card[data-room="spread"] > .apb-card-body > .apb-chart > * { flex: none; }
.apb-card[data-room="spread"] > .apb-card-body > .apb-chart > .apb-chart-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; justify-content: center; }
/* Bars take some of the height between them and are centred in the rest: room to breathe, not a
   chart pulled apart over a card twice its size. */
.apb-card[data-room="spread"] .apb-keys { flex: 1 1 auto; min-height: 0; align-content: stretch; grid-auto-rows: minmax(min-content, 1fr); row-gap: calc(var(--apb-spacing) * .8); }
.apb-card[data-room="spread"] .apb-key-track { height: min(1.8em, 100%); }
.apb-card[data-room="spread"] .apb-plot-sparkline { flex: 1 1 auto; height: auto; min-height: 40px; max-height: 110px; }
/* A narrow card keeps its name to two lines rather than wrapping a long word letter by letter. */
.apb-card[data-detail="brief"] .apb-label { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: normal; }
.apb-card[data-detail="brief"] .apb-plot:not(.apb-plot-sparkline) { margin-left: 0; }
.apb-card[data-detail="brief"] .apb-tick { display: none; }
.apb-card[data-detail="full"] .apb-legend { font-size: .9em; }
.apb-card[data-detail="brief"] :is(.apb-stats, .apb-chart-readout) { display: none; }
/* Smaller than what it holds, even at its briefest: it scrolls inside itself, so one card cannot
   stretch its row and every card beside it. */
.apb-card[data-tight] { overflow: clip; overflow-clip-margin: 4px; }
/* Room to shrink in, so what a card holds is laid out inside it rather than past its edge, and a
   card holding more than it was given scrolls it: opening something on a card never spills over the
   cards under it, whatever the card is able to do about its own size. A card that is scrolling says
   so at the edge there is more past — drawn by the scrolling itself, not by script. */
.apb-grid > .apb-card > .apb-card-body { min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.apb-grid > .apb-card[data-tight] > .apb-card-body {
  background:
    linear-gradient(var(--apb-surface) 30%, color-mix(in srgb, var(--apb-surface) 0%, transparent)) top / 100% 12px no-repeat local,
    linear-gradient(color-mix(in srgb, var(--apb-surface) 0%, transparent), var(--apb-surface) 70%) bottom / 100% 12px no-repeat local,
    radial-gradient(farthest-side at 50% 0, color-mix(in srgb, var(--apb-ink) 26%, transparent), transparent) top / 100% 9px no-repeat scroll,
    radial-gradient(farthest-side at 50% 100%, color-mix(in srgb, var(--apb-ink) 26%, transparent), transparent) bottom / 100% 9px no-repeat scroll;
}
.apb-grid > .apb-card[data-tight] .apb-value:not(.apb-value-json, .apb-value-text) { font-size: clamp(1.1em, 5.5cqi, 1.9em); }
/* Room to spare, and nothing in the card that grows into it: what is read stays where it is read,
   at the top, with a number that grows into the space; what is done with the card — a button, a
   field, a schedule — goes to the foot of it. A card is read corner to corner, not from its middle. */
.apb-grid > .apb-card[data-room] .apb-value:not(.apb-value-json, .apb-value-text) { font-size: clamp(1.7em, 9cqi, 3.6em); }
.apb-grid > .apb-card[data-room="top"] .apb-value:not(.apb-value-json, .apb-value-text) { font-size: clamp(2em, 13cqi, 4.6em); }
/* Rows to spare over what the card needs: the reading is drawn to the room, not only to the width. */
.apb-grid > .apb-card[data-grow="2"] .apb-value:not(.apb-value-json, .apb-value-text) { font-size: clamp(2.4em, 17cqi, 6em); }
.apb-grid > .apb-card[data-grow="3"] .apb-value:not(.apb-value-json, .apb-value-text) { font-size: clamp(3em, 22cqi, 7.5em); }
.apb-card[data-room] .apb-reading { gap: calc(var(--apb-spacing) * .75); }
.apb-card[data-room="top"] .apb-reading { gap: calc(var(--apb-spacing) * 1.1); }
/* A card that holds a reading and nothing else is read corner to corner: the number at the top of
   it, and what it says about the number at the foot. The foot is marked where it is, since what a
   card holds is not always where the markup would have it. */
.apb-card[data-room="top"] > .apb-card-body:has(> .apb-reading > [data-foot]) { display: flex; flex-direction: column; }
.apb-card[data-room="top"] > .apb-card-body > .apb-reading:has(> [data-foot]) { flex: 1 1 auto; display: flex; flex-direction: column; align-items: start; }
.apb-grid > .apb-card[data-room="ends"] { padding-block: calc(var(--apb-spacing) * 2.25); }
.apb-card[data-room="ends"] > .apb-card-body { display: flex; flex-direction: column; }
.apb-card[data-room="ends"] > .apb-card-body > * { flex: none; }
.apb-card[data-room] [data-foot] { margin-top: auto; }
/* A bar on a card with room to spare is drawn heavier, so the height reads as the gauge's own. */
.apb-card[data-room] .apb-gauge-track { height: 1.15em; }
.apb-card[data-room] .apb-gauge-scale { font-size: .85em; }

/* ---- Arranging cards ----------------------------------------------------------------------- */
/* While arranging, a card shows exactly the cells it is being given, whatever it holds. */
.apb-root[data-arranging] .apb-grid > .apb-card { overflow: hidden; }
.apb-root[data-arranging] .apb-grid > .apb-card { outline: 2px dashed color-mix(in srgb, var(--apb-accent) 55%, transparent); outline-offset: 3px; }
.apb-root[data-arranging] .apb-card-body[inert], .apb-root[data-arranging] .apb-card-tools[inert] { opacity: .45; filter: saturate(.4); }
.apb-arrange { position: absolute; z-index: 3; left: 50%; bottom: calc(var(--apb-spacing) * .75); transform: translateX(-50%); display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: calc(var(--apb-spacing) / 2); max-width: calc(100% - var(--apb-spacing) * 1.5); padding: calc(var(--apb-spacing) / 2); background: var(--apb-surface); color: var(--apb-ink); border: 1px solid var(--apb-border); border-radius: calc(var(--apb-radius-small) * 2); box-shadow: var(--apb-shadow-raised); font-size: .85em; }
.apb-arrange-group { display: inline-flex; align-items: center; gap: 2px; padding: 0 2px; border-radius: var(--apb-radius-small); background: var(--apb-surface-raised); }
.apb-arrange-axis { padding: 0 .35em; font-size: .8em; font-weight: var(--apb-strong-weight); color: var(--apb-ink-secondary); }
.apb-arrange-step { appearance: none; min-width: 2em; height: 2em; padding: 0; border: 0; border-radius: var(--apb-radius-small); background: none; color: var(--apb-ink); font-weight: var(--apb-strong-weight); cursor: pointer; }
.apb-arrange-step:hover { background: var(--apb-hover); }
.apb-arrange-size { min-width: 3.2em; text-align: center; font-variant-numeric: tabular-nums; color: var(--apb-ink-secondary); }
/* Six dots in the text colour: the handle a card is dragged by. */
.apb-arrange-grip { appearance: none; width: 2em; height: 2em; padding: 0; border: 0; border-radius: var(--apb-radius-small); background: radial-gradient(circle, currentColor 1.5px, transparent 2px) 0 0 / 50% 33.3% repeat; background-origin: content-box; background-clip: content-box; padding: .45em .6em; color: var(--apb-ink-secondary); cursor: grab; touch-action: none; }
.apb-arrange-grip:hover { background-color: var(--apb-hover); }
.apb-arrange-corner { position: absolute; z-index: 3; right: -1px; bottom: -1px; width: 20px; height: 20px; border-bottom-right-radius: var(--apb-radius); background: linear-gradient(135deg, transparent 50%, var(--apb-accent) 50%); cursor: nwse-resize; touch-action: none; }
/* A card picked up leaves the grid and follows the pointer; the slot shows where it will land. */
.apb-root[data-arranging] .apb-grid > .apb-card { cursor: grab; user-select: none; }
.apb-card[data-dragging] { position: fixed; z-index: 30; left: var(--apb-drag-x, 0); top: var(--apb-drag-y, 0); width: var(--apb-drag-width, auto); height: var(--apb-drag-height, auto); margin: 0; transform: rotate(.6deg) scale(1.02); box-shadow: var(--apb-shadow-raised); cursor: grabbing; opacity: .94; }
.apb-drop-slot { border: 2px dashed var(--apb-accent); border-radius: var(--apb-radius); background: color-mix(in srgb, var(--apb-accent) 8%, transparent); }
.apb-card[data-dragging] .apb-arrange-grip { cursor: grabbing; }
.apb-card[data-resizing] { outline-style: solid !important; }
.apb-arrange-bar { position: sticky; bottom: calc(var(--apb-spacing) * 1.5); z-index: 5; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: calc(var(--apb-spacing) / 2) calc(var(--apb-spacing) * 2); margin-top: calc(var(--apb-spacing) * 3); padding: calc(var(--apb-spacing) * 1.5) calc(var(--apb-spacing) * 2); background: var(--apb-surface); border: 1px solid var(--apb-border); border-radius: var(--apb-radius); box-shadow: var(--apb-shadow-raised); }
.apb-arrange-bar > p { grid-column: 1; }
.apb-arrange-title { font-weight: var(--apb-strong-weight); }
.apb-arrange-said:empty { display: none; }
.apb-arrange-said { font-size: .9em; color: var(--apb-ink-secondary); }
.apb-arrange-actions { grid-column: 2; grid-row: 1 / span 3; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--apb-spacing); }
.apb-button-quiet { background: var(--apb-surface); color: var(--apb-link); border-color: var(--apb-border); box-shadow: none; }
.apb-button-quiet:hover:not(:disabled) { background: var(--apb-hover-surface); }
@media (max-width: 720px) {
  .apb-arrange-bar { grid-template-columns: 1fr; }
  .apb-arrange-actions { grid-column: 1; grid-row: auto; justify-content: stretch; }
  .apb-arrange-actions > * { flex: 1 1 auto; }
}

/* ---- Sizes --------------------------------------------------------------------------------- */
/* A card reads its own width: the number grows with the room it is given, a narrow card keeps its
   description to two lines, and a wide one sets its reading in one line above its chart. */
.apb-grid > .apb-card .apb-value:not(.apb-value-json, .apb-value-text) { font-size: clamp(1.5em, 7cqi, 2.8em); }
/* A reading that is words rather than a figure: a phrase steps down from the display size, and a
   sentence is set as text. Whatever room the card has, a wall of huge words is not readable. */
.apb-grid > .apb-card .apb-value[data-long="words"]:not(.apb-value-json, .apb-value-text) { font-size: clamp(1.2em, 4.5cqi, 1.8em); letter-spacing: 0; }
.apb-grid > .apb-card .apb-value[data-long="sentence"]:not(.apb-value-json, .apb-value-text) { font-size: 1.1em; line-height: 1.45; letter-spacing: 0; }
/* These widths are read in em, not pixels: a card is narrow when it is narrow for the text in it,
   so a page at twice the text size lays its cards out as a narrow card, not as a wide one. */
@container apb-card (max-width: 15.6em) {
  /* The name wraps within itself beside the tools; badges go under it. */
  .apb-card-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; row-gap: calc(var(--apb-spacing) / 2); }
  .apb-card-head > .apb-label { grid-column: 1; grid-row: 1; }
  .apb-card-head > .apb-card-tools { grid-column: 2; grid-row: 1; }
  .apb-card-head > .apb-badges { grid-column: 1 / -1; grid-row: 2; }
}
@container apb-card (max-width: 15em) {
  .apb-description { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .apb-card-tools { margin-right: calc(var(--apb-spacing) * -1.25); }
}
/* A heatmap narrower than its numbers keeps its colours and says the numbers to a screen reader.
   Every other hour is labelled; narrower still, only every sixth, since half a label read as a
   number of its own. */
@container apb-card (max-width: 51em) {
  .apb-heat-value { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .apb-heat-cell { height: 1.6em; }
  .apb-heatmap thead th:nth-child(odd) { font-size: 0; }
}
@container apb-card (max-width: 35em) {
  .apb-heatmap thead th { font-size: 0; }
  /* The hour it labels is wider than its column: it reads across the empty labels beside it. */
  .apb-heatmap thead th:nth-child(6n + 2) { font-size: .95em; overflow: visible; }
  .apb-heatmap thead td:first-child, .apb-heatmap tbody th { width: 2.6em; }
}
@container apb-card (min-width: 35em) {
  /* Wide and no room to spare: the reading reads as one line above what it charts. A card with
     height to fill keeps it stacked instead, so the room goes into the reading rather than beside it. */
  .apb-card:not([data-room="top"]) .apb-reading { display: flex; flex-wrap: wrap; align-items: baseline; gap: calc(var(--apb-spacing) / 2) calc(var(--apb-spacing) * 2); }
  .apb-card:not([data-room="top"]) .apb-reading > .apb-trend { margin-top: 0; }
  .apb-card[data-room="top"] .apb-stats { gap: calc(var(--apb-spacing) / 2) calc(var(--apb-spacing) * 2.5); }
}
@media (max-width: 600px) {
  /* On a phone the band would cover a fifth of the screen; it scrolls away with the page. */
  .apb-nav > .apb-toolbar { max-width: none; margin-bottom: 0; }
  .apb-standalone .apb-nav[data-stuck] { box-shadow: none; border-bottom-color: var(--apb-border); margin-left: 0; margin-right: 0; padding-left: 0; padding-right: 0; }
  .apb-nav { position: static; margin-bottom: calc(var(--apb-spacing) * 2); -webkit-backdrop-filter: none; backdrop-filter: none; background: none; }
  .apb-header { padding-top: var(--apb-spacing); padding-bottom: var(--apb-spacing); }
  .apb-header::after { content: ""; order: 1; flex-basis: 100%; height: 0; }
  .apb-status { order: 2; }
  .apb-arrange-word { display: none; }
  .apb-settings-button { margin-left: auto; }
  .apb-status { margin-left: 0; margin-right: auto; }
  .apb-tab { padding: 0 var(--apb-spacing); }
  .apb-grid { gap: calc(var(--apb-spacing) * 1.5); }
  /* A sparkline is a line without an axis, and stays the size that reads as one. */
  .apb-plot:not(.apb-plot-sparkline) { height: 150px; }
  .apb-chart > div > .apb-plot:not(.apb-plot-sparkline) { min-height: 150px; }
  /* Each row a card of labelled lines: no sideways scrolling on a phone, however many columns. */
  .apb-table-wrap:has(> .apb-table-stacking) { border: 0; border-radius: 0; }
  .apb-table-stacking thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .apb-table-stacking, .apb-table-stacking tbody, .apb-table-stacking tr, .apb-table-stacking td { display: block; width: 100%; }
  .apb-table-stacking tr { background: var(--apb-surface); border: 1px solid var(--apb-border); border-radius: var(--apb-radius-small); margin-bottom: var(--apb-spacing); padding: calc(var(--apb-spacing) / 2) var(--apb-spacing); }
  .apb-table-stacking tbody tr:last-child td, .apb-table-stacking td { display: grid; grid-template-columns: minmax(6em, 40%) 1fr; gap: var(--apb-spacing); border-bottom: 0; padding: calc(var(--apb-spacing) / 3) 0; overflow-wrap: anywhere; }
  .apb-table-stacking td::before { content: attr(data-label); color: var(--apb-ink-secondary); font-weight: var(--apb-strong-weight); text-align: left; }
  /* A number is read against its label, not pushed away from it, once the row is a list. */
  .apb-table-stacking td.apb-num { text-align: left; }
  /* The buttons on a row sit side by side and wrap, rather than one full-width button each. */
  .apb-table-stacking td[data-label=""] { display: flex; flex-wrap: wrap; gap: calc(var(--apb-spacing) / 2); }
  .apb-table-stacking td[data-label=""] > * { flex: 1 1 auto; }
  .apb-table-stacking td[data-label=""]::before { content: none; }
  .apb-table-wrap:has(> .apb-table-stacking) { overflow-x: visible; }
  .apb-activity > section { padding: calc(var(--apb-spacing) * 1.75); }
}
/* A finger is not a cursor: targets grow to a size a thumb hits, and inputs reach the size at
   which a phone does not zoom the page on focus. */
@media (pointer: coarse) {
  .apb-tool, .apb-tab { min-height: 44px; }
  .apb-search-key { display: none; }
  .apb-icon { width: 40px; height: 40px; }
  .apb-button { min-height: 44px; }
  .apb-input, .apb-select, .apb-textarea { font-size: max(16px, 1em); min-height: 44px; }
}
@media print {
  .apb-nav, .apb-card-tools, .apb-chart-tools, .apb-settings-button, .apb-arrange-button, .apb-editor, .apb-skip, .apb-arrange, .apb-arrange-corner, .apb-arrange-bar { display: none !important; }
  .apb-header, .apb-card, .apb-activity > section { box-shadow: none; }
  .apb-card { break-inside: avoid; }
}
@keyframes apb-beat { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 .5em transparent; } }
@keyframes apb-changed { from { background-color: color-mix(in srgb, var(--apb-accent) 24%, transparent); box-shadow: 0 0 0 .2em color-mix(in srgb, var(--apb-accent) 24%, transparent); } to { background-color: transparent; box-shadow: 0 0 0 .2em transparent; } }
@keyframes apb-spin { to { transform: rotate(1turn); } }
@keyframes apb-breathe { to { opacity: .4; } }
@keyframes apb-reached { from { box-shadow: 0 0 0 4px var(--apb-focus), var(--apb-shadow-raised); } to { box-shadow: 0 0 0 4px transparent, var(--apb-shadow-raised); } }
@keyframes apb-rise { from { transform: translateY(4px); } to { transform: none; } }
@keyframes apb-pop { from { transform: translateY(6px) scale(.985); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .apb-root *, .apb-root *::before, .apb-root *::after { animation: none !important; transition: none !important; }
}
${slotClasses()}
`;
