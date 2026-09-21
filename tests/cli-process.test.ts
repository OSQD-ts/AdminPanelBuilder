/** `apb` as a real process, the way a script runs it: stdout carries the answer, stderr the conversation. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { listenPanel } from "../src/adapters/index.js";
import { createAdminPanel } from "../src/index.js";
import { TOKEN } from "./helpers.js";

const run = promisify(execFile);

describe("apb as a process", () => {
  it("prints its version and help, and writes a value to stdout with nothing else", async () => {
    const version = await run(process.execPath, ["--import", "tsx", "src/apb.ts", "--version"]);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const help = await run(process.execPath, ["--import", "tsx", "src/apb.ts", "--help"]);
    for (const command of ["get", "set", "run", "apply", "changes"]) expect(help.stdout).toContain(`apb ${command}`);
    const panel = createAdminPanel();
    panel.viewable(42, "Answer");
    const server = await listenPanel(panel, { port: 0, auth: { token: TOKEN } });
    try {
      const answer = await run(process.execPath, ["--import", "tsx", "src/apb.ts", "get", server.url, "answer"], { env: { ...process.env, PANEL_TOKEN: TOKEN } });
      expect(answer.stdout).toBe("42\n");
      expect(answer.stderr).toBe("");
    } finally {
      await server.close();
    }
  }, 30_000);

  it("exits 2 with the reason on stderr for bad arguments", async () => {
    const failed = await run(process.execPath, ["--import", "tsx", "src/apb.ts", "set", "http://127.0.0.1:1", "a", "1", "--for", "later"]).catch((error: { code: number; stderr: string }) => error);
    expect((failed as { code: number }).code).toBe(2);
    expect((failed as { stderr: string }).stderr).toMatch(/--for takes a time/);
  }, 30_000);
});
