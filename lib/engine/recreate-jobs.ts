/**
 * What the dialog and agents see of a Recreate run: a live view of its post
 * file (lib/engine/post-files.ts). The post file is the record, so a server
 * restart loses nothing: a run it interrupted shows as stopped and resumes
 * from its last finished stage. A job id is the post file's id without the
 * "post-" prefix, so older clients that poll `?jobId=` keep working.
 *
 * Version-1 files (the first team's) show read-only: their stages, and the
 * deck when they finished, with nothing to approve or resume.
 */
import { editorUrl } from "./agents/deck";
import { stageCard } from "./agents/playbook";
import { verdictChoice, type Approval, type Brief, type ChartsOutput, type CopyOutput, type DataOutput, type DeckOutput, type DesignOutput, type ExactDataOutput, type Facts, type Headlines, type HooksOutput, type ImagesOutput, type Link, type Outline, type PlanApproval, type ReactionsOutput, type Research, type ReviewOutput, type ReviewReport, type SourceNotes, type StoryBrief, type TranscriptOutput, type Verdict, type VisualsOutput } from "./agents/schemas";
import { isCurrentPostFile, legacyStagesFor, POST_STAGES, stagesFor, type LegacyStage, type PostFile, type PostStage, type StageName, type StageRecord } from "./post-files";

/** `stopped`: the check stopped the post (no deck). `paused`: it waits for a person, at the check or the checkpoint. */
export type RecreateStatus = "queued" | "importing" | "researching" | "planning" | "paused" | "writing" | "building" | "reviewing" | "done" | "error" | "stopped";
export const jobIdFor = (postId: string) => postId.replace(/^post-/, "");
export const postIdFor = (jobId: string) => `post-${jobId}`;

const PHASE: Record<PostStage, RecreateStatus> = {
  source: "importing", research: "researching", verdict: "researching",
  brief: "planning", headline: "planning", approval: "planning",
  design: "building", review: "reviewing",
};
const output = <T>(file: PostFile, stage: StageName) => file.stages[stage]?.status === "done" ? file.stages[stage]!.output as T : undefined;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const short = (text: string, max = 160) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function statusOf(file: PostFile, active: boolean): RecreateStatus {
  if (file.status === "done") return "done";
  if (file.status === "stopped") return "stopped";
  if (file.status === "error" || !active && file.status === "running") return "error";
  if (file.status === "paused") return "paused";
  const running = POST_STAGES.filter(stage => file.stages[stage]?.status === "running");
  if (running.length) return PHASE[running.at(-1)!];
  if (!Object.keys(file.stages).length) return "queued";
  const next = stagesFor(file.mode).find(stage => !["done", "skipped"].includes(file.stages[stage]?.status ?? ""));
  return next ? PHASE[next] : "building";
}

/** A finished, failed or skipped stage's line; a stage waiting to fix something says what. */
function settledLine(record: StageRecord): string | null {
  if (record.status === "skipped") return record.error ?? (record.output as { note?: string } | undefined)?.note ?? "Skipped";
  if (record.status === "error") return record.error ?? "Failed";
  if (record.status !== "done") return record.instructions ? `To fix: ${record.instructions.split("\n").slice(1, 3).join(" ").slice(0, 200)}` : "";
  return null;
}

/** One line on what a finished stage produced. */
function summary(file: PostFile, stage: PostStage): string {
  const record = file.stages[stage];
  if (!record) return "";
  const line = settledLine(record);
  if (line !== null) return line;
  switch (stage) {
    case "source": {
      const notes = record.output as SourceNotes, { likes, views } = notes.post.traction;
      return [`Read ${plural(notes.slides.length, "slide")}`, views ? `${compact(views)} views` : likes ? `${compact(likes)} likes` : ""].filter(Boolean).join("; ");
    }
    case "research": {
      const found = record.output as Research;
      const origin = found.origin.found ? `Origin: ${found.origin.who || found.origin.url || "found"}` : "No original found";
      if (found.quick) return [origin, found.fabrication.length ? plural(found.fabrication.length, "sign") + " of fabrication" : ""].filter(Boolean).join("; ");
      const confirmed = found.facts.filter(fact => fact.label === "confirmed").length;
      return [origin, `${plural(found.facts.length, "fact")} checked${confirmed ? `, ${confirmed} confirmed` : ""}`, found.reactions.length ? plural(found.reactions.length, "reaction") + " from X" : ""].filter(Boolean).join("; ");
    }
    case "verdict": {
      const check = record.output as Verdict, choice = verdictChoice(check);
      if (check.answer) return check.answer.choice === "stop" ? "You chose not to make it" : check.outcome === "stop" ? "Built anyway, by your call" : "You chose to go ahead";
      return choice === "proceed" ? `Passed: ${short(check.reason)}` : choice === "stop" ? `Stopped: ${short(check.reason)}` : `Needs you: ${short(check.reason)}`;
    }
    case "brief": { const planned = record.output as StoryBrief; return `${plural(planned.slides.length, "slide")} planned: ${planned.topic}`; }
    case "headline": {
      const lines = record.output as Headlines;
      return `${plural(lines.options.length, "headline option")}${lines.lead === "original" ? ", the original's first" : ""}${lines.source === "headline-model" ? " from the headline model" : lines.source === "agent" ? " from an agent" : " by the copywriter"}`;
    }
    case "approval": return `Headline: ${(record.output as PlanApproval).headline.text}`;
    case "design": { const built = record.output as DesignOutput; return built.held || `${plural(built.slideCount, "slide")} designed`; }
    case "review": {
      const report = record.output as ReviewReport | null;
      if (!report) return "Reviewed";
      const issues = [...report.checks, ...(report.facts?.issues ?? []), ...(report.design?.issues ?? [])];
      const must = issues.filter(issue => issue.severity === "must_fix").length, should = issues.filter(issue => issue.severity === "should_fix").length;
      return `${report.round ? `Round ${report.round}: ` : ""}${must} must-fix, ${should} should-fix${report.sentBack.length ? "; sent back to the designer" : ""}`;
    }
  }
}

/** The check, once it's in: what it decided, why, its evidence, a person's answer, and what research found that it went by. */
function verdictView(file: PostFile) {
  const check = output<Verdict>(file, "verdict");
  if (!check) return undefined;
  const found = output<Research>(file, "research");
  return {
    outcome: check.outcome, reason: check.reason, evidence: check.evidence, answer: check.answer, choice: verdictChoice(check),
    ...(found ? {
      origin: found.origin,
      fabrication: found.fabrication.map(sign => ({ sign: sign.sign, detail: sign.detail })),
      covered: found.worth.covered, fresh: found.worth.fresh, saturation: found.worth.saturation,
      traction: { performing: found.worth.traction.performing, ratio: found.worth.traction.ratio },
    } : {}),
    ...(file.source.originUrl ? { originUrl: file.source.originUrl } : {}),
  };
}

/** The checkpoint, in the shape the plan editor reads: the plan as an outline, the headline options as hooks. */
function checkpointView(file: PostFile) {
  if (file.mode === "exact" || file.stages.approval?.status === "done") return undefined;
  const planned = output<StoryBrief>(file, "brief"), lines = output<Headlines>(file, "headline");
  if (!planned || !lines) return undefined;
  const found = output<Research>(file, "research");
  return {
    outline: { slides: planned.slides, why: planned.why },
    // The designer picks the template page for each slide, and draws charts from real data itself.
    pages: [] as { index: number; label: string; reaction: string | null }[],
    hooks: { options: lines.options, source: lines.source, note: lines.note, lead: lines.lead, performing: lines.performing },
    reactions: (found?.reactions ?? []).map(post => ({ id: post.id, url: post.url, author: post.author, text: post.text, likes: post.likes, reposts: post.reposts, createdAt: post.createdAt, why: post.why })),
    charts: [] as { id: string; purpose: string; recreates: string; source: string }[],
    brief: { topic: planned.topic, story: planned.whatHappened, originalHeadline: planned.originalHeadline, angle: planned.angle },
  };
}

/** A checked fact as the finished post shows it: the current team's labels, or the first team's verdicts. */
type FactView = { claim: string; verdict: "confirmed" | "reported" | "alleged" | "unknown" | "corrected" | "unverified"; detail: string; sources: Link[] };
type Report = Pick<ReviewReport, "round" | "rendered"> & { checks: OpenIssue[]; facts: { summary: string; issues: OpenIssue[] } | null; design: { summary: string; issues: OpenIssue[] } | null; sentBack: string[] };
type OpenIssue = { slide: number; problem: string; fix: string; severity: "must_fix" | "should_fix" | "note" };
/** The critics' report in a few lines: what is still open, without who it was routed to. */
function reviewView(report: Report | null | undefined) {
  if (!report) return null;
  // A review the early test path skipped (2026-11-08) has a note and no checks.
  const open = [...(report.checks ?? []), ...(report.facts?.issues ?? []), ...(report.design?.issues ?? [])].filter(issue => issue.severity !== "note")
    .map(({ slide, problem, fix, severity }): OpenIssue => ({ slide, problem, fix, severity }));
  return { round: report.round, rendered: report.rendered, facts: report.facts?.summary ?? null, design: report.design?.summary ?? null, sentBack: [...(report.sentBack ?? [])], open };
}

function resultView(file: PostFile) {
  // A fix round rebuilds the deck in place, so the last saved one is shown meanwhile.
  const built = file.stages.design?.output as DesignOutput | undefined;
  if (!built?.deckId) return undefined;
  const facts = file.mode === "exact" ? [] : output<Research>(file, "research")?.facts ?? [];
  return {
    deckId: built.deckId, editorUrl: editorUrl(built.deckId), name: built.name, slideCount: built.slideCount, caption: built.caption,
    factChecks: facts.map((fact): FactView => ({ claim: fact.claim, verdict: fact.label, detail: fact.correction ? `${fact.correction}${fact.detail ? ` (${fact.detail})` : ""}` : fact.detail, sources: fact.sources })),
    notes: built.held ? [built.held, ...built.notes] : built.notes,
    review: reviewView(file.stages.review?.output as ReviewReport | null | undefined),
  };
}

const usageOf = (file: PostFile) => Object.values(file.stages).reduce((sum, record) => {
  const usage = record?.usage;
  return usage ? { inputTokens: sum.inputTokens + usage.inputTokens, outputTokens: sum.outputTokens + usage.outputTokens } : sum;
}, { inputTokens: 0, outputTokens: 0 });
const timing = (record: StageRecord | undefined) => ({
  ...(record?.by ? { actor: record.by } : {}), ...(record?.model ? { model: record.model } : {}), ...(record?.round ? { round: record.round } : {}),
  ...(record?.startedAt ? { startedAt: record.startedAt } : {}), ...(record?.finishedAt ? { finishedAt: record.finishedAt } : {}),
});
type StageView = {
  stage: StageName; title: string; by: "agent" | "code" | "human"; status: StageRecord["status"];
  actor?: StageRecord["by"]; model?: string; round?: number; startedAt?: string; finishedAt?: string; summary: string;
};

/** The public view of a post's run. Never includes the owner key or the full stage outputs. */
export function postView(file: PostFile, active: boolean): PostView {
  return isCurrentPostFile(file) ? currentView(file, active) : legacyView(file);
}

function currentView(file: PostFile, active: boolean) {
  const status = statusOf(file, active), interrupted = !active && file.status === "running";
  const message = interrupted ? "This run stopped before it finished, for example when the server restarted. Resume it to pick up where it left off." : file.message;
  const check = verdictView(file), checkpoint = file.waiting === "approval" || file.status !== "paused" ? checkpointView(file) : undefined, result = resultView(file);
  return {
    jobId: jobIdFor(file.id), postId: file.id, version: file.version, mode: file.mode, status, message,
    ...(file.status === "paused" && file.waiting ? { waiting: file.waiting } : {}),
    startedAt: file.createdAt, updatedAt: file.updatedAt,
    // Only the stages this run's mode goes through: an exact copy shows five.
    stages: stagesFor(file.mode).map((stage): StageView => {
      const record = file.stages[stage], card = stageCard(stage, file.mode);
      return {
        stage, title: card.title, by: card.by === "code" || card.by === "human" ? card.by : "agent",
        status: record?.status === "running" && !active ? "error" : record?.status ?? "pending",
        ...timing(record), summary: summary(file, stage),
      };
    }),
    usage: usageOf(file),
    ...(check ? { verdict: check } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(result ? { result } : {}),
    ...(status === "error" ? { error: message, resumable: true as boolean } : {}),
  };
}
export type PostView = ReturnType<typeof currentView>;

// ── Version-1 files: read-only, until they expire ───────────────────────────
const LEGACY_CARDS: Record<LegacyStage, { title: string; by: StageView["by"] }> = {
  transcript: { title: "Exact copy", by: "agent" }, brief: { title: "Editor-in-chief", by: "agent" }, facts: { title: "Fact research", by: "agent" },
  data: { title: "Data research", by: "agent" }, reactions: { title: "X reactions", by: "agent" }, visuals: { title: "Visual sources", by: "code" },
  outline: { title: "Story editor", by: "agent" }, hooks: { title: "Hook options", by: "agent" }, approval: { title: "Checkpoint", by: "human" },
  copy: { title: "Copywriter", by: "agent" }, charts: { title: "Chart maker", by: "code" }, images: { title: "Art director", by: "agent" },
  deck: { title: "Designer", by: "code" }, review: { title: "Critics", by: "agent" },
};
const LANGUAGES: Record<string, string> = { en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian" };

/**
 * One line on what a version-1 stage produced. Earlier schemas wrote these
 * outputs, so one that doesn't read shows no line instead of breaking the view.
 */
function legacySummary(file: PostFile, stage: LegacyStage): string {
  try { return legacyLine(file, stage); } catch { return ""; }
}

function legacyLine(file: PostFile, stage: LegacyStage): string {
  const record = file.stages[stage];
  if (!record) return "";
  const line = settledLine(record);
  if (line !== null) return line;
  switch (stage) {
    case "transcript": {
      const t = record.output as TranscriptOutput, boxed = t.slides.filter(slide => slide.media.box);
      const charts = boxed.filter(slide => slide.media.kind === "chart").length, cut = boxed.length - charts, rebuilt = t.slides.filter(slide => slide.graphic).length;
      const posts = t.slides.reduce((sum, slide) => sum + (slide.posts?.length ?? 0), 0);
      const from = LANGUAGES[t.originalLanguage.toLowerCase()];
      const words = t.translated ? `Translated ${plural(t.slides.length, "slide")}${from ? ` from ${from}` : ""}` : `Copied ${plural(t.slides.length, "slide")} word for word`;
      return [
        words,
        rebuilt ? `${plural(rebuilt, "graphic")} to rebuild from ${rebuilt === 1 ? "its" : "their"} parts` : "",
        charts ? `${plural(charts, "chart")} to redraw` : "",
        posts ? `${plural(posts, "post")} from X as our cards` : "",
        cut ? `${plural(cut, "picture")} to cut from the original` : "",
      ].filter(Boolean).join("; ");
    }
    case "brief": { const b = record.output as Brief; return `Read ${plural(b.slides.length, "slide")}: ${b.topic}`; }
    case "facts": {
      const f = record.output as Facts, corrected = f.claims.filter(claim => claim.verdict === "corrected").length;
      return `${plural(f.claims.length, "claim")} checked${corrected ? `, ${corrected} corrected` : ""}; ${plural(f.answers.length, "reader question")} answered`;
    }
    case "data": {
      if (file.mode === "exact") {
        const d = record.output as ExactDataOutput, kept = d.missing.length;
        return [d.charts.length ? `${plural(d.charts.length, "chart")} redrawn from real data` : "", kept ? `${plural(kept, "chart")} kept as cut from the original: ${d.missing[0].why}` : ""].filter(Boolean).join("; ") || "No chart to rebuild";
      }
      const d = record.output as DataOutput;
      return d.charts.length ? `${plural(d.charts.length, "chart")} rebuilt with real data` : "No chart to rebuild";
    }
    case "reactions": { const r = record.output as ReactionsOutput; return r.reactions.length ? `${plural(r.reactions.length, "real post")} picked from X` : r.note || "No posts picked"; }
    case "visuals": { const v = record.output as VisualsOutput; return v.candidates.length ? `${plural(v.candidates.length, "photo")} found` : v.note || "No photos found"; }
    case "outline": return `${plural((record.output as Outline).slides.length, "slide")} planned`;
    case "hooks": {
      const h = record.output as HooksOutput;
      return `${plural(h.options.length, "hook option")}${h.source === "headline-model" ? " from the headline model" : h.source === "agent" ? " from an agent" : " by the copywriter"}`;
    }
    case "approval": return `Hook: ${(record.output as Approval).hook.text}`;
    case "copy": return `${plural((record.output as CopyOutput).slides.length, "slide")} written`;
    case "charts": { const c = record.output as ChartsOutput; return `${c.charts.filter(chart => chart.ok).length} of ${plural(c.charts.length, "chart")} drawn`; }
    case "images": { const i = record.output as ImagesOutput; return i.photos.length ? `${plural(i.photos.length, "photo")} chosen` : "No photo chosen"; }
    case "deck": { const d = record.output as DeckOutput; return d.held || `${plural(d.slideCount, "slide")} saved`; }
    case "review": {
      const r = record.output as ReviewOutput | null;
      if (!r) return "Reviewed";
      const issues = [...r.checks, ...(r.facts?.issues ?? []), ...(r.design?.issues ?? [])];
      const must = issues.filter(issue => issue.severity === "must_fix").length, should = issues.filter(issue => issue.severity === "should_fix").length;
      const sent = r.sentBack.length ? `; sent back to ${r.sentBack.join(" and ")}` : "";
      return `${r.round ? `Round ${r.round}: ` : ""}${must} must-fix, ${should} should-fix${sent}`;
    }
  }
}

function legacyResult(file: PostFile): PostView["result"] {
  const built = file.stages.deck?.output as DeckOutput | undefined;
  if (!built?.deckId) return undefined;
  return {
    deckId: built.deckId, editorUrl: editorUrl(built.deckId), name: built.name, slideCount: built.slideCount, caption: "",
    factChecks: (output<Facts>(file, "facts")?.claims ?? []).map((claim): FactView => ({ ...claim })),
    notes: built.held ? [built.held, ...built.notes] : built.notes,
    review: reviewView(file.stages.review?.output as ReviewOutput | null | undefined),
  };
}

/** A version-1 file, read-only: a finished run shows its deck; one that didn't finish can only be started again. */
function legacyView(file: PostFile): PostView {
  const finished = file.status === "done", result = legacyResult(file);
  // Its own messages ask for a resume it can't have any more, so an unfinished run says why instead.
  const message = finished ? file.message : "This run was made by the earlier Recreate and can't continue. Start a new recreation to remake the post.";
  return {
    jobId: jobIdFor(file.id), postId: file.id, version: file.version, mode: file.mode, status: (finished ? "done" : "error") as RecreateStatus, message,
    startedAt: file.createdAt, updatedAt: file.updatedAt,
    stages: legacyStagesFor(file.mode).map((stage): StageView => {
      const record = file.stages[stage], card = file.mode === "exact" && stage === "data" ? { title: "Chart rebuilder", by: "agent" as const } : LEGACY_CARDS[stage];
      return { stage, title: card.title, by: card.by, status: record?.status === "running" ? "error" : record?.status ?? "pending", ...timing(record), summary: legacySummary(file, stage) };
    }),
    usage: usageOf(file),
    ...(result ? { result } : {}),
    ...(finished ? {} : { error: message, resumable: false }),
  };
}
