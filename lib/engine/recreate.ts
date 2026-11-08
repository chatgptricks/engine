/**
 * Recreate post: an Instagram post (link or screenshots) becomes an editable
 * Engine carousel in one of our pages' templates and languages, made by a
 * team of agents (lib/engine/agents), each with one job and its own role card:
 *
 *   brief (editor-in-chief)
 *    └─ research in parallel: facts · chart data · X reactions · photos
 *        └─ outline (story editor) + hook options (headline model)
 *            └─ checkpoint: a person approves the plan and picks the hook (autopilot skips it)
 *                └─ in parallel: copy · charts · photos
 *                    └─ deck (designer) → critics (facts, design) → at most 2 fix rounds
 *
 * Every stage writes into the post's working file (lib/engine/post-files.ts),
 * so a run can pause, resume after a restart, or rerun one stage. The route
 * and the MCP bridge drive it through lib/engine/agents/orchestrator.ts; this
 * module keeps the public types, the house text helpers and `runRecreate`,
 * which runs the whole team in autopilot and waits for the deck.
 */
import type { DesignDocument, DesignTemplate } from "../template-editor/model";
import { assembleDeck } from "./agents/deck";
import { isRunning, startRecreate, stopRun } from "./agents/orchestrator";
import type { FactCheck, WrittenChart } from "./agents/schemas";
import type { PageProfile } from "./page-profiles";
import { getPostFile } from "./post-files";
import type { ChartData } from "./recreate-data";
import { postView, type RecreateStatus } from "./recreate-jobs";
import { RecreateError } from "./agents/claude";

export { isRecreateConfigured, RecreateError } from "./agents/claude";
export { chartSpecFrom } from "./agents/charts";
export { cleanSlideText, editorUrl, emphasis } from "./agents/deck";
export { writerPages } from "./agents/pages";
export type { FactCheck, WrittenChart } from "./agents/schemas";

export type RecreateStage = RecreateStatus;
export type RecreateInput = { url?: string; uploads?: { name: string; dataUrl: string }[]; caption?: string; profileId: string; notes?: string };
export type RecreateResult = { deckId: string; editorUrl: string; name: string; slideCount: number; factChecks: FactCheck[]; notes: string[] };

/** The one-writer carousel of the first Recreate version, still accepted by `buildRecreatedDeck`. */
export type WrittenCarousel = {
  name: string;
  caption: string;
  slides: { templatePage: number; purpose: string; texts: { slot: string; text: string }[]; media: { kind: "none" | "chart" | "photo"; photoBrief: string; chart: WrittenChart | null } }[];
  factChecks: FactCheck[];
  notes: string[];
};

/** A written carousel → an editable deck, through the designer. Kept for callers that write the whole carousel in one go. */
export async function buildRecreatedDeck(profile: PageProfile, template: DesignTemplate, templates: DesignTemplate[], carousel: WrittenCarousel, data: ChartData = new Map(), signal?: AbortSignal): Promise<{ document: DesignDocument; notes: string[] }> {
  const { document, notes } = await assembleDeck({
    profile, template, templates, name: carousel.name, caption: carousel.caption,
    slides: carousel.slides.map(slide => ({
      templatePage: slide.templatePage, texts: slide.texts,
      chart: slide.media.kind === "chart" && slide.media.chart ? { chart: slide.media.chart } : null,
      photoBrief: slide.media.kind === "photo" ? slide.media.photoBrief : "",
    })),
    factChecks: carousel.factChecks, notes: carousel.notes, chartData: data, signal,
  });
  return { document, notes };
}

/** Runs the whole team in autopilot and resolves with the saved deck. `report` hears each change of step. */
export async function runRecreate(ownerKey: string, input: RecreateInput, report: (stage: RecreateStage, message: string) => void, signal?: AbortSignal): Promise<RecreateResult> {
  const { file, done } = await startRecreate(ownerKey, { ...input, mode: "autopilot" });
  const stop = () => { stopRun(file.id); };
  signal?.addEventListener("abort", stop, { once: true });
  let last = "";
  const tell = async () => {
    const current = await getPostFile(ownerKey, file.id).catch(() => null);
    if (!current) return;
    const view = postView(current, isRunning(file.id));
    if (`${view.status}\n${view.message}` !== last) { last = `${view.status}\n${view.message}`; report(view.status, view.message); }
  };
  const timer = setInterval(() => { void tell(); }, 2000);
  try {
    await done;
  } finally {
    clearInterval(timer);
    signal?.removeEventListener("abort", stop);
  }
  const final = await getPostFile(ownerKey, file.id);
  const view = final ? postView(final, false) : null;
  if (!view || view.status !== "done" || !view.result) throw new RecreateError(view?.message || "Recreate failed. Try again.", 502);
  const { deckId, editorUrl, name, slideCount, factChecks, notes } = view.result;
  return { deckId, editorUrl, name, slideCount, factChecks, notes };
}
