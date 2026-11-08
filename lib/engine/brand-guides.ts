import {createHash, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {developmentDirectory} from "@/lib/template-editor/development-storage";
import {BrandGuideError, brandGuideSlug, isBrandGuideId, parseBrandGuide, type BrandGuide} from "@/lib/template-editor/brand-guide";
import {builtInBrandGuide, builtInBrandGuides, isBuiltInBrandGuide} from "@/lib/template-editor/brand-guide-seed";

/**
 * Brand guides, per workspace owner. Built-in guides ship in code
 * (brand-guide-seed.ts). Saved guides (new brands and edits of built-ins)
 * live in gf_client_state under `brand-guides:<owner>`, or in a local
 * development file when Supabase isn't configured, like page profiles.
 *
 * Every save is a new version. The last versions stay in a history, so a
 * person or an agent can see what changed and restore any of them; a restore
 * is itself a new version, so it can be undone too.
 */

export type GuideAuthor = "person" | "agent";
export interface GuideVersionInfo {version: number; updatedAt: string; savedBy: GuideAuthor; note: string}
export interface ListedBrandGuide extends BrandGuide {
  builtIn: boolean;
  /** A built-in with saved changes for this workspace. */
  overridden: boolean;
  savedBy: GuideAuthor;
  note: string;
}
export const BRAND_GUIDE_STORAGE_LIMITS = {
  savedGuides: 30,
  /** Older versions kept per guide. */
  history: 25,
  /** One version's JSON. Upload images as assets rather than inline them. */
  guideBytes: 1_200_000,
  /** The whole record; the oldest versions are dropped first to stay under it. */
  recordBytes: 6_000_000,
  note: 200,
} as const;

interface StoredVersion {guide: unknown; savedBy: GuideAuthor; note: string}
interface StoredGuide {current: StoredVersion; history: StoredVersion[]}
interface GuideEnvelope {revision: string; guides: Record<string, unknown>}
class RevisionChanged extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

/* ─── Storage ────────────────────────────────────────────────────────────── */

const storageKey = (ownerKey: string) => `brand-guides:${ownerKey}`;
const directory = () => path.join(developmentDirectory("template-editor"), "brand-guides");
const filename = (ownerKey: string) => `${createHash("sha256").update(storageKey(ownerKey)).digest("hex")}.json`;
const CLOUD_TIMEOUT_MS = 15_000;
const unavailable = () => new BrandGuideError("Brand guides are unavailable right now. Retry shortly.", 503);

function checkedOwner(ownerKey: string): string {
  if (typeof ownerKey !== "string" || !ownerKey || ownerKey.length > 300) throw new BrandGuideError("A workspace owner is required.", 401);
  return ownerKey;
}

function readEnvelope(value: unknown): GuideEnvelope | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.revision !== "string" || !isRecord(value.guides)) {
    throw new BrandGuideError("Saved brand guides could not be read. They have not been changed.", 503);
  }
  return {revision: value.revision, guides: value.guides};
}

let fileLock: Promise<unknown> = Promise.resolve();
function withFileLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = fileLock.then(operation, operation);
  fileLock = run.then(() => undefined, () => undefined);
  return run;
}

function assertDevelopmentStorage() {
  if (process.env.NODE_ENV === "production") throw new BrandGuideError("Cloud storage is not configured. No brand guide was saved.", 503);
}

async function readRecord(ownerKey: string): Promise<GuideEnvelope | null> {
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
    if (error instanceof BrandGuideError) throw error;
    throw new BrandGuideError("Saved brand guides could not be read. They have not been changed.", 503);
  }
}

async function writeRecord(ownerKey: string, next: GuideEnvelope, expectedRevision: string | null): Promise<void> {
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
async function mutate<T>(ownerKey: string, update: (guides: Record<string, unknown>) => T): Promise<T> {
  const operation = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = await readRecord(ownerKey);
      const guides = structuredClone(before?.guides ?? {});
      const result = update(guides);
      trimToBudget(guides);
      try {
        await writeRecord(ownerKey, {revision: randomUUID(), guides}, before?.revision ?? null);
        return result;
      } catch (error) {
        if (!(error instanceof RevisionChanged)) throw error;
      }
    }
    throw new BrandGuideError("Brand guides changed in another tab. Retry.", 409);
  };
  return getAdminSupabase() ? operation() : withFileLock(operation);
}

/** Drops the oldest versions, across guides, until the record fits. Current versions are never dropped. */
function trimToBudget(guides: Record<string, unknown>) {
  let size = bytes(guides);
  while (size > BRAND_GUIDE_STORAGE_LIMITS.recordBytes) {
    const oldest = Object.values(guides).filter((entry): entry is StoredGuide => isStored(entry) && entry.history.length > 0)
      .sort((a, b) => versionOf(a.history[0]) - versionOf(b.history[0]))[0];
    if (!oldest) throw new BrandGuideError("Brand guides are too large to save. Upload images as assets instead of pasting them in.", 413);
    oldest.history.shift();
    size = bytes(guides);
  }
}

function isStored(value: unknown): value is StoredGuide {
  return isRecord(value) && isRecord(value.current) && Array.isArray(value.history);
}
const versionOf = (stored: StoredVersion) => isRecord(stored.guide) && typeof stored.guide.version === "number" ? stored.guide.version : 0;
const author = (value: unknown): GuideAuthor => value === "agent" ? "agent" : "person";

function decode(id: string, stored: StoredVersion | undefined): {guide: BrandGuide; savedBy: GuideAuthor; note: string} | null {
  if (!stored || !isRecord(stored.guide)) return null;
  try {
    const guide = parseBrandGuide(stored.guide);
    return guide.id === id ? {guide, savedBy: author(stored.savedBy), note: typeof stored.note === "string" ? stored.note : ""} : null;
  } catch {
    return null;
  }
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

function listed(saved: Record<string, unknown>): ListedBrandGuide[] {
  const builtIns = builtInBrandGuides().map(guide => {
    const entry = saved[guide.id];
    const override = isStored(entry) ? decode(guide.id, entry.current) : null;
    return {...(override?.guide ?? guide), builtIn: true, overridden: Boolean(override), savedBy: override?.savedBy ?? "person", note: override?.note ?? ""};
  });
  const custom = Object.entries(saved)
    .filter(([id]) => !isBuiltInBrandGuide(id))
    .flatMap(([id, entry]) => {
      const current = isStored(entry) ? decode(id, entry.current) : null;
      return current ? [{...current.guide, builtIn: false, overridden: false, savedBy: current.savedBy, note: current.note}] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return [...builtIns, ...custom];
}

/** Built-in guides (with this workspace's edits) followed by saved custom ones. */
export async function listBrandGuides(ownerKey: string): Promise<ListedBrandGuide[]> {
  const record = await readRecord(checkedOwner(ownerKey));
  return listed(record?.guides ?? {});
}

export async function getBrandGuide(ownerKey: string, id: string): Promise<ListedBrandGuide | null> {
  checkedOwner(ownerKey);
  if (!isBrandGuideId(id)) return null;
  return (await listBrandGuides(ownerKey)).find(guide => guide.id === id) ?? null;
}

export type SaveGuideOptions = {
  /** The version the edit started from. A save over a newer version is refused, so nobody loses another's edit. */
  expectedVersion?: number;
  savedBy?: GuideAuthor;
  note?: string;
};

const KNOWN_FIELDS = ["id", "name", "source", "purpose", "personality", "principles", "colors", "accentGradient", "text", "layout", "logos", "examples", "rules", "bannedWords", "hooks"] as const;

/**
 * Create or update a guide. Fields left out keep their current value, so an
 * agent can send only the part it changes. A missing `id` comes from `name`.
 * Returns the new version.
 */
export async function saveBrandGuide(ownerKey: string, input: unknown, options: SaveGuideOptions = {}): Promise<ListedBrandGuide> {
  checkedOwner(ownerKey);
  if (!isRecord(input)) throw new BrandGuideError("A brand guide object is required.");
  const picked: Record<string, unknown> = {};
  for (const field of KNOWN_FIELDS) if (input[field] !== undefined) picked[field] = input[field];
  if (picked.id === undefined && typeof picked.name === "string") picked.id = brandGuideSlug(picked.name);
  if (!isBrandGuideId(picked.id)) throw new BrandGuideError("id must be 1–48 lowercase letters, numbers or dashes.", 400, ["id"]);
  const id = picked.id;
  const note = typeof options.note === "string" ? options.note.trim().slice(0, BRAND_GUIDE_STORAGE_LIMITS.note) : "";
  const savedBy = author(options.savedBy);
  return mutate(ownerKey, guides => {
    const entry = guides[id];
    const stored = isStored(entry) ? entry : null;
    const current = (stored ? decode(id, stored.current)?.guide : null) ?? builtInBrandGuide(id) ?? null;
    if (!current && Object.keys(guides).length >= BRAND_GUIDE_STORAGE_LIMITS.savedGuides) {
      throw new BrandGuideError(`A workspace can save at most ${BRAND_GUIDE_STORAGE_LIMITS.savedGuides} brand guides.`, 413);
    }
    if (options.expectedVersion !== undefined && current && options.expectedVersion !== current.version) {
      throw new BrandGuideError(`This guide is now at version ${current.version}, newer than the version ${options.expectedVersion} you edited. Reload it and apply your change again.`, 409);
    }
    const version = (current?.version ?? 0) + 1;
    const guide = parseBrandGuide({...(current ?? {}), ...picked, id}, {version, updatedAt: new Date().toISOString()});
    if (bytes(guide) > BRAND_GUIDE_STORAGE_LIMITS.guideBytes) throw new BrandGuideError("This guide is too large. Upload logos and examples as assets instead of pasting them in.", 413);
    const history = stored ? [...stored.history, stored.current] : current ? [{guide: current, savedBy: "person" as const, note: "Built-in version"}] : [];
    guides[id] = {current: {guide, savedBy, note}, history: history.slice(-BRAND_GUIDE_STORAGE_LIMITS.history)} satisfies StoredGuide;
    return {...guide, builtIn: isBuiltInBrandGuide(id), overridden: isBuiltInBrandGuide(id), savedBy, note};
  });
}

/** Newest first: the current version, then the saved history. */
export async function brandGuideVersions(ownerKey: string, id: string): Promise<GuideVersionInfo[]> {
  checkedOwner(ownerKey);
  if (!isBrandGuideId(id)) return [];
  const record = await readRecord(ownerKey);
  const entry = record?.guides[id];
  if (!isStored(entry)) {
    const builtIn = builtInBrandGuide(id);
    return builtIn ? [{version: builtIn.version, updatedAt: builtIn.updatedAt, savedBy: "person", note: "Built-in version"}] : [];
  }
  return [entry.current, ...[...entry.history].reverse()].flatMap(stored => {
    const decoded = decode(id, stored);
    return decoded ? [{version: decoded.guide.version, updatedAt: decoded.guide.updatedAt, savedBy: decoded.savedBy, note: decoded.note}] : [];
  });
}

export async function getBrandGuideVersion(ownerKey: string, id: string, version: number): Promise<BrandGuide | null> {
  checkedOwner(ownerKey);
  if (!isBrandGuideId(id) || !Number.isSafeInteger(version)) return null;
  const record = await readRecord(ownerKey);
  const entry = record?.guides[id];
  if (!isStored(entry)) {
    const builtIn = builtInBrandGuide(id);
    return builtIn?.version === version ? builtIn : null;
  }
  for (const stored of [entry.current, ...entry.history]) {
    const decoded = decode(id, stored);
    if (decoded?.guide.version === version) return decoded.guide;
  }
  return null;
}

/** Brings back an earlier version as a new one, so the restore can be undone too. */
export async function restoreBrandGuide(ownerKey: string, id: string, version: number, options: Omit<SaveGuideOptions, "note"> = {}): Promise<ListedBrandGuide> {
  const earlier = await getBrandGuideVersion(ownerKey, id, version);
  if (!earlier) throw new BrandGuideError(`Version ${version} of this guide isn't saved any more.`, 404);
  const {version: _version, updatedAt: _updatedAt, ...content} = earlier;
  void _version; void _updatedAt;
  return saveBrandGuide(ownerKey, content, {...options, note: `Restored version ${version}`});
}

/** Deletes a saved custom guide and its history. Built-ins can't be deleted; restore version 1 instead. */
export async function deleteBrandGuide(ownerKey: string, id: string): Promise<boolean> {
  checkedOwner(ownerKey);
  if (!isBrandGuideId(id)) return false;
  if (isBuiltInBrandGuide(id)) throw new BrandGuideError("Built-in guides can't be deleted. Restore version 1 to go back to the original.", 400);
  const record = await readRecord(ownerKey);
  if (!record || !Object.hasOwn(record.guides, id)) return false;
  return mutate(ownerKey, guides => {
    if (!Object.hasOwn(guides, id)) return false;
    delete guides[id];
    return true;
  });
}

/* ─── Images for critics ─────────────────────────────────────────────────── */

const ASSET_PATH = /^\/api\/template-editor\/assets\/([a-f0-9]{64})(?:\?.*)?$/;
const MAX_EXAMPLE_BYTES = 4_000_000;

/**
 * The guide's example posts as image bytes, for the design critic. Only images
 * Engine itself holds are read: files under public/ and uploaded assets. Others
 * are skipped (the critic still gets their notes in the brief).
 */
export async function guideExampleImages(ownerKey: string, guide: BrandGuide, max = 3): Promise<{name: string; note: string; mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string}[]> {
  const out: {name: string; note: string; mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string}[] = [];
  for (const example of guide.examples) {
    if (out.length >= max) break;
    try {
      const image = await readGuideImage(ownerKey, example.src);
      if (image) out.push({name: example.name, note: example.note, ...image});
    } catch {
      // A missing example never blocks a review.
    }
  }
  return out;
}

const mediaTypeOf = (data: Buffer): "image/jpeg" | "image/png" | "image/webp" | null => {
  if (data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
};

async function readGuideImage(ownerKey: string, src: string): Promise<{mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string} | null> {
  let data: Buffer | null = null;
  const asset = ASSET_PATH.exec(src);
  if (asset) {
    const {originalRendition, readOriginalAsset} = await import("@/lib/template-editor/media-storage");
    const stored = await readOriginalAsset(ownerKey, asset[1]);
    data = stored ? (await originalRendition(stored, 1200)).data : null;
  } else if (src.startsWith("/") && !src.startsWith("//") && !src.includes("..") && /^\/[a-zA-Z0-9_./-]+$/.test(src)) {
    const publicDirectory = path.join(process.cwd(), "public");
    const file = path.join(publicDirectory, src);
    if (!file.startsWith(publicDirectory + path.sep)) return null;
    data = await fs.readFile(file);
  } else if (src.startsWith("data:image/")) {
    const match = /^data:image\/(?:png|jpeg|webp);base64,(.+)$/.exec(src);
    data = match ? Buffer.from(match[1], "base64") : null;
  }
  if (!data || data.length > MAX_EXAMPLE_BYTES) return null;
  const mediaType = mediaTypeOf(data);
  return mediaType ? {mediaType, data: data.toString("base64")} : null;
}
