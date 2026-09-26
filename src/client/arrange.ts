/**
 * Arranging a group's cards on the page: drag them where they belong, resize them in whole cells,
 * then keep the result for this viewer or, where they may edit, for everybody.
 *
 * Every change has two ways in. With a mouse or a pen a card is picked up anywhere on it and dropped
 * where it should go — a placeholder shows the place, and the grid repacks around it as it moves —
 * and resized by its corner. With the keyboard or a finger, the buttons on each card move it earlier
 * or later and make it wider, narrower, taller or shorter, one cell at a time (a finger drags by
 * the handle, so the page still scrolls under it), and a polite live region says where it is now.
 * While arranging, what the cards hold is inert, so a drag never presses a button and Tab walks
 * the arranging controls only. The cards around the one being moved keep filling the space: only
 * the sizes somebody chose are kept as they are.
 *
 * The page holds still while arranging: updates pause, rows keep exactly the height of their cells
 * whatever a card holds, and the page catches up when arranging ends.
 *
 * Nothing is kept until a Save. Cancel puts back what was there, and so does Escape; during a drag
 * Escape puts that card back where it was picked up, and arranging goes on.
 */
import type { CardSize, GroupLayout, PanelLayout, PanelSchema } from "../types.js";
import { el } from "./dom.js";
import { explain } from "./explain.js";
import type { GridView, Placed } from "./grid.js";
import type { Translate } from "./i18n.js";
import type { Prefs } from "./prefs.js";
import type { ViewDeps } from "./view-deps.js";

export interface ArrangeHost {
  readonly t: Translate;
  readonly prefs: Prefs;
  readonly deps: ViewDeps;
  schema(): PanelSchema;
  /** The group whose tab is open, choosing the first group when another tab is. */
  arrangeableGroup(): { id: string; title: string } | undefined;
  readonly grids: ReadonlyMap<string, GridView>;
  /** Where the arranging bar goes: the end of the page's main region. */
  mainRegion(): HTMLElement;
  /** Arranging ended; the page may update again. */
  arrangingStopped(): void;
}

export interface Arranging {
  /** Leaves arranging; `restore` puts back what was there before it began. */
  stop(restore: boolean): void;
}

/** How near the top or bottom of the window a dragged card scrolls the page, in CSS pixels. */
const SCROLL_EDGE = 60;

export function startArranging(host: ArrangeHost): Arranging | undefined {
  const group = host.arrangeableGroup();
  if (group === undefined) return undefined;
  const found = host.grids.get(group.id);
  if (found === undefined) return undefined;
  const view: GridView = found;
  const { t, prefs, deps } = host;
  // Every listener arranging adds is dropped when it ends: a card is draggable while it is being
  // arranged and at no other time, so what a card holds can be used again afterwards.
  const listening = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(element: HTMLElement, event: K, run: (event: HTMLElementEventMap[K]) => void): void => {
    element.addEventListener(event, run, { signal: listening.signal });
  };
  const before = view.saved();
  const wasAutomatic = view.isAutomatic();
  const root = deps.container;
  root.setAttribute("data-arranging", "");

  const bar = el("div", "apb-arrange-bar");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", t("layoutEditing", { group: group.title }));
  const heading = el("p", "apb-arrange-title", t("layoutEditing", { group: group.title }));
  const hint = el("p", "apb-hint", t("layoutHint"));
  const said = el("p", "apb-arrange-said");
  said.setAttribute("aria-live", "polite");
  const buttons = el("div", "apb-arrange-actions");
  const button = (label: string, className: string, run: () => void): HTMLButtonElement => {
    const made = el("button", className, label);
    made.type = "button";
    made.addEventListener("click", run);
    buttons.append(made);
    return made;
  };
  button(t("layoutDefault"), "apb-tool", () => {
    view.reset();
    refreshAll();
  });
  button(t("layoutCancel"), "apb-tool", () => stop(true));
  button(t("layoutSaveMine"), host.schema().layoutWritable !== true ? "apb-button" : "apb-button apb-button-quiet", () => {
    const layouts: PanelLayout = { ...(prefs.layout ?? {}) };
    layouts[group.id] = view.saved();
    prefs.layout = layouts;
    prefs.save();
    said.textContent = t("layoutSavedMine");
    stop(false);
  });
  if (host.schema().layoutWritable === true && deps.api !== undefined) {
    const api = deps.api;
    const everybody = button(t("layoutSaveAll"), "apb-button", () => {
      const shared: PanelLayout = { ...(host.schema().layout ?? {}) };
      // The automatic layout is what the code gives: saving it for everybody is saving nothing.
      if (view.isAutomatic()) delete shared[group.id];
      else shared[group.id] = view.saved();
      everybody.disabled = true;
      api.saveLayout(Object.keys(shared).length === 0 ? null : shared).then(
        () => {
          // Their own layout of this group would hide the one they just gave everybody.
          if (prefs.layout?.[group.id] !== undefined) {
            const kept: PanelLayout = { ...prefs.layout };
            delete kept[group.id];
            prefs.layout = Object.keys(kept).length === 0 ? undefined : kept;
            prefs.save();
          }
          said.textContent = t("layoutSavedAll");
          stop(false);
          deps.refresh();
        },
        (problem: unknown) => {
          everybody.disabled = false;
          said.textContent = explain(problem, t);
        },
      );
    });
  }
  bar.append(heading, hint, said, buttons);
  host.mainRegion().append(bar);

  // Escape is the way out of anything on this page, and arranging is no exception: it does what
  // Cancel does. A drag answers it first, and puts its own card back; so does a dialog, and a field
  // holding something half typed.
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (root.querySelector("[data-dragging], [data-resizing]") !== null) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest("dialog[open]") !== null || target.matches("input, textarea, select"))) return;
      event.preventDefault();
      stop(true);
    },
    { signal: listening.signal },
  );

  const decorated = view.declared().map((card) => decorate(card));
  // Focus to the first card on the screen, where the viewer was looking; the page does not move.
  const visible = view.arrangement().find((card) => {
    const box = card.element.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  });
  (visible ?? view.arrangement()[0])?.element.querySelector<HTMLElement>(".apb-arrange button")?.focus({ preventScroll: true });

  function labelOf(card: Placed): string {
    return card.element.querySelector(".apb-label, .apb-chart-title")?.textContent ?? card.label;
  }

  function announce(card: Placed): void {
    const arranged = view.arrangement();
    const place = arranged.findIndex((entry) => entry.id === card.id) + 1;
    const size = view.sizeOf(card.element) ?? card.sizing.pref;
    said.textContent = t("layoutNow", { label: labelOf(card), w: size.w, h: size.h, place, count: arranged.length });
  }

  function refreshAll(): void {
    for (const { card, size } of decorated) size.textContent = sizeText(card);
  }

  function sizeText(card: Placed): string {
    const size = view.sizeOf(card.element);
    return size === undefined ? "" : `${size.w} × ${size.h}`;
  }

  /** The arranging controls on one card, and what it holds made inert. */
  function decorate(card: Placed): { card: Placed; tool: HTMLElement; corner: HTMLElement; size: HTMLElement } {
    const label = labelOf(card);
    const body = card.element.querySelector<HTMLElement>(".apb-card-body");
    if (body !== null) body.inert = true;
    card.element.querySelector<HTMLElement>(".apb-card-tools")?.setAttribute("inert", "");
    const tool = el("div", "apb-arrange");
    const grip = el("button", "apb-arrange-grip");
    grip.type = "button";
    grip.setAttribute("aria-label", t("layoutMove", { label }));
    grip.title = t("layoutMove", { label });
    const step = (text: string, name: string, run: () => void): HTMLButtonElement => {
      const made = el("button", "apb-arrange-step", text);
      made.type = "button";
      made.setAttribute("aria-label", name);
      made.title = name;
      made.addEventListener("click", () => {
        run();
        refreshAll();
        announce(card);
        made.focus();
      });
      return made;
    };
    const move = el("span", "apb-arrange-group");
    move.append(
      step("←", t("layoutEarlier", { label }), () => view.step(card.id, -1)),
      step("→", t("layoutLater", { label }), () => view.step(card.id, 1)),
    );
    const resize = (dw: number, dh: number) => () => {
      const size = view.sizeOf(card.element) ?? card.sizing.pref;
      view.resize(card.element, { w: size.w + dw, h: size.h + dh });
    };
    const width = el("span", "apb-arrange-group");
    width.append(el("span", "apb-arrange-axis", "W"), step("−", t("layoutNarrower", { label }), resize(-1, 0)), step("+", t("layoutWider", { label }), resize(1, 0)));
    const height = el("span", "apb-arrange-group");
    height.append(el("span", "apb-arrange-axis", "H"), step("−", t("layoutShorter", { label }), resize(0, -1)), step("+", t("layoutTaller", { label }), resize(0, 1)));
    const size = el("span", "apb-arrange-size", sizeText(card));
    size.setAttribute("aria-hidden", "true");
    const corner = el("span", "apb-arrange-corner");
    corner.setAttribute("aria-hidden", "true");
    corner.title = t("layoutResize", { label });
    tool.append(grip, move, width, height, size);
    card.element.append(tool, corner);
    dragToMove(card, grip);
    dragToResize(card, corner);
    return { card, tool, corner, size };
  }

  /**
   * Picking a card up: it leaves the grid and follows the pointer, a placeholder takes its place,
   * and the placeholder moves before or after whichever card the pointer is over, the grid packing
   * again around it. A mouse or pen picks a card up anywhere on it; a finger by the handle.
   */
  function dragToMove(card: Placed, grip: HTMLElement): void {
    let drag: { pointer: number; dx: number; dy: number; slot: HTMLElement; target: string; from: GroupLayout; scroll: number } | undefined;
    const element = card.element;
    on(element, "pointerdown", (event) => {
      if (drag !== undefined || event.button !== 0) return;
      const target = event.target as Element;
      if (target.closest(".apb-arrange-corner") !== null) return;
      if (target.closest(".apb-arrange button") !== null && !grip.contains(target)) return;
      if (event.pointerType === "touch" && !grip.contains(target)) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const slot = el("div", "apb-drop-slot");
      slot.setAttribute("aria-hidden", "true");
      drag = { pointer: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top, slot, target: "", from: view.saved(), scroll: 0 };
      element.setPointerCapture(event.pointerId);
      // Lifted out of the grid: fixed where it is, at the size it had, until it is dropped.
      element.style.setProperty("--apb-drag-width", `${box.width}px`);
      element.style.setProperty("--apb-drag-height", `${box.height}px`);
      follow(event.clientX, event.clientY);
      element.setAttribute("data-dragging", "");
      view.stand(card.id, slot);
    });
    const follow = (x: number, y: number): void => {
      if (drag === undefined) return;
      element.style.setProperty("--apb-drag-x", `${x - drag.dx}px`);
      element.style.setProperty("--apb-drag-y", `${y - drag.dy}px`);
    };
    on(element, "pointermove", (event) => {
      if (drag === undefined || event.pointerId !== drag.pointer) return;
      follow(event.clientX, event.clientY);
      edgeScroll(event.clientY);
      const rootNode = element.getRootNode() as Document | ShadowRoot;
      const under = rootNode.elementsFromPoint(event.clientX, event.clientY).find((node) => node !== element && !element.contains(node) && node.parentElement === view.element && node.classList.contains("apb-card"));
      if (under === undefined) return;
      const other = view.declared().find((entry) => entry.element === under);
      if (other === undefined) return;
      const box = under.getBoundingClientRect();
      const after = view.current === 1 ? event.clientY > box.top + box.height / 2 : event.clientX > box.left + box.width / 2;
      const target = `${other.id}|${after}`;
      // Only a new place moves the placeholder: the grid repacks under the pointer, and would otherwise swing back and forth.
      if (target === drag.target) return;
      drag.target = target;
      view.move(card.id, other.id, after);
    });
    const drop = (restore: boolean): void => {
      if (drag === undefined) return;
      const { from, scroll } = drag;
      cancelAnimationFrame(scroll);
      drag = undefined;
      element.removeAttribute("data-dragging");
      for (const name of ["--apb-drag-x", "--apb-drag-y", "--apb-drag-width", "--apb-drag-height"]) element.style.removeProperty(name);
      view.unstand(card.id);
      if (restore) view.place(view.declared(), [from]);
      refreshAll();
      announce(card);
    };
    on(element, "pointerup", () => drop(false));
    on(element, "pointercancel", () => drop(true));
    on(element, "keydown", (event) => {
      if (event.key === "Escape" && drag !== undefined) {
        event.preventDefault();
        drop(true);
      }
    });
    /** Near the top or bottom of the window, the page scrolls, so a card can go anywhere on a long tab. */
    const edgeScroll = (y: number): void => {
      if (drag === undefined) return;
      cancelAnimationFrame(drag.scroll);
      const speed = y < SCROLL_EDGE ? -12 : y > window.innerHeight - SCROLL_EDGE ? 12 : 0;
      if (speed === 0) return;
      const tick = (): void => {
        if (drag === undefined) return;
        window.scrollBy(0, speed);
        drag.scroll = requestAnimationFrame(tick);
      };
      drag.scroll = requestAnimationFrame(tick);
    };
  }

  /** Dragging the corner: the card grows and shrinks in whole cells, and the others make room. */
  function dragToResize(card: Placed, corner: HTMLElement): void {
    let start: { x: number; y: number; size: CardSize; shown: string } | undefined;
    on(corner, "pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      corner.setPointerCapture(event.pointerId);
      start = { x: event.clientX, y: event.clientY, size: view.sizeOf(card.element) ?? card.sizing.pref, shown: "" };
      card.element.setAttribute("data-resizing", "");
    });
    on(corner, "pointermove", (event) => {
      if (start === undefined) return;
      const cells = view.cells(event.clientX - start.x, event.clientY - start.y);
      const next = { w: start.size.w + cells.columns, h: start.size.h + cells.rows };
      // Packing again only when the size in cells changed, not on every pixel.
      const key = `${next.w}×${next.h}`;
      if (key === start.shown) return;
      start.shown = key;
      view.resize(card.element, next);
      refreshAll();
    });
    const end = (): void => {
      if (start === undefined) return;
      start = undefined;
      card.element.removeAttribute("data-resizing");
      announce(card);
    };
    on(corner, "pointerup", end);
    on(corner, "pointercancel", end);
  }

  function stop(restore: boolean): void {
    if (!root.hasAttribute("data-arranging")) return;
    root.removeAttribute("data-arranging");
    listening.abort();
    for (const { card, tool, corner } of decorated) {
      tool.remove();
      corner.remove();
      const body = card.element.querySelector<HTMLElement>(".apb-card-body");
      if (body !== null) body.inert = false;
      card.element.querySelector<HTMLElement>(".apb-card-tools")?.removeAttribute("inert");
    }
    if (restore) {
      if (wasAutomatic) view.reset();
      else view.place(view.declared(), [before]);
    }
    // A word on what happened stays a moment where the bar was, for the live region to be heard.
    const note = said.textContent;
    bar.remove();
    host.arrangingStopped();
    if (note !== null && note !== "" && !restore) {
      const left = el("p", "apb-sr", note);
      left.setAttribute("role", "status");
      host.mainRegion().append(left);
      setTimeout(() => left.remove(), 4000);
    }
  }

  return { stop };
}
