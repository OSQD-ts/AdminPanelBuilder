/**
 * The thing `viewable()` and `modifiable()` hand back.
 *
 * `const players = viewable(10)` cannot make `players` the number 10 and still let the panel
 * see it change: JavaScript copies a primitive on assignment, and nothing observes a local
 * variable. So the declaration returns a handle that holds the value, and the price is
 * `.value` — `players.value += 1` rather than `players += 1`. Writing always goes through
 * `.value` or `set()`, because that is the moment the panel has to hear about. Reading is
 * `.value` too in TypeScript, which refuses arithmetic on an object; in plain JavaScript, and in
 * template strings and `JSON.stringify` in either, the handle converts to its value.
 *
 * A value has one of three sources: its own cell (the common case), a function read whenever
 * somebody looks (`viewable(() => queue.length)`), or a property of an object the application
 * already has (`bind(config, "maxPlayers")`). The last two cannot announce changes, so they
 * are read on every poll and sampled on a timer when charted.
 */
import { Emitter } from "../internal/emitter.js";
import { ValueError } from "../errors.js";
import type { ChangeContext, JsonValue, ModifiableOptions, ValueConstraints, ValueKind, ValueSchema } from "../types.js";
import { checkValue } from "./kinds.js";

export type ValueSource<T> = { kind: "cell"; current: T } | { kind: "getter"; read: () => T } | { kind: "property"; target: object; key: PropertyKey };

/** What a value needs from the panel that owns it. Internal: the panel is the only implementation. */
export interface ValueOwner {
  valueChanged(value: PanelValue<unknown>, by: string): void;
  moveValue(value: PanelValue<unknown>, group: string): void;
  reportError(error: unknown, source: string): void;
}

/** Everything fixed at declaration, resolved and validated by the panel. */
export interface ValueDefinition {
  id: string;
  label: string;
  description: string | undefined;
  kind: ValueKind;
  editable: boolean;
  sensitive: boolean;
  confirm: boolean;
  persist: boolean;
  constraints: ValueConstraints;
  pattern: RegExp | undefined;
  unit: string | undefined;
  format: ValueSchema["format"] | undefined;
  decimals: number | undefined;
  order: number;
  sequence: number;
  validate: ((next: never) => string | undefined) | undefined;
  onChange: ModifiableOptions<unknown>["onChange"];
  status: import("../types.js").StatusRule | undefined;
  approval: boolean;
  timed: boolean;
  span: import("../types.js").Span | undefined;
  visibleWhen: (() => boolean) | undefined;
  disabledWhen: (() => string | false | undefined) | undefined;
  /** Recent changes kept for the page's timeline; 0 keeps none. */
  timeline: number;
  validateAsync: ((next: never) => Promise<string | undefined>) | undefined;
  validateTimeoutMs: number;
}

export class PanelValue<T> {
  /** @internal The group this value is drawn in. Moved with `moveTo` or `panel.group(...).add`. */
  group: string;
  /** @internal When the value last changed, or 0 before it ever did. */
  updatedAt: number;
  /** @internal The panel version at the last change. */
  version = 0;
  /** @internal Who last changed it from the panel. */
  changedBy: string | undefined;
  /** @internal The chart drawn beside it, when it has one of its own. */
  chartId: string | undefined;
  /** Typed over `unknown` so a `PanelValue<number>` is still a `PanelValue<unknown>` wherever a panel takes any value. */
  private readonly changes: Emitter<{ change: { next: unknown; context: ChangeContext<unknown> } }>;

  /** @internal Built by the panel; declare values with `viewable`, `modifiable` or `bind`. */
  constructor(
    /** @internal */ readonly definition: ValueDefinition,
    /** @internal */ readonly source: ValueSource<T>,
    private readonly owner: ValueOwner,
    group: string,
    now: number,
  ) {
    this.group = group;
    this.updatedAt = now;
    this.changes = new Emitter((error) => owner.reportError(error, `a change listener on "${definition.label}"`));
  }

  get id(): string {
    return this.definition.id;
  }

  get label(): string {
    return this.definition.label;
  }

  get kind(): ValueKind {
    return this.definition.kind;
  }

  /** Declared modifiable: whether a listener lets anybody edit it is decided where it is served. */
  get editable(): boolean {
    return this.definition.editable;
  }

  /** Read from a function or a property on every look, rather than held. */
  get live(): boolean {
    return this.source.kind !== "cell";
  }

  get value(): T {
    return this.get();
  }

  set value(next: T) {
    this.set(next);
  }

  get(): T {
    switch (this.source.kind) {
      case "cell":
        return this.source.current;
      case "getter":
        return this.source.read();
      case "property":
        return (this.source.target as Record<PropertyKey, T>)[this.source.key] as T;
    }
  }

  /**
   * Replaces the value. A modifiable value's constraints hold here too, and a refused value
   * throws `ValueError` naming the constraint; a viewable shows whatever it is given, because
   * refusing to display something is worse than displaying it oddly.
   */
  set(next: T): void {
    this.write(next, "code");
  }

  /** Replaces the value with what `change` makes of the current one. */
  update(change: (current: T) => T): void {
    this.write(change(this.get()), "code");
  }

  /** Listens for changes from any source: code, an operator, the store at start-up. Returns the way to stop. */
  on(listener: (next: T, change: ChangeContext<T>) => void): () => void {
    return this.changes.on("change", ({ next, context }) => listener(next as T, context as ChangeContext<T>));
  }

  /** Draws the value in another group from now on. */
  moveTo(group: string): this {
    this.owner.moveValue(this as PanelValue<unknown>, group);
    return this;
  }

  /** @internal The single path every write takes. */
  write(next: T, by: string): void {
    if (this.source.kind === "getter") {
      throw new ValueError(`${this.label} is read from a function, so it cannot be set; change what the function reads instead`);
    }
    if (this.definition.editable) this.check(next);
    const previous = this.get();
    if (this.source.kind === "cell") this.source.current = next;
    else (this.source.target as Record<PropertyKey, T>)[this.source.key] = next;
    // An object written back after being mutated in place is still a change, so only
    // primitives are compared.
    if (Object.is(previous, next) && (typeof next !== "object" || next === null)) return;
    if (by !== "code") this.changedBy = by;
    this.owner.valueChanged(this as PanelValue<unknown>, by);
    if (this.changes.has("change")) this.changes.emit("change", { next, context: { previous, by } });
  }

  /** @internal Throws `ValueError` when `candidate` breaks the declared constraints or the custom validator. */
  check(candidate: unknown): void {
    const { label, kind, constraints, pattern, validate } = this.definition;
    checkValue(label, kind, constraints, candidate, pattern);
    if (validate === undefined) return;
    let verdict: string | undefined;
    try {
      verdict = validate(candidate as never);
    } catch (error) {
      verdict = `the validator for ${label} failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (typeof verdict === "string" && verdict !== "") throw new ValueError(verdict);
  }

  valueOf(): T {
    return this.get();
  }

  toString(): string {
    return String(this.get());
  }

  toJSON(): T {
    return this.get();
  }

  [Symbol.toPrimitive](hint: string): unknown {
    const current = this.get();
    if (current !== null && typeof current === "object") return hint === "number" ? Number.NaN : JSON.stringify(current as JsonValue);
    return current;
  }
}
