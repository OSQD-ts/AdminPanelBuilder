/**
 * Ids derived from labels.
 *
 * An id is what the API's paths, the store's keys and the page's element ids are built from, so
 * it is restricted to characters that are safe in all three without escaping. A caller's own
 * id is checked against the same pattern rather than slugged, because silently rewriting an id
 * somebody chose is how a stored value stops matching the declaration it belongs to.
 */
import { AdminPanelConfigError } from "../errors.js";

export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** Letters Unicode does not decompose into a base letter and a mark, so NFKD alone would drop them. */
const LETTERS: Readonly<Record<string, string>> = { ł: "l", Ł: "l", ø: "o", Ø: "o", ß: "ss", đ: "d", Đ: "d", æ: "ae", Æ: "ae", œ: "oe", Œ: "oe", þ: "th", ð: "d", ı: "i" };

export function slug(text: string): string {
  return text
    .replace(/[łŁøØßđĐæÆœŒþðı]/g, (letter) => LETTERS[letter] ?? letter)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

export function checkId(id: string, what: string): string {
  if (!ID_PATTERN.test(id)) throw new AdminPanelConfigError(`${what} has the id ${JSON.stringify(id)}; an id is 1 to 64 letters, digits, dots, hyphens and underscores, starting with a letter or digit`);
  return id;
}
