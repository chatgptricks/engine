import {prepareRasterAsset, type PreparedRasterAsset} from "./client-media";
import {MAX_SLIDE_VIDEO_SECONDS, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, VIDEO_MIME_TYPES, VIDEO_SRC_PATTERN, type VideoClip} from "./model";

/** A video ready for a layer: its cover is an ordinary stored image (the layer's
 * `src`), and the clip is stored apart and attached as `video`. */
export type PreparedVideoAsset = PreparedRasterAsset & {video: VideoClip};
type Meta = {id: string; bytes: number; mimeType: string; duration: number; width: number; height: number; name: string};
type Start = {src: string; existing: true} | {mode: "blob"; pathname: string} | {mode: "chunks"; chunkBytes: number; received: number};

export const isVideoFile = (file: File) => (VIDEO_MIME_TYPES as readonly string[]).includes(file.type) || /\.(mp4|m4v|mov|webm)$/i.test(file.name);
const mimeFor = (file: File) => (VIDEO_MIME_TYPES as readonly string[]).includes(file.type) ? file.type : /\.mov$/i.test(file.name) ? "video/quicktime" : /\.webm$/i.test(file.name) ? "video/webm" : "video/mp4";

/** Loads a clip far enough to know its size and length, and to draw frames. */
export function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.preload = "auto"; video.crossOrigin = "anonymous";
    const timer = window.setTimeout(() => reject(new Error("This video took too long to open.")), 30_000);
    video.onloadeddata = () => { window.clearTimeout(timer); resolve(video); };
    video.onerror = () => { window.clearTimeout(timer); reject(new Error("This browser can't play this video. Export it as MP4 (H.264) and try again.")); };
    video.src = src;
  });
}

export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise(resolve => {
    const target = Math.max(0, Math.min(time, (video.duration || 0) - 0.05));
    if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) { resolve(); return; }
    const done = () => { video.removeEventListener("seeked", done); window.clearTimeout(timer); resolve(); };
    const timer = window.setTimeout(done, 5_000);
    video.addEventListener("seeked", done);
    video.currentTime = target;
  });
}

/** The frame on screen now, as a JPEG file at up to 2160 px on its longer side. */
export async function captureFrame(video: HTMLVideoElement, name = "Video cover"): Promise<File> {
  const scale = Math.min(1, 2160 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't take a frame from the video.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("This browser can't take a frame from the video.");
  return new File([blob], `${name.replace(/\.[^.]+$/, "").slice(0, 180)} cover.jpg`, {type: "image/jpeg"});
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function post(body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch("/api/template-editor/videos", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)}); }
  catch { throw new Error("Connect to upload this video. Your design has not changed."); }
  const value = await response.json().catch(() => ({error: "The video upload could not be completed."})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "The video upload could not be completed.");
  return value;
}

/** Stores the clip's bytes (once per workspace; the same file is reused) and returns its `src`. */
export async function storeVideo(file: File, meta: Meta, onProgress?: (fraction: number) => void): Promise<string> {
  const start = await post({action: "start", meta}) as Start;
  if ("existing" in start) { onProgress?.(1); return start.src; }
  if (start.mode === "blob") {
    const {upload} = await import("@vercel/blob/client");
    const stored = await upload(start.pathname, file, {access: "public", handleUploadUrl: "/api/template-editor/videos/blob", clientPayload: JSON.stringify(meta), contentType: meta.mimeType, multipart: file.size > 8 * 1024 * 1024, onUploadProgress: event => onProgress?.(event.percentage / 100)});
    const done = await post({action: "finish", meta, url: stored.url});
    return String(done.src);
  }
  for (let offset = start.received; offset < file.size;) {
    const part = file.slice(offset, offset + start.chunkBytes);
    let response: Response;
    try { response = await fetch(`/api/template-editor/videos/${meta.id}?offset=${offset}&total=${file.size}`, {method: "PUT", headers: {"content-type": "application/octet-stream"}, body: part}); }
    catch { throw new Error("The connection dropped while uploading. Upload the video again to continue where it stopped."); }
    const value = await response.json().catch(() => ({})) as {received?: number; error?: string};
    if (!response.ok || typeof value.received !== "number") throw new Error(value.error ?? "The video upload could not be completed.");
    offset = value.received;
    onProgress?.(offset / file.size);
  }
  const done = await post({action: "finish", meta});
  return String(done.src);
}

/** Reads a video file, takes its cover frame, and stores both. */
export async function prepareVideoAsset(file: File, onProgress?: (fraction: number) => void): Promise<PreparedVideoAsset> {
  if (!isVideoFile(file)) throw new Error("Choose an MP4, MOV or WebM video.");
  if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error(`Choose a video smaller than ${MAX_VIDEO_BYTES / 1024 ** 2} MB.`);
  const url = URL.createObjectURL(file);
  try {
    const video = await loadVideo(url);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("This video has no length Engine can read.");
    if (duration > MAX_VIDEO_SECONDS) throw new Error(`Choose a video up to ${MAX_VIDEO_SECONDS / 60} minutes long. Trim it first.`);
    if (!video.videoWidth || !video.videoHeight) throw new Error("This video has no picture Engine can read.");
    const coverTime = Math.min(1, duration * 0.1);
    await seekVideo(video, coverTime);
    const cover = await prepareRasterAsset(await captureFrame(video, file.name));
    const meta: Meta = {id: await sha256(file), bytes: file.size, mimeType: mimeFor(file), duration, width: video.videoWidth, height: video.videoHeight, name: file.name.slice(0, 200)};
    const src = await storeVideo(file, meta, onProgress);
    if (!VIDEO_SRC_PATTERN.test(src)) throw new Error("The video upload returned invalid data.");
    video.removeAttribute("src"); video.load();
    return {...cover, video: {src, mimeType: meta.mimeType as VideoClip["mimeType"], duration: Math.round(duration * 1000) / 1000, width: meta.width, height: meta.height, bytes: meta.bytes, coverTime, ...(duration > MAX_SLIDE_VIDEO_SECONDS ? {end: MAX_SLIDE_VIDEO_SECONDS} : {})}};
  } finally { URL.revokeObjectURL(url); }
}

/** A new cover from the clip at `time`, stored like any image. */
export async function coverAt(clip: VideoClip, time: number, name: string): Promise<PreparedRasterAsset> {
  const video = await loadVideo(clip.src);
  try { await seekVideo(video, time); return await prepareRasterAsset(await captureFrame(video, name)); }
  finally { video.removeAttribute("src"); video.load(); }
}

/** The part of the clip that plays. */
export const clipWindow = (clip: VideoClip) => ({start: clip.start ?? 0, end: clip.end ?? clip.duration});
export const formatSeconds = (value: number) => { const whole = Math.max(0, value); const minutes = Math.floor(whole / 60); const seconds = whole - minutes * 60; return `${minutes}:${seconds < 10 ? "0" : ""}${seconds.toFixed(1)}`; };
