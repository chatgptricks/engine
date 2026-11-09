/**
 * What the dialog and agents see of a Recreate run: a live view of its post
 * file (lib/engine/post-files.ts). The post file is the record, so a server
 * restart loses nothing: a run it interrupted shows as stopped and resumes
 * from its last finished stage. A job id is the post file's id without the
 * "post-" prefix, so older clients that poll `?jobId=` keep working.
 */
import { editorUrl } from "./agents/deck";
import { roleCardIn } from "./agents/playbook";
import type { Approval, Brief, ChartsOutput, CopyOutput, DataOutput, DeckOutput, ExactDataOutput, Facts, HooksOutput, ImagesOutput, Outline, ReactionsOutput, ReviewOutput, TranscriptOutput, VisualsOutput } from "./agents/schemas";
import { POST_STAGES, stagesFor, type PostFile, type PostStage } from "./post-files";

export type RecreateStatus = "queued" | "importing" | "researching" | "planning" | "paused" | "writing" | "building" | "reviewing" | "done" | "error";
export const jobIdFor = (postId: string) => postId.replace(/^post-/, "");
export const postIdFor = (jobId: string) => `post-${jobId}`;

const PHASE: Record<PostStage, RecreateStatus> = {
  transcript: "writing", brief: "researching", facts: "researching", data: "researching", reactions: "researching", visuals: "researching",
  outline: "planning", hooks: "planning", approval: "planning", copy: "writing", charts: "writing", images: "writing",
  deck: "building", review: "reviewing",
};
const output = <T>(file: PostFile, stage: PostStage) => file.stages[stage]?.status === "done" ? file.stages[stage]!.output as T : undefined;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function statusOf(file: PostFile, active: boolean): RecreateStatus {
  if (file.status === "done") return "done";
  if (file.status === "error" || !active && file.status === "running") return "error";
  if (file.status === "paused") return "paused";
  const running = POST_STAGES.filter(stage => file.stages[stage]?.status === "running");
  if ((running.includes("brief") || running.includes("transcript")) && !file.source.imageIds.length) return "importing";
  if (running.length) return PHASE[running.at(-1)!];
  if (!Object.keys(file.stages).length) return "queued";
  const next = stagesFor(file.mode).find(stage => !["done", "skipped"].includes(file.stages[stage]?.status ?? ""));
  return next ? PHASE[next] : "building";
}
const LANGUAGES: Record<string, string> = { en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian" };

/** One line on what a finished stage produced. */
function summary(file: PostFile, stage: PostStage): string {
  const record = file.stages[stage];
  if (!record) return "";
  if (record.status === "skipped") return record.error ?? (record.output as { note?: string } | undefined)?.note ?? "Skipped";
  if (record.status === "error") return record.error ?? "Failed";
  if (record.status !== "done") return record.instructions ? `To fix: ${record.instructions.split("\n").slice(1, 3).join(" ").slice(0, 200)}` : "";
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

function checkpointView(file: PostFile) {
  if (file.stages.approval?.status === "done") return undefined;
  const plan = output<Outline & { pages?: { index: number; label: string; reaction: string | null }[] }>(file, "outline"), lines = output<HooksOutput>(file, "hooks");
  if (!plan || !lines) return undefined;
  const b = output<Brief>(file, "brief"), d = output<DataOutput>(file, "data"), r = output<ReactionsOutput>(file, "reactions");
  return {
    outline: { slides: plan.slides, why: plan.why },
    pages: plan.pages ?? [],
    hooks: { options: lines.options, source: lines.source, note: lines.note },
    reactions: (r?.reactions ?? []).map(post => ({ id: post.id, url: post.url, author: post.author, text: post.text, likes: post.likes, reposts: post.reposts, createdAt: post.createdAt, why: post.why })),
    charts: (d?.charts ?? []).map(chart => ({ id: chart.id, purpose: chart.purpose, recreates: chart.recreates, source: chart.source })),
    brief: b ? { topic: b.topic, story: b.story, originalHeadline: b.originalHeadline, angle: b.angle } : null,
  };
}

function resultView(file: PostFile) {
  // A fix round rebuilds the deck in place, so the last saved one is shown meanwhile.
  const built = file.stages.deck?.output as DeckOutput | undefined;
  if (!built?.deckId) return undefined;
  const r = file.stages.review?.output as ReviewOutput | null | undefined;
  const open = r ? [...r.checks, ...(r.facts?.issues ?? []), ...(r.design?.issues ?? [])].filter(issue => issue.severity !== "note") : [];
  return {
    deckId: built.deckId, editorUrl: editorUrl(built.deckId), name: built.name, slideCount: built.slideCount,
    factChecks: output<Facts>(file, "facts")?.claims ?? [],
    notes: built.held ? [built.held, ...built.notes] : built.notes,
    review: r ? { round: r.round, rendered: r.rendered, facts: r.facts?.summary ?? null, design: r.design?.summary ?? null, sentBack: r.sentBack, open } : null,
  };
}

/** The public view of a post's run. Never includes the owner key or the full stage outputs. */
export function postView(file: PostFile, active: boolean) {
  const status = statusOf(file, active), interrupted = !active && file.status === "running";
  const message = interrupted ? "This run stopped before it finished, for example when the server restarted. Resume it to pick up where it left off." : file.message;
  const used = POST_STAGES.reduce((sum, stage) => {
    const usage = file.stages[stage]?.usage;
    return usage ? { inputTokens: sum.inputTokens + usage.inputTokens, outputTokens: sum.outputTokens + usage.outputTokens } : sum;
  }, { inputTokens: 0, outputTokens: 0 });
  const checkpoint = checkpointView(file), result = resultView(file);
  return {
    jobId: jobIdFor(file.id), postId: file.id, mode: file.mode, status, message,
    startedAt: file.createdAt, updatedAt: file.updatedAt,
    // Only the stages this run's mode goes through: an exact copy shows four.
    stages: stagesFor(file.mode).map(stage => {
      const record = file.stages[stage], card = roleCardIn(stage, file.mode);
      return {
        stage, title: card.title, by: card.by === "code" || card.by === "human" ? card.by : "agent",
        status: record?.status === "running" && !active ? "error" as const : record?.status ?? "pending" as const,
        ...(record?.by ? { actor: record.by } : {}), ...(record?.model ? { model: record.model } : {}), ...(record?.round ? { round: record.round } : {}),
        ...(record?.startedAt ? { startedAt: record.startedAt } : {}), ...(record?.finishedAt ? { finishedAt: record.finishedAt } : {}),
        summary: summary(file, stage),
      };
    }),
    usage: used,
    ...(checkpoint ? { checkpoint } : {}),
    ...(result ? { result } : {}),
    ...(status === "error" ? { error: message, resumable: true } : {}),
  };
}
export type PostView = ReturnType<typeof postView>;
