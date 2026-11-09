/**
 * Build step F: the review. Code checks the finished deck as saved and as the
 * render page drew it (review-checks.ts and the guide's checks in brand.ts).
 * Then the critics (critics.ts): in a full recreation the fact critic reads
 * every word against the brief's guardrails and the design critic looks at the
 * slides next to the original; an exact copy gets the fidelity critic instead.
 *
 * Every issue goes to the designer (route design) or to nobody (none). When a
 * must-fix goes to design, the orchestrator sends the deck back with
 * fixInstructions: at most twice, or once for an exact copy. A person's edits
 * stand (the design was held), so nothing is sent back over them. When nothing
 * goes back, what is left is posted on the deck as a comment.
 */
import { randomUUID } from "node:crypto";
import { renderSlides, type SlideRender } from "../../slide-render";
import { reviewGuideChecks } from "../brand";
import { need, outputOf, type StageRunner } from "../context";
import { designCritic, factCritic, fidelityCritic } from "../critics";
import { coverPage, followPage, templatePages, type PageCatalog } from "../pages";
import { houseChecks, htmlChecks, type WantedText } from "../review-checks";
import type { CheckIssue, CriticReport, DesignOutput, PlanApproval, ReviewReport, SourceNotes, StoryBrief } from "../schemas";
import { parseLibrary, type DesignComment, type DesignDocument } from "../../../template-editor/model";
import { getEditorLibrary, LibraryConflictError, saveEditorLibrary } from "../../../template-editor/persistence";

/** Fix rounds after the first review: the critics send the deck back to the designer at most this many times. */
export const MAX_FIX_ROUNDS = 2, MAX_EXACT_FIX_ROUNDS = 1;
const RENDER_BUDGET_MS = 150_000;
// The workspace keeps comments up to these limits (parseLibrary).
const COMMENT_CHARS = 5000, DECK_COMMENTS = 500;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The saved deck, unless it was deleted or is in Trash. */
async function loadDeck(ownerKey: string, deckId: string): Promise<DesignDocument | null> {
  const { library } = await getEditorLibrary(ownerKey);
  const found = library.designs.find(item => item.id === deckId);
  return found && !found.deletedAt ? found : null;
}

/** Adds the review to the saved deck as a comment on its first page. A deleted deck, or one full of comments, is left alone. */
async function commentOnDeck(ownerKey: string, deckId: string, text: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const stored = await getEditorLibrary(ownerKey), designs = stored.library.designs;
    const existing = designs.find(item => item.id === deckId);
    if (!existing || existing.deletedAt || !existing.pages.length || (existing.comments?.length ?? 0) >= DECK_COMMENTS) return false;
    const comment: DesignComment = { id: randomUUID(), pageId: existing.pages[0].id, text: text.length > COMMENT_CHARS ? `${text.slice(0, COMMENT_CHARS - 1)}…` : text, createdAt: new Date().toISOString() };
    const next = parseLibrary({ ...stored.library, designs: designs.map(item => item.id === deckId ? { ...item, comments: [...(item.comments ?? []), comment] } : item) });
    if (!next) return false;
    try {
      await saveEditorLibrary(ownerKey, next, stored.revision, randomUUID());
      return true;
    } catch (error) {
      if (!(error instanceof LibraryConflictError) || attempt === 3) throw error;
    }
  }
  return false;
}
const issuesOf = (report: ReviewReport) => [...report.checks, ...(report.facts?.issues ?? []), ...(report.design?.issues ?? [])];
const where = (issue: CheckIssue) => issue.slide ? `Slide ${issue.slide}` : "Whole post";

/** The issues the designer fixes, must-fix first, as the instructions for the next design round. */
export function fixInstructions(report: ReviewReport, exact = false): string {
  const issues = issuesOf(report).filter(issue => issue.route === "design" && issue.severity !== "note")
    .sort((a, b) => Number(b.severity === "must_fix") - Number(a.severity === "must_fix"));
  return [
    `The ${exact ? "fidelity critic and Engine's checks" : "critics and Engine's checks"} found these problems in the finished post. Fix every one in the same deck; keep everything else exactly as it was.`,
    ...issues.map(issue => `- ${where(issue)} (${issue.severity === "must_fix" ? "must fix" : "should fix"}): ${issue.problem}. Fix: ${issue.fix}`),
  ].join("\n").slice(0, 4000);
}

/** The review as one deck comment: what was checked and what is still open. */
export function reviewComment(report: ReviewReport, exact = false): string {
  const open = issuesOf(report).filter(issue => issue.severity !== "note");
  return [
    `Review by Recreate's critics${report.round ? ` (after ${report.round} fix round${report.round === 1 ? "" : "s"})` : ""}`,
    report.facts ? `Facts: ${report.facts.summary}` : exact ? "Facts: not checked, as an exact copy keeps the original's words" : "Facts: not checked",
    report.design ? `${exact ? "Fidelity" : "Design"}: ${report.design.summary}` : report.rendered ? `${exact ? "Fidelity" : "Design"}: not checked` : `${exact ? "Fidelity" : "Design"}: the slides couldn't be rendered here, so only code checked them`,
    open.length ? `Still to fix:\n${open.map(issue => `• ${issue.slide ? `Slide ${issue.slide}` : "Post"}: ${issue.problem}. Fix: ${issue.fix}`).join("\n")}` : "Nothing left to fix.",
  ].join("\n");
}

/**
 * The headlines and titles the deck must show as native text, never inside
 * HTML: in a full recreation the approved headline, on any slide; in an exact
 * copy each original slide's headline and its first title, on the deck pages
 * that show that slide.
 */
export function wantedTexts(document: DesignDocument, catalog: PageCatalog[], design: Pick<DesignOutput, "pages">, input: { exact: boolean; source: SourceNotes | null; approval: PlanApproval | null }): WantedText[] {
  const cover = coverPage(catalog), coverSlot = cover?.text.find(slot => slot.role === "cover")?.slot ?? cover?.text[0]?.slot ?? "cover headline";
  if (!input.exact) return input.approval?.headline.text.trim() ? [{ page: null, text: input.approval.headline.text, slot: coverSlot }] : [];
  const follow = followPage(catalog), followSlot = follow?.text.find(slot => slot.slot === "cta")?.slot ?? follow?.text[0]?.slot ?? "Follow";
  const slotFor = (slide: SourceNotes["slides"][number]) => slide.index === 1 || slide.role === "cover" ? coverSlot : slide.role === "follow" ? followSlot : "title";
  return (input.source?.slides ?? []).flatMap(slide => {
    const texts = [
      ...slide.texts.filter(text => text.role === "headline").map(text => ({ text: text.text, slot: slotFor(slide) })),
      ...slide.texts.filter(text => text.role === "title").slice(0, 1).map(text => ({ text: text.text, slot: "title" })),
    ];
    const pages = design.pages.filter(entry => entry.slide === slide.index).map(entry => document.pages.findIndex(page => page.id === entry.pageId)).filter(index => index >= 0);
    return (pages.length ? pages : [null]).flatMap(page => texts.map(text => ({ page, ...text })));
  });
}

export const review: StageRunner = async context => {
  const { file, profile, template, guide } = context, exact = file.mode === "exact";
  const design = need<DesignOutput>(file, "design");
  const document = await loadDeck(context.ownerKey, design.deckId);
  // The deck was deleted: there's nothing to review, and nothing to send back.
  if (!document) return { status: "skipped", output: null };
  const source = outputOf<SourceNotes>(file, "source") ?? null;
  const brief = exact ? null : need<StoryBrief>(file, "brief");
  const approval = exact ? null : outputOf<PlanApproval>(file, "approval") ?? null;
  const catalog = templatePages(template);

  const notes: CheckIssue[] = [];
  let renders: SlideRender[] | null = null;
  try {
    renders = await renderSlides(document, { ownerKey: context.ownerKey, signal: context.signal, budgetMs: RENDER_BUDGET_MS });
  } catch (error) {
    if (context.signal.aborted) throw error;
    notes.push({ slide: 0, problem: `The slides couldn't be rendered (${message(error)}), so nothing was measured or looked at`, fix: "Open the post and check every slide by eye", severity: "note", route: "none" });
  }
  // No browser here (renderSlides resolves null when Chromium can't start): only the saved deck was checked.
  if (!renders && !notes.length) notes.push({ slide: 0, problem: "The slides couldn't be rendered here (no browser), so nothing was measured or looked at", fix: "Open the post and check every slide by eye", severity: "note", route: "none" });
  const checks: CheckIssue[] = [
    ...houseChecks(document, catalog, profile, renders, { exact }),
    ...reviewGuideChecks(document, profile, guide, { exact }),
    ...htmlChecks(document, renders, guide, wantedTexts(document, catalog, design, { exact, source, approval })),
    ...notes,
  ];

  // A critic that fails leaves a note: the code checks still stand.
  const found = [...checks];
  const critic = async (who: string, run: () => Promise<CriticReport>): Promise<CriticReport | null> => {
    try {
      return await run();
    } catch (error) {
      if (context.signal.aborted) throw error;
      checks.push({ slide: 0, problem: `The ${who} couldn't finish (${message(error)})`, fix: "Rerun the review", severity: "note", route: "none" });
      return null;
    }
  };
  const drawn = renders?.length ? renders : null;
  const [facts, look] = await Promise.all([
    brief ? critic("fact critic", () => factCritic(context, { document, design, source, brief, approval })) : Promise.resolve(null),
    !drawn ? Promise.resolve(null)
      : exact ? critic("fidelity critic", () => fidelityCritic(context, drawn, { document, design, source, found }))
      : critic("design critic", () => designCritic(context, drawn, { document, design, source, brief, approval, found })),
  ]);

  const report: ReviewReport = { round: context.round, rendered: Boolean(renders), checks, facts, design: look, sentBack: [] };
  const limit = exact ? MAX_EXACT_FIX_ROUNDS : MAX_FIX_ROUNDS;
  if (!design.held && context.round < limit && issuesOf(report).some(issue => issue.severity === "must_fix" && issue.route === "design")) report.sentBack = ["design"];
  if (!report.sentBack.length) {
    await commentOnDeck(context.ownerKey, design.deckId, reviewComment(report, exact)).catch(error => {
      console.warn("[recreate] the review's comment wasn't saved:", message(error));
    });
  }
  return { output: report };
};
