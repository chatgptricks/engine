import {createHash, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {developmentDirectory} from "@/lib/template-editor/development-storage";

/**
 * Page profiles: one per Instagram page a workspace runs. "Recreate post"
 * hands the chosen profile to the writer, so it carries the page's language,
 * template, voice brief and house rules, plus the deterministic `format`
 * checks code enforces after the writer is done.
 *
 * Built-in profiles ship in code. Saved profiles (new pages and overrides of
 * built-ins) live per workspace owner in gf_client_state under their own
 * `page-profiles:<owner>` namespace (never `template-editor:`), or in a local
 * development file when Supabase isn't configured, like the template editor.
 */

export type PageLanguage = "en" | "es";

/** Rules code can check without a model. */
export interface PageProfileFormat {
  /** No text box may end with a period. */
  noFinalPeriods: boolean;
  /** Body text under a title may wrap to at most this many lines. */
  bodyMaxLines: number;
}

export interface PageProfile {
  id: string;
  name: string;
  handle: string;
  language: PageLanguage;
  templateId?: string;
  /** The brand guide this page follows (Brand → Guides). Its brief, checks and examples reach every agent. */
  brandId?: string;
  /** Plain-English brief for the writer. */
  voice: string;
  /** House rules the writer must follow. */
  rules: string[];
  format: PageProfileFormat;
  /** `line1` is the fixed first line; the writer fills the second, topic line up to `maxChars`. */
  followCta: {line1: string; maxChars: number};
  swipeText: string;
  updatedAt: string;
}

export interface ListedPageProfile extends PageProfile {
  /** Ships in code. Built-ins can be edited (saved as an override) but not deleted. */
  builtIn: boolean;
  /** A built-in with saved changes for this workspace. */
  overridden: boolean;
}

export class PageProfileError extends Error {
  constructor(message: string, public status = 400, public issues: string[] = []) {
    super(message);
    this.name = "PageProfileError";
  }
}

export const PAGE_PROFILE_LIMITS = {
  id: 48,
  name: 80,
  handle: 30,
  templateId: 200,
  voice: 2000,
  rules: 30,
  rule: 400,
  bodyMaxLines: {min: 1, max: 6},
  ctaLine: 40,
  ctaMaxChars: {min: 8, max: 60},
  swipeText: 40,
  savedProfiles: 100,
} as const;

const BUILT_IN_UPDATED_AT = "2026-11-07T00:00:00.000Z";
const DEFAULT_FORMAT: PageProfileFormat = {noFinalPeriods: true, bodyMaxLines: 2};
const LANGUAGE_DEFAULTS: Record<PageLanguage, Pick<PageProfile, "followCta" | "swipeText">> = {
  en: {followCta: {line1: "FOLLOW THIS PAGE", maxChars: 21}, swipeText: "SWIPE FOR MORE"},
  es: {followCta: {line1: "SIGUE ESTA PÁGINA", maxChars: 21}, swipeText: "DESLIZA PARA VER MÁS"},
};

const BUILT_INS: readonly PageProfile[] = [
  {
    id: "chatgptricks",
    name: "chatgptricks",
    handle: "@chatgptricks",
    language: "en",
    templateId: "chatgptricks-3x4",
    brandId: "chatgptricks",
    voice: "AI and tech page for about 2.7M followers. Punchy, plain and accurate: short sentences, everyday words, and a clear reason the news matters to a regular person. No clickbait. A hype word like INSANE goes on a cover only when the story backs it up.",
    rules: [
      "No final periods: no text box ever ends with a period",
      "Body text under each title is at most two lines (about 75 characters), in super simple words most people understand",
      "Every number comes from a primary source, and the slide's source line names that source",
      "The cover headline is in ALL CAPS, with the key phrase marked for green emphasis",
      "Charts stay simple and honest: every compared value shares one scale",
      "The Follow CTA's second line is written for this post's topic (about 21 characters), in plain words, with no fear-bait",
    ],
    format: {...DEFAULT_FORMAT},
    followCta: {...LANGUAGE_DEFAULTS.en.followCta},
    swipeText: LANGUAGE_DEFAULTS.en.swipeText,
    updatedAt: BUILT_IN_UPDATED_AT,
  },
  {
    id: "pagina-es",
    name: "Example Spanish page",
    handle: "@tu_pagina",
    language: "es",
    templateId: "chatgptricks-3x4",
    brandId: "chatgptricks",
    voice: "Spanish-language AI and tech page. Punchy, plain and accurate: short sentences, everyday words, and a clear reason the news matters to a regular person. Write natural, neutral Spanish that readers in Latin America and Spain both understand. No clickbait. A strong word like BRUTAL goes on a cover only when the story backs it up.",
    rules: [
      "No final periods: no text box ever ends with a period, in Spanish as in English",
      "Body text under each title is at most two lines (about 75 characters), in super simple Spanish words most people understand. Spanish runs longer than English, so cut words instead of adding lines",
      "Every number comes from a primary source, and the slide's source line names that source",
      "The cover headline is in ALL CAPS, keeping accents on capitals (MÁS, not MAS), with the key phrase marked for green emphasis",
      "Charts stay simple and honest: every compared value shares one scale, with labels in Spanish",
      "The Follow CTA's second line is written in Spanish for this post's topic (about 21 characters), in plain words, with no fear-bait",
      "Adapt rather than translate word for word: write how a native speaker would say it",
      "Swap US-only examples for ones Spanish-speaking audiences know, when the facts allow it",
      "Keep proper accents and punctuation: á é í ó ú ñ, and opening ¿ and ¡",
    ],
    format: {...DEFAULT_FORMAT},
    followCta: {...LANGUAGE_DEFAULTS.es.followCta},
    swipeText: LANGUAGE_DEFAULTS.es.swipeText,
    updatedAt: BUILT_IN_UPDATED_AT,
  },
];

const clone = (profile: PageProfile): PageProfile => structuredClone(profile);
const builtInFor = (id: string) => BUILT_INS.find(profile => profile.id === id);

/** Built-in profiles as shipped (copies). */
export function builtInPageProfiles(): PageProfile[] {
  return BUILT_INS.map(clone);
}

/* ─── Validation ─────────────────────────────────────────────────────────── */

const ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const HANDLE = /^@[A-Za-z0-9._]{1,30}$/;
const TEMPLATE_ID = /^[A-Za-z0-9._:-]{1,200}$/;
export const isPageProfileId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

function hasControlCharacters(value: string, allowNewlines: boolean): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (allowNewlines && code === 10) continue;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Lowercase ASCII slug for a new profile id, e.g. "Página Uno" → "pagina-uno". */
export function pageProfileSlug(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, PAGE_PROFILE_LIMITS.id).replace(/-+$/g, "");
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function validate(candidate: Record<string, unknown>, updatedAt: string): PageProfile {
  const issues: string[] = [];
  const line = (field: string, value: unknown, max: number, multiline = false): string => {
    if (typeof value !== "string") {issues.push(`${field} is required.`); return "";}
    const trimmed = value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
    if (!trimmed) issues.push(`${field} is required.`);
    else if (trimmed.length > max) issues.push(`${field} must be ${max} characters or fewer.`);
    else if (hasControlCharacters(trimmed, multiline)) issues.push(`${field} contains unsupported characters.`);
    return trimmed;
  };
  const integer = (field: string, value: unknown, min: number, max: number): number => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {issues.push(`${field} must be a whole number from ${min} to ${max}.`); return min;}
    return value;
  };

  const id = typeof candidate.id === "string" ? candidate.id : "";
  if (!ID.test(id)) issues.push(`id must be 1–${PAGE_PROFILE_LIMITS.id} lowercase letters, numbers or dashes.`);
  const name = line("name", candidate.name, PAGE_PROFILE_LIMITS.name);
  let handle = typeof candidate.handle === "string" ? candidate.handle.trim() : "";
  if (handle && !handle.startsWith("@")) handle = `@${handle}`;
  if (!HANDLE.test(handle)) issues.push("handle must be an Instagram handle like @chatgptricks.");
  const language = candidate.language;
  if (language !== "en" && language !== "es") issues.push('language must be "en" or "es".');
  let templateId: string | undefined;
  if (candidate.templateId !== undefined && candidate.templateId !== null && candidate.templateId !== "") {
    if (typeof candidate.templateId !== "string" || !TEMPLATE_ID.test(candidate.templateId)) issues.push("templateId must be a template id of up to 200 letters, numbers, dots, dashes, colons or underscores.");
    else templateId = candidate.templateId;
  }
  let brandId: string | undefined;
  if (candidate.brandId !== undefined && candidate.brandId !== null && candidate.brandId !== "") {
    if (typeof candidate.brandId !== "string" || !ID.test(candidate.brandId)) issues.push("brandId must be a brand guide id: lowercase letters, numbers or dashes.");
    else brandId = candidate.brandId;
  }
  const voice = line("voice", candidate.voice, PAGE_PROFILE_LIMITS.voice, true);
  const rules: string[] = [];
  if (!Array.isArray(candidate.rules)) issues.push("rules must be a list of strings.");
  else {
    if (candidate.rules.length > PAGE_PROFILE_LIMITS.rules) issues.push(`rules can have at most ${PAGE_PROFILE_LIMITS.rules} items.`);
    candidate.rules.slice(0, PAGE_PROFILE_LIMITS.rules).forEach((rule, index) => {
      if (typeof rule !== "string") {issues.push(`rules[${index}] must be a string.`); return;}
      if (!rule.trim()) return; // Blank rows from a form are dropped, not errors.
      rules.push(line(`rules[${index}]`, rule, PAGE_PROFILE_LIMITS.rule));
    });
  }
  const format = isRecord(candidate.format) ? candidate.format : {};
  if (!isRecord(candidate.format)) issues.push("format must be an object.");
  if (typeof format.noFinalPeriods !== "boolean") issues.push("format.noFinalPeriods must be true or false.");
  const bodyMaxLines = integer("format.bodyMaxLines", format.bodyMaxLines, PAGE_PROFILE_LIMITS.bodyMaxLines.min, PAGE_PROFILE_LIMITS.bodyMaxLines.max);
  const followCta = isRecord(candidate.followCta) ? candidate.followCta : {};
  if (!isRecord(candidate.followCta)) issues.push("followCta must be an object.");
  const line1 = line("followCta.line1", followCta.line1, PAGE_PROFILE_LIMITS.ctaLine);
  const maxChars = integer("followCta.maxChars", followCta.maxChars, PAGE_PROFILE_LIMITS.ctaMaxChars.min, PAGE_PROFILE_LIMITS.ctaMaxChars.max);
  const swipeText = line("swipeText", candidate.swipeText, PAGE_PROFILE_LIMITS.swipeText);

  if (issues.length) throw new PageProfileError(issues.length === 1 ? issues[0] : `${issues[0]} (${issues.length - 1} more issue${issues.length === 2 ? "" : "s"})`, 400, issues);
  return {
    id, name, handle, language: language as PageLanguage,
    ...(templateId ? {templateId} : {}),
    ...(brandId ? {brandId} : {}),
    voice, rules,
    format: {noFinalPeriods: format.noFinalPeriods as boolean, bodyMaxLines},
    followCta: {line1, maxChars},
    swipeText, updatedAt,
  };
}

/** Layer a candidate over its base (saved/built-in profile, else language defaults). */
function merged(base: PageProfile | undefined, input: Record<string, unknown>): Record<string, unknown> {
  const language = input.language ?? base?.language;
  // An invalid language is reported on its own; English fills the CTA so it doesn't cascade.
  const defaults = LANGUAGE_DEFAULTS[language === "es" ? "es" : "en"];
  return {
    rules: [],
    ...defaults,
    ...base,
    ...input,
    format: {...DEFAULT_FORMAT, ...base?.format, ...(isRecord(input.format) ? input.format : {})},
    followCta: {...defaults.followCta, ...base?.followCta, ...(isRecord(input.followCta) ? input.followCta : {})},
  };
}

const KNOWN_FIELDS = ["id", "name", "handle", "language", "templateId", "brandId", "voice", "rules", "format", "followCta", "swipeText"] as const;
function pickInput(input: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of KNOWN_FIELDS) if (input[field] !== undefined) picked[field] = input[field];
  return picked;
}

/** Read a stored profile leniently: missing fields (e.g. `format` from older saves) come from defaults. */
function decodeSaved(id: string, raw: unknown): PageProfile | null {
  if (!isRecord(raw) || !ID.test(id)) return null;
  const updatedAt = typeof raw.updatedAt === "string" && Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : BUILT_IN_UPDATED_AT;
  try {return validate(merged(builtInFor(id), {...pickInput(raw), id}), updatedAt);}
  catch {return null;}
}

/* ─── Storage ────────────────────────────────────────────────────────────── */

interface ProfileEnvelope {revision: string; profiles: Record<string, unknown>}
class RevisionChanged extends Error {}

const storageKey = (ownerKey: string) => `page-profiles:${ownerKey}`;
const directory = () => path.join(developmentDirectory("template-editor"), "page-profiles");
const filename = (ownerKey: string) => `${createHash("sha256").update(storageKey(ownerKey)).digest("hex")}.json`;
const CLOUD_TIMEOUT_MS = 15_000;
const unavailable = () => new PageProfileError("Page profiles are unavailable right now. Retry shortly.", 503);

function checkedOwner(ownerKey: string): string {
  if (typeof ownerKey !== "string" || !ownerKey || ownerKey.length > 300) throw new PageProfileError("A workspace owner is required.", 401);
  return ownerKey;
}

function readEnvelope(value: unknown): ProfileEnvelope | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.revision !== "string" || !isRecord(value.profiles)) {
    throw new PageProfileError("Saved page profiles could not be read. They have not been changed.", 503);
  }
  return {revision: value.revision, profiles: value.profiles};
}

let fileLock: Promise<unknown> = Promise.resolve();
function withFileLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = fileLock.then(operation, operation);
  fileLock = run.then(() => undefined, () => undefined);
  return run;
}

function assertDevelopmentStorage() {
  if (process.env.NODE_ENV === "production") throw new PageProfileError("Cloud storage is not configured. No page profiles were saved.", 503);
}

async function readRecord(ownerKey: string): Promise<ProfileEnvelope | null> {
  const db = getAdminSupabase();
  if (db) {
    const {data, error} = await db.from("gf_client_state").select("data").eq("owner", storageKey(ownerKey)).abortSignal(AbortSignal.timeout(CLOUD_TIMEOUT_MS)).maybeSingle();
    if (error) throw unavailable();
    return readEnvelope(data?.data);
  }
  assertDevelopmentStorage();
  try {
    return readEnvelope(JSON.parse(await fs.readFile(path.join(directory(), filename(ownerKey)), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof PageProfileError) throw error;
    throw new PageProfileError("Saved page profiles could not be read. They have not been changed.", 503);
  }
}

async function writeRecord(ownerKey: string, next: ProfileEnvelope, expectedRevision: string | null): Promise<void> {
  const db = getAdminSupabase();
  if (db) {
    const row = {owner: storageKey(ownerKey), data: next, updated_at: new Date().toISOString()};
    const signal = AbortSignal.timeout(CLOUD_TIMEOUT_MS);
    if (expectedRevision === null) {
      const {error} = await db.from("gf_client_state").insert(row).abortSignal(signal);
      if (error?.code === "23505") throw new RevisionChanged();
      if (error) throw unavailable();
      return;
    }
    const {data, error} = await db.from("gf_client_state").update({data: next, updated_at: row.updated_at}).eq("owner", row.owner).eq("data->>revision", expectedRevision).select("owner").abortSignal(signal).maybeSingle();
    if (error) throw unavailable();
    if (!data) throw new RevisionChanged();
    return;
  }
  assertDevelopmentStorage();
  await fs.mkdir(directory(), {recursive: true, mode: 0o700});
  const destination = path.join(directory(), filename(ownerKey));
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(next), {encoding: "utf8", mode: 0o600});
    await fs.rename(temporary, destination);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

/** Read-modify-write with revision CAS (cloud) or an in-process lock (local files). */
async function mutate<T>(ownerKey: string, update: (profiles: Record<string, unknown>) => T): Promise<T> {
  const operation = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await readRecord(ownerKey);
      const profiles = structuredClone(before?.profiles ?? {});
      const result = update(profiles);
      try {
        await writeRecord(ownerKey, {revision: randomUUID(), profiles}, before?.revision ?? null);
        return result;
      } catch (error) {
        if (!(error instanceof RevisionChanged)) throw error;
      }
    }
    throw new PageProfileError("Page profiles changed in another tab. Retry.", 409);
  };
  return getAdminSupabase() ? operation() : withFileLock(operation);
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

function listed(saved: Record<string, unknown>): ListedPageProfile[] {
  const builtIns = BUILT_INS.map(profile => {
    const override = Object.hasOwn(saved, profile.id) ? decodeSaved(profile.id, saved[profile.id]) : null;
    return {...clone(override ?? profile), builtIn: true, overridden: Boolean(override)};
  });
  const custom = Object.entries(saved)
    .filter(([id]) => !builtInFor(id))
    .map(([id, raw]) => decodeSaved(id, raw))
    .filter((profile): profile is PageProfile => Boolean(profile))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map(profile => ({...profile, builtIn: false, overridden: false}));
  return [...builtIns, ...custom];
}

/** Built-in profiles (with this workspace's overrides) followed by saved custom pages. */
export async function listPageProfiles(ownerKey: string): Promise<ListedPageProfile[]> {
  const record = await readRecord(checkedOwner(ownerKey));
  return listed(record?.profiles ?? {});
}

export async function getPageProfile(ownerKey: string, id: string): Promise<ListedPageProfile | null> {
  checkedOwner(ownerKey);
  if (!isPageProfileId(id)) return null;
  return (await listPageProfiles(ownerKey)).find(profile => profile.id === id) ?? null;
}

/**
 * Create or update one profile. Fields left out keep the current value (the
 * saved profile, else the built-in, else language defaults), so editing a
 * built-in stores a full override. A missing `id` is derived from `name`.
 */
export async function savePageProfile(ownerKey: string, profile: unknown): Promise<ListedPageProfile> {
  checkedOwner(ownerKey);
  if (!isRecord(profile)) throw new PageProfileError("A page profile object is required.");
  const input = pickInput(profile);
  if (input.id === undefined && typeof input.name === "string") input.id = pageProfileSlug(input.name);
  if (!isPageProfileId(input.id)) throw new PageProfileError(`id must be 1–${PAGE_PROFILE_LIMITS.id} lowercase letters, numbers or dashes.`, 400, ["id"]);
  const id = input.id;
  return mutate(ownerKey, profiles => {
    const exists = Object.hasOwn(profiles, id);
    if (!exists && Object.keys(profiles).length >= PAGE_PROFILE_LIMITS.savedProfiles) {
      throw new PageProfileError(`A workspace can save at most ${PAGE_PROFILE_LIMITS.savedProfiles} page profiles.`, 413);
    }
    const base = (exists ? decodeSaved(id, profiles[id]) : null) ?? builtInFor(id);
    const saved = validate(merged(base ? clone(base) : undefined, input), new Date().toISOString());
    profiles[id] = saved;
    return {...saved, builtIn: Boolean(builtInFor(id)), overridden: Boolean(builtInFor(id))};
  });
}

/** Delete a saved custom profile. Returns false when it doesn't exist. Built-ins can't be deleted. */
export async function deletePageProfile(ownerKey: string, id: string): Promise<boolean> {
  checkedOwner(ownerKey);
  if (!isPageProfileId(id)) return false;
  if (builtInFor(id)) throw new PageProfileError("Built-in page profiles can't be deleted. Edit it to change it for this workspace.", 400);
  const record = await readRecord(ownerKey);
  if (!record || !Object.hasOwn(record.profiles, id)) return false;
  return mutate(ownerKey, profiles => {
    if (!Object.hasOwn(profiles, id)) return false;
    delete profiles[id];
    return true;
  });
}
