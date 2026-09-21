import { describe, expect, it } from "vitest";
import { CLIENT_SCRIPT } from "../src/client.generated.js";
import { AdminPanelConfigError } from "../src/index.js";
import { escapeHtml, scriptJson } from "../src/render/html.js";
import { panelAt } from "./helpers.js";

describe("the client bundle", () => {
  it("contains no way to put text into the document as markup, and nothing that ends its script element", () => {
    for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"]) expect(CLIENT_SCRIPT).not.toContain(sink);
    for (const sequence of ["</script", "<!--", "-->", "<script"]) expect(CLIENT_SCRIPT.toLowerCase()).not.toContain(sequence);
  });
});

describe("escaping", () => {
  it("makes JSON safe inside a script element, including the line separators old parsers choke on", () => {
    const text = scriptJson({ a: "</script>&\u2028\u2029" });
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(text)).toEqual({ a: "</script>&\u2028\u2029" });
  });

  it("escapes every character that could leave an attribute or start a tag", () => {
    expect(escapeHtml(`"'<>&`)).toBe("&#34;&#39;&#60;&#62;&#38;");
  });
});

describe("panel.html()", () => {
  it("with api carries no data at all, so the handler behind it decides what is shown", () => {
    const { panel } = panelAt();
    panel.viewable("private detail", { label: "Secret-ish", group: "Finance" });
    const html = panel.html({ api: "/admin/" });
    expect(html).not.toContain("private detail");
    expect(html).toContain('<link rel="stylesheet" href="/admin/panel.css">');
    expect(html).toContain('<script src="/admin/client.js" defer></script>');
    expect(html).toContain('data-api="/admin"');
    expect(html).not.toContain("<style");
  });

  it("as a snapshot carries the values inline, with the nonce a host CSP needs", () => {
    const { panel } = panelAt();
    panel.viewable(42, "Answer");
    const html = panel.html({ snapshot: true, nonce: "abc123" });
    expect(html).toContain('<style nonce="abc123">');
    expect(html).toContain('<script nonce="abc123">');
    expect(html).toContain('"value":42');
    expect(html).not.toContain("data-api");
  });

  it("as a snapshot withholds the groups it is told to leave out", () => {
    const { panel } = panelAt();
    panel.viewable("shown", { label: "a", group: "Public" });
    panel.viewable("withheld", { label: "b", group: "Private" });
    const html = panel.html({ snapshot: true, groups: ["Public"] });
    expect(html).toContain("shown");
    expect(html).not.toContain("withheld");
  });

  it("wraps a whole document when asked, without an inline style attribute", () => {
    const { panel } = panelAt(0, { title: "Report <1>" });
    panel.viewable(1, "a");
    const html = panel.html({ snapshot: true, document: true });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Report &#60;1&#62;</title>");
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("refuses to render a fragment that would never change, or one that is two things at once", () => {
    const { panel } = panelAt();
    expect(() => panel.html({})).toThrow(/without either it would never change/);
    expect(() => panel.html({ api: "/a", snapshot: true })).toThrow(/both api and snapshot/);
    expect(() => panel.html({ api: "javascript:alert(1)" })).toThrow(AdminPanelConfigError);
    expect(() => panel.html({ api: "/a", groups: ["x"] })).toThrow(/belong on the handler/);
    expect(() => panel.html({ snapshot: true, nonse: "x" } as never)).toThrow(/did you mean "nonce"/);
  });
});
