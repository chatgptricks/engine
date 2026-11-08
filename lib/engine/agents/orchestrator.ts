/**
 * The orchestrator: runs the Recreate team over one post file. A stage starts
 * as soon as everything it reads is finished, so research and the makers run
 * in parallel, and each result is saved to the post file as it lands. A
 * checkpoint run pauses after the outline and hooks until a person approves.
 * A run picks up where its post file left off after a restart, reruns one
 * stage on request, and sends the critics' must-fix issues back at most twice.
 * An exact copy (mode exact) runs only its own three stages: the transcript,
 * the deck and the review, which sends fixes back to the transcript once.
 *
 * Runs live in this server process (Engine runs as one instance); the post
 * file is the record, so nothing is lost when the process stops.
 */
import { randomUUID } from "node:crypto";
import type { BrandGuide } from "../../template-editor/brand-guide";
import type { DesignTemplate } from "../../template-editor/model";
import { getEditorLibrary } from "../../template-editor/persistence";
import { libraryTemplates } from "../../template-editor/template-catalog";
import { isHeadlineModelConfigured, savePick, type HeadlineOption, type SavePickInput } from "../headline-model";
import { getPageProfile, PageProfileError, type PageProfile } from "../page-profiles";
import { createPostFile, downstreamOf, getPostFile, inputsOf, POST_STAGES, PostFileError, setStage, stagesFor, updatePostFile, type PostFile, type PostMode, type PostStage, type StageActor } from "../post-files";
import { MAX_ADDED_POSTS, xPostId, xPostLink } from "../x-links";
import { fetchXPosts } from "../x-reactions";
import { loadGuide, withGuideBrief } from "./brand";
import { RecreateError, UsageMeter } from "./claude";
import { outputOf, type RunCache, type StageContext, type StageResult, type StageRunner } from "./context";
import { deck } from "./deck";
import { exactDeck, exactPages, normalizeTranscript, transcript } from "./exact";
import { autoApprove, charts, copy, images } from "./makers";
import { templatePages } from "./pages";
import { roleCardFor } from "./playbook";
import { brief, data, facts, reactions, visuals } from "./research";
import { fixInstructions, review } from "./review";
import { ApprovalSchema, OutlineSchema, SUBMITTABLE, type Approval, type Brief, type DataOutput, type DeckOutput, type HooksOutput, type Issue, type Outline, type ReactionsOutput, type ReviewOutput, type TranscriptOutput } from "./schemas";
import { hooks, normalizeOutline, outline } from "./story";

export const RUNNERS: Record<PostStage, StageRunner> = {
  transcript, brief, facts, data, reactions, visuals, outline, hooks, approval: autoApprove, copy, charts, images, deck, review,
};
/** An exact copy builds its deck from the transcript; its review checks fidelity itself. */
const EXACT_RUNNERS: Partial<Record<PostStage, StageRunner>> = { deck: exactDeck };
/** Stages the post can do without: when one fails, the run goes on and the deck notes what's missing. */
const OPTIONAL = new Set<PostStage>(["reactions", "visuals", "images", "review"]);
type Route = Exclude<Issue["route"], "none">;
/** What each critic route reruns, before the deck is rebuilt and reviewed again. In an exact copy the transcript holds both the words and the picture boxes. */
const FIX_STAGES: Record<"full" | "exact", Record<Route, PostStage[]>> = {
  full: { copy: ["copy"], data: ["data", "charts"], images: ["images"] },
  exact: { copy: ["transcript"], data: [], images: ["transcript"] },
};
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
  transcript: "copying the original word for word",
  brief: "reading the original", facts: "checking the facts", data: "rebuilding the chart data", reactions: "finding reactions on X",
  visuals: "finding photos", outline: "planning the slides", hooks: "gathering hook options", approval: "taking the plan",
  copy: "writing the slides", charts: "drawing the charts", images: "choosing photos", deck: "building the deck", review: "reviewing the slides",
};
const settled = (file: PostFile, stage: PostStage) => file.stages[stage]?.status === "done" || file.stages[stage]?.status === "skipped";
function progressMessage(file: PostFile): string {
  const running = POST_STAGES.filter(stage => file.stages[stage]?.status === "running");
  // The first stage imports the post before it reads it.
  if ((running.includes("brief") || running.includes("transcript")) && !file.source.imageIds.length) return file.source.url ? "Importing the post from Instagram" : "Reading your screenshots";
  if (!running.length) return file.message;
  const text = running.map(stage => LABELS[stage]).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Stages that can start now: in the run's mode, not finished or failed, everything they read finished, and not the checkpoint in checkpoint mode. */
export function readyStages(file: PostFile, inFlight: ReadonlySet<PostStage> = new Set()): PostStage[] {
  return stagesFor(file.mode).filter(stage => {
    const status = file.stages[stage]?.status;
    if (inFlight.has(stage) || status === "done" || status === "skipped" || status === "error") return false;
    if (stage === "approval" && file.mode === "checkpoint") return false;
    return inputsOf(stage, file.mode).every(input => settled(file, input));
  });
}

function describeError(stage: PostStage, error: unknown): string {
  if (error instanceof RecreateError || error instanceof PostFileError) return error.message;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `${roleCardFor(stage).title} failed: Claude's API answered HTTP ${status}. Rerun this stage.`;
  return `${roleCardFor(stage).title} failed unexpectedly. Rerun this stage.`;
}

/** Sends the critics' must-fix issues back: the routed stages rerun with them, then the deck and the review. */
function scheduleFixes(file: PostFile, output: ReviewOutput) {
  if (!output.sentBack.length) return;
  const round = output.round + 1, routes = FIX_STAGES[file.mode === "exact" ? "exact" : "full"];
  // One stage may fix several routes (an exact copy's transcript holds the words and the picture boxes): it hears them all at once.
  const wanted = new Map<PostStage, Route[]>();
  for (const route of output.sentBack) for (const stage of routes[route]) wanted.set(stage, [...(wanted.get(stage) ?? []), route]);
  if (!wanted.size) return;
  for (const [stage, from] of wanted) {
    setStage(file, stage, { status: "pending", round, instructions: stage === "charts" ? undefined : fixInstructions(output, from) }, "engine", `sent back by the critics (round ${round})`);
  }
  setStage(file, "deck", { status: "pending", round, instructions: undefined }, "engine", `rebuild for round ${round}`);
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
      if (stage === "deck" && status === "done") current.deckId = (result.output as DeckOutput).deckId;
      if (stage === "review" && status === "done") scheduleFixes(current, result.output as ReviewOutput);
    } else {
      const text = describeError(stage, failure);
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
    const stages = stagesFor(file.mode);
    const failed = stages.find(stage => file.stages[stage]?.status === "error");
    const waiting = file.mode === "checkpoint" && file.stages.approval?.status !== "done" && inputsOf("approval", file.mode).every(stage => settled(file, stage));
    if (failed) {
      file.status = "error";
      file.message = file.stages[failed]?.error ?? `${roleCardFor(failed).title} failed.`;
    } else if (waiting) {
      file.status = "paused";
      file.message = "Ready for you: check the outline and pick the hook";
    } else if (stages.every(stage => settled(file, stage)) && settled(file, "deck")) {
      file.status = "done";
      const built = outputOf<DeckOutput>(file, "deck");
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
    file.message = text;
    file.history.push({ at: new Date().toISOString(), stage: "run", event: `stopped: ${text}`, by: "engine" });
  }).catch(() => undefined);
}

async function loop(run: Run, options: RunOptions, environment?: Environment): Promise<void> {
  const { ownerKey, postId } = run, signal = run.controller.signal;
  const first = await getPostFile(ownerKey, postId);
  if (!first) return;
  const env = environment ?? await (options.environment ?? loadEnvironment)(ownerKey, first.profileId);
  const runners = { ...RUNNERS, ...(first.mode === "exact" ? EXACT_RUNNERS : {}), ...options.runners };
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

async function requireFile(ownerKey: string, postId: string): Promise<PostFile> {
  const file = await getPostFile(ownerKey, postId);
  if (!file) throw new RecreateError("That post's working file doesn't exist or has expired.", 404);
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
  // An exact copy has no reaction slides, so posts from X have nowhere to go.
  const xPosts = input.mode !== "exact" && input.xPosts?.length ? { xPosts: input.xPosts } : {};
  const file = await createPostFile(ownerKey, {
    profileId: input.profileId, mode: input.mode,
    source: { ...(input.url ? { url: input.url } : {}), caption: input.caption ?? "", notes: input.notes ?? "", slideCount: input.uploads?.length ?? 0, imageIds: [], ...xPosts },
  });
  return { file, done: drive(ownerKey, file.id, options, { uploads: input.uploads, environment }) };
}

const issuesOf = (error: { issues: { path: PropertyKey[]; message: string }[] }) => error.issues.slice(0, 6).map(issue => `${issue.path.map(String).join(".") || "value"}: ${issue.message}`).join("; ");

function chooseHook(options: HooksOutput["options"], input: { option?: number; text?: string }): Approval["hook"] {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text) {
    if ([...text].length > 200) throw new RecreateError("Keep the hook under 200 characters.");
    return { text, option: options.findIndex(option => option.text.trim() === text) };
  }
  const index = input.option;
  if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index < options.length) return { text: options[index].text, option: index };
  throw new RecreateError("Pick one of the hook options or write your own.");
}

/** What a person's hook choice tells the headline model; null when it shouldn't hear about it (no model lines, not a person). */
export function pickPayload(file: PostFile, profile: PageProfile): SavePickInput | null {
  const approval = outputOf<Approval>(file, "approval"), lines = outputOf<HooksOutput>(file, "hooks"), b = outputOf<Brief>(file, "brief");
  if (!approval || !lines || file.stages.approval?.by !== "human" || lines.source !== "headline-model" || !lines.modelOptions.length) return null;
  const model: HeadlineOption[] = lines.modelOptions.map(option => ({ text: option.text, ...(option.framework ? { framework: option.framework } : {}), ...(option.sources ? { sources: option.sources } : {}) }));
  const base = { story: lines.story, originalHeadline: b?.originalHeadline ?? "", account: profile.id };
  const same = (a: string, b: string) => a.trim() === b.trim();
  if (profile.language !== "en") {
    // Only the model's own English lines go back; a line it didn't write counts as none of them.
    const chosen = approval.hook.option >= 0 ? lines.options[approval.hook.option] : undefined;
    const english = chosen?.by === "headline-model" ? chosen.english ?? chosen.text : undefined;
    const index = english ? model.findIndex(option => same(option.text, english)) : -1;
    return { ...base, options: model, chosen: index, finalText: index >= 0 ? model[index].text : "" };
  }
  // The copywriter's and agents' lines go along, tagged, so the model sees what it was up against.
  const others = lines.options.filter(option => option.by !== "headline-model" && !model.some(item => same(item.text, option.text)))
    .map(option => ({ text: option.text, framework: option.framework, sources: [option.by === "agent" ? "engine-agent" : "engine-copywriter"] }));
  const options = [...model, ...others];
  let index = options.findIndex(option => same(option.text, approval.hook.text));
  if (index < 0) { options.push({ text: approval.hook.text, sources: ["human"] }); index = options.length - 1; }
  return { ...base, options, chosen: index, finalText: approval.hook.text };
}

async function recordPick(ownerKey: string, postId: string, profile: PageProfile, options: RunOptions): Promise<void> {
  try {
    const file = await getPostFile(ownerKey, postId);
    const payload = file && pickPayload(file, profile);
    const save = options.savePick ?? (isHeadlineModelConfigured() ? savePick : null);
    if (!payload || !save) return;
    let event: string;
    try {
      const saved = await save(payload);
      event = `Sent the hook pick to the headline model (${saved.id})`;
    } catch (error) {
      event = `Couldn't send the hook pick to the headline model: ${error instanceof Error ? error.message : "unknown error"}`;
    }
    await updatePostFile(ownerKey, postId, current => { current.history.push({ at: new Date().toISOString(), stage: "approval", event, by: "engine" }); });
  } catch (error) {
    console.error("[recreate] couldn't record the hook pick", error instanceof Error ? error.message : error);
  }
}

export type ApproveInput = { outline?: unknown; option?: number; text?: string; notes?: string };
/** The checkpoint: approve (or edit) the outline and pick the hook. A person's pick goes to the headline model. */
export async function approveRecreate(ownerKey: string, postId: string, input: ApproveInput, by: StageActor, options: RunOptions = {}): Promise<Started> {
  const current = await requireFile(ownerKey, postId);
  if (current.mode === "exact") throw new RecreateError("An exact copy doesn't pause for approval: it copies the original as it is.", 409);
  if (current.stages.approval?.status === "done") throw new RecreateError("This post is already approved. Rerun the approval stage to change it.", 409);
  const planned = outputOf<Outline>(current, "outline"), lines = outputOf<HooksOutput>(current, "hooks");
  if (!planned || !lines) throw new RecreateError("The outline and the hook options aren't ready yet.", 409);
  const environment = await (options.environment ?? loadEnvironment)(ownerKey, current.profileId);
  let chosen: Outline = { slides: planned.slides, why: planned.why };
  if (input.outline !== undefined) {
    const parsed = OutlineSchema.safeParse(input.outline);
    if (!parsed.success) throw new RecreateError(`That outline isn't valid: ${issuesOf(parsed.error)}`);
    chosen = normalizeOutline(parsed.data, templatePages(environment.template), {
      charts: outputOf<DataOutput>(current, "data")?.charts.map(chart => chart.id) ?? [],
      reactions: outputOf<ReactionsOutput>(current, "reactions")?.reactions.map(post => post.id) ?? [],
    });
    if (!chosen.slides.length) throw new RecreateError("The edited outline has no slides this template can show.");
  }
  const approval: Approval = { outline: chosen, hook: chooseHook(lines.options, input), notes: (input.notes ?? "").trim().slice(0, 2000) };
  const file = await updatePostFile(ownerKey, postId, next => {
    setStage(next, "approval", { status: "done", output: approval, error: undefined, instructions: undefined, round: 0, model: undefined, usage: undefined }, by, by === "human" ? "approved by a person" : "approved by an agent");
    next.status = "running";
    next.message = "Approved. Writing the slides";
  });
  const pick = by === "human" ? recordPick(ownerKey, postId, environment.profile, options) : Promise.resolve();
  const done = drive(ownerKey, postId, options, { environment });
  return { file, done: Promise.all([done, pick]).then(() => undefined) };
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
  if (!POST_STAGES.includes(stage)) throw new RecreateError(`There is no ${String(stage)} stage.`);
  requireModeStage(await requireFile(ownerKey, postId), stage);
  const text = instructions?.trim().slice(0, 2000) || undefined;
  const file = await updatePostFile(ownerKey, postId, next => {
    setStage(next, stage, { status: "pending", round: 0, instructions: text, error: undefined }, by, text ? `rerun: ${text.slice(0, 160)}` : "rerun");
    for (const later of downstreamOf(stage, next.mode)) if (next.stages[later]) setStage(next, later, { status: "pending", round: 0, instructions: undefined, error: undefined }, "engine", `rerun after ${stage}`);
    // On a stopped run, a stage that doesn't depend on this one would otherwise stop it again.
    if (!isRunning(postId)) resumeUnfinished(next, stage);
    next.status = "running";
    next.message = `Rerunning: ${LABELS[stage]}`;
  });
  return { file, done: drive(ownerKey, postId, options) };
}

/** An outside agent (or a person) hands in one stage; Engine checks it against the stage's schema and reruns what depends on it. */
export async function submitRecreateStage(ownerKey: string, postId: string, stage: PostStage, output: unknown, by: StageActor, options: RunOptions = {}): Promise<Started> {
  const schema = SUBMITTABLE[stage];
  if (!schema) throw new RecreateError(`Engine builds the ${String(stage)} stage itself. Stages you can hand in: ${Object.keys(SUBMITTABLE).join(", ")}.`);
  if (stage === "approval") {
    const parsed = ApprovalSchema.safeParse(output);
    if (!parsed.success) throw new RecreateError(`That approval doesn't match its schema: ${issuesOf(parsed.error)}`);
    const { outline: plan, hook, notes } = parsed.data;
    return approveRecreate(ownerKey, postId, { outline: plan, ...(hook.option >= 0 ? { option: hook.option } : { text: hook.text }), notes }, by, options);
  }
  const current = await requireFile(ownerKey, postId);
  requireModeStage(current, stage);
  const missing = inputsOf(stage, current.mode).filter(input => !settled(current, input));
  if (missing.length) throw new RecreateError(`The ${stage} stage needs ${missing.join(", ")} first.`, 409);
  const parsed = schema.safeParse(output);
  if (!parsed.success) throw new RecreateError(`That ${stage} doesn't match its schema: ${issuesOf(parsed.error)}`);
  let value: unknown = parsed.data;
  if (stage === "transcript") {
    const { template } = await (options.environment ?? loadEnvironment)(ownerKey, current.profileId);
    value = normalizeTranscript(parsed.data as TranscriptOutput, exactPages(template), current.source.slideCount);
    if (!(value as TranscriptOutput).slides.length) throw new RecreateError("That transcript has no slides this template can show.");
  }
  if (stage === "outline") {
    const { template } = await (options.environment ?? loadEnvironment)(ownerKey, current.profileId);
    const all = templatePages(template);
    const plan = normalizeOutline(parsed.data as Outline, all, {
      charts: outputOf<DataOutput>(current, "data")?.charts.map(chart => chart.id) ?? [],
      reactions: outputOf<ReactionsOutput>(current, "reactions")?.reactions.map(post => post.id) ?? [],
    });
    if (!plan.slides.length) throw new RecreateError("That outline has no slides this template can show.");
    value = { ...plan, pages: all.map(page => ({ index: page.index, label: page.label, cards: page.cards })) };
  }
  if (stage === "hooks" && !(value as HooksOutput).options.length) throw new RecreateError("Hand in at least one hook option.");
  const file = await updatePostFile(ownerKey, postId, next => {
    setStage(next, stage, { status: "done", output: value, error: undefined, instructions: undefined, round: 0, model: undefined, usage: undefined }, by, `handed in by ${by === "human" ? "a person" : "an agent"}`);
    for (const later of downstreamOf(stage, next.mode)) if (next.stages[later]) setStage(next, later, { status: "pending", round: 0, instructions: undefined, error: undefined }, "engine", `rerun after ${stage} was handed in`);
    if (!isRunning(postId)) resumeUnfinished(next, stage);
    next.status = "running";
  });
  return { file, done: drive(ownerKey, postId, options) };
}

export type AddedPosts = Started & { added: number; problems: string[] };
const ADDED_TOO_LATE = "This post is already approved. Add posts from X before you approve the plan.";
/**
 * At the checkpoint, posts from X added by link join the reactions the slides can
 * use. They're read from X's public embed data, so they need no Apify plan. Nothing
 * reruns: the plan and the hooks stay as they are, and the person puts the new
 * posts on reaction slides before approving. Posts already on the list are skipped.
 */
export async function addRecreatePosts(ownerKey: string, postId: string, links: string[], by: StageActor): Promise<AddedPosts> {
  const current = await requireFile(ownerKey, postId);
  if (current.mode === "exact") throw new RecreateError("An exact copy has no reaction slides, so posts from X can't be added to it.", 409);
  if (current.stages.approval?.status === "done") throw new RecreateError(ADDED_TOO_LATE, 409);
  if (isRunning(postId) || current.status !== "paused" || !outputOf(current, "outline") || !outputOf(current, "hooks")) throw new RecreateError("Add posts from X once the plan is ready for you to check.", 409);
  const known = new Set((outputOf<ReactionsOutput>(current, "reactions")?.reactions ?? []).map(post => post.id)), ids: string[] = [];
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
    const record = next.stages.reactions;
    const saved = record?.output as Partial<ReactionsOutput> | undefined;
    const before: ReactionsOutput = { reactions: record?.status === "done" ? saved?.reactions ?? [] : [], note: saved?.note ?? record?.error ?? "" };
    const mine = posts.filter(post => !before.reactions.some(item => item.id === post.id)).map(post => ({ ...post, why: "Added by you" }));
    added = mine.length;
    if (!mine.length) return;
    // A search that found nothing (or couldn't run) keeps its note; the stage is done now that it has posts.
    setStage(next, "reactions", { status: "done", output: { reactions: [...before.reactions, ...mine], note: before.note } satisfies ReactionsOutput, error: undefined }, by, `added ${mine.length === 1 ? "a post" : `${mine.length} posts`} from X by link`);
    next.source = { ...next.source, xPosts: [...new Set([...(next.source.xPosts ?? []), ...mine.map(post => xPostLink(post.id))])] };
    if (problems.length) next.history.push({ at: new Date().toISOString(), stage: "reactions", event: `couldn't add: ${problems.join(" ")}`.slice(0, 400), by });
  });
  return { file, done: Promise.resolve(), added, problems };
}

/** Picks a stopped run up where its post file left off: failed and interrupted stages run again. */
export async function resumeRecreate(ownerKey: string, postId: string, options: RunOptions = {}): Promise<Started> {
  const current = await requireFile(ownerKey, postId);
  if (isRunning(postId)) return { file: current, done: Promise.resolve() };
  if (current.status === "done") throw new RecreateError("This post is finished. Rerun a stage to change it.", 409);
  const file = await updatePostFile(ownerKey, postId, next => {
    resumeUnfinished(next);
    next.status = "running";
    next.message = "Resuming";
  });
  return { file, done: drive(ownerKey, postId, options) };
}
