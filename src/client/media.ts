/**
 * Pictures and QR codes: a string drawn as something to look at, never as markup.
 *
 * A picture is an image element whose source the page has vetted (`isAllowedImageSource`): http(s), a path
 * on this origin, or a `data:image/…` URI. It loads only if the host's CSP allows the source in
 * `img-src`; a picture that fails says so in words. QR codes are drawn by `qr-view.ts`, which
 * lives in the extras bundle with the encoder, so a panel without one never loads either.
 */
import type { ImageOptions } from "../types.js";
import { isAllowedImageSource } from "../values/display.js";
import { el } from "./dom.js";
import type { Translate } from "./i18n.js";

/** A picture, sized by attribute and class: the page's CSP forbids style attributes. */
export function drawImage(source: string, options: ImageOptions, t: Translate, compact = false): HTMLElement {
  if (!isAllowedImageSource(source)) return el("span", "apb-media-note", t("imageRefused"));
  const frame = el("span", compact ? "apb-media apb-media-compact" : "apb-media");
  const img = el("img", "apb-image");
  img.alt = options.alt;
  img.decoding = "async";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.dataset.fit = options.fit ?? "contain";
  img.height = options.height ?? (compact ? 32 : 160);
  img.addEventListener("error", () => frame.replaceChildren(el("span", "apb-media-note", t("imageFailed"))), { once: true });
  img.src = source.trim();
  frame.append(img);
  return frame;
}
