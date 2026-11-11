import {createHash, randomUUID} from "node:crypto";
import {createReadStream, promises as fs} from "node:fs";
import os from "node:os";
import path from "node:path";
import {head, put} from "@vercel/blob";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {developmentDirectory} from "./development-storage";
import {MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, VIDEO_MIME_TYPES, type VideoClip} from "./model";
import {readMp4Info, sniffVideo} from "./mp4-info";
import {guardedGet} from "./review-assets";

/** Clips are stored apart from decks: a deck keeps only `/api/template-editor/videos/<sha256>`.
 * With Vercel Blob connected (production), the browser sends the file straight
 * to Blob and the record points at it; without it (development), the file is
 * sent in 4 MB parts, because the `/api` proxy buffers at most 10 MB of a body,
 * and kept on disk. Records hold only facts about the file, never the bytes. */
export const VIDEO_QUOTA_BYTES = 10 * 1024 ** 3;
export const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;
export type VideoMimeType = (typeof VIDEO_MIME_TYPES)[number];
export type VideoRecord = {version: 1; id: string; owner: string; mimeType: VideoMimeType; bytes: number; duration: number; width: number; height: number; name: string; createdAt: string; blobUrl?: string};
export type VideoMeta = {id: string; bytes: number; mimeType: string; duration: number; width: number; height: number; name?: string};

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const ownerTag = (owner: string) => hash(`template-editor:${owner}`).slice(0, 24);
const recordKey = (owner: string, id: string) => `template-editor-video:${ownerTag(owner)}:${id}`;
export const videoSrc = (id: string) => `/api/template-editor/videos/${id}`;
export const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const directory = () => developmentDirectory("template-editor-video");
const filePath = (owner: string, id: string) => path.join(directory(), `${hash(recordKey(owner, id))}.bin`);
const partPath = (owner: string, id: string) => path.join(directory(), `${hash(recordKey(owner, id))}.part`);
const recordPath = (owner: string, id: string) => path.join(directory(), `${hash(recordKey(owner, id))}.json`);
const extension: Record<VideoMimeType, string> = {"video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm"};
export const blobPathPrefix = (owner: string, id: string) => `te-video/${ownerTag(owner)}/${id}`;

export class VideoError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const unavailable = () => new VideoError("Video storage is unavailable. Retry when connected.", 503);

function development() {
  if (process.env.NODE_ENV === "production") throw unavailable();
}
function decode(value: unknown): VideoRecord {
  const record = value as Partial<VideoRecord> | null;
  if (!record || record.version !== 1 || typeof record.id !== "string" || !/^[a-f0-9]{64}$/.test(record.id) || typeof record.owner !== "string" || !VIDEO_MIME_TYPES.includes(record.mimeType as VideoMimeType) || !Number.isFinite(record.bytes) || !Number.isFinite(record.duration) || !Number.isFinite(record.width) || !Number.isFinite(record.height)) throw new Error("A stored video record is damaged.");
  return record as VideoRecord;
}

/** Checks the facts the browser reports before anything is stored. */
export function checkVideoMeta(value: unknown): VideoMeta {
  const meta = value as Partial<VideoMeta> | null;
  if (!meta || typeof meta.id !== "string" || !/^[a-f0-9]{64}$/.test(meta.id)) throw new VideoError("This video could not be read.", 400);
  if (!VIDEO_MIME_TYPES.includes(meta.mimeType as VideoMimeType)) throw new VideoError("Choose an MP4, MOV or WebM video.", 415);
  if (typeof meta.bytes !== "number" || !Number.isInteger(meta.bytes) || meta.bytes < 1) throw new VideoError("This video could not be read.", 400);
  if (meta.bytes > MAX_VIDEO_BYTES) throw new VideoError(`Choose a video smaller than ${MAX_VIDEO_BYTES / 1024 ** 2} MB.`, 413);
  if (typeof meta.duration !== "number" || !Number.isFinite(meta.duration) || meta.duration <= 0) throw new VideoError("This video could not be read.", 400);
  if (meta.duration > MAX_VIDEO_SECONDS) throw new VideoError(`Choose a video up to ${MAX_VIDEO_SECONDS / 60} minutes long.`, 413);
  if (typeof meta.width !== "number" || typeof meta.height !== "number" || !(meta.width >= 1 && meta.width <= 16_384 && meta.height >= 1 && meta.height <= 16_384)) throw new VideoError("This video could not be read.", 400);
  return {id: meta.id, bytes: meta.bytes, mimeType: meta.mimeType as VideoMimeType, duration: meta.duration, width: Math.round(meta.width), height: Math.round(meta.height), name: typeof meta.name === "string" ? meta.name.slice(0, 200) : "Video"};
}

export async function readVideoRecord(owner: string, id: string): Promise<VideoRecord | null> {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const db = getAdminSupabase();
  if (db) {
    const {data, error} = await db.from("gf_client_state").select("data").eq("owner", recordKey(owner, id)).maybeSingle();
    if (error) throw unavailable();
    return data ? decode(data.data) : null;
  }
  development();
  try { return decode(JSON.parse(await fs.readFile(recordPath(owner, id), "utf8"))); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; }
}

async function writeRecord(owner: string, record: VideoRecord): Promise<void> {
  const db = getAdminSupabase();
  if (db) {
    const {error} = await db.from("gf_client_state").upsert({owner: recordKey(owner, record.id), data: record, updated_at: new Date().toISOString()}, {onConflict: "owner"});
    if (error) throw new VideoError("The video could not be saved. Retry when connected.", 503);
    return;
  }
  development();
  await fs.mkdir(directory(), {recursive: true, mode: 0o700});
  const temporary = path.join(directory(), `${randomUUID()}.tmp`);
  try { await fs.writeFile(temporary, JSON.stringify(record), {mode: 0o600}); await fs.rename(temporary, recordPath(owner, record.id)); }
  finally { await fs.unlink(temporary).catch(() => undefined); }
}

/** Bytes of video this workspace keeps. */
export async function videoUsage(owner: string): Promise<number> {
  const db = getAdminSupabase();
  if (db) {
    const {data, error} = await db.from("gf_client_state").select("data").like("owner", `template-editor-video:${ownerTag(owner)}:%`);
    if (error) throw unavailable();
    return (data ?? []).reduce((total, row) => total + (Number((row.data as VideoRecord)?.bytes) || 0), 0);
  }
  development();
  let names: string[] = [];
  try { names = await fs.readdir(directory()); } catch { return 0; }
  let total = 0;
  for (const name of names.filter(name => name.endsWith(".json"))) {
    try { const record = decode(JSON.parse(await fs.readFile(path.join(directory(), name), "utf8"))); if (record.owner === ownerTag(owner)) total += record.bytes; } catch { /* Skip a damaged record; it still holds no quota. */ }
  }
  return total;
}

async function checkQuota(owner: string, bytes: number) {
  const used = await videoUsage(owner);
  if (used + bytes > VIDEO_QUOTA_BYTES) throw new VideoError(`This workspace keeps ${(used / 1024 ** 3).toFixed(1)} GB of video, and the limit is ${VIDEO_QUOTA_BYTES / 1024 ** 3} GB. Remove unused videos first.`, 413);
}

export type UploadStart = {src: string; existing: true; record: VideoRecord} | {mode: "blob"; pathname: string} | {mode: "chunks"; chunkBytes: number; received: number};
/** Step 1 of an upload: a clip the workspace already has is reused, otherwise the browser is told where to send it. */
export async function beginVideoUpload(owner: string, meta: VideoMeta): Promise<UploadStart> {
  const existing = await readVideoRecord(owner, meta.id);
  if (existing) return {src: videoSrc(meta.id), existing: true, record: existing};
  await checkQuota(owner, meta.bytes);
  if (blobConfigured()) return {mode: "blob", pathname: `${blobPathPrefix(owner, meta.id)}.${extension[meta.mimeType as VideoMimeType]}`};
  development();
  let received = 0;
  try { received = (await fs.stat(partPath(owner, meta.id))).size; } catch { /* A new upload starts at 0. */ }
  return {mode: "chunks", chunkBytes: VIDEO_CHUNK_BYTES, received: received <= meta.bytes ? received : 0};
}

/** Development: adds one part at `offset`, which must be where the file ends now. */
export async function appendVideoChunk(owner: string, id: string, offset: number, data: Buffer, total: number): Promise<number> {
  development();
  if (!/^[a-f0-9]{64}$/.test(id) || !Number.isInteger(offset) || offset < 0 || data.length < 1 || data.length > VIDEO_CHUNK_BYTES || offset + data.length > Math.min(total, MAX_VIDEO_BYTES)) throw new VideoError("This part of the video doesn't fit.", 400);
  await fs.mkdir(directory(), {recursive: true, mode: 0o700});
  const target = partPath(owner, id);
  let size = 0;
  try { size = (await fs.stat(target)).size; } catch { /* First part. */ }
  if (offset !== size) throw new VideoError(`Resume the upload at byte ${size}.`, 409);
  await fs.appendFile(target, data, {mode: 0o600});
  return size + data.length;
}

async function fileInfo(file: string, claimed: VideoMeta | null): Promise<{mimeType: VideoMimeType; duration: number; width: number; height: number}> {
  const handle = await fs.open(file, "r");
  try {
    const {size} = await handle.stat();
    const read = async (offset: number, length: number) => { const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset))); await handle.read(buffer, 0, buffer.length, offset); return buffer; };
    const kind = sniffVideo(await read(0, 16));
    if (!kind) throw new VideoError("This file isn't a video Engine can play. Choose an MP4, MOV or WebM video.", 415);
    if (kind === "video/webm") {
      if (!claimed) throw new VideoError("Use an MP4 or MOV link; WebM can only be uploaded from the editor.", 415);
      return {mimeType: kind, duration: claimed.duration, width: claimed.width, height: claimed.height};
    }
    const info = await readMp4Info(read, size);
    if (!info) throw new VideoError("This video's header couldn't be read. Export it again as MP4 (H.264).", 415);
    return {mimeType: kind, duration: info.duration, width: info.width, height: info.height};
  } finally { await handle.close(); }
}

async function sha256File(file: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

function recordFrom(owner: string, id: string, bytes: number, info: {mimeType: VideoMimeType; duration: number; width: number; height: number}, name: string, blobUrl?: string): VideoRecord {
  if (info.duration > MAX_VIDEO_SECONDS) throw new VideoError(`Choose a video up to ${MAX_VIDEO_SECONDS / 60} minutes long.`, 413);
  if (info.duration <= 0) throw new VideoError("This video has no length.", 415);
  return {version: 1, id, owner: ownerTag(owner), mimeType: info.mimeType, bytes, duration: Math.round(info.duration * 1000) / 1000, width: info.width, height: info.height, name, createdAt: new Date().toISOString(), ...(blobUrl ? {blobUrl} : {})};
}

/** Development: the last step of a parted upload. The bytes must hash to the id. */
export async function finishChunkedUpload(owner: string, meta: VideoMeta): Promise<VideoRecord> {
  development();
  const part = partPath(owner, meta.id);
  let size = 0;
  try { size = (await fs.stat(part)).size; } catch { throw new VideoError("Nothing was uploaded for this video.", 409); }
  if (size !== meta.bytes) throw new VideoError(`Only ${size} of ${meta.bytes} bytes arrived.`, 409);
  if (await sha256File(part) !== meta.id) { await fs.unlink(part).catch(() => undefined); throw new VideoError("The uploaded video doesn't match the file. Upload it again.", 409); }
  let record: VideoRecord;
  try { record = recordFrom(owner, meta.id, size, await fileInfo(part, meta), meta.name ?? "Video"); }
  catch (error) { await fs.unlink(part).catch(() => undefined); throw error; }
  await fs.rename(part, filePath(owner, meta.id));
  await writeRecord(owner, record);
  return record;
}

/** Production: records a clip the browser sent to Blob, after checking it is this workspace's file and its size. */
export async function finishBlobUpload(owner: string, meta: VideoMeta, url: string): Promise<VideoRecord> {
  if (!blobConfigured()) throw unavailable();
  let pathname = "";
  try { const parsed = new URL(url); if (parsed.protocol !== "https:" || !/(^|\.)blob\.vercel-storage\.com$/.test(parsed.hostname)) throw new Error(); pathname = decodeURIComponent(parsed.pathname.slice(1)); } catch { throw new VideoError("That isn't one of Engine's video files.", 400); }
  if (!pathname.startsWith(blobPathPrefix(owner, meta.id))) throw new VideoError("That isn't one of this workspace's video files.", 403);
  const stored = await head(url).catch(() => null);
  if (!stored) throw new VideoError("The uploaded video can't be found. Upload it again.", 409);
  if (stored.size !== meta.bytes) throw new VideoError("The uploaded video doesn't match the file. Upload it again.", 409);
  const record = recordFrom(owner, meta.id, stored.size, {mimeType: meta.mimeType as VideoMimeType, duration: meta.duration, width: meta.width, height: meta.height}, meta.name ?? "Video", stored.url);
  await writeRecord(owner, record);
  return record;
}

/** Development: the stored file for serving with Range. */
export async function videoFile(owner: string, id: string): Promise<string | null> {
  development();
  const file = filePath(owner, id);
  try { await fs.access(file); return file; } catch { return null; }
}

/** Agents: copies a public MP4/MOV link into this workspace's storage (private hosts refused, size capped). */
export async function storeVideoFromUrl(owner: string, url: string): Promise<VideoRecord> {
  const temporary = path.join(os.tmpdir(), `engine-video-${randomUUID()}`);
  try {
    const response = await guardedGet(url, "video/mp4,video/quicktime;q=0.9", 30_000).catch((error: Error) => { throw new VideoError(`The video at ${url} couldn't be fetched: ${error.message}`, 400); });
    if (response.statusCode !== 200 || !/^(video\/(mp4|quicktime)|application\/octet-stream|binary\/octet-stream)(;|$)/i.test(response.headers["content-type"] ?? "")) { response.destroy(); throw new VideoError(`The link isn't an MP4 or MOV video (status ${response.statusCode}, ${response.headers["content-type"] ?? "no type"}).`, 400); }
    const declared = Number(response.headers["content-length"] ?? 0);
    if (declared > MAX_VIDEO_BYTES) { response.destroy(); throw new VideoError(`The video is larger than ${MAX_VIDEO_BYTES / 1024 ** 2} MB.`, 413); }
    const output = await fs.open(temporary, "w", 0o600);
    let size = 0;
    const digest = createHash("sha256");
    try {
      for await (const chunk of response) {
        const buffer = Buffer.from(chunk as Buffer); size += buffer.length;
        if (size > MAX_VIDEO_BYTES) { response.destroy(); throw new VideoError(`The video is larger than ${MAX_VIDEO_BYTES / 1024 ** 2} MB.`, 413); }
        digest.update(buffer); await output.write(buffer);
      }
    } finally { await output.close(); }
    if (!size) throw new VideoError("The video link returned nothing.", 400);
    const id = digest.digest("hex");
    const existing = await readVideoRecord(owner, id);
    if (existing) return existing;
    const info = await fileInfo(temporary, null);
    // Every check comes before anything is stored, so a refused clip leaves nothing behind.
    const record = recordFrom(owner, id, size, info, path.basename(new URL(url).pathname).slice(0, 200) || "Video");
    await checkQuota(owner, size);
    if (blobConfigured()) {
      const stored = await put(`${blobPathPrefix(owner, id)}.${extension[info.mimeType]}`, createReadStream(temporary), {access: "public", contentType: info.mimeType, addRandomSuffix: true, multipart: size > 8 * 1024 * 1024});
      record.blobUrl = stored.url;
    } else {
      development();
      await fs.mkdir(directory(), {recursive: true, mode: 0o700});
      await fs.copyFile(temporary, filePath(owner, id));
    }
    await writeRecord(owner, record);
    return record;
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}

/** The clip a deck stores for a record, with the trim and playback options given. */
export function clipFromRecord(record: VideoRecord, options: Partial<Pick<VideoClip, "start" | "end" | "loop" | "muted" | "coverTime">> = {}): VideoClip {
  const clip: VideoClip = {src: videoSrc(record.id), mimeType: record.mimeType, duration: record.duration, width: record.width, height: record.height, bytes: record.bytes};
  for (const key of ["start", "end", "loop", "muted", "coverTime"] as const) if (options[key] !== undefined) Object.assign(clip, {[key]: options[key]});
  return clip;
}
