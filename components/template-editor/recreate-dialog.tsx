"use client";
/* eslint-disable @next/next/no-img-element */
import {useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type ReactNode, type RefObject} from "react";
import {ArrowRightIcon, CheckIcon, CloseIcon, ImageIcon, PlusIcon} from "@/components/engine/icons";
import {Modal} from "./controls";
import {
  MAX_HOOK_CHARACTERS, MAX_RECREATE_SLIDES, MAX_RECREATE_UPLOADS, RECREATE_IMAGE_TYPES, RECREATE_LANES, RECREATE_STATUS_LABELS,
  fetchPageProfiles, instagramLabel, normalizeInstagramUrl, prepareRecreateUpload, recreateSetupIssue, recreateTimestamp, safeSourceUrl, useRecreateJob,
  type ApproveRequest, type Checkpoint, type CheckpointReaction, type FactCheck, type HookOption, type OutlineKind, type OutlineSlide, type PageProfile,
  type PreparedUpload, type RecreateAction, type RecreateJob, type RecreateMode, type RecreateRequest, type RecreateResult, type RecreateReview,
  type StageName, type StageStatus, type TrackedRecreate,
} from "./recreate-job";
import "./pro-tools.css";
import "./dialog-tools.css";
import "./recreate-dialog.css";

type Draft = {mode: "link" | "screenshots"; url: string; uploads: PreparedUpload[]; caption: string; notes: string; profileId: string; autopilot: boolean};
type FieldErrors = Partial<Record<"url" | "uploads" | "profileId", string>>;
type Phase = "form" | "running" | "checkpoint" | "done" | "error";
const EMPTY_DRAFT: Draft = {mode: "link", url: "", uploads: [], caption: "", notes: "", profileId: "", autopilot: false};
const PROFILE_MEMORY = "engine:recreate-profile";
const AUTOPILOT_MEMORY = "engine:recreate-autopilot";
const NOTE_IDEAS = ["Make it simpler", "Add a chart", "Use the latest stock data"];
const VERDICT_LABELS: Record<FactCheck["verdict"], string> = {confirmed: "Confirmed", corrected: "Corrected", unverified: "Unverified"};
const KIND_LABELS: Record<OutlineKind, string> = {cover: "Cover", original: "From the original", question: "Reader question", reaction: "Reaction from X", takeaway: "Takeaway", follow: "Follow"};
const HOOK_SOURCES: Record<HookOption["by"], string> = {"headline-model": "From the headline model", copywriter: "By the copywriter", agent: "From an agent"};
const MODE_LABELS: Record<RecreateMode, string> = {checkpoint: "You review the plan", autopilot: "Autopilot"};
const STAGE_STATES: Record<StageStatus, string> = {pending: "waiting", running: "working", done: "done", skipped: "skipped", error: "failed"};
let profileCache: PageProfile[] | null = null;

function rememberedProfile(): string {
  try { return window.localStorage.getItem(PROFILE_MEMORY) ?? ""; } catch { return ""; }
}
function rememberProfile(id: string) {
  try { window.localStorage.setItem(PROFILE_MEMORY, id); } catch { /* Only a convenience. */ }
}
function rememberedAutopilot(): boolean | null {
  try { const value = window.localStorage.getItem(AUTOPILOT_MEMORY); return value === null ? null : value === "1"; } catch { return null; }
}
function rememberAutopilot(on: boolean) {
  try { window.localStorage.setItem(AUTOPILOT_MEMORY, on ? "1" : "0"); } catch { /* Only a convenience. */ }
}
function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
function phaseOf(tracked: TrackedRecreate | null, job: RecreateJob | null): Phase {
  if (!tracked) return "form";
  if (job?.status === "done" && job.result) return "done";
  if (job?.status === "error") return "error";
  if (job?.status === "paused" && job.checkpoint) return "checkpoint";
  return "running";
}
function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", {notation: "compact", maximumFractionDigits: 1}).format(value);
}
function profileLabel(profile: PageProfile): string {
  if (!profile.handle) return profile.name;
  return profile.name.replace(/^@/, "").toLowerCase() === profile.handle.toLowerCase() ? `@${profile.handle}` : `${profile.name} · @${profile.handle}`;
}
/** Changes only when the plan itself does, so a poll during the checkpoint keeps a person's edits. */
function planKey(job: RecreateJob): string {
  const source = JSON.stringify([job.checkpoint?.slides, job.checkpoint?.hooks]);
  let hash = 5381;
  for (let index = 0; index < source.length; index++) hash = (hash * 33) ^ source.charCodeAt(index);
  return `${job.jobId}:${(hash >>> 0).toString(36)}`;
}
/** The native dialog opens after child effects run, so focus a field once it is showing. */
function useInitialFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const timer = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [ref]);
}
function focusLater(id: string) {
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}
function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Recreate post: the dialog plus a small persistent indicator. The run keeps
 * going on the server while the dialog is closed, and resumes after a reload.
 */
export function RecreatePost({scope, open, onOpenChange, blockedReason, activeDesignId, inEditor, onOpenDesign}: {
  scope?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown instead of allowing a new run, e.g. when the workspace is read-only or full. */
  blockedReason?: string;
  activeDesignId?: string | null;
  /** The editor is showing: use the compact indicator that clears the page strip and tool tabs. */
  inEditor?: boolean;
  onOpenDesign: (result: RecreateResult) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const openRef = useRef(open), openDesign = useRef(onOpenDesign);
  useEffect(() => { openRef.current = open; openDesign.current = onOpenDesign; });
  const recreate = useRecreateJob(scope, (job, tracked) => {
    // Open the new post behind the dialog only while someone is watching it finish.
    if (job.status !== "done" || !job.result || !tracked || tracked.opened || !openRef.current) return false;
    openDesign.current(job.result);
    return true;
  });
  const {tracked, job} = recreate;
  const phase = phaseOf(tracked, job);

  function openResult(result: RecreateResult) {
    recreate.markOpened();
    onOpenDesign(result);
    onOpenChange(false);
  }
  function editAndRetry() {
    const saved = tracked?.draft;
    setDraft(current => current.url || current.uploads.length || current.caption || current.notes || !saved ? current : {...current, ...saved});
    recreate.dismiss();
  }
  function startAnother() {
    setDraft(current => ({...EMPTY_DRAFT, mode: current.mode, profileId: current.profileId, autopilot: current.autopilot}));
    recreate.dismiss();
  }

  const close = () => onOpenChange(false);
  const title = phase === "done" ? "Your post is ready" : phase === "error" ? "Recreate didn't finish" : phase === "checkpoint" ? "Check the plan" : "Recreate a post";
  return <>
    {open && <Modal title={title} onClose={close}>
      {phase === "form" && <RecreateForm draft={draft} setDraft={setDraft} blockedReason={blockedReason} onStart={recreate.start} onClose={close}/>}
      {phase === "running" && tracked && <RecreateProgress tracked={tracked} job={job} reconnecting={recreate.reconnecting} onAct={recreate.act} onClose={close}/>}
      {phase === "checkpoint" && tracked && job?.checkpoint && <RecreateCheckpoint key={planKey(job)} tracked={tracked} job={job} checkpoint={job.checkpoint} onApprove={request => recreate.act({action: "approve", ...request})} onClose={close}/>}
      {phase === "done" && tracked && job?.result && <RecreateDone tracked={tracked} job={job} result={job.result} isOpen={Boolean(inEditor) && activeDesignId === job.result.deckId} onOpen={() => openResult(job.result!)} onClose={close} onAnother={startAnother}/>}
      {phase === "error" && tracked && <RecreateFailure tracked={tracked} job={job} error={job?.error || job?.message || "Recreate failed. Try again."} onResume={() => recreate.act({action: "resume"})} onRetry={editAndRetry} onScreenshots={() => { editAndRetry(); setDraft(current => ({...current, mode: "screenshots"})); }} onClose={close}/>}
    </Modal>}
    {!open && tracked && <RecreateIndicator phase={phase} job={job} reconnecting={recreate.reconnecting} compact={inEditor} onOpen={() => onOpenChange(true)} onDismiss={recreate.dismiss}/>}
  </>;
}

function RecreateForm({draft, setDraft, blockedReason, onStart, onClose}: {
  draft: Draft;
  setDraft: (update: (current: Draft) => Draft) => void;
  blockedReason?: string;
  onStart: (request: RecreateRequest, details: Omit<TrackedRecreate, "jobId" | "startedAt" | "opened">) => Promise<TrackedRecreate>;
  onClose: () => void;
}) {
  const id = useId();
  const [profiles, setProfiles] = useState<PageProfile[] | null>(profileCache);
  const [profileError, setProfileError] = useState(""), [profileAttempt, setProfileAttempt] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState(""), [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(0), [uploadNotice, setUploadNotice] = useState(""), [dragging, setDragging] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null), fileRef = useRef<HTMLInputElement>(null), addRef = useRef<HTMLButtonElement>(null), profileRef = useRef<HTMLSelectElement>(null);
  const firstFieldRef = useRef<HTMLElement | null>(null);
  useInitialFocus(firstFieldRef);

  useEffect(() => {
    const controller = new AbortController();
    fetchPageProfiles(controller.signal).then(list => {
      profileCache = list;
      setProfiles(list);
      setProfileError("");
      setDraft(current => {
        if (list.some(profile => profile.id === current.profileId)) return current;
        const remembered = rememberedProfile();
        return {...current, profileId: list.some(profile => profile.id === remembered) ? remembered : list.length === 1 ? list[0].id : ""};
      });
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setProfileError(errorMessage(cause, "Page profiles couldn't be loaded."));
    });
    return () => controller.abort();
  }, [profileAttempt, setDraft]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      const remembered = rememberedAutopilot();
      if (active && remembered !== null) setDraft(current => current.autopilot === remembered ? current : {...current, autopilot: remembered});
    });
    return () => { active = false; };
  }, [setDraft]);

  const profile = profiles?.find(item => item.id === draft.profileId);
  const update = (patch: Partial<Draft>) => setDraft(current => ({...current, ...patch}));
  const clearError = (field: keyof FieldErrors) => setErrors(current => current[field] ? {...current, [field]: undefined} : current);

  async function addFiles(list: FileList | File[]) {
    const files = [...list];
    if (!files.length) return;
    const images = files.filter(file => RECREATE_IMAGE_TYPES.includes(file.type)).sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    const room = Math.max(0, MAX_RECREATE_UPLOADS - draft.uploads.length);
    const accepted = images.slice(0, room), notices: string[] = [];
    if (files.length > images.length) notices.push(`${plural(files.length - images.length, "file")} skipped. Use JPG, PNG or WebP images.`);
    if (images.length > accepted.length) notices.push(`Only ${MAX_RECREATE_UPLOADS} slides fit, so ${plural(images.length - accepted.length, "image")} ${images.length - accepted.length === 1 ? "was" : "were"} left out.`);
    setUploadNotice("");
    setPreparing(accepted.length);
    const prepared: PreparedUpload[] = [];
    for (const file of accepted) {
      try { prepared.push(await prepareRecreateUpload(file)); }
      catch (cause) { notices.push(errorMessage(cause, `${file.name} couldn't be read.`)); }
    }
    setPreparing(0);
    if (prepared.length) {
      setDraft(current => ({...current, uploads: [...current.uploads, ...prepared].slice(0, MAX_RECREATE_UPLOADS)}));
      clearError("uploads");
    }
    setUploadNotice(notices.join(" "));
  }
  function move(index: number, offset: number) {
    setDraft(current => {
      const target = index + offset;
      if (target < 0 || target >= current.uploads.length) return current;
      const uploads = [...current.uploads];
      [uploads[index], uploads[target]] = [uploads[target], uploads[index]];
      return {...current, uploads};
    });
  }
  function remove(index: number) {
    setDraft(current => ({...current, uploads: current.uploads.filter((_, position) => position !== index)}));
    setUploadNotice("");
    queueMicrotask(() => addRef.current?.focus());
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  }
  function onPaste(event: ClipboardEvent<HTMLFormElement>) {
    const images = [...event.clipboardData.files].filter(file => RECREATE_IMAGE_TYPES.includes(file.type));
    if (!images.length) return;
    event.preventDefault();
    update({mode: "screenshots"});
    void addFiles(images);
  }
  function addNote(idea: string) {
    setDraft(current => current.notes.toLowerCase().includes(idea.toLowerCase()) ? current : {...current, notes: current.notes.trim() ? `${current.notes.trim()}\n${idea}` : idea});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || preparing || blockedReason) return;
    const url = draft.mode === "link" ? normalizeInstagramUrl(draft.url) : null;
    const next: FieldErrors = {};
    if (draft.mode === "link" && !draft.url.trim()) next.url = "Paste the link to the Instagram post.";
    else if (draft.mode === "link" && !url) next.url = "That doesn't look like an Instagram post link. It should look like instagram.com/p/…";
    if (draft.mode === "screenshots" && !draft.uploads.length) next.uploads = "Add at least one slide screenshot.";
    if (!profile) next.profileId = profiles?.length === 0 ? "No page profiles are set up yet." : "Choose the page this post is for.";
    setErrors(next);
    if (next.url) { urlRef.current?.focus(); return; }
    if (next.uploads) { addRef.current?.focus(); return; }
    if (next.profileId || !profile) { profileRef.current?.focus(); return; }
    setBusy(true);
    setSubmitError("");
    const notes = draft.notes.trim(), caption = draft.caption.trim();
    const mode: RecreateMode = draft.autopilot ? "autopilot" : "checkpoint";
    const request: RecreateRequest = draft.mode === "link"
      ? {url: url!, profileId: profile.id, mode, ...(notes ? {notes} : {})}
      : {uploads: draft.uploads.map(({name, dataUrl}) => ({name, dataUrl})), profileId: profile.id, mode, ...(caption ? {caption} : {}), ...(notes ? {notes} : {})};
    try {
      rememberProfile(profile.id);
      await onStart(request, {
        source: draft.mode === "link" ? instagramLabel(url!) : plural(draft.uploads.length, "screenshot"),
        profileName: profileLabel(profile),
        draft: {mode: draft.mode, url: draft.url, caption: draft.caption, notes: draft.notes, profileId: draft.profileId},
      });
    } catch (cause) {
      setSubmitError(errorMessage(cause, "Recreate couldn't start. Try again."));
      setBusy(false);
    }
  }

  const setup = submitError ? recreateSetupIssue(submitError) : null;
  return <form noValidate onSubmit={submit} onPaste={onPaste}>
    <fieldset disabled={busy} className="te-pro-panel te-tool-dialog te-recreate">
      <p className="te-recreate-intro">Turn an Instagram post into a new editable post for one of your pages. A team of agents researches it, plans the slides and writes them in the page&apos;s voice.</p>
      <div className="te-recreate-segment" role="radiogroup" aria-label="Post source">
        {([["link", "Instagram link"], ["screenshots", "Screenshots"]] as const).map(([value, label]) => <label key={value} className={draft.mode === value ? "is-selected" : ""}>
          <input type="radio" name={`${id}-mode`} value={value} checked={draft.mode === value} onChange={() => { update({mode: value}); setErrors({}); setSubmitError(""); }}/>
          {value === "link" ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg> : <ImageIcon size={15}/>}
          {label}
        </label>)}
      </div>

      {draft.mode === "link" ? <label className="te-recreate-field">
        <span id={`${id}-url-label`}>Post link</span>
        <input ref={element => { urlRef.current = element; firstFieldRef.current = element; }} aria-labelledby={`${id}-url-label`} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://www.instagram.com/p/…" value={draft.url} aria-invalid={Boolean(errors.url)} aria-describedby={`${id}-url-help`} onChange={event => { update({url: event.target.value}); clearError("url"); }}/>
        <small id={`${id}-url-help`} className={errors.url ? "te-recreate-invalid" : ""}>{errors.url ?? "Public posts and reels. The slides and caption are imported for you."}</small>
      </label> : <>
        <div className={`te-recreate-drop${dragging ? " is-dragging" : ""}${errors.uploads ? " is-invalid" : ""}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <input ref={fileRef} type="file" hidden multiple accept={RECREATE_IMAGE_TYPES.join(",")} onChange={event => { const files = event.target.files; if (files) void addFiles(files); event.target.value = ""; }}/>
          <button ref={element => { addRef.current = element; firstFieldRef.current ??= element; }} type="button" className="te-button" disabled={draft.uploads.length >= MAX_RECREATE_UPLOADS || preparing > 0} aria-describedby={`${id}-drop-help`} onClick={() => fileRef.current?.click()}><ImageIcon size={16}/>{draft.uploads.length ? "Add more slides" : "Add slide screenshots"}</button>
          <small id={`${id}-drop-help`}>{preparing ? `Preparing ${plural(preparing, "image")}…` : `Drop or paste images here · JPG, PNG or WebP · ${draft.uploads.length}/${MAX_RECREATE_UPLOADS}`}</small>
        </div>
        {errors.uploads && <small className="te-recreate-invalid" role="alert">{errors.uploads}</small>}
        {uploadNotice && <small className="te-recreate-note" role="status">{uploadNotice}</small>}
        {draft.uploads.length > 0 && <ol className="te-recreate-thumbs" aria-label="Slides in order">
          {draft.uploads.map((upload, index) => <li key={upload.id}>
            <img src={upload.dataUrl} alt={`Slide ${index + 1}: ${upload.name}`}/>
            <span className="te-recreate-thumb-number" aria-hidden>{index + 1}</span>
            <button type="button" className="te-recreate-thumb-remove" aria-label={`Remove slide ${index + 1}`} title="Remove" onClick={() => remove(index)}><CloseIcon size={13}/></button>
            <span className="te-recreate-thumb-move">
              <button type="button" aria-label={`Move slide ${index + 1} earlier`} title="Move earlier" disabled={index === 0} onClick={() => move(index, -1)}>‹</button>
              <button type="button" aria-label={`Move slide ${index + 1} later`} title="Move later" disabled={index === draft.uploads.length - 1} onClick={() => move(index, 1)}>›</button>
            </span>
          </li>)}
        </ol>}
        <label className="te-recreate-field">
          <span id={`${id}-caption-label`}>Caption <small className="te-recreate-optional">Optional</small></span>
          <textarea aria-labelledby={`${id}-caption-label`} rows={3} maxLength={10_000} placeholder="Paste the post's caption" value={draft.caption} onChange={event => update({caption: event.target.value})}/>
        </label>
      </>}

      <label className="te-recreate-field">
        <span id={`${id}-profile-label`}>Page</span>
        <select ref={profileRef} aria-labelledby={`${id}-profile-label`} value={draft.profileId} disabled={!profiles?.length} aria-invalid={Boolean(errors.profileId)} aria-describedby={`${id}-profile-help`} onChange={event => { update({profileId: event.target.value}); clearError("profileId"); }}>
          {!profiles ? <option value="">{profileError ? "Pages unavailable" : "Loading pages…"}</option> : <>
            <option value="" disabled>{profiles.length ? "Choose a page" : "No pages set up yet"}</option>
            {profiles.map(item => <option key={item.id} value={item.id}>{profileLabel(item)}</option>)}
          </>}
        </select>
        <small id={`${id}-profile-help`} className={errors.profileId || profileError ? "te-recreate-invalid" : profile ? "te-recreate-voice" : ""} title={!errors.profileId && !profileError && profile?.voice ? profile.voice : undefined}>
          {errors.profileId ?? (profileError || (profile ? <>{profile.language === "es" ? "Spanish" : "English"}{profile.voice ? ` · ${profile.voice}` : ""}</> : "Its voice, language, template and follow line are used."))}
        </small>
      </label>
      {profileError && <button type="button" className="te-text-button te-recreate-retry" onClick={() => { setProfileError(""); setProfileAttempt(value => value + 1); }}>Try loading pages again</button>}

      <label className="te-recreate-field">
        <span id={`${id}-notes-label`}>Notes <small className="te-recreate-optional">Optional</small></span>
        <textarea aria-labelledby={`${id}-notes-label`} rows={2} maxLength={2000} placeholder="Anything to change, add or keep" value={draft.notes} onChange={event => update({notes: event.target.value})}/>
      </label>
      <div className="te-recreate-ideas" aria-label="Note ideas">
        {NOTE_IDEAS.map(idea => <button key={idea} type="button" aria-label={`Add note: ${idea}`} onClick={() => addNote(idea)}>+ {idea}</button>)}
      </div>

      <label className="te-recreate-switch">
        <input type="checkbox" role="switch" checked={draft.autopilot} aria-describedby={`${id}-autopilot-help`} onChange={event => { update({autopilot: event.target.checked}); rememberAutopilot(event.target.checked); }}/>
        <span className="te-recreate-switch-track" aria-hidden/>
        <span className="te-recreate-switch-text">
          <strong>Autopilot</strong>
          <small id={`${id}-autopilot-help`}>{draft.autopilot ? "The team picks the hook and finishes the post on its own." : "The team pauses so you can check the slide plan and pick the hook."}</small>
        </span>
      </label>
    </fieldset>
    {blockedReason && <p className="te-dialog-status te-recreate-blocked" role="status">{blockedReason}</p>}
    {submitError && <div className="te-dialog-error te-recreate-alert" role="alert">
      <strong>{setup ? "Setup needed" : "Recreate couldn't start"}</strong>
      <span>{submitError}</span>
      {setup === "apify" && draft.mode === "link" && <button type="button" className="te-text-button" onClick={() => { update({mode: "screenshots"}); setSubmitError(""); }}>Upload screenshots instead</button>}
      {setup === "claude" && <span>Ask whoever runs Engine to add the Claude API key, then try again.</span>}
    </div>}
    <div className="te-dialog-footer">
      <button type="button" className="te-button" onClick={onClose}>Cancel</button>
      <button className="te-button te-primary" disabled={busy || preparing > 0 || Boolean(blockedReason)}>{busy ? "Starting…" : "Recreate"}</button>
    </div>
  </form>;
}

function useElapsed(since: number): string {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0), timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  return now && Number.isFinite(since) && since > 0 ? duration(now - since) : "0:00";
}

function RecreateSummary({tracked, mode}: {tracked: TrackedRecreate; mode?: RecreateMode}) {
  return <div className="te-recreate-summary">
    <span title={tracked.source}>{tracked.source}</span>
    <ArrowRightIcon size={14}/>
    <span title={tracked.profileName}>{tracked.profileName}</span>
    {mode && <span className="te-recreate-mode">{MODE_LABELS[mode]}</span>}
  </div>;
}

/** Each agent's part of the run, grouped the way the stages run. */
function RecreateLanes({job}: {job: RecreateJob | null}) {
  const stages = new Map(job?.stages.map(stage => [stage.stage, stage]));
  const hint = (name: StageName, status: StageStatus) => name === "approval" && status === "pending" ? job?.mode === "autopilot" ? "Autopilot uses the first hook that fits the cover and the plan as written" : "Waits for you to check the plan" : "";
  return <div className="te-recreate-lanes">
    {RECREATE_LANES.map(lane => <section key={lane.title} className="te-recreate-lane" aria-label={lane.title}>
      <h3>{lane.title}</h3>
      <ol>
        {lane.stages.map(name => {
          const stage = stages.get(name), status = stage?.status ?? "pending", summary = stage?.summary || hint(name, status);
          return <li key={name} className={`is-${status}`}>
            <span className="te-recreate-stage-icon" aria-hidden>{status === "done" ? <CheckIcon size={12} strokeWidth={2.4}/> : status === "running" ? <span className="te-recreate-spinner"/> : status === "error" ? "!" : status === "skipped" ? "–" : null}</span>
            <span className="te-recreate-stage-text">
              <span className="te-recreate-stage-title">
                {stage?.title ?? name}
                {stage?.round ? <span className="te-recreate-stage-round"> · fix {stage.round}</span> : null}
                <span className="te-sr-only"> ({STAGE_STATES[status]})</span>
              </span>
              {summary && <small title={summary}>{summary}</small>}
            </span>
          </li>;
        })}
      </ol>
    </section>)}
  </div>;
}

function RecreateProgress({tracked, job, reconnecting, onAct, onClose}: {tracked: TrackedRecreate; job: RecreateJob | null; reconnecting: boolean; onAct: (action: RecreateAction) => Promise<unknown>; onClose: () => void}) {
  const primary = useRef<HTMLButtonElement>(null);
  useInitialFocus(primary);
  const started = recreateTimestamp(job?.startedAt);
  const elapsed = useElapsed(Number.isFinite(started) ? started : tracked.startedAt);
  const [stopping, setStopping] = useState(false), [stopError, setStopError] = useState("");
  const message = !job ? "Checking progress…" : job.status === "queued" ? "Waiting to start…" : job.message || `${RECREATE_STATUS_LABELS[job.status]}…`;
  async function stop() {
    setStopping(true);
    setStopError("");
    try { await onAct({action: "stop"}); }
    catch (cause) { setStopError(errorMessage(cause, "The run couldn't be stopped. Try again.")); setStopping(false); }
  }
  return <>
    <div className="te-pro-panel te-tool-dialog te-recreate te-recreate-wide">
      <RecreateSummary tracked={tracked} mode={job?.mode}/>
      <p className="te-recreate-message" role="status" aria-live="polite">{message}</p>
      <RecreateLanes job={job}/>
      {reconnecting && <p className="te-dialog-status">Connection lost. Retrying…</p>}
      {stopError && <p className="te-dialog-error te-recreate-alert" role="alert">{stopError}</p>}
      <p className="te-recreate-time"><span>{elapsed}</span> since it started · usually 5–10 minutes · it keeps going if you close this</p>
    </div>
    <div className="te-dialog-footer">
      <button type="button" className="te-text-button te-recreate-another" disabled={stopping || !job} onClick={stop}>{stopping ? "Stopping…" : "Stop"}</button>
      <button ref={primary} type="button" className="te-button te-primary" onClick={onClose}>Keep working</button>
    </div>
  </>;
}

type EditableSlide = OutlineSlide & {key: string; pointsText: string};
type CheckpointErrors = {hook?: string; slides?: string; slide: Record<string, string>};
const toEditable = (slide: OutlineSlide, index: number): EditableSlide => ({...slide, key: `s${index}`, pointsText: slide.points.join("\n")});
function fromEditable(slide: EditableSlide): OutlineSlide {
  return {
    kind: slide.kind, templatePage: slide.templatePage, purpose: slide.purpose.trim(),
    points: slide.pointsText.split("\n").map(point => point.trim()).filter(Boolean),
    chartId: slide.chartId, reactionIds: slide.reactionIds, photo: slide.photo.trim(),
  };
}

/** The checkpoint: a person checks the slide plan, picks the hook and approves before anything is written. */
function RecreateCheckpoint({tracked, job, checkpoint, onApprove, onClose}: {tracked: TrackedRecreate; job: RecreateJob; checkpoint: Checkpoint; onApprove: (request: ApproveRequest) => Promise<unknown>; onClose: () => void}) {
  const id = useId();
  const [slides, setSlides] = useState<EditableSlide[]>(() => checkpoint.slides.map(toEditable));
  // An option's index, -1 for the person's own words, null before they choose.
  const [hook, setHook] = useState<number | null>(null), [ownHook, setOwnHook] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<CheckpointErrors>({slide: {}});
  const [busy, setBusy] = useState(false), [submitError, setSubmitError] = useState("");
  const nextKey = useRef(checkpoint.slides.length);
  const firstHookRef = useRef<HTMLInputElement>(null);
  useInitialFocus(firstHookRef);

  const textPages = checkpoint.pages.filter(page => !page.reaction);
  const single = checkpoint.pages.find(page => page.reaction === "reaction"), double = checkpoint.pages.find(page => page.reaction === "reactions");
  const maxPosts = double ? 2 : single ? 1 : 0;
  const reactionPage = (posts: number) => (posts >= 2 && double ? double : single ?? double)?.index;
  const pageLabel = (index: number) => checkpoint.pages.find(page => page.index === index)?.label ?? `Page ${index + 1}`;
  const slideOf = (postId: string, except: string) => slides.findIndex(slide => slide.key !== except && slide.reactionIds.includes(postId)) + 1;
  const ownLength = [...ownHook.trim()].length;

  function choose(index: number) {
    setHook(index);
    setErrors(current => current.hook ? {...current, hook: undefined} : current);
    if (index === -1) focusLater(`${id}-own-hook`);
  }
  function patch(key: string, change: Partial<EditableSlide>) {
    setSlides(current => current.map(slide => slide.key === key ? {...slide, ...change} : slide));
    setErrors(current => current.slide[key] ? {...current, slide: {...current.slide, [key]: ""}} : current);
  }
  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= slides.length) return;
    const next = [...slides];
    [next[index], next[target]] = [next[target], next[index]];
    setSlides(next);
    // Keep focus on the same control as it moves, unless it is now disabled at the end.
    const edge = target === 0 || target === next.length - 1;
    focusLater(`${id}-${edge ? offset < 0 ? "down" : "up" : offset < 0 ? "up" : "down"}-${next[target].key}`);
  }
  function remove(key: string) {
    const index = slides.findIndex(slide => slide.key === key), next = slides.filter(slide => slide.key !== key);
    setSlides(next);
    setErrors(current => ({...current, slides: undefined}));
    const neighbor = next[Math.min(index, next.length - 1)];
    focusLater(neighbor ? `${id}-purpose-${neighbor.key}` : `${id}-add`);
  }
  function add(kind: "question" | "reaction") {
    if (slides.length >= MAX_RECREATE_SLIDES) return;
    const key = `s${nextKey.current++}`;
    const unused = checkpoint.reactions.find(post => !slides.some(slide => slide.reactionIds.includes(post.id))) ?? checkpoint.reactions[0];
    const textPage = textPages.find(page => /text/i.test(page.label)) ?? textPages.find(page => !/cover|follow/i.test(page.label)) ?? textPages[0];
    const page = kind === "reaction" ? reactionPage(1) : textPage?.index;
    if (page === undefined || kind === "reaction" && !unused) return;
    const slide: EditableSlide = kind === "reaction"
      ? {kind: "reaction", templatePage: page, purpose: "Show how people reacted on X", points: [], chartId: null, reactionIds: [unused!.id], photo: "", key, pointsText: ""}
      : {kind: "question", templatePage: page, purpose: "", points: [], chartId: null, reactionIds: [], photo: "", key, pointsText: ""};
    // New slides go before the closing Follow slide.
    const at = slides.at(-1)?.kind === "follow" ? slides.length - 1 : slides.length;
    setSlides([...slides.slice(0, at), slide, ...slides.slice(at)]);
    setErrors(current => ({...current, slides: undefined}));
    focusLater(`${id}-purpose-${key}`);
  }
  function togglePost(slide: EditableSlide, postId: string) {
    const ids = slide.reactionIds.includes(postId) ? slide.reactionIds.filter(item => item !== postId) : [...slide.reactionIds, postId].slice(0, maxPosts);
    patch(slide.key, {reactionIds: ids, templatePage: reactionPage(Math.max(1, ids.length)) ?? slide.templatePage});
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const next: CheckpointErrors = {slide: {}};
    if (hook === null) next.hook = "Pick a hook, or write your own.";
    else if (hook === -1 && !ownLength) next.hook = "Write your hook, or pick one of the options.";
    else if (hook === -1 && ownLength > MAX_HOOK_CHARACTERS) next.hook = `Keep the hook under ${MAX_HOOK_CHARACTERS} characters.`;
    if (!slides.length) next.slides = "Keep at least one slide.";
    for (const slide of slides) {
      if (slide.kind === "reaction" && !slide.reactionIds.length) next.slide[slide.key] = "Pick a post for this slide, or remove it.";
      else if (!slide.purpose.trim()) next.slide[slide.key] = "Say what this slide tells the reader.";
    }
    setErrors(next);
    if (next.hook || hook === null) { focusLater(hook === -1 ? `${id}-own-hook` : `${id}-hook-0`); return; }
    const invalid = slides.find(slide => next.slide[slide.key]);
    if (invalid) { focusLater(`${id}-purpose-${invalid.key}`); return; }
    if (next.slides) { focusLater(`${id}-add`); return; }
    const plain = slides.map(fromEditable), edited = JSON.stringify(plain) !== JSON.stringify(checkpoint.slides);
    const request: ApproveRequest = {
      ...(edited ? {outline: {slides: plain, why: checkpoint.why}} : {}),
      hook: hook === -1 ? {text: ownHook.trim()} : {option: hook},
      ...(notes.trim() ? {notes: notes.trim()} : {}),
    };
    setBusy(true);
    setSubmitError("");
    try { await onApprove(request); }
    catch (cause) { setSubmitError(errorMessage(cause, "The plan couldn't be approved. Try again.")); setBusy(false); }
  }

  return <form noValidate onSubmit={approve}>
    <fieldset disabled={busy} className="te-pro-panel te-tool-dialog te-recreate te-recreate-wide">
      <RecreateSummary tracked={tracked} mode={job.mode}/>
      {checkpoint.brief && <div className="te-recreate-brief">
        <strong>{checkpoint.brief.topic}</strong>
        {checkpoint.brief.angle && <p>{checkpoint.brief.angle}</p>}
        {checkpoint.brief.originalHeadline && <small>Original headline: “{checkpoint.brief.originalHeadline}”</small>}
      </div>}

      <RecreateSection title="Hook" aside={HOOK_SOURCES[checkpoint.hookSource]}>
        {checkpoint.hookNote && <p className="te-recreate-note">{checkpoint.hookNote}</p>}
        <div className="te-recreate-hooks" role="radiogroup" aria-label="Hook" aria-describedby={errors.hook ? `${id}-hook-error` : undefined}>
          {checkpoint.hooks.map((option, index) => <label key={index} className={`te-recreate-hook${hook === index ? " is-selected" : ""}`}>
            <input ref={index === 0 ? firstHookRef : undefined} id={`${id}-hook-${index}`} type="radio" name={`${id}-hook`} checked={hook === index} onChange={() => choose(index)}/>
            <span className="te-recreate-hook-text">{option.text}</span>
            {(option.framework || option.english) && <small>{option.framework}{option.framework && option.english ? " · " : ""}{option.english ? `From “${option.english}”` : ""}</small>}
          </label>)}
          <label className={`te-recreate-hook${hook === -1 ? " is-selected" : ""}`}>
            <input ref={checkpoint.hooks.length ? undefined : firstHookRef} id={checkpoint.hooks.length ? undefined : `${id}-hook-0`} type="radio" name={`${id}-hook`} checked={hook === -1} onChange={() => choose(-1)}/>
            <span className="te-recreate-hook-text">Write my own</span>
          </label>
        </div>
        {hook === -1 && <label className="te-recreate-field">
          <span id={`${id}-own-label`}>Your hook</span>
          <textarea id={`${id}-own-hook`} aria-labelledby={`${id}-own-label`} rows={2} maxLength={MAX_HOOK_CHARACTERS + 40} value={ownHook} aria-invalid={Boolean(errors.hook)} onChange={event => { setOwnHook(event.target.value); setErrors(current => current.hook ? {...current, hook: undefined} : current); }}/>
          <small className={ownLength > MAX_HOOK_CHARACTERS ? "te-recreate-invalid" : ""}>{ownLength}/{MAX_HOOK_CHARACTERS}</small>
        </label>}
        {errors.hook && <small id={`${id}-hook-error`} className="te-recreate-invalid" role="alert">{errors.hook}</small>}
      </RecreateSection>

      <RecreateSection title="Slides" aside={plural(slides.length, "slide")}>
        {checkpoint.why && <p className="te-recreate-note">{checkpoint.why}</p>}
        <ol className="te-recreate-outline">
          {slides.map((slide, index) => {
            const error = errors.slide[slide.key], chosen = slide.reactionIds.map(postId => checkpoint.reactions.find(post => post.id === postId)).filter((post): post is CheckpointReaction => Boolean(post));
            const facts = slide.pointsText.split("\n").filter(point => point.trim()).length, page = pageLabel(slide.templatePage);
            return <li key={slide.key} className={`te-recreate-slide${error ? " is-invalid" : ""}`}>
              <div className="te-recreate-slide-head">
                <span className="te-recreate-slide-number" aria-hidden>{index + 1}</span>
                <span className="te-recreate-slide-kind">{KIND_LABELS[slide.kind]}{page.toLowerCase() !== KIND_LABELS[slide.kind].toLowerCase() && <small> · {page}</small>}</span>
                <span className="te-recreate-slide-tools">
                  <button id={`${id}-up-${slide.key}`} type="button" aria-label={`Move slide ${index + 1} earlier`} title="Move earlier" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                  <button id={`${id}-down-${slide.key}`} type="button" aria-label={`Move slide ${index + 1} later`} title="Move later" disabled={index === slides.length - 1} onClick={() => move(index, 1)}>↓</button>
                  <button type="button" aria-label={`Remove slide ${index + 1}`} title="Remove" onClick={() => remove(slide.key)}><CloseIcon size={14}/></button>
                </span>
              </div>
              <label className="te-recreate-field">
                <span className="te-sr-only">What slide {index + 1} tells the reader</span>
                <textarea id={`${id}-purpose-${slide.key}`} rows={2} maxLength={600} placeholder="What this slide tells the reader" value={slide.purpose} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error-${slide.key}` : undefined} onChange={event => patch(slide.key, {purpose: event.target.value})}/>
              </label>
              {slide.kind === "reaction" ? <>
                {chosen.length > 0 && <ul className="te-recreate-posts">{chosen.map(post => <li key={post.id}><PostCard post={post}/></li>)}</ul>}
                <details className="te-recreate-slide-more">
                  <summary>Choose posts · {plural(checkpoint.reactions.length, "real post")} found</summary>
                  <div className="te-recreate-post-choices" role="group" aria-label={`Posts for slide ${index + 1}, up to ${maxPosts}`}>
                    {checkpoint.reactions.map(post => {
                      const checked = slide.reactionIds.includes(post.id), elsewhere = slideOf(post.id, slide.key);
                      return <label key={post.id} className={`te-recreate-post-choice${checked ? " is-selected" : ""}`}>
                        <input type="checkbox" checked={checked} disabled={!checked && slide.reactionIds.length >= maxPosts} onChange={() => togglePost(slide, post.id)}/>
                        <PostCard post={post} note={elsewhere ? `also on slide ${elsewhere}` : ""}/>
                      </label>;
                    })}
                  </div>
                </details>
              </> : <>
                {(textPages.length > 1 || checkpoint.charts.length > 0) && <div className="te-recreate-slide-row">
                  {textPages.length > 1 && <label className="te-recreate-field">
                    <span>Page</span>
                    <select value={slide.templatePage} onChange={event => patch(slide.key, {templatePage: Number(event.target.value)})}>
                      {textPages.map(page => <option key={page.index} value={page.index}>{page.label}</option>)}
                    </select>
                  </label>}
                  {checkpoint.charts.length > 0 && <label className="te-recreate-field">
                    <span>Chart</span>
                    <select value={slide.chartId ?? ""} onChange={event => patch(slide.key, {chartId: event.target.value || null})}>
                      <option value="">No chart</option>
                      {checkpoint.charts.map(chart => <option key={chart.id} value={chart.id}>{chart.purpose || chart.id}</option>)}
                    </select>
                  </label>}
                </div>}
                <details className="te-recreate-slide-more">
                  <summary>Facts and photo{facts ? ` · ${plural(facts, "fact")}` : ""}{slide.photo.trim() ? " · photo" : ""}</summary>
                  <div className="te-recreate-slide-details">
                    <label className="te-recreate-field">
                      <span>Facts it uses, one per line</span>
                      <textarea rows={3} maxLength={4000} value={slide.pointsText} onChange={event => patch(slide.key, {pointsText: event.target.value})}/>
                    </label>
                    <label className="te-recreate-field">
                      <span>Photo it needs</span>
                      <input type="text" maxLength={600} placeholder="None" value={slide.photo} onChange={event => patch(slide.key, {photo: event.target.value})}/>
                    </label>
                  </div>
                </details>
              </>}
              {error && <small id={`${id}-error-${slide.key}`} className="te-recreate-invalid" role="alert">{error}</small>}
            </li>;
          })}
        </ol>
        {errors.slides && <small className="te-recreate-invalid" role="alert">{errors.slides}</small>}
        <div className="te-recreate-add">
          <button id={`${id}-add`} type="button" className="te-button" disabled={slides.length >= MAX_RECREATE_SLIDES} onClick={() => add("question")}><PlusIcon size={14}/>Add a slide</button>
          {checkpoint.reactions.length > 0 && maxPosts > 0 && <button type="button" className="te-button" disabled={slides.length >= MAX_RECREATE_SLIDES} onClick={() => add("reaction")}><PlusIcon size={14}/>Add a reaction slide</button>}
        </div>
      </RecreateSection>

      <label className="te-recreate-field">
        <span id={`${id}-notes-label`}>Notes for the writers <small className="te-recreate-optional">Optional</small></span>
        <textarea aria-labelledby={`${id}-notes-label`} rows={2} maxLength={2000} placeholder="Anything the copywriter should know" value={notes} onChange={event => setNotes(event.target.value)}/>
      </label>
    </fieldset>
    {submitError && <div className="te-dialog-error te-recreate-alert" role="alert"><strong>Not approved yet</strong><span>{submitError}</span></div>}
    <div className="te-dialog-footer">
      {checkpoint.hookSource === "headline-model" && <span className="te-recreate-footnote te-recreate-learns">Your hook pick also teaches the headline model.</span>}
      <button type="button" className="te-button" onClick={onClose}>Later</button>
      <button className="te-button te-primary" disabled={busy}>{busy ? "Approving…" : "Approve and write"}</button>
    </div>
  </form>;
}

function PostCard({post, note = ""}: {post: CheckpointReaction; note?: string}) {
  const href = safeSourceUrl(post.url);
  return <span className="te-recreate-post">
    <span className="te-recreate-post-head">
      <strong>{post.name || `@${post.handle}`}</strong>
      <span>@{post.handle} · {compactNumber(post.likes)} likes{note ? ` · ${note}` : ""}</span>
      {href && <a href={href} target="_blank" rel="noopener noreferrer">Open on X</a>}
    </span>
    <span className="te-recreate-post-text">{post.text}</span>
  </span>;
}

function RecreateCritics({review, fallback}: {review: RecreateReview | null; fallback: string}) {
  if (!review) return fallback ? <RecreateSection title="Critics"><p>{fallback}</p></RecreateSection> : null;
  const issues = [...review.open.filter(issue => issue.severity === "must_fix"), ...review.open.filter(issue => issue.severity === "should_fix")];
  const aside = [review.rendered ? "Checked the rendered slides" : "Checked without renders", review.round ? `after ${plural(review.round, "fix round")}` : ""].filter(Boolean).join(" · ");
  return <RecreateSection title="Critics" aside={aside}>
    {(review.facts || review.design) && <dl className="te-recreate-critics">
      {review.facts && <><dt>Facts</dt><dd>{review.facts}</dd></>}
      {review.design && <><dt>Design</dt><dd>{review.design}</dd></>}
    </dl>}
    {issues.length ? <ul className="te-recreate-issues">
      {issues.map((issue, index) => <li key={index} className={`is-${issue.severity}`}>
        <span className="te-recreate-verdict">{issue.severity === "must_fix" ? "Must fix" : "Should fix"} · {issue.slide ? `Slide ${issue.slide}` : "Whole post"}</span>
        <p className="te-recreate-claim">{issue.problem}</p>
        {issue.fix && <p>{issue.fix}</p>}
      </li>)}
    </ul> : <p>Nothing left to fix.</p>}
  </RecreateSection>;
}

function RecreateDone({tracked, job, result, isOpen, onOpen, onClose, onAnother}: {tracked: TrackedRecreate; job: RecreateJob; result: RecreateResult; isOpen: boolean; onOpen: () => void; onClose: () => void; onAnother: () => void}) {
  const primary = useRef<HTMLButtonElement>(null);
  useInitialFocus(primary);
  const counts = (["confirmed", "corrected", "unverified"] as const).map(verdict => [verdict, result.factChecks.filter(item => item.verdict === verdict).length] as const).filter(([, count]) => count > 0);
  const reviewStage = job.stages.find(stage => stage.stage === "review");
  const criticsFallback = reviewStage && (reviewStage.status === "skipped" || reviewStage.status === "error") ? reviewStage.summary || "The critics didn't run." : "";
  return <>
    <div className="te-pro-panel te-tool-dialog te-recreate te-recreate-wide">
      <div className="te-recreate-result">
        <span className="te-recreate-result-icon" aria-hidden><CheckIcon size={18} strokeWidth={2.2}/></span>
        <div>
          <strong>{result.name}</strong>
          <span>{result.slideCount ? `${plural(result.slideCount, "slide")} · ` : ""}{tracked.profileName}{isOpen ? " · open in the editor" : ""}</span>
        </div>
      </div>
      <RecreateCritics review={result.review} fallback={criticsFallback}/>
      <RecreateSection title="Fact-check" aside={counts.map(([verdict, count]) => `${count} ${verdict}`).join(" · ")}>
        {result.factChecks.length ? <ul className="te-recreate-facts">
          {result.factChecks.map((item, index) => <li key={index} className={`is-${item.verdict}`}>
            <span className="te-recreate-verdict">{VERDICT_LABELS[item.verdict]}</span>
            <p className="te-recreate-claim">{item.claim}</p>
            {item.detail && <p>{item.detail}</p>}
            {item.sources.length > 0 && <ul className="te-recreate-sources" aria-label="Sources">
              {item.sources.map((source, position) => {
                const href = safeSourceUrl(source.url);
                return <li key={position}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}</li>;
              })}
            </ul>}
          </li>)}
        </ul> : <p>No claims needed checking.</p>}
      </RecreateSection>
      {result.notes.length > 0 && <RecreateSection title="Notes">
        <ul className="te-recreate-notes">{result.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
      </RecreateSection>}
      {job.stages.length > 0 && <details className="te-recreate-team">
        <summary>What each agent did</summary>
        <RecreateLanes job={job}/>
      </details>}
    </div>
    <div className="te-dialog-footer">
      <button type="button" className="te-text-button te-recreate-another" onClick={onAnother}>Recreate another</button>
      {isOpen ? <button ref={primary} type="button" className="te-button te-primary" onClick={onClose}>Continue editing</button>
        : <button ref={primary} type="button" className="te-button te-primary" onClick={onOpen}>Open post</button>}
    </div>
  </>;
}

function RecreateSection({title, aside, children}: {title: string; aside?: string; children: ReactNode}) {
  const id = useId();
  return <div className="te-recreate-section" role="group" aria-labelledby={id}>
    <div className="te-recreate-section-head"><h3 id={id}>{title}</h3>{aside && <span>{aside}</span>}</div>
    {children}
  </div>;
}

function RecreateFailure({tracked, job, error, onResume, onRetry, onScreenshots, onClose}: {tracked: TrackedRecreate; job: RecreateJob | null; error: string; onResume: () => Promise<unknown>; onRetry: () => void; onScreenshots: () => void; onClose: () => void}) {
  const setup = recreateSetupIssue(error);
  // Resuming helps once a stage has finished; a run that never got going is better edited and started again.
  const canResume = !setup && Boolean(job?.resumable && job.stages.some(stage => stage.status === "done"));
  const [resuming, setResuming] = useState(false), [resumeError, setResumeError] = useState("");
  const primary = useRef<HTMLButtonElement>(null);
  useInitialFocus(primary);
  async function resume() {
    setResuming(true);
    setResumeError("");
    try { await onResume(); }
    catch (cause) { setResumeError(errorMessage(cause, "The run couldn't resume. Try again.")); setResuming(false); }
  }
  return <>
    <div className="te-pro-panel te-tool-dialog te-recreate te-recreate-wide">
      <RecreateSummary tracked={tracked} mode={job?.mode}/>
      <div className="te-dialog-error te-recreate-alert" role="alert">
        <strong>{setup ? "Setup needed" : "Something went wrong"}</strong>
        <span>{error}</span>
        {setup === "claude" && <span>Ask whoever runs Engine to add the Claude API key, then try again.</span>}
        {setup === "apify" && tracked.draft.mode === "link" && <span>Instagram import isn&apos;t set up, but uploading screenshots still works.</span>}
        {canResume && <span>Resume picks up from the last finished step, so nothing done so far is lost.</span>}
      </div>
      {resumeError && <p className="te-dialog-error te-recreate-alert" role="alert">{resumeError}</p>}
      {job && job.stages.length > 0 && <details className="te-recreate-team">
        <summary>See each step</summary>
        <RecreateLanes job={job}/>
      </details>}
    </div>
    <div className="te-dialog-footer">
      <button type="button" className="te-button" onClick={onClose}>Close</button>
      {setup === "apify" && tracked.draft.mode === "link"
        ? <button ref={primary} type="button" className="te-button te-primary" onClick={onScreenshots}>Upload screenshots</button>
        : canResume ? <>
          <button type="button" className="te-button" disabled={resuming} onClick={onRetry}>Start over</button>
          <button ref={primary} type="button" className="te-button te-primary" disabled={resuming} onClick={resume}>{resuming ? "Resuming…" : "Resume"}</button>
        </>
        : <button ref={primary} type="button" className="te-button te-primary" onClick={onRetry}>Edit and try again</button>}
    </div>
  </>;
}

function RecreateIndicator({phase, job, reconnecting, compact, onOpen, onDismiss}: {phase: Phase; job: RecreateJob | null; reconnecting: boolean; compact?: boolean; onOpen: () => void; onDismiss: () => void}) {
  const [title, detail] = phase === "done" ? [compact ? "Fact-check" : "Your recreated post is ready", "Review the fact-check"]
    : phase === "error" ? [compact ? "Recreate stopped" : "Recreate didn't finish", job?.resumable ? "Resume or see what happened" : "See what happened"]
    : phase === "checkpoint" ? [compact ? "Check the plan" : "Ready for your review", "Pick the hook and approve the plan"]
    : [compact ? "Recreating…" : "Recreating post", reconnecting ? "Reconnecting…" : job && job.status !== "queued" ? `${RECREATE_STATUS_LABELS[job.status]}…` : "Starting…"];
  return <div className={`te-recreate-toast is-${phase}${compact ? " is-compact" : ""}`}>
    <button type="button" className="te-recreate-toast-open" onClick={onOpen} aria-label={`${title}. ${detail}. Open details`}>
      <span className="te-recreate-toast-icon" aria-hidden>{phase === "done" ? <CheckIcon size={15} strokeWidth={2.2}/> : phase === "error" ? "!" : phase === "checkpoint" ? "?" : <span className="te-recreate-spinner"/>}</span>
      <span className="te-recreate-toast-text"><strong>{title}</strong><small>{detail}</small></span>
    </button>
    {phase !== "running" && <button type="button" className="te-recreate-toast-close" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}><CloseIcon size={15}/></button>}
    <span className="te-sr-only" role="status" aria-live="polite">{title}. {detail}</span>
  </div>;
}
