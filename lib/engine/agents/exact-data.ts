/**
 * An exact copy's charts, redrawn in our chart style from real data. The chart
 * rebuilder sees each chart the copier boxed, cut from its original slide, and
 * rebuilds the same chart: the same series, scaling, span, marked events and
 * words, from the values the original prints or from the real series (FRED,
 * the S&P 500, or a table on a page the original cites). It never reads values
 * off the picture: a chart whose real numbers it can't find stays cut from the
 * original, and the deck says why. A post without charts skips this stage.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { CHART_FIELDS, dataTools, EXACT_CHART_FIELDS, resolveChart } from "./charts";
import { work } from "./claude";
import { need, rerunNote, today, type StageRunner } from "./context";
import { cropOriginal } from "./exact";
import { EXACT_DATA_CARD, exactPrompt } from "./playbook";
import { originalSlides } from "./research";
import { ExactDataSchema, type ExactDataOutput, type TranscriptOutput } from "./schemas";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The slides whose chart the copier boxed for the chart rebuilder. */
export const chartSlides = (copied: TranscriptOutput) => copied.slides.filter(slide => slide.media.kind === "chart" && slide.media.box);

export const exactData: StageRunner = async context => {
  const copied = need<TranscriptOutput>(context.file, "transcript"), boxed = chartSlides(copied);
  if (!boxed.length) return { output: { note: "No chart to rebuild" }, status: "skipped" };
  const wanted = new Set(boxed.map(slide => slide.original));
  // A rerun the critics didn't send here (the copier fixed words) keeps the charts it already
  // rebuilt, or gave up on, for slides that still show one: their data hasn't changed.
  const previous = context.previous as Partial<ExactDataOutput> | undefined;
  const keep = !context.instructions && Array.isArray(previous?.charts) && Array.isArray(previous?.missing);
  const kept: ExactDataOutput = {
    charts: keep ? previous!.charts!.filter(chart => wanted.has(chart.slide)) : [],
    missing: keep ? previous!.missing!.filter(item => wanted.has(item.slide)) : [],
    notes: keep ? previous!.notes ?? [] : [],
  };
  const done = new Set([...kept.charts.map(chart => chart.slide), ...kept.missing.map(item => item.slide)]);
  const todo = boxed.filter(slide => !done.has(slide.original));
  if (!todo.length) return { output: kept };

  const images = await originalSlides(context), charts = context.cache.chartData;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const slide of todo) {
    const image = images[slide.original - 1];
    if (!image) continue;
    const words = slide.texts.map(entry => entry.text.trim()).filter(Boolean).join(" / ");
    content.push({ type: "text", text: `Original slide ${slide.original}: the chart to rebuild${slide.media.alt ? ` (${slide.media.alt})` : ""}.${words ? ` The slide's words: ${words}` : ""}` });
    const cut = await cropOriginal(image, slide.media.box!).catch(() => null);
    content.push(cut
      ? { type: "image", source: { type: "base64", media_type: "image/jpeg", data: cut.url.slice(cut.url.indexOf(",") + 1) } }
      : { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
  }
  const unreadable = todo.filter(slide => !images[slide.original - 1]);
  if (unreadable.length === todo.length) {
    return { output: { ...kept, missing: [...kept.missing, ...unreadable.map(slide => ({ slide: slide.original, why: "its original slide is missing" }))] } };
  }
  const asked = todo.filter(slide => images[slide.original - 1]).map(slide => slide.original);
  const { caption, owner, url, notes } = context.file.source;
  // The critics number our slides, which can differ from the original's when a slide was left out.
  const ours = copied.slides.flatMap((slide, index) => slide.media.kind === "chart" && index + 1 !== slide.original ? [`our slide ${index + 1} is original slide ${slide.original}`] : []);
  content.push({ type: "text", text: [
    owner ? `Original creator: @${owner}` : "",
    url ? `Original post: ${url}` : "",
    `Original caption:\n${caption || "(none provided)"}`,
    notes ? `Teammate's notes: ${notes}` : "",
    `Hand in slide${asked.length === 1 ? "" : "s"} ${asked.join(", ")}, each rebuilt under charts or explained under missing.`,
    rerunNote(context),
    context.instructions && ours.length ? `The critics number our slides: ${ours.join("; ")}.` : "",
  ].filter(Boolean).join("\n\n") });

  const output = await work({
    role: "data", what: "rebuild the charts", signal: context.signal, usage: context.usage, maxTurns: 16,
    system: exactPrompt(context.profile, `Today is ${today()}.\n\n${CHART_FIELDS}\n\n${EXACT_CHART_FIELDS}`, EXACT_DATA_CARD),
    content,
    tools: dataTools(charts, context.signal),
    serverTools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 }],
    submit: {
      name: "submit_charts", description: "Hand in each boxed chart rebuilt from real data, or under missing with the reason it can't be.", schema: ExactDataSchema,
      check: async value => {
        const seen = new Set<number>();
        for (const item of [...value.charts.map(chart => chart.slide), ...value.missing.map(entry => entry.slide)]) {
          if (!asked.includes(item)) return `Slide ${item} has no chart to rebuild. Hand in only slide${asked.length === 1 ? "" : "s"} ${asked.join(", ")}.`;
          if (seen.has(item)) return `Slide ${item} is handed in twice. Give each slide one chart, or put it under missing.`;
          seen.add(item);
        }
        const left = asked.filter(slide => !seen.has(slide));
        if (left.length) return `Hand in slide${left.length === 1 ? "" : "s"} ${left.join(", ")} too, rebuilt under charts or explained under missing.`;
        // Every chart must actually draw from real data before it is accepted, with the scales it was given:
        // a printed range that leaves out some of the real values goes back to be fixed, not dropped quietly.
        for (const chart of value.charts) {
          try {
            const drawn = await resolveChart(chart.chart, charts, context.signal);
            if (drawn.notes?.length) {
              const fixes = [
                drawn.notes.some(note => note.includes("range")) ? "Set that range to null, or copy the one the original prints for the same dates." : "",
                drawn.notes.some(note => note.startsWith("Indexed")) ? "Index lines only when the original draws them on one scale: set indexToMarker false, or every axis left." : "",
              ];
              return `The chart for slide ${chart.slide}: ${[...drawn.notes, ...fixes].filter(Boolean).join(" ")}`;
            }
          } catch (error) {
            if (context.signal.aborted) throw error;
            return `The chart for slide ${chart.slide} can't be drawn: ${message(error)}`;
          }
        }
        return null;
      },
    },
  });
  return { output: {
    charts: [...kept.charts, ...output.charts],
    missing: [...kept.missing, ...output.missing, ...unreadable.map(slide => ({ slide: slide.original, why: "its original slide is missing" }))],
    notes: [...kept.notes, ...output.notes],
  } satisfies ExactDataOutput };
};
