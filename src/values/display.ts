/**
 * How a value is shown, checked once at declaration: a format the page can write, a date format
 * `Intl` accepts, a zone that exists, a picture with words for those who cannot see it, a QR code
 * that fits. A misspelt zone or format that the page silently ignored would show the operator
 * times in a zone they did not choose while looking configured, so each is refused here instead.
 *
 * Pure and dependency-free: the browser client imports the limits from here too.
 */
import { AdminPanelConfigError } from "../errors.js";
import type { DateFormat, ImageOptions, QrOptions, TimeSettings, ValueFormat, ValueKind } from "../types.js";

export const VALUE_FORMATS: readonly ValueFormat[] = ["plain", "integer", "percent", "bytes", "duration", "timestamp", "image", "qr"];

/** The named date formats; anything else is `Intl.DateTimeFormat` options. */
export const DATE_FORMAT_NAMES = ["relative", "date", "time", "datetime", "datetime-seconds", "iso"] as const;

const DATE_OPTION_KEYS = new Set(["weekday", "era", "year", "month", "day", "hour", "minute", "second", "fractionalSecondDigits", "timeZoneName", "hour12", "hourCycle", "dateStyle", "timeStyle"]);

/** The shortest a picture may be drawn, in CSS pixels: smaller is a speck. */
export const MIN_IMAGE_HEIGHT = 24;
/** The tallest a picture may be drawn: taller than a card is a page, not a reading. */
export const MAX_IMAGE_HEIGHT = 480;
/** The longest alt text: a sentence, not a description of a painting. */
export const MAX_ALT_LENGTH = 200;
/** The largest QR code the page draws, version 10 (57 × 57 modules): larger stops reading off a screen. */
export const MAX_QR_VERSION = 10;
/** The most bytes a version-10 code holds at the lowest error correction; past it the page shows the text alone. */
export const MAX_QR_BYTES = 271;

/** An IANA zone `Intl` knows, or a refusal naming it. */
export function checkTimeZone(where: string, timeZone: unknown): string {
  if (typeof timeZone !== "string" || timeZone === "") throw new AdminPanelConfigError(`${where} has a timeZone of ${JSON.stringify(timeZone)}; it is an IANA zone such as "Europe/Warsaw" or "UTC"`);
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new AdminPanelConfigError(`${where} has a timeZone of "${timeZone}", which is not a zone this runtime knows; use an IANA name such as "Europe/Warsaw" or "UTC"`);
  }
  return timeZone;
}

/** A BCP 47 tag `Intl` can write dates in. */
export function checkDateLocale(where: string, locale: unknown): string {
  if (typeof locale !== "string" || locale === "") throw new AdminPanelConfigError(`${where} has a dateLocale of ${JSON.stringify(locale)}; it is a language tag such as "en-GB"`);
  let supported: string[];
  try {
    supported = Intl.DateTimeFormat.supportedLocalesOf([locale]);
  } catch {
    throw new AdminPanelConfigError(`${where} has a dateLocale of "${locale}", which is not a valid language tag`);
  }
  if (supported.length === 0) throw new AdminPanelConfigError(`${where} has a dateLocale of "${locale}", which this runtime cannot write dates in`);
  return locale;
}

/** A named date format, or `Intl.DateTimeFormat` options that `Intl` accepts. */
export function checkDateFormat(where: string, format: unknown): DateFormat {
  if (typeof format === "string") {
    if ((DATE_FORMAT_NAMES as readonly string[]).includes(format)) return format as DateFormat;
    throw new AdminPanelConfigError(`${where} has a dateFormat of "${format}"; it is one of ${DATE_FORMAT_NAMES.map((name) => `"${name}"`).join(", ")}, or Intl.DateTimeFormat options`);
  }
  if (format === null || typeof format !== "object" || Array.isArray(format)) throw new AdminPanelConfigError(`${where} has a dateFormat that is neither a format name nor an options object`);
  const unknown = Object.keys(format).filter((key) => !DATE_OPTION_KEYS.has(key));
  if (unknown.length > 0) throw new AdminPanelConfigError(`${where} has dateFormat options the page does not take: ${unknown.join(", ")} (the zone is the panel's timeZone, not a format option)`);
  if (Object.keys(format).length === 0) throw new AdminPanelConfigError(`${where} has an empty dateFormat object; name a format or give at least one option`);
  try {
    new Intl.DateTimeFormat("en", format as Intl.DateTimeFormatOptions).format(0);
  } catch (error) {
    throw new AdminPanelConfigError(`${where} has dateFormat options Intl refuses: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...(format as object) } as DateFormat;
}

/** The panel's time settings, each checked; absent ones stay absent. */
export function checkTimeSettings(options: { timeZone?: unknown; dateFormat?: unknown; dateLocale?: unknown }): TimeSettings {
  const settings: TimeSettings = {};
  if (options.timeZone !== undefined) settings.timeZone = checkTimeZone("the panel", options.timeZone);
  if (options.dateFormat !== undefined) settings.dateFormat = checkDateFormat("the panel", options.dateFormat);
  if (options.dateLocale !== undefined) settings.dateLocale = checkDateLocale("the panel", options.dateLocale);
  return settings;
}

export interface DisplayOptions {
  format?: unknown;
  dateFormat?: unknown;
  image?: unknown;
  qr?: unknown;
}

/** What a value or a column says about how it is shown, checked together, since each part depends on the format. */
export function checkDisplay(where: string, options: DisplayOptions, kind?: ValueKind): { format?: ValueFormat; dateFormat?: DateFormat; image?: ImageOptions; qr?: QrOptions } {
  const out: { format?: ValueFormat; dateFormat?: DateFormat; image?: ImageOptions; qr?: QrOptions } = {};
  if (options.format !== undefined) {
    if (typeof options.format !== "string" || !(VALUE_FORMATS as readonly string[]).includes(options.format)) {
      throw new AdminPanelConfigError(`${where} has a format of ${JSON.stringify(options.format)}; it is one of ${VALUE_FORMATS.map((name) => `"${name}"`).join(", ")}`);
    }
    out.format = options.format as ValueFormat;
  }
  if (options.dateFormat !== undefined) {
    if (out.format !== "timestamp") throw new AdminPanelConfigError(`${where} has a dateFormat but is not format: "timestamp"; a dateFormat on anything else would do nothing`);
    out.dateFormat = checkDateFormat(where, options.dateFormat);
  }
  if ((out.format === "image" || out.format === "qr") && kind !== undefined && kind !== "string") {
    throw new AdminPanelConfigError(`${where} is format: "${out.format}" but its kind is "${kind}"; a picture or a QR code is drawn from a string`);
  }
  if (out.format === "image") {
    if (options.image === undefined) throw new AdminPanelConfigError(`${where} is format: "image" without image: { alt }; a picture needs words for those who cannot see it`);
    out.image = checkImage(where, options.image);
  } else if (options.image !== undefined) throw new AdminPanelConfigError(`${where} has image options but is not format: "image"`);
  if (options.qr !== undefined) {
    if (out.format !== "qr") throw new AdminPanelConfigError(`${where} has qr options but is not format: "qr"`);
    out.qr = checkQr(where, options.qr);
  }
  return out;
}

function checkImage(where: string, image: unknown): ImageOptions {
  if (image === null || typeof image !== "object" || Array.isArray(image)) throw new AdminPanelConfigError(`${where} has image options that are not an object`);
  const given = image as Record<string, unknown>;
  const unknown = Object.keys(given).filter((key) => key !== "alt" && key !== "fit" && key !== "height");
  if (unknown.length > 0) throw new AdminPanelConfigError(`${where} has image options the page does not take: ${unknown.join(", ")}`);
  if (typeof given.alt !== "string" || given.alt.trim() === "") throw new AdminPanelConfigError(`${where} has an image without alt text; say in a few words what the picture shows`);
  if (given.alt.length > MAX_ALT_LENGTH) throw new AdminPanelConfigError(`${where} has alt text of ${given.alt.length} characters; at most ${MAX_ALT_LENGTH}`);
  const out: ImageOptions = { alt: given.alt };
  if (given.fit !== undefined) {
    if (given.fit !== "contain" && given.fit !== "cover") throw new AdminPanelConfigError(`${where} has an image fit of ${JSON.stringify(given.fit)}; it is "contain" or "cover"`);
    out.fit = given.fit;
  }
  if (given.height !== undefined) {
    const height = given.height;
    if (typeof height !== "number" || !Number.isInteger(height) || height < MIN_IMAGE_HEIGHT || height > MAX_IMAGE_HEIGHT) {
      throw new AdminPanelConfigError(`${where} has an image height of ${JSON.stringify(height)}; it is a whole number of pixels from ${MIN_IMAGE_HEIGHT} to ${MAX_IMAGE_HEIGHT}`);
    }
    out.height = height;
  }
  return out;
}

function checkQr(where: string, qr: unknown): QrOptions {
  if (qr === null || typeof qr !== "object" || Array.isArray(qr)) throw new AdminPanelConfigError(`${where} has qr options that are not an object`);
  const given = qr as Record<string, unknown>;
  const unknown = Object.keys(given).filter((key) => key !== "level");
  if (unknown.length > 0) throw new AdminPanelConfigError(`${where} has qr options the page does not take: ${unknown.join(", ")}`);
  if (given.level === undefined) return {};
  if (given.level !== "L" && given.level !== "M" && given.level !== "Q" && given.level !== "H") throw new AdminPanelConfigError(`${where} has a qr level of ${JSON.stringify(given.level)}; it is "L", "M", "Q" or "H"`);
  return { level: given.level };
}

/**
 * Whether the page may load this string as a picture: an http(s) URL, a path on this origin, or a
 * `data:image/…` URI. Anything else — `javascript:`, `file:`, a `data:text/html` — is refused, and
 * the card says so rather than drawing a broken picture.
 */
export function isAllowedImageSource(source: string): boolean {
  const trimmed = source.trim();
  if (trimmed === "" || trimmed.length > 2_000_000) return false;
  if (/^data:image\/(png|jpeg|gif|webp|avif|svg\+xml|bmp)[;,]/i.test(trimmed)) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  // A path on this origin; "//host" is another origin by another name, and is treated as one.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  return false;
}
