/**
 * The performance ratchet for the write path and the read path.
 *
 * Budgets are ratios against a reference loop measured in the same process seconds earlier, never
 * absolute microseconds: a CI runner half as fast as a laptop runs both halves at half speed, so the
 * ratio stays put and moves only when the code does. Each budget sits at roughly twice the top of the
 * range measured when it was set — a guard, not a tripwire; a budget tight enough to fire on noise
 * gets raised until it stops firing, and then it is not a guard at all.
 *
 *   npm run bench:guard
 */
import { cases, ITERATIONS, measure, readCases, reference } from "./bench-cases.js";

/**
 * Measured over three runs on the machine this was written on (median of seven rounds each):
 * plain set 0.49–0.54, charted 0.68–0.77, shared chart 0.67–0.74, constrained 0.57–0.65,
 * counter 0.53–0.57, percentile 0.03–0.04, feed push 1.19–1.51. Each budget is about twice the top.
 */
const BUDGETS: Record<string, number> = {
  "set a plain value": 1.1,
  "set a charted value": 1.6,
  "set a value on a shared chart": 1.6,
  "set a constrained modifiable": 1.3,
  "counter.inc()": 1.2,
  "record a percentile observation": 0.1,
  "push a feed entry": 3,
  // Read path, per call: how many iterations of the reference loop one call costs. A read of a
  // 1,000-value panel costs about what a thousand writes do, which is why pages poll and the
  // application never waits on them. Measured when set: schema 1600–1760, state 1220–1260, a tick
  // for 20 viewers 910–1000 — less than one state(), because the frame is computed once and shared.
  // Unshared it would be twenty of them; the budget is what catches that coming back.
  "schema() over 1,000 values": 3500,
  "state() over 1,000 values": 2500,
  "a stream tick for 20 viewers": 2000,
};

const yardstick = measure(reference, ITERATIONS);
const failures: string[] = [];
for (const benchCase of [...cases(), ...readCases()]) {
  const iterations = benchCase.iterations ?? ITERATIONS;
  // A heavier case runs fewer iterations; per iteration against the reference's per iteration.
  const ratio = measure(benchCase.run, iterations) / iterations / (yardstick / ITERATIONS);
  const budget = BUDGETS[benchCase.name];
  if (budget === undefined) {
    failures.push(`${benchCase.name} has no budget; add one at about twice the ratio it measures (${ratio.toFixed(3)})`);
    continue;
  }
  const verdict = ratio <= budget ? "ok  " : "SLOW";
  console.error(`${verdict} ${benchCase.name.padEnd(36)} ${ratio < 10 ? ratio.toFixed(3) : ratio.toFixed(0)} of the reference (budget ${budget})`);
  if (ratio > budget) failures.push(`${benchCase.name}: ${ratio.toFixed(3)} > ${budget}`);
}
if (failures.length > 0) {
  console.error(`\n${failures.join("\n")}\n\nEither something on the write path got materially slower, or the budget is genuinely wrong for a change that was worth making — in which case raise it and say why in the commit.`);
  process.exit(1);
}
