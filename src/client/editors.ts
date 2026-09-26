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
import type { JsonValue, RepeatRuleShape, ValueSchema, WireValue } from "../types.js";
import { busy, el, uid } from "./dom.js";
import { formatDuration, formatValue } from "./format.js";
import { explain } from "./explain.js";
import { localeSpec, type Translate } from "./i18n.js";
import { reasonField, whenField } from "./when.js";

export interface EditorContext {
  /** Applies the value, now or as `change` says. Resolves to a note to show, if any. */
  submit(value: unknown, change: ChangeRequest): Promise<string | undefined>;
  t: Translate;
  /** Offers a time and a repeat. Off for snapshots and read-only views. */
  schedulable?: boolean | undefined;
}

/** What the page sends with a change: for a while, at a time, by a rule, and why. */
export interface ChangeRequest {
  revertAfterMs?: number | undefined;
  at?: number | undefined;
  repeat?: RepeatRuleShape | undefined;
  reason?: string | undefined;
}

/** How long a timed change may last, as offered on the page. */
const DURATIONS = [300_000, 900_000, 3_600_000, 14_400_000, 86_400_000];

/** A select of how long a change should last; absent when the value does not take timed changes. */
function durationSelect(schema: ValueSchema, t: Translate): HTMLSelectElement | undefined {
  if (!schema.timed) return undefined;
  const select = el("select", "apb-select apb-duration");
  select.setAttribute("aria-label", `${schema.label}: ${t("forAWhile")}`);
  const forever = el("option", null, t("forever"));
  forever.value = "";
  select.append(forever);
  for (const ms of DURATIONS) {
    const option = el("option", null, `${t("forAWhile")} ${formatDuration(ms, t.locale)}`);
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
  const later = context.schedulable === true ? whenField(schema.label, t) : undefined;
  const why = reasonField(schema.label, schema.reasonRequired === true, t);
  const blocked = el("p", "apb-hint apb-disabled-reason");
  blocked.hidden = true;
  let dirty = false;
  let current: JsonValue = null;
  let armedUntil = 0;

  const field = buildField(schema, labelId, t, () => {
    dirty = true;
    disarm();
    markDirty();
  });
  field.control.setAttribute("aria-describedby", error.id);
  // A reason that must be given is part of the change, so it comes before the button, not after it;
  // an optional one is a fold under it. What the panel answers — a refusal, or why the button cannot
  // be pressed — reads directly under the button it belongs to.
  const asked = schema.reasonRequired === true ? [why.element] : [];
  const folded = schema.reasonRequired === true ? [] : [why.element];
  form.append(...field.nodes, ...asked, ...(duration === undefined ? [] : [duration]), button, blocked, error, ...folded, ...(later === undefined ? [] : [later.element]), note);
  if (schema.sensitive) form.append(el("p", "apb-hint", t("neverShown")));

  /** Marks the form while it holds something other than the panel's value, so an edit not yet applied shows. */
  function markDirty(): void {
    let differs = true;
    if (schema.sensitive) differs = (field.control as HTMLInputElement).value !== "";
    else {
      try {
        differs = JSON.stringify(field.read()) !== JSON.stringify(current);
      } catch {
        // Not a value yet (half a number, invalid JSON): certainly not the panel's.
      }
    }
    form.toggleAttribute("data-dirty", differs);
  }

  /** Puts the panel's value back into the field, dropping what was typed. */
  function abandon(): void {
    dirty = false;
    field.write(schema.sensitive ? null : current);
    form.removeAttribute("data-dirty");
    error.textContent = "";
    disarm();
  }

  form.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !form.hasAttribute("data-dirty") || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) return;
    event.preventDefault();
    event.stopPropagation();
    abandon();
  });

  function disarm(): void {
    armedUntil = 0;
    button.dataset.armed = "false";
    button.textContent = t("apply");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    let candidate: unknown;
    let when: { at?: number | undefined; repeat?: RepeatRuleShape | undefined } = {};
    const reason = why.read();
    try {
      candidate = field.read();
      when = later?.read() ?? {};
      if (schema.reasonRequired === true && reason === undefined) throw new Error(t("refuseReasonRequired", { label: schema.label }));
    } catch (problem) {
      error.textContent = problem instanceof Error ? problem.message : String(problem);
      return;
    }
    if (schema.confirm && Date.now() > armedUntil) {
      armedUntil = Date.now() + ARM_MS;
      button.dataset.armed = "true";
      button.textContent = schema.sensitive ? t("replaceConfirm") : t("applyConfirm", { value: short(formatValue(candidate as JsonValue, { ...schema, ...localeSpec(t) })) });
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
    busy(button, context.submit(candidate, { revertAfterMs: revert, at: when.at, repeat: when.repeat, reason }))
      .then((message) => {
        dirty = false;
        form.removeAttribute("data-dirty");
        if (message !== undefined) note.textContent = message;
        if (schema.sensitive) field.write(null);
        later?.clear();
        why.clear();
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
      form.removeAttribute("data-dirty");
    },
    disable(reason) {
      disableAll(form, reason !== undefined);
      blocked.hidden = reason === undefined;
      blocked.textContent = reason === undefined ? "" : t("disabledBecause", { reason });
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

function buildField(schema: ValueSchema, labelId: string, t: Translate, onInput: () => void): Field {
  const c = schema.constraints;
  if (schema.kind === "enum") {
    const select = el("select", "apb-select");
    select.setAttribute("aria-labelledby", labelId);
    (c.options ?? []).forEach((option, index) => {
      const node = el("option", null, formatValue(option, { ...schema, ...localeSpec(t) }));
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
      // The ends of the slider, for the eye; the slider itself tells assistive technology.
      const scale = el("div", "apb-range-scale");
      scale.setAttribute("aria-hidden", "true");
      scale.append(el("span", null, formatValue(c.min, { ...schema, ...localeSpec(t) })), el("span", null, formatValue(c.max, { ...schema, ...localeSpec(t) })));
      nodes.push(range, scale);
    }
    return {
      nodes,
      control: input,
      read: () => {
        const text = input.value.trim();
        const number = Number(text);
        if (text === "" || !Number.isFinite(number)) throw new Error(t("enterNumber"));
        if (c.min !== undefined && number < c.min) throw new Error(t("smallestAccepted", { min: c.min }));
        if (c.max !== undefined && number > c.max) throw new Error(t("largestAccepted", { max: c.max }));
        if (c.integer === true && !Number.isInteger(number)) throw new Error(t("enterWhole"));
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
        if (schema.kind === "string") return checkText(area.value, schema, t);
        try {
          return JSON.parse(area.value) as unknown;
        } catch {
          throw new Error(t("invalidJson"));
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
    input.placeholder = t("enterNewValue");
  }
  if (c.maxLength !== undefined) input.maxLength = c.maxLength;
  input.setAttribute("aria-labelledby", labelId);
  input.addEventListener("input", onInput);
  return {
    nodes: [input],
    control: input,
    read: () => checkText(input.value, schema, t),
    write: (value) => {
      input.value = typeof value === "string" ? value : "";
    },
  };
}

function checkText(text: string, schema: ValueSchema, t: Translate): string {
  const pattern = schema.constraints.pattern;
  if (pattern !== undefined && !new RegExp(pattern.source, pattern.flags).test(text)) throw new Error(t("mustMatch", { pattern: `/${pattern.source}/${pattern.flags}` }));
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
  const why = reasonField(schema.label, schema.reasonRequired === true, t);
  const later = context.schedulable === true ? whenField(schema.label, t) : undefined;
  const blockedNote = el("p", "apb-hint apb-disabled-reason");
  blockedNote.hidden = true;
  wrap.append(button, ...(duration === undefined ? [] : [duration]), hint, why.element, ...(later === undefined ? [] : [later.element]), blockedNote, error);
  let current = false;
  let armedUntil = 0;
  button.addEventListener("click", () => {
    const next = !current;
    if (schema.confirm && Date.now() > armedUntil) {
      armedUntil = Date.now() + ARM_MS;
      hint.textContent = t(next ? "clickAgainOn" : "clickAgainOff");
      setTimeout(() => {
        if (Date.now() >= armedUntil) hint.textContent = "";
      }, ARM_MS + 50);
      return;
    }
    armedUntil = 0;
    hint.textContent = "";
    error.textContent = "";
    const reason = why.read();
    let when: { at?: number | undefined; repeat?: RepeatRuleShape | undefined } = {};
    try {
      when = later?.read() ?? {};
      if (schema.reasonRequired === true && reason === undefined) throw new Error(t("refuseReasonRequired", { label: schema.label }));
    } catch (problem) {
      error.textContent = problem instanceof Error ? problem.message : String(problem);
      return;
    }
    button.disabled = true;
    busy(button, context.submit(next, { revertAfterMs: duration === undefined || duration.value === "" ? undefined : Number(duration.value), at: when.at, repeat: when.repeat, reason }))
      .then((message) => {
        why.clear();
        later?.clear();
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
      blockedNote.hidden = !blocked;
      blockedNote.textContent = reason === undefined ? "" : t("disabledBecause", { reason });
    },
  };
}

function short(text: string): string {
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
