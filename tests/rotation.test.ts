/** A change log that rotates by size or by day, keeps what it is told to, and one chain across files. */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { fileChangeLog, MIN_ROTATE_BYTES, rotatedFiles } from "../src/change-log.js";
import { createAdminPanel, ManualClock } from "../src/index.js";
import { EVERYTHING } from "../src/testing.js";

async function logged(options: Parameters<typeof fileChangeLog>[1], edits: number, clock?: ManualClock) {
  const dir = await mkdtemp(join(tmpdir(), "apb-rotate-"));
  const path = join(dir, "changes.jsonl");
  const panel = createAdminPanel({ changeLog: fileChangeLog(path, options), ...(clock === undefined ? {} : { clock }) });
  panel.modifiable("", { label: "Note", maxLength: 20_000 });
  await panel.ready;
  for (let i = 0; i < edits; i += 1) {
    clock?.advance(3_600_000 * 7);
    panel.edit("note", `${i}:${"x".repeat(9000)}`, "ada", EVERYTHING);
    await panel.flushed();
  }
  return { dir, path, panel };
}

const lines = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line), env: {}, fetch } };
};

describe("a rotating change log", () => {
  it("starts a new file past its size, keeps one chain across the files, and loads across a rotation", async () => {
    const { path, dir } = await logged({ rotate: { maxBytes: MIN_ROTATE_BYTES } }, 20);
    const rotated = await rotatedFiles(path);
    expect(rotated.length).toBeGreaterThanOrEqual(2);
    const run = lines();
    expect(await main(["verify-log", path], run.io)).toBe(0);
    expect(run.err[0]).toMatch(/holds over 20 records in \d+ files/);
    const reopened = createAdminPanel({ changeLog: fileChangeLog(path, { rotate: { maxBytes: MIN_ROTATE_BYTES } }) });
    await reopened.ready;
    expect(reopened.changes().length).toBe(20);
    await rm(rotated[Math.floor(rotated.length / 2)] as string);
    const gap = lines();
    expect(await main(["verify-log", path], gap.io)).toBe(1);
    expect(gap.err[0]).toMatch(/a gap between .*changes\.jsonl\.\d+.* and .*: records are missing/);
    await rm(dir, { recursive: true });
  });

  it("rotates daily, and keeps only the files it is told to", async () => {
    const clock = new ManualClock(Date.parse("2026-09-21T10:00:00Z"));
    const { path, dir } = await logged({ rotate: { daily: true }, keep: { files: 2 }, now: () => clock.now() }, 8, clock);
    expect(await rotatedFiles(path)).toHaveLength(2);
    expect((await readdir(dir)).filter((name) => name === "changes.jsonl")).toHaveLength(1);
    await rm(dir, { recursive: true });
  });

  it("refuses a rotation size or retention that cannot be meant", () => {
    expect(() => fileChangeLog("x", { rotate: { maxBytes: 10 } })).toThrow(/at least/);
    expect(() => fileChangeLog("x", { keep: { files: 0 } })).toThrow(/above zero/);
    expect(() => fileChangeLog("x", { keep: { days: -1 } })).toThrow(/above zero/);
  });
});
