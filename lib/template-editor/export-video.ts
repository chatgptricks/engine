import {MAX_SLIDE_VIDEO_SECONDS, type CanvasElement, type DesignPage, type VideoClip} from "./model";

/** Instagram's carousel limits, kept on the safe side of what its guides disagree on. */
export const INSTAGRAM_VIDEO = {minSeconds: 3, maxSeconds: MAX_SLIDE_VIDEO_SECONDS, maxBytes: 100 * 1024 * 1024, maxWidth: 1080};
export const VIDEO_EXPORT_FPS = 30;
export const VIDEO_EXPORT_BITRATE = 8_000_000;

type Photo = {fit: "cover" | "contain"; cropX: number; cropY: number; cropScale?: number; flipX?: boolean; flipY?: boolean};
export type PageVideo = {element: CanvasElement; clip: VideoClip; photo: Photo; others: number};

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
  return found[0] && {...found[0], others: found.length - 1};
}

/** The seconds of the clip a slide plays. */
export function videoWindow(clip: VideoClip): {start: number; duration: number} {
  const start = Math.max(0, Math.min(clip.start ?? 0, clip.duration - 0.1));
  const end = Math.min(clip.end ?? clip.duration, clip.duration, start + MAX_SLIDE_VIDEO_SECONDS);
  return {start, duration: Math.max(0.1, end - start)};
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

/** Warnings for one exported clip, in the words people see in the download notice. */
export function videoExportWarnings(page: number, video: PageVideo, file?: {bytes: number; ext: string}): string[] {
  const warnings: string[] = [];
  const {duration} = videoWindow(video.clip);
  if (duration < INSTAGRAM_VIDEO.minSeconds) warnings.push(`Page ${page}: the video plays ${Math.round(duration * 10) / 10} seconds; Instagram wants at least ${INSTAGRAM_VIDEO.minSeconds}.`);
  if (video.others) warnings.push(`Page ${page}: a slide plays one video, so ${video.others === 1 ? "the other video exports" : `${video.others} other videos export`} as ${video.others === 1 ? "its cover" : "their covers"}.`);
  if (file && file.bytes > INSTAGRAM_VIDEO.maxBytes) warnings.push(`Page ${page}: the video file is ${Math.round(file.bytes / 1024 ** 2)} MB; Instagram may refuse files over ${INSTAGRAM_VIDEO.maxBytes / 1024 ** 2} MB.`);
  if (file && file.ext !== "mp4") warnings.push(`Page ${page}: this browser saved the video as ${file.ext.toUpperCase()}; Instagram wants MP4. Export in Chrome or Safari.`);
  return warnings;
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
    const under = await capture(below, false);
    const over = await capture(above, true);
    // The layer's own shape (corners, mask, frame outline, opacity): itself alone, its
    // photo swapped for a white one of the clip's proportions.
    const layer = layers[at];
    const image = layer.querySelector<HTMLImageElement>("img.te-canvas-image");
    if (!image) throw new Error("The video layer has no picture to replace. Try the export again.");
    const cover = image.src, white = document.createElement("canvas");
    const ratio = Math.min(1, 64 / Math.max(video.clip.width, video.clip.height));
    white.width = Math.max(1, Math.round(video.clip.width * ratio)); white.height = Math.max(1, Math.round(video.clip.height * ratio));
    const paint = white.getContext("2d")!; paint.fillStyle = "#ffffff"; paint.fillRect(0, 0, white.width, white.height);
    let mask: HTMLCanvasElement;
    try { image.src = white.toDataURL("image/png"); await image.decode(); mask = await capture(new Set([id]), true); }
    finally { image.src = cover; await image.decode().catch(() => undefined); }
    const matrix = videoMatrix(video.element, video.photo, {width: source.videoWidth || video.clip.width, height: source.videoHeight || video.clip.height}, size.width / frameWidth);
    const filter = getComputedStyle(layer).filter;
    const blend = video.element.blendMode && video.element.blendMode !== "normal" ? video.element.blendMode as GlobalCompositeOperation : "source-over";
    const scratch = document.createElement("canvas"); scratch.width = size.width; scratch.height = size.height;
    const layerContext = scratch.getContext("2d")!;
    const drawVideo = (context: CanvasRenderingContext2D) => {
      layerContext.setTransform(1, 0, 0, 1, 0, 0); layerContext.globalCompositeOperation = "source-over"; layerContext.clearRect(0, 0, size.width, size.height);
      layerContext.filter = filter && filter !== "none" ? filter : "none";
      layerContext.setTransform(...matrix); layerContext.drawImage(source, 0, 0, source.videoWidth, source.videoHeight);
      layerContext.setTransform(1, 0, 0, 1, 0, 0); layerContext.filter = "none";
      layerContext.globalCompositeOperation = "destination-in"; layerContext.drawImage(mask, 0, 0, size.width, size.height);
      context.save(); context.globalCompositeOperation = blend; context.drawImage(scratch, 0, 0); context.restore();
    };
    const {start, duration} = videoWindow(video.clip);
    return await encodeComposite({video: source, under, over, drawVideo, width: size.width, height: size.height, fps: VIDEO_EXPORT_FPS, duration, startAt: start, withAudio: options.sound !== false, bitrate: VIDEO_EXPORT_BITRATE, signal: options.signal, onProgress: options.onProgress});
  } finally { source.removeAttribute("src"); source.load(); }
}
