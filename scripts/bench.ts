/**
 * The exploratory report: each hot-path case in nanoseconds per call on this machine, and as a
 * ratio of the reference loop. No pass or fail; `npm run bench:guard` is the ratchet.
 *
 *   npm run bench
 */
import { cases, ITERATIONS, measure, reference } from "./bench-cases.js";

const yardstick = measure(reference, ITERATIONS);
console.log(`reference loop: ${((yardstick / ITERATIONS) * 1e6).toFixed(1)} ns per iteration`);
for (const benchCase of cases()) {
  const time = measure(benchCase.run, ITERATIONS);
  console.log(`${benchCase.name.padEnd(36)} ${((time / ITERATIONS) * 1e6).toFixed(1).padStart(8)} ns   ratio ${(time / yardstick).toFixed(3)}`);
}
