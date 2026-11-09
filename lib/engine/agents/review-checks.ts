/**
 * Build step F: the review's code checks, on the deck as saved and as the
 * render page drew it (slide-render.ts `measures`). Every issue goes to the
 * designer (route design) or to nobody (route none: what only a person can
 * add, or the original's own words in an exact copy).
 *
 *   - houseChecks: the page's format rules on the template's text slots, empty
 *     photo frames, and pages Export would refuse;
 *   - paletteChecks: CSS colors in HTML layers that aren't the brand's (a
 *     platform card may also use its platform's own, platform-cards.ts);
 *   - headlineChecks: a headline or title drawn inside HTML instead of in its
 *     native text slot, found by its words;
 *   - measuredChecks, from the drawing: text in HTML under the brand's minimum
 *     size, words cut off, headline-size words and photos inside HTML;
 *   - offPageChecks: layers off the page, where smart layout put them.
 *
 * Pure: no storage, no Claude, no browser. The stage (stages/review.ts) runs them.
 */
import { Parser } from "htmlparser2";
import { parse as parseCss } from "postcss";
import type { BrandGuide } from "../../template-editor/brand-guide";
import { formatDimensions, htmlLayerText, type CanvasElement, type DesignDocument, type HtmlElement } from "../../template-editor/model";
import { platformOfLayer } from "../../template-editor/platform-cards";
import type { PageProfile } from "../page-profiles";
import type { MeasuredBox, SlideMeasures, SlideRender } from "../slide-render";
import { reviewBrand, withPlatform } from "./brand";
import { coverPage, followPage, type PageCatalog } from "./pages";
import type { CheckIssue } from "./schemas";

type Issue = CheckIssue;
const SCENE_WIDTH = 360;
/** Two short lines of body text. Spanish runs a little longer, and smart text shrinks to fit, so over this is a should-fix. */
const BODY_LIMIT = 80;
/** A photo inside HTML: past this share of the page it is must-fix, past the smaller one should-fix. Logos and avatars stay under both. */
const PHOTO_MUST = 0.15, PHOTO_SHOULD = 0.06;

const shown = (element: CanvasElement) => !element.hidden;
/** A layer as the designer finds it: its name, and an HTML layer's id too (they're often all called "HTML"). */
const label = (element: CanvasElement) => `“${element.name.replace(/\s+/g, " ").slice(0, 60)}”${element.type === "html" ? ` (${element.id})` : ""}`;
/** Up to four short quotes, then how many more. */
export function quoted(items: string[], size = 40): string {
  const unique = [...new Set(items.map(item => item.replace(/\s+/g, " ").trim()).filter(Boolean))];
  const shownItems = unique.slice(0, 4).map(item => `“${item.length > size ? `${item.slice(0, size - 1)}…` : item}”`);
  if (unique.length > 4) return `${shownItems.join(", ")} and ${unique.length - 4} more`;
  return shownItems.length > 1 ? `${shownItems.slice(0, -1).join(", ")} and ${shownItems[shownItems.length - 1]}` : shownItems.join("");
}
const px = (value: number) => `${Math.round(value * 10) / 10} px`;
/** How a deck's scene px (360 across) become its output px. */
const outputScale = (document: DesignDocument) => formatDimensions(document).width / SCENE_WIDTH;
const sceneHeight = (document: DesignDocument) => { const { width, height } = formatDimensions(document); return SCENE_WIDTH * height / width; };

// ── House rules ──────────────────────────────────────────────────────────────

/** The template's own slots that mark its Cover and Follow pages, and the cover's headline slot. */
function templateMarks(catalog: PageCatalog[]) {
  const slotsOf = (page: PageCatalog) => [...page.text, ...page.photo].map(slot => slot.slot);
  const only = (page: PageCatalog | undefined) => {
    if (!page) return new Set<string>();
    const elsewhere = new Set(catalog.filter(item => item.index !== page.index).flatMap(slotsOf));
    return new Set(slotsOf(page).filter(slot => !elsewhere.has(slot)));
  };
  const cover = coverPage(catalog), follow = followPage(catalog);
  return {
    headline: cover?.text.find(slot => slot.role === "cover")?.slot ?? cover?.text[0]?.slot,
    cta: follow?.text.find(slot => slot.slot === "cta")?.slot ?? follow?.text[0]?.slot,
    followOnly: only(follow),
  };
}

/**
 * The page's format rules on the deck's text slots, photo frames still showing
 * the template's placeholder, and pages Export would refuse. An exact copy
 * keeps the original's words, so its bodies may run long.
 */
export function houseChecks(document: DesignDocument, catalog: PageCatalog[], profile: PageProfile, renders?: Pick<SlideRender, "pageId" | "exportError">[] | null, options: { exact?: boolean } = {}): Issue[] {
  const issues: Issue[] = [];
  const marks = templateMarks(catalog), noFinalPeriods = profile.format?.noFinalPeriods ?? true, locale = profile.language === "es" ? "es" : "en";
  document.pages.forEach((page, index) => {
    const slide = index + 1, elements = page.canvas?.elements ?? [];
    const add = (problem: string, fix: string, severity: Issue["severity"], route: Issue["route"] = "design") => issues.push({ slide, problem, fix, severity, route });
    const follow = elements.some(element => element.slot && marks.followOnly.has(element.slot));
    for (const element of elements) {
      if (!shown(element) || !element.slot || element.templateRole === "brand" || element.slot.startsWith("reaction-")) continue;
      if (element.type === "image") {
        // Topic logos are often vector logos (SVG), never placeholders: they stay hidden until filled.
        if (element.templateRole !== "media" || element.slot.startsWith("topic-logo") || !/^data:image\/svg\+xml/.test(element.src)) continue;
        if (follow) add("The Follow page's photo frame shows the template's placeholder", "A person adds the page's profile screenshot here", "note", "none");
        else add(`The ${element.slot === "photo" ? "" : `${element.slot} `}photo frame still shows the template's placeholder`, element.directive ? `Add a photo: ${element.directive}. Or hide the frame if the slide needs none` : "Add a photo from your tools, or hide the frame if the slide needs none", "should_fix");
        continue;
      }
      if (element.type !== "text") continue;
      const text = element.text.trim(), slot = element.slot;
      if (!text) {
        if (slot !== "source") add(`The ${slot} text is empty`, `Write the ${slot} text, or hide the slot`, "must_fix");
        continue;
      }
      if (noFinalPeriods && text.split("\n").some(line => /(?<!\.)\.$/.test(line.trim()))) add(`The ${slot} text ends with a period`, "Drop the final period", "must_fix");
      if (!options.exact && slot === "body" && [...text].length > BODY_LIMIT) add(`The body is ${[...text].length} characters, more than two short lines`, "Cut it to about 75 characters, one short sentence", "should_fix");
      if (slot === marks.headline && text !== text.toLocaleUpperCase(locale)) add("The cover headline isn't in capitals", options.exact ? "Write the cover headline in capitals, keeping every word" : "Write the cover headline in ALL CAPS", "must_fix");
      if (follow && slot === marks.cta && [...text].length > profile.followCta.maxChars) {
        add(`The Follow line is ${[...text].length} characters, over its ${profile.followCta.maxChars}`, `Write a Follow line of at most ${profile.followCta.maxChars} characters`, "must_fix");
      }
    }
    const render = renders?.find(item => item.pageId === page.id);
    if (render?.exportError) add(render.exportError, options.exact ? "Move this slide's words to a page or layout with room for them, keeping every word" : "Shorten the text so Export accepts the slide", "must_fix");
  });
  return issues;
}

// ── Colors ───────────────────────────────────────────────────────────────────

type Rgba = { r: number; g: number; b: number; a: number };
// CSS named colors, name and hex.
const NAMED = new Map(("aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32")
  .match(/\S+ \S+/g)!.map(pair => pair.split(" ") as [string, string]));
/** Properties whose words can name a color; elsewhere a word like "tan" or "gold" is something else. */
const COLOR_PROPERTY = /color|background|border|outline|shadow|fill|stroke|decoration|column-rule|filter|caret|^--/;
const COLOR_ATTRIBUTES = new Set(["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"]);
const COLOR_FUNCTION = /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)/gi;
const HEX = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;

const clamp255 = (value: number) => Math.max(0, Math.min(255, value));
function channel(value: string): number {
  const number = parseFloat(value);
  return value.trim().endsWith("%") ? clamp255(number * 2.55) : clamp255(number);
}
function alphaOf(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 1;
  const number = parseFloat(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(1, value.trim().endsWith("%") ? number / 100 : number));
}
function hexColor(hex: string): Rgba {
  const full = hex.length <= 4 ? [...hex].map(character => character + character).join("") : hex;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1 };
}
/** rgb() and hsl() in either syntax; null for the color spaces code doesn't convert. */
function functionColor(name: string, body: string): Rgba | null {
  const [main, slash] = body.split("/");
  const parts = main.split(/[\s,]+/).filter(Boolean), alpha = alphaOf(slash ?? parts[3]);
  if (/^rgba?$/i.test(name) && parts.length >= 3) return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
  if (/^hsla?$/i.test(name) && parts.length >= 3) {
    const hue = ((parseFloat(parts[0]) * (/turn$/.test(parts[0]) ? 360 : /rad$/.test(parts[0]) ? 180 / Math.PI : 1)) % 360 + 360) % 360;
    const saturation = Math.max(0, Math.min(1, parseFloat(parts[1]) / 100)), lightness = Math.max(0, Math.min(1, parseFloat(parts[2]) / 100));
    const k = (n: number) => (n + hue / 30) % 12, a = saturation * Math.min(lightness, 1 - lightness);
    const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a: alpha };
  }
  return null;
}
type Found = { text: string; color: Rgba | null };
/** The colors a CSS value writes out itself: hex, rgb(), hsl(), other color functions and, in color properties, color names. */
function literalColors(value: string, property: string): Found[] {
  const found: Found[] = [];
  let rest = value.replace(/url\([^)]*\)/gi, " ").replace(/(["'])(?:(?!\1).)*\1/g, " ");
  rest = rest.replace(COLOR_FUNCTION, (whole: string, name: string, body: string) => {
    found.push({ text: whole.replace(/\s+/g, " "), color: functionColor(name, body) });
    return " ";
  });
  rest = rest.replace(HEX, (whole: string, hex: string) => { found.push({ text: whole, color: hexColor(hex) }); return " "; });
  if (COLOR_PROPERTY.test(property)) {
    for (const word of rest.toLowerCase().match(/(?<![\w#-])[a-z]+(?![\w(-])/g) ?? []) {
      const hex = NAMED.get(word);
      if (hex) found.push({ text: word, color: hexColor(hex) });
    }
  }
  return found;
}
const VARIABLE = /var\(\s*(--[\w-]+)\s*(?:,((?:[^()]|\((?:[^()]|\([^()]*\))*\))*))?\)/g;
/** The value with every var() taken out: a defined variable is checked where it is defined; an undefined one draws its fallback. */
function withoutVariables(value: string, defined: (name: string) => boolean): { value: string; names: string[] } {
  const names: string[] = [];
  let current = value;
  for (let pass = 0; pass < 6 && /var\(/.test(current); pass++) {
    current = current.replace(VARIABLE, (_, name: string, fallback?: string) => {
      names.push(name);
      return defined(name) ? " " : ` ${fallback ?? ""} `;
    });
  }
  return { value: current, names };
}

type Declaration = { property: string; value: string };
/** Every declaration an HTML layer draws with: its CSS, <style> blocks, style attributes and SVG color attributes. */
function declarationsOf(element: Pick<HtmlElement, "html" | "css">): Declaration[] {
  const declarations: Declaration[] = [], sheets = [element.css ?? ""];
  const readSheet = (css: string) => {
    if (!css.trim()) return;
    try { parseCss(css).walkDecls(declaration => { declarations.push({ property: declaration.prop.toLowerCase(), value: declaration.value }); }); } catch { /* CSS that can't be read draws nothing. */ }
  };
  let inStyle = false, styleText = "";
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "style") { inStyle = true; styleText = ""; return; }
      for (const [attribute, value] of Object.entries(attributes)) {
        if (attribute === "style") readSheet(`a{${value}}`);
        else if (COLOR_ATTRIBUTES.has(attribute)) declarations.push({ property: attribute, value });
      }
    },
    ontext(text) { if (inStyle) styleText += text; },
    onclosetag(name) { if (name === "style") { inStyle = false; sheets.push(styleText); } },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true });
  parser.write(element.html);
  parser.end();
  for (const sheet of sheets) readSheet(sheet);
  return declarations;
}

const near = (a: Rgba, b: Rgba) => Math.abs(a.r - b.r) <= 2 && Math.abs(a.g - b.g) <= 2 && Math.abs(a.b - b.b) <= 2;
export function paletteColor(value: string): Rgba | null {
  const match = value.trim().match(/^#([0-9a-f]{3,8})$/i);
  return match && [3, 4, 6, 8].includes(match[1].length) ? hexColor(match[1]) : null;
}
/** The colors an HTML layer draws with that aren't in the palette, each with where it is used. */
export function offPaletteColors(element: Pick<HtmlElement, "html" | "css" | "tokens">, palette: Rgba[]): { text: string; property: string; alpha: number }[] {
  const tokens = element.tokens ?? {}, declarations = declarationsOf(element);
  const own = new Map<string, string[]>();
  for (const declaration of declarations) if (declaration.property.startsWith("--")) own.set(declaration.property, [...(own.get(declaration.property) ?? []), declaration.value]);
  const defined = (name: string) => own.has(name) || name in tokens;
  // A variable the layer defines is checked only when something draws with it; a token only when the layer uses it.
  const used = new Set<string>(), queue: string[] = [];
  const trace = (value: string) => { for (const name of withoutVariables(value, defined).names) if (!used.has(name)) { used.add(name); queue.push(name); } };
  for (const declaration of declarations) if (!declaration.property.startsWith("--")) trace(declaration.value);
  while (queue.length) {
    const name = queue.shift()!;
    for (const value of own.get(name) ?? (name in tokens ? [tokens[name]] : [])) trace(value);
  }
  const checked = [
    ...declarations.filter(declaration => !declaration.property.startsWith("--") || used.has(declaration.property)),
    ...[...used].filter(name => !own.has(name) && name in tokens).map(name => ({ property: name, value: tokens[name] })),
  ];
  const off = new Map<string, { text: string; property: string; alpha: number }>();
  for (const { property, value } of checked) {
    for (const found of literalColors(withoutVariables(value, defined).value, property)) {
      if (found.color && (found.color.a === 0 || palette.some(color => near(color, found.color!)))) continue;
      const key = found.text.toLowerCase();
      if (!off.has(key)) off.set(key, { text: found.text, property, alpha: found.color?.a ?? 1 });
    }
  }
  return [...off.values()];
}

/**
 * CSS colors in HTML layers that aren't the brand's: the guide's and the
 * layer's brand variables. A platform card may also use its platform's own.
 * With no brand colors known (no guide, no variables) there's nothing to check.
 */
export function paletteChecks(document: DesignDocument, guide: BrandGuide | null | undefined): Issue[] {
  const issues: Issue[] = [];
  document.pages.forEach((page, index) => {
    for (const element of page.canvas?.elements ?? []) {
      if (element.type !== "html" || !shown(element)) continue;
      const own = reviewBrand(document, guide, element);
      if (!own.palette.length) continue;
      const brand = withPlatform(own, platformOfLayer(element.html));
      const off = offPaletteColors(element, brand.palette.map(paletteColor).filter((color): color is Rgba => Boolean(color)));
      if (!off.length) continue;
      const strong = off.some(color => color.alpha >= 0.5);
      issues.push({
        slide: index + 1,
        problem: `The HTML layer ${label(element)} uses ${quoted(off.map(color => `${color.property}: ${color.text}`), 60)}, outside the ${brand.name} colors`,
        fix: `Use the brand's variables instead (var(--color-accent), var(--color-text) and the rest: ${own.palette.join(", ")}); for a tint, color-mix(in srgb, var(--color-text) 20%, transparent)`,
        severity: strong ? "must_fix" : "should_fix", route: "design",
      });
    }
  });
  return issues;
}

// ── Headlines and photos drawn inside HTML ───────────────────────────────────

/** Words only, for finding one text inside another: no case, accents kept, no punctuation or emphasis marks. */
export const plainWords = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/\[\[|\]\]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length;
/** A text worth calling a headline: two words or more, eight letters or more. */
const headlineLike = (text: string) => plainWords(text).split(" ").filter(word => /\p{L}/u.test(word)).length >= 2 && letters(text) >= 8;
/** A post card (a platform card, or a layer showing an @handle) redraws a real post: its photo and words are the post's, not ours to edit. */
const isPostCard = (element: HtmlElement) => platformOfLayer(element.html) !== null || /(?:^|[\s(])@[A-Za-z0-9_]{1,15}\b/.test(htmlLayerText(element.html, 4000));

/** A headline or title the deck should show as native text: on deck page `page` (0-based), or on any page when it's null. */
export type WantedText = { page: number | null; text: string; slot: string };

/** Headlines and titles drawn inside an HTML layer, where people can't edit them as text. */
export function headlineChecks(document: DesignDocument, wanted: WantedText[]): { issues: Issue[]; layers: Set<string> } {
  const issues: Issue[] = [], layers = new Set<string>();
  const wanting = wanted.filter(item => headlineLike(item.text));
  document.pages.forEach((page, index) => {
    for (const element of page.canvas?.elements ?? []) {
      if (element.type !== "html" || !shown(element) || isPostCard(element)) continue;
      const words = ` ${plainWords(htmlLayerText(element.html, 8000))} `;
      const hit = wanting.find(item => (item.page === null || item.page === index) && words.includes(` ${plainWords(item.text)} `));
      if (!hit) continue;
      layers.add(element.id);
      issues.push({
        slide: index + 1,
        problem: `“${hit.text.replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").slice(0, 80)}” is drawn inside the HTML layer ${label(element)}, so it can't be edited as text`,
        fix: `Put it in the ${hit.slot} slot, a native text layer, and take it out of the HTML`,
        severity: "must_fix", route: "design",
      });
    }
  });
  return { issues, layers };
}

const area = (box: MeasuredBox) => Math.max(0, box.width) * Math.max(0, box.height);
type Box = { x: number; y: number; width: number; height: number };
const intersect = (a: Box, b: Box): Box => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
};

/**
 * What the render page measured inside HTML layers: words under the brand's
 * minimum size, words cut off, headline-size words (when no headline check
 * already named the layer) and photos. Sizes are compared in the deck's
 * output px. `named` holds layers already reported: for drawing a headline
 * (headline), or for running off the page, which cuts their words (off).
 */
export function measuredChecks(document: DesignDocument, renders: Pick<SlideRender, "pageId" | "measures">[] | null | undefined, guide: BrandGuide | null | undefined, named: { headline?: ReadonlySet<string>; off?: ReadonlySet<string> } = {}): Issue[] {
  const issues: Issue[] = [], scale = outputScale(document), pageBox = { x: 0, y: 0, width: SCENE_WIDTH, height: sceneHeight(document) }, pageArea = area(pageBox);
  document.pages.forEach((page, index) => {
    const measures = renders?.find(render => render.pageId === page.id)?.measures;
    if (!measures) return;
    const slide = index + 1;
    const add = (problem: string, fix: string, severity: Issue["severity"]) => issues.push({ slide, problem, fix, severity, route: "design" });
    for (const element of page.canvas?.elements ?? []) {
      if (element.type !== "html" || !shown(element)) continue;
      const brand = reviewBrand(document, guide, element);
      const texts = measures.texts.filter(text => text.layerId === element.id);
      const small = texts.filter(text => text.size * scale < brand.minText - 0.5);
      if (small.length) {
        const smallest = Math.min(...small.map(text => text.size * scale));
        add(`${quoted(small.map(text => text.text))} in the HTML layer ${label(element)} ${small.length === 1 ? "is" : "are"} set at ${small.length === 1 ? "" : "as little as "}${px(smallest)}, under the ${px(brand.minText)} minimum`,
          `Set every word in it to at least ${px(brand.minText)} (var(--min-text-size)): give the words more room, or show fewer of them`, "must_fix");
      }
      const cut = named.off?.has(element.id) ? [] : texts.filter(text => text.clipped);
      if (cut.length) add(`${quoted(cut.map(text => text.text))} in the HTML layer ${label(element)} ${cut.length === 1 ? "is" : "are"} cut off`, "Fit the words inside the layer's box and the page: a bigger box, shorter words or a smaller size (not under the minimum)", "must_fix");
      const card = isPostCard(element);
      if (!named.headline?.has(element.id) && !card) {
        const big = texts.filter(text => text.size * scale >= brand.titleSize * 0.9 && headlineLike(text.text));
        if (big.length) {
          const sentence = big.some(text => plainWords(text.text).split(" ").length >= 3 || letters(text.text) >= 16);
          add(`${quoted(big.map(text => text.text), 60)} ${big.length === 1 ? "is" : "are"} set at headline size inside the HTML layer ${label(element)}, so people can't edit ${big.length === 1 ? "it" : "them"} as text`,
            "Put headlines and titles in the template's text slots (native text layers) and keep HTML for charts, tables and other graphics", sentence ? "must_fix" : "should_fix");
        }
      }
      if (card) continue;
      // A photo's share of the slide: only the part on the page counts.
      const shares = measures.images.filter(image => image.layerId === element.id && !/^data:image\/svg\+xml/i.test(image.src))
        .map(image => area(intersect(image.box, pageBox)) / pageArea).filter(share => share >= PHOTO_SHOULD);
      if (shares.length) {
        const share = Math.max(...shares);
        add(`The HTML layer ${label(element)} draws a photo inside it (${Math.round(share * 100)}% of the slide), so people can't swap or crop it`,
          "Put the photo in the template's photo frame (update_element src), or a native photo layer, and keep it out of the HTML", share >= PHOTO_MUST ? "must_fix" : "should_fix");
      }
    }
  });
  return issues;
}

/** Without a drawing: an HTML layer over much of the slide that holds a raster picture may be drawing a photo. */
export function photoFallbackChecks(document: DesignDocument): Issue[] {
  const issues: Issue[] = [], pageArea = SCENE_WIDTH * sceneHeight(document);
  const raster = /<(?:img|image)\b[^>]*(?:src|href)\s*=\s*["']?(?:\/api\/template-editor\/assets\/|data:image\/(?:png|jpe?g|webp|gif|avif))/i;
  document.pages.forEach((page, index) => {
    for (const element of page.canvas?.elements ?? []) {
      if (element.type !== "html" || !shown(element) || isPostCard(element)) continue;
      const visible = intersect(element, { x: 0, y: 0, width: SCENE_WIDTH, height: sceneHeight(document) });
      if (area(visible) < pageArea * PHOTO_MUST || !raster.test(element.html)) continue;
      issues.push({ slide: index + 1, problem: `The HTML layer ${label(element)} holds a picture and covers much of the slide: it may draw a photo inside HTML`, fix: "A photo people will change goes in the template's photo frame or a native photo layer, not in the HTML", severity: "should_fix", route: "design" });
    }
  });
  return issues;
}

// ── Layers off the page ──────────────────────────────────────────────────────

/** The box around a layer turned `rotation` degrees about its center. */
function rotatedBox(element: CanvasElement): Box {
  const angle = (element.rotation ?? 0) * Math.PI / 180, cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const width = element.width * cos + element.height * sin, height = element.width * sin + element.height * cos;
  return { x: element.x + element.width / 2 - width / 2, y: element.y + element.height / 2 - height / 2, width, height };
}
const SIDES = ["left", "top", "right", "bottom"] as const;

/**
 * Layers that leave the page, where smart layout put them (the render page's
 * boxes, else the saved ones). Words and HTML anywhere past the edge are cut
 * off; a photo or shape bleeding off the page is a choice, unless it is small
 * (a logo, a badge) or nearly all off. The template's branding and the halves
 * of a photo across two slides are left alone. `cut` collects the words and
 * HTML layers it reports.
 */
export function offPageChecks(document: DesignDocument, renders?: Pick<SlideRender, "pageId" | "measures">[] | null, cut?: Set<string>): Issue[] {
  const issues: Issue[] = [], height = sceneHeight(document), pageBox = { x: 0, y: 0, width: SCENE_WIDTH, height }, pageArea = SCENE_WIDTH * height, slack = 0.5;
  document.pages.forEach((page, index) => {
    const measures: SlideMeasures | undefined = renders?.find(render => render.pageId === page.id)?.measures;
    for (const element of page.canvas?.elements ?? []) {
      if (!shown(element) || element.templateRole === "brand" || (element.type === "image" && element.span)) continue;
      const measured = measures?.layers.find(layer => layer.id === element.id)?.box;
      if (measures && !measured) continue;
      let box: Box = measured ?? rotatedBox(element);
      if (element.clipBounds) box = intersect(box, element.clipBounds);
      if (!(box.width > 0 && box.height > 0)) continue;
      const past = { left: -box.x, top: -box.y, right: box.x + box.width - SCENE_WIDTH, bottom: box.y + box.height - height };
      const sides = SIDES.filter(side => past[side] > slack);
      if (!sides.length) continue;
      const visible = area(intersect(box, pageBox)) / area(box);
      const where = `${sides.join(" and ")} edge${sides.length === 1 ? "" : "s"}`;
      if (element.type === "text" || element.type === "html") {
        cut?.add(element.id);
        issues.push({ slide: index + 1, problem: `The ${element.type === "html" ? "HTML layer" : "text"} ${label(element)} runs off the page at the ${where}, so part of it is cut off`, fix: "Move or resize it so all of it sits on the page, inside the margins", severity: "must_fix", route: "design" });
      } else if (visible < 0.02) {
        issues.push({ slide: index + 1, problem: `The ${element.type === "image" ? "picture" : "shape"} ${label(element)} is off the page, so it can't be seen`, fix: "Move it onto the page, or delete it", severity: "should_fix", route: "design" });
      } else if (area(box) < pageArea * 0.1 || visible < 0.5) {
        issues.push({ slide: index + 1, problem: `The ${element.type === "image" ? "picture" : "shape"} ${label(element)} runs off the page at the ${where}`, fix: "Move it fully onto the page", severity: "should_fix", route: "design" });
      }
    }
  });
  return issues;
}

/** Every code check on HTML layers and layer positions, in one list. */
export function htmlChecks(document: DesignDocument, renders: Pick<SlideRender, "pageId" | "measures">[] | null | undefined, guide: BrandGuide | null | undefined, wanted: WantedText[]): Issue[] {
  const headlines = headlineChecks(document, wanted), off = new Set<string>();
  const offPage = offPageChecks(document, renders, off);
  const measured = Boolean(renders?.some(render => render.measures));
  return [
    ...paletteChecks(document, guide),
    ...headlines.issues,
    ...measuredChecks(document, renders, guide, { headline: headlines.layers, off }),
    ...(measured ? [] : photoFallbackChecks(document)),
    ...offPage,
  ];
}
