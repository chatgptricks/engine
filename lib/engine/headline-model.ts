import {z} from "zod";

/**
 * Client for Ivan's hosted headline model (a Modal service, source in the
 * Headline-Model project: scripts/service_modal.py).
 *
 *   POST /v1/headlines  writes headline options for a story
 *   POST /v1/picks      records which option a person chose, so the model learns
 *
 * Auth is a Bearer team key in HEADLINE_API_KEY. The key is read when a call
 * is made, only ever placed in the Authorization header, and scrubbed from
 * every error text. This module logs nothing.
 *
 * The service sleeps when idle. The first call after a quiet spell can take
 * minutes while the GPU model wakes, and Modal answers long calls with
 * redirects that lead to the result, so redirects are followed and the
 * headline call may wait up to 15 minutes.
 */

export const DEFAULT_HEADLINE_API_URL = "https://ivand971217--headline-service-api.us-east.modal.run";

/** The longest any call may wait: the service's own limit for one request. */
export const HEADLINE_MAX_TIMEOUT_MS = 900_000;
/** Writing headlines may wake the GPU model, so it gets the full 15 minutes. */
export const HEADLINE_WRITE_TIMEOUT_MS = HEADLINE_MAX_TIMEOUT_MS;
/** Saving a pick only writes a row, but the service itself may be asleep. */
export const HEADLINE_PICK_TIMEOUT_MS = 300_000;

/** Responses are small JSON (a dozen short lines plus research notes). */
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_ERROR_BYTES = 16_000;
/** The service accepts 1 to 10 options per request. */
const MAX_COUNT = 10;

export interface HeadlineOption {
  text: string;
  /** The house framework this line is written in: "story", "breaking", or "original" for the page's own line. */
  framework?: string;
  /** Who wrote it, such as the model's version, "plain_rewrite", "light_edit", "original" or "human". */
  sources?: string[];
}

export interface HeadlineResearch {
  context: string[];
  unconfirmed: string[];
  sources: string[];
  readPost?: boolean;
  error?: string;
}

/** Everything /v1/headlines returns that Engine can use. */
export interface HeadlineResult {
  /** Best first. Keep this list as returned and hand it to `savePick`. */
  options: HeadlineOption[];
  recommended?: HeadlineOption;
  /** Which framing fits this news best: "story" or "breaking". */
  framework?: string;
  /** One sentence on why that framework and top pick. */
  why?: string;
  /** The checked story the lines were written from. Pass this to `savePick`. */
  story: string;
  /** Lines the service threw out, and why (invented details, retellings). */
  dropped: Array<{text: string; why: string}>;
  research?: HeadlineResearch;
  originalCheck?: {verdict?: string; original?: string; lightEdit?: string};
}

export type HeadlineModelErrorCode =
  | "not_configured"
  | "invalid_input"
  | "unauthorized"
  | "rejected"
  | "busy"
  | "server"
  | "timeout"
  | "aborted"
  | "network"
  | "too_large"
  | "bad_response"
  | "empty";

export class HeadlineModelError extends Error {
  /** The HTTP status when the service answered, otherwise 0. */
  readonly status: number;
  readonly code: HeadlineModelErrorCode;
  constructor(message: string, code: HeadlineModelErrorCode, status = 0) {
    super(message);
    this.name = "HeadlineModelError";
    this.code = code;
    this.status = status;
  }
}

type FetchLike = typeof fetch;

interface CallOptions {
  signal?: AbortSignal;
  /** Replaces the global fetch (tests). */
  fetch?: FetchLike;
  /** Shorter wait than the default. Never longer than 15 minutes. */
  timeoutMs?: number;
}

export interface WriteHeadlinesInput extends CallOptions {
  /** The facts in 1-3 plain sentences. Needed unless `url` is given. */
  story?: string;
  /** A link to the source. An X post link alone is enough. */
  url?: string;
  /** The headline the post already has. The service keeps a strong one or lightly edits it. */
  originalHeadline?: string;
  /** How many options, 1 to 10. Default 5. The service may add the original and its edit on top. */
  count?: number;
  /** Let the service search the web for context and confirmation (slower, +40-60 s). */
  research?: boolean;
}

export interface SavePickInput extends CallOptions {
  /** The story the options were written for: `HeadlineResult.story`. */
  story: string;
  /** Index into `options` of the line the person picked, or -1 when none was good enough. */
  chosen: number;
  /** What they actually posted, if they edited it. */
  finalText?: string;
  originalHeadline?: string;
  /** The page it is for, such as "chatgptricks". */
  account?: string;
  /** Who picked, if known. */
  pickedBy?: string;
  /** The options exactly as `writeHeadlines` returned them. */
  options: HeadlineOption[];
}

/** True when a team key is set. Without one, callers fall back to writing hooks themselves. */
export function isHeadlineModelConfigured(): boolean {
  return Boolean(apiKey());
}

/**
 * Writes headline options for a story, best first.
 * Throws `HeadlineModelError`; check `isHeadlineModelConfigured()` first to skip the call.
 */
export async function writeHeadlines(input: WriteHeadlinesInput): Promise<HeadlineOption[]> {
  return (await requestHeadlines(input)).options;
}

/** Like `writeHeadlines`, but with the whole result: the checked story, the recommendation, dropped lines and research. */
export async function requestHeadlines(input: WriteHeadlinesInput): Promise<HeadlineResult> {
  const story = (input.story ?? "").trim();
  const url = (input.url ?? "").trim();
  if (!story && !url) {
    throw new HeadlineModelError("The headline model needs a story or a link to write from.", "invalid_input");
  }
  const wanted = typeof input.count === "number" && Number.isFinite(input.count) ? input.count : 5;
  const count = Math.min(MAX_COUNT, Math.max(1, Math.trunc(wanted)));
  const body = {
    story,
    url,
    original_headline: (input.originalHeadline ?? "").trim(),
    count,
    research: input.research === true,
  };
  const reply = await call("/v1/headlines", body, HEADLINE_WRITE_TIMEOUT_MS, input);
  const parsed = headlinesResponse.safeParse(reply);
  if (!parsed.success) throw badResponse();
  const data = parsed.data;
  const options = data.options.map(cleanOption).filter((option): option is HeadlineOption => option !== null);
  if (!options.length) {
    throw new HeadlineModelError(
      "The headline model didn't return any headline options for that story. Try again, or add more detail to the story.",
      "empty",
      200,
    );
  }
  const recommended = data.recommended ? cleanOption(data.recommended) : null;
  const result: HeadlineResult = {
    options,
    story: (data.story ?? "").trim() || story,
    dropped: (data.dropped ?? []).map(item => ({text: item.text, why: item.why ?? ""})),
  };
  if (recommended) result.recommended = recommended;
  if (data.framework) result.framework = data.framework;
  if (data.why) result.why = data.why;
  if (data.research) {
    result.research = {
      context: data.research.context ?? [],
      unconfirmed: data.research.unconfirmed ?? [],
      sources: data.research.sources ?? [],
      ...(typeof data.research.read_post === "boolean" ? {readPost: data.research.read_post} : {}),
      ...(data.research.error ? {error: data.research.error} : {}),
    };
  }
  if (data.original_check) {
    result.originalCheck = {
      ...(data.original_check.verdict ? {verdict: data.original_check.verdict} : {}),
      ...(data.original_check.original ? {original: data.original_check.original} : {}),
      ...(data.original_check.light_edit ? {lightEdit: data.original_check.light_edit} : {}),
    };
  }
  return result;
}

/**
 * Records which option a person chose. Call it only for real human choices
 * (never autopilot), so the model learns from people. Resolves to the saved
 * pick's id.
 */
export async function savePick(input: SavePickInput): Promise<{id: string}> {
  const options = input.options.map(option => ({
    text: option.text,
    sources: option.sources ?? [],
    framework: option.framework ?? "",
  }));
  if (!Number.isInteger(input.chosen) || input.chosen < -1 || input.chosen >= options.length) {
    throw new HeadlineModelError(
      "The picked headline isn't one of the options that were shown, so the pick wasn't saved.",
      "invalid_input",
    );
  }
  const body = {
    story: input.story,
    chosen: input.chosen,
    final_text: input.finalText ?? "",
    original_headline: input.originalHeadline ?? "",
    account: input.account ?? "",
    picked_by: input.pickedBy ?? "",
    client: "engine",
    options,
  };
  const reply = await call("/v1/picks", body, HEADLINE_PICK_TIMEOUT_MS, input);
  const parsed = pickResponse.safeParse(reply);
  if (!parsed.success) throw badResponse();
  return {id: parsed.data.id};
}

/**
 * Finds the options and index to save for a person's choice, given the text
 * they ended up with. A line from the list keeps its index, empty text means
 * "none of these" (-1), and anything else (a hook they wrote or edited) is
 * added as its own option written by "human", the way the model's own tool does.
 */
export function resolvePick(options: HeadlineOption[], chosenText: string): {options: HeadlineOption[]; chosen: number} {
  const text = chosenText.trim();
  if (!text) return {options, chosen: -1};
  const index = options.findIndex(option => option.text === text);
  if (index >= 0) return {options, chosen: index};
  return {options: [...options, {text, sources: ["human"]}], chosen: options.length};
}

// ── responses ────────────────────────────────────────────────────────────────

const optionSchema = z.object({
  text: z.string(),
  framework: z.string().nullish(),
  sources: z.array(z.string()).nullish(),
});

const headlinesResponse = z.object({
  options: z.array(optionSchema),
  recommended: optionSchema.nullish(),
  framework: z.string().nullish(),
  why: z.string().nullish(),
  story: z.string().nullish(),
  dropped: z.array(z.object({text: z.string(), why: z.string().nullish()})).nullish(),
  research: z.object({
    context: z.array(z.string()).nullish(),
    unconfirmed: z.array(z.string()).nullish(),
    sources: z.array(z.string()).nullish(),
    read_post: z.boolean().nullish(),
    error: z.string().nullish(),
  }).nullish(),
  original_check: z.object({
    verdict: z.string().nullish(),
    original: z.string().nullish(),
    light_edit: z.string().nullish(),
  }).nullish(),
});

const pickResponse = z.object({id: z.string().min(1)});

function cleanOption(option: z.infer<typeof optionSchema>): HeadlineOption | null {
  const text = option.text.trim();
  if (!text) return null;
  const clean: HeadlineOption = {text};
  if (option.framework) clean.framework = option.framework;
  if (option.sources?.length) clean.sources = option.sources;
  return clean;
}

function badResponse(): HeadlineModelError {
  return new HeadlineModelError(
    "The headline model sent back a reply Engine couldn't read. Try again in a minute.",
    "bad_response",
    200,
  );
}

// ── transport ────────────────────────────────────────────────────────────────

function apiKey(): string {
  return (process.env.HEADLINE_API_KEY ?? "").trim();
}

function baseUrl(): URL {
  const raw = (process.env.HEADLINE_API_URL ?? "").trim() || DEFAULT_HEADLINE_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HeadlineModelError("HEADLINE_API_URL isn't a valid web address. Fix it in .env.local.", "not_configured");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname.endsWith(".localhost");
  // The team key travels in a header, so it only goes over https (or to this machine while developing)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new HeadlineModelError("HEADLINE_API_URL must start with https://, because the key is sent with each request.", "not_configured");
  }
  return url;
}

async function call(path: string, body: unknown, defaultTimeoutMs: number, options: CallOptions): Promise<unknown> {
  const key = apiKey();
  if (!key) {
    throw new HeadlineModelError(
      "The headline model isn't set up yet: add HEADLINE_API_KEY to .env.local (and to the server's environment).",
      "not_configured",
    );
  }
  const base = baseUrl();
  const url = `${base.origin}${base.pathname.replace(/\/+$/, "")}${path}`;
  const wait = Math.min(HEADLINE_MAX_TIMEOUT_MS, Math.max(1, Math.trunc(options.timeoutMs ?? defaultTimeoutMs)));
  const timeout = AbortSignal.timeout(wait);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const send = options.fetch ?? fetch;

  try {
    if (options.signal?.aborted) throw options.signal.reason;
    const response = await send(url, {
      method: "POST",
      redirect: "follow",
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await httpError(response, key);
    const text = await readCapped(response, MAX_RESPONSE_BYTES);
    if (text === null) {
      throw new HeadlineModelError("The headline model's reply was far larger than expected, so Engine ignored it.", "too_large", response.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw badResponse();
    }
  } catch (error) {
    if (error instanceof HeadlineModelError) throw error;
    // Never pass on the original error's text: a failing request can carry the Authorization header in its message
    if (options.signal?.aborted) {
      throw new HeadlineModelError("The headline request was cancelled.", "aborted");
    }
    if (timeout.aborted) {
      throw new HeadlineModelError(
        `The headline model didn't answer within ${describeWait(wait)}. It may still be waking up, so try again in a minute.`,
        "timeout",
      );
    }
    throw new HeadlineModelError(
      "Engine couldn't reach the headline model. Check your internet connection and HEADLINE_API_URL, then try again.",
      "network",
    );
  }
}

async function httpError(response: Response, key: string): Promise<HeadlineModelError> {
  const status = response.status;
  const detail = await errorDetail(response, key);
  const withDetail = (message: string) => (detail ? `${message} (${detail})` : message);
  if (status === 401 || status === 403) {
    return new HeadlineModelError(
      "The headline model refused the key. Check that HEADLINE_API_KEY is the current team key.",
      "unauthorized",
      status,
    );
  }
  if (status === 429) {
    return new HeadlineModelError("The headline model is busy right now. Try again in a minute.", "busy", status);
  }
  if (status === 408 || status === 504) {
    return new HeadlineModelError("The headline model took too long to answer. It may be waking up, so try again in a minute.", "timeout", status);
  }
  if (status === 502) {
    return new HeadlineModelError(withDetail("The headline model couldn't read that link or finish the job. Try again, or give it the story text."), "server", status);
  }
  if (status >= 500) {
    return new HeadlineModelError(`The headline model had a problem on its side (error ${status}). It may be waking up, so try again in a minute.`, "server", status);
  }
  if (status === 422 || status === 400) {
    return new HeadlineModelError(withDetail("The headline model couldn't use that request."), "rejected", status);
  }
  return new HeadlineModelError(`The headline model's address didn't work (error ${status}). Check HEADLINE_API_URL.`, "rejected", status);
}

/** A short, key-free reason from FastAPI's `{"detail": ...}` body, if there is one. */
async function errorDetail(response: Response, key: string): Promise<string> {
  try {
    const text = await readCapped(response, MAX_ERROR_BYTES);
    if (!text) return "";
    const detail: unknown = (JSON.parse(text) as {detail?: unknown}).detail;
    let reason = "";
    if (typeof detail === "string") reason = detail;
    else if (Array.isArray(detail)) {
      reason = detail
        .map(item => {
          if (!item || typeof item !== "object") return "";
          const {loc, msg} = item as {loc?: unknown; msg?: unknown};
          const field = Array.isArray(loc) ? loc.filter(part => part !== "body").join(".") : "";
          return typeof msg === "string" ? (field ? `${field}: ${msg}` : msg) : "";
        })
        .filter(Boolean)
        .join("; ");
    }
    return redact(reason, key).replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {
    return "";
  }
}

function redact(text: string, key: string): string {
  let clean = text.replace(/Bearer\s+\S+/gi, "Bearer [hidden]");
  if (key) clean = clean.split(key).join("[hidden]");
  return clean;
}

/** The body as text, or null when it's bigger than `limit` bytes (the rest is never downloaded). */
async function readCapped(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) {
    const text = await response.text();
    return Buffer.byteLength(text) > limit ? null : text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function describeWait(ms: number): string {
  if (ms >= 60_000) {
    const minutes = Math.round(ms / 60_000);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
