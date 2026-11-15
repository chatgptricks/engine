import {captionSegments} from "./captions";
import {changesSound, fadeAt, fadesPicture, gainAt, playWindow} from "./clip-timing";
import {splitRichLines} from "./rich-text-editing";
import {MAX_SLIDE_VIDEO_SECONDS, type CanvasElement, type DesignPage, type VideoClip} from "./model";
import {animationPose, isRestPose, pageMotion, stillPageLength, type AnimationPose} from "./animations";

/** Instagram's carousel limits, kept on the safe side of what its guides disagree on. */
export const INSTAGRAM_VIDEO = {minSeconds: 3, maxSeconds: MAX_SLIDE_VIDEO_SECONDS, maxBytes: 100 * 1024 * 1024, maxWidth: 1080};
export const VIDEO_EXPORT_FPS = 30;
export const VIDEO_EXPORT_BITRATE = 8_000_000;

type Photo = {fit: "cover" | "contain"; cropX: number; cropY: number; cropScale?: number; flipX?: boolean; flipY?: boolean};
export type PageVideo = {element: CanvasElement; clip: VideoClip; photo: Photo; others: number; elements?: readonly CanvasElement[]};

/** The clip a page plays when exported: its lowest visible layer with one. A page
 * plays one clip; any others export as their cover (`others` counts them). */
export function pageVideo(page: DesignPage | undefined): PageVideo | undefined {
  const found: PageVideo[] = [];
  for (const element of page?.canvas?.elements ?? []) {
    if (element.hidden) continue;
    if (element.type === "image" && element.video) found.push({element, clip: element.video, photo: {fit: element.fit, cropX: element.cropX, cropY: element.cropY, cropScale: element.cropScale, flipX: element.flipX, flipY: element.flipY}, others: 0});
    else if (element.type === "shape" && element.imageFill?.video) {
      const fill = element.imageFill, video = fill.video!;
      found.push({element, clip: video, photo: {fit: fill.objectFit, cropX: fill.cropX, cropY: fill.cropY, cropScale: fill.cropScale, flipX: fill.flipX, flipY: fill.flipY}, others: 0});
    }
  }
  return found[0] && {...found[0], others: found.length - 1, elements: page?.canvas?.elements};
}

/** How long a page plays in its MP4: its clip's length, or a still page's animation length. */
export function pageLength(elements: readonly CanvasElement[]): number {
  const video = pageVideo({canvas: {elements}} as unknown as DesignPage);
  return video ? videoWindow(video.clip).length : stillPageLength(elements);
}

/** A page that downloads as an MP4: it plays a video, or its layers move. */
export const pageExportsVideo = (page: DesignPage | undefined) => Boolean(pageVideo(page)) || pageMotion(page);

/** The seconds of the clip a slide plays (`duration`, of the file) and how long the slide plays them (`length`). */
export function videoWindow(clip: VideoClip): {start: number; duration: number; speed: number; length: number} {
  const {start, end, speed, length} = playWindow(clip);
  return {start, duration: end - start, speed, length};
}

/** A 2D affine matrix [a, b, c, d, e, f], as canvas `setTransform` takes it. */
export type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const scaling = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0];
const rotation = (degrees: number): Matrix => { const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
export const applyMatrix = (m: Matrix, x: number, y: number) => ({x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5]});

/** Where the clip's picture lands on the page, matching the canvas's CSS for a photo:
 * the layer box rotated about its centre, the crop zoom about the crop point, the
 * photo flipped about its centre, then object-fit and object-position. `scale` turns
 * page units into output pixels. Draw the video at (0, 0, videoWidth, videoHeight). */
export function videoMatrix(box: Pick<CanvasElement, "x" | "y" | "width" | "height" | "rotation">, photo: Photo, video: {width: number; height: number}, scale: number): Matrix {
  const {width: w, height: h} = box, cx = photo.cropX / 100, cy = photo.cropY / 100, zoom = photo.cropScale ?? 1;
  const fit = (photo.fit === "contain" ? Math.min : Math.max)(w / video.width, h / video.height);
  const placed = translate((w - video.width * fit) * cx, (h - video.height * fit) * cy);
  let m = scaling(scale, scale);
  m = multiply(m, translate(box.x + w / 2, box.y + h / 2));
  m = multiply(m, rotation(box.rotation || 0));
  m = multiply(m, translate(-w / 2, -h / 2));
  m = multiply(m, translate(cx * w, cy * h)); m = multiply(m, scaling(zoom, zoom)); m = multiply(m, translate(-cx * w, -cy * h));
  m = multiply(m, translate(w / 2, h / 2)); m = multiply(m, scaling(photo.flipX ? -1 : 1, photo.flipY ? -1 : 1)); m = multiply(m, translate(-w / 2, -h / 2));
  m = multiply(m, placed);
  return multiply(m, scaling(fit, fit));
}

/** Output size for a page: the image export size, at most 1080 px wide, both sides even (H.264). */
export function videoOutputSize(frameWidth: number, frameHeight: number, scale: number) {
  const s = Math.min(scale, INSTAGRAM_VIDEO.maxWidth / frameWidth);
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return {width: even(frameWidth * s), height: even(frameHeight * s), scale: s};
}

/** Why a slide's MP4 came out without sound, in words people read. */
function silentReason(note: string, speed: number): string {
  if (note.includes("no audio track")) return "the video file has no sound, so the MP4 is silent.";
  if (note.includes("can't change its speed")) return `this browser can't play the sound at ${speed}×, so the MP4 is silent. Export in Chrome or Edge to keep it.`;
  if (note.includes("can't copy") || note.includes("no audio added")) return "this browser couldn't read the video's sound, so the MP4 is silent. Export in Chrome or Edge, or upload the clip as an MP4.";
  return `the MP4 is silent: Engine couldn't add the video's sound (${note}).`;
}

/** Warnings for one exported clip, in the words people see in the download notice. */
export function videoExportWarnings(page: number, video: PageVideo, file?: {bytes: number; ext: string; sound?: boolean; audioNote?: string}): string[] {
  const warnings: string[] = [];
  const {length: duration} = videoWindow(video.clip);
  if (duration < INSTAGRAM_VIDEO.minSeconds) warnings.push(`Page ${page}: the video plays ${Math.round(duration * 10) / 10} seconds; Instagram wants at least ${INSTAGRAM_VIDEO.minSeconds}.`);
  const silent = file?.sound && (video.clip.volume ?? 1) > 0 && file.audioNote && !file.audioNote.startsWith("sound included") ? file.audioNote : "";
  if (silent) warnings.push(`Page ${page}: ${silentReason(silent, video.clip.speed ?? 1)}`);
  if (file?.audioNote?.includes("can't change its volume")) warnings.push(`Page ${page}: this browser kept the video's sound as it is, without its volume or fades. Export in Chrome or Edge to apply them.`);
  if (video.others) warnings.push(`Page ${page}: a slide plays one video, so ${video.others === 1 ? "the other video exports" : `${video.others} other videos export`} as ${video.others === 1 ? "its cover" : "their covers"}.`);
  if (file && file.bytes > INSTAGRAM_VIDEO.maxBytes) warnings.push(`Page ${page}: the video file is ${Math.round(file.bytes / 1024 ** 2)} MB; Instagram may refuse files over ${INSTAGRAM_VIDEO.maxBytes / 1024 ** 2} MB.`);
  if (file && file.ext !== "mp4") warnings.push(`Page ${page}: this browser saved the video as ${file.ext.toUpperCase()}; Instagram wants MP4. Export in Chrome or Safari.`);
  return warnings;
}

type Picture = HTMLCanvasElement | ((t: number) => HTMLCanvasElement);
/** The pictures under and over the clip with its captions burned in: `capture` runs once for each
 * different caption (and once for none), with every caption layer showing those words, and each
 * output second picks its own. Without caption layers or cues, one capture. The frame is put back
 * as it was. */
export async function captureCaptioned(layers: HTMLElement[], clip: VideoClip, below: Set<string>, above: Set<string>, captureUnder: () => Promise<HTMLCanvasElement>, captureOver: () => Promise<HTMLCanvasElement>): Promise<{under: Picture; over: Picture}> {
  const nodes = layers.filter(node => node.dataset.captionLayer !== undefined && (below.has(node.dataset.elementId!) || above.has(node.dataset.elementId!)));
  if (!nodes.length || !clip.captions?.length) return {under: await captureUnder(), over: await captureOver()};
  // Only the side that holds a caption layer changes; the other is captured once.
  const changesUnder = nodes.some(node => below.has(node.dataset.elementId!)), changesOver = nodes.some(node => above.has(node.dataset.elementId!));
  const fixedUnder = changesUnder ? undefined : await captureUnder(), fixedOver = changesOver ? undefined : await captureOver();
  const segments = captionSegments(clip);
  const saved = nodes.map(node => { const text = node.querySelector<HTMLElement>(".te-canvas-text"); return {node, text, html: text?.innerHTML ?? "", visibility: node.style.visibility}; });
  const shown = new Map<string | null, {under: HTMLCanvasElement; over: HTMLCanvasElement}>();
  try {
    for (const {text} of segments) {
      if (shown.has(text)) continue;
      for (const item of saved) {
        item.node.style.visibility = text === null ? "hidden" : "visible";
        if (text !== null && item.text) item.text.innerHTML = splitRichLines(undefined, text).map(line => `<div class="te-canvas-text-line"><span>${line || "<br>"}</span></div>`).join("");
      }
      shown.set(text, {under: fixedUnder ?? await captureUnder(), over: fixedOver ?? await captureOver()});
    }
  } finally { for (const item of saved) { item.node.style.visibility = item.visibility; if (item.text) item.text.innerHTML = item.html; } }
  const at = (t: number) => { const segment = segments.find(item => t < item.to) ?? segments.at(-1)!; return shown.get(segment.text)!; };
  return {under: fixedUnder ?? (t => at(t).under), over: fixedOver ?? (t => at(t).over)};
}

/** Draws a layer at an animation pose: `draw` paints it at rest over the whole frame. The
 * move, turn and scale are about the layer's centre and the wipe is cut in its own box, as
 * the canvas's CSS does it; `scale` turns page units into output pixels. */
export function drawPosed(context: CanvasRenderingContext2D, box: Pick<CanvasElement, "x" | "y" | "width" | "height" | "rotation">, pose: AnimationPose, scale: number, draw: () => void) {
  if (pose.opacity <= 0) return;
  context.save();
  context.globalAlpha *= pose.opacity;
  if (pose.blur > 0) context.filter = `blur(${Math.round(pose.blur * scale * 100) / 100}px)`;
  const cx = (box.x + box.width / 2) * scale, cy = (box.y + box.height / 2) * scale, turn = (box.rotation || 0) * Math.PI / 180;
  context.translate(cx + pose.x * scale, cy + pose.y * scale);
  if (pose.rotate) context.rotate(pose.rotate * Math.PI / 180);
  if (pose.scale !== 1) context.scale(pose.scale, pose.scale);
  const {top, right, bottom, left} = pose.clip;
  if (top || right || bottom || left) {
    const w = box.width * scale, h = box.height * scale;
    context.rotate(turn); context.beginPath();
    context.rect(-w / 2 + left * w, -h / 2 + top * h, Math.max(0, w * (1 - left - right)), Math.max(0, h * (1 - top - bottom)));
    context.clip(); context.rotate(-turn);
  }
  context.translate(-cx, -cy);
  draw();
  context.restore();
}

export type StackItem = {still: string[]} | {moving: CanvasElement};
/** Layers in page order cut into runs that hold still and, between them, each layer that moves. */
export function motionStack(order: readonly string[], elements: readonly CanvasElement[]): StackItem[] {
  const byId = new Map(elements.map(element => [element.id, element])), stack: StackItem[] = [];
  for (const id of order) {
    const element = byId.get(id);
    if (element?.animation) { stack.push({moving: element}); continue; }
    const last = stack.at(-1);
    if (last && "still" in last) last.still.push(id); else stack.push({still: [id]});
  }
  return stack;
}

/** One picture of a stack at each second: still runs captured once (each caption change
 * once), moving layers captured alone at rest and drawn at their pose. `first` captures
 * the page's background with the first run. */
async function stackPicture(stack: StackItem[], size: {width: number; height: number}, scale: number, length: number, captureRun: (ids: Set<string>, first: boolean) => Promise<Picture>, captureLayer: (id: string) => Promise<HTMLCanvasElement>, background = false): Promise<Picture> {
  const pictures: {item: StackItem; picture: Picture}[] = [];
  if (background && !(stack[0] && "still" in stack[0])) pictures.push({item: {still: []}, picture: await captureRun(new Set(), true)});
  for (const [index, item] of stack.entries()) pictures.push({item, picture: "still" in item ? await captureRun(new Set(item.still), background && index === 0) : await captureLayer(item.moving.id)});
  const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d")!;
  return (t: number) => {
    context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.filter = "none"; context.clearRect(0, 0, size.width, size.height);
    for (const {item, picture} of pictures) {
      const image = typeof picture === "function" ? picture(t) : picture;
      if ("still" in item) { context.drawImage(image, 0, 0, size.width, size.height); continue; }
      const pose = animationPose(item.moving.animation, t, length, item.moving);
      if (isRestPose(pose)) context.drawImage(image, 0, 0, size.width, size.height);
      else drawPosed(context, item.moving, pose, scale, () => context.drawImage(image, 0, 0, size.width, size.height));
    }
    return canvas;
  };
}

/** Renders one page with its clip playing into a video file. `frame` is the export
 * frame of that page (the same one PNG export captures). */
export async function exportPageVideo(frame: HTMLElement, video: PageVideo, options: {scale: number; sound?: boolean; signal?: AbortSignal; onProgress?: (fraction: number) => void}) {
  const [{domToCanvas}, {encodeComposite}, {loadVideo}] = await Promise.all([import("modern-screenshot"), import("@/lib/engine/export-video"), import("./client-video")]);
  const frameWidth = Number.parseFloat(frame.style.width) || frame.offsetWidth, frameHeight = Number.parseFloat(frame.style.height) || frame.offsetHeight;
  const size = videoOutputSize(frameWidth, frameHeight, options.scale);
  const id = video.element.id;
  const layers = [...frame.querySelectorAll<HTMLElement>("[data-element-id]")];
  const order = layers.map(node => node.dataset.elementId!);
  const at = order.indexOf(id);
  if (at < 0) throw new Error("The video layer isn't on this page. Try the export again.");
  const below = new Set(order.slice(0, at)), above = new Set(order.slice(at + 1));
  const transparent = (node: Node) => { if (node instanceof HTMLElement && node.matches(".te-frame,.te-canvas-scene")) { node.style.background = "transparent"; node.style.backgroundImage = "none"; } };
  const capture = (keep: Set<string>, clear: boolean) => domToCanvas(frame, {
    width: frameWidth, height: frameHeight, scale: size.scale, backgroundColor: clear ? null : "#ffffff",
    filter: node => !(node instanceof HTMLElement && node.dataset.elementId !== undefined && node.hasAttribute("data-element-id")) || keep.has(node.dataset.elementId!),
    onCloneEachNode: clear ? transparent : undefined, fetch: {placeholderImage: ""}, timeout: 15_000,
  });
  options.signal?.throwIfAborted();
  const source = await loadVideo(video.clip.src);
  try {
    const {start, length, speed} = videoWindow(video.clip);
    // Layers that move are drawn at their pose each frame; the rest are captured once.
    const elements = video.elements ?? [], moves = (ids: Set<string>) => elements.some(element => element.animation && ids.has(element.id));
    const blank = document.createElement("canvas"); blank.width = blank.height = 1;
    const run = (ids: Set<string>, first: boolean) => captureCaptioned(layers, video.clip, ids, new Set(), () => capture(ids, !first), async () => blank).then(result => result.under);
    const {under, over} = !moves(below) && !moves(above) ? await captureCaptioned(layers, video.clip, below, above, () => capture(below, false), () => capture(above, true)) : {
      under: await stackPicture(motionStack(order.slice(0, at), elements), size, size.width / frameWidth, length, run, id => capture(new Set([id]), true), true),
      over: await stackPicture(motionStack(order.slice(at + 1), elements), size, size.width / frameWidth, length, run, id => capture(new Set([id]), true)),
    };
    // The layer's own shape (corners, mask, frame outline, opacity): itself alone, its
    // photo swapped for a white one of the clip's proportions.
    const layer = layers[at];
    const image = layer.querySelector<HTMLImageElement>("img.te-canvas-image");
    if (!image) throw new Error("The video layer has no picture to replace. Try the export again.");
    const cover = image.src, white = document.createElement("canvas");
    const ratio = Math.min(1, 64 / Math.max(video.clip.width, video.clip.height));
    white.width = Math.max(1, Math.round(video.clip.width * ratio)); white.height = Math.max(1, Math.round(video.clip.height * ratio));
    const paint = white.getContext("2d")!; paint.fillStyle = "#ffffff"; paint.fillRect(0, 0, white.width, white.height);
    let mask: HTMLCanvasElement, edge: HTMLCanvasElement | undefined;
    try {
      image.src = white.toDataURL("image/png"); await image.decode(); mask = await capture(new Set([id]), true);
      // A border sits over the clip: the layer again with an empty picture leaves the border alone.
      if (video.element.type === "image" && video.element.border) { const empty = document.createElement("canvas"); empty.width = empty.height = 1; image.src = empty.toDataURL("image/png"); await image.decode(); edge = await capture(new Set([id]), true); }
    }
    finally { image.src = cover; await image.decode().catch(() => undefined); }
    const matrix = videoMatrix(video.element, video.photo, {width: source.videoWidth || video.clip.width, height: source.videoHeight || video.clip.height}, size.width / frameWidth);
    // The picture's look (an SVG colour matrix in the page) first, then the layer's own filter.
    const filter = [getComputedStyle(image).filter, getComputedStyle(layer).filter].filter(value => value && value !== "none").join(" ");
    const blend = video.element.blendMode && video.element.blendMode !== "normal" ? video.element.blendMode as GlobalCompositeOperation : "source-over";
    const scratch = document.createElement("canvas"); scratch.width = size.width; scratch.height = size.height;
    const layerContext = scratch.getContext("2d")!;
    const clip = video.clip, fades = fadesPicture(clip);
    const drawVideo = (context: CanvasRenderingContext2D, t: number) => {
      layerContext.setTransform(1, 0, 0, 1, 0, 0); layerContext.globalCompositeOperation = "source-over"; layerContext.clearRect(0, 0, size.width, size.height);
      layerContext.filter = filter && filter !== "none" ? filter : "none";
      layerContext.setTransform(...matrix); layerContext.drawImage(source, 0, 0, source.videoWidth, source.videoHeight);
      layerContext.setTransform(1, 0, 0, 1, 0, 0); layerContext.filter = "none";
      layerContext.globalCompositeOperation = "destination-in"; layerContext.drawImage(mask, 0, 0, size.width, size.height);
      // A fade shows the layers below through the clip, as on the canvas.
      context.save(); context.globalCompositeOperation = blend; if (fades) context.globalAlpha = fadeAt(clip, t);
      const pose = animationPose(video.element.animation, t, length, video.element);
      drawPosed(context, video.element, pose, size.width / frameWidth, () => { context.drawImage(scratch, 0, 0); if (edge) context.drawImage(edge, 0, 0, size.width, size.height); });
      context.restore();
    };
    return await encodeComposite({video: source, under, over, drawVideo, width: size.width, height: size.height, fps: VIDEO_EXPORT_FPS, duration: length, startAt: start, speed, gain: changesSound(clip) ? (t: number) => gainAt(clip, t) : undefined, withAudio: options.sound !== false, bitrate: VIDEO_EXPORT_BITRATE, signal: options.signal, onProgress: options.onProgress});
  } finally { source.removeAttribute("src"); source.load(); }
}

/** Renders a still page whose layers move into a silent MP4, as long as `stillPageLength`
 * says. `frame` is the page's export frame, as for PNG. */
export async function exportPageMotion(frame: HTMLElement, page: DesignPage, options: {scale: number; signal?: AbortSignal; onProgress?: (fraction: number) => void}): Promise<{blob: Blob; ext: string; length: number}> {
  if (typeof window === "undefined" || !("VideoEncoder" in window)) throw new Error("This browser can't export animated pages. Try Chrome, Edge or Safari.");
  const [{domToCanvas}, {Muxer, ArrayBufferTarget}] = await Promise.all([import("modern-screenshot"), import("mp4-muxer")]);
  const frameWidth = Number.parseFloat(frame.style.width) || frame.offsetWidth, frameHeight = Number.parseFloat(frame.style.height) || frame.offsetHeight;
  const size = videoOutputSize(frameWidth, frameHeight, options.scale), elements = page.canvas?.elements ?? [];
  const length = stillPageLength(elements);
  const order = [...frame.querySelectorAll<HTMLElement>("[data-element-id]")].map(node => node.dataset.elementId!);
  const transparent = (node: Node) => { if (node instanceof HTMLElement && node.matches(".te-frame,.te-canvas-scene")) { node.style.background = "transparent"; node.style.backgroundImage = "none"; } };
  const capture = (keep: Set<string>, clear: boolean) => domToCanvas(frame, {
    width: frameWidth, height: frameHeight, scale: size.scale, backgroundColor: clear ? null : "#ffffff",
    filter: node => !(node instanceof HTMLElement && node.dataset.elementId !== undefined && node.hasAttribute("data-element-id")) || keep.has(node.dataset.elementId!),
    onCloneEachNode: clear ? transparent : undefined, fetch: {placeholderImage: ""}, timeout: 15_000,
  });
  const picture = await stackPicture(motionStack(order, elements), size, size.width / frameWidth, length, (ids, first) => capture(ids, !first), id => capture(new Set([id]), true), true);
  options.signal?.throwIfAborted();
  const config: VideoEncoderConfig = {codec: "avc1.640028", width: size.width, height: size.height, bitrate: VIDEO_EXPORT_BITRATE, framerate: VIDEO_EXPORT_FPS};
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error("This browser can't encode H.264 video.");
  const muxer = new Muxer({target: new ArrayBufferTarget(), video: {codec: "avc", width: size.width, height: size.height}, fastStart: "in-memory"});
  let failed: unknown = null;
  const encoder = new VideoEncoder({output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: error => { failed = error; }});
  encoder.configure(config);
  const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d")!;
  const frames = Math.max(1, Math.round(length * VIDEO_EXPORT_FPS));
  try {
    for (let index = 0; index < frames; index++) {
      if (failed) throw failed;
      options.signal?.throwIfAborted();
      const t = index / VIDEO_EXPORT_FPS;
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, size.width, size.height);
      context.drawImage(typeof picture === "function" ? picture(t) : picture, 0, 0);
      const videoFrame = new VideoFrame(canvas, {timestamp: Math.round(t * 1_000_000), duration: Math.round(1_000_000 / VIDEO_EXPORT_FPS)});
      encoder.encode(videoFrame, {keyFrame: index % (VIDEO_EXPORT_FPS * 4) === 0}); videoFrame.close();
      while (encoder.encodeQueueSize > 4) await new Promise(resolve => encoder.addEventListener("dequeue", resolve, {once: true}));
      options.onProgress?.((index + 1) / frames);
    }
    await encoder.flush();
    if (failed) throw failed;
  } finally { if (encoder.state !== "closed") encoder.close(); }
  muxer.finalize();
  return {blob: new Blob([muxer.target.buffer], {type: "video/mp4"}), ext: "mp4", length};
}
