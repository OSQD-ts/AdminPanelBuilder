/**
 * What the page looks like, per theme, light and dark, wide and on a phone, against screenshots
 * kept in the repository. The behaviour tests and axe cannot see a select stretched across the
 * header or a card that lost its border; this can.
 *
 * The panel is a snapshot on a fixed clock in a fixed time zone and locale, so it draws the same on
 * every run. Screenshots are compared in the browser: both images drawn to a canvas, pixels counted
 * that differ by more than a little in any channel. A few differing pixels are antialiasing; past
 * `MAX_DIFFERENT` of the image, the test fails and writes what it saw beside the baseline.
 *
 *   UPDATE_SCREENSHOTS=1 npm run test:browser     # accept the page as it looks now
 *
 * Chromium only: engines draw text differently, and one engine's baselines are enough to catch a
 * layout that broke. Baselines are JPEG to keep the repository light; the tolerance covers that.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, chromium } from "playwright";
import { BUILT_IN_THEMES, createAdminPanel, ManualClock } from "../../src/index.js";

const ENGINE = process.env.BROWSER_ENGINE ?? "chromium";
const UPDATE = process.env.UPDATE_SCREENSHOTS === "1";
const DIRECTORY = new URL("./screenshots/", import.meta.url);
/** Share of pixels allowed to differ: antialiasing and JPEG, not a moved card. */
const MAX_DIFFERENT = 0.004;

let browser: Browser;

beforeAll(async () => {
  if (ENGINE === "chromium") browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

/** The same panel every time: a fixed clock, fixed values, a fixed history. */
function fixture(theme: string, scheme: "light" | "dark"): string {
  const clock = new ManualClock(Date.parse("2026-09-21T12:00:00Z"));
  const panel = createAdminPanel({ title: "Chess server", instance: "web-1", theme, colorScheme: scheme, clock });
  const players = panel.viewable(0, { label: "Players online", group: "Games", chart: true, status: { warn: 400, bad: 900 } });
  for (const reading of [120, 180, 260, 330, 412]) {
    clock.advance(60_000);
    players.value = reading;
  }
  panel.modifiable(200, { label: "Largest rating gap", group: "Games", min: 50, max: 1000, step: 50 });
  panel.modifiable(true, { label: "Guests may play", group: "Games" });
  panel.viewable({ blitz: 30, rapid: 12, classical: 4 }, { label: "Waiting", group: "Games", chart: { over: "keys" } });
  panel.viewable(950, { label: "Queue", group: "Games", status: { warn: 400, bad: 900 } });
  panel.action("End abandoned games", () => undefined, { group: "Games", destructive: true });
  const html = panel.html({ snapshot: true, document: true });
  panel.close();
  return html;
}

const shots: Array<{ name: string; theme: string; scheme: "light" | "dark"; width: number }> = [];
for (const theme of Object.keys(BUILT_IN_THEMES)) for (const scheme of ["light", "dark"] as const) shots.push({ name: `${theme}-${scheme}`, theme, scheme, width: 1100 });
shots.push({ name: "material-light-phone", theme: "material", scheme: "light", width: 360 });
shots.push({ name: "material-dark-phone", theme: "material", scheme: "dark", width: 360 });

describe.skipIf(ENGINE !== "chromium")("the page, as it looks", () => {
  it.each(shots)("$name", async ({ name, theme, scheme, width }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, timezoneId: "UTC", locale: "en-US", reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.setContent(fixture(theme, scheme));
    await page.getByRole("heading", { name: "Players online" }).waitFor();
    // Web fonts are not used; a frame for layout to settle is.
    await page.waitForTimeout(150);
    const shot = await page.screenshot({ type: "jpeg", quality: 90, fullPage: true, animations: "disabled", caret: "hide" });
    const file = new URL(`${name}.jpg`, DIRECTORY);
    const baseline = await readFile(file).catch(() => undefined);
    if (UPDATE || baseline === undefined) {
      await mkdir(DIRECTORY, { recursive: true });
      await writeFile(file, shot);
      await context.close();
      if (!UPDATE) throw new Error(`there was no baseline for ${name}; one was written. Look at tests/browser/screenshots/${name}.jpg, and commit it if it is right.`);
      return;
    }
    const share = await page.evaluate(
      async ([seen, kept]) => {
        const load = (data: string) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = `data:image/jpeg;base64,${data}`;
          });
        const [a, b] = await Promise.all([load(seen as string), load(kept as string)]);
        if (a.width !== b.width || a.height !== b.height) return 1;
        const pixels = (image: HTMLImageElement) => {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context2d = canvas.getContext("2d") as CanvasRenderingContext2D;
          context2d.drawImage(image, 0, 0);
          return context2d.getImageData(0, 0, image.width, image.height).data;
        };
        const [x, y] = [pixels(a), pixels(b)];
        let different = 0;
        for (let i = 0; i < x.length; i += 4) {
          if (Math.abs((x[i] as number) - (y[i] as number)) > 40 || Math.abs((x[i + 1] as number) - (y[i + 1] as number)) > 40 || Math.abs((x[i + 2] as number) - (y[i + 2] as number)) > 40) different += 1;
        }
        return different / (x.length / 4);
      },
      [shot.toString("base64"), baseline.toString("base64")] as const,
    );
    if (share > MAX_DIFFERENT) await writeFile(new URL(`${name}.actual.jpg`, DIRECTORY), shot);
    await context.close();
    expect(share, `${name}: ${(share * 100).toFixed(2)}% of pixels differ; see ${name}.actual.jpg beside the baseline, and run UPDATE_SCREENSHOTS=1 if the change is meant`).toBeLessThanOrEqual(MAX_DIFFERENT);
  });
});
