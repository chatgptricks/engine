/**
 * The makers, after the checkpoint: the copywriter writes every word, the
 * chart maker downloads and checks each chart, and the art director picks the
 * real photos. In autopilot the checkpoint itself is taken here: the outline
 * as planned and the headline model's first line.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ask, RecreateError } from "./claude";
import { resolveChart } from "./charts";
import { need, outputOf, rerunNote, type StageRunner } from "./context";
import { coverPage, describePages, followPage, templatePages } from "./pages";
import { rolePrompt } from "./playbook";
import { CopySchema, type Approval, type ChartsOutput, type DataOutput, type Facts, type HooksOutput, type ImagesOutput, type Outline, type ReactionsOutput, type VisualsOutput } from "./schemas";

/** Autopilot's hook: the first option that fits the cover's headline, or the shortest when none does. */
export function autopilotHook(options: HooksOutput["options"], room?: number): number {
  const length = (text: string) => Array.from(text.trim()).length;
  const fits = room ? options.findIndex(option => length(option.text) <= room) : 0;
  if (fits >= 0 || !options.length) return options.length ? fits : -1;
  return options.reduce((best, option, index) => length(option.text) < length(options[best].text) ? index : best, 0);
}

export const autoApprove: StageRunner = async context => {
  const planned = need<Outline>(context.file, "outline"), hooks = need<HooksOutput>(context.file, "hooks");
  const cover = coverPage(templatePages(context.template));
  const room = (cover?.text.find(slot => /headline/i.test(slot.slot)) ?? cover?.text[0])?.maxCharacters;
  const option = autopilotHook(hooks.options, room);
  if (option < 0) throw new RecreateError("There are no hook options to choose from.", 502);
  return { output: { outline: { slides: planned.slides, why: planned.why }, hook: { text: hooks.options[option].text, option }, notes: "" } satisfies Approval };
};

export const copy: StageRunner = async context => {
  const { file, profile, template } = context;
  const approval = need<Approval>(file, "approval"), f = outputOf<Facts>(file, "facts"), d = outputOf<DataOutput>(file, "data");
  const posts = outputOf<ReactionsOutput>(file, "reactions")?.reactions ?? [];
  const pages = templatePages(template), follow = followPage(pages), format = profile.format ?? { noFinalPeriods: true, bodyMaxLines: 2 };
  const plan = approval.outline.slides.map((slide, index) => {
    const page = pages.find(candidate => candidate.index === slide.templatePage);
    const chart = slide.chartId ? d?.charts.find(item => item.id === slide.chartId) : undefined;
    return {
      slide: index + 1, templatePage: slide.templatePage, page: page?.label, kind: slide.kind, purpose: slide.purpose, points: slide.points,
      slots: page?.text.map(slot => slot.slot) ?? [],
      ...(chart ? { chart: `${chart.purpose}; source line should name: ${chart.source}` } : {}),
      ...(slide.reactionIds.length ? { posts: slide.reactionIds.map(id => posts.find(post => post.id === id)).filter(Boolean).map(post => `${post!.author.name}: ${post!.text.replace(/\s+/g, " ").slice(0, 200)}`) } : {}),
    };
  });
  const rules = [
    `TEMPLATE "${template.name}" PAGES\n${describePages(pages)}`,
    "Write one entry per outline slide, in order, with that slide's templatePage. Fill every text slot listed for its page with the exact slot names; use \"\" only for a source slot with no source.",
    "Line breaks only between two complete sentences or phrases. Never split one sentence across lines; the template wraps long lines itself.",
    "List slots (names ending in -items): 3-5 short items, one per line, separated by line breaks. No bullet characters or numbering.",
    `Body text under a title is at most ${format.bodyMaxLines} lines.${format.noFinalPeriods ? " No text box ends with a period." : ""}`,
    follow ? `Follow page (page ${follow.index}): its first line "${profile.followCta.line1}" is fixed. Its text slot takes only the second line, at most ${profile.followCta.maxChars} characters.` : "",
    pages.some(page => page.text.some(slot => slot.slot === "cover-remark")) ? `cover-remark: a brief line under the cover headline, in capitals, at most about 30 characters, when there's something worth saying (for example HERE'S OUR TOP 16 SELECTION for a list post). Otherwise write "${profile.swipeText}".` : "",
    "caption: our voice and language. A hook line, 2-4 short lines of context, a source line, then up to 5 relevant hashtags.",
  ].filter(Boolean).join("\n\n");
  const written = await ask({
    role: "copy", what: "write the slides", signal: context.signal, usage: context.usage, schema: CopySchema,
    system: rolePrompt("copy", profile, rules),
    content: [
      `APPROVED HOOK (the cover headline)\n${approval.hook.text}`,
      `APPROVED OUTLINE\n${JSON.stringify(plan)}`,
      approval.notes ? `NOTES FROM THE PERSON WHO APPROVED IT\n${approval.notes}` : "",
      `FACTS\n${f ? JSON.stringify(f) : "(not available)"}`,
      `ORIGINAL CAPTION\n${file.source.caption || "(none)"}`,
      file.source.notes ? `TEAMMATE'S NOTES\n${file.source.notes}` : "",
      rerunNote(context),
    ].filter(Boolean).join("\n\n"),
  });
  return { output: written };
};

export const charts: StageRunner = async context => {
  const approval = need<Approval>(context.file, "approval"), d = outputOf<DataOutput>(context.file, "data");
  const wanted = [...new Set(approval.outline.slides.flatMap(slide => slide.chartId ? [slide.chartId] : []))];
  if (!wanted.length) return { status: "skipped", output: { charts: [] } satisfies ChartsOutput };
  const results: ChartsOutput["charts"] = [];
  for (const id of wanted) {
    const spec = d?.charts.find(chart => chart.id === id);
    if (!spec) { results.push({ id, ok: false, error: "The data stage has no chart with this id.", points: 0, from: "", to: "" }); continue; }
    try {
      const chart = await resolveChart(spec.chart, context.cache.chartData, context.signal);
      results.push({ id, ok: true, error: "", points: chart.labels.length, from: chart.period?.from ?? chart.labels[0] ?? "", to: chart.period?.to ?? chart.labels.at(-1) ?? "" });
    } catch (error) {
      if (context.signal.aborted) throw error;
      results.push({ id, ok: false, error: error instanceof Error ? error.message : "The chart couldn't be drawn.", points: 0, from: "", to: "" });
    }
  }
  return { output: { charts: results } satisfies ChartsOutput };
};

const PhotoPicks = z.object({
  picks: z.array(z.object({ slide: z.number().int().describe("Slide number as listed"), candidate: z.string().describe("Candidate id"), alt: z.string().describe("Plain description of the photo for screen readers") })),
  notes: z.array(z.string()),
});
/** X serves a small rendition for previews. */
const smallImage = (url: string) => /pbs\.twimg\.com\/media\//.test(url) ? url.replace(/([?&]name=)[^&]+/, "$1small") : url;

export const images: StageRunner = async context => {
  const { file, profile, template } = context;
  const approval = need<Approval>(file, "approval"), candidates = outputOf<VisualsOutput>(file, "visuals")?.candidates ?? [];
  const pages = templatePages(template);
  const needs = approval.outline.slides.flatMap((slide, index) => {
    const page = pages.find(candidate => candidate.index === slide.templatePage);
    return page?.photo.length && !slide.chartId && !page.cards ? [{ slide: index + 1, page: page.label, purpose: slide.purpose, photo: slide.photo }] : [];
  });
  if (!needs.length) return { status: "skipped", output: { photos: [], notes: [] } satisfies ImagesOutput };
  const missing = (list: typeof needs) => list.map(item => `Slide ${item.slide} (${item.page}): add a photo${item.photo ? ` of ${item.photo}` : ""}`);
  if (!candidates.length) return { output: { photos: [], notes: missing(needs) } satisfies ImagesOutput };
  const listing = `SLIDES THAT NEED A PHOTO\n${needs.map(item => `- slide ${item.slide} (${item.page}): ${item.purpose}${item.photo ? `; wanted: ${item.photo}` : ""}`).join("\n")}`;
  const described = `CANDIDATES\n${candidates.map(item => `- ${item.id}: ${item.description || "(no description)"} [${item.credit}]`).join("\n")}`;
  const pick = (content: string | Anthropic.Beta.BetaContentBlockParam[]) => ask({
    role: "art", what: "choose the photos", effort: "medium", signal: context.signal, usage: context.usage, schema: PhotoPicks,
    system: rolePrompt("images", profile, "Choose at most one candidate per slide; leave a slide out when nothing fits. A candidate may be used once."), content,
  });
  let picked: z.infer<typeof PhotoPicks>;
  try {
    // The art director looks at the candidates themselves.
    picked = await pick([
      ...candidates.flatMap((item): Anthropic.Beta.BetaContentBlockParam[] => [{ type: "text", text: `Candidate ${item.id}:` }, { type: "image", source: { type: "url", url: smallImage(item.url) } }]),
      { type: "text", text: [listing, described, rerunNote(context)].filter(Boolean).join("\n\n") },
    ]);
  } catch (error) {
    if (context.signal.aborted || error instanceof RecreateError) throw error;
    // An image Claude can't fetch fails the request: choose from the descriptions instead.
    picked = await pick([listing, described, rerunNote(context)].filter(Boolean).join("\n\n"));
  }
  const used = new Set<string>(), photos: ImagesOutput["photos"] = [];
  for (const choice of picked.picks) {
    const candidate = candidates.find(item => item.id === choice.candidate), slide = choice.slide - 1;
    if (!candidate || used.has(candidate.id) || photos.some(photo => photo.slide === slide) || !needs.some(item => item.slide === choice.slide)) continue;
    used.add(candidate.id);
    photos.push({ slide, url: candidate.url, alt: choice.alt, credit: candidate.credit, sourceUrl: candidate.sourceUrl });
  }
  return { output: { photos, notes: [...picked.notes, ...missing(needs.filter(item => !photos.some(photo => photo.slide === item.slide - 1)))] } satisfies ImagesOutput };
};
