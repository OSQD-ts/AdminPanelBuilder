import { describe, expect, it } from "vitest";
import { botHandlerPanel, hackerpotPanel } from "../src/presets/index.js";
import { panelAt } from "./helpers.js";

function emitter<T>() {
  const listeners = new Map<string, Array<(event: T) => void>>();
  return {
    on(event: string, listener: (event: T) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit(event: string, payload: T) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
}

describe("the bothandlerjs preset", () => {
  it("counts decisions and denials, lists denials, and hands a changed threshold to the policy", () => {
    const { panel } = panelAt();
    const handler = emitter<never>();
    const applied: number[] = [];
    const section = botHandlerPanel(panel, handler as never, { applyChallengeScore: (score) => void applied.push(score) });
    handler.emit("decision", { assessment: { verdict: "bad-bot", score: 90 }, decision: { action: "block", rule: "r1" } } as never);
    handler.emit("decision", { assessment: { verdict: "human", score: 1 }, decision: { action: "allow" } } as never);
    handler.emit("downgrade", { decision: { action: "challenge" } } as never);
    expect([section.assessed.total.value, section.denied.total.value, section.downgrades.total.value]).toEqual([2, 1, 1]);
    expect(panel.state().feeds["recent-denials"]?.entries[0]?.text).toContain("action=block");
    panel.edit("challenge-score", 40, "ada", { groups: undefined, edit: true, actions: false, restrictions: [] });
    expect(applied).toEqual([40]);
    panel.close();
  });
});

describe("the hackerpot preset", () => {
  it("counts hits by detector, lists sources in a table, and offers detector switches", async () => {
    const { panel } = panelAt();
    const engine = emitter<never>();
    const { enabled } = hackerpotPanel(panel, engine as never, ["decoy-path", "sql-injection"]);
    engine.emit("hit", { ip: "203.0.113.9", path: "/.env", score: 60, detections: [{ detector: "decoy-path" }] } as never);
    const scope = { groups: undefined, edit: true, actions: true, restrictions: [] };
    const sources = await panel.tableRows("sources", {}, scope);
    expect(sources?.rows[0]).toMatchObject({ id: "203.0.113.9", cells: { hits: 1, score: 60 }, status: { score: "warn" } });
    panel.edit("decoy-path", false, "ada", scope);
    expect(enabled["decoy-path"]).toBe(false);
    panel.close();
  });
});
