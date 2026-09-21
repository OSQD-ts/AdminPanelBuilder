import { defineConfig } from "vitest/config";

// The browser suite, kept apart from `npm test` on purpose.
//
// It needs a browser binary that a fresh checkout does not have, and a default suite that
// fails until somebody runs `npx playwright install` is a suite people learn to skip. Run it
// with `npm run test:browser`; CI runs it in a job that installs the browser first.
//
// Single-threaded, because each test drives a real page against one shared demo server.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/browser/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: "forks",
    fileParallelism: false,
  },
});
