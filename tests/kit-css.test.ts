/**
 * The component kit as the page uses it: which of its rules travel (scripts/kit-css.mjs), and the
 * table that puts its classes beside the panel's own (src/client/kit.ts).
 */
import { describe, expect, it } from "vitest";
import { KIT_CLASSES, withKit } from "../src/client/kit.js";
import { KIT_CSS } from "../src/render/kit-css.generated.js";
// @ts-expect-error -- a plain .mjs build script, with no declarations of its own.
import { blocks, kitClassesIn, pruneKitCss, selectors, stripComments } from "../scripts/kit-css.mjs";

describe("keeping the kit's rules the page uses", () => {
  const used = new Set(["oq", "oq-btn", "oq-danger"]);

  it("keeps a rule only for selectors whose kit classes are all used", () => {
    const css = ".oq-btn { a: 1 }\n.oq-btn.oq-sm { b: 2 }\n.oq-btn, .oq-chip { c: 3 }\n.oq-danger.oq-btn--outline { d: 4 }";
    expect(pruneKitCss(css, used)).toBe(".oq-btn {a: 1}\n.oq-btn {c: 3}\n");
  });

  it("drops the kit's theme rules and selectors that name no kit class", () => {
    const css = ':root, :host, [data-theme="dark"] { --oq-bg: #000 }\n:host([data-theme="x"]) { --oq-bg: #111 }\n[data-tip]::after { e: 5 }\nbody .oq-btn { f: 6 }';
    expect(pruneKitCss(css, used)).toBe("body .oq-btn {f: 6}\n");
  });

  it("keeps an @media block only when something in it is kept", () => {
    const css = "@media (hover: hover) { .oq-btn:hover { a: 1 } .oq-chip:hover { b: 2 } }\n@media (pointer: coarse) { .oq-chip { c: 3 } }";
    expect(pruneKitCss(css, used)).toBe("@media (hover: hover) {\n.oq-btn:hover {a: 1}\n}\n");
  });

  it("keeps keyframes that a kept rule names, and only those", () => {
    const css = ".oq-btn { animation: oq-spin 1s linear infinite }\n.oq-chip { animation: oq-pulse 1s }\n@keyframes oq-spin { to { rotate: 1turn } }\n@keyframes oq-pulse { to { opacity: 0 } }";
    const out = pruneKitCss(css, used);
    expect(out).toContain("@keyframes oq-spin");
    expect(out).not.toContain("oq-pulse");
  });

  it("splits selector lists at their own commas only, and keeps strings and their braces intact", () => {
    expect(selectors(".oq :is(a, b), .oq-btn")).toEqual([".oq :is(a, b)", ".oq-btn"]);
    expect(blocks('.oq-btn::after { content: "}"; }').map((block: { prelude: string }) => block.prelude)).toEqual([".oq-btn::after"]);
    expect(stripComments('/* x */.a { content: "/* not a comment */" }')).toBe('.a { content: "/* not a comment */" }');
  });

  it("reads the kit classes a source names, modifiers included", () => {
    expect([...kitClassesIn('el("div", "apb-root oq"); "oq-btn--outline oq-danger" + "oq-card__tools"')].sort()).toEqual(["oq", "oq-btn--outline", "oq-card__tools", "oq-danger"]);
  });
});

describe("the panel's classes and the kit's", () => {
  it("adds the kit's classes after the panel's own, once each", () => {
    expect(withKit("apb-button apb-button-destructive")).toBe("apb-button apb-button-destructive oq-btn oq-btn--outline oq-danger");
    expect(withKit("apb-tool apb-tool-destructive")).toBe("apb-tool apb-tool-destructive oq-btn oq-btn--outline oq-neutral oq-sm oq-danger");
    expect(withKit("apb-grid")).toBe("apb-grid");
  });

  it("names only kit classes the stylesheet has rules for, so no mapping is a class that does nothing", () => {
    const missing = [...new Set(Object.values(KIT_CLASSES).flatMap((classes) => classes.split(" ")))].filter((name) => !name.startsWith("is-") && !new RegExp(`\\.${name}(?![a-z0-9_-])`).test(KIT_CSS));
    expect(missing).toEqual([]);
  });
});
