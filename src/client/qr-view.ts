/**
 * A QR code drawn from a string, with the text it encodes beside it and a button that copies it,
 * so it is as useful to a screen reader as to a phone camera.
 *
 * Part of the extras bundle, with the encoder (`qr.ts`): it is most of the encoder's weight, and a
 * panel that shows no QR code never loads it. The main bundle reaches it through `registry.ts`.
 */
import type { QrOptions } from "../types.js";
import { el } from "./dom.js";
import type { Translate } from "./i18n.js";
import { encodeQr, type QrMatrix } from "./qr.js";

/** A QR code with its text and a copy button; in a table, the code alone, named for screen readers. */
export function drawQr(text: string, options: QrOptions | undefined, t: Translate, compact = false): HTMLElement {
  const figure = el("figure", compact ? "apb-qr apb-qr-compact" : "apb-qr");
  const matrix = encodeQr(text, options?.level ?? "M");
  if (matrix === undefined) {
    figure.append(el("span", "apb-qr-text", text), el("span", "apb-media-note", t("qrTooLong")));
    return figure;
  }
  const svg = qrSvg(figure.ownerDocument, matrix);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("qrCode", { text }));
  figure.append(svg);
  if (compact) return figure;
  const caption = el("figcaption", "apb-qr-caption");
  const words = el("span", "apb-qr-text", text);
  const copy = el("button", "apb-tool apb-qr-copy", t("copyText"));
  copy.type = "button";
  copy.addEventListener("click", () => {
    const done = (): void => {
      copy.textContent = t("copiedText");
      setTimeout(() => {
        copy.textContent = t("copyText");
      }, 1500);
    };
    // Not every context grants the clipboard; the text is selectable either way.
    void globalThis.navigator?.clipboard?.writeText(text).then(done, () => undefined);
  });
  caption.append(words, copy);
  figure.append(caption);
  return figure;
}

const SVG = "http://www.w3.org/2000/svg";

/**
 * The matrix as an SVG drawn with createElementNS: one path of unit squares, a four-module quiet
 * zone, `currentColor` on the page's surface. Labelled for screen readers by the caller.
 */
function qrSvg(doc: Document, matrix: QrMatrix): SVGSVGElement {
  const quiet = 4;
  const full = matrix.size + quiet * 2;
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${full} ${full}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("class", "apb-qr-svg");
  const background = doc.createElementNS(SVG, "rect");
  background.setAttribute("width", String(full));
  background.setAttribute("height", String(full));
  background.setAttribute("class", "apb-qr-light");
  const path = doc.createElementNS(SVG, "path");
  let d = "";
  matrix.modules.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    });
  });
  path.setAttribute("d", d);
  path.setAttribute("class", "apb-qr-dark");
  svg.append(background, path);
  return svg;
}
