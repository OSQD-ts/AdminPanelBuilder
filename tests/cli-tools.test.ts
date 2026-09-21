/**
 * The typed client and the commands written on it: scheduling, watching, export and import,
 * verifying a change log, and shell completion.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { createAdminPanel, fileChangeLog, listenPanelFor } from "./cli-fixtures.js";
import { PanelApiError, panelClient } from "../src/sdk.js";
import { TOKEN } from "./helpers.js";

function io(extra: { signal?: AbortSignal } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line), env: { PANEL_TOKEN: TOKEN }, fetch, ...extra } };
}

describe("the typed client", () => {
  it("reads, sets, schedules, cancels and refuses with the panel's own sentence", async () => {
    const { panel, server } = await listenPanelFor((panel) => {
      panel.modifiable(10, { label: "Limit", max: 100 });
      panel.modifiable("Welcome", { label: "Motd" });
    });
    const client = panelClient({ url: server.url, token: TOKEN });
    try {
      expect((await client.schema()).groups[0]?.items.length).toBe(2);
      expect(await client.set("limit", 20)).toMatchObject({ value: { value: 20 } });
      const at = Date.now() + 3_600_000;
      const scheduled = await client.set("motd", "Maintenance at nine", { at: new Date(at).toISOString() });
      const entry = "value" in scheduled ? scheduled.value.scheduled?.[0] : undefined;
      expect(entry).toMatchObject({ to: "Maintenance at nine", at });
      expect(panel.get("motd")?.value).toBe("Welcome");
      await client.cancelScheduled(entry?.id as string);
      expect((await client.state()).values.find((value) => value.id === "motd")?.scheduled).toBeUndefined();
      const refusal = await client.set("limit", 500).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(PanelApiError);
      expect(refusal).toMatchObject({ status: 400, message: expect.stringMatching(/at most 100/) });
      expect((await client.openApi()).openapi).toBe("3.1.0");
      expect(() => panelClient({ url: "ftp://x" })).toThrow(/http/);
    } finally {
      panel.close();
      await server.close();
    }
  });

  it("watches from where the last answer left off, and stops on the first refusal", async () => {
    const { panel, server } = await listenPanelFor((panel) => panel.modifiable(1, { label: "Level" }));
    try {
      const seen: number[] = [];
      const controller = new AbortController();
      const watching = panelClient({ url: server.url, token: TOKEN }).watch(
        (state) => {
          seen.push(state.version);
          if (seen.length === 1) panel.get("level")?.set(2);
          if (seen.length === 2) controller.abort();
        },
        { intervalMs: 10, signal: controller.signal },
      );
      await watching;
      expect(seen[1]).toBeGreaterThan(seen[0] as number);
      await expect(panelClient({ url: server.url, token: "wrong-token-0123456789" }).watch(() => undefined, { intervalMs: 10 })).rejects.toMatchObject({ status: 401 });
    } finally {
      panel.close();
      await server.close();
    }
  });
});

describe("apb, the newer commands", () => {
  it("schedules and cancels with --at, and refuses a time it cannot read", async () => {
    const { panel, server } = await listenPanelFor((panel) => panel.modifiable(1, { label: "Level" }));
    try {
      const run = io();
      const when = new Date(Date.now() + 600_000).toISOString();
      expect(await main(["set", server.url, "level", "5", "--at", when], run.io)).toBe(0);
      const id = /apb cancel \S+ (\S+)/.exec(run.err.at(-1) as string)?.[1] as string;
      expect(panel.state().values[0]?.scheduled).toHaveLength(1);
      expect(await main(["cancel", server.url, id], run.io)).toBe(0);
      expect(panel.state().values[0]?.scheduled).toBeUndefined();
      expect(await main(["set", server.url, "level", "5", "--at", "tomorrow"], run.io)).toBe(2);
      expect(await main(["cancel", server.url], run.io)).toBe(2);
    } finally {
      panel.close();
      await server.close();
    }
  });

  it("watches values, printing each only when it changes", async () => {
    const { panel, server } = await listenPanelFor((panel) => {
      panel.modifiable(1, { label: "Level" });
      panel.modifiable("a", { label: "Other" });
    });
    try {
      const run = io();
      expect(await main(["watch", server.url, "level", "--interval", "1s", "--count", "2"], run.io)).toBe(0);
      expect(run.out).toHaveLength(1);
      expect(run.out[0]).toMatch(/\tlevel\t1$/);
      expect(await main(["watch", server.url, "--count", "zero"], run.io)).toBe(2);
    } finally {
      panel.close();
      await server.close();
    }
  });

  it("exports settings, shows what an import would change, and imports whole or not at all", async () => {
    const { panel, server } = await listenPanelFor((panel) => {
      panel.modifiable(10, { label: "Limit", max: 100 });
      panel.modifiable("x", { label: "Note" });
      panel.modifiable("hunter2", { label: "Password", sensitive: true });
    });
    const dir = await mkdtemp(join(tmpdir(), "apb-cli-"));
    try {
      const exported = io();
      expect(await main(["export", server.url], exported.io)).toBe(0);
      expect(JSON.parse(exported.out.join("\n"))).toEqual({ settings: { limit: 10, note: "x" } });
      const good = join(dir, "good.json");
      await writeFile(good, JSON.stringify({ settings: { limit: 20, note: "x" } }));
      const dry = io();
      expect(await main(["import", server.url, good, "--dry-run"], dry.io)).toBe(0);
      expect(dry.err).toEqual(["  limit: 10 → 20"]);
      expect(panel.get("limit")?.value).toBe(10);
      const bad = join(dir, "bad.json");
      await writeFile(bad, JSON.stringify({ limit: 500, ghost: 1 }));
      const refused = io();
      expect(await main(["import", server.url, bad, "--dry-run"], refused.io)).toBe(1);
      expect(await main(["import", server.url, bad], refused.io)).toBe(1);
      expect(refused.err.at(-1)).toMatch(/nothing was imported/);
      const applied = io();
      expect(await main(["import", server.url, good], applied.io)).toBe(0);
      expect(panel.get("limit")?.value).toBe(20);
      expect(panel.changes().at(-1)).toMatchObject({ kind: "import", by: "token" });
      await writeFile(join(dir, "junk.json"), "not json");
      expect(await main(["import", server.url, join(dir, "junk.json")], io().io)).toBe(2);
    } finally {
      panel.close();
      await server.close();
    }
  });

  it("verifies a change log's chain and names the record that breaks it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apb-log-"));
    const path = join(dir, "changes.jsonl");
    const panel = createAdminPanel({ changeLog: fileChangeLog(path) });
    panel.modifiable(1, "a");
    await panel.ready;
    const scope = { groups: undefined, edit: true, actions: false, restrictions: [] };
    for (const value of [2, 3, 4]) panel.edit("a", value, "ada", scope);
    await panel.flushed();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const good = io();
    expect(await main(["verify-log", path], good.io)).toBe(0);
    expect(good.err[0]).toMatch(/holds over 3 records/);
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    await writeFile(path, `${[lines[0], lines[2]].join("\n")}\n`);
    const cut = io();
    expect(await main(["verify-log", path], cut.io)).toBe(1);
    expect(cut.err[0]).toMatch(/record 3 \(line 2\) breaks the chain/);
    expect(await main(["verify-log"], io().io)).toBe(2);
    expect(await main(["verify-log", join(dir, "missing.jsonl")], io().io)).toBe(2);
  });

  it("prints completion for bash, zsh and fish", async () => {
    for (const shell of ["bash", "zsh", "fish"]) {
      const run = io();
      expect(await main(["completion", shell], run.io)).toBe(0);
      expect(run.out.join("\n")).toContain("verify-log");
    }
    expect(await main(["completion", "tcsh"], io().io)).toBe(2);
  });
});

describe("apb config", () => {
  it("prints the resolved configuration with the token redacted, and refuses a bad file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apb-config-"));
    const good = join(dir, "admin-panel.toml");
    await writeFile(good, "[listen]\nport = 9100\n[controls]\nedit = true\n");
    const run = io();
    expect(await main(["config", good], { ...run.io, env: { PANEL_TOKEN: "a-token-long-enough-1" } })).toBe(0);
    const printed = JSON.parse(run.out.join("\n"));
    expect(printed.listen.port).toBe(9100);
    expect(printed.auth.token).toBe("(set)");
    await writeFile(good, "[listen]\nprot = 1\n");
    const bad = io();
    expect(await main(["config", good], bad.io)).toBe(1);
    expect(bad.err[0]).toMatch(/did you mean listen.port/);
  });
});
