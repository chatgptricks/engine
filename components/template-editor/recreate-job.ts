"use client";

import {useCallback, useEffect, useRef, useState} from "react";

/** Client side of the Recreate post flow: request helpers, image prep and job polling. */
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
export type RecreateStatus = "queued" | "importing" | "researching" | "writing" | "building" | "done" | "error";
export type FactCheck = {
  claim: string;
  verdict: "confirmed" | "corrected" | "unverified";
  detail: string;
  sources: {title: string; url: string}[];
};
export type RecreateResult = {
  deckId: string;
  editorUrl: string;
  name: string;
  slideCount: number;
  factChecks: FactCheck[];
  notes: string[];
};
export type RecreateJob = {
  jobId: string;
  status: RecreateStatus;
  message: string;
  startedAt?: string | number;
  updatedAt?: string | number;
  result?: RecreateResult;
  error?: string;
};
export type RecreateUpload = {name: string; dataUrl: string};
export type RecreateRequest = {url?: string; uploads?: RecreateUpload[]; caption?: string; profileId: string; notes?: string};
/** Text fields of the form, kept with a running job so a failed run can be edited and retried after a reload. */
export type RecreateDraftText = {mode: "link" | "screenshots"; url: string; caption: string; notes: string; profileId: string};
export type TrackedRecreate = {
  jobId: string;
  startedAt: number;
  source: string;
  profileName: string;
  opened?: boolean;
  draft: RecreateDraftText;
};

export const RECREATE_STEPS: {status: RecreateStatus; label: string}[] = [
  {status: "importing", label: "Importing post"},
  {status: "researching", label: "Researching and fact-checking"},
  {status: "writing", label: "Writing slides"},
  {status: "building", label: "Building editable post"},
];
export const MAX_RECREATE_UPLOADS = 20;
export const RECREATE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIDE = 1600;
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const ENDPOINT = "/api/engine/recreate";
const PROFILES_ENDPOINT = "/api/engine/page-profiles";
const STATUSES: RecreateStatus[] = ["queued", "importing", "researching", "writing", "building", "done", "error"];
const VERDICTS: FactCheck["verdict"][] = ["confirmed", "corrected", "unverified"];

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 4000): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const time = (value: unknown): string | number | undefined => typeof value === "string" || typeof value === "number" ? value : undefined;

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

export async function startRecreate(request: RecreateRequest): Promise<string> {
  const body = await send(ENDPOINT, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(request)}, "Recreate post");
  const jobId = isRecord(body) ? text(body.jobId, 200) : "";
  if (!jobId) throw new RecreateRequestError("The server accepted the request but didn't return a job. Try again.", 200);
  return jobId;
}

function parseFactCheck(value: unknown): FactCheck | null {
  if (!isRecord(value)) return null;
  const claim = text(value.claim, 2000);
  if (!claim) return null;
  const verdict = VERDICTS.includes(value.verdict as FactCheck["verdict"]) ? value.verdict as FactCheck["verdict"] : "unverified";
  const sources = Array.isArray(value.sources) ? value.sources.flatMap(source => {
    if (!isRecord(source)) return [];
    const url = text(source.url, 2000), title = text(source.title, 300);
    return url || title ? [{title: title || url, url}] : [];
  }) : [];
  return {claim, verdict, detail: text(value.detail, 4000), sources};
}

function parseResult(value: unknown): RecreateResult | undefined {
  if (!isRecord(value)) return undefined;
  const deckId = text(value.deckId, 200);
  if (!deckId) return undefined;
  return {
    deckId,
    editorUrl: text(value.editorUrl, 2000),
    name: text(value.name, 200) || "Recreated post",
    slideCount: typeof value.slideCount === "number" && Number.isFinite(value.slideCount) ? Math.max(0, Math.round(value.slideCount)) : 0,
    factChecks: Array.isArray(value.factChecks) ? value.factChecks.map(parseFactCheck).filter((item): item is FactCheck => item !== null) : [],
    notes: Array.isArray(value.notes) ? value.notes.map(note => text(note, 2000)).filter(Boolean) : [],
  };
}

export async function fetchRecreateJob(jobId: string, signal?: AbortSignal): Promise<RecreateJob> {
  const body = await send(`${ENDPOINT}?jobId=${encodeURIComponent(jobId)}`, {signal}, "Recreate progress");
  if (!isRecord(body) || !STATUSES.includes(body.status as RecreateStatus)) throw new RecreateRequestError("Progress came back in an unexpected format.", 200);
  const result = parseResult(body.result);
  return {
    jobId: text(body.jobId, 200) || jobId,
    status: body.status as RecreateStatus,
    message: text(body.message, 600),
    startedAt: time(body.startedAt),
    updatedAt: time(body.updatedAt),
    ...(result ? {result} : {}),
    ...(text(body.error, 1000) ? {error: text(body.error, 1000)} : {}),
  };
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
      draft: {mode: draft.mode === "screenshots" ? "screenshots" : "link", url: text(draft.url, 2000), caption: text(draft.caption, 5000), notes: text(draft.notes, 2000), profileId: text(draft.profileId, 200)},
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

/**
 * Tracks one recreate run per workspace in this tab. The job id lives in
 * sessionStorage, so a reload resumes polling where it left off.
 */
export function useRecreateJob(scope: string | undefined, onSettled?: (job: RecreateJob, tracked: TrackedRecreate | null) => boolean | void) {
  const key = scope ? `engine:recreate-job:${scope}` : "";
  const [tracked, setTracked] = useState<TrackedRecreate | null>(null);
  const [job, setJob] = useState<RecreateJob | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
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
    let active = true, failures = 0, timer: ReturnType<typeof setTimeout> | undefined;
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
        if (next.status === "done" && !next.result) { settle({...next, status: "error", error: "The post finished, but its result couldn't be read. Try again."}); return; }
        if (next.status === "done" || next.status === "error") { settle(next); return; }
        setJob(next);
        setReconnecting(false);
      } catch (cause) {
        if (!active) return;
        const failure = cause instanceof RecreateRequestError ? cause : null, status = failure?.status ?? 0;
        if (failure && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          const error = status === 404 && !failure.fromServer ? "This recreate run is no longer available. Start it again." : failure.message;
          settle({jobId, status: "error", message: "", error});
          return;
        }
        failures++;
        if (failures >= 2) setReconnecting(true);
      }
      const base = document.visibilityState === "hidden" ? 8000 : 2000;
      timer = setTimeout(() => void tick(), failures ? Math.min(20_000, base * 2 ** Math.min(failures, 3)) : base);
    };
    void tick();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [jobId]);

  const start = useCallback(async (request: RecreateRequest, details: Omit<TrackedRecreate, "jobId" | "startedAt" | "opened">) => {
    const id = await startRecreate(request);
    const next: TrackedRecreate = {jobId: id, startedAt: Date.now(), ...details};
    writeTracked(key, next);
    setJob({jobId: id, status: "queued", message: "", startedAt: next.startedAt});
    setReconnecting(false);
    setTracked(next);
    return next;
  }, [key]);

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
  return {tracked, job: visibleJob, reconnecting, start, markOpened, dismiss};
}
