/**
 * Keyboard shortcuts and the "go to" list.
 *
 *   /            search the panel
 *   Ctrl+K, ⌘K   the list of every group, value and action; type to narrow, Enter to go
 *   g then 1–9   the nth group
 *   ?            this list of shortcuts
 *
 * A shortcut never fires while somebody is typing into a field, and none takes a key a screen
 * reader or the browser needs alone: every one is either a printable key outside a field, or a
 * chord. The list is a native `<dialog>`: focus moves into it, Escape closes it, and focus goes back
 * where it was.
 */
import { clear, el, uid } from "./dom.js";
import type { Translate } from "./i18n.js";

export interface Destination {
  /** What the list says: the item's label. */
  label: string;
  /** "Group", "Value", "Action". */
  kind: string;
  /** Where it lives, for items: the group's title. */
  where?: string | undefined;
  go(): void;
}

export interface Shortcuts {
  /** The dialogs, to be placed inside the panel so they are themed with it. */
  readonly elements: HTMLElement[];
  /** Stops listening. */
  destroy(): void;
}

export function installShortcuts(options: {
  container: HTMLElement;
  t: Translate;
  focusSearch(): void;
  destinations(): Destination[];
  groups(): Array<() => void>;
}): Shortcuts {
  const { t } = options;
  const palette = buildPalette(t, options.destinations);
  const help = buildHelp(t);
  let awaitingGroup = 0;

  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const target = event.composedPath()[0] as HTMLElement | undefined;
    // Only a page that holds this panel: an embedded panel answers keys pressed inside it, not the host's.
    if (!options.container.isConnected) return;
    const typing = target !== undefined && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      palette.open();
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (awaitingGroup > Date.now() && /^[1-9]$/.test(event.key)) {
      awaitingGroup = 0;
      options.groups()[Number(event.key) - 1]?.();
      event.preventDefault();
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      options.focusSearch();
    } else if (event.key === "?") {
      event.preventDefault();
      help.open();
    } else if (event.key === "g") awaitingGroup = Date.now() + 1500;
  };
  const scope = options.container.ownerDocument;
  scope.addEventListener("keydown", onKey);
  return {
    elements: [palette.element, help.element],
    destroy: () => scope.removeEventListener("keydown", onKey),
  };
}

/** A modal dialog themed with the panel: a heading, a close button, a body; focus goes back where it came from on close. */
export function dialog(title: string, t: Translate): { element: HTMLDialogElement; body: HTMLElement; open(): void; leave(): void } {
  const element = el("dialog", "apb-dialog");
  const titleId = uid("dialog-title");
  element.setAttribute("aria-labelledby", titleId);
  const head = el("div", "apb-dialog-head");
  const heading = el("h2", "apb-label", title);
  heading.id = titleId;
  const close = el("button", "apb-icon", "×");
  close.type = "button";
  close.setAttribute("aria-label", t("close"));
  close.addEventListener("click", () => element.close());
  head.append(heading, close);
  const body = el("div", "apb-dialog-body");
  element.append(head, body);
  let returnTo: Element | null = null;
  element.addEventListener("close", () => {
    if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
  });
  /** Closes without taking focus back: for a button in the dialog that sends the viewer somewhere else on the page. */
  const leave = (): void => {
    returnTo = null;
    element.close();
  };
  return {
    leave,
    element,
    body,
    open() {
      if (element.open) return;
      returnTo = element.ownerDocument.activeElement;
      element.showModal();
    },
  };
}

function buildPalette(t: Translate, destinations: () => Destination[]): { element: HTMLElement; open(): void } {
  const box = dialog(t("palette"), t);
  const input = el("input", "apb-input apb-palette-input");
  input.type = "search";
  input.setAttribute("aria-label", t("paletteLabel"));
  input.placeholder = t("paletteLabel");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  const list = el("ul", "apb-palette-list");
  list.id = uid("palette");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("palette"));
  input.setAttribute("aria-controls", list.id);
  const count = el("p", "apb-sr");
  count.setAttribute("aria-live", "polite");
  box.body.append(input, list, count);
  let shown: Destination[] = [];
  let active = 0;

  const highlight = (): void => {
    Array.from(list.children).forEach((node, index) => node.setAttribute("aria-selected", String(index === active)));
    const current = list.children[active];
    if (current !== undefined) {
      input.setAttribute("aria-activedescendant", current.id);
      (current as HTMLElement).scrollIntoView?.({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const fill = (): void => {
    const needle = input.value.trim().toLowerCase();
    shown = destinations()
      .filter((entry) => needle === "" || `${entry.label} ${entry.where ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 50);
    active = 0;
    clear(list);
    shown.forEach((entry, index) => {
      const item = el("li", "apb-palette-item");
      item.id = `${list.id}-${index}`;
      item.setAttribute("role", "option");
      item.append(el("span", "apb-badge", entry.kind), document.createTextNode(` ${entry.label}`), ...(entry.where === undefined ? [] : [el("span", "apb-hint", ` · ${entry.where}`)]));
      item.addEventListener("click", () => go(index));
      list.append(item);
    });
    count.textContent = shown.length === 0 ? t("paletteEmpty") : String(shown.length);
    if (shown.length === 0) list.append(el("li", "apb-empty", t("paletteEmpty")));
    highlight();
  };
  const go = (index: number): void => {
    const entry = shown[index];
    if (entry === undefined) return;
    box.element.close();
    entry.go();
  };
  input.addEventListener("input", fill);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") active = Math.min(shown.length - 1, active + 1);
    else if (event.key === "ArrowUp") active = Math.max(0, active - 1);
    else if (event.key === "Enter") {
      event.preventDefault();
      go(active);
      return;
    } else return;
    event.preventDefault();
    highlight();
  });
  return {
    element: box.element,
    open() {
      input.value = "";
      fill();
      box.open();
      input.focus();
    },
  };
}

function buildHelp(t: Translate): { element: HTMLElement; open(): void } {
  const box = dialog(t("shortcuts"), t);
  const list = el("dl", "apb-shortcuts");
  for (const [keys, key] of [
    ["/", "shortcutSearch"],
    ["Ctrl K", "shortcutPalette"],
    ["g 1–9", "shortcutGroup"],
    ["?", "shortcutHelp"],
    ["Esc", "shortcutClose"],
  ] as const) {
    const term = el("dt");
    for (const part of keys.split(" ")) term.append(el("kbd", null, part), document.createTextNode(" "));
    list.append(term, el("dd", null, t(key)));
  }
  box.body.append(list);
  return { element: box.element, open: () => box.open() };
}
