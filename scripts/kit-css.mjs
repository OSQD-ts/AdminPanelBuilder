/**
 * Keeps the rules of the component kit's stylesheet that a page uses.
 *
 * The kit's stylesheet styles every component it has; the panel uses a few dozen of them, and the
 * page is sent whole on every load. This walks the stylesheet's blocks and keeps a rule only for
 * the selectors whose `oq-` classes are all in `used`. Also dropped, whatever they name:
 *
 *   - the kit's own theme rules (`:root`, `:host`, `[data-theme…]` on their own): the panel's
 *     themes supply every `--oq-*` value through src/themes/kit-bridge.ts, scoped to the panel;
 *   - selectors that name no kit class at all (`[data-tip]`, a bare element): they would reach
 *     markup the kit does not own, here the panel's.
 *
 * Kept: `@media`/`@supports`/`@container` blocks with at least one rule left, and `@keyframes`
 * that a kept rule names. A small parser, not a general one: it understands the kit's stylesheet,
 * which is plain CSS with no nesting, and tests/kit-css.test.ts holds it to that.
 */

/** Removes comments, leaving strings alone (the kit's `content: "…"` values). */
export function stripComments(css) {
  let out = "";
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const end = css.indexOf(ch, i + 1);
      const stop = end === -1 ? css.length : end + 1;
      out += css.slice(i, stop);
      i = stop - 1;
    } else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
    } else out += ch;
  }
  return out;
}

/** Top-level blocks: `{ prelude, body }`, where body is the text between the outer braces. */
export function blocks(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  let quote = null;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote !== null) {
      if (ch === quote && css[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") {
      if (depth === 0) open = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        out.push({ prelude: css.slice(start, open).trim(), body: css.slice(open + 1, i) });
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      // A statement at-rule (`@import`, `@charset`): nothing the page needs from the kit.
      start = i + 1;
    }
  }
  return out;
}

/** Splits a selector list at its top-level commas (not the ones inside `:is(…)`). */
export function selectors(list) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

const KIT_CLASS = /\.(oq(?:-[a-z0-9_-]+)?)(?![a-z0-9_-])/gi;
const THEME_SCOPE = /^(?::root|:host(?:\([^)]*\))?|\[data-theme(?:=[^\]]*)?\])$/;

/** The kit classes a selector needs, or null when the selector must go whatever is used. */
function needs(selector) {
  if (THEME_SCOPE.test(selector)) return null;
  const classes = [...selector.matchAll(KIT_CLASS)].map((match) => match[1]);
  return classes.length === 0 ? null : classes;
}

/** Every kit class named in some text: the panel's sources, for `used`. */
export function kitClassesIn(text) {
  return new Set([...text.matchAll(/(?<![a-z0-9_-])(oq(?:-[a-z0-9_]+(?:-[a-z0-9_]+)*(?:--?[a-z0-9_]+)*)?)(?![a-z0-9_-])/gi)].map((match) => match[1]));
}

function prune(css, used, keptAnimations) {
  const out = [];
  for (const { prelude, body } of blocks(css)) {
    if (prelude.startsWith("@keyframes")) {
      out.push({ keyframes: prelude.slice("@keyframes".length).trim(), text: `${prelude} {${body}}` });
      continue;
    }
    if (prelude.startsWith("@")) {
      const inner = prune(body, used, keptAnimations);
      if (inner.some((part) => part.keyframes === undefined)) out.push({ text: `${prelude} {\n${inner.map((part) => part.text).join("\n")}\n}` });
      continue;
    }
    const kept = selectors(prelude).filter((selector) => {
      const classes = needs(selector);
      return classes !== null && classes.every((name) => used.has(name));
    });
    if (kept.length === 0) continue;
    for (const match of body.matchAll(/animation(?:-name)?\s*:\s*([^;]+)/g)) for (const word of match[1].split(/[\s,]+/)) keptAnimations.add(word);
    out.push({ text: `${kept.join(", ")} {${body.trim().replace(/\s*\n\s*/g, " ")}}` });
  }
  return out;
}

/** The rules of `css` that `used` needs, as one stylesheet. */
export function pruneKitCss(css, used) {
  const animations = new Set();
  const parts = prune(stripComments(css), used, animations);
  // Keyframes last are still found: @keyframes applies wherever it sits in the sheet.
  const rules = parts.filter((part) => part.keyframes === undefined).map((part) => part.text);
  const frames = parts.filter((part) => part.keyframes !== undefined && animations.has(part.keyframes)).map((part) => part.text);
  return `${[...rules, ...frames].join("\n")}\n`;
}
