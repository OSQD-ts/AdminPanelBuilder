#!/usr/bin/env node
// The helpers kept identical across the OSQD repositories, compared with their siblings and with
// the shared package in ../OSQDInternal, wherever those are checked out beside this one.
//
//   npm run shared:check
//
// Not part of `npm run check` or CI, which see this repository alone. A sibling that is not checked
// out is skipped and said so, rather than counted as agreeing.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["clock.ts", "emitter.ts", "async.ts"];
const SIBLINGS = [
  ["hackerpot", join(root, "..", "HackerPot", "src", "internal")],
  ["bothandlerjs", join(root, "..", "BotHandler.js", "src", "internal")],
];
const body = (text) => text.split("\n").slice(1).join("\n");
let differences = 0;
for (const file of FILES) {
  const ours = readFileSync(join(root, "src", "internal", file), "utf8");
  for (const [name, directory] of SIBLINGS) {
    const path = join(directory, file);
    if (!existsSync(path)) {
      console.error(`skip  ${file} in ${name}: not checked out beside this repository`);
      continue;
    }
    const same = readFileSync(path, "utf8") === ours;
    if (!same) differences += 1;
    console.error(`${same ? "same " : "DIFF "} ${file} in ${name}`);
  }
  const shared = join(root, "..", "OSQDInternal", "src", file);
  if (existsSync(shared)) {
    // The shared copy's first line says it is the shared copy; everything after it must match.
    const same = body(readFileSync(shared, "utf8")) === body(ours);
    if (!same) differences += 1;
    console.error(`${same ? "same " : "DIFF "} ${file} in @osqd/internal`);
  }
}
if (differences > 0) {
  console.error(`\n${differences} cop${differences === 1 ? "y differs" : "ies differ"}. They are kept identical by hand until every repository imports @osqd/internal.`);
  process.exit(1);
}
