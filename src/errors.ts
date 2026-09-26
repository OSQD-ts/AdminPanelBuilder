/**
 * The two ways a panel refuses something.
 *
 * `AdminPanelConfigError` is structural: a declaration or a deployment that cannot do what it
 * appears to promise — a range whose minimum is above its maximum, a persisted value with no
 * stable name, an editable listener with no authentication. It is thrown at construction,
 * while the author is still looking at the line that caused it, because the alternative is a
 * panel that renders and quietly does something else.
 *
 * `ValueError` is a value refused at run time: a write outside a declared range, from code or
 * from an operator. The router turns it into a 400 carrying the same sentence, so the person
 * who typed the value reads what the code would have read.
 */
export class AdminPanelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminPanelConfigError";
  }
}

/** A refusal a page can put in its own language: a message key and what fills it. */
export interface Refusal {
  key: string;
  params: Record<string, string | number>;
}

export class ValueError extends Error {
  /**
   * The key the page translates and what fills it; the sentence is always English. A refusal written
   * by the application (a validate() verdict) is keyed as itself, "refuseApp", and shown as written.
   */
  readonly refusal: Refusal;

  constructor(message: string, refusal?: Refusal) {
    super(message);
    this.name = "ValueError";
    this.refusal = refusal ?? { key: "refuseApp", params: { message } };
  }
}
