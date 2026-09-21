/**
 * A store in one JSON file.
 *
 * Writes are asynchronous and serialised. Asynchronous because a panel runs inside somebody's
 * server and `writeFileSync` would stall every request that process is serving for the length
 * of a disk write. Serialised because two quick edits would otherwise race two writes, and the
 * one that lands last is not necessarily the newer one.
 *
 * Each write goes to a temporary file that is then renamed over the real one. A rename within a
 * directory is atomic, so a crash mid-write leaves the previous file intact rather than half a
 * JSON document that the next start cannot load.
 *
 * `node:fs` is imported when the store is first used rather than at the top of the module: this
 * module is reachable from the package root, and the root must load on an edge runtime that
 * has no file system, for an application that never asks for this store.
 */
import type { JsonValue } from "../types.js";
import type { ValueStore } from "./types.js";

export function fileStore(path: string): ValueStore {
  let cache: Record<string, JsonValue> | undefined;
  let queue: Promise<void> = Promise.resolve();

  async function read(): Promise<Record<string, JsonValue>> {
    if (cache !== undefined) return cache;
    const { readFile } = await import("node:fs/promises");
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      // No file yet is the first start, not a failure.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        cache = {};
        return cache;
      }
      throw error;
    }
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${path} does not hold a JSON object of stored values`);
    cache = parsed as Record<string, JsonValue>;
    return cache;
  }

  return {
    load: async () => ({ ...(await read()) }),
    save(id, value) {
      const next = queue.then(async () => {
        const { mkdir, rename, writeFile } = await import("node:fs/promises");
        const { dirname } = await import("node:path");
        const entries = { ...(await read()), [id]: value };
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
        await rename(temporary, path);
        cache = entries;
      });
      // The queue carries on after a failed write; the caller still hears about this one.
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
