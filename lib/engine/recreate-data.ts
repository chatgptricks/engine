/**
 * Real chart data for recreated posts. Research downloads official series
 * through client tools; the writer then names the series and Engine fills the
 * chart values itself, so no number is ever retyped by a model.
 *
 * Sources, each contacted at one fixed address:
 * - FRED (St. Louis Fed: jobs, prices, rates, GDP, markets…), by validated id.
 * - The S&P 500's monthly history since 1871 (Robert Shiller's data as kept by
 *   the datasets/s-and-p-500 project), because FRED only has its last 10 years.
 */
import { finiteAt, type ChartMarker, type RecreateChart } from "./recreate-chart";

export type Observation = { date: string; value: number };
export type FredFrequency = "monthly" | "quarterly" | "annual" | "native";
export type DataSourceKind = "fred" | "sp500_history";
export type FredSeries = { id: string; frequency: FredFrequency; observations: Observation[]; source?: DataSourceKind };
export type ChartData = Map<string, FredSeries>;
export const SP500_HISTORY_ID = "SP500_HISTORY";
const SP500_HISTORY_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv";

const FREQUENCY_PARAM: Record<Exclude<FredFrequency, "native">, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };
const MAX_POINTS = 2000;
const SERIES_ID = /^[A-Z0-9_.]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ChartDataError extends Error {}

export function fredSeriesId(value: unknown): string {
  const id = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!SERIES_ID.test(id)) throw new ChartDataError("series_id must be a FRED series id such as JTSJOL or UNRATE.");
  return id;
}

/**
 * Parses FRED's two-column CSV (`observation_date,<ID>`). A blank or "."
 * value is a missing period: kept as NaN so charts show a gap rather than
 * drawing across it. Missing periods at either end are dropped.
 */
export function parseFredCsv(csv: string): Observation[] {
  const lines = csv.trim().split(/\r?\n/);
  if (!/^(observation_date|DATE),/i.test(lines[0] ?? "")) throw new ChartDataError("FRED did not return series data.");
  const rows: Observation[] = [];
  for (const line of lines.slice(1)) {
    const [date, raw = ""] = line.split(",");
    if (!DATE.test(date ?? "")) continue;
    const value = raw.trim() === "" || raw.trim() === "." ? NaN : Number(raw);
    if (Number.isNaN(value) || Number.isFinite(value)) rows.push({ date, value });
  }
  const first = rows.findIndex(row => Number.isFinite(row.value)), last = rows.findLastIndex(row => Number.isFinite(row.value));
  return first < 0 ? [] : rows.slice(first, last + 1);
}
const real = (rows: Observation[]) => rows.filter(row => Number.isFinite(row.value));

async function download(url: URL, label: string, options: { signal?: AbortSignal; fetch?: typeof fetch }): Promise<string> {
  const timeout = AbortSignal.timeout(20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, { signal, redirect: "error" });
  } catch {
    throw new ChartDataError(`${label} could not be reached.`);
  }
  if (response.status !== 200) throw new ChartDataError(`${label} is unavailable (HTTP ${response.status}).`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new ChartDataError(`${label} is too large; ask for a lower frequency.`);
  return text;
}

/** The monthly S&P 500 (average of daily closes) since 1871: `Date,SP500,…` CSV. */
export function parseSp500HistoryCsv(csv: string): Observation[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map(cell => cell.trim());
  const dateAt = header.indexOf("Date"), valueAt = header.indexOf("SP500");
  if (dateAt < 0 || valueAt < 0) throw new ChartDataError("The S&P 500 history did not return series data.");
  const rows: Observation[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(","), date = cells[dateAt]?.trim() ?? "", value = Number(cells[valueAt]);
    if (DATE.test(date) && Number.isFinite(value) && value > 0) rows.push({ date: `${date.slice(0, 7)}-01`, value });
  }
  return rows;
}

export async function fetchSp500History(options: { start?: string; signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<FredSeries> {
  if (options.start !== undefined && !DATE.test(options.start)) throw new ChartDataError("start must be a date like 2000-01-01.");
  const observations = parseSp500HistoryCsv(await download(new URL(SP500_HISTORY_URL), "The S&P 500 history", options))
    .filter(row => !options.start || row.date >= options.start);
  if (observations.length < 2) throw new ChartDataError("The S&P 500 history has no data in that range.");
  return { id: SP500_HISTORY_ID, frequency: "monthly", observations: observations.slice(-MAX_POINTS), source: "sp500_history" };
}

export async function fetchFredSeries(
  seriesId: unknown,
  options: { start?: string; frequency?: FredFrequency; signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<FredSeries> {
  const id = fredSeriesId(seriesId), frequency = options.frequency ?? "monthly";
  if (options.start !== undefined && !DATE.test(options.start)) throw new ChartDataError("start must be a date like 2000-01-01.");
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", id);
  if (options.start) url.searchParams.set("cosd", options.start);
  if (frequency !== "native") { url.searchParams.set("fq", FREQUENCY_PARAM[frequency]); url.searchParams.set("fam", "avg"); }
  const text = await download(url, `FRED series ${id}`, options).catch(error => {
    throw new ChartDataError(error instanceof ChartDataError && /HTTP 404|HTTP 400/.test(error.message) ? `FRED has no series ${id} (${error.message.match(/HTTP \d+/)?.[0]}).` : error instanceof Error ? error.message : `FRED could not be reached for ${id}.`);
  });
  const observations = parseFredCsv(text);
  if (real(observations).length < 2) throw new ChartDataError(`FRED series ${id} has no data in that range.`);
  return { id, frequency, observations: observations.slice(-MAX_POINTS), source: "fred" };
}

/** What research sees: the shape of the series, not 2,000 raw rows. */
export function describeSeries(series: FredSeries): string {
  const rows = real(series.observations), first = rows[0], last = rows[rows.length - 1];
  const max = rows.reduce((a, b) => b.value > a.value ? b : a), min = rows.reduce((a, b) => b.value < a.value ? b : a);
  const missing = series.observations.filter(row => !Number.isFinite(row.value)).map(row => row.date);
  const step = Math.max(1, Math.ceil(rows.length / 150));
  const sample = rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
  const history = series.source === "sp500_history";
  return [
    history
      ? `S&P 500 monthly average of daily closes (Shiller data via datasets/s-and-p-500), ${rows.length} points from ${first.date} to ${last.date}.`
      : `FRED ${series.id}, ${series.frequency}, ${rows.length} points from ${first.date} to ${last.date}.`,
    `First ${first.value} (${first.date}); last ${last.value} (${last.date}); high ${max.value} (${max.date}); low ${min.value} (${min.date}).`,
    missing.length ? `Missing (charts show a gap): ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ` and ${missing.length - 12} more` : ""}.` : "No missing periods.",
    history
      ? "Engine keeps the full series; to chart it, the writer sets the series' source to sp500_history and Engine fills the values."
      : `Engine keeps the full series; to chart it, the writer names ${series.id} and Engine fills the values.`,
    step > 1 ? `Every ${step}th point:` : "All points:",
    ...sample.map(row => `${row.date},${row.value}`),
  ].join("\n");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Years on round steps (every 1, 2, 5, 10… years, at most 6) from 18 months up; months for shorter spans. */
export function axisLabels(dates: string[]): string[] {
  const years = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 3.156e10;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find(candidate => Math.ceil(years / candidate) <= 6) ?? 100;
  const monthStep = years > 0.75 ? 3 : 1;
  return dates.map(date => {
    const [year, month] = date.split("-").map(Number);
    if (years >= 1.5) return month === 1 && year % step === 0 ? String(year) : "";
    return (month - 1) % monthStep === 0 ? `${MONTHS[month - 1]} ${year}` : "";
  });
}

export type SeriesSource = { kind: DataSourceKind; id: string };
export type FredChartSpec = Omit<RecreateChart, "series" | "markers" | "band"> & {
  /** `fred` names a FRED id; `source` names any downloadable series (and wins over `fred`). */
  series: (RecreateChart["series"][number] & { fred: string | null; source?: SeriesSource | null })[];
  from: string | null; markerDate: string | null; indexToMarker: boolean;
  /** More events to mark (by date for downloaded series, by index for typed ones). */
  markers?: (Omit<ChartMarker, "index"> & { date?: string | null; index?: number })[] | null;
  band?: { from: string | number; to: string | number; label: string } | null;
};
const sourceOf = (item: FredChartSpec["series"][number]): SeriesSource | null =>
  item.source?.kind ? item.source : item.fred ? { kind: "fred", id: item.fred } : null;
const cacheKey = (source: SeriesSource) => source.kind === "sp500_history" ? `${SP500_HISTORY_ID}:monthly` : `${fredSeriesId(source.id)}:monthly`;

/** Loads a named series once per run (research may already have downloaded it). */
export async function loadSeries(source: SeriesSource, data: ChartData, options: { signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<FredSeries> {
  const key = cacheKey(source);
  const id = source.kind === "sp500_history" ? SP500_HISTORY_ID : fredSeriesId(source.id);
  const cached = data.get(key) ?? [...data.values()].find(series => series.id === id);
  if (cached) return cached;
  const series = source.kind === "sp500_history"
    ? await fetchSp500History({ signal: options.signal, fetch: options.fetch })
    : await fetchFredSeries(id, { signal: options.signal, fetch: options.fetch });
  data.set(key, series);
  return series;
}

/**
 * Fills a chart whose series name FRED ids: aligns every series on the dates
 * they share (from `from` on), writes the axis labels, places the marker at
 * `markerDate`, and optionally indexes every series to 100 at the marker so
 * series in different units can share one honest scale.
 */
export async function resolveChartData(
  chart: FredChartSpec,
  data: ChartData,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<RecreateChart> {
  const base: RecreateChart = {
    unit: chart.unit, labels: chart.labels, series: chart.series.map(({ name, values, emphasis }) => ({ name, values, emphasis })),
    markerIndex: chart.markerIndex, markerLabel: chart.markerLabel, markerIcon: chart.markerIcon, endLabel: chart.endLabel,
    markers: (chart.markers ?? []).flatMap(marker => Number.isInteger(marker.index) ? [{ index: marker.index as number, label: marker.label, icon: marker.icon }] : []),
    band: chart.band && typeof chart.band.from === "number" && typeof chart.band.to === "number" ? { from: chart.band.from, to: chart.band.to, label: chart.band.label } : null,
  };
  const sourced = chart.series.filter(item => sourceOf(item));
  if (!sourced.length) return chart.indexToMarker ? indexed(base) : base;
  if (sourced.length !== chart.series.length) throw new ChartDataError("A chart can't mix downloaded series with typed-in values.");
  const loaded = await Promise.all(sourced.map(async item => {
    const series = await loadSeries(sourceOf(item)!, data, options);
    return { item, byDate: new Map(series.observations.map(row => [row.date, row.value])) };
  }));
  const from = chart.from && DATE.test(chart.from) ? chart.from : "";
  const dates = [...loaded[0].byDate.keys()].filter(date => date >= from && loaded.every(entry => entry.byDate.has(date))).sort();
  if (dates.length < 2 || loaded.some(entry => dates.filter(date => Number.isFinite(entry.byDate.get(date))).length < 2)) throw new ChartDataError("These series share no dates in that range.");
  // A date marks the period that contains it (Nov 30 → the November point).
  const indexOf = (value: unknown) => {
    const day = typeof value === "string" ? value.slice(0, 10) : "";
    return DATE.test(day) && day >= dates[0] ? dates.findLastIndex(date => date <= day) : -1;
  };
  const markers = (chart.markers ?? []).map(marker => ({ index: indexOf(marker.date), label: marker.label, icon: marker.icon })).filter(marker => marker.index >= 0);
  const band = chart.band ? { from: indexOf(chart.band.from), to: indexOf(chart.band.to), label: chart.band.label } : null;
  const resolved: RecreateChart = {
    ...base,
    labels: axisLabels(dates),
    series: loaded.map(({ item, byDate }) => ({ name: item.name, emphasis: item.emphasis, values: dates.map(date => byDate.get(date)!) })),
    markerIndex: indexOf(chart.markerDate),
    markers,
    band: band && band.from >= 0 && band.to > band.from ? band : null,
    period: { from: dates[0], to: dates[dates.length - 1] },
  };
  return chart.indexToMarker ? indexed(resolved) : resolved;
}

function indexed(chart: RecreateChart): RecreateChart {
  const at = chart.markerIndex >= 0 ? chart.markerIndex : 0;
  return {
    ...chart, unit: "index",
    series: chart.series.map(item => {
      const pivot = finiteAt(item.values, at);
      if (!pivot) throw new ChartDataError(`${item.name} is zero at the marker, so it can't be indexed.`);
      return { ...item, values: item.values.map(value => Math.round(value / pivot * 1000) / 10) };
    }),
  };
}
