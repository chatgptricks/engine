/** Chart data for the agents: the download tools the data researcher calls, and turning a written chart into a drawable one. */
import { z } from "zod";
import { validateChart, type RecreateChart } from "../recreate-chart";
import { ChartDataError, describeSeries, fetchFredSeries, fetchSp500History, resolveChartData, SP500_HISTORY_ID, type ChartData, type FredChartSpec, type FredFrequency, type FredSeries } from "../recreate-data";
import { ToolError, type ClientTool } from "./claude";
import type { WrittenChart } from "./schemas";

/** The written chart → the data layer's spec. Tolerates older or partial charts (missing source, markers, band). */
export function chartSpecFrom(chart: WrittenChart): FredChartSpec {
  const sourceOf = (item: WrittenChart["series"][number]) => item.source ?? (item.fred ? "fred" : "typed");
  const downloaded = chart.series.some(item => sourceOf(item) !== "typed");
  return {
    unit: chart.unit, labels: chart.labels ?? [], from: chart.from ?? null, markerDate: chart.markerDate ?? null, indexToMarker: Boolean(chart.indexToMarker),
    markerIndex: chart.markerIndex, markerLabel: chart.markerLabel ?? "", markerIcon: chart.markerIcon ?? "none", endLabel: chart.endLabel ?? "value",
    series: chart.series.map(item => {
      const source = sourceOf(item);
      return {
        name: item.name, values: item.values ?? [], emphasis: item.emphasis,
        fred: source === "fred" ? item.fred : null,
        source: source === "sp500_history" ? { kind: "sp500_history" as const, id: SP500_HISTORY_ID } : source === "fred" && item.fred ? { kind: "fred" as const, id: item.fred } : null,
      };
    }),
    markers: (chart.markers ?? []).map(marker => downloaded ? { date: marker.date, label: marker.label, icon: marker.icon } : { index: marker.index, label: marker.label, icon: marker.icon }),
    band: chart.band ? downloaded
      ? { from: chart.band.fromDate ?? "", to: chart.band.toDate ?? "", label: chart.band.label }
      : { from: chart.band.fromIndex, to: chart.band.toIndex, label: chart.band.label } : null,
  };
}

export async function resolveChart(chart: WrittenChart, data: ChartData, signal?: AbortSignal): Promise<RecreateChart> {
  return validateChart(await resolveChartData(chartSpecFrom(chart), data, { signal }));
}

/** Where a chart's numbers come from, for its alt text. */
export function chartSources(chart: WrittenChart): string[] {
  const spec = chartSpecFrom(chart);
  const fred = spec.series.flatMap(series => series.source?.kind === "fred" ? [series.source.id.toUpperCase()] : []);
  return [...(fred.length ? [`FRED ${fred.join(", ")}`] : []), ...(spec.series.some(series => series.source?.kind === "sp500_history") ? ["S&P 500 history, Shiller data"] : [])];
}

/** How a writer fills a chart's fields, for the agents that write one. */
export const CHART_FIELDS = `How to write a chart:
- Downloaded series: source "fred" with fred set to the FRED id, or source "sp500_history" (fred null) for the S&P 500 before 2016. Leave values and labels empty; Engine fills the real data. from: the first date to show (YYYY-MM-DD). markerDate: the main event (YYYY-MM-DD) or null. markers: up to 2 more events as {date, label, icon "none", index -1}. band: a shaded period as {fromDate, toDate, fromIndex -1, toIndex -1, label}, or null. One chart may combine fred and sp500_history series, but not typed values.
- Typed series (other sources): source "typed", fred null; copy the values exactly (you may downsample evenly to at most 300 points); labels has one x-axis label per point ("" for unlabeled points); markerIndex marks the main event (or -1); markers use index (date null); band uses fromIndex and toIndex (dates null); from and markerDate null.
- Series in different units (for example job openings and a stock index): set indexToMarker true so every series is 100 at the marker and they share one honest scale; otherwise false.
- unit: a short suffix such as %, $, K, M or pts, or "" (or "index" when indexToMarker). endLabel "change_since_marker" shows each series' change since the marker. markerIcon "openai" only when the event is an OpenAI or ChatGPT release. Series names: short, 2-3 words. Emphasize the series the story is about.`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** fred_series and sp500_history: real series kept in `data` for the chart maker. */
export function dataTools(data: ChartData, signal?: AbortSignal): ClientTool[] {
  // Engine keeps the full history so a chart can start earlier than research looked.
  const windowed = (series: FredSeries, start?: string) => start ? { ...series, observations: series.observations.filter(row => row.date >= start) } : series;
  const guarded = async (run: () => Promise<string>) => {
    try { return await run(); } catch (error) {
      if (signal?.aborted) throw error;
      throw new ToolError(error instanceof ChartDataError ? error.message : "The download failed.");
    }
  };
  return [
    {
      name: "sp500_history",
      description: "Download the S&P 500's monthly history since 1871 (average of daily closes; Robert Shiller's data). Use it for any S&P 500 chart that starts before 2016, since FRED's SP500 only covers the last 10 years. Returns the range, high and low, and sampled points. Engine keeps the full series, so a chart can use it by setting a series' source to sp500_history.",
      schema: z.object({ start: z.string().regex(DATE).optional().describe("First date to describe, YYYY-MM-DD. Omit for the full history.") }),
      run: input => guarded(async () => {
        const series = await fetchSp500History({ signal });
        data.set(`${SP500_HISTORY_ID}:monthly`, series);
        return describeSeries(windowed(series, input.start as string | undefined));
      }),
    },
    {
      name: "fred_series",
      description: "Download a full official time series from FRED (Federal Reserve Bank of St. Louis): US job openings, unemployment, payrolls, wages, CPI, interest rates, GDP, housing, the S&P 500 (last 10 years only) and thousands more. Returns the series' range, high and low, and its points (sampled when long). Engine keeps the full series, so a chart can use it by id. Use it for any chart of an official series instead of copying numbers from articles.",
      schema: z.object({
        series_id: z.string().min(1).max(40).describe("FRED series id, for example JTSJOL (job openings), UNRATE, PAYEMS, CPIAUCSL, FEDFUNDS, SP500."),
        start: z.string().regex(DATE).optional().describe("First date to include, YYYY-MM-DD. Omit for the full history."),
        frequency: z.enum(["monthly", "quarterly", "annual", "native"]).optional().describe("Averaged to this frequency. Default monthly."),
      }),
      run: input => guarded(async () => {
        const start = input.start as string | undefined;
        const series = await fetchFredSeries(input.series_id, { frequency: (input.frequency ?? "monthly") as FredFrequency, signal });
        data.set(`${series.id}:${series.frequency}`, series);
        const view = windowed(series, start);
        if (view.observations.filter(row => Number.isFinite(row.value)).length < 2) throw new ChartDataError(`FRED series ${series.id} has no data from ${start}.`);
        return describeSeries(view);
      }),
    },
  ];
}
