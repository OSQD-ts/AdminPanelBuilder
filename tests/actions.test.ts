import { describe, expect, it } from "vitest";
import type { PanelScope } from "../src/index.js";
import { panelAt } from "./helpers.js";

const scope: PanelScope = { groups: undefined, edit: false, actions: true, restrictions: [] };

describe("running an action", () => {
  it("reports what the function returned, and records who ran it", async () => {
    const { panel } = panelAt();
    panel.action("Flush cache", ({ by }) => `flushed for ${by}`);
    expect(await panel.run("flush-cache", "ada", scope)).toEqual({ ok: true, message: "flushed for ada" });
    expect(panel.changes()[0]).toMatchObject({ kind: "action", target: "flush-cache", by: "ada", ok: true, outcome: "flushed for ada" });
  });

  it("says it finished when the function returns nothing to say", async () => {
    const { panel } = panelAt();
    panel.action("Reload", async () => undefined);
    expect(await panel.run("reload", "ada", scope)).toEqual({ ok: true, message: "Reload finished." });
  });

  it("turns a throw or a rejection into a failure sentence, never into a rejection", async () => {
    const { panel } = panelAt();
    panel.action("Broken", () => {
      throw new Error("no connection");
    });
    panel.action("Rejects", () => Promise.reject(new Error("timeout upstream")));
    expect(await panel.run("broken", "ada", scope)).toMatchObject({ ok: false, message: "Broken failed: no connection" });
    expect(await panel.run("rejects", "ada", scope)).toMatchObject({ ok: false, message: "Rejects failed: timeout upstream" });
    expect(panel.changes().map((change) => change.ok)).toEqual([false, false]);
  });

  it("answers at its deadline and aborts the signal it handed over", async () => {
    const { panel } = panelAt();
    let aborted = false;
    panel.action(
      "Slow",
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          setTimeout(resolve, 1000).unref();
        }),
      { timeoutMs: 20 },
    );
    const outcome = await panel.run("slow", "ada", scope);
    expect(outcome).toMatchObject({ ok: false, message: "Slow failed: Slow did not finish within 20ms" });
    expect(aborted).toBe(true);
  });

  it("does not exist for a listener whose groups leave it out", async () => {
    const { panel } = panelAt();
    panel.action("Hidden", () => "ran", { group: "Private" });
    expect(await panel.run("hidden", "ada", { ...scope, groups: new Set(["Public"]) })).toMatchObject({ ok: false, reason: "not-found" });
  });

  it("is refused at declaration when it could not work as declared", () => {
    const { panel } = panelAt();
    expect(() => panel.action("x", "not a function" as never)).toThrow(/needs a function/);
    expect(() => panel.action("y", () => undefined, { timeoutMs: 0 })).toThrow(/positive number of milliseconds/);
    panel.action("Dup", () => undefined);
    expect(() => panel.action("Dup", () => undefined)).toThrow(/two actions have the id "dup"/);
  });

  it("makes a destructive action ask for confirmation", () => {
    const { panel } = panelAt();
    panel.action("Purge", () => undefined, { destructive: true });
    expect(panel.schema().groups[0]?.items[0]).toMatchObject({ type: "action", destructive: true, confirm: true });
  });
});
