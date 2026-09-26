/**
 * Settings as a file: every modifiable value a scope shows, and what importing a file would change,
 * value by value, with the reason any would be refused. Importing itself is the panel's, since it
 * is a change like any other; see `importSettings` in core.ts.
 */
import { ValueError } from "../errors.js";
import { refusal } from "../i18n/refuse.js";
import type { JsonValue, SettingDiff } from "../types.js";
import type { PanelValue } from "../values/handle.js";
import { toJson } from "../values/kinds.js";
import { message } from "./checks.js";
import { canEdit, type PanelScope, visible } from "./scope.js";

/** Sensitive values are left out: an export is a file people pass around. */
export function exportSettings(values: Iterable<PanelValue<unknown>>, scope: PanelScope, read: (value: PanelValue<unknown>) => unknown): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const value of values) {
    if (!value.editable || value.definition.sensitive || !visible(scope, value.group)) continue;
    out[value.id] = toJson(read(value));
  }
  return out;
}

/** Changes nothing. An id that is not a setting this scope may import is listed in `unknown`. */
export function diffSettings(values: ReadonlyMap<string, PanelValue<unknown>>, settings: unknown, scope: PanelScope, read: (value: PanelValue<unknown>) => unknown): { diff: SettingDiff[]; unknown: string[] } {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return { diff: [], unknown: [] };
  const diff: SettingDiff[] = [];
  const unknown: string[] = [];
  for (const [id, to] of Object.entries(settings as Record<string, unknown>)) {
    const value = values.get(id);
    if (value === undefined || !value.editable || value.definition.sensitive || !visible(scope, value.group)) {
      unknown.push(id);
      continue;
    }
    const from = toJson(read(value));
    const encoded = toJson(to);
    if (JSON.stringify(from) === JSON.stringify(encoded)) continue;
    const line: SettingDiff = { id, label: value.label, from, to: encoded };
    // Refused the way everything else is refused: the English sentence, and the key a page says it in
    // the viewer's language with.
    const refuse = (key: "refuseImportNotEditable" | "refuseImportApproval", params: Record<string, string | number>): void => {
      const made = refusal(key, params);
      line.error = made.message;
      line.errorKey = key;
      line.errorParams = params;
    };
    if (!canEdit(scope, value.group)) refuse("refuseImportNotEditable", { label: value.label });
    else if (value.definition.approval) refuse("refuseImportApproval", { label: value.label });
    else {
      try {
        value.check(to);
      } catch (error) {
        line.error = message(error);
        if (error instanceof ValueError) {
          line.errorKey = error.refusal.key;
          line.errorParams = error.refusal.params;
        }
      }
    }
    diff.push(line);
  }
  return { diff, unknown };
}
