"use client";

import {Fragment, useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject} from "react";
import {CheckIcon, CloseIcon, CommentIcon, CopyIcon, ImageIcon, PaperclipIcon, SparkleIcon, SpeakerIcon} from "@/components/engine/icons";
import type {ChatCard, ChatMessage, ChatPerson, ChatPhoto} from "@/lib/engine/assistant/threads";
import {activityOf, answerItems, duration, foldAnswer, readChatEvents, settleMessage, upsertMessage, withChatEvent, type AnswerItem, type ChatStepPart, type ChatStreamEvent} from "@/lib/engine/assistant/chat-stream";
import {actOnRecreate, fetchRecreateJob, MAX_HOOK_CHARACTERS, prepareRecreateUpload, RECREATE_LANES, RECREATE_STATUS_LABELS, RecreateRequestError, type HookOption, type RecreateJob} from "./recreate-job";
import "./assistant-panel.css";

/**
 * Engine chat: a panel beside the library and the editor where a person talks
 * to Claude. It starts Recreate runs, follows them on cards, and changes the
 * open post through the editor (each reply's edits are one undo step). A post's
 * chat is shared with the team; with no post open, the chat is the person's own.
 * See docs/assistant.md.
 */

export type ChatEditResult = {applied: true} | {applied: false; error: string};
export type ChatTurn = {deckName?: string; slide?: number; slideCount?: number; selection?: {id: string; name?: string; type?: string}[]};
/** What the open editor lends the chat: its post, edits applied as one undo step, and where the person is. */
export type ChatEditorBridge = {deckId: string; apply: (operations: unknown[]) => ChatEditResult; turn: () => ChatTurn};

const ENDPOINT = "/api/engine/assistant";
const SESSION_KEY = "engine.chat.session", PREFS_KEY = "engine.chat.prefs";
const HOME = "home";
const MAX_ATTACHMENTS = 10;
const HOLD_MS = 350;

type Prefs = {lang: "en-US" | "es-ES"; speak: boolean};
type Attachment = {id: string; name: string; dataUrl: string};
type Thread = {messages: ChatMessage[]; answering: boolean; loaded: boolean; error?: string};
type StreamEvent = ChatStreamEvent;
type Live = {key: string; deckId: string | null; controller: AbortController; localId: string; replyId?: string; sent: Attachment[]};

const EMPTY_THREAD: Thread = {messages: [], answering: false, loaded: false};
const subscribeNothing = () => () => {};

// ---- browser helpers -------------------------------------------------------

let memorySession = "";
/** A stable id for this browser, so a local dev server tells people apart. */
function browserSession(): string {
  try {
    const saved = window.localStorage.getItem(SESSION_KEY);
    if (saved && /^[A-Za-z0-9-]{8,80}$/.test(saved)) return saved;
    const created = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return memorySession ||= crypto.randomUUID();
  }
}
function readPrefs(): Prefs {
  let lang: Prefs["lang"] = "en-US";
  try { if (navigator.language.toLowerCase().startsWith("es")) lang = "es-ES"; } catch { /* no navigator while rendering on the server */ }
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    return {lang: saved?.lang === "es-ES" || saved?.lang === "en-US" ? saved.lang : lang, speak: saved?.speak === true};
  } catch {
    return {lang, speak: false};
  }
}
function savePrefs(prefs: Prefs) {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode: the choice lasts this visit */ }
}

type RecognitionResult = {isFinal: boolean; 0: {transcript: string}};
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((event: {resultIndex: number; results: ArrayLike<RecognitionResult>}) => void) | null;
  onerror: ((event: {error: string}) => void) | null;
  onend: (() => void) | null;
};
function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition};
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}
const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/** Reads an answer aloud (not what Claude said while working), in Spanish when it's written in Spanish. */
function speak(message: ChatMessage, fallback: Prefs["lang"]) {
  if (!canSpeak()) return;
  const words = foldAnswer(message).shown.flatMap(item => item.kind === "text" ? [item.text] : []).join("\n")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/[*`#>]+/g, "").trim();
  if (!words) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(words.slice(0, 4000));
  utterance.lang = /[ñ¿¡áéíóú]/i.test(words) ? "es-ES" : /\b(the|and|is|you|this)\b/i.test(words) ? "en-US" : fallback;
  window.speechSynthesis.speak(utterance);
}

async function errorOf(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as {error?: unknown} | null;
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

// ---- text ------------------------------------------------------------------

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"')\]]+)/g;
const LIST_ITEM = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;
function shortUrl(url: string) {
  try { const parsed = new URL(url); return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.length > 1 ? parsed.pathname.slice(0, 24) + (parsed.pathname.length > 24 ? "…" : "") : ""}`; } catch { return url; }
}
function inline(text: string, base: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0, index = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0], at = match.index ?? 0, key = `${base}-${index++}`;
    if (at > last) nodes.push(text.slice(last, at));
    if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      nodes.push(<a key={key} href={token.slice(split + 2, -1)} target="_blank" rel="noreferrer noopener">{token.slice(1, split)}</a>);
    } else {
      const url = token.replace(/[.,;:!?]+$/, "");
      nodes.push(<a key={key} href={url} target="_blank" rel="noreferrer noopener">{shortUrl(url)}</a>);
      if (url.length < token.length) nodes.push(token.slice(url.length));
    }
    last = at + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
/** Paragraphs, lists, bold, code and links: the little Markdown Claude writes in short replies. */
function RichText({text}: {text: string}) {
  const blocks: ReactNode[] = [];
  text.trim().split(/\n{2,}/).forEach((block, b) => {
    const lines = block.split("\n");
    let run: string[] = [], list = false;
    const flush = (key: string) => {
      if (!run.length) return;
      if (list) {
        const ordered = /^\s*\d/.test(run[0]);
        const items = run.map((line, i) => <li key={i}>{inline(line.replace(LIST_ITEM, ""), `${key}-${i}`)}</li>);
        blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      } else {
        blocks.push(<p key={key}>{run.map((line, i) => <Fragment key={i}>{i > 0 && <br/>}{inline(line.replace(/^#{1,4}\s+/, ""), `${key}-${i}`)}</Fragment>)}</p>);
      }
      run = [];
    };
    lines.forEach((line, i) => {
      const item = LIST_ITEM.test(line);
      if (run.length && item !== list) flush(`${b}-${i}`);
      list = item;
      run.push(line);
    });
    flush(`${b}-end`);
  });
  return <>{blocks}</>;
}
const timeOf = (at: string) => { const date = new Date(at); return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}); };

/** One clock for the live timers, ticking only while one is on screen. */
const clock = {now: 0, timer: undefined as ReturnType<typeof setInterval> | undefined, listeners: new Set<() => void>()};
function subscribeClock(listener: () => void) {
  clock.listeners.add(listener);
  if (!clock.timer) {
    clock.now = Date.now();
    clock.timer = setInterval(() => { clock.now = Date.now(); for (const notify of clock.listeners) notify(); }, 1000);
  }
  return () => {
    clock.listeners.delete(listener);
    if (!clock.listeners.size && clock.timer) { clearInterval(clock.timer); clock.timer = undefined; }
  };
}
const clockNow = () => clock.now;
const noClock = () => 0;
/** How long since `since`, counting up. */
function Elapsed({since}: {since: string}) {
  const now = useSyncExternalStore(subscribeClock, clockNow, noClock), start = Date.parse(since);
  if (!now || Number.isNaN(start)) return null;
  return <span className="te-chat-elapsed" aria-hidden>{duration(now - start)}</span>;
}

// ---- cards -----------------------------------------------------------------

const HOOK_BY: Record<HookOption["by"], string> = {"headline-model": "Headline model", copywriter: "Copywriter", agent: "Agent"};
const settled = (job: RecreateJob) => job.status === "done" || job.status === "error";
/** "Researching · Checking the facts", without saying the same thing twice ("Importing the post from Instagram"). */
function statusLine(job: RecreateJob) {
  const label = RECREATE_STATUS_LABELS[job.status], detail = settled(job) ? "" : job.message.trim();
  if (!detail) return label;
  return detail.toLowerCase().startsWith(label.toLowerCase()) ? detail : `${label} · ${detail}`;
}

function RunCard({card, openDeckId, onOpenDesign}: {card: Extract<ChatCard, {type: "run"}>; openDeckId: string | null; onOpenDesign: (deckId: string) => void}) {
  const [job, setJob] = useState<RecreateJob | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await fetchRecreateJob(card.jobId, controller.signal);
        if (controller.signal.aborted) return;
        setJob(next); setProblem("");
        if (!settled(next)) timer = setTimeout(load, next.status === "paused" ? 8000 : 3500);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProblem(error instanceof Error ? error.message : "This run couldn't be loaded.");
        // A run that's gone stays gone; anything else is worth another look.
        if (!(error instanceof RecreateRequestError && error.status === 404)) timer = setTimeout(load, 15000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [card.jobId, round]);

  async function act(action: Parameters<typeof actOnRecreate>[1]) {
    setBusy(true); setProblem("");
    try {
      const next = await actOnRecreate(card.jobId, action);
      if (next) setJob(next);
      setRound(value => value + 1);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function ownHook(event: FormEvent) {
    event.preventDefault();
    if (own.trim()) void act({action: "approve", hook: {text: own.trim()}});
  }

  const result = job?.result, checkpoint = job?.status === "paused" ? job.checkpoint : undefined;
  return <div className={`te-chat-card te-chat-run is-${job?.status ?? "loading"}`}>
    <div className="te-chat-card-head">
      <SparkleIcon size={14}/><strong>Recreate</strong><span title={card.label}>{card.label}</span>
      <em>{card.mode === "autopilot" ? "Autopilot" : card.mode === "exact" ? "Exact copy" : "Checkpoint"}</em>
    </div>
    {job ? <>
      <p className="te-chat-run-status" data-status={job.status}>
        {!settled(job) && job.status !== "paused" && <span className="te-chat-spinner" aria-hidden/>}
        {statusLine(job)}
      </p>
      <div className="te-chat-lanes" aria-hidden>{RECREATE_LANES.map(lane => <div key={lane.title} className="te-chat-lane">
        <span>{lane.title}</span>
        <div>{lane.stages.map(stage => {
          const view = job.stages.find(item => item.stage === stage);
          return <i key={stage} data-status={view?.status ?? "pending"} title={`${view?.title ?? stage}: ${view?.status ?? "pending"}`}/>;
        })}</div>
      </div>)}</div>
      {checkpoint && <div className="te-chat-checkpoint">
        <p>{checkpoint.slides.length} slides planned{checkpoint.brief?.angle ? `: ${checkpoint.brief.angle}` : "."} Tap a hook to approve the plan, or tell me what to change.</p>
        <ol className="te-chat-hooks">{checkpoint.hooks.map((hook, index) => <li key={index}>
          <button type="button" disabled={busy} onClick={() => void act({action: "approve", hook: {option: index}})}>
            <span>{hook.text}</span>
            {hook.english && <small>{hook.english}</small>}
            <em>{HOOK_BY[hook.by] ?? hook.by}</em>
          </button>
        </li>)}</ol>
        <form className="te-chat-own-hook" onSubmit={ownHook}>
          <input value={own} maxLength={MAX_HOOK_CHARACTERS} disabled={busy} aria-label="Your own hook" placeholder="Or write your own hook" onChange={event => setOwn(event.target.value)}/>
          <button type="submit" className="te-button" disabled={busy || !own.trim()}>Use</button>
        </form>
      </div>}
      {job.status === "done" && result && <div className="te-chat-run-done">
        <div><strong>{result.name}</strong><small>{result.slideCount === 1 ? "1 slide" : `${result.slideCount} slides`}{result.review?.open.length ? ` · ${result.review.open.length} notes from review` : ""}</small></div>
        <button type="button" className="te-button te-primary" disabled={openDeckId === result.deckId} onClick={() => onOpenDesign(result.deckId)}>{openDeckId === result.deckId ? "Open now" : "Open post"}</button>
      </div>}
      {job.status === "error" && <div className="te-chat-run-error">
        <p>{job.error || "The run stopped."}</p>
        {job.resumable && <button type="button" className="te-button" disabled={busy} onClick={() => void act({action: "resume"})}>Resume</button>}
      </div>}
    </> : <p className="te-chat-run-status">{problem || <><span className="te-chat-spinner" aria-hidden/>Loading the run…</>}</p>}
    {job && problem && <small className="te-chat-card-problem" role="alert">{problem}</small>}
  </div>;
}

function PhotosCard({card, canPlace, onPlace}: {card: Extract<ChatCard, {type: "photos"}>; canPlace: boolean; onPlace: (photo: ChatPhoto) => ChatEditResult}) {
  const [placed, setPlaced] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  return <div className="te-chat-card">
    <div className="te-chat-card-head"><ImageIcon size={14}/><strong>Photos</strong><span title={card.search}>{card.search}</span></div>
    <div className="te-chat-photos">{card.photos.map(photo => <button key={photo.url} type="button" disabled={!canPlace} aria-pressed={placed === photo.url} title={photo.description || "Photo"}
      aria-label={canPlace ? `Place this photo${photo.description ? `: ${photo.description}` : ""}` : photo.description || "Photo"}
      onClick={() => { const result = onPlace(photo); if (result.applied) { setPlaced(photo.url); setProblem(""); } else setProblem(result.error); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt="" loading="lazy" referrerPolicy="no-referrer"/>
      {placed === photo.url && <span className="te-chat-photo-check"><CheckIcon size={14}/></span>}
    </button>)}</div>
    <small className="te-chat-card-foot">{canPlace ? "Tap a photo to put it on the slide." : card.target ? "Open the post to place one here, or ask me to." : "Ask me to place one."}</small>
    {problem && <small className="te-chat-card-problem" role="alert">{problem}</small>}
  </div>;
}

function HooksCard({card}: {card: Extract<ChatCard, {type: "hooks"}>}) {
  const [copied, setCopied] = useState<number | null>(null);
  return <div className="te-chat-card">
    <div className="te-chat-card-head"><SparkleIcon size={14}/><strong>Hook options</strong></div>
    <ol className="te-chat-hook-list">{card.options.map((option, index) => <li key={index}>
      <div><span>{option.text}</span>{option.note && <small>{option.note}</small>}</div>
      <button type="button" className="te-icon" aria-label={`Copy hook ${index + 1}`} title="Copy" onClick={() => { void navigator.clipboard?.writeText(option.text).then(() => setCopied(index), () => undefined); }}>
        {copied === index ? <CheckIcon size={15}/> : <CopyIcon size={15}/>}
      </button>
    </li>)}</ol>
  </div>;
}

function EditsCard({card}: {card: Extract<ChatCard, {type: "edits"}>}) {
  return <div className="te-chat-card te-chat-edits">
    <div className="te-chat-card-head"><CheckIcon size={14}/><strong>{card.changes.length === 1 ? "1 change" : `${card.changes.length} changes`}</strong>
      <span>{card.applied === "editor" ? "Undo with ⌘Z / Ctrl+Z" : "Saved to the post"}</span></div>
    {card.changes.length > 0 && <ul>{card.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>}
  </div>;
}

// ---- messages --------------------------------------------------------------

/** A step: what it did and what came of it ("Searched X for "NYSE" · 6 photos"), or what went wrong. */
function StepLine({part}: {part: ChatStepPart}) {
  if (part.type === "note") return <p className="te-chat-note">{part.text}</p>;
  return <p className={`te-chat-tool is-${part.status}`}>
    {part.status === "running" ? <span className="te-chat-spinner" aria-hidden/> : part.status === "done" ? <CheckIcon size={13}/> : <CloseIcon size={13}/>}
    <span>{part.status === "done" ? part.done ?? part.label : part.label}{part.detail && <small> · {part.detail}</small>}</span>
  </p>;
}

/** The live line under an answer being written: what Claude is doing right now, and for how long. */
function Activity({message}: {message: ChatMessage}) {
  return <p className="te-chat-activity">
    <span className="te-chat-activity-mark" aria-hidden/>
    <span className="te-chat-activity-text" aria-live="polite">{activityOf(message.parts ?? [])}…</span>
    <Elapsed since={message.at}/>
  </p>;
}

function ItemView({item, cards}: {item: AnswerItem; cards: CardContext}) {
  if (item.kind === "text") return <div className={`te-chat-text${item.narration ? " is-narration" : ""}`}><RichText text={item.text}/></div>;
  if (item.kind === "card") return <CardView card={item.card} context={cards}/>;
  return <StepLine part={item.part}/>;
}

type CardContext = {openDeckId: string | null; canPlace: (card: Extract<ChatCard, {type: "photos"}>) => boolean; onPlace: (card: Extract<ChatCard, {type: "photos"}>, photo: ChatPhoto) => ChatEditResult; onOpenDesign: (deckId: string) => void};
function CardView({card, context}: {card: ChatCard; context: CardContext}) {
  if (card.type === "run") return <RunCard card={card} openDeckId={context.openDeckId} onOpenDesign={context.onOpenDesign}/>;
  if (card.type === "photos") return <PhotosCard card={card} canPlace={context.canPlace(card)} onPlace={photo => context.onPlace(card, photo)}/>;
  if (card.type === "hooks") return <HooksCard card={card}/>;
  return <EditsCard card={card}/>;
}

/** "Worked for 42s · 5 steps" over a finished answer's folded steps. */
function workedFor(message: ChatMessage) {
  const tools = (message.parts ?? []).filter(part => part.type === "tool").length;
  const took = message.doneAt ? Date.parse(message.doneAt) - Date.parse(message.at) : NaN;
  return [Number.isFinite(took) ? `Worked for ${duration(Math.max(1000, took))}` : "", tools ? `${tools} ${tools === 1 ? "step" : "steps"}` : ""].filter(Boolean).join(" · ") || "Steps";
}

/**
 * Claude's answer. While it's written, everything shows as it happens: what
 * Claude says it's doing, each step when it's done, and a live line with the
 * step under way. When it's done, the steps fold into "Worked for 42s · 5
 * steps" and the cards and the answer stay. Keys come from the answer's parts,
 * so cards keep their state through the fold.
 */
function AnswerView({message, me, cards}: {message: ChatMessage; me?: ChatPerson; cards: CardContext}) {
  const running = message.status === "running";
  let rows: ReactNode[];
  if (running) {
    // The step under way shows in the live line, and joins the list once it's done.
    rows = answerItems(message.parts ?? []).filter(item => !(item.kind === "step" && item.part.type === "tool" && item.part.status === "running"))
      .map(item => <ItemView key={item.key} item={item} cards={cards}/>);
    rows.push(<Activity key="activity" message={message}/>);
  } else {
    const {folded, shown} = foldAnswer(message);
    rows = [
      folded.length ? <details key="steps" className="te-chat-steps">
        <summary>{workedFor(message)}</summary>
        {folded.map(item => <ItemView key={item.key} item={item} cards={cards}/>)}
      </details> : null,
      ...shown.map(item => <ItemView key={item.key} item={item} cards={cards}/>),
    ];
  }
  return <article className="te-chat-message is-claude" aria-busy={running}>
    <header>
      <span className="te-chat-claude-mark" aria-hidden><SparkleIcon size={11}/></span>Claude
      {message.for && me && message.for.id !== me.id && <small>for {message.for.name}</small>}
      <time dateTime={message.at}>{timeOf(message.at)}</time>
    </header>
    {rows}
    {message.status === "error" && <p className="te-chat-error" role="alert">{message.error || "Something went wrong. Try again."}</p>}
    {message.status === "stopped" && <p className="te-chat-muted">Stopped before it finished.</p>}
  </article>;
}

function PersonView({message, me, previews, queued}: {message: ChatMessage; me?: ChatPerson; previews: ReadonlyMap<string, string>; queued: number}) {
  const author = message.author, mine = !author || author.id === me?.id;
  return <article className={`te-chat-message is-person${mine ? " is-mine" : ""}`}>
    <header>
      <i style={{background: author?.color ?? "#8a8a90"}} aria-hidden/>{mine ? "You" : author?.name ?? "Someone"}
      <time dateTime={message.at}>{message.id.startsWith("local-") ? queued > 0 ? "Waiting…" : "Sending…" : timeOf(message.at)}</time>
    </header>
    {message.text && <div className="te-chat-bubble">{inline(message.text, message.id)}</div>}
    {!!message.uploads?.length && <div className="te-chat-uploads">{message.uploads.map(upload => previews.get(upload.id)
      // eslint-disable-next-line @next/next/no-img-element
      ? <img key={upload.id} src={previews.get(upload.id)} alt={upload.name} title={upload.name}/>
      : <span key={upload.id} className="te-chat-file"><PaperclipIcon size={13}/>{upload.name}</span>)}</div>}
    {message.id.startsWith("local-") && queued > 0 && <small className="te-chat-muted">Waiting for the reply ahead of it{queued > 1 ? ` (${queued} ahead)` : ""}.</small>}
  </article>;
}

// ---- panel -----------------------------------------------------------------

export function AssistantPanel({open, onClose, deckId, deckName, bridgeRef, onOpenDesign}: {
  open: boolean;
  onClose: () => void;
  /** The post open in the editor, if any. */
  deckId: string | null;
  deckName?: string;
  /** Set by the editor while a post is open. */
  bridgeRef: RefObject<ChatEditorBridge | null>;
  onOpenDesign: (deckId: string) => void;
}) {
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [me, setMe] = useState<ChatPerson>();
  const [configured, setConfigured] = useState(true);
  const [stream, setStream] = useState<{key: string} | null>(null);
  const [queued, setQueued] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(new Map());
  const [notice, setNotice] = useState("");
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const [listening, setListening] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The chat follows the open post. A reply being written keeps its chat in view
  // ("sticky") until it's done, then the chat moves to the post that's open.
  const [view, setView] = useState({deckId, key: deckId ?? HOME, sticky: false});
  if (view.deckId !== deckId) setView({deckId, key: stream && stream.key !== (deckId ?? HOME) ? stream.key : deckId ?? HOME, sticky: Boolean(stream) && stream?.key !== (deckId ?? HOME)});
  const key = view.key, threadDeck = key === HOME ? null : key;
  const thread = threads[key] ?? EMPTY_THREAD;

  const live = useRef<Live | null>(null);
  const onOpenRef = useRef(onOpenDesign), prefsRef = useRef(prefs), viewRef = useRef(view);
  useEffect(() => { onOpenRef.current = onOpenDesign; prefsRef.current = prefs; viewRef.current = view; });
  const listRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLTextAreaElement>(null), fileRef = useRef<HTMLInputElement>(null);
  const recognition = useRef<{instance: Recognition; base: string; startedAt: number; held: boolean} | null>(null);
  const voice = useSyncExternalStore(subscribeNothing, () => Boolean(recognitionClass()), () => false);
  const speech = useSyncExternalStore(subscribeNothing, canSpeak, () => false);

  const change = (target: string, update: (thread: Thread) => Thread) => setThreads(all => ({...all, [target]: update(all[target] ?? EMPTY_THREAD)}));
  const setPrefs = (next: Prefs) => { setPrefsState(next); savePrefs(next); if (!next.speak && canSpeak()) window.speechSynthesis.cancel(); };

  // Load the thread, then keep it fresh: often while someone's reply is being written, now and then otherwise.
  useEffect(() => {
    if (!open) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const target = key, deck = threadDeck;
    const later = (ms: number) => { if (!stopped) timer = setTimeout(load, ms); };
    async function load() {
      if (live.current?.key === target || document.hidden) { later(4000); return; }
      try {
        const params = new URLSearchParams({sessionId: browserSession()});
        if (deck) params.set("deckId", deck);
        const response = await fetch(`${ENDPOINT}?${params}`, {cache: "no-store"});
        if (!response.ok) throw new Error(await errorOf(response, "The chat couldn't load."));
        const body = await response.json() as {thread: {messages: ChatMessage[]}; answering: boolean; configured: boolean; me?: ChatPerson};
        if (stopped) return;
        setConfigured(body.configured !== false);
        if (body.me) setMe(body.me);
        if (live.current?.key !== target) setThreads(all => ({...all, [target]: {messages: body.thread.messages ?? [], answering: Boolean(body.answering), loaded: true}}));
        later(body.answering ? 2500 : 20000);
      } catch (error) {
        if (stopped) return;
        setThreads(all => ({...all, [target]: {...(all[target] ?? EMPTY_THREAD), loaded: true, error: error instanceof Error ? error.message : "The chat couldn't load."}}));
        later(15000);
      }
    }
    void load();
    return () => { stopped = true; clearTimeout(timer); };
  }, [open, key, threadDeck, refresh]);

  // Stay at the newest message while the person is already reading the end.
  const last = thread.messages[thread.messages.length - 1];
  const tail = `${thread.messages.length}:${last?.parts?.length ?? 0}:${last?.parts?.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 1), 0) ?? 0}`;
  const pinned = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    if (list && pinned.current) list.scrollTop = list.scrollHeight;
  }, [tail, open, key]);

  useEffect(() => () => { live.current?.controller.abort(); recognition.current?.instance.abort(); }, []);
  useEffect(() => { if (open) inputRef.current?.focus({preventScroll: true}); }, [open]);

  async function addFiles(files: File[]) {
    const images = files.filter(file => file.type.startsWith("image/"));
    if (!images.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) { setNotice(`Attach at most ${MAX_ATTACHMENTS} images to one message.`); return; }
    const added: Attachment[] = [];
    for (const file of images.slice(0, room)) {
      try {
        const prepared = await prepareRecreateUpload(file);
        added.push({id: prepared.id, name: prepared.name, dataUrl: prepared.dataUrl});
      } catch (error) {
        setNotice(error instanceof Error ? error.message : `${file.name} couldn't be attached.`);
      }
    }
    if (images.length > room) setNotice(`Attach at most ${MAX_ATTACHMENTS} images to one message.`);
    if (added.length) setAttachments(current => [...current, ...added].slice(0, MAX_ATTACHMENTS));
  }

  /** The editor applies edits Claude sends and says what happened; with no editor, the server saves them. */
  async function applyEdits(event: Extract<StreamEvent, {type: "deck_ops"}>, deck: string | null) {
    const editor = bridgeRef.current;
    const answer = !deck || !editor || editor.deckId !== deck ? {gone: true} : editor.apply(event.operations);
    try {
      await fetch(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: "ack", deckId: deck ?? undefined, id: event.id, sessionId: browserSession(), ...answer})});
    } catch {
      // Unanswered edits are saved on the server after a short wait.
    }
  }

  async function send() {
    const text = draft.trim(), files = attachments;
    if ((!text && !files.length) || live.current) return;
    stopDictation();
    const target = key, deck = threadDeck, editor = deck && bridgeRef.current?.deckId === deck ? bridgeRef.current : null;
    const controller = new AbortController(), localId = `local-${crypto.randomUUID()}`;
    const current: Live = {key: target, deckId: deck, controller, localId, sent: files};
    live.current = current;
    setStream({key: target}); setQueued(0); setNotice("");
    setDraft(""); setAttachments([]);
    pinned.current = true;
    change(target, item => ({...item, messages: [...item.messages, {id: localId, at: new Date().toISOString(), role: "person", text, uploads: files.map(file => ({id: file.id, name: file.name}))}]}));
    const handle = (event: StreamEvent) => {
      if (live.current !== current) return;
      if (event.type === "queued") setQueued(event.position);
      else if (event.type === "message") {
        setQueued(0);
        const uploads = event.message.uploads ?? [];
        if (uploads.length && current.sent.length) setPreviews(map => { const next = new Map(map); uploads.forEach((upload, index) => { const file = current.sent[index]; if (file) next.set(upload.id, file.dataUrl); }); return next; });
        change(target, item => ({...item, messages: settleMessage(item.messages, localId, event.message)}));
      } else if (event.type === "reply") {
        current.replyId = event.message.id;
        change(target, item => ({...item, answering: true, messages: upsertMessage(item.messages, event.message)}));
      } else if (event.type === "text" || event.type === "note" || event.type === "tool" || event.type === "card") {
        const id = current.replyId;
        if (id) change(target, item => ({...item, messages: item.messages.map(message => message.id === id ? withChatEvent(message, event) : message)}));
      } else if (event.type === "deck_ops") void applyEdits(event, deck);
      else if (event.type === "open") onOpenRef.current(event.deckId);
      else if (event.type === "done" || event.type === "error") {
        const message = event.message;
        if (message) change(target, item => ({...item, answering: false, messages: upsertMessage(item.messages, message)}));
        else if (event.type === "error") setNotice(event.error);
        if (event.type === "done" && prefsRef.current.speak) speak(event.message, prefsRef.current.lang);
      }
    };
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST", headers: {"Content-Type": "application/json"}, signal: controller.signal,
        body: JSON.stringify({deckId: deck ?? undefined, text, uploads: files.map(file => ({name: file.name, dataUrl: file.dataUrl})), sessionId: browserSession(), ...(editor ? {turn: editor.turn(), editor: true} : {})}),
      });
      if (!response.ok || !response.body) {
        const problem = await errorOf(response, "The chat couldn't send that. Try again.");
        // Nothing was saved: put the message back in the box.
        change(target, item => ({...item, messages: item.messages.filter(message => message.id !== localId)}));
        setDraft(value => value || text);
        setAttachments(value => value.length ? value : files);
        setNotice(problem);
        return;
      }
      await readChatEvents(response.body, handle);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error && error.name !== "TypeError" ? error.message : "The connection dropped. The reply keeps going and shows up here when it's done.");
    } finally {
      if (live.current === current) live.current = null;
      setStream(null); setQueued(0);
      setRefresh(value => value + 1);
      const shown = viewRef.current;
      if (shown.sticky) {
        setView({deckId: shown.deckId, key: shown.deckId ?? HOME, sticky: false});
        setNotice(shown.deckId ? "This is the post's chat now. Your earlier chat is under Your chat." : "Back in your chat. The post's chat opens with the post.");
      }
    }
  }

  function startDictation(held: boolean) {
    const Speech = recognitionClass();
    if (!Speech || recognition.current) return;
    const instance = new Speech();
    instance.lang = prefs.lang; instance.interimResults = true; instance.continuous = true;
    const base = draft.trim();
    recognition.current = {instance, base, startedAt: Date.now(), held};
    instance.onresult = event => {
      let words = "";
      for (let index = 0; index < event.results.length; index++) words += event.results[index][0].transcript;
      setDraft([recognition.current?.base ?? base, words.trim()].filter(Boolean).join(" "));
    };
    instance.onerror = event => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setNotice("Allow the microphone for this site to dictate.");
      else if (event.error !== "no-speech" && event.error !== "aborted") setNotice(`Dictation stopped (${event.error}).`);
    };
    instance.onend = () => { if (recognition.current?.instance === instance) recognition.current = null; setListening(false); };
    try { instance.start(); setListening(true); } catch { recognition.current = null; setListening(false); }
  }
  function stopDictation() {
    const current = recognition.current;
    if (!current) return;
    current.instance.stop();
    recognition.current = null;
    setListening(false);
    inputRef.current?.focus({preventScroll: true});
  }
  // Hold to talk; a quick tap toggles, for people who'd rather not hold.
  function micDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (recognition.current) { stopDictation(); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    startDictation(true);
  }
  function micUp() {
    const current = recognition.current;
    if (current?.held && Date.now() - current.startedAt > HOLD_MS) stopDictation();
    else if (current) current.held = false;
  }
  function micKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.repeat) return;
    if (recognition.current) stopDictation(); else startDictation(false);
  }

  function composerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files].filter(file => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  }
  function drop(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(false);
    void addFiles([...event.dataTransfer.files]);
  }

  const cards: CardContext = {
    openDeckId: deckId,
    canPlace: card => Boolean(card.target) && threadDeck !== null && threadDeck === deckId,
    onPlace: (card, photo) => {
      const editor = bridgeRef.current;
      if (!card.target || !editor || editor.deckId !== threadDeck) return {applied: false, error: "Open the post to place a photo."};
      return editor.apply([{op: "update_element", pageId: card.target.pageId, elementId: card.target.elementId, properties: {src: photo.url, ...(photo.width && photo.height ? {intrinsicWidth: photo.width, intrinsicHeight: photo.height} : {})}}]);
    },
    onOpenDesign: id => onOpenRef.current(id),
  };

  if (!open) return null;
  const busy = Boolean(stream);
  const othersAnswering = thread.answering && stream?.key !== key;
  const suggestions = threadDeck
    ? ["Make the cover title shorter", "Check this post against the brand guide", "Find a better photo for this slide"]
    : ["Recreate this post for ", "Which pages can you post to?", "Write hook options for a story about "];
  return <aside className={`te-chat${dragging ? " is-dragging" : ""}`} aria-label="Chat with Claude"
    onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); onClose(); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={drop}>
    <header className="te-chat-head">
      <div className="te-chat-title">
        <strong><CommentIcon size={16}/>Chat</strong>
        <span>{threadDeck ? threadDeck === deckId ? `About ${deckName || "this post"} · shared with your team` : "About another post · shared with your team" : "Your chat · only you see it"}</span>
      </div>
      {speech && <button type="button" className="te-icon" aria-pressed={prefs.speak} title={prefs.speak ? "Stop reading replies aloud" : "Read replies aloud"} aria-label="Read replies aloud" onClick={() => setPrefs({...prefs, speak: !prefs.speak})}><SpeakerIcon size={16} off={!prefs.speak}/></button>}
      <button type="button" className="te-icon" aria-label="Close chat" title="Close (Esc)" onClick={onClose}><CloseIcon size={17}/></button>
    </header>
    {deckId && <div className="te-chat-switch" role="group" aria-label="Which chat">
      <button type="button" aria-pressed={key === deckId} onClick={() => setView({deckId, key: deckId, sticky: false})}>This post</button>
      <button type="button" aria-pressed={key === HOME} onClick={() => setView({deckId, key: HOME, sticky: false})}>Your chat</button>
    </div>}
    <div className="te-chat-log" ref={listRef} role="log" aria-live="off" aria-label="Messages"
      onScroll={event => { const list = event.currentTarget; pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 60; }}>
      {!thread.loaded && !thread.messages.length && <p className="te-chat-muted te-chat-loading"><span className="te-chat-spinner" aria-hidden/>Loading the chat…</p>}
      {thread.loaded && !thread.messages.length && <div className="te-chat-empty">
        <span className="te-chat-claude-mark is-large" aria-hidden><SparkleIcon size={18}/></span>
        <h3>{threadDeck ? "Change this post by asking" : "Paste a post and say what to make"}</h3>
        <p>{threadDeck ? "Ask for shorter titles, new photos, colors or a fact check. Each reply's edits are one undo step." : "Drop an Instagram link or screenshots and name the page. Claude runs the Recreate team and you pick the hook."}</p>
        <div className="te-chat-suggestions">{suggestions.map(suggestion => <button key={suggestion} type="button" onClick={() => { setDraft(suggestion); inputRef.current?.focus(); }}>{suggestion.trim()}{suggestion.endsWith(" ") ? "…" : ""}</button>)}</div>
      </div>}
      {thread.messages.map(message => message.role === "assistant"
        ? <AnswerView key={message.id} message={message} me={me} cards={cards}/>
        : <PersonView key={message.id} message={message} me={me} previews={previews} queued={queued}/>)}
      {thread.error && thread.loaded && <p className="te-chat-error" role="alert">{thread.error}</p>}
    </div>
    <span className="te-chat-sr" role="status">{busy ? "Claude is answering" : othersAnswering ? "Claude is answering a teammate" : ""}</span>
    <form className="te-chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      {notice && <p className="te-chat-notice" role="alert">{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice("")}><CloseIcon size={13}/></button></p>}
      {!configured && <p className="te-chat-notice">The chat isn&apos;t set up on this server yet: it needs ANTHROPIC_API_KEY.</p>}
      {othersAnswering && !busy && <p className="te-chat-muted te-chat-status"><span className="te-chat-spinner" aria-hidden/>Claude is answering someone in this chat. Yours will wait its turn.</p>}
      {attachments.length > 0 && <ol className="te-chat-attachments" aria-label="Attached images">{attachments.map((file, index) => <li key={file.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file.dataUrl} alt={file.name}/>
        <span aria-hidden>{index + 1}</span>
        <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments(current => current.filter(item => item.id !== file.id))}><CloseIcon size={11}/></button>
      </li>)}</ol>}
      <textarea ref={inputRef} rows={1} value={draft} maxLength={8000} disabled={!configured}
        placeholder={listening ? "Listening…" : threadDeck ? "Ask for a change, or ask about the post" : "Paste a link, drop screenshots, or ask anything"}
        aria-label="Message" onChange={event => setDraft(event.target.value)} onKeyDown={composerKey} onPaste={paste}/>
      <div className="te-chat-actions">
        <input ref={fileRef} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void addFiles(files); }}/>
        <button type="button" className="te-icon" aria-label="Attach images" title="Attach screenshots or photos" disabled={!configured || attachments.length >= MAX_ATTACHMENTS} onClick={() => fileRef.current?.click()}><PaperclipIcon size={17}/></button>
        {voice && <>
          <button type="button" className={`te-icon te-chat-mic${listening ? " is-listening" : ""}`} aria-pressed={listening} disabled={!configured}
            aria-label={listening ? "Stop dictation" : "Dictate"} title={listening ? "Release or tap to stop" : "Hold to talk, or tap to start and stop"}
            onPointerDown={micDown} onPointerUp={micUp} onPointerCancel={micUp} onKeyDown={micKey}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
          </button>
          <button type="button" className="te-chat-lang" disabled={listening} title="Dictation language" aria-label={`Dictation language: ${prefs.lang === "es-ES" ? "Spanish" : "English"}`}
            onClick={() => setPrefs({...prefs, lang: prefs.lang === "es-ES" ? "en-US" : "es-ES"})}>{prefs.lang === "es-ES" ? "ES" : "EN"}</button>
        </>}
        <button type="submit" className="te-button te-primary te-chat-send" disabled={!configured || busy || (!draft.trim() && !attachments.length)}>{busy ? "Answering…" : "Send"}</button>
      </div>
    </form>
  </aside>;
}
