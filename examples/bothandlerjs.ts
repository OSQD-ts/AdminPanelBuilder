/**
 * A panel for bothandlerjs, built from the preset in `@osqd/admin-panel-builder/presets`.
 *
 *   npx tsx examples/bothandlerjs.ts
 *
 * With a real handler: `botHandlerPanel(panel, new BotHandler({ … }), { applyChallengeScore })`.
 * Here a simulated handler emits decisions at a steady rate, with the odd downgrade.
 */
import { createAdminPanel } from "../src/index.js";
import { botHandlerPanel, type BotHandlerLike } from "../src/presets/index.js";
import { isMain, runExample } from "./run.js";

export function buildBotPanel(options: { handler: BotHandlerLike; applyChallengeScore: (score: number) => void }) {
  const panel = createAdminPanel({ title: "bothandlerjs", theme: "osqd" });
  botHandlerPanel(panel, options.handler, { applyChallengeScore: options.applyChallengeScore });
  return { panel };
}

/** Stands in for a real BotHandler. */
export function simulatedHandler(): BotHandlerLike & { emitSome(): void } {
  const listeners: Record<string, Array<(event: never) => void>> = {};
  const verdicts = ["human", "human", "human", "good-bot", "suspicious", "bad-bot"];
  return {
    on(event: string, listener: (event: never) => void) {
      (listeners[event] ??= []).push(listener);
      return () => undefined;
    },
    emitSome() {
      for (let i = 0; i < 10 + Math.random() * 30; i += 1) {
        const verdict = verdicts[Math.floor(Math.random() * verdicts.length)] as string;
        const action = verdict === "bad-bot" ? "block" : verdict === "suspicious" ? "challenge" : "allow";
        for (const listener of listeners.decision ?? []) listener({ assessment: { verdict, score: Math.random() * 100 }, decision: { action, rule: verdict === "bad-bot" ? "known-scrapers" : "default" } } as never);
      }
      if (Math.random() < 0.05) for (const listener of listeners.downgrade ?? []) listener({ decision: { action: "challenge", rule: "aggressive-block", reason: "no certain evidence" } } as never);
    },
  } as BotHandlerLike & { emitSome(): void };
}

if (isMain(import.meta.url)) {
  const handler = simulatedHandler();
  const { panel } = buildBotPanel({ handler, applyChallengeScore: (score) => console.error(`policy: challenge at ${score}`) });
  await runExample(panel, () => handler.emitSome(), Number(process.env.PORT ?? 9783));
}
