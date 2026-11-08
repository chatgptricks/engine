/**
 * Simple, honest line charts for recreated posts, rendered to a PNG data URL
 * that drops into a template's photo slot. One shared y-scale for every
 * series (no hidden dual axes); up to three event markers and a shaded
 * period, as in the original post; end labels show either the last value or
 * the change since the main marker.
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
export type RecreateChart = {
  unit: string;
  labels: string[];
  series: { name: string; values: number[]; emphasis: boolean }[];
  /** The main event; "change_since_marker" end labels measure from it. */
  markerIndex: number;
  markerLabel: string;
  markerIcon: "none" | "openai";
  endLabel: "value" | "change_since_marker" | "none";
  /** Up to two more labelled events. */
  markers?: ChartMarker[];
  /** A shaded period, such as a recession. */
  band?: ChartBand | null;
  /** First and last dates shown (YYYY-MM-DD), when the data has dates. */
  period?: { from: string; to: string } | null;
};
const MAX_MARKERS = 3;
export type ChartColors = { background: string; text: string; accent: string; muted: string; grid: string };
const DEFAULT_COLORS: ChartColors = { background: "#0B1014", text: "#F9FFFE", accent: "#00D98A", muted: "#D9D9D9", grid: "rgba(249, 255, 254, 0.12)" };
const FONT = "SF Pro Display, -apple-system, Helvetica Neue, Inter, Arial, sans-serif";
const OPENAI_PATH = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const round = (value: number) => Math.round(value * 10) / 10;

/** Throws when the data cannot make an honest chart, so callers fall back to an image brief. */
export function validateChart(chart: RecreateChart): RecreateChart {
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
  return { ...chart, series, labels, markerIndex, markers, band, endLabel: chart.endLabel === "change_since_marker" && markerIndex < 0 ? "value" : chart.endLabel };
}

/** Round gridline values covering [min, max] in 3–6 even steps (1, 2, 2.5 or 5 × 10ⁿ). */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!(max > min)) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const nice = (raw: number) => {
    const power = 10 ** Math.floor(Math.log10(raw)), fraction = raw / power;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
  };
  let step = nice((max - min) / target), lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  while ((hi - lo) / step > 6) { step = nice(step * 1.5); lo = Math.floor(min / step) * step; hi = Math.ceil(max / step) * step; }
  const count = Math.max(1, Math.round((hi - lo) / step));
  return Array.from({ length: count + 1 }, (_, index) => Number((lo + index * step).toPrecision(12)));
}

/** Short numbers (7.5M, 120K) so labels stay narrow; the unit is a suffix, "$" a prefix. */
export function formatValue(value: number, unit: string): string {
  // "K", "M" and "B" units are multipliers (FRED reports job openings in
  // thousands): 7,612 K reads better as 7.6M.
  const multiplier = ({ K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[unit.trim().toUpperCase()];
  if (multiplier) return formatValue(value * multiplier, "");
  const abs = Math.abs(value);
  const [scaled, suffix] = abs >= 1e9 ? [abs / 1e9, "B"] : abs >= 1e6 ? [abs / 1e6, "M"] : abs >= 1e5 ? [abs / 1e3, "K"] : [abs, ""];
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
/** The value at index, or the nearest real one before it (then after) when that period is missing. */
export function finiteAt(values: number[], index: number): number {
  for (let i = index; i >= 0; i--) if (Number.isFinite(values[i])) return values[i];
  return values.find(Number.isFinite) ?? 0;
}
function endValue(chart: RecreateChart, item: RecreateChart["series"][number]): string {
  const last = lastFinite(item.values);
  if (chart.endLabel !== "change_since_marker") return formatValue(last, chart.unit);
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

export function chartSvg(input: RecreateChart, width: number, height: number, colors: Partial<ChartColors> = {}): string {
  const chart = validateChart(input), c = { ...DEFAULT_COLORS, ...colors };
  // Type scales with the slot; 920 px is the @chatgptricks text column at 1080 output.
  const k = Math.min(1.4, Math.max(0.6, width / 920));
  const labelSize = Math.round(32 * k), scaleSize = Math.round(26 * k), gap = Math.round(14 * k), halo = round(8 * k);
  const count = chart.series[0].values.length;
  const all = chart.series.flatMap(item => item.values.filter(Number.isFinite));
  let min = Math.min(...all);
  const max = Math.max(...all);
  // Honest baseline: when positive values barely move, start at zero so
  // noise doesn't read as a crash. Indexed charts keep their own scale.
  if (chart.unit !== "index" && min >= 0 && max > 0 && (max - min) < max * 0.25) min = 0;
  const ticks = niceTicks(min, max), lo = ticks[0], hi = ticks[ticks.length - 1];

  // ── Columns: the plot starts on the left text margin; end labels get a fixed
  // column on the right (a quarter of the width), the same on every chart.
  const hasEndLabels = chart.endLabel !== "none";
  const column = hasEndLabels ? Math.round(width * 0.25) : 0, plotR = width - column;
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
  const plotT = rowsTop + rowCount * rowHeight + (rowCount ? gap : 0) + scaleSize + gap;
  const plotB = height - labelSize - Math.round(30 * k);
  const y = (value: number) => plotB - (value - lo) / (hi - lo || 1) * (plotB - plotT);

  const colorFor = (item: RecreateChart["series"][number], index: number) => item.emphasis ? c.accent : index === 0 || chart.series.length <= 2 ? c.text : c.muted;
  const text = (tx: number, ty: number, value: string, size: number, fill: string, options: { anchor?: "middle" | "end"; weight?: number; outline?: boolean } = {}) =>
    `<text x="${round(tx)}" y="${round(ty)}"${options.anchor ? ` text-anchor="${options.anchor}"` : ""} fill="${fill}" font-size="${size}"${options.weight ? ` font-weight="${options.weight}" letter-spacing="${round(-size / 100)}"` : ""} font-family="${FONT}"${options.outline ? ` stroke="${c.background}" stroke-width="${halo}" stroke-linejoin="round" paint-order="stroke"` : ""}>${escape(value)}</text>`;
  const parts: string[] = [`<rect width="${width}" height="${height}" fill="${c.background}"/>`];

  if (chart.band) {
    const bx = x(chart.band.from);
    parts.push(`<rect x="${round(bx)}" y="${plotT}" width="${round(x(chart.band.to) - bx)}" height="${plotB - plotT}" fill="${c.text}" fill-opacity="0.07"/>`);
  }
  ticks.forEach((tick, index) => {
    const gy = round(y(tick));
    parts.push(`<line x1="0" y1="${gy}" x2="${plotR}" y2="${gy}" stroke="${index === 0 ? c.text : c.grid}"${index === 0 ? ` stroke-opacity="0.25"` : ""} stroke-width="2"/>`);
  });
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
      if (Number.isFinite(value)) runs[runs.length - 1].push(`${round(x(i))},${round(y(value))}`);
      else if (runs[runs.length - 1].length) runs.push([]);
    });
    for (const run of runs.filter(points => points.length)) {
      parts.push(run.length === 1
        ? `<circle cx="${run[0].split(",")[0]}" cy="${run[0].split(",")[1]}" r="3" fill="${colorFor(item, index)}"/>`
        : `<polyline points="${run.join(" ")}" fill="none" stroke="${colorFor(item, index)}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
  }
  // Scale labels inside the plot, on top of their gridlines, outlined so lines pass behind them.
  for (const tick of ticks) parts.push(text(0, y(tick) - Math.round(8 * k), formatValue(tick, chart.unit), scaleSize, c.muted, { outline: true }));
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
    const left = plotR + gap, room = width - left;
    // One size for every label, the largest at which all names wrap cleanly.
    let size = labelSize;
    while (size > Math.round(24 * k) && chart.series.some(item => !wrapWords(item.name, size, room, 2) || textWidth(endValue(chart, item), size) > room)) size -= 2;
    const lineHeight = Math.round(size * 1.19);
    const blocks = chart.series.map((item, index) => {
      const name = wrapWords(item.name, size, room, 2) ?? [fitText(item.name, size, room)];
      const lines = [...name, fitText(endValue(chart, item), size, room)];
      const last = item.values.findLastIndex(Number.isFinite), height = lines.length * lineHeight;
      return { lines, color: colorFor(item, index), height, top: y(item.values[last]) - height / 2 + lineHeight * 0.15 };
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
  const chart = validateChart(input), main = chart.markerIndex >= 0 ? chart.markerLabel.trim() || "the marked event" : "";
  const span = chart.period ? ` from ${monthYear(chart.period.from)} to ${monthYear(chart.period.to)}` : "";
  const scaling = chart.unit === "index" && main ? `, every line set to 100 at ${main}` : "";
  const ends = chart.endLabel === "change_since_marker" && main
    ? `Since ${main}: ${chart.series.map(item => `${item.name} ${endValue(chart, item)}`).join(", ")}.`
    : `Latest: ${chart.series.map(item => `${item.name} ${endValue({ ...chart, endLabel: "value" }, item)}`).join(", ")}.`;
  const marked = [main, ...(chart.markers ?? []).map(marker => marker.label.trim())].filter(Boolean);
  return [
    `Line chart of ${chart.series.map(item => item.name).join(" and ")}${span}${scaling}.`,
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
