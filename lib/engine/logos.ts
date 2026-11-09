/**
 * Logos for the graphics an exact copy rebuilds from their parts. Each brand's
 * mark is looked up by name, and the first match wins:
 *   1. the page's brand guide logo library (topic logos the team approved);
 *   2. svgl (api.svgl.app): color SVGs, many with a version made for dark pages;
 *   3. Simple Icons (CC0, a pinned version on jsDelivr): one-color marks in the brand's color;
 *   4. Lobe Icons (MIT, a pinned version on unpkg): AI brands.
 * Names match exactly, not by search: svgl's own search is fuzzy ("Java" finds
 * JavaScript first). A file is cleaned before use: an SVG of at most 200 KB with
 * no scripts or outside references, turned into the editor's safe vector form,
 * or drawn as a PNG when it uses what that form can't hold (masks, filters,
 * styles). It goes into the deck as a data URL, so a post never depends on
 * these sites later. On the page's cards a logo uses its dark-page version when
 * it has one. A mark in one flat color reads like text, so it keeps its color
 * only at the contrast text needs (4.5:1) and is otherwise drawn in the page's
 * ink; a logo with several colors that would vanish sits on a light tile.
 */
import sharp from "sharp";
import { prepareVectorBrandAsset } from "../template-editor/brand-assets";
import type { BrandGuide } from "../template-editor/brand-guide";
import { BRAND_SVG_PREFIX, isSafeBrandSvg } from "../template-editor/model";

/** Pinned, so a logo never changes under a deck. */
export const LOGO_SOURCES = {
  svgl: "https://api.svgl.app",
  simpleIcons: "https://cdn.jsdelivr.net/npm/simple-icons@16.37.0",
  lobe: "https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons",
} as const;
const HOSTS = new Set(["api.svgl.app", "svgl.app", "cdn.jsdelivr.net", "unpkg.com"]);

export type LogoRequest = { brand: string; label?: string };
export type LogoSource = "guide" | "svgl" | "simple-icons" | "lobe";
export type FoundLogo = {
  /** The name the source gives the mark. */
  name: string;
  /** A safe brand SVG or PNG data URL, or the guide's own file. */
  src: string;
  width: number;
  height: number;
  source: LogoSource;
  sourceUrl: string;
  /** A logo with several colors that would vanish on the card: it sits on a light tile. */
  tile: boolean;
};
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type LogoOptions = {
  guide?: BrandGuide | null;
  /** The color the logos sit on, such as the page's card color. */
  background?: string;
  /** The color a one-color mark is drawn in when it would vanish. Defaults to white on a dark background, black on a light one. */
  ink?: string;
  fetch?: Fetcher;
  signal?: AbortSignal;
};

const MAX_SVG = 200_000, RASTER = 384, TIMEOUT = 8_000, PARALLEL = 6, INDEX_TTL = 12 * 3600_000, MAX_FILES = 400;

// ── Names ───────────────────────────────────────────────────────────────────
/** A name as a key that compares exactly: "Node.js" → nodejs, "C++" → cplusplus, "C#" → csharp. */
export function logoKey(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\+/g, "plus").replace(/#/g, "sharp").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}
/** The name without a vendor in front or "AI" behind: Apache Kafka → kafka, Claude AI → claude. */
const coreKey = (name: string) => logoKey(name.replace(/^\s*(?:apache|microsoft|google|amazon|gnu|the)\s+(?=\S)/i, "").replace(/(?<=\S)\s+ai\s*$/i, ""));
/** Short names people write for brands the sources list by their full name. */
const ALIASES: Record<string, string> = {
  aws: "Amazon Web Services", gcp: "Google Cloud", k8s: "Kubernetes", vscode: "Visual Studio Code", js: "JavaScript", ts: "TypeScript",
  node: "Node.js", postgres: "PostgreSQL", mongo: "MongoDB", gh: "GitHub", chatgpt: "OpenAI", tailwind: "Tailwind CSS", next: "Next.js",
};
/** The keys a request matches, best first: its exact name, a known full name, then the bare name. */
function wantedKeys(name: string): { exact: string[]; core: string[] } {
  const key = logoKey(name), alias = ALIASES[key];
  return { exact: [...new Set([key, ...(alias ? [logoKey(alias)] : [])].filter(Boolean))], core: [...new Set([coreKey(name), ...(alias ? [coreKey(alias)] : [])].filter(Boolean))] };
}
type Named<T> = { item: T; exact: string[]; core: string[] };
const named = <T>(item: T, names: string[]): Named<T> => ({ item, exact: names.map(logoKey).filter(Boolean), core: names.map(coreKey).filter(Boolean) });
function findNamed<T>(entries: Named<T>[], name: string): T | undefined {
  const keys = wantedKeys(name);
  for (const key of keys.exact) { const hit = entries.find(entry => entry.exact.includes(key)); if (hit) return hit.item; }
  for (const key of keys.core) { const hit = entries.find(entry => entry.core.includes(key)); if (hit) return hit.item; }
  return undefined;
}

// ── Fetching, with caches shared by runs ─────────────────────────────────────
type SvglEntry = { title: string; subTitle?: string; route: string | { light: string; dark: string } };
type SimpleIcon = { title: string; slug: string; hex: string; aliases?: { aka?: string[] } };
type Cache = { svgl?: { at: number; entries: Promise<Named<SvglEntry>[] | null> }; simple?: Promise<Named<SimpleIcon>[] | null>; files: Map<string, Promise<string | null>> };
const caches = new WeakMap<Fetcher, Cache>();
const defaultFetch: Fetcher = (url, init) => fetch(url, init);
function cacheFor(fetcher: Fetcher): Cache {
  let cache = caches.get(fetcher);
  if (!cache) caches.set(fetcher, cache = { files: new Map() });
  return cache;
}
function allowed(url: string): boolean {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && HOSTS.has(parsed.hostname); } catch { return false; }
}
async function get(fetcher: Fetcher, url: string, signal: AbortSignal | undefined, limit: number): Promise<string | null> {
  if (!allowed(url)) return null;
  const timeout = AbortSignal.timeout(TIMEOUT), both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetcher(url, { signal: both, headers: { accept: "image/svg+xml, application/json;q=0.9, */*;q=0.1" } });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  const text = await response.text();
  return text.length > limit ? null : text;
}
/** A file's text, fetched once per run family; a failure is not kept, so the next run tries again. */
function file(cache: Cache, fetcher: Fetcher, url: string, signal?: AbortSignal): Promise<string | null> {
  const known = cache.files.get(url);
  if (known) return known;
  const loading = get(fetcher, url, signal, MAX_SVG).catch(error => { cache.files.delete(url); if (signal?.aborted) throw error; return null; });
  if (cache.files.size >= MAX_FILES) cache.files.delete(cache.files.keys().next().value!);
  cache.files.set(url, loading);
  return loading;
}
function svglIndex(cache: Cache, fetcher: Fetcher, signal?: AbortSignal): Promise<Named<SvglEntry>[] | null> {
  if (cache.svgl && Date.now() - cache.svgl.at < INDEX_TTL) return cache.svgl.entries;
  const entries = get(fetcher, LOGO_SOURCES.svgl, signal, 5_000_000).then(text => {
    const list = JSON.parse(text ?? "null") as unknown;
    if (!Array.isArray(list)) return null;
    const usable = list.filter((entry): entry is SvglEntry => Boolean(entry) && typeof entry.title === "string" && (typeof entry.route === "string" || (typeof entry.route?.light === "string" && typeof entry.route?.dark === "string")));
    // A brand's main entry before its variants (Monochrome and so on).
    return usable.sort((a, b) => Number(Boolean(a.subTitle)) - Number(Boolean(b.subTitle))).map(entry => named(entry, [entry.title]));
  }).catch(() => null);
  cache.svgl = { at: Date.now(), entries };
  entries.then(found => { if (!found && cache.svgl?.entries === entries) delete cache.svgl; });
  return entries;
}
function simpleIndex(cache: Cache, fetcher: Fetcher, signal?: AbortSignal): Promise<Named<SimpleIcon>[] | null> {
  if (cache.simple) return cache.simple;
  const entries = get(fetcher, `${LOGO_SOURCES.simpleIcons}/data/simple-icons.json`, signal, 5_000_000).then(text => {
    const list = JSON.parse(text ?? "null") as unknown;
    if (!Array.isArray(list)) return null;
    return list.filter((icon): icon is SimpleIcon => Boolean(icon) && typeof icon.title === "string" && typeof icon.slug === "string" && /^[a-z0-9]+$/.test(icon.slug) && /^[0-9A-Fa-f]{6}$/.test(icon.hex))
      .map(icon => named(icon, [icon.title, ...(icon.aliases?.aka ?? []).filter((alias): alias is string => typeof alias === "string")]));
  }).catch(() => null);
  cache.simple = entries;
  entries.then(found => { if (!found && cache.simple === entries) delete cache.simple; });
  return entries;
}

// ── Colors ──────────────────────────────────────────────────────────────────
type RGB = [number, number, number];
function rgbOf(hex: string): RGB | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return null;
  const full = match[1].length === 3 ? match[1].split("").map(c => c + c).join("") : match[1];
  return [0, 2, 4].map(at => parseInt(full.slice(at, at + 2), 16)) as RGB;
}
const linear = (channel: number) => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]: RGB) => .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b);
/** WCAG contrast between two colors, 1 to 21. */
export function contrast(a: RGB, b: RGB): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + .05) / (low + .05);
}
const isDark = (color: RGB) => luminance(color) < .18;

// ── Cleaning ────────────────────────────────────────────────────────────────
/** Only vector artwork: no scripts, styles that load anything, entities or links outside the file. */
export function cleanSvg(text: string): string | null {
  if (!text || text.length > MAX_SVG || !/<svg[\s>]/i.test(text)) return null;
  if (/<!ENTITY|<!DOCTYPE|<\s*(?:script|foreignObject|iframe|object|embed|image|audio|video)\b|\bon[a-z]+\s*=|javascript:|@import/i.test(text)) return null;
  for (const link of text.matchAll(/\b(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) if (!link[1].startsWith("#")) return null;
  for (const link of text.matchAll(/url\(\s*["']?([^"')\s]*)/gi)) if (!link[1].startsWith("#")) return null;
  return text.replace(/<\?xml[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").trim();
}
const dataUrl = (bytes: Buffer, type: "png") => `data:image/${type};base64,${bytes.toString("base64")}`;
const svgOfDataUrl = (src: string) => decodeURIComponent(src.slice(BRAND_SVG_PREFIX.length));

/** Draws an SVG as a PNG, at most RASTER pixels a side. */
async function rasterize(svg: string): Promise<{ png: Buffer; width: number; height: number }> {
  const bytes = Buffer.from(svg);
  const { width = 0, height = 0 } = await sharp(bytes).metadata();
  if (!width || !height) throw new Error("the SVG has no size");
  const density = Math.min(2400, Math.max(1, 72 * RASTER / Math.max(width, height) * 1.5));
  const { data, info } = await sharp(bytes, { density }).resize({ width: RASTER, height: RASTER, fit: "inside", withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height };
}

/** The contrast our text needs, which a mark in one flat color needs too: at a logo's size it reads like text. */
export const FLAT_MARK_CONTRAST = 4.5;
export type Visibility = {
  /** The share of the marks that would vanish on the background. */
  vanishing: number;
  /** Mostly one color (85% of the marks or more). */
  oneColor: boolean;
  /** Nothing but one color, such as every Simple Icons mark: recoloring it loses no detail. */
  flat: boolean;
  /** The contrast of the marks' middle color with the background. */
  contrast: number;
};
/** How a logo (a drawn PNG) shows on `background`. */
export async function visibility(image: Buffer, background: RGB): Promise<Visibility> {
  const { data, info } = await sharp(image).resize({ width: 48, height: 48, fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const marks: RGB[] = [], solid: RGB[] = [];
  for (let at = 0; at < data.length; at += info.channels) {
    if (data[at + 3] >= 128) marks.push([data[at], data[at + 1], data[at + 2]]);
    if (data[at + 3] >= 250) solid.push([data[at], data[at + 1], data[at + 2]]);
  }
  if (marks.length < 12) return { vanishing: 0, oneColor: true, flat: false, contrast: 21 };
  const vanishing = marks.filter(color => contrast(color, background) < 1.8).length / marks.length;
  // Edges blend the color with the transparency around them, which shifts it when scaled down
  // (a thin line drawing such as Jenkins is mostly edges): its colors are judged on its solid pixels.
  const body = solid.length >= 12 ? solid : marks;
  const middle = [0, 1, 2].map(channel => body.map(color => color[channel]).sort((a, b) => a - b)[body.length >> 1]) as RGB;
  const distance = (color: RGB) => (Math.abs(color[0] - middle[0]) + Math.abs(color[1] - middle[1]) + Math.abs(color[2] - middle[2])) / 3;
  const near = body.filter(color => distance(color) <= 40).length, same = body.filter(color => distance(color) <= 12).length;
  return { vanishing, oneColor: near / body.length >= .85, flat: same / body.length >= .98, contrast: contrast(middle, background) };
}

/** The mark in one color: every paint in a safe SVG, or every pixel of a PNG, keeping its shape. */
async function recolor(src: string, ink: string): Promise<string> {
  if (src.startsWith(BRAND_SVG_PREFIX)) {
    const svg = svgOfDataUrl(src).replace(/\b(fill|stroke|stop-color)="(?!none"|transparent")[^"]*"/g, `$1="${ink}"`);
    if (!isSafeBrandSvg(svg)) throw new Error("the recolored logo isn't a safe SVG");
    return BRAND_SVG_PREFIX + encodeURIComponent(svg);
  }
  const [red, green, blue] = rgbOf(ink) ?? [255, 255, 255];
  const { data, info } = await sharp(Buffer.from(src.slice(src.indexOf(",") + 1), "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let at = 0; at < data.length; at += 4) { data[at] = red; data[at + 1] = green; data[at + 2] = blue; }
  return dataUrl(await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer(), "png");
}

type Drawn = { src: string; width: number; height: number; image: Buffer };
const rounded = (value: number) => Math.round(value * 1000) / 1000;
/**
 * The logo without empty margin around its mark, so marks fill their cells
 * alike (some files leave a third of their box empty): a PNG is cut to the
 * mark, the safe vector form's viewBox narrowed to it. A margin under 3% a
 * side stays, as does a vector whose drawing doesn't fill its viewBox evenly.
 */
async function trimMargins(logo: Drawn): Promise<Drawn> {
  const { data, info } = await sharp(logo.image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let [left, right, top, bottom] = [info.width, 0, info.height, 0];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 32) continue;
    [left, right, top, bottom] = [Math.min(left, x), Math.max(right, x + 1), Math.min(top, y), Math.max(bottom, y + 1)];
  }
  if (right <= left || bottom <= top) return logo;
  const pad = Math.round(Math.max(right - left, bottom - top) * .02);
  [left, right, top, bottom] = [Math.max(0, left - pad), Math.min(info.width, right + pad), Math.max(0, top - pad), Math.min(info.height, bottom + pad)];
  if ((right - left) / info.width > .94 && (bottom - top) / info.height > .94) return logo;
  const image = await sharp(logo.image).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
  if (!logo.src.startsWith(BRAND_SVG_PREFIX)) return { src: dataUrl(image, "png"), width: right - left, height: bottom - top, image };
  const svg = svgOfDataUrl(logo.src), opening = svg.match(/^<svg\b[^>]*>/)?.[0] ?? "";
  const box = opening.match(/\bviewBox="([^"]+)"/)?.[1].trim().split(/[\s,]+/).map(Number) ?? [];
  if (box.length !== 4 || !box.every(Number.isFinite) || Math.abs(box[2] / box[3] / (info.width / info.height) - 1) > .01) return logo;
  const [sx, sy] = [box[2] / info.width, box[3] / info.height], [width, height] = [logo.width * (right - left) / info.width, logo.height * (bottom - top) / info.height];
  const root = opening
    .replace(/\bviewBox="[^"]+"/, `viewBox="${[box[0] + left * sx, box[1] + top * sy, (right - left) * sx, (bottom - top) * sy].map(rounded).join(" ")}"`)
    .replace(/\swidth="[^"]*"/, ` width="${rounded(width)}"`).replace(/\sheight="[^"]*"/, ` height="${rounded(height)}"`);
  const trimmed = root + svg.slice(opening.length);
  return isSafeBrandSvg(trimmed) ? { src: BRAND_SVG_PREFIX + encodeURIComponent(trimmed), width: rounded(width), height: rounded(height), image } : logo;
}

/**
 * A downloaded SVG as a logo the deck can hold: the editor's safe vector form
 * when it fits, else a PNG, without empty margin around the mark. A mark in one
 * flat color under FLAT_MARK_CONTRAST on `background` is recolored to `ink`
 * (Jenkins red on our dark card is hard to read; Docker blue keeps its color).
 * A logo that would vanish is recolored too when it has one color, or else
 * marked for a light tile.
 */
export async function prepareLogo(text: string, name: string, background: RGB, ink: string): Promise<Pick<FoundLogo, "src" | "width" | "height" | "tile"> | null> {
  const svg = cleanSvg(text.replace(/currentColor/g, "#000000"));
  if (!svg) return null;
  let drawn: Drawn;
  try {
    const asset = prepareVectorBrandAsset(svg, name, "logo");
    drawn = { src: asset.src, width: asset.width, height: asset.height, image: (await rasterize(svgOfDataUrl(asset.src))).png };
  } catch {
    try {
      const raster = await rasterize(svg);
      drawn = { src: dataUrl(raster.png, "png"), width: raster.width, height: raster.height, image: raster.png };
    } catch { return null; }
  }
  const { src, width, height, image } = await trimMargins(drawn).catch(() => drawn);
  const seen = await visibility(image, background);
  if (seen.flat && seen.contrast < FLAT_MARK_CONTRAST) return { src: await recolor(src, ink), width, height, tile: false };
  if (seen.vanishing <= .3) return { src, width, height, tile: false };
  if (seen.oneColor) return { src: await recolor(src, ink), width, height, tile: false };
  return { src, width, height, tile: true };
}

// ── Finding ─────────────────────────────────────────────────────────────────
type Context = { cache: Cache; fetcher: Fetcher; signal?: AbortSignal; background: RGB; ink: string; dark: boolean };

function fromGuide(guide: BrandGuide | null | undefined, name: string): FoundLogo | null {
  const logos = (guide?.logos ?? []).filter(logo => logo.role === "topic").map(logo => named(logo, [logo.name.replace(/\s+logo$/i, ""), ...logo.topics]));
  const logo = findNamed(logos, name);
  return logo ? { name: logo.name, src: logo.src, width: logo.width, height: logo.height, source: "guide", sourceUrl: "", tile: false } : null;
}
async function fromSvgl(context: Context, name: string): Promise<FoundLogo | null> {
  const entry = findNamed(await svglIndex(context.cache, context.fetcher, context.signal) ?? [], name);
  if (!entry) return null;
  const url = typeof entry.route === "string" ? entry.route : context.dark ? entry.route.dark : entry.route.light;
  const text = await file(context.cache, context.fetcher, url, context.signal);
  const logo = text && await prepareLogo(text, entry.title, context.background, context.ink);
  return logo ? { ...logo, name: entry.title.trim(), source: "svgl", sourceUrl: url } : null;
}
async function fromSimpleIcons(context: Context, name: string): Promise<FoundLogo | null> {
  const icon = findNamed(await simpleIndex(context.cache, context.fetcher, context.signal) ?? [], name);
  if (!icon) return null;
  const url = `${LOGO_SOURCES.simpleIcons}/icons/${icon.slug}.svg`;
  const text = await file(context.cache, context.fetcher, url, context.signal);
  // Simple Icons draw in black; the mark takes its brand's color.
  const logo = text && await prepareLogo(text.replace(/<svg\b/, `<svg fill="#${icon.hex}"`), icon.title, context.background, context.ink);
  return logo ? { ...logo, name: icon.title, source: "simple-icons", sourceUrl: url } : null;
}
async function fromLobe(context: Context, name: string): Promise<FoundLogo | null> {
  const ids = [...new Set([...wantedKeys(name).exact, ...wantedKeys(name).core])];
  for (const id of ids) for (const variant of [`${id}-color`, id]) {
    const url = `${LOGO_SOURCES.lobe}/${variant}.svg`;
    const text = await file(context.cache, context.fetcher, url, context.signal);
    const logo = text && await prepareLogo(text, name, context.background, context.ink);
    if (logo) return { ...logo, name: name.trim(), source: "lobe", sourceUrl: url };
  }
  return null;
}

async function findOne(context: Context, guide: BrandGuide | null | undefined, request: LogoRequest): Promise<FoundLogo | null> {
  // The mark decides: a request's brand is tried in every source before its label is.
  const names = [request.brand, request.label].map(name => name?.trim() ?? "").filter((name, index, all) => name && all.indexOf(name) === index);
  for (const name of names) {
    const found = fromGuide(guide, name) ?? await fromSvgl(context, name) ?? await fromSimpleIcons(context, name) ?? await fromLobe(context, name);
    if (found) return found;
  }
  return null;
}

/** Runs `work` over `items`, at most `limit` at a time, keeping their order. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]); }
  }));
  return results;
}

/**
 * Finds each requested brand's logo, in the order asked; null where no source
 * has it (the caller cuts that one from the original). The same brand asked
 * twice is looked up once.
 */
export async function findLogos(requests: LogoRequest[], options: LogoOptions = {}): Promise<(FoundLogo | null)[]> {
  const fetcher = options.fetch ?? defaultFetch, background = rgbOf(options.background ?? "#000000") ?? [0, 0, 0];
  const dark = isDark(background), ink = options.ink && rgbOf(options.ink) ? options.ink : dark ? "#FFFFFF" : "#000000";
  const context: Context = { cache: cacheFor(fetcher), fetcher, signal: options.signal, background, ink, dark };
  const once = new Map<string, Promise<FoundLogo | null>>();
  return pool(requests, PARALLEL, request => {
    const key = `${logoKey(request.brand)}|${logoKey(request.label ?? "")}`;
    if (!once.has(key)) once.set(key, findOne(context, options.guide, request).catch(error => { if (options.signal?.aborted) throw error; return null; }));
    return once.get(key)!;
  });
}
