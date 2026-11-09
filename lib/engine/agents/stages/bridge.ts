/**
 * The early test path (2026-11-08): until build steps B, D and F land, an
 * exact copy runs end to end on the first team's copier, chart rebuilder,
 * exact deck and fidelity critic, under the new stage names. The source stage
 * is step A's own (merged).
 *
 * - research: an unchecked quick check that proceeds. Nothing is looked up.
 * - design: the first team's transcript, chart data and exact deck, in one
 *   stage. What they wrote is kept under `bridge`, so a fix round or a rerun
 *   builds on it and saves over the same deck.
 * - review: the first team's checks and fidelity critic. Their routes (copy,
 *   data, images) become `design`, and the critics' report is kept under
 *   `bridge` so the fix round tells each part only its own issues.
 *
 * A full recreation goes straight to the step stubs, so it stops at the
 * research stage. Each build step switches its stage off this file when it
 * merges; the Last step deletes the file.
 */
import { outputOf, type StageContext, type StageResult, type StageRunner } from "../context";
import { exactDeck, transcript as copyOriginal } from "../exact";
import { exactData } from "../exact-data";
import { templatePages } from "../pages";
import { fixInstructions as legacyFix, review as legacyReview } from "../review";
import type { CheckIssue, CriticOutput, CriticReport, DeckOutput, DesignOutput, Issue, Research, ReviewOutput, ReviewReport, TranscriptOutput } from "../schemas";
import { design } from "./design";
import { research } from "./research";
import { review } from "./review";

/** How an unchecked origin starts; the run card shows it as "Origin not checked yet". */
export const UNCHECKED = "Not checked yet";

type Settled = { status: "done" | "skipped"; output?: unknown; error?: string };
type Made = { transcript: TranscriptOutput; data: Settled; deck: DeckOutput };
export type BridgedDesign = DesignOutput & { bridge: Made };
export type BridgedReview = ReviewReport & { bridge: { legacy: ReviewOutput } };

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const exact = (context: StageContext) => context.file.mode === "exact";
/** The post file as the first team's stages read it: the new file, with their own records added. */
const withStages = (context: StageContext, made: Partial<Made>): StageContext => ({
  ...context,
  file: {
    ...context.file,
    stages: {
      ...context.file.stages,
      ...(made.transcript ? { transcript: { status: "done" as const, output: made.transcript } } : {}),
      ...(made.data ? { data: made.data } : {}),
      ...(made.deck ? { deck: { status: "done" as const, output: made.deck } } : {}),
    },
  },
});

const bridgeResearch: StageRunner = async context => {
  if (!exact(context)) return research(context);
  const none = { likes: null, comments: null, views: null };
  const check: Research = {
    quick: true,
    origin: { found: false, url: null, who: "", date: null, note: `${UNCHECKED}: the quick check comes with build step B.` },
    surfaces: [], facts: [],
    worth: {
      traction: { post: none, usual: null, ratio: null, performing: false },
      fresh: { firstSeen: null, ageDays: null, stale: false },
      saturation: { note: "", saturated: false },
      covered: { already: false, by: [], note: "" },
    },
    fabrication: [], positions: [], reactions: [],
    recommendation: { outcome: "proceed", reason: "Nothing checked yet (the quick check is build step B). Check where the post comes from before you publish it." },
  };
  return { output: check };
};

/** The critics' report the fix round answers, when this design run is one. */
function fixRound(context: StageContext): ReviewOutput | undefined {
  const record = context.file.stages.review, legacy = (record?.output as Partial<BridgedReview> | undefined)?.bridge?.legacy;
  return context.instructions && legacy?.sentBack.length && legacy.round + 1 === context.round ? legacy : undefined;
}

const bridgeDesign: StageRunner = async context => {
  if (!exact(context)) return design(context);
  const earlier = (context.previous as Partial<BridgedDesign> | undefined)?.bridge;
  const critics = fixRound(context), routes = new Set(critics?.sentBack ?? []);
  // The copier hears the critics' words and pictures, or a person's own direction; a fix round for charts alone keeps its copy.
  const recopy = !earlier || !critics || routes.has("copy") || routes.has("images");
  let imported: StageResult["source"];
  let copied = earlier?.transcript;
  if (recopy || !copied) {
    const words = critics ? legacyFix(critics, [...routes].filter(route => route !== "data"), true) : context.instructions;
    const result = await copyOriginal({ ...context, previous: earlier?.transcript, instructions: words });
    copied = result.output as TranscriptOutput;
    imported = result.source;
  }
  // The chart rebuilder hears the critics' chart issues. A new copy only rechecks which slides show a chart, keeping the charts it rebuilt.
  let data = earlier?.data;
  if (!data || recopy || routes.has("data")) {
    const charts = withStages({ ...context, previous: earlier?.data.output, instructions: routes.has("data") ? legacyFix(critics!, "data", true) : undefined }, { transcript: copied });
    try {
      const result = await exactData(charts);
      data = { status: result.status ?? "done", output: result.output };
    } catch (error) {
      if (context.signal.aborted) throw error;
      data = { status: "skipped", error: message(error) };
    }
  }
  const made = await exactDeck({ ...withStages(context, { transcript: copied, data }), previous: earlier?.deck, instructions: undefined });
  const deck = made.output as DeckOutput, pages = templatePages(context.template);
  const output: BridgedDesign = {
    deckId: deck.deckId, name: deck.name, slideCount: deck.slideCount, savedAt: deck.savedAt, caption: copied.caption,
    pages: deck.pages.map(page => ({ pageId: page.pageId, slide: copied.slides[page.slide]?.original ?? page.slide + 1, layout: pages.find(item => item.index === page.templatePage)?.label ?? `Page ${page.templatePage + 1}` })),
    notes: deck.notes, held: deck.held,
    bridge: { transcript: copied, data, deck },
  };
  return { output, ...(imported ? { source: imported } : {}) };
};

/** The first team's routes all go to the one designer; what nobody can fix stays with nobody. */
const routed = (issue: Issue): CheckIssue => ({ ...issue, route: issue.route === "none" ? "none" : "design" });
const report = (critic: CriticOutput | null): CriticReport | null => critic && { ...critic, issues: critic.issues.map(routed) };

const bridgeReview: StageRunner = async context => {
  const made = outputOf<BridgedDesign>(context.file, "design");
  if (!exact(context) || !made?.bridge) return review(context);
  const result = await legacyReview(withStages(context, made.bridge));
  const legacy = result.output as ReviewOutput | null;
  if (result.status === "skipped" || !legacy) return { status: "skipped", output: { note: "The deck is gone, so there was nothing to review." } };
  const output: BridgedReview = {
    round: legacy.round, rendered: legacy.rendered, checks: legacy.checks.map(routed), facts: report(legacy.facts), design: report(legacy.design),
    sentBack: legacy.sentBack.length ? ["design"] : [],
    bridge: { legacy },
  };
  return { output };
};

export const bridge = { research: bridgeResearch, design: bridgeDesign, review: bridgeReview };
