import type { JsonValue } from "../types.js";

/**
 * Where an operator's changes to `persist: true` values are remembered across restarts.
 *
 * Deliberately two methods. Every method may reject, and the panel treats a rejection as "no
 * answer": a failed `load` leaves every value at its declared default and says so in a
 * notice, and a failed `save` leaves the change applied in memory and says that it will not
 * survive a restart. A store outage must cost the memory of a change, never the change itself
 * or the application it was made to.
 *
 * Only what an operator chose is stored. What the code sets is the code's business and is
 * never written here, so a hot counter cannot become a disk write per increment.
 */
export interface ValueStore {
  /** Everything stored, by value id. */
  load(): Promise<Record<string, JsonValue>>;
  save(id: string, value: JsonValue): Promise<void>;
}
