/**
 * The panel's pure pieces: how a declaration's conditions and an operator's reason are checked, and
 * how values, actions and scheduled changes are described to a page. Nothing here holds state; the
 * panel in core.ts calls these with what it holds.
 */
import type { PanelAction } from "../actions.js";
import { AdminPanelConfigError, type Refusal } from "../errors.js";
import { refusal } from "../i18n/refuse.js";
import type { ActionSchema, JsonValue, ScheduledChange, ValueSchema, WireValue } from "../types.js";
import type { PanelValue } from "../values/handle.js";
import type { ResolvedField } from "../values/input.js";
import { toJson } from "../values/kinds.js";
import type { ScheduleEntry } from "./schedule.js";

/** Longest reason an operator may give: a sentence or three, not a document. */
export const MAX_REASON_LENGTH = 500;

export function checkReasonOption(label: string, reason: unknown): void {
  if (reason !== undefined && reason !== "required" && reason !== "optional") throw new AdminPanelConfigError(`"${label}" has reason ${JSON.stringify(reason)}; it is "required" or "optional"`);
}

/** An operator's reason, trimmed; refused when missing where required, or too long. */
export function checkReason(raw: string | undefined, required: boolean, label: string): { ok: true; reason: string | undefined } | { ok: false; reason: "invalid"; message: string; refusal: Refusal } {
  const reason = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
  if (reason === undefined && required) return { ok: false, reason: "invalid", ...refusal("refuseReasonRequired", { label }) };
  if (reason !== undefined && reason.length > MAX_REASON_LENGTH) return { ok: false, reason: "invalid", ...refusal("refuseReasonLong", { max: MAX_REASON_LENGTH }) };
  return { ok: true, reason };
}

/** A schedule entry as the page sees it. */
export function scheduledShape(entry: ScheduleEntry, sensitive: boolean): ScheduledChange {
  const shape: ScheduledChange = { id: entry.id, at: entry.at, by: entry.by };
  if (!sensitive) shape.to = toJson(entry.to);
  if (entry.reason !== undefined) shape.reason = entry.reason;
  if (entry.repeat !== undefined) shape.repeat = entry.repeat.weekday === undefined ? { every: entry.repeat.every, at: entry.repeat.at, timeZone: entry.repeat.timeZone } : { every: entry.repeat.every, at: entry.repeat.at, timeZone: entry.repeat.timeZone, weekday: entry.repeat.weekday };
  if (entry.revertAfterMs !== undefined) shape.revertAfterMs = entry.revertAfterMs;
  return shape;
}

export function checkCondition(label: string, name: string, condition: unknown): void {
  if (condition !== undefined && typeof condition !== "function") throw new AdminPanelConfigError(`"${label}" has a ${name} that is not a function`);
}

/** Evaluates a declaration's conditions. A condition that throws hides nothing and disables nothing: a bug must not lock an operator out. */
export function conditionOf(visibleWhen: (() => boolean) | undefined, disabledWhen: (() => string | false | undefined) | undefined): { hidden?: boolean; disabled?: string } {
  const out: { hidden?: boolean; disabled?: string } = {};
  if (visibleWhen !== undefined) {
    try {
      if (visibleWhen() === false) out.hidden = true;
    } catch {
      // Shown.
    }
  }
  if (disabledWhen !== undefined) {
    try {
      const reason = disabledWhen();
      if (typeof reason === "string" && reason !== "") out.disabled = reason;
    } catch {
      // Enabled.
    }
  }
  return out;
}

export function valueSchema(value: PanelValue<unknown>, writable: boolean): ValueSchema {
  const d = value.definition;
  const schema: ValueSchema = {
    type: "value",
    id: d.id,
    label: d.label,
    kind: d.kind,
    editable: d.editable,
    writable,
    approval: d.approval,
    timed: d.timed,
    live: value.live,
    sensitive: d.sensitive,
    confirm: d.confirm,
    constraints: d.constraints,
  };
  if (d.description !== undefined) schema.description = d.description;
  if (d.unit !== undefined) schema.unit = d.unit;
  if (d.format !== undefined) schema.format = d.format;
  if (d.decimals !== undefined) schema.decimals = d.decimals;
  if (value.chartId !== undefined) schema.chart = value.chartId;
  if (d.span !== undefined) schema.span = d.span;
  if (d.size !== undefined) schema.size = d.size;
  if (d.reasonRequired) schema.reasonRequired = true;
  return schema;
}

export function actionSchema(action: PanelAction, runnable: boolean, input: readonly ResolvedField[] | undefined): ActionSchema {
  const d = action.definition;
  const schema: ActionSchema = { type: "action", id: d.id, label: d.label, confirm: d.confirm, destructive: d.destructive, runnable };
  if (d.description !== undefined) schema.description = d.description;
  if (input !== undefined) schema.input = input.map((field) => field.schema);
  if (d.span !== undefined) schema.span = d.span;
  if (d.size !== undefined) schema.size = d.size;
  if (d.typeToConfirm) schema.typeToConfirm = true;
  if (d.approval) schema.approval = true;
  if (d.reasonRequired) schema.reasonRequired = true;
  return schema;
}


/** What changes on the wire without the value changing: conditions, a pending revert, what is scheduled, recent changes. */
export function decorateWire(value: PanelValue<unknown>, out: WireValue, known: { revert: ScheduleEntry | undefined; scheduled: readonly ScheduleEntry[]; recent: ReadonlyArray<{ at: number; value: JsonValue; by?: string }> | undefined }): WireValue {
  const condition = conditionOf(value.definition.visibleWhen, value.definition.disabledWhen);
  if (condition.hidden === true) out.hidden = true;
  if (condition.disabled !== undefined) out.disabled = condition.disabled;
  if (known.revert !== undefined) {
    out.revertAt = known.revert.at;
    if (!value.definition.sensitive) out.revertTo = toJson(known.revert.to);
  }
  if (known.scheduled.length > 0) out.scheduled = known.scheduled.map((entry) => scheduledShape(entry, value.definition.sensitive));
  if (known.recent !== undefined && known.recent.length > 0) out.recent = known.recent.slice();
  return out;
}
