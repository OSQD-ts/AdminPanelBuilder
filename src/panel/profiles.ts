/**
 * Profiles: several modifiable values set in one step, whole or not at all.
 *
 * The registry checks a profile when it is declared — every setting must be one its value accepts,
 * no value may need approval (a profile would be a way around the second operator), none twice — and
 * answers what a scope may see of it and whether it is in force.
 */
import { AdminPanelConfigError } from "../errors.js";
import type { CardSize, ProfileSchema, Span } from "../types.js";
import type { PanelValue } from "../values/handle.js";
import { toJson } from "../values/kinds.js";
import { message, sameJson } from "./checks.js";
import { canEdit, type PanelScope, visible } from "./scope.js";

export interface ProfileEntry {
  id: string;
  label: string;
  description: string | undefined;
  settings: Array<[PanelValue<unknown>, unknown]>;
  confirm: boolean;
  group: string;
  order: number;
  sequence: number;
  span: Span | undefined;
  size: CardSize | undefined;
  approval: boolean;
  reasonRequired: boolean;
}

/** Whether a scope may apply every value a profile sets; a profile is applied whole or not at all. */
export function profileWritable(profile: ProfileEntry, scope: PanelScope): boolean {
  return profile.settings.every(([value]) => visible(scope, value.group) && canEdit(scope, value.group));
}

export function checkProfileSettings(label: string, settings: ReadonlyArray<readonly [PanelValue<unknown>, unknown]>, assertOwn: (value: PanelValue<unknown>, where: string) => void): void {
  if (!Array.isArray(settings) || settings.length === 0) throw new AdminPanelConfigError(`profile "${label}" sets nothing`);
  const seen = new Set<string>();
  for (const [value, to] of settings) {
    assertOwn(value, `profile "${label}"`);
    if (!value.editable) throw new AdminPanelConfigError(`profile "${label}" sets "${value.label}", which is not modifiable`);
    if (value.definition.approval) throw new AdminPanelConfigError(`profile "${label}" sets "${value.label}", which needs a second operator's approval; a profile would apply it without one`);
    if (seen.has(value.id)) throw new AdminPanelConfigError(`profile "${label}" sets "${value.label}" twice`);
    seen.add(value.id);
    try {
      value.check(to);
    } catch (error) {
      throw new AdminPanelConfigError(`profile "${label}" sets "${value.label}" to ${JSON.stringify(toJson(to))}, which it refuses: ${message(error)}`);
    }
  }
}

export function profileSchema(profile: ProfileEntry, scope: PanelScope): ProfileSchema {
  const writable = profileWritable(profile, scope);
  const schema: ProfileSchema = {
    type: "profile",
    id: profile.id,
    title: profile.label,
    confirm: profile.confirm,
    writable,
    settings: profile.settings
      .filter(([value]) => visible(scope, value.group))
      .map(([value, to]) => (value.definition.sensitive ? { value: value.id, label: value.label } : { value: value.id, label: value.label, to: toJson(to) })),
  };
  if (profile.description !== undefined) schema.description = profile.description;
  if (profile.span !== undefined) schema.span = profile.span;
  if (profile.size !== undefined) schema.size = profile.size;
  if (profile.approval) schema.approval = true;
  if (profile.reasonRequired) schema.reasonRequired = true;
  return schema;
}

export function profileActive(profile: ProfileEntry, read: (value: PanelValue<unknown>) => unknown): boolean {
  return profile.settings.every(([value, to]) => sameJson(read(value), to));
}
