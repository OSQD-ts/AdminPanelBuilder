/**
 * A ready-made panel section for bothandlerjs: what the handler decides, the guard's refusals, and
 * the threshold worth changing live.
 *
 *   import { BotHandler } from "@osqd/bothandlerjs";
 *   import { botHandlerPanel } from "@osqd/admin-panel-builder/presets";
 *   botHandlerPanel(panel, handler, { applyChallengeScore: (score) => handler.setPolicy(…) });
 *
 * The handler is taken structurally — anything with `on("decision", …)` and `on("downgrade", …)` —
 * so this package imports nothing from bothandlerjs and cannot pin its version.
 */
import type { AdminPanel } from "../core.js";
import { rejectUnknown } from "../internal/options.js";

export interface BotHandlerLike {
  on(event: "decision", listener: (event: { assessment: { verdict: string; score: number }; decision: { action: string; rule?: string; reason?: string } }) => void): unknown;
  on(event: "downgrade", listener: (event: { decision: { action: string; rule?: string; reason?: string } }) => void): unknown;
}

export interface BotHandlerPanelOptions {
  /** Group names are prefixed with this. Default `""`: "Traffic", "Guard", "Policy". */
  prefix?: string | undefined;
  /** When given, the challenge threshold is offered for editing and handed here on change. */
  applyChallengeScore?: ((score: number) => void | Promise<void>) | undefined;
  /** The threshold the policy starts with. Default 60. */
  challengeScore?: number | undefined;
}

export function botHandlerPanel(panel: AdminPanel, handler: BotHandlerLike, options: BotHandlerPanelOptions = {}) {
  rejectUnknown(options, ["prefix", "applyChallengeScore", "challengeScore"], "botHandlerPanel()");
  const prefix = options.prefix ?? "";
  const traffic = `${prefix}Traffic`;
  const guard = `${prefix}Guard`;
  const verdicts: Record<string, number> = {};
  const actions: Record<string, number> = {};

  panel.group(traffic, { description: "Counted in this process since it started." });
  const assessed = panel.counter("Requests assessed", { group: traffic });
  const denied = panel.counter("Requests denied", { group: traffic });
  panel.viewable(() => ({ ...verdicts }), { label: "Verdicts", group: traffic, chart: { over: "keys" } });
  panel.viewable(() => ({ ...actions }), { label: "Actions taken", group: traffic, chart: { over: "keys" } });
  const denials = panel.feed("Recent denials", { group: traffic, capacity: 100, perSecond: 20 });

  panel.group(guard, { description: "The safety guard replaces a terminal action it cannot justify. Each downgrade is a rule that tried to do more than its evidence allowed; it is the number worth alerting on." });
  const downgrades = panel.counter("Downgrades", { group: guard, chart: "step" });
  const recentDowngrades = panel.feed("Recent downgrades", { group: guard, capacity: 50, perSecond: 10 });

  handler.on("decision", ({ assessment, decision }) => {
    assessed.inc();
    verdicts[assessment.verdict] = (verdicts[assessment.verdict] ?? 0) + 1;
    actions[decision.action] = (actions[decision.action] ?? 0) + 1;
    if (decision.action === "block" || decision.action === "drop") {
      denied.inc();
      denials.push({ action: decision.action, verdict: assessment.verdict, score: Math.round(assessment.score), rule: decision.rule ?? "default" }, "warn");
    }
  });
  handler.on("downgrade", ({ decision }) => {
    downgrades.inc();
    recentDowngrades.push({ to: decision.action, rule: decision.rule ?? "default", reason: decision.reason ?? "" }, "warn");
  });

  let challengeScore: ReturnType<AdminPanel["modifiable"]> | undefined;
  if (options.applyChallengeScore !== undefined) {
    const apply = options.applyChallengeScore;
    challengeScore = panel.modifiable(options.challengeScore ?? 60, {
      id: "challenge-score",
      label: "Challenge at score",
      group: `${prefix}Policy`,
      min: 1,
      max: 100,
      integer: true,
      confirm: true,
      chart: "step",
      description: "Suspicion at or above this is challenged rather than served. Lower catches more bots and challenges more people.",
      onChange: (next) => apply(next as number),
    });
  }
  return { assessed, denied, downgrades, denials, challengeScore };
}
