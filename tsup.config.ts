import { defineConfig } from "tsup";

const shared = {
  format: ["esm", "cjs"] as const,
  dts: false,
  sourcemap: true,
  target: "es2022",
  splitting: false,
};

// One entry per import path:
//
// - `src/index.ts`           → `@osqd/admin-panel-builder`: the panel, the declaration functions,
//                               the themes and the stores.
// - `src/adapters/index.ts`  → `@osqd/admin-panel-builder/adapters`: an edge deployment that
//                               imports only the Fetch adapter need not load `node:http`.
// - `src/themes/index.ts`    → `@osqd/admin-panel-builder/themes`: the themes alone, for a build
//                               step that renders a stylesheet without a panel.
// - `src/presets/index.ts`   → `@osqd/admin-panel-builder/presets`: bothandlerjs and hackerpot sections.
// - `src/cli.ts`             → `@osqd/admin-panel-builder/cli`; `bin/apb.mjs` imports it.
// - `src/config/index.ts`   → `@osqd/admin-panel-builder/config`: listener settings from TOML and the environment.
// - `src/testing.ts`         → `@osqd/admin-panel-builder/testing`: testPanel() for applications' own tests.
// - `src/sdk.ts`             → `@osqd/admin-panel-builder/client`: the HTTP API as typed calls.
// - `src/react.ts`, `src/vue.ts` → wrappers around the element, browser code like it.
// - `src/element/index.ts`   → `@osqd/admin-panel-builder/element`, `<admin-panel>`.
//
// LOAD-BEARING ORDERING: `clean: true` on the first config only. tsup runs array configs
// sequentially, so the first cleans dist/ before the second writes. If that ever ran
// concurrently the clean could wipe the element bundle, intermittently shipping a package
// whose `./element` export points at nothing. Keep clean on exactly the first config.
export default defineConfig([
  { entry: ["src/index.ts", "src/adapters/index.ts", "src/themes/index.ts", "src/presets/index.ts", "src/cli.ts", "src/sdk.ts", "src/testing.ts", "src/config/index.ts"], clean: true, ...shared },
  // Browser code, so ESM only and type-checked against the DOM. Kept off the root entry, which
  // must never pull in anything that needs a document.
  { entry: { element: "src/element/index.ts", react: "src/react.ts", vue: "src/vue.ts" }, format: ["esm"], platform: "browser", target: "es2020", dts: false, sourcemap: true, splitting: false, clean: false },
]);
