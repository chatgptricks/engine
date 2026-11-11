/**
 * Agents see a video as its own layer: `{type: "video", src, poster, start, end, loop, muted}`
 * with `src` the clip and `poster` the still that thumbnails, PNG and PDF show. Engine stores
 * it as an image layer whose `src` is the poster and whose `video` is the clip, so everything
 * that knows only photos still works. This turns the agent's form into the stored one, for a
 * deck spec or a list of operations; anything else is left as it is.
 */
import {VIDEO_SRC_PATTERN} from "./model";

/** The poster of a video layer an agent gave none: a dark still. The clip is marked noPoster, which engine_check_deck flags. */
export const MISSING_VIDEO_POSTER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGMQBAMGCAUABaIAzbQvY2oAAAAASUVORK5CYII=";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const CLIP_FIELDS = ["start", "end", "loop", "muted", "coverTime"] as const;
const hasPoster = (poster: unknown) => typeof poster === "string" && poster.length > 0;

/** `src` names the clip: an Engine video path, a link to copy, or (MCP bridge) a local file. */
function clipSource(source: unknown, path: unknown, url: unknown): RecordValue {
  if (path !== undefined) return {path};
  if (url !== undefined) return {url};
  if (typeof source === "string" && VIDEO_SRC_PATTERN.test(source)) return {src: source};
  if (typeof source === "string") return {url: source};
  return {};
}

/** `{type: "video", …}` as the image layer Engine stores. */
export function videoLayerAsImage(input: RecordValue): RecordValue {
  const {src, poster, path, url, video, ...layer} = input;
  const rest: RecordValue = {...layer};
  delete rest.type;
  const clip: RecordValue = {...(record(video) ? video : {}), ...clipSource(src, path, url)};
  for (const key of CLIP_FIELDS) if (rest[key] !== undefined) { clip[key] = rest[key]; delete rest[key]; }
  if (!hasPoster(poster) && path === undefined) clip.noPoster = true;
  // With path and no poster, the MCP bridge makes one from the clip before this runs.
  return {...rest, type: "image", src: hasPoster(poster) ? poster : MISSING_VIDEO_POSTER, video: clip};
}

/** update_element on a video layer: `poster` is the still, `src` an Engine clip path, trim fields change the clip. */
function videoPatch(properties: RecordValue): RecordValue {
  const next = {...properties};
  const clip: RecordValue = record(next.video) ? {...next.video} : {};
  let changed = false;
  if (typeof next.src === "string" && VIDEO_SRC_PATTERN.test(next.src)) { clip.src = next.src; delete next.src; changed = true; }
  if (next.poster !== undefined) { next.src = next.poster; delete next.poster; }
  for (const key of CLIP_FIELDS) if (next[key] !== undefined) { clip[key] = next[key]; delete next[key]; changed = true; }
  if (changed || record(next.video)) next.video = clip;
  return next;
}

export function normalizeVideoLayers<T>(value: T): T {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!record(node)) return node;
    if (node.op === "add_video" && record(node.element)) return node; // Already in stored form.
    if (node.op === "add_video") {
      const {pageId, replaces, index, ...fields} = node;
      const layer: RecordValue = {...fields};
      delete layer.op;
      return {op: "add_video", pageId, ...(replaces !== undefined ? {replaces} : {}), ...(index !== undefined ? {index} : {}), element: videoLayerAsImage({...layer, type: "video"})};
    }
    if (node.op === "update_element" && record(node.properties)) return {...node, properties: videoPatch(node.properties)};
    const next = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    return next.type === "video" ? videoLayerAsImage(next) : next;
  };
  return visit(value) as T;
}
