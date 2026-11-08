"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ImageIcon, PlusIcon, TrashIcon } from "@/components/engine/icons";
import { proxied } from "@/lib/engine/util";
import { prepareRasterAsset } from "@/lib/template-editor/client-media";
import { prepareVectorBrandAsset } from "@/lib/template-editor/brand-assets";
import { libraryTemplates } from "@/lib/template-editor/template-catalog";
import { CHATGPTRICKS_TEMPLATE_ID } from "@/lib/template-editor/chatgptricks-template";
import { libraryBrandKits, type DesignTemplate, type EditorLibrary } from "@/lib/template-editor/model";
import {
  BrandGuideError, GUIDE_CHECKS, GUIDE_CHECK_KINDS, GUIDE_FONT_IDS, GUIDE_LIMITS, brandGuideSlug, guideBrief, parseBrandGuide, runGuideChecks,
  type BrandGuide, type GuideCheckKind, type GuideColorRole, type GuideExample, type GuideImage, type GuideIssue, type GuideLogo, type GuideRuleArea, type GuideTextRole, type GuideTextStyle,
} from "@/lib/template-editor/brand-guide";
import { designTemplateFromGuide, guideTemplateId, type GuideLanguage } from "@/lib/template-editor/guide-template";
import { FONTS, Modal, NumberField } from "./controls";
import "./brand-guide-panel.css";

/**
 * Brand → Guides: what a brand looks and reads like, written once for people
 * and agents. Every save is a new version (agents' saves too) and any earlier
 * version can be brought back. Templates drafted here go through the editor's
 * own library save, and a page only switches to one when someone picks it.
 */

type GuideLine = { id: string; name: string; version: number; updatedAt: string; source: string; builtIn: boolean; overridden: boolean; rules: number; checks: number; logos: number; examples: number };
type VersionLine = { version: number; updatedAt: string; savedBy: "person" | "agent"; note: string };
type PageLine = { id: string; name: string; handle: string; language: "en" | "es"; templateId: string | null };
type Loaded = { guide: BrandGuide; versions: VersionLine[]; pages: PageLine[] };
type Message = { tone: "info" | "error"; text: string; issues?: string[] };
type Confirm = { title: string; text: string; label: string; run: () => void };
type Edit = (change: (guide: BrandGuide) => BrandGuide) => void;
type Props = { library: EditorLibrary; canEdit: boolean; onChange: (update: (library: EditorLibrary) => EditorLibrary) => boolean | void };

const ENDPOINT = "/api/engine/brands";
const COLOR_ROLES: [GuideColorRole, string][] = [["background", "Background"], ["text", "Text"], ["accent", "Accent"], ["accent-end", "Accent end"], ["surface", "Surface"], ["secondary", "Secondary"], ["source", "Source line"], ["other", "Other"]];
const TEXT_ROLES: [GuideTextRole, string][] = [["title", "Content title"], ["body", "Text under a title"], ["cover", "Cover headline"], ["cover-remark", "Cover remark"], ["source", "Source line"], ["follow", "Follow line"], ["list", "List item"], ["other", "Other"]];
const AREAS: [GuideRuleArea, string][] = [["writing", "Writing"], ["cover", "Cover"], ["logos", "Logos"], ["media", "Media"], ["layout", "Layout"], ["type", "Type"], ["color", "Color"]];
const LANGUAGES: [GuideLanguage, string][] = [["en", "English"], ["es", "Spanish"]];
const HEX = /^#[0-9a-f]{6}$/i;
const fontLabel = (id: string) => FONTS.find(([font]) => font === id)?.[1] ?? id.charAt(0).toUpperCase() + id.slice(1);
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const replaceAt = <T,>(list: T[], index: number, change: Partial<T>): T[] => list.map((item, i) => i === index ? { ...item, ...change } : item);
const removeAt = <T,>(list: T[], index: number): T[] => list.filter((_, i) => i !== index);
const when = (iso: string) => {
  const date = new Date(iso);
  return date.getTime() > 0 ? date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
};
/** The guide version a drafted template was made from, read from its brand-guide tag. */
const draftedFrom = (template: DesignTemplate | undefined, guideId: string) => Number(template?.tags?.find(tag => tag.startsWith(`brand-guide:${guideId}@`))?.split("@")[1]) || 0;
const isDraft = (template: DesignTemplate) => (template.tags ?? []).some(tag => tag.startsWith("brand-guide:"));

class GuideRequestError extends Error {
  constructor(message: string, readonly status: number, readonly issues: string[] = []) {
    super(message);
    this.name = "GuideRequestError";
  }
}

async function call<T>(input: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { cache: "no-store", ...init, ...(init.body ? { headers: { "Content-Type": "application/json" } } : {}) });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new GuideRequestError("Engine couldn't be reached. Check your connection and try again.", 0);
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const server = typeof body?.error === "string" ? body.error : "";
    const issues = Array.isArray(body?.issues) ? body.issues.filter((issue): issue is string => typeof issue === "string") : [];
    if (server) throw new GuideRequestError(server, response.status, issues);
    if (response.status === 401 || response.status === 403) throw new GuideRequestError("Your session has ended. Reload the page and sign in again.", response.status);
    throw new GuideRequestError(`Brand guides ran into a server problem (HTTP ${response.status}). Try again in a moment.`, response.status);
  }
  return body as T;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

async function prepareGuideImage(file: File): Promise<GuideImage> {
  const name = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, GUIDE_LIMITS.imageName) || "Image";
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    if (file.size > GUIDE_LIMITS.svgUrl) throw new Error("Choose an SVG smaller than 400 KB.");
    const vector = await prepareVectorBrandAsset(await file.text(), file.name, "logo");
    return { id: newId("image"), name, src: vector.src, ...(vector.previewSrc ? { previewSrc: vector.previewSrc } : {}), width: vector.width, height: vector.height };
  }
  const asset = await prepareRasterAsset(file);
  return { id: newId("image"), name, src: asset.src, previewSrc: asset.previewSrc, width: asset.width, height: asset.height };
}

export function BrandGuidePanel({ library, canEdit, onChange }: Props) {
  const [guides, setGuides] = useState<GuideLine[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<BrandGuide | null>(null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [baseId, setBaseId] = useState(CHATGPTRICKS_TEMPLATE_ID);
  const [drafted, setDrafted] = useState<{ name: string; issues: GuideIssue[] } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const templates = libraryTemplates(library);
  const bases = templates.filter(template => !isDraft(template));
  const base = bases.find(template => template.id === baseId) ?? bases[0];

  const loadList = useCallback(async (signal?: AbortSignal) => {
    const body = await call<{ guides: GuideLine[] }>(ENDPOINT, { signal });
    if (mounted.current) setGuides(body.guides);
    return body.guides;
  }, []);
  const loadGuide = useCallback(async (id: string, signal?: AbortSignal) => {
    const body = await call<Loaded>(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { signal });
    if (!mounted.current) return;
    setLoaded({ guide: body.guide, versions: body.versions, pages: body.pages });
    setDraft(structuredClone(body.guide));
    setDirty(false);
    setConflict(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadList(controller.signal)
      .then(list => { if (mounted.current) setSelected(current => current ?? list[0]?.id ?? null); })
      .catch(error => { if (!isAbort(error) && mounted.current) setMessage({ tone: "error", text: errorText(error) }); });
    return () => controller.abort();
  }, [loadList, attempt]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    loadGuide(selected, controller.signal).catch(error => { if (!isAbort(error) && mounted.current) setMessage({ tone: "error", text: errorText(error) }); });
    return () => controller.abort();
  }, [selected, loadGuide]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit: Edit = useCallback(change => {
    if (!canEdit) return;
    setDraft(current => current ? change(current) : current);
    setDirty(true);
  }, [canEdit]);

  /** What the server would refuse, shown while editing (checked a beat behind typing). */
  const checking = useDeferredValue(draft);
  const problems = useMemo(() => {
    if (!checking || !dirty) return [];
    try {
      parseBrandGuide(checking);
      return [];
    } catch (error) {
      return error instanceof BrandGuideError ? error.issues.length ? error.issues : [error.message] : [errorText(error)];
    }
  }, [checking, dirty]);
  const brief = useMemo(() => checking ? guideBrief(checking) : "", [checking]);

  function guarded(action: () => void, what: string) {
    if (!dirty) return action();
    setConfirm({ title: "Discard unsaved changes?", text: `Your edits to this guide aren't saved yet. ${what} drops them.`, label: "Discard changes", run: () => { setDirty(false); action(); } });
  }
  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof GuideRequestError && error.status === 409) setConflict(true);
      setMessage({ tone: "error", text: errorText(error), issues: error instanceof GuideRequestError && error.issues.length > 1 ? error.issues : undefined });
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  const save = () => run("save", async () => {
    if (!draft || !loaded) return;
    const body = await call<{ guide: BrandGuide }>(ENDPOINT, { method: "PUT", body: JSON.stringify({ guide: draft, expectedVersion: loaded.guide.version, note: note.trim() }) });
    await Promise.all([loadGuide(body.guide.id), loadList()]);
    if (!mounted.current) return;
    setNote("");
    setMessage({ tone: "info", text: `Saved as version ${body.guide.version}. Agents follow it from their next step.` });
  });
  const restore = (version: number) => run("restore", async () => {
    if (!loaded) return;
    const body = await call<{ guide: BrandGuide }>(ENDPOINT, { method: "POST", body: JSON.stringify({ action: "restore", id: loaded.guide.id, version }) });
    await Promise.all([loadGuide(body.guide.id), loadList()]);
    if (mounted.current) setMessage({ tone: "info", text: `Version ${version} is back, saved as version ${body.guide.version}. Every earlier version stays in the history.` });
  });
  const create = (name: string) => run("create", async () => {
    if (!loaded) return;
    const id = brandGuideSlug(name);
    if (!id) throw new Error("Use a name with letters or numbers.");
    if (guides?.some(guide => guide.id === id)) throw new Error(`There's already a guide called ${name.trim()}. Pick another name.`);
    const start = { ...structuredClone(loaded.guide), id, name: name.trim(), source: "", examples: [], logos: loaded.guide.logos.filter(logo => logo.role === "topic") };
    const body = await call<{ guide: BrandGuide }>(ENDPOINT, { method: "PUT", body: JSON.stringify({ guide: start, expectedVersion: 0, note: `Started from ${loaded.guide.name}` }) });
    await loadList();
    if (!mounted.current) return;
    setCreating(null);
    setSelected(body.guide.id);
    setMessage({ tone: "info", text: `${body.guide.name} starts with ${loaded.guide.name}'s colors, type and rules. Change what's different and save.` });
  });
  const remove = () => run("delete", async () => {
    if (!loaded) return;
    await call(`${ENDPOINT}?id=${encodeURIComponent(loaded.guide.id)}`, { method: "DELETE" });
    const list = await loadList();
    if (!mounted.current) return;
    setLoaded(null);
    setDraft(null);
    setSelected(list[0]?.id ?? null);
    setMessage({ tone: "info", text: `${loaded.guide.name} was deleted.` });
  });
  const switchTemplate = (page: PageLine, templateId: string) => run("page", async () => {
    if (!loaded) return;
    await call("/api/engine/page-profiles", { method: "PUT", body: JSON.stringify({ profile: { id: page.id, templateId } }) });
    await loadGuide(loaded.guide.id);
    const name = templates.find(template => template.id === templateId)?.name ?? templateId;
    if (mounted.current) setMessage({ tone: "info", text: `${page.name} now uses ${name} for new posts. Posts already made keep their look.` });
  });

  function draftTemplate(language: GuideLanguage) {
    if (!loaded || !canEdit || dirty || !base) return;
    const guide = loaded.guide, baseTemplateId = base.id;
    const result: { template?: DesignTemplate; error?: string } = {};
    const accepted = onChange(current => {
      try {
        const start = libraryTemplates(current).find(template => template.id === baseTemplateId);
        if (!start) throw new Error("The template to start from wasn't found. Pick another one.");
        const next = designTemplateFromGuide(guide, start, { language });
        const existing = current.templates.find(template => template.id === next.id);
        if (!existing && current.templates.length >= 80) throw new Error("This workspace has 80 custom templates, the most it can hold. Delete one first.");
        result.template = { ...next, ...(existing?.folderId ? { folderId: existing.folderId } : {}), ...(existing?.favorite ? { favorite: existing.favorite } : {}) };
        return { ...current, templates: [result.template, ...current.templates.filter(template => template.id !== next.id)] };
      } catch (error) {
        result.error = errorText(error);
        throw error;
      }
    });
    if (accepted === false || !result.template) {
      setMessage({ tone: "error", text: result.error ?? "The draft couldn't be added to your templates. See the workspace message at the top." });
      return;
    }
    setDrafted({ name: result.template.name, issues: runGuideChecks(result.template, guide, { scope: "template", language }) });
    setMessage({ tone: "info", text: `${result.template.name} is in My templates. Open it to look it over, then pick it for a page.` });
  }

  if (!guides) return <div className="te-guide-panel">
    <p className="te-guide-muted" role="status">{message?.text ?? "Loading brand guides…"}</p>
    {message && <button className="te-button" onClick={() => { setMessage(null); setAttempt(value => value + 1); }}>Try again</button>}
  </div>;
  const guide = draft, saved = loaded?.guide;
  const listed = saved ? guides.find(item => item.id === saved.id) : undefined;
  return <div className="te-guide-panel">
    <div className="te-guide-list" aria-label="Brand guides">
      {guides.map(item => <button key={item.id} className={`te-guide-chip${item.id === selected ? " is-active" : ""}`} aria-pressed={item.id === selected} onClick={() => item.id !== selected && guarded(() => setSelected(item.id), "Opening another guide")}>
        <strong>{item.name}</strong><small>Version {item.version}{item.builtIn ? item.overridden ? " · edited built-in" : " · built in" : ""} · {item.checks} checks</small>
      </button>)}
      <button className="te-guide-chip te-guide-new" disabled={!canEdit || !loaded || guides.length >= 30} onClick={() => setCreating("")}><PlusIcon size={14} />New guide</button>
    </div>
    {message && <div className={`te-notice te-guide-notice${message.tone === "error" ? " is-error" : ""}`} role={message.tone === "error" ? "alert" : "status"}>
      <div><span>{message.text}</span>{message.issues && <ul>{message.issues.slice(0, 8).map(issue => <li key={issue}>{issue}</li>)}</ul>}</div>
      <span className="te-guide-notice-actions">
        {conflict && saved && <button className="te-button" onClick={() => { const id = saved.id; void run("guide", () => loadGuide(id)); }}>Load the newest version</button>}
        <button className="te-icon" aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button>
      </span>
    </div>}
    {!guide || !saved || !loaded ? <p className="te-guide-muted" role="status">Loading the guide…</p> : <div className="te-guide-layout" key={saved.id}>
      <aside className="te-guide-side">
        <section className="te-guide-card">
          <div className="te-brand-panel-title"><h2>Save</h2><span>{dirty ? "Unsaved changes" : `Version ${saved.version}`}</span></div>
          <label className="te-field">What changed<input value={note} maxLength={200} placeholder="Optional note for the history" disabled={!canEdit} onChange={event => setNote(event.target.value)} /></label>
          {problems.length > 0 && <div className="te-guide-problems" role="status"><strong>{problems.length === 1 ? "1 thing to fix before saving" : `${problems.length} things to fix before saving`}</strong><ul>{problems.slice(0, 6).map(problem => <li key={problem}>{problem}</li>)}</ul></div>}
          <div className="te-guide-actions">
            <button className="te-button te-primary" disabled={!canEdit || !dirty || problems.length > 0 || Boolean(busy)} onClick={save}>{busy === "save" ? "Saving…" : "Save as a new version"}</button>
            <button className="te-button" disabled={!dirty || Boolean(busy)} onClick={() => { setDraft(structuredClone(saved)); setDirty(false); }}>Discard</button>
          </div>
          <p className="te-guide-help">Agents read the saved version. Every save is kept, so nothing is lost.</p>
        </section>
        <section className="te-guide-card">
          <div className="te-brand-panel-title"><h2>History</h2><span>{loaded.versions.length} saved</span></div>
          <ol className="te-guide-versions">
            {loaded.versions.map((version, index) => <li key={`${version.version}-${index}`}>
              <div><strong>Version {version.version}</strong><small>{[when(version.updatedAt), version.savedBy === "agent" ? "by an agent" : "", version.note].filter(Boolean).join(" · ")}</small></div>
              {index === 0 ? <span className="te-guide-badge">Current</span> : <button className="te-text-button" disabled={!canEdit || Boolean(busy)} onClick={() => guarded(() => void restore(version.version), "Bringing back an earlier version")}>Bring back</button>}
            </li>)}
          </ol>
        </section>
        <section className="te-guide-card">
          <div className="te-brand-panel-title"><div><h2>Pages</h2><p>Pages whose profile names this brand. Their agents write and design to this guide.</p></div><span>{loaded.pages.length}</span></div>
          {loaded.pages.length ? <ul className="te-guide-pages">
            {loaded.pages.map(page => {
              const guideTemplate = guideTemplateId(saved.id, page.language), hasDraft = templates.some(template => template.id === guideTemplate);
              const current = page.templateId ? templates.find(template => template.id === page.templateId)?.name ?? page.templateId : "Default template";
              return <li key={page.id}>
                <div><strong>{page.name}</strong><small>@{page.handle} · {page.language === "es" ? "Spanish" : "English"} · {current}</small></div>
                {page.templateId === guideTemplate
                  ? <button className="te-text-button" disabled={!canEdit || Boolean(busy) || !base} onClick={() => base && void switchTemplate(page, base.id)}>Back to {base?.name ?? "the original"}</button>
                  : <button className="te-button" disabled={!canEdit || Boolean(busy) || !hasDraft} title={hasDraft ? undefined : `Draft the ${page.language === "es" ? "Spanish" : "English"} template first`} onClick={() => void switchTemplate(page, guideTemplate)}>Use the guide&apos;s template</button>}
              </li>;
            })}
          </ul> : <p className="te-guide-help">No page follows this guide yet.</p>}
        </section>
        <section className="te-guide-card">
          <div className="te-brand-panel-title"><div><h2>Templates from this guide</h2><p>A copy of a template in this guide&apos;s colors, type, margins and spacing, with the gradient, the cover remark and spots for topic logos. Reaction pages stay as they are.</p></div></div>
          <label className="te-field">Start from<select value={base?.id ?? ""} disabled={!canEdit} onChange={event => setBaseId(event.target.value)}>{bases.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <ul className="te-guide-pages">
            {LANGUAGES.map(([language, label]) => {
              const existing = templates.find(template => template.id === guideTemplateId(saved.id, language)), from = draftedFrom(existing, saved.id);
              return <li key={language}>
                <div><strong>{label}</strong><small>{!existing ? "Not drafted yet" : from && from < saved.version ? `From version ${from}: redraft for version ${saved.version}` : `From version ${from || saved.version}`}</small></div>
                <button className="te-button" disabled={!canEdit || dirty || Boolean(busy) || !base} title={dirty ? "Save the guide first" : undefined} onClick={() => draftTemplate(language)}>{existing ? "Redraft" : "Draft"}</button>
              </li>;
            })}
          </ul>
          {drafted && <div className="te-guide-checks">
            <strong>{drafted.issues.length ? `${drafted.name}: ${drafted.issues.length} guide ${drafted.issues.length === 1 ? "issue" : "issues"}` : `${drafted.name} passes the guide's checks`}</strong>
            {drafted.issues.length > 0 && <ul>{drafted.issues.slice(0, 8).map((issue, index) => <li key={index}>Slide {issue.slide}: {issue.problem}. {issue.fix}</li>)}</ul>}
          </div>}
        </section>
        <details className="te-guide-card te-guide-brief">
          <summary>What agents read</summary>
          <pre>{brief}</pre>
        </details>
        {listed && !listed.builtIn && <button className="te-text-button te-guide-delete" disabled={!canEdit || Boolean(busy)} onClick={() => setConfirm({ title: "Delete this guide?", text: `${saved.name} and its history will be deleted. Pages that name it keep only their own rules.`, label: "Delete guide", run: () => void remove() })}><TrashIcon size={14} />Delete guide</button>}
      </aside>
      <fieldset className="te-guide-main" disabled={!canEdit}>
        <Essentials guide={guide} edit={edit} />
        <Colors guide={guide} edit={edit} />
        <TextStyles guide={guide} edit={edit} />
        <Layout guide={guide} edit={edit} />
        <Images kind="logos" guide={guide} edit={edit} library={library} onMessage={setMessage} />
        <Images kind="examples" guide={guide} edit={edit} library={library} onMessage={setMessage} />
        <Rules guide={guide} edit={edit} />
        <Words guide={guide} edit={edit} />
      </fieldset>
    </div>}
    {creating !== null && <Modal title="New brand guide" onClose={() => setCreating(null)}>
      <form onSubmit={event => { event.preventDefault(); if (creating.trim()) void create(creating); }}>
        <p>The new guide starts as a copy of {saved?.name ?? "this guide"}. Change what&apos;s different for the new brand.</p>
        <label className="te-field">Brand name<input autoFocus required maxLength={GUIDE_LIMITS.name} value={creating} onChange={event => setCreating(event.target.value)} /></label>
        <div className="te-modal-actions"><button type="button" className="te-button" onClick={() => setCreating(null)}>Cancel</button><button className="te-button te-primary" disabled={!creating.trim() || Boolean(busy)}>Create guide</button></div>
      </form>
    </Modal>}
    {confirm && <Modal title={confirm.title} onClose={() => setConfirm(null)}>
      <p>{confirm.text}</p>
      <div className="te-modal-actions"><button className="te-button" onClick={() => setConfirm(null)}>Cancel</button><button className="te-button te-primary" onClick={() => { const next = confirm.run; setConfirm(null); next(); }}>{confirm.label}</button></div>
    </Modal>}
  </div>;
}

/* ─── Sections ───────────────────────────────────────────────────────────── */

function Section({ title, help, count, children }: { title: string; help?: string; count?: string; children: ReactNode }) {
  return <section className="te-guide-card">
    <div className="te-brand-panel-title"><div><h2>{title}</h2>{help && <p>{help}</p>}</div>{count && <span>{count}</span>}</div>
    {children}
  </section>;
}

/** A list edited as text (comma- or line-separated). Shows the saved list unless someone is typing. */
function ListField({ label, hint, value, separator, rows, max, maxItem, placeholder, onChange }: { label: string; hint?: string; value: string[]; separator: "," | "\n"; rows?: number; max: number; maxItem: number; placeholder?: string; onChange: (value: string[]) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  const shown = typing ?? value.join(separator === "," ? ", " : "\n");
  const commit = (text: string) => { setTyping(text); onChange(text.split(separator).map(item => item.trim().slice(0, maxItem)).filter(Boolean).slice(0, max)); };
  return <label className="te-field">{label}{hint && <small>{hint}</small>}
    {rows ? <textarea rows={rows} value={shown} placeholder={placeholder} onFocus={() => setTyping(shown)} onBlur={() => setTyping(null)} onChange={event => commit(event.target.value)} />
      : <input value={shown} placeholder={placeholder} onFocus={() => setTyping(shown)} onBlur={() => setTyping(null)} onChange={event => commit(event.target.value)} />}
  </label>;
}

function HexField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [typing, setTyping] = useState<string | null>(null);
  return <span className="te-guide-hex">
    <input type="color" aria-label={label} value={HEX.test(value) ? value.toLowerCase() : "#000000"} onChange={event => onChange(event.target.value.toUpperCase())} />
    <input aria-label={`${label} hex`} value={typing ?? value} maxLength={7} spellCheck={false} onFocus={() => setTyping(value)} onBlur={() => setTyping(null)}
      onChange={event => { const next = event.target.value.trim(); setTyping(next); if (HEX.test(next)) onChange(next.toUpperCase()); }} />
  </span>;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="te-icon te-guide-remove" aria-label={label} title={label} onClick={onClick}>×</button>;
}

function Essentials({ guide, edit }: { guide: BrandGuide; edit: Edit }) {
  return <Section title="Brand essentials" help="Who the brand is for and how it sounds. Every agent reads this first.">
    <div className="te-guide-grid">
      <label className="te-field">Name<input value={guide.name} maxLength={GUIDE_LIMITS.name} onChange={event => edit(g => ({ ...g, name: event.target.value }))} /></label>
      <label className="te-field">Source<input value={guide.source} maxLength={GUIDE_LIMITS.source} placeholder="Where this guide comes from" onChange={event => edit(g => ({ ...g, source: event.target.value }))} /></label>
    </div>
    <label className="te-field">Purpose<textarea rows={3} value={guide.purpose} maxLength={GUIDE_LIMITS.purpose} onChange={event => edit(g => ({ ...g, purpose: event.target.value }))} /></label>
    <label className="te-field">Personality<input value={guide.personality} maxLength={GUIDE_LIMITS.personality} onChange={event => edit(g => ({ ...g, personality: event.target.value }))} /></label>
    <h3 className="te-guide-subhead">Principles <small>{guide.principles.length}/{GUIDE_LIMITS.principles}</small></h3>
    <div className="te-guide-rows">
      {guide.principles.map((principle, index) => <div className="te-guide-row" key={index}>
        <input aria-label={`Principle ${index + 1} name`} className="te-guide-narrow" value={principle.name} maxLength={GUIDE_LIMITS.principleName} placeholder="Name" onChange={event => edit(g => ({ ...g, principles: replaceAt(g.principles, index, { name: event.target.value }) }))} />
        <input aria-label={`Principle ${index + 1}`} value={principle.text} maxLength={GUIDE_LIMITS.principleText} placeholder="What it means" onChange={event => edit(g => ({ ...g, principles: replaceAt(g.principles, index, { text: event.target.value }) }))} />
        <RemoveButton label={`Remove principle ${index + 1}`} onClick={() => edit(g => ({ ...g, principles: removeAt(g.principles, index) }))} />
      </div>)}
    </div>
    <button type="button" className="te-text-button" disabled={guide.principles.length >= GUIDE_LIMITS.principles} onClick={() => edit(g => ({ ...g, principles: [...g.principles, { name: "", text: "" }] }))}><PlusIcon size={14} />Add principle</button>
  </Section>;
}

function Colors({ guide, edit }: { guide: BrandGuide; edit: Edit }) {
  const gradient = guide.accentGradient;
  return <Section title="Colors" help="Each color's job. A guide needs a background, a text and an accent color." count={`${guide.colors.length}/${GUIDE_LIMITS.colors}`}>
    <div className="te-guide-rows">
      {guide.colors.map((color, index) => <div className="te-guide-row" key={color.id}>
        <HexField label={`${color.name || "Color"} value`} value={color.value} onChange={value => edit(g => ({ ...g, colors: replaceAt(g.colors, index, { value }) }))} />
        <input aria-label={`Color ${index + 1} name`} className="te-guide-narrow" value={color.name} maxLength={GUIDE_LIMITS.colorName} placeholder="Name" onChange={event => edit(g => ({ ...g, colors: replaceAt(g.colors, index, { name: event.target.value }) }))} />
        <select aria-label={`Color ${index + 1} role`} value={color.role} onChange={event => edit(g => ({ ...g, colors: replaceAt(g.colors, index, { role: event.target.value as GuideColorRole }) }))}>{COLOR_ROLES.map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select>
        <input aria-label={`Color ${index + 1} use`} value={color.use} maxLength={GUIDE_LIMITS.colorUse} placeholder="Where it's used" onChange={event => edit(g => ({ ...g, colors: replaceAt(g.colors, index, { use: event.target.value }) }))} />
        <RemoveButton label={`Remove ${color.name || "color"}`} onClick={() => edit(g => ({ ...g, colors: removeAt(g.colors, index) }))} />
      </div>)}
    </div>
    <button type="button" className="te-text-button" disabled={guide.colors.length >= GUIDE_LIMITS.colors} onClick={() => edit(g => ({ ...g, colors: [...g.colors, { id: newId("color"), role: "other", name: "", value: "#FFFFFF", use: "" }] }))}><PlusIcon size={14} />Add color</button>
    <h3 className="te-guide-subhead">Accent gradient</h3>
    <div className="te-guide-row">
      <label className="te-guide-check"><input type="checkbox" checked={Boolean(gradient)} onChange={event => edit(g => ({ ...g, accentGradient: event.target.checked ? { from: g.colors.find(color => color.role === "accent")?.value ?? "#00D98A", to: g.colors.find(color => color.role === "accent-end")?.value ?? "#32FFBB", angle: 180 } : null }))} />Fill accent words with a gradient, top to bottom</label>
      {gradient && <>
        <HexField label="Gradient top" value={gradient.from} onChange={from => edit(g => ({ ...g, accentGradient: g.accentGradient && { ...g.accentGradient, from } }))} />
        <HexField label="Gradient bottom" value={gradient.to} onChange={to => edit(g => ({ ...g, accentGradient: g.accentGradient && { ...g.accentGradient, to } }))} />
        <span className="te-guide-swatch" style={{ backgroundImage: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})` }} aria-hidden />
      </>}
    </div>
  </Section>;
}

function TextStyles({ guide, edit }: { guide: BrandGuide; edit: Edit }) {
  const set = (index: number, change: Partial<GuideTextStyle>) => edit(g => ({ ...g, text: replaceAt(g.text, index, change) }));
  const background = guide.colors.find(color => color.role === "background")?.value;
  return <Section title="Type" help="Sizes are pixels on the full-size post (1080 wide on Instagram)." count={`${guide.text.length}/${GUIDE_LIMITS.text}`}>
    <div className="te-guide-styles">
      {guide.text.map((style, index) => {
        const gradient = style.fill === "accent-gradient" ? guide.accentGradient : null;
        return <div className="te-guide-style" key={style.id}>
          <div className="te-guide-style-head">
            <input aria-label={`Style ${index + 1} name`} value={style.name} maxLength={GUIDE_LIMITS.textName} placeholder="Name" onChange={event => set(index, { name: event.target.value })} />
            <select aria-label={`${style.name || "Style"} role`} value={style.role} onChange={event => set(index, { role: event.target.value as GuideTextRole })}>{TEXT_ROLES.map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select>
            <RemoveButton label={`Remove ${style.name || "style"}`} onClick={() => edit(g => ({ ...g, text: removeAt(g.text, index) }))} />
          </div>
          <div className="te-guide-specimen" style={{ backgroundColor: background }}>
            <span className={`gf-font-${style.font}`} style={{
              fontSize: Math.min(34, Math.max(12, style.size / 3)), fontWeight: style.weight, lineHeight: style.lineHeight, letterSpacing: `${style.tracking}em`,
              textTransform: style.case === "upper" ? "uppercase" : undefined,
              ...(gradient ? { backgroundImage: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } : { color: guide.colors.find(color => color.role === style.color)?.value }),
            }}>{style.role === "source" ? "Source: the original study" : style.role === "cover" || style.case === "upper" ? "The cover tells the story" : "One clear idea per slide"}</span>
          </div>
          <div className="te-guide-grid te-guide-grid-4">
            <label className="te-field">Typeface<select value={style.font} onChange={event => set(index, { font: event.target.value })}>{GUIDE_FONT_IDS.map(font => <option key={font} value={font}>{fontLabel(font)}</option>)}</select></label>
            <NumberField label="Size" unit="px" value={style.size} min={8} max={400} onChange={size => set(index, { size })} />
            <NumberField label="Weight" value={style.weight} min={100} max={900} step={100} onChange={weight => set(index, { weight })} />
            <NumberField label="Line height" value={style.lineHeight} min={0.5} max={3} step={0.01} onChange={lineHeight => set(index, { lineHeight })} />
            <NumberField label="Tracking" unit="em" value={style.tracking} min={-0.2} max={0.5} step={0.001} onChange={tracking => set(index, { tracking })} />
            <label className="te-field">Case<select value={style.case} onChange={event => set(index, { case: event.target.value as GuideTextStyle["case"] })}><option value="sentence">Sentence case</option><option value="upper">Capitals</option><option value="as-written">As written</option></select></label>
            <label className="te-field">Color<select value={style.color} onChange={event => set(index, { color: event.target.value as GuideColorRole })}>{COLOR_ROLES.map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
            <label className="te-field">Fill<select value={style.fill} onChange={event => set(index, { fill: event.target.value as GuideTextStyle["fill"] })}><option value="solid">Solid color</option><option value="accent-gradient">Accent gradient</option></select></label>
          </div>
          <input aria-label={`${style.name || "Style"} note`} value={style.note} maxLength={GUIDE_LIMITS.textNote} placeholder="Note, such as where it sits" onChange={event => set(index, { note: event.target.value })} />
        </div>;
      })}
    </div>
    <button type="button" className="te-text-button" disabled={guide.text.length >= GUIDE_LIMITS.text} onClick={() => edit(g => ({ ...g, text: [...g.text, { id: newId("style"), role: "other", name: "", font: "sfpro", size: 40, weight: 400, lineHeight: 1.2, tracking: 0, case: "as-written", color: "text", fill: "solid", note: "" }] }))}><PlusIcon size={14} />Add text style</button>
  </Section>;
}

function Layout({ guide, edit }: { guide: BrandGuide; edit: Edit }) {
  const { layout } = guide;
  const set = (change: Partial<BrandGuide["layout"]>) => edit(g => ({ ...g, layout: { ...g.layout, ...change } }));
  return <Section title="Layout" help={`Text is ${layout.width - layout.marginLeft - layout.marginRight} px wide inside the margins.`}>
    <div className="te-guide-grid te-guide-grid-4">
      <NumberField label="Width" unit="px" value={layout.width} min={100} max={10000} onChange={width => set({ width })} />
      <NumberField label="Height" unit="px" value={layout.height} min={100} max={10000} onChange={height => set({ height })} />
      <NumberField label="Left margin" unit="px" value={layout.marginLeft} min={0} max={1000} onChange={marginLeft => set({ marginLeft })} />
      <NumberField label="Right margin" unit="px" value={layout.marginRight} min={0} max={1000} onChange={marginRight => set({ marginRight })} />
      <NumberField label="Top margin" unit="px" value={layout.marginTop} min={0} max={1000} onChange={marginTop => set({ marginTop })} />
      <NumberField label="Bottom margin" unit="px" value={layout.marginBottom} min={0} max={1000} onChange={marginBottom => set({ marginBottom })} />
      <NumberField label="Title to text" unit="px" value={layout.titleBodyGap} min={0} max={400} onChange={titleBodyGap => set({ titleBodyGap })} />
      <NumberField label="Text to media" unit="px" value={layout.headerContentGap} min={0} max={400} onChange={headerContentGap => set({ headerContentGap })} />
      <NumberField label="Smallest text" unit="px" value={layout.minTextSize} min={6} max={200} onChange={minTextSize => set({ minTextSize })} />
      <label className="te-field">Photos and video<select value={layout.media} onChange={event => set({ media: event.target.value as BrandGuide["layout"]["media"] })}><option value="natural">Keep their own shape</option><option value="fill">Fill their frame</option></select></label>
    </div>
  </Section>;
}

function Images({ kind, guide, edit, library, onMessage }: { kind: "logos" | "examples"; guide: BrandGuide; edit: Edit; library: EditorLibrary; onMessage: (message: Message) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pick, setPick] = useState("");
  const items: (GuideLogo | GuideExample)[] = kind === "logos" ? guide.logos : guide.examples;
  const max = kind === "logos" ? GUIDE_LIMITS.logos : GUIDE_LIMITS.examples;
  const kitLogos = kind === "logos" ? libraryBrandKits(library).flatMap(kit => kit.assets.filter(asset => asset.kind === "logo").map(asset => ({ key: `${kit.id}:${asset.id}`, kit, asset }))) : [];
  const add = (images: GuideImage[]) => edit(g => kind === "logos"
    ? { ...g, logos: [...g.logos, ...images.map(image => ({ ...image, role: "topic" as const, topics: [image.name], note: "" }))].slice(0, max) }
    : { ...g, examples: [...g.examples, ...images.map(image => ({ ...image, note: "" }))].slice(0, max) });
  const setLogo = (index: number, change: Partial<GuideLogo>) => edit(g => ({ ...g, logos: replaceAt(g.logos, index, change) }));
  const setItem = (index: number, change: { name?: string; note?: string }) => edit(g => kind === "logos" ? { ...g, logos: replaceAt(g.logos, index, change) } : { ...g, examples: replaceAt(g.examples, index, change) });
  const removeItem = (index: number) => edit(g => kind === "logos" ? { ...g, logos: removeAt(g.logos, index) } : { ...g, examples: removeAt(g.examples, index) });
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (items.length + files.length > max) { onMessage({ tone: "error", text: `A guide keeps up to ${max} ${kind === "logos" ? "logos" : "example posts"}. Choose fewer files.` }); return; }
    setUploading(true);
    try {
      const images: GuideImage[] = [];
      for (const file of files) images.push(await prepareGuideImage(file));
      add(images);
    } catch (error) {
      onMessage({ tone: "error", text: errorText(error) });
    } finally {
      setUploading(false);
    }
  }
  return <Section title={kind === "logos" ? "Logos" : "Example posts"} count={`${items.length}/${max}`} help={kind === "logos"
    ? "The brand's own logos, and topic logos: when a cover names a topic (such as Claude), its logo can sit over the cover photo."
    : "Approved posts. The design critic compares new slides with the first three."}>
    {items.length ? <div className={`te-guide-images${kind === "examples" ? " is-posts" : ""}`}>
      {items.map((item, index) => {
        const logo = kind === "logos" ? guide.logos[index] : undefined;
        return <article className="te-guide-image" key={item.id}>
          <div className="te-guide-image-art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proxied(item.previewSrc ?? item.src)} alt={item.name} loading="lazy" />
            <RemoveButton label={`Remove ${item.name}`} onClick={() => removeItem(index)} />
          </div>
          <input aria-label={`${item.name} name`} value={item.name} maxLength={GUIDE_LIMITS.imageName} onChange={event => setItem(index, { name: event.target.value })} />
          {logo && <>
            <select aria-label={`${item.name} kind`} value={logo.role} onChange={event => setLogo(index, { role: event.target.value as GuideLogo["role"] })}><option value="brand">Brand logo</option><option value="topic">Topic logo</option></select>
            {logo.role === "topic" && <ListField label="Stands for" value={logo.topics} separator="," max={GUIDE_LIMITS.topics} maxItem={GUIDE_LIMITS.topic} placeholder="Claude, Anthropic" onChange={topics => setLogo(index, { topics })} />}
          </>}
          <textarea aria-label={`${item.name} note`} rows={2} value={item.note} maxLength={GUIDE_LIMITS.imageNote} placeholder={kind === "logos" ? "When to use it" : "What makes it right"} onChange={event => setItem(index, { note: event.target.value })} />
        </article>;
      })}
    </div> : <div className="te-guide-empty"><ImageIcon size={26} /><p>{kind === "logos" ? "No logos yet" : "No example posts yet"}</p></div>}
    <div className="te-guide-actions">
      <button type="button" className="te-button" disabled={uploading || items.length >= max} onClick={() => fileRef.current?.click()}><ImageIcon />{uploading ? "Uploading…" : kind === "logos" ? "Upload logos" : "Upload examples"}</button>
      {kitLogos.length > 0 && <span className="te-guide-pick">
        <select aria-label="Logo from a brand kit" value={pick} onChange={event => setPick(event.target.value)}><option value="">From a brand kit…</option>{kitLogos.map(({ key, kit, asset }) => <option key={key} value={key}>{kit.name} · {asset.name}</option>)}</select>
        <button type="button" className="te-button" disabled={!pick || items.length >= max} onClick={() => {
          const found = kitLogos.find(item => item.key === pick);
          if (!found) return;
          add([{ id: newId("logo"), name: found.asset.name.replace(/\.[a-z0-9]+$/i, "").slice(0, GUIDE_LIMITS.imageName) || "Logo", src: found.asset.src, ...(found.asset.previewSrc ? { previewSrc: found.asset.previewSrc } : {}), width: found.asset.width, height: found.asset.height }]);
          setPick("");
        }}>Add</button>
      </span>}
    </div>
    <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={upload} />
  </Section>;
}

function Rules({ guide, edit }: { guide: BrandGuide; edit: Edit }) {
  const [area, setArea] = useState<GuideRuleArea | "all">("all");
  const shown = guide.rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => area === "all" || rule.area === area);
  const setCheck = (index: number, check: string) => edit(g => ({ ...g, rules: g.rules.map((rule, i) => {
    if (i !== index) return rule;
    const next = { ...rule };
    if (check) next.check = check as GuideCheckKind;
    else delete next.check;
    return next;
  }) }));
  return <Section title="Rules" help="Writers and designers follow every rule. Checked rules are also measured on every post: by code where a check exists, otherwise by the critic." count={`${guide.rules.length}/${GUIDE_LIMITS.rules}`}>
    <div className="te-brand-asset-filters te-guide-filters" role="group" aria-label="Rule area">
      {([["all", "All"], ...AREAS] as [GuideRuleArea | "all", string][]).map(([id, label]) => <button type="button" key={id} className={area === id ? "is-active" : ""} aria-pressed={area === id} onClick={() => setArea(id)}>{label} <small>{id === "all" ? guide.rules.length : guide.rules.filter(rule => rule.area === id).length}</small></button>)}
    </div>
    <div className="te-guide-rules">
      {shown.map(({ rule, index }) => <div className="te-guide-rule" key={rule.id}>
        <textarea aria-label={`Rule ${index + 1}`} rows={2} value={rule.text} maxLength={GUIDE_LIMITS.rule} onChange={event => edit(g => ({ ...g, rules: replaceAt(g.rules, index, { text: event.target.value }) }))} />
        <div className="te-guide-rule-meta">
          <select aria-label={`Rule ${index + 1} area`} value={rule.area} onChange={event => edit(g => ({ ...g, rules: replaceAt(g.rules, index, { area: event.target.value as GuideRuleArea }) }))}>{AREAS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          <label className="te-guide-check"><input type="checkbox" checked={rule.use === "check"} onChange={event => edit(g => ({ ...g, rules: replaceAt(g.rules, index, { use: event.target.checked ? "check" : "guide" }) }))} />Checked on every post</label>
          {rule.use === "check" && <select aria-label={`Rule ${index + 1} check`} value={rule.check ?? ""} onChange={event => setCheck(index, event.target.value)}><option value="">The critic checks it</option>{GUIDE_CHECK_KINDS.map(check => <option key={check} value={check}>Code: {GUIDE_CHECKS[check].label}</option>)}</select>}
          <RemoveButton label={`Remove rule ${index + 1}`} onClick={() => edit(g => ({ ...g, rules: removeAt(g.rules, index) }))} />
        </div>
      </div>)}
    </div>
    <button type="button" className="te-text-button" disabled={guide.rules.length >= GUIDE_LIMITS.rules} onClick={() => edit(g => ({ ...g, rules: [...g.rules, { id: newId("rule"), area: area === "all" ? "writing" : area, text: "", use: "guide" }] }))}><PlusIcon size={14} />Add rule</button>
  </Section>;
}

function Words({ guide, edit }: { guide: BrandGuide; edit: Edit }) {
  return <Section title="Headlines and hooks" help="How cover hooks get written, and what our headlines never say.">
    <label className="te-field">How hooks are written<select value={guide.hooks.method} onChange={event => edit(g => ({ ...g, hooks: { ...g.hooks, method: event.target.value as BrandGuide["hooks"]["method"] } }))}><option value="headline-engine">Headline engine: proven covers and formulas</option><option value="plain">Plain: the page&apos;s voice only</option></select></label>
    <ListField label="Hook notes" hint="one per line" rows={5} separator={"\n"} value={guide.hooks.notes} max={GUIDE_LIMITS.hookNotes} maxItem={GUIDE_LIMITS.hookNote} onChange={notes => edit(g => ({ ...g, hooks: { ...g.hooks, notes } }))} />
    <ListField label="Never in our headlines" hint="one per line" rows={4} separator={"\n"} value={guide.bannedWords} max={GUIDE_LIMITS.bannedWords} maxItem={GUIDE_LIMITS.bannedWord} onChange={bannedWords => edit(g => ({ ...g, bannedWords }))} />
  </Section>;
}
