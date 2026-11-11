import {AgentDeckValidationError} from "./agent-decks";
import {VIDEO_SRC_PATTERN} from "./model";
import {clipFromRecord, readVideoRecord, storeVideoFromUrl, VideoError, type VideoRecord} from "./video-storage";

const MAX_VIDEOS_PER_REQUEST = 20;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** An agent's deck or changes with every `video: {url}` or `video: {src}` turned into a
 * stored clip (`video: {path}` is the MCP bridge's to replace with src first): a link is copied into the workspace's storage first (public MP4/MOV only),
 * an Engine clip path must already be in this workspace. Trim and playback fields are kept;
 * `{remove: true}` is left for update_element. The input itself is never changed. */
export async function resolveAgentVideos<T>(owner: string, value: T, path = "$"): Promise<T> {
  const copies = new Map<string, Promise<VideoRecord>>();
  let count = 0;
  async function resolve(clip: Record<string, unknown>, at: string): Promise<unknown> {
    // A removal, or only trim and playback fields for update_element to apply to the clip already there.
    if (clip.path !== undefined) throw new AgentDeckValidationError("is read by the Engine MCP bridge, which uploads the file and sends src. Over HTTP, store the file with POST /api/agent/videos and send its src", `${at}.path`);
    if (clip.remove === true || (clip.url === undefined && clip.src === undefined)) return clip;
    if (++count > MAX_VIDEOS_PER_REQUEST) throw new AgentDeckValidationError(`allows at most ${MAX_VIDEOS_PER_REQUEST} videos in one request`, at);
    let stored: VideoRecord | null;
    try {
      if (typeof clip.url === "string") {
        if (!copies.has(clip.url)) copies.set(clip.url, storeVideoFromUrl(owner, clip.url));
        stored = await copies.get(clip.url)!;
      } else if (typeof clip.src === "string" && VIDEO_SRC_PATTERN.test(clip.src)) {
        stored = await readVideoRecord(owner, VIDEO_SRC_PATTERN.exec(clip.src)![1]);
        if (!stored) throw new VideoError("is not a video in this workspace", 400);
      } else throw new VideoError("needs url (a public MP4 or MOV link) or src (an Engine video path from engine_get_deck)", 400);

    } catch (error) {
      if (error instanceof AgentDeckValidationError) throw error;
      throw new AgentDeckValidationError(error instanceof Error ? error.message : "could not be stored", at);
    }
    return clipFromRecord(stored, {start: number(clip.start), end: number(clip.end), coverTime: number(clip.coverTime), loop: typeof clip.loop === "boolean" ? clip.loop : undefined, muted: typeof clip.muted === "boolean" ? clip.muted : undefined});
  }
  async function walk(node: unknown, at: string): Promise<unknown> {
    if (Array.isArray(node)) return Promise.all(node.map((item, index) => walk(item, `${at}[${index}]`)));
    if (!record(node)) return node;
    const entries = await Promise.all(Object.entries(node).map(async ([key, child]) => [key, key === "video" && record(child) ? await resolve(child, `${at}.video`) : await walk(child, `${at}.${key}`)] as const));
    return Object.fromEntries(entries);
  }
  return await walk(value, path) as T;
}
