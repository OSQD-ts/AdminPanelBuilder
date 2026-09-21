/**
 * Who changed what: the recent history the page shows, the ids undo refers to, and the hand-off to
 * a store and to audit sinks.
 *
 * Every record is chained to the one before it: `hash` is SHA-256 over the previous record's hash
 * and this record's content, so deleting or editing a line in a stored log breaks the chain at that
 * line, and `verifyChain` (or `apb verify-log`) says where. The chain is computed in the store's
 * write queue, one record after another, which is also what keeps the stored order the real order.
 *
 * The in-memory list is bounded at `MAX_CHANGES` and is what the page reads. A `ChangeLogStore`
 * keeps everything, survives restarts, and seeds the list and the id counter on start, so an id is
 * never reused across a restart and "undo change 42" cannot mean a different change after one.
 */
import type { ChangeRecord } from "./types.js";

/** Most recent operator changes kept for the page. A recent-history panel; a `ChangeLogStore` keeps the rest. */
export const MAX_CHANGES = 200;

/** Where every change is kept. Either method may reject; the panel reports it and carries on. */
export interface ChangeLogStore {
  /** The newest `limit` records, oldest first. */
  load(limit: number): Promise<ChangeRecord[]>;
  append(record: ChangeRecord): Promise<void>;
}

export class ChangeLog {
  private readonly records: ChangeRecord[] = [];
  private nextId = 1;
  private lastHash = "";
  private queue: Promise<void>;
  private opened: () => void = () => undefined;

  constructor(
    private readonly store: ChangeLogStore | undefined,
    private readonly onRecord: (record: ChangeRecord) => void,
    private readonly onStoreError: (error: unknown) => void,
  ) {
    // LOAD-BEARING: with a store, nothing is hashed or appended until the stored chain is loaded,
    // or a change made during start-up would be chained to nothing and break the chain it joins.
    this.queue = store === undefined ? Promise.resolve() : new Promise<void>((resolve) => (this.opened = resolve));
  }

  async restore(): Promise<void> {
    if (this.store === undefined) return;
    try {
      await this.load(this.store);
    } finally {
      this.opened();
    }
  }

  private async load(store: ChangeLogStore): Promise<void> {
    const loaded = await store.load(MAX_CHANGES);
    // Records made before the load finished keep their place after the loaded ones.
    const early = this.records.splice(0);
    this.records.push(...loaded.slice(-MAX_CHANGES));
    const highest = loaded.reduce((max, record) => (Number.isFinite(record.id) ? Math.max(max, record.id) : max), 0);
    const chained = [...loaded].reverse().find((record) => typeof record.hash === "string");
    if (chained?.hash !== undefined && this.lastHash === "") this.lastHash = chained.hash;
    let id = highest + 1;
    for (const record of early) {
      record.id = id++;
      this.records.push(record);
    }
    this.nextId = id;
    while (this.records.length > MAX_CHANGES) this.records.shift();
  }

  record(change: Omit<ChangeRecord, "id">): ChangeRecord {
    const record = { id: this.nextId++, ...change } as ChangeRecord;
    this.records.push(record);
    if (this.records.length > MAX_CHANGES) this.records.shift();
    const store = this.store;
    this.queue = this.queue
      .then(async () => {
        record.prevHash = this.lastHash;
        record.hash = await chainHash(this.lastHash, record);
        this.lastHash = record.hash;
        if (store !== undefined) await store.append(record);
      })
      .catch((error: unknown) => this.onStoreError(error));
    this.onRecord(record);
    return record;
  }

  /** A change made on another replica: shown here, not stored again, and not chained here. */
  remember(record: ChangeRecord): void {
    this.records.push({ ...record, id: this.nextId++ });
    if (this.records.length > MAX_CHANGES) this.records.shift();
  }

  /** Settles when every record so far has been hashed and handed to the store. */
  flushed(): Promise<void> {
    return this.queue;
  }

  list(): ChangeRecord[] {
    return this.records.slice();
  }

  find(id: number): ChangeRecord | undefined {
    return this.records.find((record) => record.id === id);
  }
}

/** Change records kept in memory: for tests, and for a second panel in one process. */
export function memoryChangeLog(): ChangeLogStore & { readonly records: ChangeRecord[] } {
  const records: ChangeRecord[] = [];
  return {
    records,
    load: async (limit) => structuredClone(records.slice(-limit)),
    append: async (record) => {
      records.push(structuredClone(record));
    },
  };
}

/**
 * Change records as JSON lines in one file, appended asynchronously. Loading reads at most the last
 * megabyte, so a log years long costs the same start-up as a fresh one. `node:fs` is imported on
 * first use, keeping the root entry loadable on runtimes without it.
 */
export function fileChangeLog(path: string): ChangeLogStore {
  let queue: Promise<void> = Promise.resolve();
  return {
    async load(limit) {
      const { open } = await import("node:fs/promises");
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        handle = await open(path, "r");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, 1024 * 1024);
        const buffer = new Uint8Array(length);
        await handle.read(buffer, 0, length, size - length);
        const lines = new TextDecoder().decode(buffer).split("\n");
        if (length < size) lines.shift();
        const records: ChangeRecord[] = [];
        for (const line of lines) {
          if (line.trim() === "") continue;
          try {
            records.push(JSON.parse(line) as ChangeRecord);
          } catch {
            // A torn last line from a crash mid-write is skipped rather than refusing the rest.
          }
        }
        return records.slice(-limit);
      } finally {
        await handle.close();
      }
    },
    append(record) {
      const next = queue.then(async () => {
        const { appendFile, mkdir } = await import("node:fs/promises");
        const { dirname } = await import("node:path");
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

/** SHA-256 over the previous hash and the record's content, the chain fields and nothing else left out. */
export async function chainHash(previous: string, record: ChangeRecord): Promise<string> {
  const { hash: _hash, prevHash: _prev, ...content } = record;
  const bytes = new TextEncoder().encode(`${previous}\n${canonical(content)}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** JSON with keys sorted, so a record hashes the same whichever order its fields were written in. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}

/**
 * Checks a stored log's chain. Returns the first record that does not follow from the one before it
 * — deleted, edited or inserted — or nothing when the chain holds. Records written before chaining
 * existed (no hash) are skipped, and the chain resumes at the next hashed one.
 */
export async function verifyChain(records: readonly ChangeRecord[]): Promise<{ ok: true; checked: number } | { ok: false; at: number; id: number; reason: string }> {
  let previous: string | undefined;
  let checked = 0;
  for (const [index, record] of records.entries()) {
    if (typeof record.hash !== "string") continue;
    if (previous !== undefined && record.prevHash !== previous) return { ok: false, at: index, id: record.id, reason: "it does not follow the record before it: something between them was deleted, inserted or reordered" };
    if ((await chainHash(record.prevHash ?? "", record)) !== record.hash) return { ok: false, at: index, id: record.id, reason: "its content does not match its hash: it was edited" };
    previous = record.hash;
    checked += 1;
  }
  return { ok: true, checked };
}
