/**
 * The designer's tools (stages/design.ts). The designer builds one deck in the
 * page's template with the deck operations and renders the chat uses, and
 * fills it with real assets. Each tool is a thin wrapper over code that exists:
 *   - create_deck and edit_deck: createAgentDeck and updateAgentDeck (agent-decks.ts)
 *   - look_at_slides: renderSlides (slide-render.ts)
 *   - find_logos: findLogos (logos.ts)
 *   - x_post: the exact copy's post lookup (exact-posts.ts) and fetchXPost
 *   - fred_series, sp500_history and chart_data: dataTools and resolveChartData
 *     (charts.ts, recreate-data.ts), with each series placed for the designer's box
 *   - find_photos: photosFromPages, searchXImages and curateImages
 *   - cut_from_source: snapBox, cutLogo and cropOriginal (cut.ts)
 *
 * Every image goes into the deck as a workspace media file, by its path
 * (/api/template-editor/assets/<sha-256>, stored-images.ts), never as a data
 * URL or an outside link: cuts and logos are stored when a tool makes them,
 * photos found online when the deck first uses one. HTML layers take their
 * colors from the brand's CSS variables only.
 */
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { parse as parseCss } from "postcss";
import { z } from "zod";
import { AGENT_UPDATE_SCHEMA, AgentDeckValidationError, addsHtmlLayers, agentDeckView, createAgentDeck, updateAgentDeck, withHtmlLayerTokens } from "../../template-editor/agent-decks";
import type { BrandGuide } from "../../template-editor/brand-guide";
import { applyGuideToDeck } from "../../template-editor/guide-template";
import { hasOriginalAsset, MAX_ORIGINAL_BYTES, storeOriginalAsset } from "../../template-editor/media-storage";
import { formatDimensions, type CanvasElement, type DesignDocument, type DesignTemplate, type ImageElement, type TextElement } from "../../template-editor/model";
import { embeddedImageBytes, embeddedImages, imageId, imagesToKeep, STORED_IMAGE_PATH, type ImageStore } from "../../template-editor/stored-images";
import { searchXImages } from "../apify";
import { curateImages } from "../image-curator";
import { findLogos, type LogoSource } from "../logos";
import type { PageProfile } from "../page-profiles";
import type { PostMode } from "../post-files";
import { publicHttpUrl } from "../public-url";
import { alignedTicks, finiteAt, formatValue, niceTicks, ticksWithin, validateChart, type ChartRange, type RecreateChart } from "../recreate-chart";
import { resolveChartData, type ChartData } from "../recreate-data";
import { renderSlides } from "../slide-render";
import type { StoryImage } from "../types";
import { fetchXPost, reactionSlots, type XReaction } from "../x-reactions";
import { ToolError, type ClientTool, type SourceImage } from "./claude";
import { chartSources, chartSpecFrom, dataTools, oneScale } from "./charts";
import { cleanBox, cropOriginal, cutLogo, snapBox } from "./cut";
import { cleanSlideText, emphasis, styleCards } from "./deck";
import { cardsFor, MAX_POST_SEARCHES } from "./exact-posts";
import { templatePages } from "./pages";
import { photoSize, photosFromPages } from "./research";
import { ChartSchema, MediaBoxSchema, X_BADGES, type MediaBox, type WrittenChart } from "./schemas";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const round = (value: number) => Math.round(value * 10) / 10;
const ASSET = /^\/api\/template-editor\/assets\/[a-f0-9]{64}$/;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MEDIA: ImageStore = { has: hasOriginalAsset, store: storeOriginalAsset };

/** What a tool result holds: text, or text and pictures (look_at_slides). */
export type ToolContent = string | Exclude<Anthropic.Beta.BetaToolResultBlockParam["content"], string | undefined>;
/** An image this run can place, and what it is. */
type Asset = { width: number; height: number; what: string; credit?: string };

/** One designer's run: the deck being built and everything its tools found. */
export type DesignSession = {
  ownerKey: string;
  mode: PostMode;
  profile: PageProfile;
  template: DesignTemplate;
  templates: DesignTemplate[];
  guide?: BrandGuide | null;
  /** The brand's CSS variables, set on every HTML layer. */
  tokens: Record<string, string>;
  /** The original's slides, for cuts and for posts rebuilt from a screenshot. */
  slides: SourceImage[];
  /** The original's caption, whose links to posts on X are tried too. */
  caption: string;
  chartData: ChartData;
  signal: AbortSignal;
  deckId: string;
  /** The deck as it stands: null until create_deck, or the earlier deck in a fix round. */
  document: DesignDocument | null;
  /** Images stored for this deck, by path. */
  assets: Map<string, Asset>;
  /** Photos found online, by link: stored the first time the deck uses one. */
  found: Map<string, Asset>;
  /** Posts from X that x_post read, by id. */
  posts: Map<string, XReaction>;
  /** Post lookups already made, so the same post is read once. */
  known: Map<string, XReaction | null>;
  searches: { searches: number };
  /** For the deck's notes: where charts came from, and the guide's touches. */
  credits: Set<string>;
  /** For the deck's notes: where each image came from, by its path; only those still in the deck are noted. */
  imageCredits: [path: string, credit: string][];
  /** Slides changed since the designer last looked at them, by page id. */
  unseen: Set<string>;
  /** False once the server couldn't draw the slides; then handing in needs no look. */
  renderable: boolean;
  store: ImageStore;
  fetch: typeof fetch;
  render: typeof renderSlides;
};

export function designSession(input: Pick<DesignSession, "ownerKey" | "mode" | "profile" | "template" | "templates" | "tokens" | "slides" | "chartData" | "signal" | "deckId">
  & Partial<Pick<DesignSession, "guide" | "caption" | "document" | "store" | "fetch" | "render">>): DesignSession {
  return {
    guide: null, caption: "", document: null, store: MEDIA, fetch, render: renderSlides, ...input,
    assets: new Map(), found: new Map(), posts: new Map(), known: new Map(), searches: { searches: MAX_POST_SEARCHES },
    credits: new Set(), imageCredits: [], unseen: new Set(), renderable: true,
  };
}

const credit = (session: DesignSession, path: string, text: string) => { session.imageCredits.push([path, text]); };
/** The notes on where things came from, for the deck as it is now: an image the designer replaced isn't credited. */
export function creditsFor(session: DesignSession, document: DesignDocument): string[] {
  const inDeck = JSON.stringify(document);
  return [...new Set([...session.credits, ...session.imageCredits.filter(([path]) => inDeck.includes(path)).map(([, text]) => text)])];
}

/** A template text slot: a title, a body, a list (not a post card's lines or the brand's own). */
const slotText = (element: CanvasElement): element is TextElement => element.type === "text" && Boolean(element.slot) && !element.slot!.startsWith("reaction-") && element.templateRole !== "brand";
const slotKey = (pageId: string, element: CanvasElement) => `${pageId}\n${element.id}`;
const emptySlots = (document: DesignDocument) => new Set(document.pages.flatMap(page => (page.canvas?.elements ?? []).filter(element => slotText(element) && !element.text.trim()).map(element => slotKey(page.id, element))));
/**
 * Template text slots without words are hidden, as an exact copy always had
 * them (exact.ts): an empty list slot still draws its bullet. A slot that gets
 * its words back (it was empty before the edit) shows again.
 */
export function tidySlots(document: DesignDocument, wasEmpty = new Set<string>()): void {
  for (const page of document.pages) for (const element of page.canvas?.elements ?? []) {
    if (!slotText(element)) continue;
    if (!element.text.trim()) element.hidden = true;
    else if (element.hidden && wasEmpty.has(slotKey(page.id, element))) element.hidden = false;
  }
}

// ── Images ──────────────────────────────────────────────────────────────────
/** Stores bytes as a workspace media file, once per content, and returns its path. */
async function storeBytes(session: DesignSession, data: Buffer, name: string): Promise<string> {
  const id = imageId(data);
  if (!await session.store.has(session.ownerKey, id)) {
    const saved = await session.store.store(session.ownerKey, data, name.slice(0, 200) || "Image");
    if (saved.id !== id) throw new Error("The stored image doesn't match its content.");
  }
  return `${STORED_IMAGE_PATH}${id}`;
}

/** A photo from a public link, as bytes the media store takes: JPEG, PNG or WebP under 15 MB (others become JPEG). */
const MAX_REDIRECTS = 5;
const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** Where a redirect leads, when that is a public web address too. */
function nextHop(location: string | null, from: URL): URL | null {
  try { return location ? publicHttpUrl(new URL(location, from).href) : null; } catch { return null; }
}
/** The body, or null once it passes `max` bytes (it stops reading there). */
async function readBounded(response: Response, max: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
}

async function download(session: DesignSession, address: string): Promise<Buffer> {
  const signal = AbortSignal.any([session.signal, AbortSignal.timeout(15_000)]);
  let url = publicHttpUrl(address), response: Response | null = null;
  // Every hop of a redirect is checked again, so a public link can't lead to a private address.
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop++) {
    response = await session.fetch(url, { headers: { "User-Agent": "EngineBot/1.0 (+https://github.com/chatgptricks/engine)", Accept: "image/*" }, redirect: "manual", signal });
    if (!REDIRECT.has(response.status)) break;
    await response.body?.cancel().catch(() => undefined);
    url = nextHop(response.headers.get("location"), url);
    response = null;
  }
  if (!response) throw new ToolError(url ? "That photo's link redirects too many times. Pick another." : "That photo's link isn't a public web address.");
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !/^image\//i.test(type) || Number(response.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ToolError("That photo couldn't be downloaded. Pick another.");
  }
  const bytes = await readBounded(response, MAX_PHOTO_BYTES);
  if (!bytes) throw new ToolError("That photo is too large. Pick another.");
  if (/^image\/(?:jpeg|png|webp)\b/i.test(type) && bytes.length <= MAX_ORIGINAL_BYTES) return bytes;
  // A GIF, AVIF or other picture is kept as its first frame.
  return sharp(bytes, { limitInputPixels: 100_000_000 }).rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

const knownAsset = (session: DesignSession, path: string) => session.assets.has(path) || Boolean(session.document && JSON.stringify(session.document).includes(path));

/**
 * The path an image goes into the deck by: an asset path this run's tools gave
 * (or the deck already holds), a photo found online (stored now), or a data:
 * image (stored now). Anything else is refused: assets come from the tools.
 */
async function placeable(session: DesignSession, value: string, what = "Image"): Promise<string> {
  const source = value.trim();
  // An asset this run stored, or a file of the brand guide's own (its logo) that find_logos gave.
  if (session.assets.has(source)) return source;
  if (ASSET.test(source)) {
    if (knownAsset(session, source)) return source;
    throw new ToolError(`${source} isn't an image your tools gave you. Use a path from cut_from_source, find_logos or x_post, or a photo url from find_photos.`);
  }
  if (source.startsWith("data:image/")) {
    const data = embeddedImageBytes(source);
    if (!data) throw new ToolError("That data: image can't be stored. Draw it as inline SVG in an HTML layer instead, or use an image a tool gave you.");
    const path = await storeBytes(session, data, what);
    const size = await sharp(data).metadata().catch(() => null);
    session.assets.set(path, { width: size?.width ?? 0, height: size?.height ?? 0, what });
    return path;
  }
  const found = session.found.get(source);
  if (found) {
    const path = await storeBytes(session, await download(session, source), found.what);
    if (!session.assets.has(path)) session.assets.set(path, found);
    if (found.credit) credit(session, path, `Photo: ${found.credit}`);
    return path;
  }
  throw new ToolError(`${source.slice(0, 120)} isn't an image your tools gave you. Photos come from find_photos, x_post or cut_from_source; logos from find_logos.`);
}

/** Stores a tool's image right away (a cut, a logo): its path and size, for the designer. */
async function stored(session: DesignSession, url: string, asset: Asset): Promise<string> {
  const data = embeddedImageBytes(url);
  if (!data) throw new ToolError("That image can't be stored.");
  const path = await storeBytes(session, data, asset.what);
  session.assets.set(path, asset);
  return path;
}

// ── Brand: HTML layers take colors from the brand's variables ───────────────
const NAMED_COLORS = new Set("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" "));
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const HEX_COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;
const COLOR_ATTRIBUTE = /\s(fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const STYLE_ATTRIBUTE = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi;
const VARIABLE = /var\(\s*(--[\w-]+)/g;

/** The color a value writes out itself (#hex, rgb(), a named color) instead of a brand variable, or null. */
function colorLiteral(value: string): string | null {
  const bare = value.replace(/var\(\s*--[\w-]+\s*(?:,(?:[^()]|\([^()]*\))*)?\)/g, " ").replace(/url\([^)]*\)/gi, " ").replace(/(["'])(?:(?!\1).)*\1/g, " ");
  const literal = bare.match(HEX_COLOR)?.[0] ?? bare.match(COLOR_FUNCTION)?.[0];
  if (literal) return literal.replace(/\s*\($/, "()");
  return bare.toLowerCase().split(/[^a-z]+/).find(word => NAMED_COLORS.has(word)) ?? null;
}

/**
 * What in an HTML layer leaves the brand: a color written out instead of the
 * brand's variables (var(--color-accent)), or a variable the brand doesn't
 * have. The layer may define its own variables from the brand's.
 */
export function offBrand(html: string, css: string | undefined, tokens: Record<string, string>): string[] {
  const declarations: { property: string; value: string }[] = [], problems = new Set<string>();
  const sheets = [css ?? "", ...[...html.matchAll(STYLE_BLOCK)].map(match => match[1])];
  for (const sheet of sheets) {
    if (!sheet.trim()) continue;
    try {
      parseCss(sheet).walkDecls(declaration => { declarations.push({ property: declaration.prop.toLowerCase(), value: declaration.value }); });
    } catch {
      problems.add("Its CSS can't be read: check the braces and semicolons.");
    }
  }
  const markup = html.replace(STYLE_BLOCK, " ");
  for (const match of markup.matchAll(STYLE_ATTRIBUTE)) {
    for (const part of (match[1] ?? match[2] ?? "").split(";")) {
      const at = part.indexOf(":");
      if (at > 0) declarations.push({ property: part.slice(0, at).trim().toLowerCase(), value: part.slice(at + 1).trim() });
    }
  }
  for (const match of markup.matchAll(COLOR_ATTRIBUTE)) declarations.push({ property: match[1].toLowerCase(), value: match[2] ?? match[3] ?? match[4] ?? "" });
  const own = new Set(declarations.filter(item => item.property.startsWith("--")).map(item => item.property));
  for (const { property, value } of declarations) {
    const literal = colorLiteral(value);
    if (literal) problems.add(`${property}: ${value.trim().slice(0, 60)} writes the color ${literal} itself. Use the brand's variables (var(--color-accent), var(--color-text)…); for a tint, color-mix(in srgb, var(--color-text) 20%, transparent) or opacity.`);
    for (const [, name] of value.matchAll(VARIABLE)) {
      if (!(name in tokens) && !own.has(name)) problems.add(`var(${name}) isn't one of the brand's variables.`);
    }
  }
  return [...problems].slice(0, 6);
}

/** The HTML an operation adds or changes, to check against the brand. */
function htmlOf(operation: Record<string, unknown>): { html: string; css?: string } | null {
  const text = (value: unknown) => typeof value === "string" ? value : undefined;
  if (operation.op === "add_html" || operation.op === "replace_html") return { html: text(operation.html) ?? "", css: text(operation.css) };
  const element = operation.op === "add_element" ? operation.element as Record<string, unknown> | undefined : operation.op === "update_element" ? operation.properties as Record<string, unknown> | undefined : undefined;
  if (element && (typeof element.html === "string" || typeof element.css === "string")) return { html: text(element.html) ?? "", css: text(element.css) };
  return null;
}

/** Every HTML layer in the deck that leaves the brand, by slide. */
export function deckOffBrand(document: DesignDocument, tokens: Record<string, string>): string[] {
  return document.pages.flatMap((page, index) => (page.canvas?.elements ?? []).flatMap(element => {
    if (element.type !== "html") return [];
    const problems = offBrand(element.html, element.css, tokens);
    return problems.length ? [`Slide ${index + 1}, layer ${element.id}: ${problems.join(" ")}`] : [];
  }));
}

/** Images the deck holds that aren't workspace files: data: URLs (other than the template's own artwork and placeholders) and outside links. */
export function unstoredImages(document: DesignDocument, template: DesignTemplate): string[] {
  const keep = imagesToKeep(template), found: string[] = [];
  for (const url of embeddedImages(document)) if (!keep.has(url)) found.push(`${url.slice(0, 40)}…`);
  const visit = (value: unknown, field = "") => {
    if (typeof value === "string") {
      if (["src", "previewSrc", "url"].includes(field) && /^https?:\/\//i.test(value)) found.push(value.slice(0, 120));
      else if ((field === "html" || field === "css") && /(?:src|href)\s*=\s*["']?https?:|url\(\s*["']?https?:/i.test(value)) found.push(`a link in an HTML layer`);
      return;
    }
    if (Array.isArray(value)) value.forEach(child => visit(child));
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) visit(child, key);
  };
  visit(document.pages);
  return found;
}

// ── The deck as the designer reads it ───────────────────────────────────────
const short = (value: unknown, max: number) => typeof value === "string" && value.length > max ? `${value.slice(0, max)}…` : value;
/** Each slide's layers in output pixels: id, kind, slot, box and what it holds, so edits can name them. */
export function deckView(document: DesignDocument, pageIds?: ReadonlySet<string>) {
  const view = agentDeckView(document);
  return {
    id: view.id, name: view.name, size: view.size, coordinates: "output pixels", caption: short(view.caption, 300),
    slides: view.slides.flatMap((slide, index) => pageIds && !pageIds.has(slide.id) ? [] : [{
      slide: index + 1, pageId: slide.id, label: slide.label, background: slide.background,
      layers: slide.elements.map(raw => {
        const element = raw as Record<string, unknown>;
        const src = typeof element.src !== "string" ? undefined : !element.src.startsWith("data:") ? element.src
          : element.templateRole === "media" ? "empty: the template's placeholder" : "the template's artwork";
        return Object.fromEntries(Object.entries({
          id: element.id, type: element.type, name: element.name, slot: element.slot,
          x: round(Number(element.x)), y: round(Number(element.y)), width: round(Number(element.width)), height: round(Number(element.height)),
          hidden: element.hidden || undefined, locked: element.locked || undefined, protected: element.protected,
          text: short(element.text, 240), font: element.font, fontSize: element.fontSize, color: element.color,
          src, fit: element.fit, html: short(element.html, 160), designWidth: element.designWidth,
        }).filter(([, value]) => value !== undefined && value !== ""));
      }),
    }]),
  };
}
const json = (value: unknown) => JSON.stringify(value);
/** A deck error's first issues, each with where it is. */
const issues = (error: AgentDeckValidationError) => error.issues.slice(0, 8).map(issue => `${issue.path}: ${issue.message}`).join("; ");

// ── Building the deck ───────────────────────────────────────────────────────
/** The template's fixed English lines, in the page's own language. */
function ownLines(document: DesignDocument, profile: PageProfile) {
  const fixed: [string, string][] = [["SWIPE FOR MORE", profile.swipeText], ["FOLLOW THIS PAGE", profile.followCta.line1]];
  for (const page of document.pages) for (const element of page.canvas?.elements ?? []) {
    if (element.type !== "text" || element.templateRole !== "brand") continue;
    const swap = fixed.find(([english, own]) => element.text === english && own?.trim() && own !== english);
    if (swap) { element.text = swap[1]; delete element.richText; }
  }
}

/** A post's avatar and photo as workspace files, so its card points to them. */
async function storedPost(session: DesignSession, post: XReaction): Promise<XReaction> {
  const keep = async (url: string | null | undefined, what: string, size?: { width: number; height: number }) => {
    if (!url) return null;
    if (ASSET.test(url)) return url;
    if (!url.startsWith("data:") && !session.found.has(url)) session.found.set(url, { width: size?.width ?? 0, height: size?.height ?? 0, what });
    return placeable(session, url, what).catch(error => { if (session.signal.aborted) throw error; return null; });
  };
  const [avatar, media] = await Promise.all([
    keep(post.author.avatarUrl, `@${post.author.handle}'s profile photo`),
    post.media ? keep(post.media.url, `The photo in @${post.author.handle}'s post`, post.media) : Promise.resolve(null),
  ]);
  return { ...post, author: { ...post.author, avatarUrl: avatar }, media: post.media && media ? { ...post.media, url: media } : null };
}

const CreateSlide = z.object({
  templatePage: z.number().int().min(0).max(19).describe("0-based index of the template page this slide copies"),
  slots: z.record(z.string(), z.string()).describe("Text slots by name, with the slide's words: put [[ ]] around words to set in the brand's accent, as the template does. Photo slots: an asset path from cut_from_source or find_logos, or a photo url from find_photos. Leave out slots the slide doesn't use"),
  posts: z.array(z.string()).max(3).optional().describe("A Reaction page only: the ids x_post gave, one per post card, in order. Their cards are filled from the real posts"),
  photoSize: z.object({ width: z.number(), height: z.number() }).optional().describe("The first page of a photo pair: the photo's size, so its frame takes the photo's proportions"),
  seam: z.number().min(.1).max(.9).optional().describe("The first page of a photo pair: the share of the photo on this slide, chosen so the cut misses faces and text"),
});

async function createDeck(session: DesignSession, input: { name: string; caption: string; slides: z.infer<typeof CreateSlide>[] }): Promise<string> {
  const pages = templatePages(session.template), noFinalPeriods = session.profile.format?.noFinalPeriods ?? true;
  const accent = session.tokens["--color-accent"] ?? "#00D98A";
  const prepared = await Promise.all(input.slides.map(async (slide, index) => {
    const page = pages.find(candidate => candidate.index === slide.templatePage);
    if (!page) throw new ToolError(`Slide ${index + 1}: the template has no page ${slide.templatePage}. Its pages are ${pages.map(item => item.index).join(", ")}.`);
    const texts = new Map(page.text.map(item => [item.slot, item])), photos = new Set(page.photo.map(item => item.slot));
    const slots: Record<string, string> = {}, rich = new Map<string, string>(), placed = new Map<string, string>();
    for (const [name, value] of Object.entries(slide.slots)) {
      if (texts.has(name)) {
        const words = emphasis(cleanSlideText(value, noFinalPeriods), accent);
        slots[name] = words.text;
        if (words.richText) rich.set(name, words.richText);
      } else if (photos.has(name)) {
        if (!value.trim()) continue;
        slots[name] = await placeable(session, value);
        placed.set(name, slots[name]);
      } else throw new ToolError(`Slide ${index + 1}: the ${page.label} page has no slot "${name}". Its slots are ${[...texts.keys(), ...photos].join(", ") || "none"}.`);
    }
    // A text slot the slide leaves out is emptied, so the template's sample words don't stay.
    for (const name of texts.keys()) slots[name] ??= "";
    const posts = (slide.posts ?? []).map(id => {
      const post = session.posts.get(id);
      if (!post) throw new ToolError(`Slide ${index + 1}: no post ${id}. Read it with x_post first.`);
      return post;
    });
    if (posts.length && page.cards !== posts.length) throw new ToolError(`Slide ${index + 1}: the ${page.label} page has ${page.cards || "no"} post card${page.cards === 1 ? "" : "s"}, for ${posts.length} post${posts.length === 1 ? "" : "s"}.`);
    const cards = await Promise.all(posts.map(post => storedPost(session, post)));
    cards.forEach((post, n) => Object.assign(slots, reactionSlots(post, { card: n + 1 })));
    return { slide, page, slots, rich, placed, cards };
  }));
  let document: DesignDocument;
  try {
    document = createAgentDeck({
      id: session.deckId, name: input.name.trim().slice(0, 200) || "Recreated post", templateId: session.template.id,
      caption: cleanSlideText(input.caption, false).slice(0, 20_000),
      slides: prepared.map(({ slide, slots }) => ({ templatePage: slide.templatePage, slots, ...(slide.photoSize ? { photoSize: slide.photoSize } : {}), ...(slide.seam !== undefined ? { seam: slide.seam } : {}) })),
    }, session.templates);
  } catch (error) {
    if (error instanceof AgentDeckValidationError) throw new ToolError(`The deck couldn't be built: ${issues(error)}`);
    throw error;
  }
  const scale = formatDimensions(document).width / 360;
  prepared.forEach((item, index) => {
    const elements = document.pages[index].canvas?.elements ?? [];
    const find = (slot: string) => elements.find(element => element.slot === slot);
    for (const [slot, richText] of item.rich) {
      const element = find(slot);
      if (element?.type === "text") (element as TextElement).richText = richText;
    }
    for (const [slot, path] of item.placed) {
      const element = find(slot), asset = session.assets.get(path);
      if (element?.type !== "image" || !asset) continue;
      const frame = element as ImageElement;
      frame.publicAlt = asset.what.slice(0, 2000);
      if (asset.width && asset.height) { frame.intrinsicWidth = asset.width; frame.intrinsicHeight = asset.height; }
    }
    if (item.cards.length) styleCards(elements, item.cards, scale);
  });
  ownLines(document, session.profile);
  // Decks from a guide's template get its cover touches: gradient words, the remark, topic logos.
  if (session.guide) for (const note of applyGuideToDeck(document, session.guide, { swipeText: session.profile.swipeText })) session.credits.add(note);
  document.tags = [...new Set([...(document.tags ?? []), "recreated", session.profile.id])].slice(0, 20);
  tidySlots(document);
  session.document = document;
  session.unseen = new Set(document.pages.map(page => page.id));
  return json({ built: `${document.pages.length} slide${document.pages.length === 1 ? "" : "s"}. Edit them with edit_deck by these ids; look at them with look_at_slides.`, deck: deckView(document) });
}

/** The operations' images as workspace files: photo srcs swapped for their paths, data: images refused. */
async function placeImages(session: DesignSession, operations: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const swap = async (value: unknown, field = ""): Promise<unknown> => {
    if (typeof value === "string") {
      if (field === "src" && value.trim()) return placeable(session, value);
      if ((field === "html" || field === "css") && /data:image\//i.test(value)) throw new ToolError("An HTML layer can't hold data: images: draw it as inline SVG, or use an image path a tool gave you.");
      if ((field === "html" || field === "css") && /(?:src|href)\s*=\s*["']?https?:|url\(\s*["']?https?:/i.test(value)) {
        // A photo found online goes in by its stored path; nothing else loads from outside Engine.
        let next = value;
        for (const link of new Set([...value.matchAll(/https?:\/\/[^\s"')<>]+/gi)].map(match => match[0]))) next = next.split(link).join(await placeable(session, link));
        return next;
      }
      return value;
    }
    if (Array.isArray(value)) return Promise.all(value.map(child => swap(child)));
    if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await swap(child, key)])));
    return value;
  };
  return await swap(operations) as Record<string, unknown>[];
}

async function editDeck(session: DesignSession, input: { operations: Record<string, unknown>[] }): Promise<string> {
  if (!session.document) throw new ToolError("There is no deck yet: build it with create_deck first.");
  // Without a brand guide or template colors there are no variables to keep to.
  const branded = Object.keys(session.tokens).length > 0;
  const problems = input.operations.flatMap((operation, index) => {
    const html = branded ? htmlOf(operation) : null;
    const found = html ? offBrand(html.html, html.css, session.tokens) : [];
    return found.length ? [`Operation ${index + 1} (${String(operation.op)}): ${found.join(" ")}`] : [];
  });
  if (problems.length) throw new ToolError(`Nothing was changed. ${problems.join(" ")}`);
  let operations = await placeImages(session, input.operations);
  // HTML layers get the brand guide's colors, fonts and sizes as CSS variables.
  if (addsHtmlLayers(operations)) operations = withHtmlLayerTokens(operations, session.tokens);
  const before = new Map(session.document.pages.map(page => [page.id, JSON.stringify(page)]));
  const wasEmpty = emptySlots(session.document);
  try {
    session.document = updateAgentDeck(session.document, { operations });
  } catch (error) {
    if (error instanceof AgentDeckValidationError) throw new ToolError(`Nothing was changed. Fix these and try again: ${issues(error)}`);
    throw error;
  }
  tidySlots(session.document, wasEmpty);
  // The slides this changed (new ones too) wait to be looked at.
  const changed = new Set(session.document.pages.filter(page => before.get(page.id) !== JSON.stringify(page)).map(page => page.id));
  for (const id of changed) session.unseen.add(id);
  for (const id of session.unseen) if (!session.document.pages.some(page => page.id === id)) session.unseen.delete(id);
  return json({ applied: `${operations.length} operation${operations.length === 1 ? "" : "s"}`, deck: deckView(session.document, changed.size ? changed : new Set()) });
}

async function lookAtSlides(session: DesignSession, numbers: number[]): Promise<ToolContent> {
  const document = session.document;
  if (!document) throw new ToolError("There is no deck yet: build it with create_deck first.");
  const wanted = [...new Set(numbers)];
  if (wanted.some(number => number > document.pages.length)) throw new ToolError(`The deck has ${document.pages.length} slide${document.pages.length === 1 ? "" : "s"}.`);
  const renders = await session.render(document, { pageIds: wanted.map(number => document.pages[number - 1].id), ownerKey: session.ownerKey, signal: session.signal, budgetMs: 120_000 }).catch(error => {
    if (session.signal.aborted) throw error;
    return null;
  });
  if (!renders?.length) {
    session.renderable = false;
    return "The slides can't be drawn on this server right now. Check the deck's layers with the deck view instead, then hand it in.";
  }
  const content: Exclude<ToolContent, string> = [];
  for (const render of renders) {
    const number = document.pages.findIndex(page => page.id === render.pageId) + 1;
    // Half size is plenty to judge a slide, and it keeps the conversation small.
    const jpeg = await sharp(render.png).resize({ width: 540, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
    content.push({ type: "text", text: `Slide ${number}${render.exportError ? ` (export would refuse it: ${render.exportError})` : ""}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } });
  }
  for (const render of renders) session.unseen.delete(render.pageId);
  return content;
}

// ── Charts: real data, placed for the designer's box ────────────────────────
type Scale = { lo: number; hi: number; ticks: number[] };
/** The chart drawer's scale (recreate-chart.ts): the printed range, else round gridlines around the values, from zero when they barely move. */
function scaleOf(values: number[], unit: string, range: ChartRange | null | undefined, steps = 0): Scale {
  if (range) return { lo: range.min, hi: range.max, ticks: ticksWithin(range.min, range.max) };
  let min = Math.min(...values);
  const max = Math.max(...values);
  if (unit !== "index" && min >= 0 && max > 0 && (max - min) < max * 0.25) min = 0;
  const ticks = steps ? alignedTicks(min, max, steps) : niceTicks(min, max);
  return { lo: ticks[0], hi: ticks[ticks.length - 1], ticks };
}
/** At most this many points a line: more than one point every two pixels draws nothing more. */
const MAX_POINTS = 600;
/** The indexes to draw: every point, or each bucket's lowest and highest so peaks stay. */
function drawn(values: number[]): number[] {
  if (values.length <= MAX_POINTS) return values.map((_, index) => index);
  const buckets = MAX_POINTS / 2, size = values.length / buckets, kept = new Set<number>([0, values.length - 1]);
  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = Math.floor(bucket * size), to = Math.min(values.length, Math.floor((bucket + 1) * size));
    let low = -1, high = -1;
    for (let index = from; index < to; index++) {
      if (!Number.isFinite(values[index])) { kept.add(index); continue; }
      if (low < 0 || values[index] < values[low]) low = index;
      if (high < 0 || values[index] > values[high]) high = index;
    }
    if (low >= 0) kept.add(low);
    if (high >= 0) kept.add(high);
  }
  return [...kept].sort((a, b) => a - b);
}

/**
 * A resolved chart placed in a box `width` × `height` (the plot, in the HTML
 * layer's CSS pixels, y down): each scale's ticks in the chart's units with
 * their y, the x-axis labels with their x, each line as an SVG path with its
 * end point, the markers and the band. Bars get their boxes instead of paths.
 */
export function placeChart(chart: RecreateChart, width: number, height: number) {
  const sources: string[] = [];
  if (chart.kind === "bar") {
    const values = chart.series[0].values, ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const lo = ticks[0], hi = ticks[ticks.length - 1], y = (value: number) => height - (value - lo) / (hi - lo) * height;
    const slot = width / values.length, bar = slot * .62, lit = new Set(chart.highlight ?? []);
    return {
      kind: "bar", unit: chart.unit, box: { width, height },
      scale: { ticks: ticks.map(value => ({ value, label: formatValue(value, chart.unit), y: round(y(value)) })), zero: round(y(0)) },
      bars: values.map((value, index) => ({
        label: chart.labels[index], value: formatValue(value, chart.unit), highlight: lit.size ? lit.has(index) : true,
        x: round(slot * index + (slot - bar) / 2), width: round(bar), y: round(Math.min(y(value), y(0))), height: round(Math.abs(y(value) - y(0))),
      })),
      sources, notes: chart.notes ?? [],
    };
  }
  const count = chart.series[0].values.length, x = (index: number) => count === 1 ? 0 : index / (count - 1) * width;
  const side = (right: boolean) => chart.series.filter(item => (item.axis === "right") === right);
  const left = scaleOf(side(false).flatMap(item => item.values.filter(Number.isFinite)), chart.unit, chart.range);
  // A second scale's gridlines fall on the first's, unless either keeps a printed range.
  const aligned = Boolean(chart.right) && !chart.range && !chart.right?.range;
  const second = chart.right && side(true).length ? scaleOf(side(true).flatMap(item => item.values.filter(Number.isFinite)), chart.right.unit, chart.right.range, aligned ? left.ticks.length - 1 : 0) : null;
  const y = (scale: Scale, value: number) => height - (value - scale.lo) / (scale.hi - scale.lo) * height;
  const scaleFor = (item: RecreateChart["series"][number]) => item.axis === "right" && second ? second : left;
  const unitFor = (item: RecreateChart["series"][number]) => item.axis === "right" && chart.right ? chart.right.unit : chart.unit;
  const ticks = (scale: Scale, unit: string) => scale.ticks.map(value => ({ value, label: formatValue(value, unit), y: round(y(scale, value)) }));
  const at = (index: number) => chart.series.map(item => ({ series: item.name, y: round(y(scaleFor(item), finiteAt(item.values, index))) }));
  const markers = [
    ...(chart.markerIndex >= 0 ? [{ label: chart.markerLabel, icon: chart.markerIcon, index: chart.markerIndex, main: true }] : []),
    ...(chart.markers ?? []).map(marker => ({ ...marker, main: false })),
  ];
  return {
    kind: "line", unit: chart.unit, period: chart.period ?? null, box: { width, height },
    scales: {
      left: { unit: chart.unit, ticks: ticks(left, chart.unit) },
      ...(second && chart.right ? { right: { unit: chart.right.unit, ticks: ticks(second, chart.right.unit) } } : {}),
    },
    x: chart.labels.flatMap((label, index) => label ? [{ label, x: round(x(index)) }] : []),
    series: chart.series.map(item => {
      const scale = scaleFor(item), last = item.values.findLastIndex(Number.isFinite);
      let path = "", pen = false;
      for (const index of drawn(item.values)) {
        const value = item.values[index];
        if (!Number.isFinite(value)) { pen = false; continue; }
        path += `${pen ? "L" : "M"}${round(x(index))} ${round(y(scale, value))}`;
        pen = true;
      }
      const end = item.values[last], base = finiteAt(item.values, chart.markerIndex);
      const change = chart.endLabel === "change_since_marker" && chart.markerIndex >= 0 && base ? `${end / base >= 1 ? "+" : "−"}${Math.abs(Math.round((end / base - 1) * 100))}%` : null;
      return {
        name: item.name, emphasis: item.emphasis, axis: item.axis === "right" && second ? "right" : "left", path,
        end: { x: round(x(last)), y: round(y(scale, end)), value: formatValue(end, unitFor(item)), ...(change ? { change } : {}) },
      };
    }),
    markers: markers.map(marker => ({ label: marker.label, icon: marker.icon, main: marker.main, x: round(x(marker.index)), at: at(marker.index) })),
    band: chart.band ? { label: chart.band.label, from: round(x(chart.band.from)), to: round(x(chart.band.to)) } : null,
    endLabel: chart.endLabel, sources, notes: chart.notes ?? [],
  };
}

const RangeSchema = z.object({ min: z.number(), max: z.number() });
/** An exact copy's chart may read against two scales and keep its printed ranges, as its original does (the exact copy's chart fields, schemas.ts). */
const ExactChartSchema = ChartSchema.extend({
  series: z.array(ChartSchema.shape.series.element.extend({ axis: z.enum(["left", "right"]).describe("right only for a line the original reads against its second scale; else left") })),
  range: RangeSchema.nullable().describe("The left (or only) scale's lowest and highest numbers as the original prints them, in the series' units; else null to fit the data"),
  right: z.object({ unit: z.string(), range: RangeSchema.nullable() }).nullable().describe("Only when the original prints a second scale: its unit and printed range (or null). Else null"),
});

async function chartData(session: DesignSession, input: { chart: WrittenChart; width: number; height: number }): Promise<string> {
  // A full recreation's chart has one scale, whatever it is handed (charts.ts).
  const written = session.mode === "exact" ? input.chart : oneScale(input.chart);
  let chart: RecreateChart;
  try {
    chart = validateChart(await resolveChartData(chartSpecFrom(written), session.chartData, { signal: session.signal, fetch: session.fetch }));
  } catch (error) {
    if (session.signal.aborted) throw error;
    throw new ToolError(`The chart can't be made: ${message(error)}`);
  }
  const placed = placeChart(chart, input.width, input.height), sources = chartSources(written);
  placed.sources.push(...sources);
  if (sources.length) session.credits.add(`Chart data: ${sources.join(", ")}.`);
  return json({
    ...placed,
    draw: "Draw it as inline SVG in an HTML layer, viewBox 0 0 width height for the plot, with the labels in the brand's type around it. Lines in the brand's colors (the story's line in var(--color-accent)), gridlines as tints of var(--color-text). Give the SVG role=\"img\" and an aria-label saying what it shows.",
  });
}

// ── The tools ───────────────────────────────────────────────────────────────
type DesignTool = Omit<ClientTool, "run"> & { run: (input: Record<string, unknown>) => Promise<ToolContent> };
const OPERATIONS = (AGENT_UPDATE_SCHEMA.properties as Record<string, { items: unknown }>).operations.items;
const LOGO_CREDITS: Record<LogoSource, string> = { guide: "the brand guide's logos", svgl: "svgl.app", "simple-icons": "Simple Icons (CC0)", lobe: "Lobe Icons (MIT)" };

/** The designer's tools for one run. */
export function designTools(session: DesignSession): DesignTool[] {
  const exact = session.mode === "exact";
  const slideImage = (slide: number) => {
    const image = session.slides[slide - 1];
    if (!image) throw new ToolError(session.slides.length ? `The original has ${session.slides.length} slides.` : "The original's slides aren't available in this run.");
    return image;
  };
  const tools: DesignTool[] = [
    {
      name: "create_deck",
      description: [
        "Build the deck from the template's pages: one entry per slide, in order, each copying a template page and filling its slots.",
        "Text slots keep the template's fonts, colors and places, and their size adapts to the words; stay within each slot's length. Photo slots take an image from your tools.",
        "The result lists every slide's layers with their ids, for edit_deck. Calling it again starts the deck over and loses edits made since.",
      ].join(" "),
      schema: z.object({
        name: z.string().min(1).max(200).describe("The deck's name in the library"),
        caption: z.string().max(2200).describe(exact ? "The original's caption, word for word (translated faithfully when the page's language differs)" : "The post's caption, in the page's voice"),
        slides: z.array(CreateSlide).min(1).max(20),
      }),
      run: input => createDeck(session, input as { name: string; caption: string; slides: z.infer<typeof CreateSlide>[] }),
    },
    {
      name: "edit_deck",
      description: [
        "Change the deck: all the operations in one call land together, or none do. Ids come from the deck view create_deck and edit_deck return. Positions and sizes are output pixels.",
        "add_html draws part of a slide (or a whole slide) from HTML and CSS: a chart, a table, a timeline, a comparison, a logo grid. To put it where the template has a photo or chart frame, pass replaces with the frame's id: it takes the frame's box and its place in the template's layout.",
        "HTML layers use the brand's CSS variables for every color and type role (var(--color-accent), var(--title-font), var(--body-size)…); a color written out is refused. Images in them only by an asset path a tool gave you.",
        "Headlines and photos people will change stay native text and image layers: change them with update_element, never inside HTML.",
      ].join(" "),
      schema: z.object({ operations: z.array(z.record(z.string(), z.unknown())).min(1).max(100).meta({ items: OPERATIONS }) }),
      run: input => editDeck(session, input as { operations: Record<string, unknown>[] }),
    },
    {
      name: "look_at_slides",
      description: "See slides as they export, to check what you built: the words fit, nothing overlaps, the chart reads, the photos sit well. Look at every slide you changed before you hand the deck in. At most 4 at a time.",
      schema: z.object({ slides: z.array(z.number().int().min(1).max(20)).min(1).max(4).describe("Slide numbers, from 1") }),
      run: input => lookAtSlides(session, input.slides as number[]),
    },
    {
      name: "find_logos",
      description: "Find brands' logos as clean files (the brand guide's own first, then svgl, Simple Icons and Lobe Icons), stored for the deck. Each comes back with its path and size, or not found: then cut it from the original with cut_from_source (kind logo).",
      schema: z.object({
        logos: z.array(z.object({ brand: z.string().min(1).max(80).describe("The brand by its usual full name: OpenAI, Visual Studio Code"), label: z.string().max(80).optional().describe("The words beside the logo, if any") })).min(1).max(8),
        on: z.enum(["background", "surface"]).optional().describe("What the logos sit on: the slide's background (default) or a card in the surface color, so a one-color mark stays visible"),
      }),
      run: async input => {
        const requests = input.logos as { brand: string; label?: string }[];
        const background = session.tokens[input.on === "surface" ? "--color-surface" : "--color-background"];
        const found = await findLogos(requests, { guide: session.guide, background, signal: session.signal, fetch: session.fetch });
        const results = await Promise.all(found.map(async (logo, index) => {
          const brand = requests[index].brand;
          if (!logo) return { brand, found: false, next: "Cut it from the original with cut_from_source, kind logo." };
          const asset = { width: logo.width, height: logo.height, what: `${logo.name} logo` };
          let src = logo.src;
          if (ASSET.test(src)) session.assets.set(src, asset);
          else if (src.startsWith("data:")) src = await stored(session, src, asset);
          else if (/^\/(?!\/)/.test(src)) session.assets.set(src, asset);
          else { session.found.set(src, asset); src = await placeable(session, src, asset.what); }
          credit(session, src, `Logos come from ${LOGO_CREDITS[logo.source]}; the marks remain their owners' trademarks.`);
          return { brand, found: true, name: logo.name, src, width: logo.width, height: logo.height, onTile: logo.tile };
        }));
        return json({ logos: results });
      },
    },
    {
      name: "x_post",
      description: [
        "Read a real post from X for a post card: by its link, or, for a post the original shows, by its handle and words (and the original slide with its profile photo's and photo's boxes, to build the card from the screenshot when X won't show it).",
        "Returns its words, author, check mark, date and numbers, with its profile photo and photo stored for the deck. Fill a Reaction page with it (create_deck posts), or draw the card in an HTML layer.",
      ].join(" "),
      schema: z.object({
        link: z.string().max(300).optional().describe("A link to the post (x.com/…/status/…)"),
        handle: z.string().max(50).optional().describe("A post the original shows: its @handle, without the @"),
        name: z.string().max(80).optional(), text: z.string().max(2000).optional().describe("Its words, word for word"),
        badge: z.enum(X_BADGES).optional(), square: z.boolean().optional(), date: z.string().nullable().optional().describe("YYYY-MM-DD, or null"),
        language: z.string().max(5).optional().describe("The post's language, a two-letter code"),
        slide: z.number().int().min(1).max(20).optional().describe("The original slide that shows it"),
        avatar: MediaBoxSchema.nullable().optional().describe("Its profile photo on that slide, 0-1000 grid"),
        photo: MediaBoxSchema.nullable().optional().describe("Its photo on that slide, 0-1000 grid"),
      }),
      run: async input => {
        const link = typeof input.link === "string" ? input.link.trim() : "", handle = typeof input.handle === "string" ? input.handle.trim().replace(/^@+/, "") : "";
        let post: XReaction, found = true, note = "";
        if (handle && typeof input.text === "string" && input.text.trim()) {
          const slide = typeof input.slide === "number" ? input.slide : 0;
          const image = slide ? slideImage(slide) : null;
          const [card] = await cardsFor([{
            box: { x: 0, y: 0, width: 1000, height: 1000 }, name: String(input.name ?? handle), handle, badge: (input.badge as typeof X_BADGES[number]) ?? "none",
            square: Boolean(input.square), text: input.text.trim(), language: String(input.language ?? "en"), date: (input.date as string | null) ?? null, link: link || null,
            avatar: image ? cleanBox(input.avatar as MediaBox | null | undefined, 15) : null, photo: image ? cleanBox(input.photo as MediaBox | null | undefined, 15) : null,
          }], slide || 1, {
            cut: box => image ? cropOriginal(image, box) : Promise.reject(new Error("no slide")), caption: session.caption, signal: session.signal,
            budget: session.searches, known: session.known, fetch: session.fetch,
          });
          ({ post, found, note } = card);
        } else if (link) {
          try {
            post = await fetchXPost(link, { signal: session.signal, fetch: session.fetch });
          } catch (error) {
            if (session.signal.aborted) throw error;
            throw new ToolError(`X won't show that post: ${message(error)}`);
          }
        } else throw new ToolError("Give the post's link, or its handle and words.");
        const kept = await storedPost(session, post), id = kept.id || `post-${session.posts.size + 1}`;
        session.posts.set(id, { ...kept, id });
        if (kept.url) {
          // Credited while its card is in the deck, which its stored profile photo (or photo) marks.
          const mark = kept.author.avatarUrl ?? kept.media?.url, text = `Post from X: @${kept.author.handle}, ${kept.url}`;
          if (mark) credit(session, mark, text);
          else session.credits.add(text);
        }
        return json({
          id, found, ...(note ? { note } : {}), url: kept.url, name: kept.author.name, handle: kept.author.handle, badge: kept.author.badge ?? (kept.author.verified ? "blue" : null),
          square: Boolean(kept.author.square), text: kept.text, date: kept.createdAt, likes: kept.likes, reposts: kept.reposts, replies: kept.replies, views: kept.views,
          avatar: kept.author.avatarUrl, photo: kept.media ? { src: kept.media.url, width: kept.media.width, height: kept.media.height, ...(kept.media.kind ? { kind: kept.media.kind } : {}) } : null,
          ...(kept.mediaCount && kept.mediaCount > 1 ? { photos: kept.mediaCount } : {}),
        });
      },
    },
    ...dataTools(session.chartData, session.signal),
    {
      name: "chart_data",
      description: [
        "Make a chart's numbers from real data: FRED series, the S&P 500's history, or typed values the original prints as numbers (never values read off a picture).",
        exact ? "Scales as the original prints them: two only when it prints two." : "One scale: series in different units are indexed to 100 at the marker.",
        "Give the plot's box in the HTML layer's pixels. Returns each scale's ticks in the chart's units with their y, the x-axis labels with their x, each line as an SVG path with its end point, and the markers and band, all placed in that box.",
      ].join(" "),
      schema: z.object({
        chart: exact ? ExactChartSchema : ChartSchema,
        width: z.number().min(100).max(4000).describe("The plot's width in the HTML layer's CSS pixels"),
        height: z.number().min(100).max(4000).describe("The plot's height in the HTML layer's CSS pixels"),
      }),
      run: input => chartData(session, input as { chart: WrittenChart; width: number; height: number }),
    },
    {
      name: "find_photos",
      description: "Find real photos of people, products and events: on X, and on the pages you give (an announcement, a report). Returns up to 8 with their link, size and what a vision check saw in them (or the X post's text when the check didn't look). Place one by its link: Engine stores it as a workspace file when the deck first uses it.",
      schema: z.object({
        search: z.string().min(2).max(120).describe("Who or what, plus context: \"Sam Altman on stage\""),
        pages: z.array(z.string().max(500)).max(6).optional().describe("Pages from the research whose own photos may fit"),
      }),
      run: async input => {
        const search = String(input.search).trim(), pages = ((input.pages as string[] | undefined) ?? []).filter(page => publicHttpUrl(page));
        const [fromPages, fromX] = await Promise.all([
          pages.length ? photosFromPages(pages, session.signal, session.fetch) : Promise.resolve([] as StoryImage[]),
          searchXImages(search, 16),
        ]);
        const unseen = new Set([...fromPages, ...fromX]);
        const kept = (await curateImages([...fromPages, ...fromX], { title: search })).slice(0, 8);
        const photos = (await Promise.all(kept.map(async image => {
          const size = image.width && image.height ? { width: image.width, height: image.height } : await photoSize(image.url, session.signal, session.fetch).catch(() => null);
          if (!size) return null;
          const credit = [image.directive, image.sourceUrl].filter(Boolean).join(", ");
          session.found.set(image.url, { width: size.width, height: size.height, what: (image.description || search).slice(0, 300), credit });
          return { url: image.url, width: size.width, height: size.height, ...(image.description ? unseen.has(image) ? { postText: image.description.slice(0, 200) } : { description: image.description.slice(0, 200) } : {}), credit };
        }))).filter(Boolean);
        if (!photos.length) throw new ToolError(process.env.APIFY_TOKEN || pages.length ? `No usable photos turned up for "${search}". Try other words, or cut the original's photo.` : "Photo search on X needs APIFY_TOKEN on the server. Cut the original's photos, or give pages to take photos from.");
        return json({ photos });
      },
    },
    {
      name: "cut_from_source",
      description: [
        "Cut a photo or a logo out of an original slide, stored for the deck.",
        "photo: a photo or screenshot; its box snaps to the picture's real edges, so no background or text comes with it. logo: one logo's mark, found against its own background, when find_logos doesn't have the brand.",
        "Never cut a chart, a headline or a whole slide: rebuild them.",
      ].join(" "),
      schema: z.object({
        slide: z.number().int().min(1).max(20).describe("The original slide, from 1"),
        box: MediaBoxSchema.describe("Tight around the picture on the original slide, 0-1000 grid"),
        kind: z.enum(["photo", "logo"]),
        labelled: z.boolean().optional().describe("logo: true when the box takes in the logo's label under it, which stays out of the cut"),
        what: z.string().min(1).max(300).describe("What it shows, in plain words, for its alt text"),
      }),
      run: async input => {
        const image = slideImage(input.slide as number), kind = input.kind as "photo" | "logo", what = String(input.what).trim();
        const box = cleanBox(input.box as MediaBox, kind === "logo" ? 15 : 60);
        if (!box) throw new ToolError(kind === "logo" ? "That box is too small: a logo needs at least 1.5% of the slide a side." : "That box is too small for a photo: at least 6% of the slide a side.");
        try {
          const snapped = kind === "photo" ? await snapBox(image, box, "photo") : box;
          const cut = kind === "photo" ? await cropOriginal(image, snapped) : await cutLogo(image, { box, columns: 1, logos: [{ label: input.labelled ? "label" : "" }] });
          if (!cut) throw new ToolError("That box holds no logo: it's all background.");
          const src = await stored(session, cut.url, { width: cut.width, height: cut.height, what });
          credit(session, src, `Cut from the original's slide ${input.slide}: ${what.slice(0, 120)}.`);
          return json({ src, width: cut.width, height: cut.height, box: snapped });
        } catch (error) {
          if (error instanceof ToolError || session.signal.aborted) throw error;
          throw new ToolError(`That couldn't be cut: ${message(error)}.`);
        }
      },
    },
  ];
  // An exact copy shows only the original's own photos, cut from its slides.
  return exact ? tools.filter(tool => tool.name !== "find_photos") : tools;
}
