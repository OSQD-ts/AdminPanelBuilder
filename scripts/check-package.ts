/**
 * Packs the package, installs the tarball into an empty project, and loads every entry in
 * `exports` there, each in its own process: imported as ESM and, where the entry offers it,
 * required as CommonJS. Adapted from hackerpot.
 *
 * Every test imports `src/` directly, so a broken `exports` map, a CommonJS build that throws on
 * load, or an entry pointing at a file the build stopped emitting leaves the whole suite green.
 * This is the check that looks at what a consumer actually installs. The element entry is loaded
 * under Node on purpose: a custom element that extends `HTMLElement` at module scope throws on
 * import in any server-rendered framework, and would be present, listed, type-checked and
 * unusable.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; exports: Record<string, string | Record<string, string>> };
const work = mkdtempSync(join(tmpdir(), "apb-package-"));
const failures: string[] = [];

try {
  const tarball = execFileSync("npm", ["pack", "--silent", "--pack-destination", work], { cwd: root, encoding: "utf8" }).trim().split("\n").pop() as string;
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  execFileSync("npm", ["install", "--silent", "--no-audit", "--no-fund", join(work, tarball)], { cwd: work, stdio: "inherit" });

  for (const [entry, target] of Object.entries(pkg.exports)) {
    if (entry === "./package.json" || typeof target === "string") continue;
    const specifier = entry === "." ? pkg.name : `${pkg.name}/${entry.slice(2)}`;
    const probes: Array<[string, string]> = [["import", `const m = await import(${JSON.stringify(specifier)}); if (Object.keys(m).length === 0) throw new Error("no exports");`]];
    if (target.require !== undefined) probes.push(["require", `const m = require(${JSON.stringify(specifier)}); if (Object.keys(m).length === 0) throw new Error("no exports");`]);
    for (const [how, code] of probes) {
      try {
        execFileSync(process.execPath, how === "import" ? ["--input-type=module", "-e", code] : ["-e", code], { cwd: work, stdio: "pipe" });
        console.error(`ok   ${how.padEnd(7)} ${specifier}`);
      } catch (error) {
        failures.push(`${how} ${specifier}: ${(error as { stderr?: Buffer }).stderr?.toString().trim() ?? String(error)}`);
      }
    }
  }
  // The binary a consumer's scripts run, as installed.
  try {
    const help = execFileSync(join(work, "node_modules", ".bin", "apb"), ["--help"], { cwd: work, encoding: "utf8" });
    if (!help.includes("apb get")) failures.push("apb --help does not list its commands");
    else console.error("ok   bin     apb --help");
  } catch (error) {
    failures.push(`apb --help: ${(error as { stderr?: Buffer }).stderr?.toString().trim() ?? String(error)}`);
  }
  // The declarations a consumer's editor reads must exist for every entry.
  for (const [entry, target] of Object.entries(pkg.exports)) {
    if (typeof target === "string" || target.types === undefined) continue;
    try {
      readFileSync(join(work, "node_modules", pkg.name, target.types));
    } catch {
      failures.push(`${entry}: ${target.types} is not in the package`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s) with the packed package:\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
  process.exit(1);
}
console.error("The packed package installs, and every entry loads.");
