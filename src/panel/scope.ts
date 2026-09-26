/**
 * What one request may see and do.
 *
 * A listener fixes a scope when it is built — the groups it shows, where editing and actions are
 * granted. A sign-in may narrow it further for one operator (`Grants`), never widen it: an operator's
 * grants are intersected with the listener's, so a listener's configuration is always the ceiling.
 */
import type { Refusal } from "../errors.js";
import type { PendingChange, Restriction, WireValue } from "../types.js";

/**
 * The part of a panel one request is shown.
 *
 * `groups` is what a viewer may see; `edit` and `actions` are what a viewer may do. They are
 * separate on purpose: somebody who may read every value is not automatically somebody who may
 * change what the application does next.
 */
export interface PanelScope {
  /** The groups shown, by name; `undefined` shows every group. A withheld group never leaves the process. */
  groups: ReadonlySet<string> | undefined;
  /** Everything, nothing, or the named groups. */
  edit: boolean | ReadonlySet<string>;
  actions: boolean | ReadonlySet<string>;
  /** Sentences the page shows about what this listener does not allow, and why. */
  restrictions: readonly Restriction[];
}

/** What a sign-in may say about one operator: at most these groups, at most these powers. */
export interface Grants {
  groups?: readonly string[] | undefined;
  edit?: boolean | readonly string[] | undefined;
  actions?: boolean | readonly string[] | undefined;
}

/** Everything, and nothing that changes anything: the scope of a rendered snapshot. */
export const READ_ONLY_SCOPE: PanelScope = Object.freeze({ groups: undefined, edit: false, actions: false, restrictions: [] });

export type EditOutcome =
  | { ok: true; value: WireValue }
  | { ok: true; pending: PendingChange }
  | { ok: false; reason: "not-found" | "not-editable" | "not-allowed" | "invalid" | "conflict"; message: string; refusal?: Refusal | undefined };
export type ActionOutcome = { ok: true; message: string } | { ok: true; pending: PendingChange } | { ok: false; reason: "not-found" | "not-allowed" | "invalid" | "failed"; message: string; refusal?: Refusal | undefined };

/** Whether a scope lets the viewer edit values in `group`. */
export function canEdit(scope: PanelScope, group: string): boolean {
  return scope.edit === true || (typeof scope.edit === "object" && scope.edit.has(group));
}

/** Whether a scope lets the viewer run actions in `group`. */
export function canRun(scope: PanelScope, group: string): boolean {
  return scope.actions === true || (typeof scope.actions === "object" && scope.actions.has(group));
}

export function anyAllowed(control: boolean | ReadonlySet<string>): boolean {
  return control === true || (typeof control === "object" && control.size > 0);
}

export function visible(scope: PanelScope, group: string): boolean {
  return scope.groups === undefined || scope.groups.has(group);
}

/** A listener's scope narrowed by one operator's grants. Grants never widen it. */
export function narrowScope(scope: PanelScope, grants: Grants | undefined): PanelScope {
  if (grants === undefined) return scope;
  const groups = grants.groups === undefined ? scope.groups : new Set(grants.groups.filter((group) => scope.groups === undefined || scope.groups.has(group)));
  return { ...scope, groups, edit: intersect(scope.edit, grants.edit), actions: intersect(scope.actions, grants.actions) };
}

function intersect(listener: boolean | ReadonlySet<string>, granted: boolean | readonly string[] | undefined): boolean | ReadonlySet<string> {
  if (granted === undefined || granted === true) return listener;
  if (granted === false || listener === false) return false;
  const wanted = new Set(granted);
  if (listener === true) return wanted;
  return new Set([...listener].filter((group) => wanted.has(group)));
}

/** Several grants as one: what any of them allows. For an operator in several provider groups. */
export function unionGrants(list: readonly Grants[]): Grants {
  const out: Grants = {};
  if (list.every((grants) => grants.groups !== undefined)) out.groups = [...new Set(list.flatMap((grants) => grants.groups ?? []))];
  for (const key of ["edit", "actions"] as const) {
    // Absent means "whatever the listener allows", the widest a grant can be.
    if (list.some((grants) => grants[key] === undefined)) continue;
    if (list.some((grants) => grants[key] === true)) out[key] = true;
    else {
      const named = [...new Set(list.flatMap((grants) => (Array.isArray(grants[key]) ? (grants[key] as readonly string[]) : [])))];
      out[key] = named.length === 0 ? false : named;
    }
  }
  return out;
}
