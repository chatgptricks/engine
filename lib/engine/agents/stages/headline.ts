/**
 * Stage 5, headline, and the checkpoint's helpers (build step C).
 *
 * The headline stage asks the headline model for options and orders them as
 * decision 1 says: the original's headline leads when the post performs and
 * its headline passed the check. Until build step C lands it isn't built.
 *
 * The helpers below already work: the orchestrator's approve action and the
 * autopilot use them. Its role cards are ../cards/headline.ts and
 * ../cards/approval.ts.
 */
import type { HeadlineOption, SavePickInput } from "../../headline-model";
import type { PageProfile } from "../../page-profiles";
import type { PostFile } from "../../post-files";
import { RecreateError } from "../claude";
import { need, outputOf, type StageRunner } from "../context";
import { coverPage, templatePages } from "../pages";
import type { HeadlineCandidate, Headlines, Plan, PlanApproval, Research, SourceNotes, StoryBrief } from "../schemas";

export const MAX_PLAN_SLIDES = 20;
/** The most posts from X one reaction slide shows. */
export const MAX_POSTS_PER_SLIDE = 3;
export const MAX_HEADLINE_CHARACTERS = 200;

export const headline: StageRunner = async () => {
  throw new RecreateError("Gathering headline options isn't built yet (build step C).", 501);
};

/** Keeps a plan to slides that can be built: known kinds, real posts from the research, at most 20 slides. */
export function normalizePlan(plan: Plan, known: { reactions: string[] }): Plan {
  const slides = plan.slides.flatMap(slide => {
    const purpose = slide.purpose.trim(), points = slide.points.map(point => point.trim()).filter(Boolean);
    const reactionIds = [...new Set(slide.reactionIds.filter(id => known.reactions.includes(id)))].slice(0, MAX_POSTS_PER_SLIDE);
    if (slide.kind === "reaction") return reactionIds.length ? [{ ...slide, purpose, points, reactionIds, chart: "", photo: "" }] : [];
    return [{ ...slide, purpose, points, reactionIds: [], chart: slide.chart.trim(), photo: slide.photo.trim() }];
  }).slice(0, MAX_PLAN_SLIDES);
  return { slides, why: plan.why.trim() };
}

/** A person's (or an agent's) headline: one of the options by index, or their own words. */
export function chooseHeadline(options: HeadlineCandidate[], input: { option?: number; text?: string }): PlanApproval["headline"] {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text) {
    if ([...text].length > MAX_HEADLINE_CHARACTERS) throw new RecreateError(`Keep the headline under ${MAX_HEADLINE_CHARACTERS} characters.`);
    return { text, option: options.findIndex(option => option.text.trim() === text) };
  }
  const index = input.option;
  if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < options.length) return { text: options[index].text, option: index };
  throw new RecreateError("Pick one of the headline options or write your own.");
}

/** Autopilot's headline: the first option that fits the cover's headline, else the shortest. -1 when there are none. */
export function autopilotHeadline(options: HeadlineCandidate[], room?: number): number {
  const length = (text: string) => Array.from(text.trim()).length;
  const fits = room ? options.findIndex(option => length(option.text) <= room) : 0;
  if (fits >= 0 || !options.length) return options.length ? fits : -1;
  return options.reduce((best, option, index) => length(option.text) < length(options[best].text) ? index : best, 0);
}

/** The approval stage in autopilot: the brief's plan as written and the first headline that fits the cover. */
export const autoApprove: StageRunner = async context => {
  const planned = need<StoryBrief>(context.file, "brief"), lines = need<Headlines>(context.file, "headline");
  const cover = coverPage(templatePages(context.template));
  const room = (cover?.text.find(slot => /headline/i.test(slot.slot)) ?? cover?.text[0])?.maxCharacters;
  const option = autopilotHeadline(lines.options, room);
  if (option < 0) throw new RecreateError("There are no headline options to choose from.", 502);
  const reactions = outputOf<Research>(context.file, "research")?.reactions.map(post => post.id) ?? [];
  const plan = normalizePlan({ slides: planned.slides, why: planned.why }, { reactions });
  return { output: { plan, headline: { text: lines.options[option].text, option }, notes: "" } satisfies PlanApproval };
};

/** What a person's headline choice tells the headline model; null when it shouldn't hear about it (no model lines, not a person). */
export function pickPayload(file: PostFile, profile: PageProfile): SavePickInput | null {
  const approval = outputOf<PlanApproval>(file, "approval"), lines = outputOf<Headlines>(file, "headline");
  if (!approval || !lines || file.stages.approval?.by !== "human" || lines.source !== "headline-model" || !lines.modelOptions.length) return null;
  const originalHeadline = outputOf<StoryBrief>(file, "brief")?.originalHeadline || outputOf<SourceNotes>(file, "source")?.template.cover.headline.text || "";
  const model: HeadlineOption[] = lines.modelOptions.map(option => ({ text: option.text, ...(option.framework ? { framework: option.framework } : {}), ...(option.sources ? { sources: option.sources } : {}) }));
  const base = { story: lines.story, originalHeadline, account: profile.id };
  const same = (a: string, b: string) => a.trim() === b.trim();
  if (profile.language !== "en") {
    // Only the model's own English lines go back; a line it didn't write counts as none of them.
    const chosen = approval.headline.option >= 0 ? lines.options[approval.headline.option] : undefined;
    const english = chosen?.by === "headline-model" ? chosen.english ?? chosen.text : undefined;
    const index = english ? model.findIndex(option => same(option.text, english)) : -1;
    return { ...base, options: model, chosen: index, finalText: index >= 0 ? model[index].text : "" };
  }
  // The original's line, the copywriter's and agents' go along, tagged, so the model sees what it was up against.
  const tag = (by: HeadlineCandidate["by"]) => by === "original" ? "original" : by === "agent" ? "engine-agent" : "engine-copywriter";
  const others = lines.options.filter(option => option.by !== "headline-model" && !model.some(item => same(item.text, option.text)))
    .map(option => ({ text: option.text, framework: option.framework, sources: [tag(option.by)] }));
  const options = [...model, ...others];
  let index = options.findIndex(option => same(option.text, approval.headline.text));
  if (index < 0) { options.push({ text: approval.headline.text, sources: ["human"] }); index = options.length - 1; }
  return { ...base, options, chosen: index, finalText: approval.headline.text };
}
