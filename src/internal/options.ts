/**
 * Refusing option keys nobody reads.
 *
 * TypeScript catches `{ contorls: { edit: true } }` in a typed call, and nothing catches it in
 * JavaScript, in an options object assembled at run time, or behind a cast. The result is the
 * failure this library is built to refuse: a listener that looks configured to allow editing
 * and does not, with nothing to say so. Every options object the public API takes is checked
 * against the keys that are actually read, and an unknown one is an error naming it.
 */
import { AdminPanelConfigError } from "../errors.js";

export function rejectUnknown(options: object | undefined, known: readonly string[], where: string): void {
  if (options === undefined || options === null) return;
  for (const key of Object.keys(options)) {
    if (known.includes(key)) continue;
    const near = known.find((candidate) => distance(candidate.toLowerCase(), key.toLowerCase()) <= 2);
    throw new AdminPanelConfigError(`${where} has an option "${key}" that nothing reads${near === undefined ? "" : ` (did you mean "${near}"?)`}; an unknown option is refused rather than ignored, because ignoring it leaves the default in place without a word`);
  }
}

/** Levenshtein distance, for the suggestion. Option names are short, so the quadratic table is nothing. */
function distance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] as number;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] as number;
      previous[j] = Math.min(above + 1, (previous[j - 1] as number) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length] as number;
}
