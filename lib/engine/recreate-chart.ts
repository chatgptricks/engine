/**
 * Simple, honest line charts for recreated posts, rendered to a PNG data URL
 * that drops into a template's photo slot. One shared y-scale for every
 * series; two scales only when an exact copy's original shows them, each
 * labelled (the right one on the right edge, each scale's numbers in its
 * line's color, or headed by its lines' names when colors can't tell them
 * apart), and each kept to the range the original prints when every value
 * fits in it. Up to three event markers and a shaded period, as in the
 * original post; end labels show each line's name with its last value or its
 * change since the main marker, or the name alone (two or more lines always
 * show their names).
 *
 * Bar charts (`kind: "bar"`), for an exact copy of one: one series of 2 to 12
 * bars from zero, each with its value printed at its end; the bars the
 * original sets apart in the accent color and the rest dimmed (all in the
 * accent when none is set apart). Columns when every label fits under its
 * column, otherwise horizontal bars with the labels on the left.
 *
 * Layout: the plot runs edge to edge, so its left and right edges sit on the
 * template's text margins (the photo slot spans the text column). Scale
 * labels sit inside the plot above their gridlines; end labels are placed
 * next to each line's end where they cover no line, so they never shrink the
 * plot and every chart in a carousel lines up the same way.
 */
import sharp from "sharp";

export type ChartMarker = { index: number; label: string; icon: "none" | "openai" };
export type ChartBand = { from: number; to: number; label: string };
/** A scale's lowest and highest values, as an original prints them. */
export type ChartRange = { min: number; max: number };
export type RecreateChart = {
  /** A line chart unless set; a bar chart has one series, one value per bar. */
  kind?: "line" | "bar";
  unit: string;
  labels: string[];
  /** A line reads against the left scale unless its axis is "right": the second scale, `right`. */
  series: { name: string; values: number[]; emphasis: boolean; axis?: "left" | "right" }[];
  /** The main event; "change_since_marker" end labels measure from it. */
  markerIndex: number;
  markerLabel: string;
  markerIcon: "none" | "openai";
  /** "name" shows only each line's name; two or more lines always show at least that, so a reader can tell them apart. */
  endLabel: "value" | "change_since_marker" | "name" | "none";
  /** Up to two more labelled events. */
  markers?: ChartMarker[];
  /** A shaded period, such as a recession. */
  band?: ChartBand | null;
  /** First and last dates shown (YYYY-MM-DD), when the data has dates. */
  period?: { from: string; to: string } | null;
  /** Bar charts: the bars set apart in the accent color. */
  highlight?: number[];
  /** The left (or only) scale's range, when an exact copy's original prints it; else the scale fits the data. */
  range?: ChartRange | null;
  /** The second scale, on the right edge, for an exact copy of an original that prints two: its unit and printed range. */
  right?: { unit: string; range: ChartRange | null } | null;
  /** What validateChart left out and why, such as a printed range some values fall outside. */
  notes?: string[];
};
const MAX_MARKERS = 3, MAX_BARS = 12;
export type ChartColors = { background: string; text: string; accent: string; muted: string; grid: string };
const DEFAULT_COLORS: ChartColors = { background: "#0B1014", text: "#F9FFFE", accent: "#00D98A", muted: "#D9D9D9", grid: "rgba(249, 255, 254, 0.12)" };
const FONT = "SF Pro Display, -apple-system, Helvetica Neue, Inter, Arial, sans-serif";
const OPENAI_PATH = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round = (value: number) => Math.round(value * 10) / 10;

/** A bar chart: one series of 2 to MAX_BARS bars, each with a number and a label. */
function validateBars(chart: RecreateChart): RecreateChart {
  const filled = chart.series.filter(item => item.values.length);
  if (!filled.length) throw new Error("A bar chart needs one series with a value for each bar.");
  if (filled.length > 1) throw new Error("A bar chart shows one series: put every bar's value in it, with one label per bar.");
  const values = filled[0].values;
  if (values.length < 2) throw new Error("A bar chart needs at least two bars.");
  if (values.length > MAX_BARS) throw new Error(`A bar chart holds at most ${MAX_BARS} bars.`);
  if (values.some(value => !Number.isFinite(value))) throw new Error("Every bar needs a number.");
  const labels = values.map((_, index) => String(chart.labels[index] ?? "").trim().slice(0, 60));
  if (labels.some(label => !label)) throw new Error("Every bar needs a label.");
  const highlight = [...new Set((chart.highlight ?? []).filter(index => Number.isInteger(index) && index >= 0 && index < values.length))];
  return { ...chart, kind: "bar", series: [filled[0]], labels, highlight, markerIndex: -1, markerLabel: "", markerIcon: "none", markers: [], band: null, endLabel: "value" };
}

/** Throws when the data cannot make an honest chart, so callers fall back to an image brief. */
export function validateChart(chart: RecreateChart): RecreateChart {
  if (chart.kind === "bar") return validateBars(chart);
  const series = chart.series.filter(item => item.values.length > 1).slice(0, 4);
  if (!series.length) throw new Error("Chart needs at least one series with two or more points.");
  const length = series[0].values.length;
  if (series.some(item => item.values.length !== length)) throw new Error("Every chart series needs the same number of points.");
  // NaN marks a missing period (shown as a gap); infinities are invalid.
  if (series.some(item => item.values.some(value => !Number.isNaN(value) && !Number.isFinite(value)))) throw new Error("Chart values must be numbers.");
  if (series.some(item => item.values.filter(Number.isFinite).length < 2)) throw new Error("Every chart series needs at least two real values.");
  if (length > 2000) throw new Error("Chart has too many points.");
  const labels = Array.from({ length }, (_, index) => chart.labels[index] ?? "");
  const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < length;
  const markerIndex = inRange(chart.markerIndex) ? chart.markerIndex : -1;
  const markers = (chart.markers ?? [])
    .filter(marker => inRange(marker.index) && marker.index !== markerIndex)
    .filter((marker, index, all) => all.findIndex(other => other.index === marker.index) === index)
    .map((marker): ChartMarker => ({ index: marker.index, label: String(marker.label ?? "").trim().slice(0, 60), icon: marker.icon === "openai" ? "openai" : "none" }))
    .slice(0, MAX_MARKERS - (markerIndex >= 0 ? 1 : 0));
  const band = chart.band && inRange(chart.band.from) && inRange(chart.band.to) && chart.band.from < chart.band.to
    ? { from: chart.band.from, to: chart.band.to, label: String(chart.band.label ?? "").trim().slice(0, 40) } : null;
  const endLabel = chart.endLabel === "change_since_marker" && markerIndex < 0 ? "value" : chart.endLabel === "none" && series.length > 1 ? "name" : chart.endLabel;
  // Two scales only when the original shows them: lines on each, none indexed (indexed lines share one scale).
  const notes: string[] = [], indexed = chart.unit === "index", onRight = series.filter(item => item.axis === "right").length;
  if (onRight && indexed) notes.push("Indexed lines share one scale, so the second scale is left out.");
  const two = onRight > 0 && onRight < series.length && !indexed;
  // Every line on the right is still one scale: the left one, in the right one's unit and range.
  const only = onRight === series.length && !indexed && chart.right ? chart.right : null;
  const lines = series.map(item => item.axis === "right" && !two ? { ...item, axis: "left" as const } : item);
  const unit = only ? String(only.unit ?? "").trim().slice(0, 12) : chart.unit;
  const range = indexed ? null : fitRange(only ? only.range : chart.range, lines.filter(item => item.axis !== "right"), unit, two ? "left " : "", notes);
  const rightUnit = String(chart.right?.unit ?? chart.unit).trim().slice(0, 12);
  const right = two ? { unit: rightUnit, range: fitRange(chart.right?.range, lines.filter(item => item.axis === "right"), rightUnit, "right ", notes) } : null;
  return {
    ...chart, unit, series: lines, labels, markerIndex, markers, band, endLabel,
    ...(range || "range" in chart ? { range } : {}), ...(right || "right" in chart ? { right } : {}), ...(notes.length ? { notes } : {}),
  };
}

/** A printed range, kept only when it holds every value of its lines; `notes` says why one is left out. */
function fitRange(range: ChartRange | null | undefined, lines: RecreateChart["series"], unit: string, side: string, notes: string[]): ChartRange | null {
  if (!range) return null;
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min >= range.max) {
    notes.push(`The ${side}scale's range needs a lowest value below its highest, so the scale fits the data instead.`);
    return null;
  }
  const values = lines.flatMap(item => item.values.filter(Number.isFinite)), low = Math.min(...values), high = Math.max(...values);
  if (low < range.min || high > range.max) {
    notes.push(`The ${side}scale's range, ${formatValue(range.min, unit)} to ${formatValue(range.max, unit)}, doesn't hold every value (its lines run from ${formatValue(low, unit)} to ${formatValue(high, unit)}), so the scale fits the data instead.`);
    return null;
  }
  return { min: range.min, max: range.max };
}

/** The smallest round step (1, 2, 2.5 or 5 × 10ⁿ) at least `raw`. */
const nice = (raw: number) => {
  const power = 10 ** Math.floor(Math.log10(raw)), fraction = raw / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
};
/** Round gridline values covering [min, max] in 3–6 even steps (1, 2, 2.5 or 5 × 10ⁿ). */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!(max > min)) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  let step = nice((max - min) / target), lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  while ((hi - lo) / step > 6) { step = nice(step * 1.5); lo = Math.floor(min / step) * step; hi = Math.ceil(max / step) * step; }
  const count = Math.max(1, Math.round((hi - lo) / step));
  return Array.from({ length: count + 1 }, (_, index) => Number((lo + index * step).toPrecision(12)));
}
/** Round gridline values covering [min, max] in exactly `steps` steps, so a second scale's gridlines fall on the first's. */
export function alignedTicks(min: number, max: number, steps: number): number[] {
  if (!(max > min)) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const count = Math.max(2, Math.round(steps));
  for (let step = nice((max - min) / count); ; step = nice(step * 1.0001)) {
    const lo = Math.floor(min / step) * step;
    if (lo + count * step >= max) return Array.from({ length: count + 1 }, (_, index) => Number((lo + index * step).toPrecision(12)));
  }
}
/** Round values inside a printed range, for its gridlines (2 to 5 of them; the range's own ends may not be round). */
export function ticksWithin(min: number, max: number): number[] {
  const step = nice((max - min) / 4), ticks: number[] = [];
  for (let index = Math.ceil(min / step - 1e-9); index * step <= max + step * 1e-9; index++) ticks.push(Number((index * step).toPrecision(12)));
  return ticks;
}
type Scale = { lo: number; hi: number; ticks: number[] };
/**
 * A scale for some lines: the printed range when there is one, else round gridlines around their values,
 * from zero when positive values barely move so noise doesn't read as a crash (indexed lines keep their
 * own scale). `steps` lines the gridlines up with another scale's.
 */
function scaleOf(values: number[], unit: string, range: ChartRange | null | undefined, steps = 0): Scale {
  if (range) return { lo: range.min, hi: range.max, ticks: ticksWithin(range.min, range.max) };
  let min = Math.min(...values);
  const max = Math.max(...values);
  if (unit !== "index" && min >= 0 && max > 0 && (max - min) < max * 0.25) min = 0;
  const ticks = steps ? alignedTicks(min, max, steps) : niceTicks(min, max);
  return { lo: ticks[0], hi: ticks[ticks.length - 1], ticks };
}

/** Short numbers (7.5M, 120K) so labels stay narrow; the unit is a suffix, "$" a prefix. */
export function formatValue(value: number, unit: string): string {
  // "K", "M" and "B" units are multipliers (FRED reports job openings in
  // thousands): 7,612 K reads better as 7.6M.
  const multiplier = ({ K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[unit.trim().toUpperCase()];
  if (multiplier) return formatValue(value * multiplier, "");
  const abs = Math.abs(value);
  const [scaled, suffix] = abs >= 1e12 ? [abs / 1e12, "T"] : abs >= 1e9 ? [abs / 1e9, "B"] : abs >= 1e6 ? [abs / 1e6, "M"] : abs >= 1e5 ? [abs / 1e3, "K"] : [abs, ""];
  const digits = suffix ? (scaled >= 100 ? 0 : 1) : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const text = `${value < 0 ? "−" : ""}${unit === "$" ? "$" : ""}${scaled.toLocaleString("en-US", { maximumFractionDigits: digits })}${suffix}`;
  const tail = unit.trim().slice(0, 12);
  if (!tail || tail === "$" || tail === "index") return text;
  return tail === "%" ? `${text}%` : `${text} ${tail}`;
}
/** Approximate rendered width; SF Pro averages a little over half an em per character. */
const textWidth = (text: string, size: number) => [...text].length * size * 0.56;
function fitText(text: string, size: number, width: number): string {
  if (textWidth(text, size) <= width) return text;
  const keep = Math.max(1, Math.floor(width / (size * 0.56)) - 1);
  return `${[...text].slice(0, keep).join("").trimEnd()}…`;
}
const lastFinite = (values: number[]) => values.findLast(Number.isFinite) ?? 0;
/** The unit a line's values are in: the second scale's for a line on it. */
const unitOf = (chart: RecreateChart, item: RecreateChart["series"][number]) => item.axis === "right" && chart.right ? chart.right.unit : chart.unit;
/** The value at index, or the nearest real one before it (then after) when that period is missing. */
export function finiteAt(values: number[], index: number): number {
  for (let i = index; i >= 0; i--) if (Number.isFinite(values[i])) return values[i];
  return values.find(Number.isFinite) ?? 0;
}
function endValue(chart: RecreateChart, item: RecreateChart["series"][number]): string {
  const last = lastFinite(item.values);
  if (chart.endLabel !== "change_since_marker") return formatValue(last, unitOf(chart, item));
  const base = finiteAt(item.values, chart.markerIndex), change = base === 0 ? 0 : (last / base - 1) * 100;
  return `${change >= 0 ? "+" : "−"}${Math.abs(Math.round(change))}%`;
}

/** Greedy word wrap into at most `max` lines; null when a word can't fit. */
function wrapWords(text: string, size: number, width: number, max: number): string[] | null {
  const lines: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    if (textWidth(word, size) > width) return null;
    const last = lines[lines.length - 1];
    if (last !== undefined && textWidth(`${last} ${word}`, size) <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.length <= max ? lines : null;
}

type TextOptions = { anchor?: "middle" | "end"; weight?: number; outline?: boolean };
const textTag = (c: ChartColors, halo: number) => (tx: number, ty: number, value: string, size: number, fill: string, options: TextOptions = {}) =>
  `<text x="${round(tx)}" y="${round(ty)}"${options.anchor ? ` text-anchor="${options.anchor}"` : ""} fill="${fill}" font-size="${size}"${options.weight ? ` font-weight="${options.weight}" letter-spacing="${round(-size / 100)}"` : ""} font-family="${FONT}"${options.outline ? ` stroke="${c.background}" stroke-width="${halo}" stroke-linejoin="round" paint-order="stroke"` : ""}>${escape(value)}</text>`;

/** A bar chart, already validated: columns when every label fits under its column in two lines, else horizontal bars (never with negative values, which need columns). */
function barSvg(chart: RecreateChart, width: number, height: number, c: ChartColors): string {
  const k = Math.min(1.4, Math.max(0.6, width / 920));
  const labelSize = Math.round(30 * k), valueSize = Math.round(34 * k), gap = Math.round(14 * k), radius = round(4 * k);
  const text = textTag(c, round(8 * k)), values = chart.series[0].values, count = values.length;
  const lit = new Set(chart.highlight ?? []);
  const paint = (index: number) => lit.size && !lit.has(index) ? `fill="${c.muted}" fill-opacity="0.5"` : `fill="${c.accent}"`;
  const shown = values.map(value => formatValue(value, chart.unit));
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values), span = hi - lo || 1;
  const parts: string[] = [`<rect width="${width}" height="${height}" fill="${c.background}"/>`];
  const slot = width / count, lineHeight = Math.round(labelSize * 1.15);
  const wrapped = chart.labels.map(label => wrapWords(label, labelSize, slot - gap, 2));
  const columns = lo < 0 || (wrapped.every(Boolean) && shown.every(value => textWidth(value, valueSize) <= slot - gap / 2));
  if (columns) {
    const lines = chart.labels.map((label, index) => wrapped[index] ?? [fitText(label, labelSize, slot - gap)]);
    const rows = Math.max(...lines.map(item => item.length)), below = lo < 0 ? valueSize + gap : 0;
    const plotT = valueSize + gap, plotB = height - rows * lineHeight - gap - below;
    const y = (value: number) => plotT + (hi - value) / span * (plotB - plotT), zero = y(0);
    const barWidth = Math.min(slot * 0.62, Math.round(170 * k));
    parts.push(`<line x1="0" y1="${round(zero)}" x2="${width}" y2="${round(zero)}" stroke="${c.text}" stroke-opacity="0.25" stroke-width="2"/>`);
    values.forEach((value, index) => {
      const cx = slot * (index + 0.5), top = Math.min(y(value), zero), tall = Math.max(Math.abs(y(value) - zero), 2);
      parts.push(`<rect x="${round(cx - barWidth / 2)}" y="${round(top)}" width="${round(barWidth)}" height="${round(tall)}" rx="${radius}" ${paint(index)}/>`);
      parts.push(text(cx, value >= 0 ? top - gap * 0.6 : top + tall + gap * 0.6 + valueSize * 0.75, shown[index], valueSize, c.text, { anchor: "middle", weight: 600 }));
      lines[index].forEach((line, row) => parts.push(text(cx, plotB + below + gap + labelSize * 0.85 + row * lineHeight, line, labelSize, c.muted, { anchor: "middle" })));
    });
  } else {
    const column = Math.min(width * 0.38, Math.max(...chart.labels.map(label => textWidth(label, labelSize))));
    const lines = chart.labels.map(label => wrapWords(label, labelSize, column, 2) ?? [fitText(label, labelSize, column)]);
    const left = column + gap, room = width - left - Math.max(...shown.map(value => textWidth(value, valueSize))) - gap;
    const row = height / count, thickness = Math.min(row * 0.58, Math.round(76 * k));
    parts.push(`<line x1="${round(left)}" y1="0" x2="${round(left)}" y2="${height}" stroke="${c.text}" stroke-opacity="0.25" stroke-width="2"/>`);
    values.forEach((value, index) => {
      const cy = row * (index + 0.5), long = Math.max(value / span * room, 2);
      parts.push(`<rect x="${round(left)}" y="${round(cy - thickness / 2)}" width="${round(long)}" height="${round(thickness)}" rx="${radius}" ${paint(index)}/>`);
      parts.push(text(left + long + gap * 0.6, cy + valueSize * 0.35, shown[index], valueSize, c.text, { weight: 600 }));
      const top = cy - (lines[index].length - 1) * lineHeight / 2 + labelSize * 0.35;
      lines[index].forEach((line, at) => parts.push(text(column, top + at * lineHeight, line, labelSize, c.muted, { anchor: "end" })));
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

export function chartSvg(input: RecreateChart, width: number, height: number, colors: Partial<ChartColors> = {}): string {
  const chart = validateChart(input), c = { ...DEFAULT_COLORS, ...colors };
  if (chart.kind === "bar") return barSvg(chart, width, height, c);
  // Type scales with the slot; 920 px is the @chatgptricks text column at 1080 output.
  const k = Math.min(1.4, Math.max(0.6, width / 920));
  const labelSize = Math.round(32 * k), scaleSize = Math.round(26 * k), gap = Math.round(14 * k), halo = round(8 * k);
  const count = chart.series[0].values.length;
  const onSide = (side: "left" | "right") => chart.series.filter(item => (item.axis === "right") === (side === "right"));
  const valuesOn = (side: "left" | "right") => onSide(side).flatMap(item => item.values.filter(Number.isFinite));
  const left = scaleOf(valuesOn("left"), chart.unit, chart.range), ticks = left.ticks;
  // A second scale's gridlines fall on the first's, unless either keeps a printed range.
  const aligned = Boolean(chart.right) && !chart.range && !chart.right?.range;
  const second = chart.right ? scaleOf(valuesOn("right"), chart.right.unit, chart.right.range, aligned ? ticks.length - 1 : 0) : null;

  // ── Columns: the plot starts on the left text margin; end labels get a fixed
  // column on the right (a quarter of the width), the same on every chart.
  const hasEndLabels = chart.endLabel !== "none";
  // A second scale's numbers get their own column between the plot and the end labels, so no line runs under them.
  const axisColumn = second && chart.right ? Math.round(Math.max(...second.ticks.map(tick => textWidth(formatValue(tick, chart.right!.unit), scaleSize))) + gap) : 0;
  const column = hasEndLabels ? Math.round(width * 0.25) : 0, plotR = width - column - axisColumn;
  const inset = 3; // half the line width, so round caps aren't clipped at the margin
  const x = (index: number) => inset + (count === 1 ? 0 : index / (count - 1)) * (plotR - 2 * inset);

  // ── Markers: each label sits above the plot, centred on its line or beside
  // it, on the lowest row where it touches no other label and no other
  // marker's line crosses it. The OpenAI icon tops its marker.
  const markers: ChartMarker[] = [
    ...(chart.markerIndex >= 0 ? [{ index: chart.markerIndex, label: chart.markerLabel, icon: chart.markerIcon }] : []),
    ...(chart.markers ?? []),
  ].sort((a, b) => a.index - b.index);
  type Placement = { marker: ChartMarker; text: string; mx: number; x1: number; x2: number; row: number };
  const placed: Placement[] = [];
  for (const marker of markers) {
    const label = fitText(marker.label.trim(), labelSize, width);
    if (!label) continue;
    const w = textWidth(label, labelSize), mx = x(marker.index);
    const options = [0, 1].flatMap(row => [Math.min(Math.max(mx - w / 2, 0), width - w), mx - gap / 2 - w, mx + gap / 2].map(x1 => ({ marker, text: label, mx, x1, x2: x1 + w, row })))
      .filter(option => option.x1 >= 0 && option.x2 <= width);
    const lineInside = (option: Placement) => markers.some(other => other !== marker && x(other.index) > option.x1 - gap / 2 && x(other.index) < option.x2 + gap / 2);
    const fits = (option: Placement) => !lineInside(option) && placed.every(other =>
      !(other.row === option.row && option.x1 < other.x2 + gap * 2 && other.x1 < option.x2 + gap * 2)
      && !(other.row > option.row && other.mx > option.x1 - gap / 2 && other.mx < option.x2 + gap / 2)
      && !(option.row > other.row && option.mx > other.x1 - gap / 2 && option.mx < other.x2 + gap / 2));
    placed.push(options.find(fits) ?? options.find(option => option.row === 1) ?? { marker, text: label, mx, x1: Math.max(0, mx - w / 2), x2: Math.max(0, mx - w / 2) + w, row: 1 });
  }
  const iconMarker = markers.find(marker => marker.icon === "openai");
  const iconSize = iconMarker ? Math.round(68 * k) : 0;
  const rowCount = placed.length ? Math.max(...placed.map(label => label.row)) + 1 : 0;
  const rowHeight = Math.round(labelSize * 1.3), rowsTop = iconSize ? iconSize + gap : 0;
  const rowBaseline = (row: number) => rowsTop + (rowCount - row) * rowHeight - Math.round(labelSize * 0.3);

  const colorFor = (item: RecreateChart["series"][number], index: number) => item.emphasis ? c.accent : index === 0 || chart.series.length <= 2 ? c.text : c.muted;
  // With two scales each one's numbers take its line's color; when that can't tell them apart
  // (lines alike in color, or several on one scale), each scale is headed by its lines' names.
  const sideColor = (side: "left" | "right") => {
    const colors = chart.series.flatMap((item, index) => (item.axis === "right") === (side === "right") ? [colorFor(item, index)] : []);
    return second && colors.length === 1 ? colors[0] : c.muted;
  };
  const named = Boolean(second) && (sideColor("left") === sideColor("right") || [sideColor("left"), sideColor("right")].includes(c.muted));
  const nameRow = named ? Math.round(scaleSize * 1.3) : 0;
  const plotT = rowsTop + rowCount * rowHeight + (rowCount ? gap : 0) + nameRow + scaleSize + gap;
  const plotB = height - labelSize - Math.round(30 * k);
  const yOn = (scale: Scale) => (value: number) => plotB - (value - scale.lo) / (scale.hi - scale.lo || 1) * (plotB - plotT);
  const y = yOn(left), yOf = (item: RecreateChart["series"][number]) => item.axis === "right" && second ? yOn(second) : y;
  const text = textTag(c, halo);
  const parts: string[] = [`<rect width="${width}" height="${height}" fill="${c.background}"/>`];

  if (chart.band) {
    const bx = x(chart.band.from);
    parts.push(`<rect x="${round(bx)}" y="${plotT}" width="${round(x(chart.band.to) - bx)}" height="${plotB - plotT}" fill="${c.text}" fill-opacity="0.07"/>`);
  }
  // Gridlines reach under a second scale's numbers when they share them; numbers of its own sit on short lines in its column.
  const gridR = aligned ? plotR + axisColumn - gap / 2 : plotR;
  ticks.forEach((tick, index) => {
    const gy = round(y(tick));
    parts.push(`<line x1="0" y1="${gy}" x2="${round(gridR)}" y2="${gy}" stroke="${index === 0 ? c.text : c.grid}"${index === 0 ? ` stroke-opacity="0.25"` : ""} stroke-width="2"/>`);
  });
  if (second && !aligned) {
    for (const tick of second.ticks) parts.push(`<line x1="${plotR}" y1="${round(yOn(second)(tick))}" x2="${round(plotR + axisColumn - gap / 2)}" y2="${round(yOn(second)(tick))}" stroke="${c.grid}" stroke-width="2"/>`);
  }
  for (const marker of markers) {
    const label = placed.find(item => item.marker === marker);
    const mx = round(x(marker.index)), top = label ? rowBaseline(label.row) + gap : plotT;
    parts.push(`<line x1="${mx}" y1="${top}" x2="${mx}" y2="${plotB}" stroke="${c.text}" stroke-width="2"/>`);
  }
  // Lines, split at missing periods; emphasised series drawn last, on top.
  const order = chart.series.map((_, index) => index).sort((a, b) => Number(chart.series[a].emphasis) - Number(chart.series[b].emphasis));
  for (const index of order) {
    const item = chart.series[index], runs: string[][] = [[]];
    item.values.forEach((value, i) => {
      if (Number.isFinite(value)) runs[runs.length - 1].push(`${round(x(i))},${round(yOf(item)(value))}`);
      else if (runs[runs.length - 1].length) runs.push([]);
    });
    for (const run of runs.filter(points => points.length)) {
      parts.push(run.length === 1
        ? `<circle cx="${run[0].split(",")[0]}" cy="${run[0].split(",")[1]}" r="3" fill="${colorFor(item, index)}"/>`
        : `<polyline points="${run.join(" ")}" fill="none" stroke="${colorFor(item, index)}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
  }
  // Scale labels inside the plot, on top of their gridlines, outlined so lines pass behind them; a second scale's at the right edge.
  for (const tick of ticks) parts.push(text(0, y(tick) - Math.round(8 * k), formatValue(tick, chart.unit), scaleSize, sideColor("left"), { outline: true }));
  if (second && chart.right) {
    for (const tick of second.ticks) parts.push(text(plotR + gap / 2, yOn(second)(tick) - Math.round(8 * k), formatValue(tick, chart.right.unit), scaleSize, sideColor("right"), { outline: true }));
    if (named) {
      const heading = (side: "left" | "right") => fitText(onSide(side).map(item => item.name.trim()).join(" & "), scaleSize, plotR * 0.45);
      const top = plotT - scaleSize - gap - Math.round(scaleSize * 0.35);
      parts.push(text(0, top, heading("left"), scaleSize, sideColor("left"), { weight: 600, outline: true }));
      parts.push(text(plotR + axisColumn - gap / 2, top, heading("right"), scaleSize, sideColor("right"), { anchor: "end", weight: 600, outline: true }));
    }
  }
  if (chart.band?.label) {
    parts.push(text(x(chart.band.from) + Math.round(8 * k), plotT + scaleSize + gap, fitText(chart.band.label, scaleSize, plotR * 0.4), scaleSize, c.muted, { outline: true }));
  }
  for (const label of placed) parts.push(text(label.x1, rowBaseline(label.row), label.text, labelSize, c.text, { weight: 600 }));
  if (iconMarker) {
    const r = iconSize / 2, cx = round(Math.min(Math.max(x(iconMarker.index), r), width - r)), cy = round(r), scale = iconSize * 0.6 / 24;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${round(r)}" fill="${c.text}"/>`);
    parts.push(`<path transform="translate(${round(cx - 12 * scale)} ${round(cy - 12 * scale)}) scale(${round(scale * 1000) / 1000})" fill="${c.background}" d="${OPENAI_PATH}"/>`);
  }

  // ── End labels: name (wrapped to two lines when needed) and value, level with each line's end.
  if (hasEndLabels) {
    const left = plotR + axisColumn + gap, room = width - left;
    // One size for every label, the largest at which all names wrap cleanly.
    let size = labelSize;
    const valued = chart.endLabel !== "name";
    while (size > Math.round(24 * k) && chart.series.some(item => !wrapWords(item.name, size, room, 2) || valued && textWidth(endValue(chart, item), size) > room)) size -= 2;
    const lineHeight = Math.round(size * 1.19);
    const blocks = chart.series.map((item, index) => {
      const name = wrapWords(item.name, size, room, 2) ?? [fitText(item.name, size, room)];
      const lines = valued ? [...name, fitText(endValue(chart, item), size, room)] : name;
      const last = item.values.findLastIndex(Number.isFinite), height = lines.length * lineHeight;
      return { lines, color: colorFor(item, index), height, top: yOf(item)(item.values[last]) - height / 2 + lineHeight * 0.15 };
    }).sort((a, b) => a.top - b.top);
    // Push overlapping labels apart, then keep the stack inside the plot.
    for (let i = 1; i < blocks.length; i++) blocks[i].top = Math.max(blocks[i].top, blocks[i - 1].top + blocks[i - 1].height + gap / 2);
    const overflow = blocks.length ? blocks[blocks.length - 1].top + blocks[blocks.length - 1].height - plotB : 0;
    if (overflow > 0) blocks.forEach(block => { block.top -= overflow; });
    const underflow = blocks.length ? plotT - scaleSize - blocks[0].top : 0;
    if (underflow > 0) blocks.forEach(block => { block.top += underflow; });
    for (const block of blocks) {
      block.lines.forEach((line, i) => parts.push(text(left, block.top + size * 0.85 + i * lineHeight, line, size, block.color, { weight: 600 })));
    }
  }

  // ── X labels: at most 6, never closer than the widest label plus a gap, kept inside the image.
  const labelled = chart.labels.map((label, index) => ({ label, index })).filter(item => item.label.trim());
  const widest = Math.max(0, ...labelled.map(item => textWidth(item.label, labelSize)));
  const spacing = labelled.length > 1 ? (x(labelled[labelled.length - 1].index) - x(labelled[0].index)) / (labelled.length - 1) : Infinity;
  const stride = Math.max(1, Math.ceil(labelled.length / 6), Math.ceil((widest + 24) / spacing));
  let right = -Infinity;
  labelled.filter((_, i) => i % stride === 0).forEach(item => {
    const half = textWidth(item.label, labelSize) / 2, lx = Math.min(Math.max(x(item.index), half), width - half);
    if (lx - half < right + gap) return; // kept inside the image, it would touch the previous label
    right = lx + half;
    parts.push(text(lx, height - Math.round(10 * k), item.label, labelSize, c.muted, { anchor: "middle" }));
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (date: string) => { const [year, month] = date.split("-").map(Number); return `${MONTH_NAMES[month - 1] ?? ""} ${year}`.trim(); };
/** Alt text that says what the chart shows and what it means, not how it's drawn. */
export function chartAltText(input: RecreateChart, sources: string[] = []): string {
  const chart = validateChart(input);
  if (chart.kind === "bar") {
    const lit = new Set(chart.highlight ?? []), item = chart.series[0];
    return [
      `Bar chart${item.name.trim() ? ` of ${item.name.trim()}` : ""}: ${chart.labels.map((label, index) => `${label} ${formatValue(item.values[index], chart.unit)}`).join(", ")}.`,
      lit.size ? `Highlighted: ${[...lit].map(index => chart.labels[index]).join(", ")}.` : "",
      sources.length ? `Source: ${sources.join("; ")}.` : "",
    ].filter(Boolean).join(" ").slice(0, 2000);
  }
  const main = chart.markerIndex >= 0 ? chart.markerLabel.trim() || "the marked event" : "";
  const span = chart.period ? ` from ${monthYear(chart.period.from)} to ${monthYear(chart.period.to)}` : "";
  const scaling = chart.unit === "index" && main ? `, every line set to 100 at ${main}` : "";
  const ends = chart.endLabel === "change_since_marker" && main
    ? `Since ${main}: ${chart.series.map(item => `${item.name} ${endValue(chart, item)}`).join(", ")}.`
    : `Latest: ${chart.series.map(item => `${item.name} ${endValue({ ...chart, endLabel: "value" }, item)}`).join(", ")}.`;
  const marked = [main, ...(chart.markers ?? []).map(marker => marker.label.trim())].filter(Boolean);
  const side = (right: boolean) => chart.series.filter(item => (item.axis === "right") === right).map(item => item.name).join(" and ");
  const scales = chart.right ? `, on two scales: ${side(false)} on the left, ${side(true)} on the right` : "";
  return [
    `Line chart of ${chart.series.map(item => item.name).join(" and ")}${span}${scaling}${scales}.`,
    ends,
    marked.length ? `Marked: ${marked.join(", ")}.` : "",
    chart.band?.label ? `Shaded: ${chart.band.label}.` : "",
    sources.length ? `Source: ${sources.join("; ")}.` : "",
  ].filter(Boolean).join(" ").slice(0, 2000);
}

/** PNG at 2× the slot's output size, as a data URL Engine accepts for image layers. */
export async function chartPngDataUrl(chart: RecreateChart, width: number, height: number, colors: Partial<ChartColors> = {}): Promise<string> {
  const w = Math.max(200, Math.round(width)), h = Math.max(200, Math.round(height));
  const svg = chartSvg(chart, w, h, colors);
  const png = await sharp(Buffer.from(svg), { density: 144 }).resize(w * 2, h * 2).png({ compressionLevel: 9 }).toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
