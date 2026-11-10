"use client";

import {useCallback, useEffect, useRef, useState} from "react";

/**
 * Client side of the Recreate post flow: request helpers, image prep, and the
 * live view of a run. A run is a team of agents working on one post file on
 * the server; this file reads that view and sends a person's actions on it
 * (answer the check, approve the plan, resume, stop). Runs made by the first
 * team (version 1) still open, read-only, with their own stage names.
 */
export type PageProfile = {
  id: string;
  name: string;
  handle: string;
  language: "en" | "es";
  templateId?: string;
  voice: string;
  rules: string[];
  followCta: {line1: string; maxChars: number};
  swipeText: string;
};
/** exact rebuilds the post as it is; checkpoint and autopilot run the full team (checkpoint pauses for your approval). */
export type RecreateMode = "checkpoint" | "autopilot" | "exact";
export type RecreateStatus = "queued" | "importing" | "researching" | "planning" | "paused" | "writing" | "building" | "reviewing" | "done" | "error" | "stopped";
/** The current team's stages, in the order they run. */
export type PostStageName = "source" | "research" | "verdict" | "brief" | "headline" | "approval" | "design" | "review";
/** The first team's stages, shown on its read-only runs. */
export type LegacyStageName = "transcript" | "brief" | "facts" | "data" | "reactions" | "visuals" | "outline" | "hooks" | "approval" | "copy" | "charts" | "images" | "deck" | "review";
export type StageName = PostStageName | LegacyStageName;
export type StageStatus = "pending" | "running" | "done" | "skipped" | "error";
/** One agent's (or Engine's) part of the run. */
export type StageView = {stage: StageName; title: string; by: "agent" | "code" | "human"; status: StageStatus; actor?: string; model?: string; round: number; summary: string};
export type FactCheck = {
  claim: string;
  /** The current team labels facts confirmed, reported, alleged or unknown; the first team's runs say confirmed, corrected or unverified. */
  verdict: "confirmed" | "reported" | "alleged" | "unknown" | "corrected" | "unverified";
  detail: string;
  sources: {title: string; url: string}[];
};
export type ReviewIssue = {slide: number; problem: string; fix: string; severity: "must_fix" | "should_fix" | "note"};
/** What the critics said about the finished slides. */
export type RecreateReview = {round: number; rendered: boolean; facts: string; design: string; sentBack: string[]; open: ReviewIssue[]};
export type RecreateResult = {
  deckId: string;
  editorUrl: string;
  name: string;
  slideCount: number;
  factChecks: FactCheck[];
  notes: string[];
  review: RecreateReview | null;
};
export type OutlineKind = "cover" | "original" | "question" | "reaction" | "takeaway" | "follow";
/** One slide of the plan. The designer picks each slide's template page and draws its chart from real numbers. */
export type OutlineSlide = {
  kind: OutlineKind;
  purpose: string;
  points: string[];
  /** The original slide it rebuilds, 1-based, or null. */
  original: number | null;
  /** The chart it shows (what, and from which source), or empty. */
  chart: string;
  reactionIds: string[];
  photo: string;
};
export type HookOption = {text: string; framework: string; by: "original" | "headline-model" | "copywriter" | "agent"; english: string | null};
export type CheckpointReaction = {id: string; url: string; name: string; handle: string; verified: boolean; text: string; likes: number; reposts: number; why: string};
/** The plan a person checks before the slides are designed. */
export type Checkpoint = {
  slides: OutlineSlide[];
  why: string;
  hooks: HookOption[];
  /** Who wrote the options after the original's. */
  hookSource: Exclude<HookOption["by"], "original">;
  hookNote: string;
  /** "original" when the original's headline leads because the post performs. */
  lead: "original" | "model";
  performing: boolean;
  reactions: CheckpointReaction[];
  brief: {topic: string; story: string; originalHeadline: string; angle: string} | null;
};
export type VerdictOutcome = "proceed" | "stop" | "ask";
export type FabricationSign = "no_original" | "lone_quote" | "shifting_numbers" | "satire_account" | "debunked" | "other";
export type SourceLink = {title: string; url: string};
/** The check: whether the story is worth making and true enough to make, with what research found that it went by. */
export type RecreateVerdict = {
  outcome: VerdictOutcome;
  /** What the run goes by: a person's answer, else the outcome. */
  choice: VerdictOutcome;
  reason: string;
  evidence: SourceLink[];
  answer: {choice: "proceed" | "stop"; by: "engine" | "agent" | "human"; at: string; note: string} | null;
  origin: {found: boolean; url: string | null; who: string; date: string | null; note: string} | null;
  fabrication: {sign: FabricationSign; detail: string}[];
  covered: {already: boolean; by: SourceLink[]; note: string} | null;
  fresh: {firstSeen: string | null; ageDays: number | null; stale: boolean} | null;
  saturation: {note: string; saturated: boolean} | null;
  traction: {performing: boolean; ratio: number | null} | null;
  /** The story's original, when a person added it. */
  originUrl: string;
};
export type RecreateJob = {
  jobId: string;
  postId?: string;
  /** 2 for the current team; 1 for the first team's runs, which open read-only. */
  version: 1 | 2;
  mode: RecreateMode;
  status: RecreateStatus;
  /** What a paused run waits for: an answer to the check, or the plan's approval. */
  waiting?: "verdict" | "approval";
  message: string;
  startedAt?: string | number;
  updatedAt?: string | number;
  stages: StageView[];
  verdict?: RecreateVerdict;
  checkpoint?: Checkpoint;
  result?: RecreateResult;
  /** Each image's decision once the source reader made it: rebuild it, keep it as it is, or find its source; `used` says what the designer used. */
  images?: RecreateImage[];
  error?: string;
  /** The run stopped part way and can pick up from its last finished stage. */
  resumable: boolean;
};
export type RecreateImage = {slide: number; kind: string; treatment: "rebuild" | "keep" | "source"; why: string; line: string; used?: string};
export type RecreateUpload = {name: string; dataUrl: string};
export type RecreateRequest = {url?: string; uploads?: RecreateUpload[]; caption?: string; profileId: string; notes?: string; mode: RecreateMode; xPosts?: string[]};
/** A person's go-ahead at the checkpoint. The plan is sent only when they changed it. */
export type ApproveRequest = {plan?: {slides: OutlineSlide[]; why: string}; headline: {option: number} | {text: string}; notes?: string};
/** A person's answer to the check: go ahead (Build it anyway, on a stop), don't make it, or add the story's original. */
export type VerdictAnswer = {choice: "proceed" | "stop"; note?: string} | {choice: "link"; link: string; note?: string};
export type RecreateAction = ({action: "approve"} & ApproveRequest) | ({action: "answer_verdict"} & VerdictAnswer)
  | {action: "rerun_stage"; stage: PostStageName; instructions?: string}
  | {action: "add_posts"; xPosts: string[]} | {action: "resume"} | {action: "stop"};
/** Text fields of the form, kept with a running job so a failed run can be edited and retried after a reload.
 * `mode` is where the post comes from; `kind` is what to make of it: an exact copy or a full recreation. */
export type RecreateDraftText = {mode: "link" | "screenshots"; url: string; caption: string; notes: string; profileId: string; xPosts?: string; kind?: RecreateKind};
export type RecreateKind = "exact" | "full";
export type TrackedRecreate = {
  jobId: string;
  startedAt: number;
  source: string;
  profileName: string;
  opened?: boolean;
  draft: RecreateDraftText;
};

export type RecreateLane = {title: string; stages: StageName[]};
/** The team's stages, grouped the way they run: read and check the story, plan it, design it, then the critics. */
export const RECREATE_LANES: RecreateLane[] = [
  {title: "Research", stages: ["source", "research", "verdict"]},
  {title: "Plan", stages: ["brief", "headline", "approval"]},
  {title: "Make", stages: ["design"]},
  {title: "Finish", stages: ["review"]},
];
/** An exact copy's stages: the original read and quickly checked, then the copy and its check against the original. */
export const EXACT_LANES: RecreateLane[] = [
  {title: "Read", stages: ["source", "research", "verdict"]},
  {title: "Copy", stages: ["design", "review"]},
];
const LEGACY_STAGE_NAMES: LegacyStageName[] = ["transcript", "brief", "facts", "data", "reactions", "visuals", "outline", "hooks", "approval", "copy", "charts", "images", "deck", "review"];
export const lanesFor = (mode?: RecreateMode) => mode === "exact" ? EXACT_LANES : RECREATE_LANES;
/** A job's lanes: the current team's by mode; a first-team run lists its own stages in one lane. */
export function lanesOf(job: Pick<RecreateJob, "version" | "stages"> | null, mode?: RecreateMode): RecreateLane[] {
  if (job?.version === 1) return [{title: "Earlier Recreate", stages: job.stages.map(stage => stage.stage)}];
  return lanesFor(mode);
}
export const RECREATE_STATUS_LABELS: Record<RecreateStatus, string> = {
  queued: "Starting", importing: "Reading the post", researching: "Researching", planning: "Planning the slides",
  paused: "Waiting for you", writing: "Writing the slides", building: "Designing the slides", reviewing: "Reviewing the slides",
  done: "Done", error: "Stopped", stopped: "Stopped at the check",
};
export const MAX_RECREATE_UPLOADS = 20;
export const MAX_RECREATE_SLIDES = 20;
/** Posts from X one reaction slide shows; the designer picks the Reaction page that fits them. */
export const MAX_POSTS_PER_SLIDE = 3;

/** Where a post added by link goes at the checkpoint: on the last reaction slide with room for it,
 * or on a new reaction slide before the closing Follow slide. Null when there's no room for another
 * slide. `changed` is false when the post is already on a slide (`at`). */
export function placePost<T extends OutlineSlide>(slides: T[], postId: string, options: {maxPosts?: number; slide: () => T}): {slides: T[]; at: number; created: boolean; changed: boolean} | null {
  const maxPosts = options.maxPosts ?? MAX_POSTS_PER_SLIDE;
  const already = slides.findIndex(slide => slide.reactionIds.includes(postId));
  if (already >= 0) return {slides, at: already, created: false, changed: false};
  for (let at = slides.length - 1; at >= 0; at--) {
    const slide = slides[at];
    if (slide.kind !== "reaction" || slide.reactionIds.length >= maxPosts) continue;
    const ids = [...slide.reactionIds, postId];
    return {slides: slides.map((item, index) => index === at ? {...item, reactionIds: ids} : item), at, created: false, changed: true};
  }
  if (slides.length >= MAX_RECREATE_SLIDES) return null;
  const slide: T = {...options.slide(), reactionIds: [postId]};
  const at = slides.at(-1)?.kind === "follow" ? slides.length - 1 : slides.length;
  return {slides: [...slides.slice(0, at), slide, ...slides.slice(at)], at, created: true, changed: true};
}
export const MAX_HOOK_CHARACTERS = 200;
export const RECREATE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIDE = 1600;
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const ENDPOINT = "/api/engine/recreate";
const PROFILES_ENDPOINT = "/api/engine/page-profiles";
const STATUSES: RecreateStatus[] = ["queued", "importing", "researching", "planning", "paused", "writing", "building", "reviewing", "done", "error", "stopped"];
const STAGE_NAMES: StageName[] = [...new Set([...RECREATE_LANES.flatMap(lane => lane.stages), ...LEGACY_STAGE_NAMES])];
const STAGE_STATUSES: StageStatus[] = ["pending", "running", "done", "skipped", "error"];
const VERDICTS: FactCheck["verdict"][] = ["confirmed", "reported", "alleged", "unknown", "corrected", "unverified"];
const SEVERITIES: ReviewIssue["severity"][] = ["must_fix", "should_fix", "note"];
const KINDS: OutlineKind[] = ["cover", "original", "question", "reaction", "takeaway", "follow"];
const HOOK_SOURCES: HookOption["by"][] = ["original", "headline-model", "copywriter", "agent"];
const WRITERS: Checkpoint["hookSource"][] = ["headline-model", "copywriter", "agent"];
const OUTCOMES: VerdictOutcome[] = ["proceed", "stop", "ask"];
const SIGNS: FabricationSign[] = ["no_original", "lone_quote", "shifting_numbers", "satire_account", "debunked", "other"];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 4000): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const time = (value: unknown): string | number | undefined => typeof value === "string" || typeof value === "number" ? value : undefined;
const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const strings = (value: unknown, max = 2000): string[] => list(value).map(item => text(item, max)).filter(Boolean);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback;
const numberOrNull = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const links = (value: unknown): SourceLink[] => list(value).flatMap(source => {
  if (!isRecord(source)) return [];
  const url = text(source.url, 2000), title = text(source.title, 300);
  return url || title ? [{title: title || url, url}] : [];
});

export class RecreateRequestError extends Error {
  readonly status: number;
  /** True when the message is the server's own `error` string. */
  readonly fromServer: boolean;
  constructor(message: string, status: number, fromServer = false) {
    super(message);
    this.name = "RecreateRequestError";
    this.status = status;
    this.fromServer = fromServer;
  }
}

function requestFailure(response: Response, body: unknown, subject: string): RecreateRequestError {
  const server = isRecord(body) ? text(body.error, 600) : "";
  if (server) return new RecreateRequestError(server, response.status, true);
  const status = response.status;
  if (status === 404) return new RecreateRequestError(`${subject} isn't available on this server yet (404). Try again after the next update.`, status);
  if (status === 401 || status === 403) return new RecreateRequestError("Your session has ended. Reload the page and sign in again.", status);
  if (status === 413) return new RecreateRequestError("These screenshots are too large to send together. Remove a few and try again.", status);
  if (status === 429) return new RecreateRequestError("Too many requests right now. Wait a minute and try again.", status);
  return new RecreateRequestError(`${subject} ran into a server problem (HTTP ${status}). Try again in a moment.`, status);
}

async function send(input: string, init: RequestInit, subject: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input, {cache: "no-store", ...init});
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new RecreateRequestError("Engine couldn't be reached. Check your connection and try again.", 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw requestFailure(response, body, subject);
  return body;
}
const post = (body: unknown, subject: string) => send(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}, subject);

function parseProfile(value: unknown): PageProfile | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 200);
  if (!id) return null;
  const cta = isRecord(value.followCta) ? value.followCta : {};
  return {
    id,
    name: text(value.name, 200) || id,
    handle: text(value.handle, 100).replace(/^@/, ""),
    language: value.language === "es" ? "es" : "en",
    ...(typeof value.templateId === "string" && value.templateId ? {templateId: value.templateId} : {}),
    voice: text(value.voice),
    rules: Array.isArray(value.rules) ? value.rules.filter((rule): rule is string => typeof rule === "string") : [],
    followCta: {line1: text(cta.line1, 300), maxChars: typeof cta.maxChars === "number" ? cta.maxChars : 0},
    swipeText: text(value.swipeText, 300),
  };
}

export async function fetchPageProfiles(signal?: AbortSignal): Promise<PageProfile[]> {
  const body = await send(PROFILES_ENDPOINT, {signal}, "Page profiles");
  if (!isRecord(body) || !Array.isArray(body.profiles)) throw new RecreateRequestError("Page profiles came back in an unexpected format.", 200);
  return body.profiles.map(parseProfile).filter((profile): profile is PageProfile => profile !== null);
}

function parseFactCheck(value: unknown): FactCheck | null {
  if (!isRecord(value)) return null;
  const claim = text(value.claim, 2000);
  if (!claim) return null;
  return {claim, verdict: oneOf(value.verdict, VERDICTS, "unverified"), detail: text(value.detail, 4000), sources: links(value.sources)};
}

function parseReview(value: unknown): RecreateReview | null {
  if (!isRecord(value)) return null;
  const open = list(value.open).flatMap((issue): ReviewIssue[] => {
    if (!isRecord(issue)) return [];
    const problem = text(issue.problem, 2000);
    return problem ? [{slide: count(issue.slide), problem, fix: text(issue.fix, 2000), severity: oneOf(issue.severity, SEVERITIES, "note")}] : [];
  });
  return {round: count(value.round), rendered: value.rendered === true, facts: text(value.facts, 2000), design: text(value.design, 2000), sentBack: strings(value.sentBack, 40), open};
}

function parseResult(value: unknown): RecreateResult | undefined {
  if (!isRecord(value)) return undefined;
  const deckId = text(value.deckId, 200);
  if (!deckId) return undefined;
  return {
    deckId,
    editorUrl: text(value.editorUrl, 2000),
    name: text(value.name, 200) || "Recreated post",
    slideCount: count(value.slideCount),
    factChecks: list(value.factChecks).map(parseFactCheck).filter((item): item is FactCheck => item !== null),
    notes: strings(value.notes),
    review: parseReview(value.review),
  };
}

function parseStage(value: unknown): StageView | null {
  if (!isRecord(value) || !STAGE_NAMES.includes(value.stage as StageName)) return null;
  return {
    stage: value.stage as StageName,
    title: text(value.title, 120) || String(value.stage),
    by: oneOf(value.by, ["agent", "code", "human"] as const, "agent"),
    status: oneOf(value.status, STAGE_STATUSES, "pending"),
    ...(text(value.actor, 40) ? {actor: text(value.actor, 40)} : {}),
    ...(text(value.model, 80) ? {model: text(value.model, 80)} : {}),
    round: count(value.round),
    summary: text(value.summary, 600),
  };
}

function parseSlide(value: unknown): OutlineSlide | null {
  if (!isRecord(value)) return null;
  const original = numberOrNull(value.original);
  return {
    kind: oneOf(value.kind, KINDS, "original"),
    purpose: text(value.purpose, 1000),
    points: strings(value.points, 1000),
    original: original !== null && original >= 1 ? Math.round(original) : null,
    chart: text(value.chart, 600),
    reactionIds: strings(value.reactionIds, 80),
    photo: text(value.photo, 600),
  };
}

function parseCheckpoint(value: unknown): Checkpoint | undefined {
  if (!isRecord(value)) return undefined;
  const outline = isRecord(value.outline) ? value.outline : {}, hooks = isRecord(value.hooks) ? value.hooks : {};
  const slides = list(outline.slides).map(parseSlide).filter((slide): slide is OutlineSlide => slide !== null);
  if (!slides.length) return undefined;
  const options = list(hooks.options).flatMap((option): HookOption[] => {
    if (!isRecord(option) || !text(option.text, 400)) return [];
    return [{text: text(option.text, 400), framework: text(option.framework, 120), by: oneOf(option.by, HOOK_SOURCES, "agent"), english: text(option.english, 400) || null}];
  });
  const reactions = list(value.reactions).flatMap((item): CheckpointReaction[] => {
    if (!isRecord(item) || !text(item.id, 80)) return [];
    const author = isRecord(item.author) ? item.author : {};
    return [{
      id: text(item.id, 80), url: text(item.url, 2000), name: text(author.name, 120), handle: text(author.handle, 80).replace(/^@/, ""),
      verified: author.verified === true, text: text(item.text, 1200), likes: count(item.likes), reposts: count(item.reposts), why: text(item.why, 600),
    }];
  });
  const brief = isRecord(value.brief)
    ? {topic: text(value.brief.topic, 600), story: text(value.brief.story, 2000), originalHeadline: text(value.brief.originalHeadline, 600), angle: text(value.brief.angle, 600)}
    : null;
  return {
    slides, why: text(outline.why, 2000), hooks: options,
    hookSource: oneOf(hooks.source, WRITERS, "copywriter"), hookNote: text(hooks.note, 600),
    lead: hooks.lead === "original" ? "original" : "model", performing: hooks.performing === true,
    reactions, brief,
  };
}

function parseVerdict(value: unknown): RecreateVerdict | undefined {
  if (!isRecord(value) || !OUTCOMES.includes(value.outcome as VerdictOutcome)) return undefined;
  const outcome = value.outcome as VerdictOutcome;
  const said = isRecord(value.answer) ? value.answer : null;
  const answer = said && (said.choice === "proceed" || said.choice === "stop")
    ? {choice: oneOf(said.choice, ["proceed", "stop"] as const, "proceed"), by: oneOf(said.by, ["engine", "agent", "human"] as const, "human"), at: text(said.at, 40), note: text(said.note, 2000)}
    : null;
  const origin = isRecord(value.origin) ? value.origin : null, covered = isRecord(value.covered) ? value.covered : null;
  const fresh = isRecord(value.fresh) ? value.fresh : null, saturation = isRecord(value.saturation) ? value.saturation : null, traction = isRecord(value.traction) ? value.traction : null;
  return {
    outcome, choice: oneOf(value.choice, OUTCOMES, answer?.choice ?? outcome), reason: text(value.reason, 2000), evidence: links(value.evidence), answer,
    origin: origin ? {found: origin.found === true, url: text(origin.url, 2000) || null, who: text(origin.who, 300), date: text(origin.date, 40) || null, note: text(origin.note, 1000)} : null,
    fabrication: list(value.fabrication).flatMap(sign => isRecord(sign) ? [{sign: oneOf(sign.sign, SIGNS, "other"), detail: text(sign.detail, 1000)}] : []),
    covered: covered ? {already: covered.already === true, by: links(covered.by), note: text(covered.note, 1000)} : null,
    fresh: fresh ? {firstSeen: text(fresh.firstSeen, 40) || null, ageDays: numberOrNull(fresh.ageDays), stale: fresh.stale === true} : null,
    saturation: saturation ? {note: text(saturation.note, 1000), saturated: saturation.saturated === true} : null,
    traction: traction ? {performing: traction.performing === true, ratio: numberOrNull(traction.ratio)} : null,
    originUrl: text(value.originUrl, 2000),
  };
}

const TREATMENTS = ["rebuild", "keep", "source"] as const;
function parseImage(value: unknown): RecreateImage | null {
  if (!isRecord(value) || !TREATMENTS.includes(value.treatment as RecreateImage["treatment"])) return null;
  const slide = Number(value.slide), line = text(value.line, 300), used = text(value.used, 400);
  if (!Number.isInteger(slide) || slide < 1 || !line) return null;
  return {slide, kind: text(value.kind, 40), treatment: value.treatment as RecreateImage["treatment"], why: text(value.why, 240), line, ...(used ? {used} : {})};
}

function parseJob(body: unknown, fallbackJobId = ""): RecreateJob {
  if (!isRecord(body) || !STATUSES.includes(body.status as RecreateStatus)) throw new RecreateRequestError("Progress came back in an unexpected format.", 200);
  const jobId = text(body.jobId, 200) || fallbackJobId;
  if (!jobId) throw new RecreateRequestError("The server accepted the request but didn't return a job. Try again.", 200);
  const result = parseResult(body.result), checkpoint = parseCheckpoint(body.checkpoint), verdict = parseVerdict(body.verdict), error = text(body.error, 1000);
  const images = list(body.images).map(parseImage).filter((image): image is RecreateImage => image !== null).slice(0, 60);
  return {
    jobId,
    ...(text(body.postId, 200) ? {postId: text(body.postId, 200)} : {}),
    version: body.version === 1 ? 1 : 2,
    mode: body.mode === "checkpoint" || body.mode === "exact" ? body.mode : "autopilot",
    status: body.status as RecreateStatus,
    ...(body.waiting === "verdict" || body.waiting === "approval" ? {waiting: body.waiting} : {}),
    message: text(body.message, 600),
    startedAt: time(body.startedAt),
    updatedAt: time(body.updatedAt),
    stages: list(body.stages).map(parseStage).filter((stage): stage is StageView => stage !== null),
    ...(verdict ? {verdict} : {}),
    ...(checkpoint ? {checkpoint} : {}),
    ...(result ? {result} : {}),
    ...(images.length ? {images} : {}),
    ...(error ? {error} : {}),
    resumable: body.resumable === true,
  };
}

export async function startRecreate(request: RecreateRequest): Promise<RecreateJob> {
  return parseJob(await post(request, "Recreate post"));
}

export async function fetchRecreateJob(jobId: string, signal?: AbortSignal): Promise<RecreateJob> {
  return parseJob(await send(`${ENDPOINT}?jobId=${encodeURIComponent(jobId)}`, {signal}, "Recreate progress"), jobId);
}

/** Acts on a run. Returns its new view, or null after a stop (the next poll shows where it stopped). */
export async function actOnRecreate(jobId: string, action: RecreateAction): Promise<RecreateJob | null> {
  const body = await post({...action, jobId}, "Recreate");
  if (isRecord(body) && body.stopped === true) return null;
  return parseJob(body, jobId);
}

/** Accepts instagram.com post, reel and TV links (with or without https://) and drops tracking parameters. */
export function normalizeInstagramUrl(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
  if (host !== "instagram.com" && host !== "instagr.am") return null;
  if (!/^\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
  url.protocol = "https:";
  url.search = "";
  url.hash = "";
  return url.href;
}

/** A short, readable label for the source of a run, e.g. "instagram.com/p/ABC123". */
export function instagramLabel(url: string): string {
  try { const parsed = new URL(url); return `instagram.com${parsed.pathname.replace(/\/$/, "")}`; } catch { return url; }
}

export type PreparedUpload = RecreateUpload & {id: string; width: number; height: number};

/** Downscale to at most 1600px on the long side and encode as JPEG, so 20 slides stay a reasonable request. */
export async function prepareRecreateUpload(file: File): Promise<PreparedUpload> {
  if (!RECREATE_IMAGE_TYPES.includes(file.type)) throw new Error(`${file.name} isn't a JPG, PNG or WebP image.`);
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error(`${file.name} is larger than 40 MB.`);
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = source;
    await image.decode();
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't prepare images.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    if (!dataUrl.startsWith("data:image/jpeg")) throw new Error(`${file.name} couldn't be prepared.`);
    const name = `${file.name.replace(/\.(?:jpe?g|png|webp)$/i, "").slice(0, 190) || "slide"}.jpg`;
    return {id: crypto.randomUUID(), name, dataUrl, width, height};
  } catch (cause) {
    throw cause instanceof Error && cause.message.includes(file.name) ? cause : new Error(`${file.name} couldn't be read.`);
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** The server phrases setup problems; this only decides which extra hint fits. */
export function recreateSetupIssue(message: string): "apify" | "claude" | null {
  if (!/configur|not set|missing|api[ _-]?key|token|set ?up|enabled|credential/i.test(message)) return null;
  if (/apify/i.test(message)) return "apify";
  if (/claude|anthropic/i.test(message)) return "claude";
  return null;
}

export function safeSourceUrl(url: string): string | null {
  try { const parsed = new URL(url); return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null; } catch { return null; }
}

export function recreateTimestamp(value: string | number | undefined): number {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  return value ? Date.parse(value) : NaN;
}

function readTracked(key: string): TrackedRecreate | null {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    if (!isRecord(value) || !text(value.jobId, 200) || !isRecord(value.draft)) return null;
    const draft = value.draft;
    return {
      jobId: text(value.jobId, 200),
      startedAt: typeof value.startedAt === "number" ? value.startedAt : 0,
      source: text(value.source, 300),
      profileName: text(value.profileName, 200),
      opened: value.opened === true,
      draft: {mode: draft.mode === "screenshots" ? "screenshots" : "link", url: text(draft.url, 2000), caption: text(draft.caption, 5000), notes: text(draft.notes, 2000), profileId: text(draft.profileId, 200), xPosts: text(draft.xPosts, 4000), ...(draft.kind === "exact" || draft.kind === "full" ? {kind: draft.kind} : {})},
    };
  } catch { return null; }
}
function writeTracked(key: string, value: TrackedRecreate | null) {
  if (!key) return;
  try {
    if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
    else window.sessionStorage.removeItem(key);
  } catch { /* Progress still shows in this tab; it just won't survive a reload. */ }
}

/** How long to wait before the next progress check. A paused run waits on a person, so it is checked rarely. */
function pollDelay(status: RecreateStatus, failures: number): number {
  const hidden = document.visibilityState === "hidden";
  const base = status === "paused" ? (hidden ? 30_000 : 8000) : hidden ? 8000 : 2000;
  return failures ? Math.min(20_000, base * 2 ** Math.min(failures, 3)) : base;
}

/**
 * Tracks one recreate run per workspace in this tab. The job id lives in
 * sessionStorage, so a reload resumes polling where it left off. Polling stops
 * when the run is done or stopped, and starts again after an action on it.
 */
export function useRecreateJob(scope: string | undefined, onSettled?: (job: RecreateJob, tracked: TrackedRecreate | null) => boolean | void) {
  const key = scope ? `engine:recreate-job:${scope}` : "";
  const [tracked, setTracked] = useState<TrackedRecreate | null>(null);
  const [job, setJob] = useState<RecreateJob | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  // Bumped after an action, so polling picks up a run that had stopped.
  const [generation, setGeneration] = useState(0);
  const trackedRef = useRef(tracked), settled = useRef(onSettled), markOpenedRef = useRef(() => {});
  useEffect(() => { trackedRef.current = tracked; }, [tracked]);
  useEffect(() => { settled.current = onSettled; });

  useEffect(() => {
    if (!key) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = readTracked(key);
      setTracked(current => current?.jobId === saved?.jobId ? current : saved);
    });
    return () => { active = false; };
  }, [key]);

  const jobId = tracked?.jobId;
  useEffect(() => {
    if (!jobId) return;
    let active = true, failures = 0, status: RecreateStatus = "queued", timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const settle = (next: RecreateJob) => {
      setJob(next);
      setReconnecting(false);
      // Returning true means the caller opened the result, so a reload won't offer it as unseen.
      if (settled.current?.(next, trackedRef.current) === true) markOpenedRef.current();
    };
    const tick = async () => {
      try {
        const next = await fetchRecreateJob(jobId, controller.signal);
        if (!active) return;
        failures = 0;
        status = next.status;
        if (next.status === "done" && !next.result) { settle({...next, status: "error", error: "The post finished, but its result couldn't be read. Try again.", resumable: false}); return; }
        // A run the check stopped waits on a person too, but nothing moves until they act on it.
        if (next.status === "done" || next.status === "error" || next.status === "stopped") { settle(next); return; }
        setJob(next);
        setReconnecting(false);
      } catch (cause) {
        if (!active) return;
        const failure = cause instanceof RecreateRequestError ? cause : null, code = failure?.status ?? 0;
        if (failure && code >= 400 && code < 500 && code !== 408 && code !== 429) {
          const error = code === 404 && !failure.fromServer ? "This recreate run is no longer available. Start it again." : failure.message;
          settle({jobId, version: 2, mode: "autopilot", status: "error", message: "", stages: [], error, resumable: false});
          return;
        }
        failures++;
        if (failures >= 2) setReconnecting(true);
      }
      timer = setTimeout(() => void tick(), pollDelay(status, failures));
    };
    void tick();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [jobId, generation]);

  const start = useCallback(async (request: RecreateRequest, details: Omit<TrackedRecreate, "jobId" | "startedAt" | "opened">) => {
    const view = await startRecreate(request);
    const next: TrackedRecreate = {jobId: view.jobId, startedAt: Date.now(), ...details};
    writeTracked(key, next);
    setJob(view);
    setReconnecting(false);
    setTracked(next);
    return next;
  }, [key]);

  /** Answer the check, approve, rerun, resume or stop the tracked run, then follow it again. */
  const act = useCallback(async (action: RecreateAction) => {
    const current = trackedRef.current;
    if (!current) throw new RecreateRequestError("There's no run to update.", 0);
    const next = await actOnRecreate(current.jobId, action);
    if (next) setJob(next);
    setReconnecting(false);
    setGeneration(value => value + 1);
    return next;
  }, []);

  const markOpened = useCallback(() => {
    const current = trackedRef.current;
    if (!current || current.opened) return;
    const next = {...current, opened: true};
    trackedRef.current = next;
    writeTracked(key, next);
    setTracked(next);
  }, [key]);

  useEffect(() => { markOpenedRef.current = markOpened; }, [markOpened]);

  const dismiss = useCallback(() => {
    writeTracked(key, null);
    trackedRef.current = null;
    setTracked(null);
    setJob(null);
    setReconnecting(false);
  }, [key]);

  const visibleJob = tracked && job?.jobId === tracked.jobId ? job : null;
  return {tracked, job: visibleJob, reconnecting, start, act, markOpened, dismiss};
}
