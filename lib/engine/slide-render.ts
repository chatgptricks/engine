import type {Browser, BrowserContext, LaunchOptions, Route} from "playwright";
import {formatDimensions, type DesignDocument} from "@/lib/template-editor/model";
import {createRenderToken, revokeRenderToken} from "./render-tokens";

/**
 * Server-side slide renderer: PNGs of a design's pages exactly as Engine's
 * export draws them, for the design critic and previews. Each page is opened
 * in headless Chromium on the private render page (`/engine/render/[token]`),
 * which prepares the page as the editor's export does (smart text baked after
 * fonts load, image dimensions confirmed, memory budget checked) and mounts
 * the editor's own export frame (DesignFrame with outputScale). The frame is
 * laid out on the 360-wide canvas and captured at width / 360 device pixels
 * per CSS pixel, as the editor's PNG export does, so a 1080×1440 design yields
 * 1080×1440 PNGs.
 *
 * Headless Chromium has no session cookie, so the private endpoints the export
 * uses (`/api/template-editor/assets/…`, its `metadata` lookup and
 * `/api/engine/img?u=`) are answered here, in process, for `ownerKey`'s
 * workspace only; every other `/api/` request from the render page is refused.
 *
 * One shared browser renders one page at a time, within a 60 s budget per
 * call. When Chromium cannot launch (not installed, no sandbox), renderSlides
 * returns null and logs the reason once, so callers can fall back to geometry
 * checks.
 *
 * Each page is also measured in the render page, as drawn (`measures`): every
 * layer's box after smart layout, and inside HTML layers each run of words
 * (its font size on the slide, its box, whether something cuts it off) and
 * each picture. Recreate's review checks them (agents/review-checks.ts).
 */
/** A box in scene px (the 360-wide canvas the frame is laid out on, so output px × 360 / the slide's width), from the page's top-left corner. */
export type MeasuredBox = {x: number; y: number; width: number; height: number};
/** Words inside an HTML layer, as the render page laid them out: one text node. */
export type MeasuredText = {
  layerId: string;
  /** The words, up to 120 characters. */
  text: string;
  /** Their font size on the slide, in scene px: the CSS size times every scale above it (the layer's, an SVG's viewBox, transforms). */
  size: number;
  box: MeasuredBox;
  /** Part of the words is cut off: by the layer's own edge, a box inside it that hides what overflows (an SVG's too), or the page's edge. */
  clipped: boolean;
};
/** A picture inside an HTML layer: an <img>, an SVG <image> or a CSS background image, with the part of it the layer shows. */
export type MeasuredImage = {layerId: string; src: string; box: MeasuredBox};
export type SlideMeasures = {
  /** Every layer drawn on the page, by element id, where smart layout put it (a rotated layer's box is the box around it). */
  layers: {id: string; box: MeasuredBox}[];
  texts: MeasuredText[];
  images: MeasuredImage[];
};
/** `exportError` is set when the editor's Export would refuse this page (for
 * example "Shorten “Post text” before exporting…"); the PNG then shows the
 * page as the editor's canvas draws it. `measures` is missing when the page
 * couldn't be measured. */
export type SlideRender = {pageId: string; png: Buffer; exportError?: string; measures?: SlideMeasures};
export type SlideBrowserLauncher = () => Promise<Browser>;
export type RenderSlidesOptions = {
  pageIds?: string[];
  signal?: AbortSignal;
  /** Workspace whose private originals the slides use; without it they render as missing. */
  ownerKey?: string;
  /** Tests inject a browser here; the default launches Playwright's Chromium. */
  launch?: SlideBrowserLauncher;
  /** Total time for the call, launch included. Defaults to 60 s. */
  budgetMs?: number;
};

const FRAME_WIDTH = 360; // components/template-editor/preview.tsx
const BUDGET_MS = 60_000;
/** Enough for a chart's every label; past these a page's measures stop. */
const MAX_MEASURED_TEXTS = 400, MAX_MEASURED_IMAGES = 120;
const LAUNCH_RETRY_MS = 5 * 60_000;
const PRIVATE_ASSET = /^\/api\/template-editor\/assets\/([a-f0-9]{64})$/;
// The dev-mode indicator and error overlay are fixed over the page; keep them out of the shot.
const HIDE_OVERLAYS = "nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }";

type Launched = {promise: Promise<Browser>; launcher: SlideBrowserLauncher; value?: Browser};
type State = {browser?: Launched; failure?: {at: number; launcher: SlideBrowserLauncher}; logged: Set<string>; queue: Promise<unknown>};
const STATE = Symbol.for("engine.slide-renderer");
function state(): State {
  const holder = globalThis as typeof globalThis & {[STATE]?: State};
  return holder[STATE] ??= {logged: new Set(), queue: Promise.resolve()};
}
function logOnce(message: string) {
  const {logged} = state();
  if (logged.has(message)) return;
  logged.add(message);
  console.warn(`[slide-render] ${message}`);
}

/** `next dev` hydrates only after its HMR socket connects, and accepts that
 * socket from localhost but not 127.0.0.1, so development renders use localhost. */
export function renderOrigin(): string {
  const host = process.env.NODE_ENV === "production" ? "127.0.0.1" : "localhost";
  return (process.env.ENGINE_RENDER_ORIGIN || `http://${host}:${process.env.PORT ?? 3000}`).replace(/\/+$/, "");
}

/** ENGINE_CHROMIUM_PATH when set; otherwise Playwright's own Chromium, and when
 * that build isn't installed (no `npx playwright install`), an installed Google
 * Chrome. Any other launch failure, or no Chrome either, reports the first problem. */
export async function launchChromium(chromium: {launch(options: LaunchOptions): Promise<Browser>}, executablePath = process.env.ENGINE_CHROMIUM_PATH?.trim()): Promise<Browser> {
  const options: LaunchOptions = {headless: true, timeout: 30_000, args: ["--disable-dev-shm-usage"]};
  if (executablePath) return chromium.launch({...options, executablePath});
  try {
    return await chromium.launch(options);
  } catch (error) {
    if (!/Executable doesn't exist/i.test(error instanceof Error ? error.message : String(error))) throw error;
    return chromium.launch({...options, channel: "chrome"}).catch(() => { throw error; });
  }
}

const defaultLaunch: SlideBrowserLauncher = async () => launchChromium((await import("playwright")).chromium);

async function sharedBrowser(launch: SlideBrowserLauncher): Promise<Browser | null> {
  const current = state(), held = current.browser;
  if (held?.launcher === launch) {
    const browser = await held.promise.catch(() => null);
    if (browser?.isConnected()) return browser;
  }
  if (current.failure?.launcher === launch && Date.now() - current.failure.at < LAUNCH_RETRY_MS) return null;
  if (held) release(held);
  const slot: Launched = {promise: launch(), launcher: launch};
  current.browser = slot;
  try {
    const browser = slot.value = await slot.promise;
    browser.on("disconnected", () => { if (state().browser === slot) state().browser = undefined; });
    current.failure = undefined;
    return browser;
  } catch (error) {
    if (current.browser === slot) current.browser = undefined;
    current.failure = {at: Date.now(), launcher: launch};
    logOnce(`Chromium could not launch, so slides are not rendered: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return null;
  }
}

/** Closes a browser now, or a launch still in progress once it finishes. */
async function release(slot: Launched): Promise<void> {
  if (slot.value) await slot.value.close().catch(() => undefined);
  else void slot.promise.then(browser => browser.close(), () => undefined).catch(() => undefined);
}

/** Closes the shared browser (on shutdown, or between tests). */
export async function closeSlideRenderer(): Promise<void> {
  const current = state(), held = current.browser;
  current.browser = undefined;
  current.failure = undefined;
  current.logged.clear();
  if (held) await release(held);
}

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, {once: true});
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (bytes.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (bytes.subarray(4, 12).toString("latin1").startsWith("ftypavi")) return "image/avif";
  return null;
}

type Served = {status: number; contentType: string; body: Buffer};
const MISSING: Served = {status: 404, contentType: "text/plain", body: Buffer.from("Not available to the slide renderer.")};
const json = (status: number, value: unknown): Served => ({status, contentType: "application/json", body: Buffer.from(JSON.stringify(value))});

async function engineImage(url: URL, ownerKey: string | undefined): Promise<Served> {
  const asset = url.pathname.match(PRIVATE_ASSET);
  if (asset) {
    const size = url.searchParams.get("maxDimension");
    if (!ownerKey || (size !== null && !/^\d{1,4}$/.test(size))) return MISSING;
    const {readOriginalAsset, originalRendition} = await import("@/lib/template-editor/media-storage");
    const original = await readOriginalAsset(ownerKey, asset[1]);
    if (!original) return MISSING;
    const output = size === null ? original : await originalRendition(original, Number(size));
    return {status: 200, contentType: output.mimeType, body: output.data};
  }
  if (url.pathname === "/api/engine/img") {
    const source = url.searchParams.get("u") ?? "";
    if (!/^https?:\/\//i.test(source)) return MISSING;
    // The same guarded fetch review snapshots use: public hosts only, 8 MB, 12 s.
    const {fetchOriginalImageBytes} = await import("@/lib/template-editor/review-assets");
    const body = await fetchOriginalImageBytes(source), contentType = imageType(body);
    return contentType ? {status: 200, contentType, body} : MISSING;
  }
  return MISSING;
}

/** The export's dimension check for photos saved without them (POST /api/template-editor/assets/metadata). */
async function imageDimensions(src: string | null, ownerKey: string | undefined): Promise<Served> {
  const unavailable = json(404, {error: "Image unavailable to the slide renderer."});
  if (!src) return json(400, {error: "Choose an image."});
  const asset = src.match(PRIVATE_ASSET);
  if (asset) {
    if (!ownerKey) return unavailable;
    const {readOriginalAsset} = await import("@/lib/template-editor/media-storage");
    const original = await readOriginalAsset(ownerKey, asset[1]);
    return original ? json(200, {width: original.width, height: original.height}) : unavailable;
  }
  const source = src.startsWith("/api/engine/img?") ? new URL(src, "http://engine.local").searchParams.get("u") ?? "" : src;
  if (!/^https?:\/\//i.test(source)) return unavailable;
  const [{fetchOriginalImageBytes}, {default: sharp}] = await Promise.all([import("@/lib/template-editor/review-assets"), import("sharp")]);
  const metadata = await sharp(await fetchOriginalImageBytes(source), {limitInputPixels: 100_000_000}).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) return json(400, {error: "Choose a still image for this export."});
  const rotated = (metadata.orientation ?? 1) >= 5;
  return json(200, rotated ? {width: metadata.height, height: metadata.width} : {width: metadata.width, height: metadata.height});
}

async function serveEngineApi(route: Route, ownerKey: string | undefined, cache: Map<string, Promise<Served>>) {
  const request = route.request();
  try {
    const url = new URL(request.url());
    let key: string, load: () => Promise<Served>;
    if (request.method() === "POST" && url.pathname === "/api/template-editor/assets/metadata") {
      let src: string | null = null;
      try { const body = JSON.parse(request.postData() ?? ""); if (typeof body?.src === "string" && body.src.length <= 16_384) src = body.src; } catch { /* Answered as a bad request. */ }
      key = `metadata ${src}`; load = () => imageDimensions(src, ownerKey);
    } else if (request.method() === "GET") {
      key = url.href; load = () => engineImage(url, ownerKey);
    } else return await route.abort("accessdenied");
    let task = cache.get(key);
    if (!task) { task = load(); cache.set(key, task); }
    const served = await task;
    await route.fulfill({...served, headers: {"Cache-Control": "private, no-store"}});
  } catch {
    await route.abort("failed").catch(() => undefined);
  }
}

/** Runs in the render page: waits for hydration, fonts, images and a quiet DOM; returns images that failed
 * and the reason Export would refuse the page, if any. */
async function settleFrame({pageId, timeout}: {pageId: string; timeout: number}): Promise<{failed: string[]; exportError: string | null; missingFonts: boolean}> {
  const deadline = performance.now() + timeout;
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const paint = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  const frame = document.querySelector<HTMLElement>("[data-engine-render] > .te-frame");
  if (!frame || frame.dataset.pageId !== pageId) throw new Error("The render frame is missing.");
  // React marks hydrated nodes; smart text is measured in layout effects after hydration.
  while (!Object.keys(frame).some(key => key.startsWith("__reactFiber$") || key.startsWith("__reactProps$"))) {
    if (performance.now() > deadline) throw new Error("The render page did not hydrate.");
    await sleep(20);
  }
  let changed = performance.now();
  const observer = new MutationObserver(() => { changed = performance.now(); });
  observer.observe(frame, {subtree: true, childList: true, attributes: true, characterData: true});
  try {
    for (;;) {
      await document.fonts.ready;
      const images = Array.from(frame.querySelectorAll("img"));
      await Promise.all(images.map(image => image.complete ? undefined : new Promise(resolve => {
        image.addEventListener("load", resolve, {once: true});
        image.addEventListener("error", resolve, {once: true});
      })));
      await Promise.all(images.map(image => image.naturalWidth ? image.decode().catch(() => undefined) : undefined));
      await paint(); await paint();
      const current = frame.querySelectorAll("img");
      if (document.fonts.status === "loaded" && current.length === images.length && images.every(image => image.complete) && performance.now() - changed >= 120) {
        const failed = images.filter(image => !image.naturalWidth).map(image => {
          const source = image.currentSrc || image.src;
          return source.startsWith("data:") ? `${source.slice(0, 32)}…` : source;
        });
        const holder = frame.parentElement;
        return {failed, exportError: holder?.dataset.exportError ?? null, missingFonts: holder?.dataset.missingFonts !== undefined};
      }
      if (performance.now() > deadline) throw new Error("Fonts or images did not finish loading.");
      await sleep(40);
    }
  } finally { observer.disconnect(); }
}

/**
 * Runs in the render page once it has settled (so it can't use anything from
 * this module): measures the page as drawn. Exported for tests, which run it
 * in Chromium on a page of their own.
 *   - layers: every layer's box, as smart layout placed it;
 *   - texts: each text node in an HTML layer that shows, with its font size on
 *     the slide. An SVG element's size comes from getScreenCTM (its viewBox,
 *     nested SVGs and every CSS transform above it); an HTML element's from the
 *     transform, scale and zoom of each box up to the frame. It is clipped when
 *     the layer's edge, a box that hides its overflow (an SVG's viewport too)
 *     or the page's edge cuts part of it;
 *   - images: each <img>, SVG <image> and CSS background image, cut to its layer.
 * Hidden words and pictures (display none, visibility hidden, an opacity
 * under 5%) are left out.
 */
export function measureFrame({pageId, maxTexts, maxImages}: {pageId: string; maxTexts: number; maxImages: number}): SlideMeasures | null {
  const frame = document.querySelector<HTMLElement>("[data-engine-render] > .te-frame");
  if (!frame || frame.dataset.pageId !== pageId) return null;
  type Edges = {left: number; top: number; right: number; bottom: number};
  const page = frame.getBoundingClientRect();
  // CSS px of the viewport per scene px: 1, unless the page scales the frame.
  const unit = frame.offsetWidth ? page.width / frame.offsetWidth : 1, slack = 0.5 * unit;
  const round = (value: number) => Math.round(value * 100) / 100;
  const box = (edges: Edges): MeasuredBox => ({x: round((edges.left - page.left) / unit), y: round((edges.top - page.top) / unit), width: round((edges.right - edges.left) / unit), height: round((edges.bottom - edges.top) / unit)});
  const union = (rects: Edges[]): Edges => rects.reduce((all, rect) => ({left: Math.min(all.left, rect.left), top: Math.min(all.top, rect.top), right: Math.max(all.right, rect.right), bottom: Math.max(all.bottom, rect.bottom)}));
  const meet = (a: Edges, b: Edges): Edges => ({left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom)});
  const outside = (inner: Edges, outer: Edges) => inner.left < outer.left - slack || inner.top < outer.top - slack || inner.right > outer.right + slack || inner.bottom > outer.bottom + slack;
  const matrixScale = (value: string) => {
    if (!value || value === "none") return 1;
    const numbers = value.slice(value.indexOf("(") + 1, -1).split(",").map(Number);
    const scale = value.startsWith("matrix3d") ? Math.hypot(numbers[0], numbers[1], numbers[2]) : Math.hypot(numbers[0], numbers[1]);
    return Number.isFinite(scale) ? scale : 1;
  };
  const factor = (value: string) => {
    const number = parseFloat(value);
    return value && value !== "none" && Number.isFinite(number) ? Math.abs(number) : 1;
  };
  /** Scene px per CSS px of the element's own font size. */
  const scaleOf = (element: Element): number => {
    if (element instanceof SVGGraphicsElement) {
      const matrix = element.getScreenCTM();
      if (matrix) return Math.hypot(matrix.a, matrix.b) / unit;
    }
    let scale = 1;
    for (let node: Element | null = element; node && node !== frame; node = node.parentElement) {
      const style = getComputedStyle(node);
      scale *= matrixScale(style.transform) * factor(style.scale) * factor(style.zoom);
    }
    return scale;
  };
  /** Hidden, or nearly transparent, from the element up to its layer. */
  const unseen = (element: Element, layer: Element): boolean => {
    let opacity = 1;
    for (let node: Element | null = element; node; node = node === layer ? null : node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return true;
      opacity *= Number(style.opacity);
    }
    return !(opacity >= 0.05);
  };
  /** Cut off by a box between the element and its layer that hides what overflows, or by the page. */
  const clipped = (edges: Edges, element: Element, layer: Element): boolean => {
    if (outside(edges, page)) return true;
    for (let node: Element | null = element; node; node = node === layer ? null : node.parentElement) {
      const style = getComputedStyle(node);
      if ((style.overflowX !== "visible" || style.overflowY !== "visible") && outside(edges, node.getBoundingClientRect())) return true;
    }
    return false;
  };
  const sourceOf = (element: Element): string => {
    const tag = element.tagName.toLowerCase();
    const raw = tag === "img" ? (element as HTMLImageElement).currentSrc || element.getAttribute("src") || ""
      : tag === "image" ? element.getAttribute("href") || element.getAttribute("xlink:href") || ""
      : getComputedStyle(element).backgroundImage.match(/url\(\s*["']?([^"')]*)/)?.[1] ?? "";
    return raw.startsWith("data:") ? `${raw.slice(0, Math.max(5, raw.indexOf(",") + 1))}…` : raw.slice(0, 300);
  };
  const layers: SlideMeasures["layers"] = [], texts: MeasuredText[] = [], images: MeasuredImage[] = [];
  const elements = Array.from(frame.querySelectorAll<HTMLElement>(".te-canvas-element[data-element-id]"));
  for (const element of elements) layers.push({id: element.dataset.elementId ?? "", box: box(element.getBoundingClientRect())});
  for (const layer of elements) {
    const root = layer.classList.contains("te-canvas-element-html") ? layer.querySelector(".te-canvas-html-root") : null;
    if (!root) continue;
    const layerId = layer.dataset.elementId ?? "", edges = layer.getBoundingClientRect();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && texts.length < maxTexts; node = walker.nextNode()) {
      const words = (node.textContent ?? "").replace(/\s+/g, " ").trim(), parent = node.parentElement;
      if (!words || !parent || unseen(parent, layer)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0.01 && rect.height > 0.01);
      const style = getComputedStyle(parent), scale = scaleOf(parent), size = parseFloat(style.fontSize) * scale;
      if (!rects.length || !(size > 0)) continue;
      // Each rect is the letters' full box; a tight line height (the brand's covers set 0.836) lets it stick out of
      // its line, letters untouched. Words count as cut off only past their lines.
      const line = parent instanceof SVGElement ? NaN : parseFloat(style.lineHeight) * scale * unit;
      const area = union(rects.map(rect => {
        const inset = line > 0 && rect.height > line ? (rect.height - line) / 2 : 0;
        return {left: rect.left, top: rect.top + inset, right: rect.right, bottom: rect.bottom - inset};
      }));
      texts.push({layerId, text: words.slice(0, 120), size: round(size), box: box(area), clipped: clipped(area, parent, layer)});
    }
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (images.length >= maxImages) break;
      const tag = element.tagName.toLowerCase();
      if (tag !== "img" && tag !== "image" && !/url\(/.test(getComputedStyle(element).backgroundImage)) continue;
      if (unseen(element, layer)) continue;
      const shown = meet(element.getBoundingClientRect(), edges);
      if (shown.right - shown.left < slack || shown.bottom - shown.top < slack) continue;
      images.push({layerId, src: sourceOf(element), box: box(shown)});
    }
  }
  return {layers, texts, images};
}

/** What measureFrame sent back, if it is measures at all (a stand-in browser may answer anything). */
function readMeasures(value: unknown): SlideMeasures | undefined {
  const measures = value as SlideMeasures | null | undefined;
  return measures && Array.isArray(measures.layers) && Array.isArray(measures.texts) && Array.isArray(measures.images) ? measures : undefined;
}

async function renderPages(browser: Browser, document: DesignDocument, pageIds: string[], ownerKey: string | undefined, signal: AbortSignal, deadline: number): Promise<SlideRender[]> {
  const format = formatDimensions(document), origin = renderOrigin();
  const scale = format.width / FRAME_WIDTH, height = FRAME_WIDTH * format.height / format.width;
  const remaining = () => Math.max(1, deadline - Date.now());
  const context: BrowserContext = await abortable(browser.newContext({
    viewport: {width: FRAME_WIDTH, height: Math.ceil(height)}, deviceScaleFactor: scale,
    serviceWorkers: "block", reducedMotion: "reduce", acceptDownloads: false,
  }), signal);
  const close = () => { void context.close().catch(() => undefined); };
  signal.addEventListener("abort", close, {once: true});
  try {
    const images = new Map<string, Promise<Served>>();
    await context.route(url => url.origin === origin && url.pathname.startsWith("/api/"), route => serveEngineApi(route, ownerKey, images));
    const tab = await context.newPage();
    // `next dev` reloads open pages after server edits; a shot counts only if no reload began during it.
    let navigations = 0;
    tab.on("framenavigated", frame => { if (frame === tab.mainFrame()) navigations++; });
    const frame = tab.locator("[data-engine-render] > .te-frame");
    const results: SlideRender[] = [];
    for (const pageId of pageIds) {
      signal.throwIfAborted();
      const token = createRenderToken({document, pageId});
      try {
        const response = await tab.goto(`${origin}/engine/render/${token}`, {waitUntil: "load", timeout: remaining()});
        if (!response?.ok()) throw new Error(`The render page answered ${response?.status() ?? "nothing"} for page ${pageId}.`);
        for (let attempt = 1; ; attempt++) {
          const before = navigations;
          try {
            await frame.waitFor({state: "visible", timeout: remaining()});
            const {failed, exportError, missingFonts} = await tab.evaluate(settleFrame, {pageId, timeout: remaining()});
            // Measuring is extra: a page that can't be measured still renders.
            const measures = await tab.evaluate(measureFrame, {pageId, maxTexts: MAX_MEASURED_TEXTS, maxImages: MAX_MEASURED_IMAGES}).then(readMeasures, () => undefined);
            const png = await frame.screenshot({type: "png", scale: "device", animations: "disabled", caret: "hide", style: HIDE_OVERLAYS, timeout: remaining()});
            if (navigations === before) {
              if (missingFonts) logOnce(`Font files failed to load on ${origin}, so slides use fallback fonts (the licensed fonts are probably not installed there).`);
              if (failed.length) console.warn(`[slide-render] Page ${pageId}: ${failed.length} image(s) did not load: ${failed.slice(0, 3).join(", ")}`);
              results.push({pageId, png, ...(exportError ? {exportError} : {}), ...(measures ? {measures} : {})});
              break;
            }
          } catch (error) {
            if (signal.aborted || navigations === before || attempt >= 4) throw error;
          }
          if (attempt >= 4) throw new Error(`The render page kept reloading for page ${pageId}.`);
          await tab.waitForLoadState("load", {timeout: remaining()});
        }
      } finally {
        revokeRenderToken(token);
      }
    }
    return results;
  } finally {
    signal.removeEventListener("abort", close);
    await context.close().catch(() => undefined);
  }
}

/**
 * Renders `pageIds` (default: every page, in order) of `document` to PNGs.
 * Resolves null when Chromium is unavailable; rejects when the budget runs out,
 * `signal` aborts, or a page cannot be rendered.
 */
export async function renderSlides(document: DesignDocument, options: RenderSlidesOptions = {}): Promise<SlideRender[] | null> {
  options.signal?.throwIfAborted();
  const pageIds = options.pageIds ?? document.pages.map(page => page.id);
  const missing = pageIds.find(id => !document.pages.some(page => page.id === id));
  if (missing) throw new Error(`Page ${missing} is not in this design.`);
  if (!pageIds.length) return [];
  const budget = options.budgetMs ?? BUDGET_MS, deadline = Date.now() + budget, timer = AbortSignal.timeout(budget);
  const signal = options.signal ? AbortSignal.any([options.signal, timer]) : timer;
  const run = async () => {
    const browser = await abortable(sharedBrowser(options.launch ?? defaultLaunch), signal);
    if (!browser) return null;
    return renderPages(browser, document, pageIds, options.ownerKey, signal, deadline);
  };
  // One page at a time across the whole process keeps Chromium's memory flat;
  // the next call starts once this one has closed its browser context.
  const current = state(), task = current.queue.then(() => { signal.throwIfAborted(); return run(); });
  current.queue = task.catch(() => undefined);
  try {
    return await abortable(task, signal);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (timer.aborted) throw new Error(`Slide rendering ran past its ${Math.round(budget / 1000)} s budget.`, {cause: error});
    throw error;
  }
}
