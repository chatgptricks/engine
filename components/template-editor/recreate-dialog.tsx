"use client";
/* eslint-disable @next/next/no-img-element */
import {useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type ReactNode, type RefObject} from "react";
import {ArrowRightIcon, CheckIcon, CloseIcon, ImageIcon} from "@/components/engine/icons";
import {Modal} from "./controls";
import {
  MAX_RECREATE_UPLOADS, RECREATE_IMAGE_TYPES, RECREATE_STEPS,
  fetchPageProfiles, instagramLabel, normalizeInstagramUrl, prepareRecreateUpload, recreateSetupIssue, recreateTimestamp, safeSourceUrl, useRecreateJob,
  type FactCheck, type PageProfile, type PreparedUpload, type RecreateJob, type RecreateRequest, type RecreateResult, type TrackedRecreate,
} from "./recreate-job";
import "./pro-tools.css";
import "./dialog-tools.css";
import "./recreate-dialog.css";

type Draft = {mode: "link" | "screenshots"; url: string; uploads: PreparedUpload[]; caption: string; notes: string; profileId: string};
type FieldErrors = Partial<Record<"url" | "uploads" | "profileId", string>>;
const EMPTY_DRAFT: Draft = {mode: "link", url: "", uploads: [], caption: "", notes: "", profileId: ""};
const PROFILE_MEMORY = "engine:recreate-profile";
const NOTE_IDEAS = ["Make it simpler", "Add a chart", "Use the latest stock data"];
const VERDICT_LABELS: Record<FactCheck["verdict"], string> = {confirmed: "Confirmed", corrected: "Corrected", unverified: "Unverified"};
let profileCache: PageProfile[] | null = null;

function rememberedProfile(): string {
  try { return window.localStorage.getItem(PROFILE_MEMORY) ?? ""; } catch { return ""; }
}
function rememberProfile(id: string) {
  try { window.localStorage.setItem(PROFILE_MEMORY, id); } catch { /* Only a convenience. */ }
}
function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
function phaseOf(tracked: TrackedRecreate | null, job: RecreateJob | null): "form" | "running" | "done" | "error" {
  if (!tracked) return "form";
  if (job?.status === "done" && job.result) return "done";
  if (job?.status === "error") return "error";
  return "running";
}
function stepIndex(job: RecreateJob | null): number {
  if (!job || job.status === "queued") return -1;
  if (job.status === "done") return RECREATE_STEPS.length;
  return RECREATE_STEPS.findIndex(step => step.status === job.status);
}
function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
function profileLabel(profile: PageProfile): string {
  if (!profile.handle) return profile.name;
  return profile.name.replace(/^@/, "").toLowerCase() === profile.handle.toLowerCase() ? `@${profile.handle}` : `${profile.name} · @${profile.handle}`;
}
/** The native dialog opens after child effects run, so focus a field once it is showing. */
function useInitialFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const timer = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [ref]);
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
    setDraft(current => ({...EMPTY_DRAFT, mode: current.mode, profileId: current.profileId}));
    recreate.dismiss();
  }

  const title = phase === "done" ? "Your post is ready" : phase === "error" ? "Recreate didn't finish" : "Recreate a post";
  return <>
    {open && <Modal title={title} onClose={() => onOpenChange(false)}>
      {phase === "form" && <RecreateForm draft={draft} setDraft={setDraft} blockedReason={blockedReason} onStart={recreate.start} onClose={() => onOpenChange(false)}/>}
      {phase === "running" && tracked && <RecreateProgress tracked={tracked} job={job} reconnecting={recreate.reconnecting} onClose={() => onOpenChange(false)}/>}
      {phase === "done" && tracked && job?.result && <RecreateDone tracked={tracked} result={job.result} isOpen={Boolean(inEditor) && activeDesignId === job.result.deckId} onOpen={() => openResult(job.result!)} onClose={() => onOpenChange(false)} onAnother={startAnother}/>}
      {phase === "error" && tracked && <RecreateFailure tracked={tracked} error={job?.error || job?.message || "Recreate failed. Try again."} onRetry={editAndRetry} onScreenshots={() => { editAndRetry(); setDraft(current => ({...current, mode: "screenshots"})); }} onClose={() => onOpenChange(false)}/>}
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
    const request: RecreateRequest = draft.mode === "link"
      ? {url: url!, profileId: profile.id, ...(notes ? {notes} : {})}
      : {uploads: draft.uploads.map(({name, dataUrl}) => ({name, dataUrl})), profileId: profile.id, ...(caption ? {caption} : {}), ...(notes ? {notes} : {})};
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
      <p className="te-recreate-intro">Turn an Instagram post into a new editable post for one of your pages.</p>
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

function RecreateSummary({tracked}: {tracked: TrackedRecreate}) {
  return <div className="te-recreate-summary">
    <span title={tracked.source}>{tracked.source}</span>
    <ArrowRightIcon size={14}/>
    <span title={tracked.profileName}>{tracked.profileName}</span>
  </div>;
}

function RecreateProgress({tracked, job, reconnecting, onClose}: {tracked: TrackedRecreate; job: RecreateJob | null; reconnecting: boolean; onClose: () => void}) {
  const primary = useRef<HTMLButtonElement>(null);
  useInitialFocus(primary);
  const started = recreateTimestamp(job?.startedAt);
  const elapsed = useElapsed(Number.isFinite(started) ? started : tracked.startedAt);
  const current = stepIndex(job), step = RECREATE_STEPS[current];
  const message = !job ? "Checking progress…" : job.status === "queued" ? "Waiting to start…" : job.message || `${step?.label ?? "Working"}…`;
  return <>
    <div className="te-pro-panel te-tool-dialog te-recreate">
      <RecreateSummary tracked={tracked}/>
      <ol className="te-recreate-steps">
        {RECREATE_STEPS.map((item, index) => {
          const state = index < current ? "done" : index === current ? "active" : "waiting";
          return <li key={item.status} className={`is-${state}`} aria-current={state === "active" ? "step" : undefined}>
            <span className="te-recreate-step-icon" aria-hidden>{state === "done" ? <CheckIcon size={13} strokeWidth={2.2}/> : state === "active" ? <span className="te-recreate-spinner"/> : null}</span>
            <span>{item.label}<span className="te-sr-only">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : ""}</span></span>
          </li>;
        })}
      </ol>
      <p className="te-recreate-message" role="status" aria-live="polite">{message}</p>
      {reconnecting && <p className="te-dialog-status">Connection lost. Retrying…</p>}
      <p className="te-recreate-time"><span>{elapsed}</span> elapsed · usually 1–4 minutes</p>
    </div>
    <div className="te-dialog-footer">
      <span className="te-recreate-footnote">You can close this and keep working.</span>
      <button ref={primary} type="button" className="te-button te-primary" onClick={onClose}>Keep working</button>
    </div>
  </>;
}

function RecreateDone({tracked, result, isOpen, onOpen, onClose, onAnother}: {tracked: TrackedRecreate; result: RecreateResult; isOpen: boolean; onOpen: () => void; onClose: () => void; onAnother: () => void}) {
  const primary = useRef<HTMLButtonElement>(null);
  useInitialFocus(primary);
  const counts = (["confirmed", "corrected", "unverified"] as const).map(verdict => [verdict, result.factChecks.filter(item => item.verdict === verdict).length] as const).filter(([, count]) => count > 0);
  return <>
    <div className="te-pro-panel te-tool-dialog te-recreate">
      <div className="te-recreate-result">
        <span className="te-recreate-result-icon" aria-hidden><CheckIcon size={18} strokeWidth={2.2}/></span>
        <div>
          <strong>{result.name}</strong>
          <span>{result.slideCount ? `${plural(result.slideCount, "slide")} · ` : ""}{tracked.profileName}{isOpen ? " · open in the editor" : ""}</span>
        </div>
      </div>
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

function RecreateFailure({tracked, error, onRetry, onScreenshots, onClose}: {tracked: TrackedRecreate; error: string; onRetry: () => void; onScreenshots: () => void; onClose: () => void}) {
  const setup = recreateSetupIssue(error);
  const primary = useRef<HTMLButtonElement>(null);
  useInitialFocus(primary);
  return <>
    <div className="te-pro-panel te-tool-dialog te-recreate">
      <RecreateSummary tracked={tracked}/>
      <div className="te-dialog-error te-recreate-alert" role="alert">
        <strong>{setup ? "Setup needed" : "Something went wrong"}</strong>
        <span>{error}</span>
        {setup === "claude" && <span>Ask whoever runs Engine to add the Claude API key, then try again.</span>}
        {setup === "apify" && tracked.draft.mode === "link" && <span>Instagram import isn&apos;t set up, but uploading screenshots still works.</span>}
      </div>
    </div>
    <div className="te-dialog-footer">
      <button type="button" className="te-button" onClick={onClose}>Close</button>
      {setup === "apify" && tracked.draft.mode === "link"
        ? <button ref={primary} type="button" className="te-button te-primary" onClick={onScreenshots}>Upload screenshots</button>
        : <button ref={primary} type="button" className="te-button te-primary" onClick={onRetry}>Edit and try again</button>}
    </div>
  </>;
}

function RecreateIndicator({phase, job, reconnecting, compact, onOpen, onDismiss}: {phase: ReturnType<typeof phaseOf>; job: RecreateJob | null; reconnecting: boolean; compact?: boolean; onOpen: () => void; onDismiss: () => void}) {
  const step = RECREATE_STEPS[stepIndex(job)];
  const [title, detail] = phase === "done" ? [compact ? "Fact-check" : "Your recreated post is ready", "Review the fact-check"]
    : phase === "error" ? [compact ? "Recreate failed" : "Recreate didn't finish", "See what happened"]
    : [compact ? "Recreating…" : "Recreating post", reconnecting ? "Reconnecting…" : step ? `${step.label}…` : "Starting…"];
  return <div className={`te-recreate-toast is-${phase}${compact ? " is-compact" : ""}`}>
    <button type="button" className="te-recreate-toast-open" onClick={onOpen} aria-label={`${title}. ${detail}. Open details`}>
      <span className="te-recreate-toast-icon" aria-hidden>{phase === "done" ? <CheckIcon size={15} strokeWidth={2.2}/> : phase === "error" ? "!" : <span className="te-recreate-spinner"/>}</span>
      <span className="te-recreate-toast-text"><strong>{title}</strong><small>{detail}</small></span>
    </button>
    {phase !== "running" && <button type="button" className="te-recreate-toast-close" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}><CloseIcon size={15}/></button>}
    <span className="te-sr-only" role="status" aria-live="polite">{title}. {detail}</span>
  </div>;
}
