import {createHash, randomBytes, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {developmentDirectory,readDevelopmentRecord} from "./development-storage";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {prepareReviewSnapshot} from "./review-snapshot";
import {embedReviewImages} from "./review-assets";
import {getEditorLibrary} from "./persistence";
import {packAssets, unpackAssets} from "./library-sync";
import {EMPTY_LIBRARY, parseLibrary, type DesignDocument} from "./model";
export interface ReviewComment {id: string; name: string; text: string; createdAt: string; pageId?: string; resolved?: boolean}
export interface PublicReview {id: string; document: DesignDocument; createdAt: string; expiresAt: string; comments: ReviewComment[]}
interface ReviewRecord extends PublicReview {owner: string; revision: string; assets?: Record<string, string>; revokedAt?: string; lastCommentAt?: number}
const directory = developmentDirectory("template-editor-reviews");
const reviewKey = (token: string) => `template-review:${createHash("sha256").update(token).digest("hex")}`;
let queue: Promise<unknown> = Promise.resolve();
function lock<T>(fn: () => Promise<T>): Promise<T> { const next = queue.then(fn, fn); queue = next.catch(() => undefined); return next; }
function devOnly() { if (process.env.NODE_ENV === "production") throw new Error("Review storage is unavailable."); }
function tokenValid(token: string) { return /^[a-f0-9]{64}$/.test(token); }
async function read(token: string): Promise<ReviewRecord | null> {
  if (!tokenValid(token)) return null;
  const db = getAdminSupabase(); let raw: unknown;
  if (db) {
    const {data, error} = await db.from("gf_client_state").select("data").eq("owner", reviewKey(token)).maybeSingle();
    if (error) throw new Error("Review storage is unavailable."); raw = data?.data;
  } else {
    devOnly(); return readDevelopmentRecord("template-editor-reviews", `${reviewKey(token).split(":")[1]}.json`, decodeReviewRecord);
  }
  return decodeReviewRecord(raw);
}
function decodeReviewRecord(raw: unknown): ReviewRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as ReviewRecord;
  const document = unpackAssets(record.document, record.assets ?? {});
  const parsed = parseLibrary({...EMPTY_LIBRARY, designs: [document]});
  if (!parsed || typeof record.owner !== "string" || typeof record.revision !== "string" || !Number.isFinite(Date.parse(record.expiresAt))) throw new Error("Review could not be read.");
  return {...record, document: parsed.designs[0], comments: Array.isArray(record.comments) ? record.comments : []};
}
async function write(token: string, record: ReviewRecord, expectedRevision: string | null) {
  const packed = await packAssets({...record, assets: undefined});
  const data = {...packed.value, assets: packed.assets}, db = getAdminSupabase();
  if (db) {
    const row = {owner: reviewKey(token), data, updated_at: new Date().toISOString()};
    if (expectedRevision === null) { const {error} = await db.from("gf_client_state").insert(row); if (error) throw new Error("Review could not be saved."); }
    else { const {data: changed, error} = await db.from("gf_client_state").update({data, updated_at: row.updated_at}).eq("owner", row.owner).eq("data->>revision", expectedRevision).select("owner").maybeSingle(); if (error) throw new Error("Review could not be saved."); if (!changed) throw new Error("Review changed. Try again."); }
  } else {
    devOnly(); await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const file = path.join(directory, `${reviewKey(token).split(":")[1]}.json`), temp = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(data), {mode: 0o600}); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => undefined); }
  }
}
export async function createReview(owner: string, documentId: string, days = 7, expectedUpdatedAt?: string): Promise<{token: string; expiresAt: string}> {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Review links can last between 1 and 30 days.");
  const library = await getEditorLibrary(owner), source = library.library.designs.find(item => item.id === documentId && !item.deletedAt);
  if (!source) throw new Error("Save and open a design before sharing it.");
  if ((source.reviewLinks?.length ?? 0) >= 20) throw new Error("This design has reached its 20-review-link limit. Revoke an older link before creating another.");
  if (expectedUpdatedAt && source.updatedAt !== expectedUpdatedAt) throw new Error("This design is still saving. Wait for autosave to finish before creating a review link.");
  // Share only artwork and caption. Internal versions, tags, folders and comments
  // stay inside the authenticated workspace.
  const document: DesignDocument = await embedReviewImages(prepareReviewSnapshot(source));
  const packedArtwork = await packAssets(document);
  if (new TextEncoder().encode(JSON.stringify(packedArtwork)).byteLength > 12 * 1024 * 1024) throw new Error("This review is larger than 12 MB. Use smaller images before sharing.");
  const token = randomBytes(32).toString("hex"), expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  await lock(() => write(token, {id: randomUUID(), owner, revision: randomUUID(), document, createdAt: new Date().toISOString(), expiresAt, comments: []}, null));
  return {token, expiresAt};
}
export async function getPublicReview(token: string): Promise<PublicReview | null> {
  const record = await read(token); if (!record || record.revokedAt || Date.parse(record.expiresAt) <= Date.now()) return null;
  return {id: record.id, document: prepareReviewSnapshot(record.document), createdAt: record.createdAt, expiresAt: record.expiresAt, comments: record.comments};
}
export async function addReviewComment(token: string, input: {name: string; text: string; pageId?: string}): Promise<ReviewComment> {
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80 || typeof input.text !== "string" || !input.text.trim() || input.text.length > 2000) throw new Error("Enter your name and a comment of at most 2,000 characters.");
  return lock(async () => {
    const record = await read(token);
    if (!record || record.revokedAt || Date.parse(record.expiresAt) <= Date.now()) throw new Error("This review link has expired or been revoked.");
    if (record.comments.length >= 100) throw new Error("This review has reached its 100-comment limit.");
    if (Date.now() - (record.lastCommentAt ?? 0) < 2000) throw new Error("Wait a moment before adding another comment.");
    if (input.pageId && !record.document.pages.some(page => page.id === input.pageId)) throw new Error("Choose an existing page.");
    const comment: ReviewComment = {id: randomUUID(), name: input.name.trim(), text: input.text.trim(), createdAt: new Date().toISOString(), ...(input.pageId ? {pageId: input.pageId} : {})};
    await write(token, {...record, comments: [...record.comments, comment], lastCommentAt: Date.now(), revision: randomUUID()}, record.revision);
    return comment;
  });
}
export async function revokeReview(owner: string, token: string): Promise<void> {
  await lock(async () => { const record = await read(token); if (!record || record.owner !== owner) throw new Error("Review link not found."); await write(token, {...record, revokedAt: new Date().toISOString(), revision: randomUUID()}, record.revision); });
}
export async function readOwnerReview(owner: string, token: string): Promise<PublicReview | null> {
  const record = await read(token); if (!record || record.owner !== owner) return null;
  return {id: record.id, document: prepareReviewSnapshot(record.document), createdAt: record.createdAt, expiresAt: record.expiresAt, comments: record.comments};
}
