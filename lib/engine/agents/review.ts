/**
 * The critics. Code checks the house rules on the saved deck; the fact critic
 * reads every word against the research; the design critic looks at the slides
 * rendered exactly as Export draws them, next to the original. Must-fix issues
 * go back to the agent who can fix them, at most twice; what is left is
 * reported on the deck as a comment.
 */
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import type { DesignDocument } from "../../template-editor/model";
import { seamOf, spanPairs } from "../../template-editor/spanning-photos";
import type { PageProfile } from "../page-profiles";
import { renderSlides, type SlideRender } from "../slide-render";
import { guideDeckChecks, guideExampleBlocks } from "./brand";
import { ask, imageBlock, type SourceImage } from "./claude";
import { need, outputOf, type StageContext, type StageRunner } from "./context";
import { commentOnDeck, loadDeck } from "./deck";
import { coverPage, followPage, templatePages, type PageCatalog } from "./pages";
import { rolePrompt } from "./playbook";
import { originalSlides } from "./research";
import { CriticSchema, type ChartsOutput, type CriticOutput, type DataOutput, type DeckOutput, type Facts, type Issue, type ReviewOutput } from "./schemas";

/** Fix rounds after the first review: the critics send work back at most this many times. */
export const MAX_FIX_ROUNDS = 2;
const RENDER_BUDGET_MS = 150_000;
/** Two short lines of body text. Spanish runs a little longer, and smart text shrinks to fit, so over this is a should-fix. */
const BODY_LIMIT = 80;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

type DeckPage = DeckOutput["pages"][number];

/** House rules code can check on the saved deck, plus pages Export would refuse. */
export function houseChecks(document: DesignDocument, pages: DeckPage[], catalog: PageCatalog[], profile: PageProfile, renders?: Pick<SlideRender, "pageId" | "exportError">[] | null): Issue[] {
  const issues: Issue[] = [];
  const add = (slide: number, problem: string, fix: string, severity: Issue["severity"], route: Issue["route"]) => issues.push({ slide, problem, fix, severity, route });
  const cover = coverPage(catalog), follow = followPage(catalog);
  const headline = cover?.text.find(slot => slot.role === "cover")?.slot ?? cover?.text[0]?.slot;
  const noFinalPeriods = profile.format?.noFinalPeriods ?? true, locale = profile.language === "es" ? "es" : "en";
  document.pages.forEach((page, index) => {
    const slide = index + 1, templatePage = pages.find(item => item.pageId === page.id)?.templatePage;
    for (const element of page.canvas?.elements ?? []) {
      if (element.hidden || !element.slot || element.templateRole === "brand" || element.slot.startsWith("reaction-")) continue;
      if (element.type === "image") {
        // Topic logos are often vector logos (SVG), never placeholders: they stay hidden until filled.
        if (element.templateRole === "media" && !element.slot.startsWith("topic-logo") && /^data:image\/svg\+xml/.test(element.src)) {
          add(slide, "The photo slot still shows the template's placeholder", element.directive ? `Add a photo: ${element.directive}` : "Add a photo", "should_fix", "none");
        }
        continue;
      }
      if (element.type !== "text") continue;
      const text = element.text.trim(), slot = element.slot;
      if (!text) {
        if (slot !== "source") add(slide, `The ${slot} text is empty`, `Write the ${slot} text`, "must_fix", "copy");
        continue;
      }
      if (noFinalPeriods && text.split("\n").some(line => /(?<!\.)\.$/.test(line.trim()))) add(slide, `The ${slot} text ends with a period`, "Drop the final period", "must_fix", "copy");
      if (slot === "body" && [...text].length > BODY_LIMIT) add(slide, `The body is ${[...text].length} characters, more than two short lines`, "Cut it to about 75 characters, one short sentence", "should_fix", "copy");
      if (templatePage === cover?.index && slot === headline && text !== text.toLocaleUpperCase(locale)) add(slide, "The cover headline isn't in capitals", "Write the cover headline in ALL CAPS", "must_fix", "copy");
      if (follow && templatePage === follow.index && slot === "cta" && [...text].length > profile.followCta.maxChars) {
        add(slide, `The Follow line is ${[...text].length} characters, over its ${profile.followCta.maxChars}`, `Write a Follow line of at most ${profile.followCta.maxChars} characters`, "must_fix", "copy");
      }
    }
    const render = renders?.find(item => item.pageId === page.id);
    if (render?.exportError) add(slide, render.exportError, "Shorten the text so Export accepts the slide", "must_fix", "copy");
  });
  return issues;
}

/** What one slide says, slot by slot, with its chart's alt text. */
function slideText(document: DesignDocument, pages: DeckPage[], catalog: PageCatalog[]): string {
  return document.pages.map((page, index) => {
    const label = catalog.find(item => item.index === pages.find(entry => entry.pageId === page.id)?.templatePage)?.label;
    const lines = (page.canvas?.elements ?? []).flatMap(element => {
      if (element.hidden || !element.slot || element.templateRole === "brand") return [];
      if (element.type === "text") return element.text.trim() ? [`${element.slot}: ${element.text.trim().replace(/\n/g, " / ")}`] : [];
      return element.type === "image" && element.publicAlt ? [`${element.slot} (image): ${element.publicAlt}`] : [];
    });
    return `Slide ${index + 1}${label ? ` · ${label}` : ""}\n${lines.map(line => `  ${line}`).join("\n") || "  (no text)"}`;
  }).join("\n\n");
}

async function forCritic(png: Buffer): Promise<SourceImage> {
  const jpeg = await sharp(png).resize({ width: 864, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return { mediaType: "image/jpeg", base64: jpeg.toString("base64") };
}

/** Slides that show one photo across the slide edge, with the share of it on the first. */
export function photoPairs(document: DesignDocument) {
  return spanPairs(document).map(pair => ({ first: pair.startPage + 1, second: pair.endPage + 1, startId: document.pages[pair.startPage].id, endId: document.pages[pair.endPage].id, seam: Math.round(seamOf(pair.start) * 100) }));
}
/** Two rendered slides side by side, as a reader swipes from one to the next. */
async function sideBySide(left: Buffer, right: Buffer): Promise<SourceImage> {
  const [first, second] = await Promise.all([left, right].map(png => sharp(png).resize({ width: 648 }).toBuffer({ resolveWithObject: true })));
  const jpeg = await sharp({ create: { width: 1296, height: Math.max(first.info.height, second.info.height), channels: 3, background: "#000000" } })
    .composite([{ input: first.data, left: 0, top: 0 }, { input: second.data, left: 648, top: 0 }]).jpeg({ quality: 82 }).toBuffer();
  return { mediaType: "image/jpeg", base64: jpeg.toString("base64") };
}

const listIssues = (issues: Issue[]) => issues.map(issue => `- ${issue.slide ? `Slide ${issue.slide}` : "Whole post"}: ${issue.problem}`).join("\n");

async function factCritic(context: StageContext, document: DesignDocument, pages: DeckPage[], catalog: PageCatalog[]): Promise<CriticOutput> {
  const { file, profile } = context;
  const facts = outputOf<Facts>(file, "facts"), data = outputOf<DataOutput>(file, "data"), drawn = outputOf<ChartsOutput>(file, "charts");
  const charts = (data?.charts ?? []).map(chart => {
    const check = drawn?.charts.find(item => item.id === chart.id);
    return `- ${chart.id}: ${chart.purpose}. Source line: ${chart.source}${check?.ok ? ` (drawn: ${check.points} points, ${check.from} to ${check.to})` : ""}`;
  }).join("\n");
  return ask({
    role: "factCritic", what: "check the facts on the slides", signal: context.signal, usage: context.usage, schema: CriticSchema,
    system: rolePrompt("review", profile, [
      "Check every number, date, name and quote on our slides and in the caption against FACTS and CHARTS. Something the research doesn't support, or states more strongly than its source, is must_fix: route copy for words, data for a chart.",
      "Post cards (slots starting with reaction-) are real posts from X quoted word for word. Don't fact-check what they say; check only the title and source line around them.",
      "Verdict ship when nothing is must_fix. Slide numbers are ours, as listed.",
    ].join("\n"), "fact critic"),
    content: [
      `OUR SLIDES\n${slideText(document, pages, catalog)}`,
      `CAPTION\n${document.caption || "(none)"}`,
      `FACTS\n${facts ? JSON.stringify(facts) : "(not available)"}`,
      `CHARTS\n${charts || "(none)"}`,
    ].join("\n\n"),
  });
}

async function designCritic(context: StageContext, renders: SlideRender[], document: DesignDocument, pages: DeckPage[], catalog: PageCatalog[], found: Issue[]): Promise<CriticOutput> {
  const [originals, examples] = await Promise.all([originalSlides(context), guideExampleBlocks(context.ownerKey, context.guide)]);
  const ours = await Promise.all(renders.map(render => forCritic(render.png)));
  const labelOf = (pageId: string) => catalog.find(item => item.index === pages.find(entry => entry.pageId === pageId)?.templatePage)?.label;
  // Slides that share one photo are also shown side by side, so the critic can judge the split.
  const rendered = (pageId: string) => renders.find(render => render.pageId === pageId)?.png;
  const pairs = photoPairs(document).filter(pair => rendered(pair.startId) && rendered(pair.endId));
  const joined = await Promise.all(pairs.map(pair => sideBySide(rendered(pair.startId)!, rendered(pair.endId)!)));
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...examples,
    ...originals.flatMap((image, index): Anthropic.Beta.BetaContentBlockParam[] => [{ type: "text", text: `Original slide ${index + 1}:` }, imageBlock(image)]),
    ...ours.flatMap((image, index): Anthropic.Beta.BetaContentBlockParam[] => [{ type: "text", text: `Our slide ${index + 1}${labelOf(renders[index].pageId) ? ` (${labelOf(renders[index].pageId)})` : ""}:` }, imageBlock(image)]),
    ...joined.flatMap((image, index): Anthropic.Beta.BetaContentBlockParam[] => [{ type: "text", text: `Our slides ${pairs[index].first} and ${pairs[index].second} side by side. One photo runs across them, ${pairs[index].seam}% of it on slide ${pairs[index].first}:` }, imageBlock(image)]),
    { type: "text", text: [
      `OUR SLIDES AS TEXT\n${slideText(document, pages, catalog)}`,
      found.length ? `CODE ALREADY FOUND THESE (don't repeat them)\n${listIssues(found)}` : "",
    ].filter(Boolean).join("\n\n") },
  ];
  return ask({
    role: "designCritic", what: "review the rendered slides", signal: context.signal, usage: context.usage, schema: CriticSchema,
    system: rolePrompt("review", context.profile, [
      "You see the original post's slides, then ours, rendered exactly as Export draws them at 1080×1440, shown smaller.",
      "Check each of our slides as a reader on a phone would: is every word readable, nothing cut off, the chart clear, the spacing even? Then check the whole post against the original: does it keep the original's slides, chart and story?",
      "A grey template placeholder in a photo slot is fine when a person adds that photo (the Follow page's profile screenshot): report it with route none.",
      ...(context.guide ? [`Hold every slide to the ${context.guide.name} brand guide in your instructions${examples.length ? " and the approved example posts shown first" : ""}: colors, type, margins, spacing, the cover and how media sits on the page. Anything that breaks the guide is an issue; name the guide rule it breaks.`] : []),
      "Post cards are real posts from X: never ask to change their words. Verdict ship when nothing is must_fix. Slide numbers are ours.",
      pairs.length ? "Slides shown side by side share one photo, split where the slides meet. Check that the halves read as one photo and that the split misses faces and text. A split through a face or text is must_fix for images: give the seam to use, the share of the photo on the first slide (0.1 to 0.9)." : "",
    ].filter(Boolean).join("\n"), "design critic"),
    content,
  });
}

/** The critics' report as one deck comment: what they checked and what is still open. */
export function reviewComment(review: ReviewOutput): string {
  const open = [...review.checks, ...(review.facts?.issues ?? []), ...(review.design?.issues ?? [])].filter(issue => issue.severity !== "note");
  return [
    `Review by Recreate's critics${review.round ? ` (after ${review.round} fix round${review.round === 1 ? "" : "s"})` : ""}`,
    review.facts ? `Facts: ${review.facts.summary}` : "Facts: not checked",
    review.design ? `Design: ${review.design.summary}` : review.rendered ? "Design: not checked" : "Design: the slides couldn't be rendered here, so only code checked them",
    open.length ? `Still to fix:\n${open.map(issue => `• ${issue.slide ? `Slide ${issue.slide}` : "Post"}: ${issue.problem}. Fix: ${issue.fix}`).join("\n")}` : "Nothing left to fix.",
  ].join("\n");
}

/** The issues one route fixes, as instructions for its rerun. */
export function fixInstructions(review: ReviewOutput, route: Issue["route"]): string {
  const issues = [...review.checks, ...(review.facts?.issues ?? []), ...(review.design?.issues ?? [])]
    .filter(issue => issue.route === route && issue.severity !== "note");
  return [
    "The critics found these problems in the finished post. Fix every one; keep everything else exactly as it was.",
    ...issues.map(issue => `- ${issue.slide ? `Slide ${issue.slide}` : "Whole post"} (${issue.severity === "must_fix" ? "must fix" : "should fix"}): ${issue.problem}. Fix: ${issue.fix}`),
    route === "data" ? "Keep every chart's id, so the slides still find their charts." : "",
  ].filter(Boolean).join("\n").slice(0, 4000);
}

export const review: StageRunner = async context => {
  const { file, profile, template } = context;
  const built = need<DeckOutput>(file, "deck");
  const document = await loadDeck(context.ownerKey, built.deckId);
  if (!document) return { status: "skipped", output: null };
  const catalog = templatePages(template);
  // Pages the deck stage made; a person may have added, cut or moved pages since.
  const pages = built.pages.filter(page => document.pages.some(item => item.id === page.pageId));
  const checks: Issue[] = [];
  let renders: SlideRender[] | null = null;
  try {
    renders = await renderSlides(document, { ownerKey: context.ownerKey, signal: context.signal, budgetMs: RENDER_BUDGET_MS });
  } catch (error) {
    if (context.signal.aborted) throw error;
    checks.push({ slide: 0, problem: `The slides couldn't be rendered (${message(error)})`, fix: "Open the post and check every slide by eye", severity: "note", route: "none" });
  }
  checks.unshift(...houseChecks(document, pages, catalog, profile, renders), ...guideDeckChecks(document, profile, context.guide));
  const critic = async (run: () => Promise<CriticOutput>, who: string) => {
    try { return await run(); } catch (error) {
      if (context.signal.aborted) throw error;
      checks.push({ slide: 0, problem: `The ${who} couldn't finish (${message(error)})`, fix: "Rerun the review", severity: "note", route: "none" });
      return null;
    }
  };
  const [facts, design] = await Promise.all([
    critic(() => factCritic(context, document, pages, catalog), "fact critic"),
    renders?.length ? critic(() => designCritic(context, renders!, document, pages, catalog, checks), "design critic") : Promise.resolve(null),
  ]);
  const issues = [...checks, ...(facts?.issues ?? []), ...(design?.issues ?? [])];
  // A person's edits stand: nothing is sent back over them.
  const sendable = built.held || context.round >= MAX_FIX_ROUNDS ? [] : issues.filter(issue => issue.severity === "must_fix" && issue.route !== "none");
  const routes = sendable.flatMap(issue => issue.route === "none" ? [] : [issue.route]);
  const output: ReviewOutput = { round: context.round, rendered: Boolean(renders), checks, facts, design, sentBack: [...new Set(routes)] };
  if (!output.sentBack.length) await commentOnDeck(context.ownerKey, built.deckId, [reviewComment(output)]);
  return { output };
};
