import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileStore, memoryStore, type ValueStore } from "../src/index.js";
import { panelAt } from "./helpers.js";

const scope = { groups: undefined, edit: true, actions: false, restrictions: [] };

describe("persisted values", () => {
  it("restore an operator's choice on the next start, whether declared before or after the load", async () => {
    const store = memoryStore({ "max-players": 250, late: "restored" });
    const { panel } = panelAt(0, { store });
    const early = panel.modifiable(100, { id: "max-players", label: "Max players", min: 2, max: 500, persist: true });
    await panel.ready;
    const late = panel.modifiable("default", { id: "late", label: "Late", persist: true });
    expect(early.value).toBe(250);
    expect(late.value).toBe("restored");
    expect(panel.state().values.find((value) => value.id === "max-players")?.by).toBe("store");
  });

  it("save only what an operator changed, never what the code set", async () => {
    const store = memoryStore();
    const { panel } = panelAt(0, { store });
    const value = panel.modifiable(1, { label: "Level", persist: true });
    await panel.ready;
    value.set(2);
    panel.edit("level", 3, "ada", scope);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.entries).toEqual({ level: 3 });
  });

  it("refuse a stored value the declaration no longer accepts, and keep the default", async () => {
    const store = memoryStore({ limit: 9000 });
    const { panel } = panelAt(0, { store });
    const limit = panel.modifiable(10, { label: "Limit", max: 100, persist: true });
    await panel.ready;
    expect(limit.value).toBe(10);
    expect(panel.notices().find((notice) => notice.id === "store-refused-limit")?.message).toMatch(/must be at most 100/);
  });

  it("survive a store that cannot load or save, and say what that costs", async () => {
    const broken: ValueStore = { load: () => Promise.reject(new Error("disk gone")), save: () => Promise.reject(new Error("read-only")) };
    const { panel } = panelAt(0, { store: broken });
    panel.modifiable(1, { label: "Level", persist: true });
    await panel.ready;
    expect(panel.notices().find((notice) => notice.id === "store-load")?.message).toMatch(/declared default: disk gone/);
    expect(panel.edit("level", 2, "ada", scope).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(panel.get("level")?.value).toBe(2);
    expect(panel.notices().find((notice) => notice.id === "store-save-level")?.message).toMatch(/will not survive a restart/);
  });

  it("are refused when there is nothing to persist to, or no stable name to persist under", () => {
    const { panel } = panelAt();
    expect(() => panel.modifiable(1, { label: "x", persist: true })).toThrow(/the panel has no store/);
    const withStore = panelAt(0, { store: memoryStore() }).panel;
    expect(() => withStore.modifiable(1, { persist: true })).toThrow(/needs an id or a label/);
  });
});

describe("the file store", () => {
  it("starts empty without a file, writes atomically, and loads what it wrote", async () => {
    const directory = await mkdtemp(join(tmpdir(), "apb-"));
    const path = join(directory, "nested", "panel.json");
    const store = fileStore(path);
    expect(await store.load()).toEqual({});
    await Promise.all([store.save("a", 1), store.save("b", "two"), store.save("a", 3)]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ a: 3, b: "two" });
    expect(await fileStore(path).load()).toEqual({ a: 3, b: "two" });
  });

  it("leaves no temporary file behind when a write fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "apb-"));
    const path = join(directory, "panel.json");
    // A value that cannot be turned into JSON fails the write inside the queue.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(fileStore(path).save("a", circular as never)).rejects.toThrow();
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a file that is not an object of stored values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "apb-"));
    const path = join(directory, "panel.json");
    await writeFile(path, "[1,2]");
    await expect(fileStore(path).load()).rejects.toThrow(/does not hold a JSON object/);
  });
});
