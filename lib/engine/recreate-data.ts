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
export type FredSeries = {
  id: string; frequency: FredFrequency; observations: Observation[]; source?: DataSourceKind;
  /** FRED's own words for the units ("Level in Thousands", "Percent", "Index"), when FRED gives them. */
  units?: string;
};
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
  const [text, units] = await Promise.all([
    download(url, `FRED series ${id}`, options).catch(error => {
      throw new ChartDataError(error instanceof ChartDataError && /HTTP 404|HTTP 400/.test(error.message) ? `FRED has no series ${id} (${error.message.match(/HTTP \d+/)?.[0]}).` : error instanceof Error ? error.message : `FRED could not be reached for ${id}.`);
    }),
    fredUnits(id, options),
  ]);
  const observations = parseFredCsv(text);
  if (real(observations).length < 2) throw new ChartDataError(`FRED series ${id} has no data in that range.`);
  return { id, frequency, observations: observations.slice(-MAX_POINTS), source: "fred", ...(units ? { units } : {}) };
}

/** A series' units from FRED's graph (its own series API, which the CSV leaves out); null when it doesn't say. */
async function fredUnits(id: string, options: { signal?: AbortSignal; fetch?: typeof fetch }): Promise<string | null> {
  const url = new URL("https://fred.stlouisfed.org/graph/api/series/");
  url.searchParams.set("id", id);
  try {
    const answer = JSON.parse(await download(url, `FRED's units for ${id}`, options)) as { chart_series?: { series_objects?: Record<string, { units?: unknown }> }[] };
    const units = Object.values(answer.chart_series?.[0]?.series_objects ?? {}).map(item => item?.units).find((value): value is string => typeof value === "string" && value.trim() !== "");
    return units ? units.trim().replace(/\s+/g, " ").slice(0, 80) : null;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // The units only help label a scale: a chart is drawn without them.
    return null;
  }
}

/** The short unit a scale of a FRED series takes from FRED's units: K for thousands (7,612 prints 7.6M), M, B; "" for other units and amounts of money, whose $ a scale must show. */
export function unitFromFred(units: string | undefined): string {
  if (!units || /dollar|percent|index|rate/i.test(units)) return "";
  return /\bthousands?\b/i.test(units) ? "K" : /\bmillions?\b/i.test(units) ? "M" : /\bbillions?\b/i.test(units) ? "B" : "";
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
      : `FRED ${series.id}, ${series.frequency}, ${rows.length} points from ${first.date} to ${last.date}.${series.units ? ` Units: ${series.units}${unitFromFred(series.units) ? ` (a scale of it takes unit ${unitFromFred(series.units)})` : ""}.` : ""}`,
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
  /** The last date to show, so a copy ends where its original ends; null or left out for the latest data. */
  to?: string | null;
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
    ...(chart.kind ? { kind: chart.kind } : {}), ...(chart.highlight?.length ? { highlight: chart.highlight } : {}),
    unit: chart.unit, labels: chart.labels, series: chart.series.map(({ name, values, emphasis, axis }) => ({ name, values, emphasis, ...(axis === "right" ? { axis } : {}) })),
    markerIndex: chart.markerIndex, markerLabel: chart.markerLabel, markerIcon: chart.markerIcon, endLabel: chart.endLabel,
    markers: (chart.markers ?? []).flatMap(marker => Number.isInteger(marker.index) ? [{ index: marker.index as number, label: marker.label, icon: marker.icon }] : []),
    band: chart.band && typeof chart.band.from === "number" && typeof chart.band.to === "number" ? { from: chart.band.from, to: chart.band.to, label: chart.band.label } : null,
    // An exact copy's printed ranges and second scale; validateChart keeps them only where they hold the data.
    ...(chart.range ? { range: chart.range } : {}), ...(chart.right ? { right: chart.right } : {}),
  };
  const sourced = chart.series.filter(item => sourceOf(item));
  if (!sourced.length) return chart.indexToMarker ? indexed(base) : base;
  if (sourced.length !== chart.series.length) throw new ChartDataError("A chart can't mix downloaded series with typed-in values.");
  const loaded = await Promise.all(sourced.map(async item => {
    const series = await loadSeries(sourceOf(item)!, data, options);
    return { item, byDate: new Map(series.observations.map(row => [row.date, row.value])), unit: unitFromFred(series.units) };
  }));
  // A scale whose series FRED counts in thousands, millions or billions takes that unit, whatever unit
  // it was given: FRED counts job openings in thousands, so 19,000 prints 19M, as an original that charts
  // them prints it, where an M would print 19B. Other scales, and indexed ones, keep the unit given.
  const unitOf = (unit: string, right: boolean) => {
    const own = [...new Set(loaded.filter(entry => (entry.item.axis === "right") === right).map(entry => entry.unit))];
    return chart.indexToMarker || own.length !== 1 || !own[0] ? unit : own[0];
  };
  const from = chart.from && DATE.test(chart.from) ? chart.from : "", to = chart.to && DATE.test(chart.to) ? chart.to : "9999-12-31";
  // A date stands for the period that starts on it, so an end date in November keeps the November point.
  const dates = [...loaded[0].byDate.keys()].filter(date => date >= from && date <= to && loaded.every(entry => entry.byDate.has(date))).sort();
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
    unit: unitOf(chart.unit, false), ...(chart.right ? { right: { ...chart.right, unit: unitOf(chart.right.unit ?? "", true) } } : {}),
    labels: axisLabels(dates),
    series: loaded.map(({ item, byDate }) => ({ name: item.name, emphasis: item.emphasis, values: dates.map(date => byDate.get(date)!), ...(item.axis === "right" ? { axis: item.axis } : {}) })),
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
