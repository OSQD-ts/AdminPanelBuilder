/**
 * Charts, drawn from the store.
 *
 * Every chart carries three renderings of the same numbers, because colour and shape are never
 * the only signal: the plot, a legend naming each series with its latest value, and a table
 * view listing the samples. A screen reader gets a one-sentence summary under every chart.
 *
 * The plot is SVG stretched to its box with HTML labels beside it (see `geometry.ts` for why);
 * gauges, charts over keys, histograms and heatmaps are HTML, which reads as a list or a table
 * to assistive technology and cannot overflow a narrow card.
 *
 * A chart over time can be paused (it keeps collecting, and shows what it had), narrowed to a
 * recent window from a select or by dragging across it, and downloaded as CSV. The drawing is
 * downsampled to the plot's width; the table and the CSV carry every sample.
 *
 * A chart over time is also a focusable group: arrow keys step a cursor through the samples and a
 * polite live region reads out each series at that moment, so the numbers behind the line can be
 * explored without a pointer and without opening the table.
 */
import type { ChartSchema, JsonValue, Sample, ValueSchema } from "../types.js";
import { toCsv } from "./csv.js";
import { binCount, histogram, lttb, stack } from "./downsample.js";
import { clear, el, svgEl, uid } from "./dom.js";
import { type FormatSpec, formatAgo, formatNumber, numericEntries } from "./format.js";
import { areaPath, BOX, type Extent, extentOf, linePath, niceTicks, project, scale } from "./geometry.js";
import type { Translate } from "./i18n.js";
import { type Store, serverTime } from "./store.js";

export interface ChartView {
  readonly element: HTMLElement;
  draw(store: Store): void;
}

/** Rows the table view lists. The newest are the ones somebody opening it wants; the note says how many more there are. */
const TABLE_ROWS = 200;
/** Bars a chart over keys draws before saying how many it left out. */
const KEY_ROWS = 50;
/** Points a line keeps after downsampling: about two per pixel of a wide card. */
const DRAWN_POINTS = 600;
const WINDOWS: Array<[string, number]> = [
  ["All", 0],
  ["1 min", 60_000],
  ["5 min", 300_000],
  ["15 min", 900_000],
  ["1 h", 3_600_000],
];

export function buildChart(schema: ChartSchema, values: ReadonlyMap<string, ValueSchema>, t: Translate): ChartView {
  const spec: FormatSpec = { format: schema.format, unit: schema.unit };
  const figure = el("figure", "apb-chart");
  const titleId = uid("chart-title");
  const summaryId = uid("chart-summary");
  if (schema.placement === "group") {
    const caption = el("figcaption", "apb-chart-title", schema.title);
    caption.id = titleId;
    figure.append(caption);
    figure.setAttribute("aria-labelledby", titleId);
    if (schema.description !== undefined) figure.append(el("p", "apb-description", schema.description));
  } else figure.setAttribute("aria-label", schema.title);
  figure.setAttribute("aria-describedby", summaryId);

  const overTime = schema.over === "time" && schema.kind !== "gauge";
  const against = typeof schema.over === "object";
  let paused: Map<string, Sample[]> | undefined;
  let windowMs = 0;
  let zoom: Extent | undefined;
  let last: Store | undefined;
  let csv: string[][] = [];
  let reset: HTMLButtonElement | undefined;

  const toolbar = el("div", "apb-chart-tools");
  if (overTime || against) {
    const pause = el("button", "apb-tool", t("pause"));
    pause.type = "button";
    pause.setAttribute("aria-pressed", "false");
    pause.addEventListener("click", () => {
      paused = paused === undefined && last !== undefined ? new Map(last.series) : undefined;
      pause.textContent = paused === undefined ? t("pause") : t("resume");
      pause.setAttribute("aria-pressed", String(paused !== undefined));
      if (last !== undefined) draw(last);
    });
    toolbar.append(pause);
    if (overTime) {
      const range = el("select", "apb-tool");
      range.setAttribute("aria-label", `${schema.title}: time range`);
      for (const [label, ms] of WINDOWS) {
        const option = el("option", null, label);
        option.value = String(ms);
        range.append(option);
      }
      range.addEventListener("change", () => {
        windowMs = Number(range.value);
        zoom = undefined;
        if (last !== undefined) draw(last);
      });
      toolbar.append(range);
    }
    reset = el("button", "apb-tool", t("resetZoom"));
    reset.type = "button";
    reset.hidden = true;
    reset.addEventListener("click", () => {
      zoom = undefined;
      if (reset !== undefined) reset.hidden = true;
      if (last !== undefined) draw(last);
    });
    toolbar.append(reset);
  }
  if (schema.kind !== "gauge") {
    const download = el("button", "apb-tool", t("exportCsv"));
    download.type = "button";
    download.addEventListener("click", () => exportCsv(schema.title, csv));
    toolbar.append(download);
  }
  figure.append(toolbar);

  const body = el("div");
  const empty = el("p", "apb-empty");
  const legend = el("ul", "apb-legend");
  const summary = el("p", "apb-sr");
  summary.id = summaryId;
  const readout = el("p", "apb-hint apb-chart-readout");
  readout.setAttribute("aria-live", "polite");
  readout.hidden = true;
  figure.append(body, readout, empty, legend, summary);
  /** The sample time the keyboard cursor is on, and what the last drawing had to step through. */
  let cursor: number | undefined;
  let moments: Array<{ time: number; cells: Array<Sample | undefined> }> = [];
  let momentLabels: string[] = [];
  if (overTime || against) {
    // The body outlives every redraw, so focus stays put while the plot inside it is replaced.
    body.className = "apb-chart-body";
    body.tabIndex = 0;
    body.setAttribute("role", "group");
    body.setAttribute("aria-label", `${schema.title}. ${t("chartExplore")}`);
    body.addEventListener("keydown", (event) => {
      if (moments.length === 0) return;
      const at = cursor === undefined ? -1 : moments.findIndex((moment) => moment.time === cursor);
      let index: number;
      if (event.key === "ArrowLeft") index = at === -1 ? moments.length - 1 : Math.max(0, at - 1);
      else if (event.key === "ArrowRight") index = at === -1 ? moments.length - 1 : Math.min(moments.length - 1, at + 1);
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = moments.length - 1;
      else if (event.key === "Escape" && cursor !== undefined) {
        cursor = undefined;
        readout.hidden = true;
        if (last !== undefined) draw(last);
        return;
      } else return;
      event.preventDefault();
      const moment = moments[index] as (typeof moments)[number];
      cursor = moment.time;
      readout.hidden = false;
      const when = new Date(moment.time).toLocaleTimeString();
      readout.textContent = moment.cells
        .map((cell, series) => (cell === undefined ? undefined : t("chartPoint", { label: momentLabels[series] ?? "", value: formatNumber(cell[1], spec), time: when })))
        .filter((text): text is string => text !== undefined)
        .join("; ");
      if (last !== undefined) draw(last);
    });
  }
  const table = schema.kind === "gauge" ? undefined : buildTableView(figure, t);

  function draw(store: Store): void {
    last = store;
    clear(body);
    clear(legend);
    empty.textContent = "";
    if (schema.kind === "gauge") return drawGauge(store);
    if (schema.kind === "histogram") return drawHistogram(store);
    if (schema.kind === "heatmap") return drawHeatmap(store);
    if (schema.over === "keys") return drawKeys(store);
    drawPlot(store);
  }

  function drawPlot(store: Store): void {
    const now = serverTime(store);
    const source = paused ?? store.series;
    const series = schema.series.map((entry) => ({ entry, samples: entry.history === undefined ? [] : (source.get(entry.history) ?? []) }));
    const total = series.reduce((sum, item) => sum + item.samples.length, 0);
    if (total === 0) {
      empty.textContent = t("noSamples");
      summary.textContent = `${schema.title}: ${t("noSamples")}`;
      return;
    }
    const from = zoom?.min ?? (windowMs > 0 ? now - windowMs : Number.NEGATIVE_INFINITY);
    const to = zoom?.max ?? Number.POSITIVE_INFINITY;
    const inRange = (sample: Sample): boolean => {
      const x = against ? (sample[2] ?? 0) : sample[0];
      return x >= from && x <= to;
    };
    // A value sampled on change holds between samples, so the line is carried to now at its last reading.
    const extended = series.map(({ entry, samples }) => {
      let kept = samples.filter(inRange);
      if (!against && kept.length > 0 && zoom === undefined && paused === undefined) {
        const lastSample = kept[kept.length - 1] as Sample;
        if (lastSample[0] < now) kept = [...kept, [now, lastSample[1]] as Sample];
      }
      return { entry, samples: kept };
    });
    moments = byTime(extended.map(({ samples }) => samples)).reverse();
    momentLabels = extended.map(({ entry }) => entry.label);
    const lineValues = (schema.lines ?? []).map((line) => ({ label: line.label, value: line.value ?? numberOf(store.values.get(line.from ?? "")?.value) }));
    const stacked = schema.stacked === true ? stack(extended.map(({ samples }) => samples.map((sample) => [sample[0], sample[1]] as [number, number]))) : undefined;
    const ys = stacked === undefined ? extended.flatMap(({ samples }) => samples.map((sample) => sample[1])) : stacked.layers.flatMap((layer) => layer.map(([, y]) => y));
    for (const line of lineValues) if (line.value !== undefined) ys.push(line.value);
    const xs = extended.flatMap(({ samples }) => samples.map((sample) => (against ? (sample[2] ?? 0) : sample[0])));
    const y = extentOf(ys, { min: schema.min, max: schema.max }, schema.kind === "bar" || schema.kind === "area" || stacked !== undefined);
    const x = zoom ?? extentOf(xs);
    const sparkline = schema.kind === "sparkline";

    const plot = el("div", sparkline ? "apb-plot apb-plot-sparkline" : "apb-plot");
    const svg = svgEl("svg", { viewBox: `0 0 ${BOX} ${BOX}`, preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
    if (!sparkline) {
      for (const tick of niceTicks(y)) {
        const position = scale(tick, y);
        svg.append(svgEl("line", { class: "apb-gridline", x1: 0, x2: BOX, y1: BOX - position, y2: BOX - position }));
        const label = el("span", "apb-tick", formatNumber(tick, { ...spec, unit: undefined }));
        label.style.top = `${100 - (position / BOX) * 100}%`;
        plot.append(label);
      }
    }
    extended.forEach(({ entry, samples }, index) => {
      const group = svgEl("g", { class: `apb-slot-${entry.slot}` });
      const layer = stacked?.layers[index];
      const below = index > 0 ? stacked?.layers[index - 1] : undefined;
      const raw = layer === undefined ? project(samples, x, y, against) : layer.map(([time, value]) => [scale(time, x), scale(value, y)] as [number, number]);
      const points = against ? raw : lttb(raw, DRAWN_POINTS);
      if (against) {
        // A zero-length stroke with a round cap, not a circle: the plot is stretched to its box, which
        // would squash a circle into a dash, and a non-scaling stroke stays round at any aspect ratio.
        for (const [px, py] of points) group.append(svgEl("path", { class: "apb-dot", d: `M${Math.round(px)} ${Math.round(BOX - py)} l0 0` }));
      } else if (schema.kind === "bar") {
        const width = Math.max(2, (BOX / Math.max(points.length, 1)) * 0.7);
        const baseline = below === undefined ? undefined : below.map(([, value]) => scale(value, y));
        points.forEach(([px, py], i) => {
          const base = baseline?.[i] ?? scale(Math.max(y.min, 0), y);
          group.append(svgEl("rect", { class: "apb-bar", x: Math.min(BOX - width, Math.max(0, px - width / 2)), y: BOX - Math.max(py, base), width, height: Math.abs(py - base) }));
        });
      } else {
        if (schema.kind === "area") {
          if (below === undefined) group.append(svgEl("path", { class: "apb-area", d: areaPath(points, false, scale(Math.max(y.min, 0), y)) }));
          else {
            const bottom = below.map(([time, value]) => [scale(time, x), scale(value, y)] as [number, number]).reverse();
            const d = `${linePath(points)} ${bottom.map(([bx, by]) => `L${Math.round(bx * 10) / 10} ${Math.round((BOX - by) * 10) / 10}`).join(" ")} Z`;
            group.append(svgEl("path", { class: "apb-area", d }));
          }
        }
        group.append(svgEl("path", { class: "apb-line", d: linePath(points, schema.kind === "step") }));
      }
      svg.append(group);
    });
    for (const line of lineValues) {
      if (line.value === undefined) continue;
      const position = BOX - scale(line.value, y);
      svg.append(svgEl("line", { class: "apb-threshold", x1: 0, x2: BOX, y1: position, y2: position }));
      const label = el("span", "apb-threshold-label", `${line.label}: ${formatNumber(line.value, spec)}`);
      label.style.top = `${(position / BOX) * 100}%`;
      plot.append(label);
    }
    const marks = (store.marks[schema.id] ?? []).filter((mark) => !against && mark.at >= x.min && mark.at <= x.max);
    for (const mark of marks) {
      const position = scale(mark.at, x);
      const line = svgEl("line", { class: "apb-mark", x1: position, x2: position, y1: 0, y2: BOX });
      const title = svgEl("title");
      title.textContent = mark.text;
      line.append(title);
      svg.append(line);
    }
    if (cursor !== undefined) {
      const moment = moments.find((entry) => entry.time === cursor);
      const cx = against ? moment?.cells.find((cell) => cell !== undefined)?.[2] : cursor;
      if (cx !== undefined && cx >= x.min && cx <= x.max) {
        const position = scale(cx, x);
        svg.append(svgEl("line", { class: "apb-cursor", x1: position, x2: position, y1: 0, y2: BOX }));
      }
    }
    plot.append(svg);
    if (!sparkline) attachZoom(plot, x);
    body.append(plot);
    if (!sparkline) {
      const axis = el("div", "apb-axis");
      if (against && typeof schema.over === "object") {
        const overSpec = specOf(values.get(schema.over.value));
        axis.append(el("span", null, formatNumber(x.min, overSpec)), el("span", null, schema.over.label), el("span", null, formatNumber(x.max, overSpec)));
      } else axis.append(el("span", null, formatAgo(x.min, now)), el("span", null, zoom === undefined && paused === undefined ? "now" : formatAgo(x.max, now)));
      body.append(axis);
      if (marks.length > 0) body.append(el("p", "apb-hint", marks.map((mark) => mark.text).join(" · ")));
    }

    const sentences: string[] = [];
    for (const { entry, samples } of extended) {
      const latest = samples[samples.length - 1];
      const item = el("li", `apb-slot-${entry.slot}`);
      item.append(el("span", "apb-swatch"), document.createTextNode(entry.label));
      if (latest !== undefined) item.append(el("span", "apb-legend-value", formatNumber(latest[1], spec)));
      legend.append(item);
      if (samples.length > 0) {
        const readings = samples.map((sample) => sample[1]);
        sentences.push(`${entry.label} ranges from ${formatNumber(Math.min(...readings), spec)} to ${formatNumber(Math.max(...readings), spec)}${latest === undefined ? "" : `, latest ${formatNumber(latest[1], spec)}`}`);
      }
    }
    // One series needs no legend beside a chart titled with its name; the table still names it.
    legend.hidden = series.length === 1 && schema.placement === "alone";
    summary.textContent = `${describeKind(schema)} of ${series.map(({ entry }) => entry.label).join(", ")}${against && typeof schema.over === "object" ? ` against ${schema.over.label}` : ""}. ${sentences.join(". ")}.`;
    const head = ["Time", ...(against && typeof schema.over === "object" ? [schema.over.label] : []), ...series.map(({ entry }) => entry.label)];
    const samplesOnly = extended.map(({ samples }) => samples);
    csv = [head, ...rawRows(samplesOnly, against)];
    table?.fill(head, tableRows(samplesOnly, against, spec, specOf(typeof schema.over === "object" ? values.get(schema.over.value) : undefined)));
  }

  /** Drag across the plot to zoom into that stretch; the reset button shows everything again. */
  function attachZoom(plot: HTMLElement, x: Extent): void {
    let start: number | undefined;
    const band = el("div", "apb-zoom-band");
    band.hidden = true;
    plot.append(band);
    const fraction = (event: PointerEvent): number => {
      const box = plot.getBoundingClientRect();
      return Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
    };
    plot.addEventListener("pointerdown", (event) => {
      start = fraction(event);
      band.hidden = false;
      band.style.left = `${start * 100}%`;
      band.style.width = "0";
    });
    plot.addEventListener("pointermove", (event) => {
      if (start === undefined) return;
      const now = fraction(event);
      band.style.left = `${Math.min(start, now) * 100}%`;
      band.style.width = `${Math.abs(now - start) * 100}%`;
    });
    plot.addEventListener("pointerup", (event) => {
      if (start === undefined) return;
      const end = fraction(event);
      const [a, b] = start < end ? [start, end] : [end, start];
      start = undefined;
      band.hidden = true;
      if (b - a < 0.02) return;
      zoom = { min: x.min + a * (x.max - x.min), max: x.min + b * (x.max - x.min) };
      if (reset !== undefined) reset.hidden = false;
      if (last !== undefined) draw(last);
    });
  }

  function drawGauge(store: Store): void {
    const entry = schema.series[0];
    if (entry === undefined) return;
    const current = numberOf(store.values.get(entry.value)?.value);
    const min = schema.min ?? 0;
    const max = schema.max ?? 1;
    const track = el("div", "apb-gauge-track");
    const fill = el("div", `apb-gauge-fill apb-slot-${entry.slot}`);
    const share = current === undefined || max <= min ? 0 : Math.min(1, Math.max(0, (current - min) / (max - min)));
    fill.style.width = `${share * 100}%`;
    track.append(fill);
    track.setAttribute("role", "meter");
    track.setAttribute("aria-valuemin", String(min));
    track.setAttribute("aria-valuemax", String(max));
    if (current !== undefined) track.setAttribute("aria-valuenow", String(current));
    track.setAttribute("aria-label", entry.label);
    const scaleRow = el("div", "apb-gauge-scale");
    scaleRow.append(el("span", null, formatNumber(min, spec)), el("span", null, `${Math.round(share * 100)}%`), el("span", null, formatNumber(max, spec)));
    body.append(track, scaleRow);
    summary.textContent = current === undefined ? `${entry.label}: no reading.` : `${entry.label} is ${formatNumber(current, spec)} of ${formatNumber(max, spec)}, ${Math.round(share * 100)} percent.`;
  }

  function drawBars(rows: Array<{ label: string; value: number; slot: number }>, max: number, valueSpec: FormatSpec): void {
    const keys = el("div", "apb-keys");
    for (const row of rows.slice(0, KEY_ROWS)) {
      const line = el("div", `apb-key-row apb-slot-${row.slot}`);
      const track = el("div", "apb-key-track");
      const bar = el("div", "apb-key-bar");
      bar.style.width = `${max === 0 ? 0 : (Math.abs(row.value) / max) * 100}%`;
      track.append(bar);
      track.setAttribute("aria-hidden", "true");
      line.append(el("span", "apb-key-label", row.label), track, el("span", "apb-key-value", formatNumber(row.value, valueSpec)));
      keys.append(line);
    }
    if (rows.length > KEY_ROWS) keys.append(el("p", "apb-empty", `${rows.length - KEY_ROWS} more not drawn; the table lists them all.`));
    body.append(keys);
  }

  function drawKeys(store: Store): void {
    const rows: Array<{ label: string; value: number; slot: number }> = [];
    const sentences: string[] = [];
    for (const entry of schema.series) {
      const entries = numericEntries(store.values.get(entry.value)?.value ?? null);
      for (const [key, value] of entries) rows.push({ label: schema.series.length > 1 ? `${entry.label}: ${key}` : key, value, slot: entry.slot });
      sentences.push(`${entry.label}: ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`);
      if (entries.length === 0) empty.textContent = `${values.get(entry.value)?.label ?? entry.value} has no numeric entries to draw yet.`;
    }
    drawBars(rows, Math.max(schema.max ?? 0, ...rows.map((row) => Math.abs(row.value))), spec);
    summary.textContent = `Bar chart. ${sentences.join(". ")}.`;
    csv = [["Key", "Value"], ...rows.map((row) => [row.label, String(row.value)])];
    table?.fill(["Key", "Value"], rows.map((row) => [row.label, formatNumber(row.value, spec)]));
  }

  function drawHistogram(store: Store): void {
    const entry = schema.series[0];
    if (entry === undefined) return;
    const raw = store.values.get(entry.value)?.value ?? null;
    const observations = Array.isArray(raw) ? raw.filter((value): value is number => typeof value === "number") : numericEntries(raw).map(([, value]) => value);
    if (observations.length === 0) {
      empty.textContent = `${entry.label} has no numbers to bin yet.`;
      summary.textContent = empty.textContent;
      return;
    }
    const bins = histogram(observations, schema.bins ?? binCount(observations.length));
    const rows = bins.map((bin) => ({ label: `${formatNumber(bin.from, spec)} – ${formatNumber(bin.to, spec)}`, value: bin.count, slot: entry.slot }));
    const max = Math.max(...rows.map((row) => row.value));
    drawBars(rows, max, { format: "integer" });
    summary.textContent = `Histogram of ${observations.length} values of ${entry.label} in ${bins.length} bins; the fullest holds ${max}.`;
    csv = [["From", "To", "Count"], ...bins.map((bin) => [String(bin.from), String(bin.to), String(bin.count)])];
    table?.fill(["Range", "Count"], rows.map((row) => [row.label, String(row.value)]));
  }

  function drawHeatmap(store: Store): void {
    const entry = schema.series[0];
    if (entry === undefined) return;
    const raw = store.values.get(entry.value)?.value ?? null;
    const matrix = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, JsonValue>) : {};
    const rowKeys = Object.keys(matrix);
    const columnKeys = [...new Set(rowKeys.flatMap((row) => Object.keys((matrix[row] ?? {}) as Record<string, JsonValue>)))];
    if (rowKeys.length === 0 || columnKeys.length === 0) {
      empty.textContent = `${entry.label} has no rows of columns to draw yet.`;
      summary.textContent = empty.textContent;
      return;
    }
    const cell = (row: string, column: string): number => numberOf(((matrix[row] ?? {}) as Record<string, JsonValue>)[column]) ?? 0;
    const max = Math.max(...rowKeys.flatMap((row) => columnKeys.map((column) => cell(row, column))));
    const wrap = el("div", "apb-table-wrap");
    const grid = el("table", `apb-heatmap apb-slot-${entry.slot}`);
    const head = el("tr");
    head.append(el("td"));
    for (const column of columnKeys) {
      const th = el("th", null, column);
      th.setAttribute("scope", "col");
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const row of rowKeys) {
      const tr = el("tr");
      const th = el("th", null, row);
      th.setAttribute("scope", "row");
      tr.append(th);
      for (const column of columnKeys) {
        const value = cell(row, column);
        const td = el("td", "apb-heat-cell");
        const shade = el("span", "apb-heat");
        shade.style.opacity = String(max === 0 ? 0 : Math.max(0.06, value / max));
        shade.setAttribute("aria-hidden", "true");
        td.append(shade, el("span", "apb-heat-value", formatNumber(value, spec)));
        tr.append(td);
      }
      tbody.append(tr);
    }
    grid.append(thead, tbody);
    wrap.append(grid);
    body.append(wrap);
    summary.textContent = `Heatmap of ${entry.label}: ${rowKeys.length} rows by ${columnKeys.length} columns; the highest cell is ${formatNumber(max, spec)}.`;
    csv = [["", ...columnKeys], ...rowKeys.map((row) => [row, ...columnKeys.map((column) => String(cell(row, column)))])];
  }

  return { element: figure, draw };
}

function numberOf(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function specOf(schema: ValueSchema | undefined): FormatSpec {
  return schema === undefined ? {} : { format: schema.format, unit: schema.unit, decimals: schema.decimals, kind: schema.kind };
}

function describeKind(schema: ChartSchema): string {
  if (typeof schema.over === "object") return "Scatter chart";
  const stacked = schema.stacked === true ? "Stacked " : "";
  return `${stacked}${{ line: "line chart", area: "area chart", step: "step chart", bar: "bar chart", sparkline: "sparkline", gauge: "gauge", histogram: "histogram", heatmap: "heatmap" }[schema.kind].replace(/^./, (letter) => (stacked === "" ? letter.toUpperCase() : letter))}`;
}

/** Rows newest first, one per sample time, a column per series. */
function tableRows(series: ReadonlyArray<readonly Sample[]>, against: boolean, spec: FormatSpec, overSpec: FormatSpec): string[][] {
  return byTime(series).map(({ time, cells }) => {
    const x = cells.find((cell) => cell !== undefined)?.[2];
    return [new Date(time).toLocaleTimeString(), ...(against ? [x === undefined ? "—" : formatNumber(x, overSpec)] : []), ...cells.map((cell) => (cell === undefined ? "—" : formatNumber(cell[1], spec)))];
  });
}

/** The same rows unformatted, for CSV: ISO times and plain numbers a spreadsheet reads. */
function rawRows(series: ReadonlyArray<readonly Sample[]>, against: boolean): string[][] {
  return byTime(series).map(({ time, cells }) => {
    const x = cells.find((cell) => cell !== undefined)?.[2];
    return [new Date(time).toISOString(), ...(against ? [x === undefined ? "" : String(x)] : []), ...cells.map((cell) => (cell === undefined ? "" : String(cell[1])))];
  });
}

function byTime(series: ReadonlyArray<readonly Sample[]>): Array<{ time: number; cells: Array<Sample | undefined> }> {
  const map = new Map<number, Array<Sample | undefined>>();
  series.forEach((samples, index) => {
    for (const sample of samples) {
      const row = map.get(sample[0]) ?? new Array<Sample | undefined>(series.length).fill(undefined);
      row[index] = sample;
      map.set(sample[0], row);
    }
  });
  return [...map.keys()].sort((a, b) => b - a).map((time) => ({ time, cells: map.get(time) as Array<Sample | undefined> }));
}

function exportCsv(title: string, rows: string[][]): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = el("a");
  link.href = url;
  link.download = `${title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "chart"}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildTableView(figure: HTMLElement, t: Translate): { fill(head: string[], rows: string[][]): void } {
  const details = el("details", "apb-table-view");
  details.append(el("summary", null, t("showTable")));
  const wrap = el("div", "apb-table-wrap");
  details.append(wrap);
  figure.append(details);
  let pending: { head: string[]; rows: string[][] } | undefined;
  const render = (): void => {
    if (pending === undefined || !details.open) return;
    clear(wrap);
    const table = el("table", "apb-table");
    const head = el("tr");
    for (const cell of pending.head) {
      const th = el("th", null, cell);
      th.setAttribute("scope", "col");
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const row of pending.rows.slice(0, TABLE_ROWS)) {
      const tr = el("tr");
      for (const cell of row) tr.append(el("td", null, cell));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    if (pending.rows.length > TABLE_ROWS) wrap.append(el("p", "apb-empty", `Showing the newest ${TABLE_ROWS} of ${pending.rows.length} rows; the CSV has them all.`));
  };
  // Built only while open: a closed table view costs nothing per poll.
  details.addEventListener("toggle", render);
  return {
    fill(head, rows) {
      pending = { head, rows };
      render();
    },
  };
}
