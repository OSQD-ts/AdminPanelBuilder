import type { JsonValue } from "../types.js";
import type { ValueStore } from "./types.js";

/**
 * A store that forgets on exit: for tests, and for sharing one set of choices between two
 * panels in one process. Values are copied in and out, so nothing outside can mutate what it
 * holds.
 */
export function memoryStore(initial: Record<string, JsonValue> = {}): ValueStore & { readonly entries: Record<string, JsonValue> } {
  const entries: Record<string, JsonValue> = structuredClone(initial);
  return {
    entries,
    load: async () => structuredClone(entries),
    save: async (id, value) => {
      entries[id] = structuredClone(value);
    },
  };
}
