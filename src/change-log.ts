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

/** How a file change log rotates and what it keeps. */
export interface FileChangeLogOptions {
  /** Start a new file past this size in bytes, or at the first write of a new UTC day with `"daily"`. */
  rotate?: { maxBytes?: number | undefined; daily?: boolean | undefined } | undefined;
  /** Rotated files kept, by count and by age; older ones are deleted. Default: all of them. */
  keep?: { files?: number | undefined; days?: number | undefined } | undefined;
  /** For tests. */
  now?: (() => number) | undefined;
}

/** Smallest size a log may rotate at: below it, every few changes would start a file. */
export const MIN_ROTATE_BYTES = 64 * 1024;

/**
 * Change records as JSON lines in one file, appended asynchronously. Loading reads at most the last
 * megabyte of each file it needs, so a log years long costs the same start-up as a fresh one.
 * `node:fs` is imported on first use, keeping the root entry loadable on runtimes without it.
 *
 * With `rotate`, the file is renamed to `<path>.<UTC timestamp>` when it grows past `maxBytes` or a
 * new day begins, and a fresh one started; the hash chain carries on across files, so a missing file
 * between two others shows as a gap (`apb verify-log <path>` checks every rotated file with it).
 * With `keep`, rotated files past the count or the age are deleted after each rotation.
 */
export function fileChangeLog(path: string, options: FileChangeLogOptions = {}): ChangeLogStore {
  const maxBytes = options.rotate?.maxBytes;
  if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes < MIN_ROTATE_BYTES)) throw new RangeError(`fileChangeLog: rotate.maxBytes is at least ${MIN_ROTATE_BYTES}`);
  const keepFiles = options.keep?.files;
  const keepDays = options.keep?.days;
  if (keepFiles !== undefined && (!Number.isInteger(keepFiles) || keepFiles < 1)) throw new RangeError("fileChangeLog: keep.files is a whole number above zero");
  if (keepDays !== undefined && (!Number.isFinite(keepDays) || keepDays <= 0)) throw new RangeError("fileChangeLog: keep.days is a number of days above zero");
  const now = options.now ?? (() => Date.now());
  let queue: Promise<void> = Promise.resolve();
  /** The UTC day the current file was last written on, for daily rotation. */
  let writtenDay: string | undefined;

  const readTail = async (file: string): Promise<ChangeRecord[]> => {
    const { open } = await import("node:fs/promises");
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(file, "r");
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
      return records;
    } finally {
      await handle.close();
    }
  };

  const rotate = async (): Promise<void> => {
    const { rename, readdir, rm, stat } = await import("node:fs/promises");
    const { basename, dirname, join } = await import("node:path");
    // Milliseconds included, so two rotations in one second never share a name.
    const stamp = new Date(now()).toISOString().replace(/[-:.]/g, "");
    await rename(path, `${path}.${stamp}`);
    if (keepFiles === undefined && keepDays === undefined) return;
    const rotated = await rotatedFiles(path, { readdir, basename, dirname, join });
    const expired = new Set(keepFiles === undefined ? [] : rotated.slice(0, Math.max(0, rotated.length - keepFiles)));
    if (keepDays !== undefined) {
      for (const file of rotated) if (now() - (await stat(file)).mtimeMs > keepDays * 86_400_000) expired.add(file);
    }
    for (const file of expired) await rm(file, { force: true });
  };

  return {
    async load(limit) {
      const records = await readTail(path);
      if (records.length >= limit || options.rotate === undefined) return records.slice(-limit);
      // Just after a rotation the current file is short: the newest rotated ones fill the page.
      const { readdir } = await import("node:fs/promises");
      const { basename, dirname, join } = await import("node:path");
      const rotated = await rotatedFiles(path, { readdir, basename, dirname, join });
      let all = records;
      for (const file of rotated.reverse()) {
        if (all.length >= limit) break;
        all = [...(await readTail(file)), ...all];
      }
      return all.slice(-limit);
    },
    append(record) {
      const next = queue.then(async () => {
        const { appendFile, mkdir, stat } = await import("node:fs/promises");
        const { dirname } = await import("node:path");
        await mkdir(dirname(path), { recursive: true });
        if (options.rotate !== undefined) {
          const size = await stat(path).then(
            (found) => found.size,
            () => 0,
          );
          const day = new Date(now()).toISOString().slice(0, 10);
          writtenDay ??= size > 0 ? await stat(path).then((found) => new Date(found.mtimeMs).toISOString().slice(0, 10)) : day;
          if (size > 0 && ((maxBytes !== undefined && size >= maxBytes) || (options.rotate.daily === true && day !== writtenDay))) await rotate();
          writtenDay = day;
        }
        await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
      });
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

/** A log's rotated files, oldest first: `<path>.<timestamp>` sorts by time as text. */
export async function rotatedFiles(
  path: string,
  fs?: { readdir(dir: string): Promise<string[]>; basename(path: string): string; dirname(path: string): string; join(...parts: string[]): string },
): Promise<string[]> {
  const tools = fs ?? { readdir: (await import("node:fs/promises")).readdir, ...(await import("node:path")) };
  const prefix = `${tools.basename(path)}.`;
  const names = await tools.readdir(tools.dirname(path)).catch(() => [] as string[]);
  return names
    .filter((name) => name.startsWith(prefix) && /^\d{8}T\d{9}Z$/.test(name.slice(prefix.length)))
    .sort()
    .map((name) => tools.join(tools.dirname(path), name));
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
