/**
 * The story desk: the story editor plans the slides, and the hook options are
 * gathered from the headline model (best first), with near-duplicates dropped,
 * plus lines from the copywriter, who writes them with the headline engine
 * (Ivan's headline skill: archetype, original check, options from plain to most
 * viral, top pick). Spanish pages see the model's lines adapted to Spanish.
 */
import { z } from "zod";
import { isHeadlineModelConfigured, requestHeadlines } from "../headline-model";
import { ask, RecreateError } from "./claude";
import { need, outputOf, rerunNote, type StageRunner } from "./context";
import { reactionTextLines } from "../x-reactions";
import { EngineHooksSchema, headlineEngineInstructions, type EngineHooks } from "./headline-engine";
import { coverPage, describePages, reactionPageFor, templatePages, type PageCatalog } from "./pages";
import { rolePrompt } from "./playbook";
import { OutlineSchema, type Brief, type DataOutput, type Facts, type HookOption, type HooksOutput, type Outline, type OutlineSlide, type ReactionsOutput } from "./schemas";
import { pairedPages } from "./pages";

export const MAX_SLIDES = 20;
/** The headline model can take minutes to wake; past this the copywriter writes the hooks. */
export const HOOKS_TIMEOUT_MS = 6 * 60_000;

/**
 * Keeps an outline to what the template and research can fill: real pages,
 * charts the data stage built, reaction slides with real posts, each on the
 * Reaction page with as many cards as it has posts (up to the most a page holds),
 * and photo pairs on two slides in a row (a lone half becomes a one-slide photo
 * page). The deck still moves posts that don't fit one page together onto the next.
 */
export function normalizeOutline(outline: Outline, pages: PageCatalog[], known: { charts: string[]; reactions: string[] }): Outline {
  const planned = outline.slides.flatMap((slide): OutlineSlide[] => {
    const page = pages.find(candidate => candidate.index === slide.templatePage);
    if (!page) return [];
    if (page.cards || slide.kind === "reaction") {
      const ids = [...new Set(slide.reactionIds.filter(id => known.reactions.includes(id)))];
      const target = ids.length ? reactionPageFor(pages, ids.length) : undefined;
      if (!target) return [];
      return [{ ...slide, kind: "reaction" as const, templatePage: target.index, reactionIds: ids.slice(0, target.cards), chartId: null, photo: "" }];
    }
    return [{ ...slide, chartId: slide.chartId && known.charts.includes(slide.chartId) ? slide.chartId : null, reactionIds: [] }];
  }).slice(0, MAX_SLIDES);
  const placed = pairedPages(planned.map(slide => ({ page: pages.find(page => page.index === slide.templatePage)!, chart: Boolean(slide.chartId) })), pages);
  const slides = planned.flatMap((slide, index): OutlineSlide[] => {
    const page = placed[index];
    if (!page) return [];
    // A pair's photo is chosen once, for its first slide.
    if (page.pair) return [{ ...slide, photo: page.pair.part === "start" ? slide.photo || planned[index + 1].photo : "" }];
    return [{ ...slide, templatePage: page.index }];
  });
  return { slides, why: outline.why };
}

export const outline: StageRunner = async context => {
  const { file, profile, template } = context;
  const b = need<Brief>(file, "brief"), f = outputOf<Facts>(file, "facts"), d = outputOf<DataOutput>(file, "data");
  const posts = outputOf<ReactionsOutput>(file, "reactions")?.reactions ?? [];
  const all = templatePages(template), usable = all.filter(page => !page.cards || posts.length >= page.cards);
  const planned = await ask({
    role: "story", what: "plan the slides", signal: context.signal, usage: context.usage,
    system: rolePrompt("outline", profile), schema: OutlineSchema,
    content: [
      `BRIEF\n${JSON.stringify(b)}`,
      `FACTS\n${f ? JSON.stringify(f) : "(not available)"}`,
      `CHARTS BUILT BY THE DATA STAGE\n${d?.charts.length ? d.charts.map(chart => `- ${chart.id}: ${chart.purpose} (recreates: ${chart.recreates}; ${chart.source})`).join("\n") : "(none: plan no chart slides)"}`,
      `REAL REACTIONS FROM X (size: lines on a card, and whether a photo shows under the text)\n${posts.length ? posts.map(post => `- ${post.id}: ${post.author.name} @${post.author.handle}, ${post.likes} likes, ~${reactionTextLines(post)} line${reactionTextLines(post) === 1 ? "" : "s"}${post.media ? " + photo" : ""}: ${post.text.replace(/\s+/g, " ").slice(0, 280)} (why: ${post.why})`).join("\n") : "(none: plan no reaction slides)"}`,
      `TEMPLATE "${template.name}" PAGES (templatePage is the page number)\n${describePages(usable)}`,
      file.source.notes ? `TEAMMATE'S NOTES\n${file.source.notes}` : "",
      rerunNote(context),
    ].filter(Boolean).join("\n\n"),
  });
  const normalized = normalizeOutline(planned, all, { charts: d?.charts.map(chart => chart.id) ?? [], reactions: posts.map(post => post.id) });
  if (!normalized.slides.length) throw new RecreateError("The story editor's plan used no pages this template has. Try again.", 502);
  // Page names travel with the outline so the checkpoint can label slides without the template.
  return { output: { ...normalized, pages: all.map(page => ({ index: page.index, label: page.label, cards: page.cards })) } };
};

// ── Hooks ───────────────────────────────────────────────────────────────────
const LABEL = /^(?:just in|breaking|new|update|developing|alert)\s*[:\-–—|]\s*/i;
function hookWords(text: string): Set<string> {
  return new Set(text.replace(LABEL, "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}%$]+/gu, " ").trim().split(" ").filter(word => word.length > 1));
}
/** A credit, source or link line the headline model sometimes sends back with its hooks; never a cover. */
const NOT_A_HOOK = /^\s*(?:(?:photo|image)\s+)?(?:credits?|sources?|via|h\/t|caption|link)\s*[:\-–—|]|https?:\/\/|www\./i;
/** Drops lines that aren't hooks and near-duplicates (same words once a "JUST IN:" style label is set aside), keeping the first of each. */
export function distinctHooks<T extends { text: string }>(options: T[], max = 7): T[] {
  const kept: { option: T; words: Set<string> }[] = [];
  for (const option of options) {
    const words = hookWords(option.text);
    if (!option.text.trim() || !words.size || NOT_A_HOOK.test(option.text)) continue;
    const similar = kept.some(item => {
      const shared = [...words].filter(word => item.words.has(word)).length;
      return shared / (words.size + item.words.size - shared) >= 0.6;
    });
    if (!similar) kept.push({ option, words });
  }
  return kept.slice(0, max).map(item => item.option);
}

/** The checked story for the headline model: the brief's facts plus the corrections research made. */
export function hookStory(b: Brief, f?: Facts): string {
  const corrected = (f?.claims ?? []).filter(claim => claim.verdict === "corrected").slice(0, 3).map(claim => `${claim.detail}`.trim()).filter(Boolean);
  return [b.story.trim(), ...corrected].join(" ").slice(0, 1500);
}

/**
 * The engine's lines in the order to offer them: the top pick (or the original
 * it kept), then the 4-7 band where most winners live, then the boldest, then
 * the plain ones; lines that fit the cover before lines that don't.
 */
export function engineHookOrder(engine: EngineHooks, room?: number): HookOption[] {
  const fits = (text: string) => !room || Array.from(text.trim()).length <= room;
  const band = (level: number) => level >= 4 && level <= 7 ? 0 : level >= 8 ? 1 : 2;
  const lines: (HookOption & { rank: number })[] = engine.hooks.map((hook, index) => ({
    text: hook.text.trim(), framework: hook.framework || engine.archetype, by: "copywriter" as const, english: null,
    rank: index === engine.topPick ? -1 : band(hook.level) * 10 - Math.min(hook.level, 9) / 10,
  }));
  const original = engine.original.text.trim();
  if ((engine.original.verdict === "keep" || engine.original.verdict === "light-edit") && original) {
    lines.push({ text: original, framework: engine.original.verdict === "keep" ? "original" : "original, light edit", by: "copywriter", english: null, rank: engine.topPick < 0 ? -2 : 5 });
  }
  return lines.filter(line => line.text)
    .sort((a, b) => Number(!fits(a.text)) - Number(!fits(b.text)) || a.rank - b.rank)
    .map(line => ({ text: line.text, framework: line.framework, by: line.by, english: line.english }));
}

const Adapted = z.object({ hooks: z.array(z.object({ english: z.string(), text: z.string() })) });

export const hooks: StageRunner = async context => {
  const { file, profile } = context;
  const b = need<Brief>(file, "brief"), f = outputOf<Facts>(file, "facts");
  const story = hookStory(b, f);
  const cover = coverPage(templatePages(context.template));
  const room = (cover?.text.find(slot => /headline/i.test(slot.slot)) ?? cover?.text[0])?.maxCharacters;
  let options: HookOption[] = [], modelOptions: HooksOutput["modelOptions"] = [], source: HooksOutput["source"] = "copywriter", checked = story, note = "";
  if (isHeadlineModelConfigured()) {
    try {
      const result = await requestHeadlines({ story, originalHeadline: b.originalHeadline, count: 5, research: false, timeoutMs: HOOKS_TIMEOUT_MS, signal: context.signal });
      modelOptions = result.options.map(option => ({ text: option.text, ...(option.framework ? { framework: option.framework } : {}), ...(option.sources ? { sources: option.sources } : {}) }));
      checked = result.story || story;
      options = distinctHooks(result.options.map(option => ({ text: option.text.trim(), framework: option.framework ?? "", by: "headline-model" as const, english: null })));
      source = "headline-model";
    } catch (error) {
      if (context.signal.aborted) throw error;
      note = `The headline model didn't answer (${error instanceof Error ? error.message : "unknown error"}), so the copywriter wrote these hooks.`;
    }
  } else {
    note = "The headline model isn't set up on this server (HEADLINE_API_KEY), so the copywriter wrote these hooks.";
  }
  if (profile.language === "es" && options.length) {
    const adapted = await ask({
      role: "hooks", what: "adapt the hooks to Spanish", effort: "medium", signal: context.signal, usage: context.usage, schema: Adapted,
      system: rolePrompt("hooks", profile, "Adapt each English cover hook into natural Spanish with the same meaning and punch: native phrasing, the same energy and cadence, never word for word, no corporate filler. Keep ALL CAPS and accents (MÁS, not MAS). Return every line, in order."),
      content: options.map(option => option.text).join("\n"),
    });
    options = options.flatMap((option, index): HookOption[] => {
      const match = adapted.hooks.find(item => item.english.trim() === option.text) ?? adapted.hooks[index];
      return match?.text.trim() ? [{ ...option, english: option.text, text: match.text.trim() }] : [];
    });
  }
  // The copywriter always adds lines of its own, written with the headline engine (or plainly, when
  // the brand guide asks), so a person sees both sources.
  const wanted = Math.max(5 - options.length, 2);
  const plain = context.guide?.hooks.method === "plain";
  const engine = await ask({
    role: "hooks", what: plain ? "write hook options in the page's voice" : "write hook options with the headline engine", effort: "medium", signal: context.signal, usage: context.usage, schema: EngineHooksSchema,
    system: rolePrompt("hooks", profile, [
      headlineEngineInstructions({ language: profile.language, room, notes: context.guide?.hooks.notes, plain }),
      `Write 10 cover hooks in ${profile.language === "es" ? "Spanish" : "English"}${plain ? "" : " with the headline engine"}, least to most viral, all true to the facts${options.length ? ", each different in style and words from the lines already there" : ""}. Then name your top pick.`,
    ].join("\n\n")),
    content: [`STORY\n${story}`, `ORIGINAL HEADLINE\n${b.originalHeadline || "(none)"}`, options.length ? `LINES ALREADY THERE (don't repeat their style or words)\n${options.map(option => `- ${option.text}`).join("\n")}` : "", rerunNote(context)].filter(Boolean).join("\n\n"),
  });
  const written = engineHookOrder(engine, room);
  options = distinctHooks([...options, ...written], options.length + wanted);
  const engineNote = `${plain ? "Plain hooks" : "Headline engine"}: ${engine.archetype.toLowerCase()} story, original headline ${engine.original.verdict}${written[0] ? `, top pick “${written[0].text}”` : ""}${engine.why.trim() ? ` (${engine.why.trim()})` : ""}.`;
  note = [note, engineNote].filter(Boolean).join(" ");
  if (!options.length) throw new RecreateError("No hook options could be written. Try again.", 502);
  return { output: { options, source, story: checked, modelOptions, note } satisfies HooksOutput };
};
