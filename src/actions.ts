/**
 * A button on the panel that runs a function in the application.
 *
 * Flush a cache, requeue failed mail, end a stuck game, reload a feed. An action is a control
 * in the strict sense: it reaches back into the application, so a listener shows it as usable
 * only when `controls.actions` is granted, which in turn needs authentication.
 *
 * An action has a deadline. The function cannot be cancelled — JavaScript has no such thing —
 * but the operator's request is answered when the deadline passes, the `signal` it was handed
 * is aborted so anything that honours one can stop, and a late result or rejection is ignored
 * rather than surfacing as an unhandled rejection.
 */
import { AdminPanelConfigError } from "./errors.js";
import type { ActionContext, ActionVisibility } from "./types.js";

/** Default deadline: long enough for a real job, short enough that a hung one is noticed. */
export const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

export interface ActionDefinition {
  id: string;
  label: string;
  description: string | undefined;
  confirm: boolean;
  destructive: boolean;
  timeoutMs: number;
  order: number;
  sequence: number;
  span: import("./types.js").Span | undefined;
  size: import("./types.js").CardSize | undefined;
  visibleWhen: (() => boolean) | undefined;
  disabledWhen: (() => string | false | undefined) | undefined;
  typeToConfirm: boolean;
  approval: boolean;
  reasonRequired: boolean;
  /** Who reads what a run answered; undefined follows the panel's `actionVisibility`. */
  visibility: ActionVisibility | undefined;
}

export class PanelAction {
  /** @internal */
  group: string;

  /** @internal Built by the panel; declare actions with `action()`. */
  constructor(
    /** @internal */ readonly definition: ActionDefinition,
    /** @internal */ readonly run: (context: ActionContext) => unknown,
    group: string,
  ) {
    this.group = group;
  }

  get id(): string {
    return this.definition.id;
  }

  get label(): string {
    return this.definition.label;
  }
}

const VISIBILITIES: readonly ActionVisibility[] = ["self", "runners", "everyone"];

/** An action's `visibility`, refused when it is anything but one of the three. */
export function checkVisibility(visibility: unknown, where: string): ActionVisibility | undefined {
  if (visibility === undefined) return undefined;
  if (!VISIBILITIES.includes(visibility as ActionVisibility)) throw new AdminPanelConfigError(`${where} is ${JSON.stringify(visibility)}; it is "self", "runners" or "everyone"`);
  return visibility as ActionVisibility;
}

/** The operator a name stands for: "ada via gateway" is ada, as a remote panel relays her. */
export function operatorOf(actor: string): string {
  const via = actor.lastIndexOf(" via ");
  return via === -1 ? actor : actor.slice(0, via);
}
