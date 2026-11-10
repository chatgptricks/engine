/**
 * The orchestrator: runs the Recreate team over one post file. A stage starts
 * as soon as everything it reads is finished, and each result is saved to the
 * post file as it lands.
 *
 *   source → research → verdict ─┬─ (full) brief → headline → approval → design → review
 *                                └─ (exact) design → review
 *
 * The verdict is the gate: a stage that reads it starts only once it says
 * proceed, or a person answers it so. A stop ends the run (status stopped, no
 * deck); an ask pauses it until a person answers, in autopilot too. A
 * checkpoint run also pauses before the approval until a person approves the
 * plan and the headline. The critics' must-fix issues go back to the designer
 * at most twice (once for an exact copy).
 *
 * A run picks up where its post file left off after a restart, and reruns one
 * stage on request. Runs live in this server process (Engine runs as one
 * instance); the post file is the record, so nothing is lost when the process
 * stops. Version-1 files (the first team's) open read-only: every action here
 * refuses them.
 */
import { randomUUID } from "node:crypto";
import type { BrandGuide } from "../../template-editor/brand-guide";
import type { DesignTemplate } from "../../template-editor/model";
import { getEditorLibrary } from "../../template-editor/persistence";
import { libraryTemplates } from "../../template-editor/template-catalog";
import { isHeadlineModelConfigured, savePick, type SavePickInput } from "../headline-model";
import { getPageProfile, PageProfileError, type PageProfile } from "../page-profiles";
import { createPostFile, downstreamOf, getPostFile, inputsOf, isCurrentPostFile, POST_STAGES, PostFileError, setStage, stagesFor, updatePostFile, type PostFile, type PostMode, type PostStage, type StageActor } from "../post-files";
import { MAX_ADDED_POSTS, xPostId, xPostLink } from "../x-links";
import { fetchXPosts } from "../x-reactions";
import { loadGuide, withGuideBrief } from "./brand";
import { RecreateError, UsageMeter } from "./claude";
import { outputOf, verdictOf, type RunCache, type StageContext, type StageResult, type StageRunner } from "./context";
import { stageCard } from "./playbook";
import { HANDED_IN, PlanSchema, type DesignOutput, type Headlines, type PlanApproval, type Research, type ReviewReport, type SourceNotes, type StoryBrief, type Verdict } from "./schemas";
import { withDecisions } from "./source-notes";
import { brief } from "./stages/brief";
import { design } from "./stages/design";
import { autoApprove, chooseHeadline, headline, normalizePlan, pickPayload } from "./stages/headline";
import { research } from "./stages/research";
import { fixInstructions, MAX_EXACT_FIX_ROUNDS, MAX_FIX_ROUNDS, review } from "./stages/review";
import { source } from "./stages/source";
import { verdict } from "./stages/verdict";

export { pickPayload } from "./stages/headline";

/** Every stage runs its build step's own runner (steps A to F, merged 2026-11-09). */
export const RUNNERS: Record<PostStage, StageRunner> = { source, research, verdict, brief, headline, approval: autoApprove, design, review };
/** Stages the post can do without: when one fails, the run goes on and the post notes what's missing. */
const OPTIONAL = new Set<PostStage>(["review"]);
const MAX_ACTIVE_PER_OWNER = 4;
const RUN_DEADLINE_MS = 45 * 60_000;
const CACHE_TTL_MS = 3 * 60 * 60_000, MAX_CACHES = 8;

/** `guide` is the page's brand guide; `profile.voice` already carries its brief for every role. */
export type Environment = { profile: PageProfile; template: DesignTemplate; templates: DesignTemplate[]; guide?: BrandGuide | null };
export type RunOptions = {
  /** Tests swap in their own stages. */
  runners?: Partial<Record<PostStage, StageRunner>>;
  environment?: (ownerKey: string, profileId: string) => Promise<Environment>;
  /** Defaults to the headline model's /v1/picks when HEADLINE_API_KEY is set. */
  savePick?: (input: SavePickInput) => Promise<{ id: string }>;
};
export type Started = { file: PostFile; done: Promise<void> };

type Run = { ownerKey: string; postId: string; controller: AbortController; again: boolean; cache: RunCache };
type Shared = { runs: Map<string, Run>; caches: Map<string, { cache: RunCache; usedAt: number }> };
const SHARED = Symbol.for("engine.recreate.orchestrator");
function shared(): Shared {
  const holder = globalThis as typeof globalThis & { [SHARED]?: Shared };
  return holder[SHARED] ??= { runs: new Map(), caches: new Map() };
}
export const isRunning = (postId: string) => shared().runs.has(postId);
export const runningFor = (ownerKey: string) => [...shared().runs.values()].filter(run => run.ownerKey === ownerKey).length;
/** Stops a run; its finished stages stay in the post file. */
export function stopRun(postId: string): boolean {
  const run = shared().runs.get(postId);
  run?.controller.abort(new RecreateError("Stopped. Resume the run to continue.", 409));
  return Boolean(run);
}

/** Downloads and the original's slides stay in memory a few hours, so a paused run doesn't fetch them again. */
function cacheFor(postId: string): RunCache {
  const { caches } = shared(), now = Date.now();
  for (const [id, entry] of caches) if (now - entry.usedAt > CACHE_TTL_MS) caches.delete(id);
  const entry = caches.get(postId) ?? { cache: { chartData: new Map() }, usedAt: now };
  entry.usedAt = now;
  caches.delete(postId);
  caches.set(postId, entry);
  while (caches.size > MAX_CACHES) caches.delete(caches.keys().next().value!);
  return entry.cache;
}

export async function loadEnvironment(ownerKey: string, profileId: string): Promise<Environment> {
  const profile = await getPageProfile(ownerKey, profileId).catch(error => {
    if (error instanceof PageProfileError) throw new RecreateError(error.message, error.status);
    throw error;
  });
  if (!profile) throw new RecreateError("That page profile doesn't exist.", 404);
  const { library } = await getEditorLibrary(ownerKey);
  const templates = libraryTemplates(library);
  const template = templates.find(candidate => candidate.id === profile.templateId);
  if (!template) throw new RecreateError(`${profile.name} has no template yet. Pick one in its page profile.`, 409);
  const guide = await loadGuide(ownerKey, profile);
  return { profile: withGuideBrief(profile, guide), template, templates, guide };
}

// ── The run ─────────────────────────────────────────────────────────────────
const LABELS: Record<PostStage, string> = {
  source: "reading the original post", research: "researching the story", verdict: "checking the story",
  brief: "writing the brief", headline: "gathering headline options", approval: "taking the plan",
  design: "designing the slides", review: "reviewing the slides",
};
const label = (stage: PostStage, mode: PostMode) => mode === "exact" && stage === "research" ? "checking where the post comes from" : LABELS[stage];
const settled = (file: PostFile, stage: PostStage) => file.stages[stage]?.status === "done" || file.stages[stage]?.status === "skipped";
function progressMessage(file: PostFile): string {
  const running = POST_STAGES.filter(stage => file.stages[stage]?.status === "running");
  // The first stage imports the post before it reads it.
  if (running.includes("source") && !file.source.imageIds.length) return file.source.url ? "Importing the post from Instagram" : "Reading your screenshots";
  if (!running.length) return file.message;
  const text = running.map(stage => label(stage, file.mode)).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Stages that can start now: in the run's mode, not finished or failed, and
 * everything they read finished. A stage that reads the verdict also waits
 * for it to say proceed, and the checkpoint waits for a person in checkpoint mode.
 */
export function readyStages(file: PostFile, inFlight: ReadonlySet<PostStage> = new Set()): PostStage[] {
  if (!isCurrentPostFile(file)) return [];
  const gate = verdictOf(file);
  return stagesFor(file.mode).filter(stage => {
    const status = file.stages[stage]?.status;
    if (inFlight.has(stage) || status === "done" || status === "skipped" || status === "error") return false;
    if (stage === "approval" && file.mode === "checkpoint") return false;
    const inputs = inputsOf(stage, file.mode);
    if (inputs.includes("verdict") && gate !== "proceed") return false;
    return inputs.every(input => settled(file, input));
  });
}

function describeError(stage: PostStage, error: unknown, mode: PostMode): string {
  if (error instanceof RecreateError || error instanceof PostFileError) return error.message;
  const status = (error as { status?: unknown } | null)?.status, title = stageCard(stage, mode).title;
  if (typeof status === "number") return `${title} failed: Claude's API answered HTTP ${status}. Rerun this stage.`;
  return `${title} failed unexpectedly. Rerun this stage.`;
}

/** Sends the critics' must-fix issues back to the designer, then the review runs again: at most two rounds, one for an exact copy. */
function scheduleFixes(file: PostFile, output: ReviewReport) {
  const exact = file.mode === "exact";
  if (!output.sentBack.includes("design") || output.round >= (exact ? MAX_EXACT_FIX_ROUNDS : MAX_FIX_ROUNDS)) return;
  const round = output.round + 1;
  setStage(file, "design", { status: "pending", round, instructions: fixInstructions(output, exact) }, "engine", `sent back by the critics (round ${round})`);
  setStage(file, "review", { status: "pending", round, instructions: undefined }, "engine", `review round ${round}`);
}

async function runStage(run: Run, file: PostFile, stage: PostStage, attempt: string, runner: StageRunner, environment: Environment): Promise<void> {
  const record = file.stages[stage], usage = new UsageMeter();
  const context: StageContext = {
    ownerKey: run.ownerKey, file, ...environment, signal: run.controller.signal, usage, cache: run.cache,
    round: record?.round ?? 0, instructions: record?.instructions, previous: record?.output,
  };
  let result: StageResult | undefined, failure: unknown;
  try { result = await runner(context); } catch (error) { failure = error; }
  if (run.controller.signal.aborted) throw run.controller.signal.reason ?? failure;
  if (failure && !(failure instanceof RecreateError)) console.error(`[recreate] ${stage} failed`, failure instanceof Error ? failure.message : failure);
  const meta = usage.used ? { model: [...usage.models].join(", "), usage: usage.toJSON() } : {};
  await updatePostFile(run.ownerKey, run.postId, current => {
    const now = current.stages[stage];
    // A rerun or a hand-in replaced this attempt while it ran: its result is dropped.
    if (now?.status !== "running" || now.attempt !== attempt) return;
    if (result) {
      const status = result.status ?? "done";
      setStage(current, stage, { status, output: result.output, error: undefined, instructions: undefined, ...meta }, "engine");
      if (result.source) current.source = { ...current.source, ...result.source };
      if (stage === "design" && status === "done") current.deckId = (result.output as DesignOutput).deckId;
      if (stage === "review" && status === "done") scheduleFixes(current, result.output as ReviewReport);
    } else {
      const text = describeError(stage, failure, current.mode);
      if (OPTIONAL.has(stage)) setStage(current, stage, { status: "skipped", output: undefined, error: text, instructions: undefined, ...meta }, "engine", `skipped: ${text}`);
      else setStage(current, stage, { status: "error", error: text, ...meta }, "engine", `failed: ${text}`);
    }
    current.message = progressMessage(current);
  });
}

/** Records how the run ended. Returns false, changing nothing, when an action made a stage ready in the meantime. */
async function settle(run: Run): Promise<boolean> {
  let ended = true;
  await updatePostFile(run.ownerKey, run.postId, file => {
    ended = true;
    if (readyStages(file).length) { ended = false; return; }
    const stages = stagesFor(file.mode), gate = verdictOf(file), check = outputOf<Verdict>(file, "verdict");
    const failed = stages.find(stage => file.stages[stage]?.status === "error");
    const approving = file.mode === "checkpoint" && file.stages.approval?.status !== "done" && inputsOf("approval", file.mode).every(stage => settled(file, stage));
    file.waiting = undefined;
    if (failed) {
      file.status = "error";
      file.message = file.stages[failed]?.error ?? `${stageCard(failed, file.mode).title} failed.`;
    } else if (gate === "stop") {
      file.status = "stopped";
      file.message = check?.answer ? "Stopped: you chose not to make this post." : `Stopped at the check: ${check?.reason || "the story didn't pass."}`;
    } else if (gate === "ask") {
      file.status = "paused";
      file.waiting = "verdict";
      file.message = `Check the story first: ${check?.reason || "the research needs a person's call."}`;
    } else if (approving) {
      file.status = "paused";
      file.waiting = "approval";
      file.message = "Ready for you: check the plan and pick the headline";
    } else if (stages.every(stage => settled(file, stage)) && settled(file, "design")) {
      file.status = "done";
      const built = outputOf<DesignOutput>(file, "design");
      file.message = built ? `Created ${built.slideCount} editable slides` : "Finished";
    } else {
      file.status = "error";
      file.message = "The run stopped before the post was finished. Resume it to continue.";
    }
    file.history.push({ at: new Date().toISOString(), stage: "run", event: file.status, by: "engine" });
  });
  return ended;
}

async function fail(run: Run, error: unknown) {
  const reason = run.controller.signal.aborted ? run.controller.signal.reason : error;
  const text = reason instanceof RecreateError || reason instanceof PostFileError ? reason.message : "The run stopped unexpectedly. Resume it to continue.";
  if (!(reason instanceof RecreateError)) console.error("[recreate] run stopped", reason instanceof Error ? reason.message : reason);
  // Stages still working stop too; their results would be dropped anyway.
  if (!run.controller.signal.aborted) run.controller.abort(new RecreateError(text, 500));
  await updatePostFile(run.ownerKey, run.postId, file => {
    for (const stage of POST_STAGES) if (file.stages[stage]?.status === "running") setStage(file, stage, { status: "error", error: "Stopped before it finished" }, "engine", "stopped");
    file.status = "error";
    file.waiting = undefined;
    file.message = text;
    file.history.push({ at: new Date().toISOString(), stage: "run", event: `stopped: ${text}`, by: "engine" });
  }).catch(() => undefined);
}

async function loop(run: Run, options: RunOptions, environment?: Environment): Promise<void> {
  const { ownerKey, postId } = run, signal = run.controller.signal;
  const first = await getPostFile(ownerKey, postId);
  if (!first || !isCurrentPostFile(first)) return;
  const env = environment ?? await (options.environment ?? loadEnvironment)(ownerKey, first.profileId);
  const runners = { ...RUNNERS, ...options.runners };
  const inFlight = new Map<PostStage, Promise<void>>();
  const stop: { failed: boolean; error?: unknown } = { failed: false };
  for (;;) {
    if (stop.failed) throw stop.error;
    signal.throwIfAborted();
    const file = await getPostFile(ownerKey, postId);
    if (!file) return;
    const ready = readyStages(file, new Set(inFlight.keys()));
    if (ready.length) {
      const attempts = new Map(ready.map(stage => [stage, randomUUID()]));
      const started = await updatePostFile(ownerKey, postId, current => {
        for (const stage of ready) setStage(current, stage, { status: "running", attempt: attempts.get(stage) }, "engine");
        current.status = "running";
        current.waiting = undefined;
        current.message = progressMessage(current);
      });
      for (const stage of ready) {
        // A stage that can't record its result (an abort, storage down) stops the run instead of looping on it.
        const task = runStage(run, started, stage, attempts.get(stage)!, runners[stage], env)
          .catch(error => { if (!stop.failed) Object.assign(stop, { failed: true, error }); })
          .finally(() => inFlight.delete(stage));
        inFlight.set(stage, task);
      }
    }
    if (!inFlight.size) {
      if (run.again) { run.again = false; continue; }
      if (await settle(run)) return;
      continue;
    }
    // Wake when any stage lands.
    await Promise.race(inFlight.values());
  }
}

/** Starts driving a post, or nudges the run already driving it. Resolves when the run stops (finished, paused or failed). */
function drive(ownerKey: string, postId: string, options: RunOptions, seed: { uploads?: RunCache["uploads"]; environment?: Environment } = {}): Promise<void> {
  const { runs } = shared(), existing = runs.get(postId);
  if (existing) { existing.again = true; return Promise.resolve(); }
  const run: Run = { ownerKey, postId, controller: new AbortController(), again: false, cache: cacheFor(postId) };
  if (seed.uploads) run.cache.uploads = seed.uploads;
  runs.set(postId, run);
  const timer = setTimeout(() => run.controller.abort(new RecreateError("This run took too long and was stopped. Resume it to continue.", 504)), RUN_DEADLINE_MS);
  timer.unref?.();
  return loop(run, options, seed.environment).catch(error => fail(run, error)).finally(() => {
    clearTimeout(timer);
    if (runs.get(postId) === run) runs.delete(postId);
    // An action that came in while the run was wrapping up gets a fresh run.
    if (run.again && !run.controller.signal.aborted) void drive(ownerKey, postId, options);
  });
}

/** The post file an action works on. A version-1 file only opens to be looked at. */
async function requireFile(ownerKey: string, postId: string): Promise<PostFile> {
  const file = await getPostFile(ownerKey, postId);
  if (!file) throw new RecreateError("That post's working file doesn't exist or has expired.", 404);
  if (!isCurrentPostFile(file)) throw new RecreateError("This run was made by the earlier Recreate. It can still be opened, but not changed: start a new recreation to remake the post.", 409);
  return file;
}

// ── Actions ─────────────────────────────────────────────────────────────────
export type StartInput = {
  url?: string; uploads?: { name: string; dataUrl: string }[]; caption?: string; profileId: string; notes?: string; mode: PostMode;
  /** Links to posts on X to show on the reaction slides, read without Apify. */
  xPosts?: string[];
};

/** Creates the post file and starts its run. */
export async function startRecreate(ownerKey: string, input: StartInput, options: RunOptions = {}): Promise<Started> {
  if (runningFor(ownerKey) >= MAX_ACTIVE_PER_OWNER) throw new RecreateError("Four recreations are already running for this workspace. Wait for one to finish.", 429);
  // A missing profile or template fails now, not minutes into the run.
  const environment = await (options.environment ?? loadEnvironment)(ownerKey, input.profileId);
  // An exact copy shows only the posts from X its original shows, so added ones have nowhere to go.
  const xPosts = input.mode !== "exact" && input.xPosts?.length ? { xPosts: input.xPosts } : {};
  const file = await createPostFile(ownerKey, {
    profileId: input.profileId, mode: input.mode,
    source: { ...(input.url ? { url: input.url } : {}), caption: input.caption ?? "", notes: input.notes ?? "", slideCount: input.uploads?.length ?? 0, imageIds: [], ...xPosts },
  });
  return { file, done: drive(ownerKey, file.id, options, { uploads: input.uploads, environment }) };
}

const issuesOf = (error: { issues: { path: PropertyKey[]; message: string }[] }) => error.issues.slice(0, 6).map(issue => `${issue.path.map(String).join(".") || "value"}: ${issue.message}`).join("; ");
const reactionIds = (file: PostFile) => outputOf<Research>(file, "research")?.reactions.map(post => post.id) ?? [];

async function recordPick(ownerKey: string, postId: string, profile: PageProfile, options: RunOptions): Promise<void> {
  try {
    const file = await getPostFile(ownerKey, postId);
    const payload = file && pickPayload(file, profile);
    const save = options.savePick ?? (isHeadlineModelConfigured() ? savePick : null);
    if (!payload || !save) return;
    let event: string;
    try {
      const saved = await save(payload);
      event = `Sent the headline pick to the headline model (${saved.id})`;
    } catch (error) {
      event = `Couldn't send the headline pick to the headline model: ${error instanceof Error ? error.message : "unknown error"}`;
    }
    await updatePostFile(ownerKey, postId, current => { current.history.push({ at: new Date().toISOString(), stage: "approval", event, by: "engine" }); });
  } catch (error) {
    console.error("[recreate] couldn't record the headline pick", error instanceof Error ? error.message : error);
  }
}

export type ApproveInput = { plan?: unknown; option?: number; text?: string; notes?: string };
/** The checkpoint: approve (or edit) the plan and pick the headline. A person's pick goes to the headline model. */
export async function approveRecreate(ownerKey: string, postId: string, input: ApproveInput, by: StageActor, options: RunOptions = {}): Promise<Started> {
  const current = await requireFile(ownerKey, postId);
  if (current.mode === "exact") throw new RecreateError("An exact copy doesn't pause for approval: it copies the original as it is.", 409);
  if (current.stages.approval?.status === "done") throw new RecreateError("This post is already approved. Rerun the approval stage to change it.", 409);
  const planned = outputOf<StoryBrief>(current, "brief"), lines = outputOf<Headlines>(current, "headline");
  if (!planned || !lines) throw new RecreateError("The plan and the headline options aren't ready yet.", 409);
  const environment = await (options.environment ?? loadEnvironment)(ownerKey, current.profileId);
  let plan = normalizePlan({ slides: planned.slides, why: planned.why }, { reactions: reactionIds(current) });
  if (input.plan !== undefined) {
    const parsed = PlanSchema.safeParse(input.plan);
    if (!parsed.success) throw new RecreateError(`That plan isn't valid: ${issuesOf(parsed.error)}`);
    plan = normalizePlan(parsed.data, { reactions: reactionIds(current) });
    if (!plan.slides.length) throw new RecreateError("The edited plan has no slides that can be built.");
  }
  const approval: PlanApproval = { plan, headline: chooseHeadline(lines.options, input), notes: (input.notes ?? "").trim().slice(0, 2000) };
  const file = await updatePostFile(ownerKey, postId, next => {
    setStage(next, "approval", { status: "done", output: approval, error: undefined, instructions: undefined, round: 0, model: undefined, usage: undefined }, by, by === "human" ? "approved by a person" : "approved by an agent");
    next.status = "running";
    next.waiting = undefined;
    next.message = "Approved. Designing the slides";
  });
  const pick = by === "human" ? recordPick(ownerKey, postId, environment.profile, options) : Promise.resolve();
  const done = drive(ownerKey, postId, options, { environment });
  return { file, done: Promise.all([done, pick]).then(() => undefined) };
}

export type VerdictInput = { choice: "proceed" | "stop" | "link"; link?: string; note?: string };
const ORIGIN_LINK = /^https?:\/\/[^\s]+$/i;
/**
 * A person's answer to the check. proceed lets the run go on (on a stop, it is
 * Build it anyway: the warnings go into the brief's guardrails); stop ends it;
 * link stores the story's original and reruns research with it.
 */
export async function answerRecreateVerdict(ownerKey: string, postId: string, input: VerdictInput, by: StageActor, options: RunOptions = {}): Promise<Started> {
  const current = await requireFile(ownerKey, postId);
  const check = outputOf<Verdict>(current, "verdict"), gate = verdictOf(current);
  if (!check) throw new RecreateError("The check hasn't finished yet.", 409);
  if (gate === "proceed") throw new RecreateError(check.answer ? "The check is already answered: the post is being made." : "The story passed the check, so there's nothing to answer.", 409);
  const note = (input.note ?? "").trim().slice(0, 2000);
  if (input.choice === "link") {
    const link = (input.link ?? "").trim();
    if (!ORIGIN_LINK.test(link) || link.length > 2000) throw new RecreateError("Add the link to the story's original: the first post or article, starting with https://.");
    const file = await updatePostFile(ownerKey, postId, next => {
      next.source = { ...next.source, originUrl: link };
      setStage(next, "research", { status: "pending", round: 0, error: undefined, instructions: `A person added the story's original: ${link}. Start from it.${note ? ` Their note: ${note}` : ""}` }, by, `the original's link added: ${link.slice(0, 160)}`);
      for (const later of downstreamOf("research", next.mode)) if (next.stages[later]) setStage(next, later, { status: "pending", round: 0, instructions: undefined, error: undefined }, "engine", "rerun after the original's link was added");
      next.status = "running";
      next.waiting = undefined;
      next.message = "Researching again from the original's link";
    });
    return { file, done: drive(ownerKey, postId, options) };
  }
  if (input.choice !== "proceed" && input.choice !== "stop") throw new RecreateError("Answer the check with proceed, stop or the original's link.");
  const answered: Verdict = { ...check, answer: { choice: input.choice, by, at: new Date().toISOString(), note } };
  const file = await updatePostFile(ownerKey, postId, next => {
    const record = next.stages.verdict;
    if (!record || record.status !== "done") throw new RecreateError("The check hasn't finished yet.", 409);
    record.output = answered;
    next.history.push({ at: new Date().toISOString(), stage: "verdict", event: input.choice === "proceed" ? check.outcome === "stop" ? "built anyway" : "answered: proceed" : "answered: stop", by });
    next.waiting = undefined;
    if (input.choice === "stop") {
      next.status = "stopped";
      next.message = "Stopped: you chose not to make this post.";
    } else {
      next.status = "running";
      next.message = check.outcome === "stop" ? "Building it anyway, with the check's warnings in the brief" : "Going ahead";
    }
  });
  return { file, done: input.choice === "proceed" ? drive(ownerKey, postId, options) : Promise.resolve() };
}

/** Stages a stop, a failure or a restart left unfinished go back in line, so the run can finish. */
function resumeUnfinished(file: PostFile, except?: PostStage) {
  for (const stage of POST_STAGES) {
    const status = file.stages[stage]?.status;
    if (stage !== except && (status === "error" || status === "running")) setStage(file, stage, { status: "pending", error: undefined }, "engine", "resumed");
  }
}

/** A stage this run's mode doesn't have can't be rerun or handed in. */
function requireModeStage(file: PostFile, stage: PostStage) {
  const stages = stagesFor(file.mode);
  if (stages.includes(stage)) return;
  throw new RecreateError(file.mode === "exact" ? `An exact copy has no ${stage} stage. Its stages are ${stages.join(", ")}.` : `A full recreation has no ${stage} stage; it belongs to an exact copy.`);
}

/** Reruns one stage (with optional instructions) and everything that read it. */
export async function rerunRecreateStage(ownerKey: string, postId: string, stage: PostStage, instructions: string | undefined, by: StageActor, options: RunOptions = {}): Promise<Started> {
  if (!POST_STAGES.includes(stage)) throw new RecreateError(`There is no ${String(stage)} stage. The stages are ${POST_STAGES.join(", ")}.`);
  requireModeStage(await requireFile(ownerKey, postId), stage);
  const text = instructions?.trim().slice(0, 2000) || undefined;
  const file = await updatePostFile(ownerKey, postId, next => {
    setStage(next, stage, { status: "pending", round: 0, instructions: text, error: undefined }, by, text ? `rerun: ${text.slice(0, 160)}` : "rerun");
    for (const later of downstreamOf(stage, next.mode)) if (next.stages[later]) setStage(next, later, { status: "pending", round: 0, instructions: undefined, error: undefined }, "engine", `rerun after ${stage}`);
    // On a stopped run, a stage that doesn't depend on this one would otherwise stop it again.
    if (!isRunning(postId)) resumeUnfinished(next, stage);
    next.status = "running";
    next.waiting = undefined;
    next.message = `Rerunning: ${label(stage, next.mode)}`;
  });
  return { file, done: drive(ownerKey, postId, options) };
}

/** An outside agent (or a person) hands in one stage; Engine checks it against the stage's schema and reruns what depends on it. */
export async function submitRecreateStage(ownerKey: string, postId: string, stage: PostStage, output: unknown, by: StageActor, options: RunOptions = {}): Promise<Started> {
  if (stage === "verdict") throw new RecreateError("The check is answered, not handed in: a person answers it with proceed, stop or the original's link.");
  const schema = HANDED_IN[stage];
  if (!schema) throw new RecreateError(`Engine builds the ${String(stage)} stage itself. Stages you can hand in: ${Object.keys(HANDED_IN).join(", ")}.`);
  if (stage === "approval") {
    const parsed = schema.safeParse(output);
    if (!parsed.success) throw new RecreateError(`That approval doesn't match its schema: ${issuesOf(parsed.error)}`);
    const { plan, headline: chosen, notes } = parsed.data as PlanApproval;
    return approveRecreate(ownerKey, postId, { plan, ...(chosen.option >= 0 ? { option: chosen.option } : { text: chosen.text }), notes }, by, options);
  }
  const current = await requireFile(ownerKey, postId);
  requireModeStage(current, stage);
  const missing = inputsOf(stage, current.mode).filter(input => !settled(current, input));
  if (missing.length) throw new RecreateError(`The ${stage} stage needs ${missing.join(", ")} first.`, 409);
  if (inputsOf(stage, current.mode).includes("verdict") && verdictOf(current) !== "proceed") throw new RecreateError(`The ${stage} stage waits for the check to say proceed.`, 409);
  const parsed = schema.safeParse(output);
  if (!parsed.success) throw new RecreateError(`That ${stage} doesn't match its schema: ${issuesOf(parsed.error)}`);
  let value: unknown = parsed.data;
  if (stage === "brief") {
    const handed = parsed.data as StoryBrief, plan = normalizePlan({ slides: handed.slides, why: handed.why }, { reactions: reactionIds(current) });
    if (!plan.slides.length) throw new RecreateError("That brief's plan has no slides that can be built.");
    value = { ...handed, slides: plan.slides, why: plan.why } satisfies StoryBrief;
  }
  if (stage === "source") value = withDecisions(parsed.data as SourceNotes);
  if (stage === "headline" && !(value as Headlines).options.length) throw new RecreateError("Hand in at least one headline option.");
  const file = await updatePostFile(ownerKey, postId, next => {
    setStage(next, stage, { status: "done", output: value, error: undefined, instructions: undefined, round: 0, model: undefined, usage: undefined }, by, `handed in by ${by === "human" ? "a person" : "an agent"}`);
    for (const later of downstreamOf(stage, next.mode)) if (next.stages[later]) setStage(next, later, { status: "pending", round: 0, instructions: undefined, error: undefined }, "engine", `rerun after ${stage} was handed in`);
    if (!isRunning(postId)) resumeUnfinished(next, stage);
    next.status = "running";
    next.waiting = undefined;
  });
  return { file, done: drive(ownerKey, postId, options) };
}

export type AddedPosts = Started & { added: number; problems: string[] };
const ADDED_TOO_LATE = "This post is already approved. Add posts from X before you approve the plan.";
/**
 * At the checkpoint, posts from X added by link join the research's reactions, so
 * the plan can use them. They're read from X's public embed data, so they need no
 * Apify plan. Nothing reruns: the plan and the headlines stay as they are, and the
 * person puts the new posts on reaction slides before approving. Posts already on
 * the list are skipped.
 */
export async function addRecreatePosts(ownerKey: string, postId: string, links: string[], by: StageActor): Promise<AddedPosts> {
  const current = await requireFile(ownerKey, postId);
  if (current.mode === "exact") throw new RecreateError("An exact copy shows only the posts from X its original shows, so others can't be added to it.", 409);
  if (current.stages.approval?.status === "done") throw new RecreateError(ADDED_TOO_LATE, 409);
  if (isRunning(postId) || current.status !== "paused" || current.waiting !== "approval" || !outputOf(current, "brief") || !outputOf(current, "headline")) throw new RecreateError("Add posts from X once the plan is ready for you to check.", 409);
  const known = new Set(reactionIds(current)), ids: string[] = [];
  for (const link of links) {
    const id = xPostId(link);
    if (!id) throw new RecreateError(`"${String(link).slice(0, 60)}" isn't a link to a post on X.`);
    if (!known.has(id) && !ids.includes(id)) ids.push(id);
  }
  if (!ids.length) return { file: current, done: Promise.resolve(), added: 0, problems: [] };
  if (new Set([...(current.source.xPosts ?? []), ...ids.map(xPostLink)]).size > MAX_ADDED_POSTS) throw new RecreateError(`Add at most ${MAX_ADDED_POSTS} posts from X to one post.`);
  const { posts, problems } = await fetchXPosts(ids.map(xPostLink));
  if (!posts.length) throw new RecreateError(problems.join(" ") || "X didn't send those posts. Try again in a minute.", 422);
  let added = 0;
  const file = await updatePostFile(ownerKey, postId, next => {
    if (next.stages.approval?.status === "done") throw new RecreateError(ADDED_TOO_LATE, 409);
    const record = next.stages.research, found = record?.status === "done" ? record.output as Research : undefined;
    if (!found) throw new RecreateError("Add posts from X once the plan is ready for you to check.", 409);
    const mine = posts.filter(post => !found.reactions.some(item => item.id === post.id)).map(post => ({ ...post, why: "Added by you" }));
    added = mine.length;
    if (!mine.length) return;
    // The research keeps everything else it found; the posts join its reactions, so the plan can use them. Nothing reruns.
    record!.output = { ...found, reactions: [...found.reactions, ...mine] } satisfies Research;
    next.history.push({ at: new Date().toISOString(), stage: "research", event: `added ${mine.length === 1 ? "a post" : `${mine.length} posts`} from X by link`, by });
    next.source = { ...next.source, xPosts: [...new Set([...(next.source.xPosts ?? []), ...mine.map(post => xPostLink(post.id))])] };
    if (problems.length) next.history.push({ at: new Date().toISOString(), stage: "research", event: `couldn't add: ${problems.join(" ")}`.slice(0, 400), by });
  });
  return { file, done: Promise.resolve(), added, problems };
}

/** Picks a stopped run up where its post file left off: failed and interrupted stages run again. */
export async function resumeRecreate(ownerKey: string, postId: string, options: RunOptions = {}): Promise<Started> {
  const current = await requireFile(ownerKey, postId);
  if (isRunning(postId)) return { file: current, done: Promise.resolve() };
  if (current.status === "done") throw new RecreateError("This post is finished. Rerun a stage to change it.", 409);
  if (current.status === "stopped") throw new RecreateError("The check stopped this post. Build it anyway, or rerun research, to go on.", 409);
  const file = await updatePostFile(ownerKey, postId, next => {
    resumeUnfinished(next);
    next.status = "running";
    next.waiting = undefined;
    next.message = "Resuming";
  });
  return { file, done: drive(ownerKey, postId, options) };
}
