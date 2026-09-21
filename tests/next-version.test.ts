/** How a push to main becomes a version: scripts/next-version.mjs, which the publish workflow runs. */
import { describe, expect, it } from "vitest";

type Script = {
  classify(message: string): string;
  nextVersion(current: string, commits: string[], say?: (line: string) => void, options?: { unreleased?: boolean }): string | undefined;
  baseVersion(packageVersion: string, tag: string | undefined): string;
};
// Loaded by URL: the script is plain JavaScript run by Node in CI, outside the typed project.
const script = (await import(new URL("../scripts/next-version.mjs", import.meta.url).href)) as Script;

describe("the next version", () => {
  it("reads a commit's kind from its header and footers", () => {
    expect(["feat: a", "fix(x): b", "perf: c", "docs: d", "feat!: e", "chore: f\n\nBREAKING CHANGE: g", "unprefixed"].map(script.classify)).toEqual(["patch", "patch", "patch", "none", "major", "major", "none"]);
  });

  it("bumps a released version, with a breaking change landing on the minor while 0.x", () => {
    expect(script.nextVersion("0.1.0", ["fix: a"])).toBe("0.1.1");
    expect(script.nextVersion("0.1.0", ["feat!: a"])).toBe("0.2.0");
    expect(script.nextVersion("1.2.3", ["feat!: a"])).toBe("2.0.0");
    expect(script.nextVersion("0.1.0", ["docs: a"])).toBeUndefined();
  });

  it("publishes a never-released version as it stands, so a new package starts where its changelog says", () => {
    expect(script.nextVersion("0.1.0", ["feat: first"], undefined, { unreleased: true })).toBe("0.1.0");
    expect(script.nextVersion("0.1.0", ["docs: only"], undefined, { unreleased: true })).toBeUndefined();
    expect(script.nextVersion("0.1.0", ["feat: first\n\nRelease-As: 0.1.0"], undefined, { unreleased: true })).toBe("0.1.0");
    expect(() => script.nextVersion("0.1.0", ["feat: again\n\nRelease-As: 0.1.0"])).toThrow(/not ahead/);
  });

  it("honours a Release-As footer, refusing one that goes backwards or is not a version", () => {
    expect(script.nextVersion("0.1.3", ["fix: a\n\nRelease-As: 1.0.0"])).toBe("1.0.0");
    expect(script.nextVersion("0.1.3", ["fix: a\n\nRelease-As: minor"])).toBe("0.2.0");
    expect(() => script.nextVersion("0.1.3", ["fix: a\n\nRelease-As: soon"])).toThrow(/neither a version nor a bump/);
  });

  it("builds on a tag that is ahead of package.json", () => {
    expect(script.baseVersion("0.1.0", "v1.2.0")).toBe("1.2.0");
    expect(script.baseVersion("0.3.0", "v0.2.0")).toBe("0.3.0");
    expect(script.baseVersion("0.1.0", undefined)).toBe("0.1.0");
  });
});
