import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The browser suite has its own config and its own command; it needs a browser binary,
    // so it must not fail `npm test` on a checkout that has not installed one.
    exclude: ["tests/browser/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/index.ts",
        "src/**/types.ts",
        // The generated bundle is a string; the served page is asserted on as text.
        "src/client.generated.ts",
        // The browser half needs a document. Its pure modules (format, geometry) are
        // unit-tested and stay counted; the rest is measured by `npm run test:browser`.
        "src/element/**",
        "src/client/{dom,api,app,render,editors,charts,changes,boot,blocks,cards,activity,palette,announce,table,extras,registry,view-deps}.ts",
        // Three lines that run the command line in a process; tests/cli-process.test.ts runs it there.
        "src/apb.ts",
      ],
      reporter: ["text-summary", "text", "json-summary"],
      // A point under what the suite measures, so a change that drops coverage fails CI.
      thresholds: { lines: 94, statements: 89, functions: 91, branches: 82 },
    },
  },
});
