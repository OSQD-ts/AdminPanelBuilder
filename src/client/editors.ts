/**
 * The controls that change a modifiable value.
 *
 * Built only when the listener grants editing; otherwise the value is shown and the page says
 * why it cannot be changed here, rather than offering a control that will be refused.
 *
 * Three rules keep an operator from being surprised:
 *
 * - What somebody is typing is never overwritten by a poll. The value above the editor keeps
 *   moving; the input keeps what was typed until it is applied or abandoned.
 * - A value declared `confirm` waits for a second click on the same button, which says what it
 *   is about to do, rather than opening a dialog — a confirmation you can dismiss without
 *   reading is a click with extra steps.
 * - The page checks what it can before sending, and the server checks everything again. A
 *   refusal is shown in place with the server's own sentence.
 */
import type { JsonValue, ValueSchema, WireValue } from "../types.js";
import { el, uid } from "./dom.js";
import { formatValue } from "./format.js";
import { explain } from "./explain.js";
import type { Translate } from "./i18n.js";

export interface EditorContext {
  /**
   * Applies the value: for a while when `revertAfterMs` is given, at a later time when `at` is.
   * Resolves to a note to show, if any.
   */
  submit(value: unknown, revertAfterMs?: number, at?: number): Promise<string | undefined>;
  t: Translate;
  /** Offers a time to apply the change at. Off for snapshots and read-only views. */
  schedulable?: boolean | undefined;
}

/**
 * A folded "Later" with a local date and time. Folded because most changes are for now, and a
 * second always-visible input on every card would say otherwise.
 */
function scheduleField(schema: ValueSchema, t: Translate): { element: HTMLElement; read(): number | undefined; clear(): void } {
  const details = el("details", "apb-when");
  details.append(el("summary", null, t("schedule")));
  const id = uid("at");
  const label = el("label", "apb-input-label", t("scheduleAt"));
  label.htmlFor = id;
  const input = el("input", "apb-input apb-at");
  input.type = "datetime-local";
  input.id = id;
  input.setAttribute("aria-label", `${schema.label}: ${t("scheduleAt")}`);
  const hint = el("p", "apb-hint", t("scheduleHint"));
  details.append(label, input, hint);
  return {
    element: details,
    read: () => {
      if (input.value === "") return undefined;
      const at = new Date(input.value).getTime();
      if (!Number.isFinite(at)) throw new Error("Enter a date and time.");
      return at;
    },
    clear: () => {
      input.value = "";
      details.open = false;
    },
  };
}

/** How long a timed change may last, as offered on the page. */
const DURATIONS: Array<[string, number]> = [
  ["5 min", 300_000],
  ["15 min", 900_000],
  ["1 h", 3_600_000],
  ["4 h", 14_400_000],
  ["1 day", 86_400_000],
];

/** A select of how long a change should last; absent when the value does not take timed changes. */
function durationSelect(schema: ValueSchema, t: Translate): HTMLSelectElement | undefined {
  if (!schema.timed) return undefined;
  const select = el("select", "apb-select apb-duration");
  select.setAttribute("aria-label", `${schema.label}: ${t("forAWhile")}`);
  const forever = el("option", null, t("forever"));
  forever.value = "";
  select.append(forever);
  for (const [label, ms] of DURATIONS) {
    const option = el("option", null, `${t("forAWhile")} ${label}`);
    option.value = String(ms);
    select.append(option);
  }
  return select;
}

export interface Editor {
  readonly element: HTMLElement;
  update(wire: WireValue | undefined): void;
  /** Disables every control, saying why beside them; `undefined` enables them again. */
  disable(reason: string | undefined): void;
}

/** How long an armed confirmation waits for its second click. */
const ARM_MS = 5000;

export function buildEditor(schema: ValueSchema, labelId: string, context: EditorContext): Editor {
  if (schema.kind === "boolean" && !schema.sensitive) return buildSwitch(schema, labelId, context);
  const form = el("form", "apb-editor");
  form.noValidate = true;
  const error = el("p", "apb-error");
  error.setAttribute("role", "alert");
  error.id = uid("error");
  const t = context.t;
  const button = el("button", "apb-button", t("apply"));
  button.type = "submit";
  const note = el("p", "apb-hint");
  note.setAttribute("aria-live", "polite");
  const duration = durationSelect(schema, t);
  const later = context.schedulable === true ? scheduleField(schema, t) : undefined;
  const why = el("p", "apb-hint apb-disabled-reason");
  why.hidden = true;
  let dirty = false;
  let current: JsonValue = null;
  let armedUntil = 0;

  const field = buildField(schema, labelId, () => {
    dirty = true;
    disarm();
  });
  field.control.setAttribute("aria-describedby", error.id);
  form.append(...field.nodes, ...(duration === undefined ? [] : [duration]), button, ...(later === undefined ? [] : [later.element]), why, error, note);
  if (schema.sensitive) form.append(el("p", "apb-hint", "This value is never shown. Entering a new one replaces it."));

  function disarm(): void {
    armedUntil = 0;
    button.dataset.armed = "false";
    button.textContent = t("apply");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    let candidate: unknown;
    let at: number | undefined;
    try {
      candidate = field.read();
      at = later?.read();
    } catch (problem) {
      error.textContent = problem instanceof Error ? problem.message : String(problem);
      return;
    }
    if (schema.confirm && Date.now() > armedUntil) {
      armedUntil = Date.now() + ARM_MS;
      button.dataset.armed = "true";
      button.textContent = schema.sensitive ? t("replaceConfirm") : t("applyConfirm", { value: short(formatValue(candidate as JsonValue, schema)) });
      setTimeout(() => {
        if (Date.now() >= armedUntil) disarm();
      }, ARM_MS + 50);
      return;
    }
    disarm();
    error.textContent = "";
    button.disabled = true;
    note.textContent = "";
    const revert = duration === undefined || duration.value === "" ? undefined : Number(duration.value);
    context
      .submit(candidate, revert, at)
      .then((message) => {
        dirty = false;
        if (message !== undefined) note.textContent = message;
        if (schema.sensitive) field.write(null);
        later?.clear();
      })
      .catch((problem: unknown) => {
        error.textContent = explain(problem, t);
      })
      .finally(() => {
        button.disabled = false;
      });
  });

  return {
    element: form,
    update(wire) {
      if (wire === undefined || schema.sensitive) return;
      current = wire.value;
      if (dirty || form.contains(form.ownerDocument.activeElement) || isFocusedInShadow(form)) return;
      field.write(current);
    },
    disable(reason) {
      disableAll(form, reason !== undefined);
      why.hidden = reason === undefined;
      why.textContent = reason === undefined ? "" : t("disabledBecause", { reason });
    },
  };
}

/** Sets `disabled` on every control inside, remembering nothing: the state comes from the server on every update. */
function disableAll(root: HTMLElement, disabled: boolean): void {
  for (const control of Array.from(root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("input, select, textarea, button"))) control.disabled = disabled;
}

function isFocusedInShadow(node: Element): boolean {
  const root = node.getRootNode();
  return root instanceof ShadowRoot && root.activeElement !== null && node.contains(root.activeElement);
}

interface Field {
  nodes: HTMLElement[];
  control: HTMLElement;
  read(): unknown;
  write(value: JsonValue): void;
}

function buildField(schema: ValueSchema, labelId: string, onInput: () => void): Field {
  const c = schema.constraints;
  if (schema.kind === "enum") {
    const select = el("select", "apb-select");
    select.setAttribute("aria-labelledby", labelId);
    (c.options ?? []).forEach((option, index) => {
      const node = el("option", null, formatValue(option, schema));
      node.value = String(index);
      select.append(node);
    });
    select.addEventListener("change", onInput);
    return {
      nodes: [select],
      control: select,
      read: () => (c.options ?? [])[Number(select.value)] ?? null,
      write: (value) => {
        const index = (c.options ?? []).findIndex((option) => JSON.stringify(option) === JSON.stringify(value));
        if (index !== -1) select.value = String(index);
      },
    };
  }
  if (schema.kind === "number") {
    const input = el("input", "apb-input");
    input.type = schema.sensitive ? "password" : "number";
    input.inputMode = "decimal";
    if (c.min !== undefined) input.min = String(c.min);
    if (c.max !== undefined) input.max = String(c.max);
    input.step = c.step !== undefined ? String(c.step) : c.integer === true ? "1" : "any";
    input.setAttribute("aria-labelledby", labelId);
    input.addEventListener("input", onInput);
    const nodes: HTMLElement[] = [input];
    let range: HTMLInputElement | undefined;
    if (c.min !== undefined && c.max !== undefined && !schema.sensitive) {
      range = el("input", "apb-range");
      range.type = "range";
      range.min = String(c.min);
      range.max = String(c.max);
      range.step = input.step;
      range.setAttribute("aria-labelledby", labelId);
      range.addEventListener("input", () => {
        input.value = (range as HTMLInputElement).value;
        onInput();
      });
      input.addEventListener("input", () => {
        if (range !== undefined) range.value = input.value;
      });
      nodes.push(range);
    }
    return {
      nodes,
      control: input,
      read: () => {
        const text = input.value.trim();
        const number = Number(text);
        if (text === "" || !Number.isFinite(number)) throw new Error("Enter a number.");
        if (c.min !== undefined && number < c.min) throw new Error(`The smallest accepted value is ${c.min}.`);
        if (c.max !== undefined && number > c.max) throw new Error(`The largest accepted value is ${c.max}.`);
        if (c.integer === true && !Number.isInteger(number)) throw new Error("Enter a whole number.");
        return number;
      },
      write: (value) => {
        input.value = typeof value === "number" ? String(value) : "";
        if (range !== undefined) range.value = input.value;
      },
    };
  }
  if (schema.kind === "json" || (schema.kind === "string" && c.multiline === true)) {
    const area = el("textarea", "apb-textarea");
    area.setAttribute("aria-labelledby", labelId);
    area.spellcheck = schema.kind !== "json";
    if (c.maxLength !== undefined) area.maxLength = c.maxLength;
    area.addEventListener("input", onInput);
    return {
      nodes: [area],
      control: area,
      read: () => {
        if (schema.kind === "string") return checkText(area.value, schema);
        try {
          return JSON.parse(area.value) as unknown;
        } catch {
          throw new Error("That is not valid JSON.");
        }
      },
      write: (value) => {
        area.value = schema.kind === "string" ? (typeof value === "string" ? value : "") : JSON.stringify(value, null, 2);
      },
    };
  }
  const input = el("input", "apb-input");
  input.type = schema.sensitive ? "password" : "text";
  if (schema.sensitive) {
    input.autocomplete = "new-password";
    input.placeholder = "Enter a new value";
  }
  if (c.maxLength !== undefined) input.maxLength = c.maxLength;
  input.setAttribute("aria-labelledby", labelId);
  input.addEventListener("input", onInput);
  return {
    nodes: [input],
    control: input,
    read: () => checkText(input.value, schema),
    write: (value) => {
      input.value = typeof value === "string" ? value : "";
    },
  };
}

function checkText(text: string, schema: ValueSchema): string {
  const pattern = schema.constraints.pattern;
  if (pattern !== undefined && !new RegExp(pattern.source, pattern.flags).test(text)) throw new Error(`The value must match /${pattern.source}/${pattern.flags}.`);
  return text;
}

/** An on/off value is a switch that applies on click, with the same second-click confirmation when declared. */
function buildSwitch(schema: ValueSchema, labelId: string, context: EditorContext): Editor {
  const t = context.t;
  const wrap = el("div", "apb-editor");
  const button = el("button", "apb-switch");
  button.type = "button";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-labelledby", labelId);
  button.setAttribute("aria-checked", "false");
  const hint = el("span", "apb-hint");
  hint.setAttribute("aria-live", "polite");
  const error = el("p", "apb-error");
  error.setAttribute("role", "alert");
  const duration = durationSelect(schema, t);
  const why = el("p", "apb-hint apb-disabled-reason");
  why.hidden = true;
  wrap.append(button, ...(duration === undefined ? [] : [duration]), hint, why, error);
  let current = false;
  let armedUntil = 0;
  button.addEventListener("click", () => {
    const next = !current;
    if (schema.confirm && Date.now() > armedUntil) {
      armedUntil = Date.now() + ARM_MS;
      hint.textContent = `Click again to turn it ${next ? "on" : "off"}.`;
      setTimeout(() => {
        if (Date.now() >= armedUntil) hint.textContent = "";
      }, ARM_MS + 50);
      return;
    }
    armedUntil = 0;
    hint.textContent = "";
    error.textContent = "";
    button.disabled = true;
    context
      .submit(next, duration === undefined || duration.value === "" ? undefined : Number(duration.value))
      .then((message) => {
        if (message === undefined) {
          current = next;
          button.setAttribute("aria-checked", String(next));
        } else hint.textContent = message;
      })
      .catch((problem: unknown) => {
        error.textContent = explain(problem, t);
      })
      .finally(() => {
        button.disabled = blocked;
      });
  });
  let blocked = false;
  return {
    element: wrap,
    update(wire) {
      if (wire === undefined || typeof wire.value !== "boolean") return;
      current = wire.value;
      button.setAttribute("aria-checked", String(current));
    },
    disable(reason) {
      blocked = reason !== undefined;
      disableAll(wrap, blocked);
      why.hidden = !blocked;
      why.textContent = reason === undefined ? "" : t("disabledBecause", { reason });
    },
  };
}

function short(text: string): string {
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
