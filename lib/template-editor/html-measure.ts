/**
 * Measures an HTML layer in the browser for "Break into layers" (html-break.ts).
 * It mounts the layer's prepared markup offscreen at its design size, unscaled
 * and unrotated, the way the canvas mounts it (canvas.tsx HtmlLayerContent).
 * It waits for fonts and images, reads every visible element's box and computed
 * style, and removes the markup again.
 *
 * Browser only, with no runtime imports, so a test can transpile this file on
 * its own and inject it into a page.
 *
 * It returns pieces in paint order, in design px from the layer's top-left corner:
 *   - shape: a box's background (a colour or a linear gradient), its border,
 *     corner radius and shadow. A border that differs by side becomes one thin
 *     box per side.
 *   - image: an <img>, or a top-level <svg> drawn to a PNG at output resolution
 *     with its computed styles inlined (classes and CSS variables don't reach
 *     inside an image). Simple SVG <text> becomes text pieces instead, because
 *     an SVG drawn as an image can't use the page's fonts.
 *   - text: a block's words, line by line as the browser wrapped them, with each
 *     run's style and each line's baseline. Lines that don't share a left edge,
 *     centre or right edge, or that aren't evenly spaced, become separate pieces.
 *     With options.sceneScale, each says where a text layer would put its
 *     baseline (layerBaseline), so html-break.ts can place it on the same one.
 * Hidden, empty, transparent and fully clipped boxes are skipped. ::before and
 * ::after are drawn as real elements first, so their bars and bullets are kept.
 * Transforms inside the layer are switched off while measuring and mapped back
 * afterwards, so text wraps as it did and rotated boxes keep their angle.
 */
import type { CanvasGradient, CanvasShadow } from "./model";

/** A box in design px from the layer's top-left corner, before `rotation`. */
export type HtmlBox = { x: number; y: number; width: number; height: number };
export type HtmlTextStyle = {
  /** The computed font-family list. */
  fontFamily: string;
  /** The Engine font id whose stack resolves to the same list, when `fonts` was given. */
  font?: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** #RRGGBB or #RRGGBBAA. */
  color: string;
  letterSpacing: number;
};
export type HtmlTextRun = HtmlTextStyle & { text: string };
/** One line as the browser wrapped it: its glyphs' box (in the piece's own frame),
 * its runs and its alphabetic baseline (design px, same frame). An empty line,
 * from two <br> in a row, has no runs. */
export type HtmlTextLine = { box: HtmlBox; runs: HtmlTextRun[]; baseline?: number };
type HtmlPieceBase = {
  name: string;
  box: HtmlBox;
  /** Degrees, around the box's centre. */
  rotation: number;
  /** Cumulative opacity inside the layer. */
  opacity: number;
  /** The layer's box and any ancestor's overflow clip, when the piece reaches past them. */
  clip?: HtmlBox;
  blendMode?: string;
};
export type HtmlShapePiece = HtmlPieceBase & {
  kind: "shape";
  ellipse: boolean;
  fill?: string;
  gradient?: CanvasGradient;
  radius: number;
  stroke?: { color: string; width: number; align: "inside" | "center"; dash?: number[] };
  shadow?: CanvasShadow;
};
export type HtmlImagePiece = HtmlPieceBase & {
  kind: "image";
  src: string;
  fit: "cover" | "contain";
  /** object-position, 0–100. */
  positionX: number;
  positionY: number;
  radius: number;
  ellipse: boolean;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  /** Drawn from an <svg>. */
  graphic?: boolean;
};
export type HtmlTextPiece = HtmlPieceBase & {
  kind: "text";
  align: "left" | "center" | "right";
  /** Distance between lines, px. `box.y` is the first line box's top. */
  lineHeight: number;
  /** Room around the lines for glyphs that reach past their line boxes. */
  padding: number;
  /** The most-used run style; runs that differ become rich-text spans. */
  style: HtmlTextStyle;
  lines: HtmlTextLine[];
  /** With options.sceneScale: how far below the top of its first line box a text
   * layer made from this piece draws that line's baseline, design px. A text layer
   * is laid out in scene units, where the browser rounds a font's ascent and the
   * leading to whole units, so this differs from the HTML's own spacing. */
  layerBaseline?: number;
  gradient?: CanvasGradient;
  shadow?: CanvasShadow;
};
export type HtmlPiece = HtmlShapePiece | HtmlImagePiece | HtmlTextPiece;
export type HtmlMarkupInput = { html: string; css: string; scope: string; designWidth: number; designHeight: number };
export type HtmlMeasureOptions = {
  signal?: AbortSignal;
  /** Engine font ids and their CSS stacks (html-layer.ts HTML_FONT_STACKS), to name each run's font. */
  fonts?: Readonly<Record<string, string>>;
  /** Output px per design px for drawn SVG (default 1). */
  outputScale?: number;
  /** Longest side of a drawn SVG, in px (default 2400). */
  maxRasterSide?: number;
  /** Scene units per design px: the layer's width / designWidth. With it, text
   * pieces carry layerBaseline, and a drawn SVG is cut on whole scene units so
   * its pixels land on output pixels. */
  sceneScale?: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** A text layer's font size (scene units) and line-height multiplier, for text
 * `fontSize` px tall with lines `lineHeight` px apart, at `scale` units per px.
 * html-break.ts writes these; measuring lays a text layer out with them. */
export function textLayerSize(fontSize: number, lineHeight: number, scale: number): { fontSize: number; lineHeight: number } {
  return { fontSize: round(clamp(fontSize * scale, 1, 500), 4), lineHeight: round(clamp(lineHeight / fontSize, 0.5, 5), 4) };
}
/** A rich-text span's font size, in scene px. */
export const textLayerSpanSize = (fontSize: number, scale: number) => round(clamp(fontSize * scale, 1, 500), 2);

type Point = { x: number; y: number };
/** A 2D affine transform: x' = a x + c y + e, y' = b x + d y + f. */
type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };
/** One transformed element: its matrix, applied about `origin`, in untransformed coordinates. */
type Link = { origin: Point; matrix: Affine };
/** An overflow clip, set by an element `depth` links down its transform chain. */
type Clip = { box: HtmlBox; depth: number };
type Draft = { piece: HtmlPiece; chain: Link[]; clip?: Clip };
type State = { opacity: number; clip?: Clip; chain: Link[]; label?: { text: string; used: boolean } };
/** `step`: output px per scene unit, when the drawing is cut on whole units. */
type Raster = { draft: Draft; svg: SVGSVGElement; hidden: Set<Element>; user: HtmlBox; step?: number };
type Context = {
  origin: Point;
  layer: HtmlBox;
  scope: string;
  resolve: FontResolver;
  chains: Map<Element, Link[]> | null;
  drafts: Draft[];
  rasters: Raster[];
  /** Where probes are laid out, beside the markup. */
  probes: HTMLElement;
  /** Each font's ascent as laid out here, by font. */
  ascents: Map<string, number>;
  /** Design px per scene unit and output px per unit, to cut drawn SVG on whole units. */
  grid?: { unit: number; step: number };
};
type FontResolver = (family: string) => string | undefined;
type Style = CSSStyleDeclaration;

const MEASURE_ATTRIBUTE = "data-te-html-measure";
const PSEUDO_TAG = "te-pseudo";
const EPSILON = 0.01;

const abortError = (signal: AbortSignal) => signal.reason instanceof Error ? signal.reason : new DOMException("Measuring was cancelled.", "AbortError");
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal);
}
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(abortError(signal));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    promise.then(value => { signal.removeEventListener("abort", stop); resolve(value); }, error => { signal.removeEventListener("abort", stop); reject(error); });
  });
}

const round = (value: number, places = 3) => { const factor = 10 ** places; return Math.round(value * factor) / factor; };
const px = (value: string | null | undefined) => { const number = Number.parseFloat(value ?? ""); return Number.isFinite(number) ? number : 0; };
function intersect(a: HtmlBox, b: HtmlBox): HtmlBox | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  return right - x > EPSILON && bottom - y > EPSILON ? { x, y, width: right - x, height: bottom - y } : null;
}
const contains = (outer: HtmlBox, inner: HtmlBox) => inner.x >= outer.x - EPSILON && inner.y >= outer.y - EPSILON && inner.x + inner.width <= outer.x + outer.width + EPSILON && inner.y + inner.height <= outer.y + outer.height + EPSILON;

// ---------------------------------------------------------------------------
// Colours

let colorContext: CanvasRenderingContext2D | null | undefined;
const colorCache = new Map<string, string | null>();
const hex2 = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0");
function hexFrom(red: number, green: number, blue: number, alpha: number): string | null {
  if (!(alpha > 0.002)) return null;
  return `#${hex2(red)}${hex2(green)}${hex2(blue)}${alpha < 0.998 ? hex2(alpha * 255) : ""}`.toUpperCase();
}
function parseRgb(value: string): string | null | undefined {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(value.trim());
  if (!match) return undefined;
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
  return hexFrom(Number(match[1]), Number(match[2]), Number(match[3]), alpha);
}
/** A computed CSS colour as #RRGGBB or #RRGGBBAA, or null when it's fully transparent. */
export function cssColorToHex(value: string, alphaScale = 1): string | null {
  const key = `${value}|${alphaScale}`;
  const cached = colorCache.get(key);
  if (cached !== undefined) return cached;
  let result: string | null | undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "transparent" || trimmed === "none") result = null;
  else {
    result = parseRgb(trimmed);
    if (result === undefined) {
      // oklch(), color(), lab() and the rest: a canvas converts them to sRGB.
      if (colorContext === undefined) colorContext = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      const context = colorContext;
      if (context) {
        context.fillStyle = "#000000";
        context.fillStyle = value;
        const normalized = String(context.fillStyle);
        result = /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : parseRgb(normalized);
        if (result === undefined) {
          context.clearRect(0, 0, 1, 1);
          context.fillRect(0, 0, 1, 1);
          const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
          result = hexFrom(red, green, blue, alpha / 255);
        }
      }
    }
  }
  if (result && alphaScale < 0.998) result = hexFrom(parseInt(result.slice(1, 3), 16), parseInt(result.slice(3, 5), 16), parseInt(result.slice(5, 7), 16), alphaOf(result) * alphaScale);
  colorCache.set(key, result ?? null);
  return result ?? null;
}
const alphaOf = (color: string) => color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1;

// ---------------------------------------------------------------------------
// Gradients

/** Splits on `separator` (a comma, or " " for white space) outside parentheses and quotes. */
function splitTop(value: string, separator = ","): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0, quote = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) { if (character === quote && value[index - 1] !== "\\") quote = ""; continue; }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (depth === 0 && (separator === " " ? /\s/.test(character) : character === separator)) { parts.push(value.slice(start, index)); start = index + 1; }
  }
  parts.push(value.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}
function angleOf(value: string, width: number, height: number): number | null {
  const unit = /^(-?[\d.]+)(deg|turn|rad|grad)$/.exec(value);
  if (unit) {
    const number = Number(unit[1]);
    return unit[2] === "deg" ? number : unit[2] === "turn" ? number * 360 : unit[2] === "rad" ? number * 180 / Math.PI : number * 0.9;
  }
  const to = /^to\s+(.+)$/.exec(value);
  if (!to) return null;
  const sides = new Set(to[1].split(/\s+/));
  const corner = Math.atan2(height, width) * 180 / Math.PI;
  const top = sides.has("top"), bottom = sides.has("bottom"), left = sides.has("left"), right = sides.has("right");
  if (top && right) return corner;
  if (bottom && right) return 180 - corner;
  if (bottom && left) return 180 + corner;
  if (top && left) return 360 - corner;
  return top ? 0 : right ? 90 : bottom ? 180 : left ? 270 : null;
}
function mix(from: { color: string; position: number }, to: { color: string; position: number }, position: number): string {
  const amount = to.position === from.position ? 1 : (position - from.position) / (to.position - from.position);
  const channel = (color: string, index: number) => index < 3 ? parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) : alphaOf(color) * 255;
  const values = [0, 1, 2, 3].map(index => channel(from.color, index) + (channel(to.color, index) - channel(from.color, index)) * amount);
  return hexFrom(values[0], values[1], values[2], values[3] / 255) ?? "#00000000";
}
/** A computed linear-gradient(), or a radial-gradient() from the centre, as Engine's gradient. */
export function parseCssGradient(value: string, width: number, height: number, alphaScale = 1): CanvasGradient | null {
  const match = /^(linear|radial)-gradient\((.*)\)$/i.exec(value.trim());
  if (!match) return null;
  const type = match[1].toLowerCase() as "linear" | "radial";
  const args = splitTop(match[2]);
  const first = (args[0] ?? "").replace(/\bin\s+[a-z0-9-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/gi, "").trim();
  const isColor = (part: string) => /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|^#|^[a-z]+$/i.test(part.split(/\s+/)[0] ?? "") && !/^(to|circle|ellipse|closest|farthest|at)\b/i.test(part);
  let angle = 180;
  if (type === "linear") {
    if (!isColor(first)) {
      const parsed = first ? angleOf(first, width, height) : 180;
      if (parsed === null) return null;
      angle = parsed;
      args.shift();
    }
  } else if (!isColor(first)) {
    // Engine draws a circle from the centre out to the corners; keep only gradients like it.
    if (!/^(circle|ellipse)?(\s*farthest-corner)?(\s*at\s+(center|50% 50%))?$/i.test(first)) return null;
    args.shift();
  }
  const length = type === "linear" ? Math.abs(width * Math.sin(angle * Math.PI / 180)) + Math.abs(height * Math.cos(angle * Math.PI / 180)) : Math.hypot(width, height) / 2;
  const stops: { color: string; position?: number }[] = [];
  for (const arg of args) {
    const parts = splitTop(arg, " ");
    const colorPart = parts.find(part => !/^-?[\d.]+(px|%)?$/.test(part) && !/^calc\(/i.test(part));
    if (!colorPart) continue; // a colour hint
    const color = cssColorToHex(colorPart, alphaScale) ?? "#00000000";
    const positions = parts.filter(part => part !== colorPart).map(part => part.endsWith("%") ? Number.parseFloat(part) : part.endsWith("px") && length > 0 ? Number.parseFloat(part) / length * 100 : Number.NaN).filter(Number.isFinite);
    if (!positions.length) stops.push({ color });
    for (const position of positions) stops.push({ color, position });
  }
  if (stops.length < 2) return null;
  // As CSS does: the ends default to 0 and 100, the rest spread evenly, and none goes backwards.
  if (stops[0].position === undefined) stops[0].position = 0;
  if (stops[stops.length - 1].position === undefined) stops[stops.length - 1].position = 100;
  let previous = stops[0].position;
  for (let index = 1; index < stops.length; index++) {
    if (stops[index].position === undefined) {
      let next = index;
      while (stops[next].position === undefined) next++;
      const to = Math.max(previous, stops[next].position!);
      for (let fill = index; fill < next; fill++) stops[fill].position = previous + (to - previous) * (fill - index + 1) / (next - index + 1);
    }
    stops[index].position = Math.max(previous, stops[index].position!);
    previous = stops[index].position!;
  }
  const placed = stops as { color: string; position: number }[];
  const at = (position: number) => {
    if (position <= placed[0].position) return placed[0].color;
    for (let index = 1; index < placed.length; index++) if (position <= placed[index].position) return mix(placed[index - 1], placed[index], position);
    return placed[placed.length - 1].color;
  };
  const inside = placed.filter(stop => stop.position >= 0 && stop.position <= 100);
  const all = [...(inside[0]?.position === 0 ? [] : [{ color: at(0), position: 0 }]), ...inside, ...(inside.at(-1)?.position === 100 ? [] : [{ color: at(100), position: 100 }])];
  const sampled = all.length > 20 ? Array.from({ length: 20 }, (_, index) => all[Math.round(index * (all.length - 1) / 19)]) : all;
  return { type, angle: round(((angle % 360) + 360) % 360, 2), stops: sampled.map(stop => ({ color: stop.color, position: round(stop.position, 2) })) };
}

// ---------------------------------------------------------------------------
// Transforms

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const multiply = (left: Affine, right: Affine): Affine => ({
  a: left.a * right.a + left.c * right.b, b: left.b * right.a + left.d * right.b,
  c: left.a * right.c + left.c * right.d, d: left.b * right.c + left.d * right.d,
  e: left.a * right.e + left.c * right.f + left.e, f: left.b * right.e + left.d * right.f + left.f,
});
const isIdentity = (matrix: Affine) => Math.abs(matrix.a - 1) < 1e-6 && Math.abs(matrix.b) < 1e-6 && Math.abs(matrix.c) < 1e-6 && Math.abs(matrix.d - 1) < 1e-6 && Math.abs(matrix.e) < 1e-6 && Math.abs(matrix.f) < 1e-6;
function affineOf(value: string): Affine {
  if (!value || value === "none") return IDENTITY;
  try { const matrix = new DOMMatrixReadOnly(value); return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }; } catch { return IDENTITY; }
}
/** translate, rotate and scale, then transform, as CSS applies them. */
function elementAffine(style: Style): Affine {
  let matrix = IDENTITY;
  const translate = style.getPropertyValue("translate"), rotate = style.getPropertyValue("rotate"), scale = style.getPropertyValue("scale");
  if (translate && translate !== "none") { const [x = "0", y = "0"] = translate.split(/\s+/); matrix = multiply(matrix, { ...IDENTITY, e: px(x), f: px(y) }); }
  if (rotate && rotate !== "none") {
    const angle = /(-?[\d.]+)deg\s*$/.exec(rotate);
    if (angle) { const radians = Number(angle[1]) * Math.PI / 180; matrix = multiply(matrix, { a: Math.cos(radians), b: Math.sin(radians), c: -Math.sin(radians), d: Math.cos(radians), e: 0, f: 0 }); }
  }
  if (scale && scale !== "none") { const [x = "1", y = x] = scale.split(/\s+/); matrix = multiply(matrix, { ...IDENTITY, a: Number.parseFloat(x) || 1, d: Number.parseFloat(y) || 1 }); }
  return multiply(matrix, affineOf(style.transform));
}
function mapPoint(chain: Link[], point: Point): Point {
  let { x, y } = point;
  for (let index = chain.length - 1; index >= 0; index--) {
    const { origin, matrix } = chain[index];
    const dx = x - origin.x, dy = y - origin.y;
    x = origin.x + matrix.a * dx + matrix.c * dy + matrix.e;
    y = origin.y + matrix.b * dx + matrix.d * dy + matrix.f;
  }
  return { x, y };
}
const linearOf = (chain: Link[]) => chain.reduce((total, link) => multiply(total, { ...link.matrix, e: 0, f: 0 }), IDENTITY);

/** Records every transformed element's matrix, then switches transforms off, so
 * everything is measured as laid out. Returns each element's chain of transforms,
 * or null when nothing is transformed. */
function untransform(root: Element): Map<Element, Link[]> | null {
  const transformed: { element: HTMLElement | SVGSVGElement; matrix: Affine; origin: string }[] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGSVGElement && !element.ownerSVGElement)) continue;
    const style = styleOf(element);
    const matrix = elementAffine(style);
    if (!isIdentity(matrix)) transformed.push({ element, matrix, origin: style.transformOrigin });
  }
  if (!transformed.length) return null;
  for (const { element } of transformed) {
    // A transform makes its element the containing block of absolute children; keep that.
    if (styleOf(element).position === "static") element.style.setProperty("position", "relative", "important");
    for (const name of ["transform", "translate", "rotate", "scale"]) element.style.setProperty(name, "none", "important");
  }
  const rootRect = root.getBoundingClientRect();
  const links = new Map<Element, Link>();
  for (const { element, matrix, origin } of transformed) {
    const rect = element.getBoundingClientRect();
    const [x = "50%", y = "50%"] = origin.split(/\s+/);
    const resolve = (value: string, size: number) => value.endsWith("%") ? Number.parseFloat(value) / 100 * size : px(value);
    links.set(element, { origin: { x: rect.left - rootRect.left + resolve(x, rect.width), y: rect.top - rootRect.top + resolve(y, rect.height) }, matrix });
  }
  const chains = new Map<Element, Link[]>();
  const chainOf = (element: Element): Link[] => {
    const known = chains.get(element);
    if (known) return known;
    const parent = element === root || !element.parentElement ? [] : chainOf(element.parentElement);
    const link = links.get(element);
    const chain = link ? [...parent, link] : parent;
    chains.set(element, chain);
    return chain;
  };
  for (const element of [root, ...root.querySelectorAll("*")]) chainOf(element);
  return chains;
}

function rotatedBounds(box: HtmlBox, rotation: number): HtmlBox {
  if (!rotation) return box;
  const radians = rotation * Math.PI / 180, cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians));
  const width = box.width * cos + box.height * sin, height = box.width * sin + box.height * cos;
  return { x: box.x + box.width / 2 - width / 2, y: box.y + box.height / 2 - height / 2, width, height };
}

/** Puts a draft through its transform chain and clips it to the layer. */
function finish(draft: Draft, layer: HtmlBox): HtmlPiece | null {
  const { piece, chain } = draft;
  let clip = draft.clip?.box;
  if (chain.length) {
    const before = piece.box;
    const center = mapPoint(chain, { x: before.x + before.width / 2, y: before.y + before.height / 2 });
    const linear = linearOf(chain);
    const scale = Math.sqrt(Math.abs(linear.a * linear.d - linear.b * linear.c)) || 1;
    const width = before.width * scale, height = before.height * scale;
    piece.box = { x: center.x - width / 2, y: center.y - height / 2, width, height };
    piece.rotation = round(piece.rotation + Math.atan2(linear.b, linear.a) * 180 / Math.PI, 3);
    const move = (box: HtmlBox): HtmlBox => ({ x: piece.box.x + (box.x - before.x) * scale, y: piece.box.y + (box.y - before.y) * scale, width: box.width * scale, height: box.height * scale });
    if (piece.kind === "text") {
      const sized = (style: HtmlTextStyle) => ({ ...style, fontSize: style.fontSize * scale, letterSpacing: style.letterSpacing * scale });
      piece.lineHeight *= scale;
      piece.padding *= scale;
      piece.style = sized(piece.style);
      piece.lines = piece.lines.map(line => ({
        box: move(line.box), runs: line.runs.map(run => ({ ...sized(run), text: run.text })),
        ...(line.baseline === undefined ? {} : { baseline: piece.box.y + (line.baseline - before.y) * scale }),
      }));
      if (piece.shadow) piece.shadow = { ...piece.shadow, offsetX: piece.shadow.offsetX * scale, offsetY: piece.shadow.offsetY * scale, blur: piece.shadow.blur * scale };
    } else {
      piece.radius *= scale;
      if (piece.kind === "shape" && piece.stroke) piece.stroke = { ...piece.stroke, width: piece.stroke.width * scale, ...(piece.stroke.dash ? { dash: piece.stroke.dash.map(value => value * scale) } : {}) };
      if (piece.kind === "shape" && piece.shadow) piece.shadow = { ...piece.shadow, offsetX: piece.shadow.offsetX * scale, offsetY: piece.shadow.offsetY * scale, blur: piece.shadow.blur * scale, spread: piece.shadow.spread * scale };
    }
    // A clip set outside the transformed part stays where it is; one set inside it
    // moves with it, and is dropped if it turns.
    const clipChain = draft.clip ? chain.slice(0, draft.clip.depth) : [];
    if (clip && clipChain.length) {
      const clipLinear = linearOf(clipChain);
      if (Math.abs(clipLinear.b) > 1e-6 || Math.abs(clipLinear.c) > 1e-6) clip = undefined;
      else {
        const a = mapPoint(clipChain, { x: clip.x, y: clip.y }), b = mapPoint(clipChain, { x: clip.x + clip.width, y: clip.y + clip.height });
        clip = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
      }
    }
  }
  const outer = clip ? intersect(clip, layer) : layer;
  if (!outer) return null;
  const bounds = rotatedBounds(piece.box, piece.rotation);
  if (!intersect(outer, bounds)) return null;
  if (!contains(outer, bounds)) piece.clip = outer;
  return piece;
}

// ---------------------------------------------------------------------------
// Styles

const styles = new WeakMap<Element, Style>();
function styleOf(element: Element): Style {
  let style = styles.get(element);
  if (!style) { style = getComputedStyle(element); styles.set(element, style); }
  return style;
}
const isFlexLike = (style: Style) => /flex|grid/.test(style.display);
const REPLACED = new Set(["IMG", "BR", "VIDEO", "CANVAS", "IFRAME", "INPUT", "TEXTAREA", "SELECT", "OBJECT", "EMBED", "PICTURE", "HR", "WBR"]);
const isReplaced = (element: Element) => element instanceof SVGElement || REPLACED.has(element.tagName.toUpperCase());
const blendOf = (style: Style) => style.mixBlendMode && style.mixBlendMode !== "normal" ? { blendMode: style.mixBlendMode } : {};
const backgroundClipsText = (style: Style) => /text/.test(`${style.getPropertyValue("background-clip")} ${style.getPropertyValue("-webkit-background-clip")}`);

function opacityBetween(element: Element, ancestor: Element): number {
  let opacity = 1;
  for (let node: Element | null = element; node && node !== ancestor; node = node.parentElement) opacity *= Number.parseFloat(styleOf(node).opacity) || 0;
  return opacity;
}

const normalizeFamily = (family: string) => family.split(",").map(name => name.trim().replace(/^["']|["']$/g, "").toLowerCase()).filter(Boolean).join(",");
/** Resolves each Engine font stack in the layer, so a run's computed family names its font. */
function fontResolver(root: Element, fonts?: Readonly<Record<string, string>>): FontResolver {
  if (!fonts) return () => undefined;
  const probe = document.createElement("span");
  root.append(probe);
  const exact = new Map<string, string>(), first = new Map<string, string>();
  for (const [id, stack] of Object.entries(fonts)) {
    probe.style.fontFamily = "";
    probe.style.fontFamily = stack;
    const resolved = normalizeFamily(getComputedStyle(probe).fontFamily);
    if (!resolved || resolved.includes("var(")) continue;
    if (!exact.has(resolved)) exact.set(resolved, id);
    const head = resolved.split(",")[0];
    if (head && !first.has(head) && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/.test(head)) first.set(head, id);
  }
  probe.remove();
  return family => {
    const resolved = normalizeFamily(family);
    return exact.get(resolved) ?? first.get(resolved.split(",")[0]);
  };
}

/** A text run's style. `fill` reads an SVG text's fill instead of its colour;
 * `scale` turns SVG user units into design px. */
function textStyleOf(element: Element, block: Element, resolve: FontResolver, scale = 1, fill = false): HtmlTextStyle {
  const style = styleOf(element);
  const weight = Number.parseInt(style.fontWeight, 10);
  const opacity = opacityBetween(element, block);
  let color = fill ? cssColorToHex(style.fill, opacity * (Number.parseFloat(style.fillOpacity) || 0)) : cssColorToHex(style.getPropertyValue("-webkit-text-fill-color") || style.color, opacity);
  let underline = false, strikethrough = false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const own = styleOf(node);
    const line = own.textDecorationLine || "";
    if (line.includes("underline")) underline = true;
    if (line.includes("line-through")) strikethrough = true;
    // Gradient text (background-clip: text): the gradient's middle colour stands in for a run.
    if (!fill && !color && backgroundClipsText(own)) {
      const gradient = splitTop(own.backgroundImage).map(image => parseCssGradient(image, 100, 100)).find(Boolean);
      if (gradient) color = gradient.stops[Math.floor(gradient.stops.length / 2)].color;
    }
    if (node === block) break;
  }
  const font = resolve(style.fontFamily);
  return {
    fontFamily: style.fontFamily,
    ...(font ? { font } : {}),
    fontSize: round(px(style.fontSize) * scale, 3),
    fontWeight: Number.isFinite(weight) ? weight : style.fontWeight === "bold" ? 700 : 400,
    italic: style.fontStyle === "italic" || style.fontStyle.startsWith("oblique"),
    underline, strikethrough,
    color: color ?? "#00000000",
    letterSpacing: round((style.letterSpacing === "normal" ? 0 : px(style.letterSpacing)) * scale, 3),
  };
}
const sameStyle = (a: HtmlTextStyle, b: HtmlTextStyle) => a.fontFamily === b.fontFamily && a.font === b.font && Math.abs(a.fontSize - b.fontSize) < 0.01 && a.fontWeight === b.fontWeight && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough && a.color === b.color && Math.abs(a.letterSpacing - b.letterSpacing) < 0.01;
const styleOnly = ({ text: _text, ...style }: HtmlTextRun): HtmlTextStyle => { void _text; return style; };

function transformText(text: string, transform: string, wordStart: boolean): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize" && wordStart) return text.charAt(0).toUpperCase() + text.slice(1);
  return text;
}

// ---------------------------------------------------------------------------
// Pseudo-elements

/** Turns ::before and ::after into real elements with the same computed style, so
 * their boxes and text can be measured. */
function materializePseudoElements(root: Element, sheet: HTMLStyleElement) {
  const found: { element: Element; which: "before" | "after"; text: string; style: Style }[] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (isReplaced(element)) continue;
    for (const which of ["before", "after"] as const) {
      const style = getComputedStyle(element, `::${which}`);
      const content = style.content;
      if (!content || content === "none" || content === "normal") continue;
      const strings = [...content.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map(match => (match[1] ?? match[2]).replace(/\\(.)/g, "$1"));
      found.push({ element, which, text: strings.join(""), style });
    }
  }
  for (const { element, which, text, style } of found) {
    const node = document.createElement(PSEUDO_TAG);
    for (let index = 0; index < style.length; index++) {
      const name = style.item(index);
      if (name !== "content") node.style.setProperty(name, style.getPropertyValue(name));
    }
    node.textContent = text;
    node.setAttribute("data-te-pseudo", which);
    element.setAttribute(`data-te-pseudo-${which}`, "");
    if (which === "before") element.prepend(node); else element.append(node);
  }
  if (found.length) sheet.textContent += `\n[${MEASURE_ATTRIBUTE}] [data-te-pseudo-before]::before, [${MEASURE_ATTRIBUTE}] [data-te-pseudo-after]::after { content: none !important; }`;
}

// ---------------------------------------------------------------------------
// Boxes

const relative = (rect: DOMRect | DOMRectReadOnly, origin: Point): HtmlBox => ({ x: rect.left - origin.x, y: rect.top - origin.y, width: rect.width, height: rect.height });
function push(context: Context, state: State, piece: HtmlPiece) {
  context.drafts.push({ piece, chain: state.chain, ...(state.clip ? { clip: state.clip } : {}) });
}

function radiusOf(style: Style, width: number, height: number): { radius: number; ellipse: boolean } {
  const corners = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(value => {
    const [horizontal = "0", vertical = horizontal] = (value || "0").split(/\s+/);
    const resolve = (part: string, size: number) => part.endsWith("%") ? Number.parseFloat(part) / 100 * size : px(part);
    return { x: resolve(horizontal, width), y: resolve(vertical, height) };
  });
  const ellipse = Math.abs(width - height) > 0.5 && corners.every(corner => corner.x >= width / 2 - 0.5 && corner.y >= height / 2 - 0.5);
  const radius = Math.min(width / 2, height / 2, corners.reduce((sum, corner) => sum + Math.min(corner.x, corner.y), 0) / 4);
  return { radius: Math.max(0, radius), ellipse };
}

type Shadow = { inset: boolean; color: string | null; x: number; y: number; blur: number; spread: number };
function shadowsOf(value: string): Shadow[] {
  if (!value || value === "none") return [];
  return splitTop(value).map(part => {
    const color = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+\([^)]*\))/i.exec(part)?.[1] ?? "";
    const rest = part.replace(color, " ");
    const numbers = [...rest.matchAll(/-?[\d.]+px|(?:^|\s)0(?=\s|$)/g)].map(match => px(match[0]));
    return { inset: /\binset\b/.test(rest), color: color ? cssColorToHex(color) : null, x: numbers[0] ?? 0, y: numbers[1] ?? 0, blur: numbers[2] ?? 0, spread: numbers[3] ?? 0 };
  });
}

const titleCase = (value: string) => value.replace(/[-_]+/g, " ").trim().replace(/^\w/, letter => letter.toUpperCase());
function nameOf(element: Element, scope: string, fallback: string): string {
  const own = [...element.classList].find(name => name.startsWith(`${scope}-`));
  return own ? titleCase(own.slice(scope.length + 1)).slice(0, 80) || fallback : fallback;
}

/** A box's background, gradients, border and shadow, bottom first. */
function boxPieces(box: HtmlBox, style: Style, state: State, context: Context, name: string) {
  const base = { rotation: 0, opacity: state.opacity, ...blendOf(style) };
  const { radius, ellipse } = radiusOf(style, box.width, box.height);
  const textClip = backgroundClipsText(style);
  const shadows = shadowsOf(style.boxShadow);
  const outer = shadows.find(shadow => !shadow.inset && shadow.color);
  const shadow: CanvasShadow | undefined = outer ? { color: outer.color!, offsetX: outer.x, offsetY: outer.y, blur: outer.blur, spread: outer.spread } : undefined;
  const fill = textClip ? null : cssColorToHex(style.backgroundColor);
  const gradients = textClip || style.backgroundImage === "none" ? [] : splitTop(style.backgroundImage).map(image => parseCssGradient(image, box.width, box.height)).filter((gradient): gradient is CanvasGradient => !!gradient).reverse();
  const widths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(px);
  const lineStyles = [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle];
  const colors = [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor].map(color => cssColorToHex(color));
  const sides = widths.map((width, index) => width > 0 && colors[index] && !/none|hidden/.test(lineStyles[index]) ? { width, color: colors[index]!, style: lineStyles[index] } : null);
  const uniform = !!sides[0] && sides.every(side => side && side.width === sides[0]!.width && side.color === sides[0]!.color && side.style === sides[0]!.style);
  const dash = (side: { width: number; style: string }) => side.style === "dashed" ? [side.width * 3, side.width * 2] : side.style === "dotted" ? [side.width, side.width] : undefined;
  let stroke: HtmlShapePiece["stroke"] = uniform ? { color: sides[0]!.color, width: sides[0]!.width, align: "inside", ...(dash(sides[0]!) ? { dash: dash(sides[0]!) } : {}) } : undefined;
  // A hard inset shadow is a ring inside the box: a stroke, or a second box inside the border.
  const ring = shadows.find(item => item.inset && item.color && !item.blur && !item.x && !item.y && item.spread > 0);
  let ringPiece: HtmlShapePiece | undefined;
  if (ring) {
    if (!sides.some(Boolean)) stroke = { color: ring.color!, width: ring.spread, align: "inside" };
    else {
      const inner = { x: box.x + widths[3], y: box.y + widths[0], width: box.width - widths[1] - widths[3], height: box.height - widths[0] - widths[2] };
      if (inner.width > EPSILON && inner.height > EPSILON) ringPiece = { kind: "shape", name, box: inner, ...base, ellipse, radius: Math.max(0, radius - widths[0]), stroke: { color: ring.color!, width: ring.spread, align: "inside" } };
    }
  }
  const shape = (extra: Partial<HtmlShapePiece>, label = name): HtmlShapePiece => ({ kind: "shape", name: label, box, ...base, ellipse, radius, ...extra });
  const pieces: HtmlShapePiece[] = [];
  if (fill) pieces.push(shape({ fill, ...(shadow ? { shadow } : {}), ...(!gradients.length && stroke ? { stroke } : {}) }));
  gradients.forEach((gradient, index) => pieces.push(shape({ fill: gradient.stops[0].color, gradient, ...(!fill && !index && shadow ? { shadow } : {}), ...(index === gradients.length - 1 && stroke ? { stroke } : {}) })));
  if (!fill && !gradients.length && stroke) pieces.push(shape({ stroke, ...(shadow ? { shadow } : {}) }));
  if (!uniform) {
    const [top, right, bottom, left] = sides;
    const add = (side: (typeof sides)[number], rect: HtmlBox) => { if (side && rect.width > EPSILON && rect.height > EPSILON) pieces.push({ kind: "shape", name: `${name} border`, box: rect, ...base, ellipse: false, radius: 0, fill: side.color }); };
    const innerTop = box.y + (top ? widths[0] : 0), innerHeight = box.height - (top ? widths[0] : 0) - (bottom ? widths[2] : 0);
    add(top, { x: box.x, y: box.y, width: box.width, height: widths[0] });
    add(bottom, { x: box.x, y: box.y + box.height - widths[2], width: box.width, height: widths[2] });
    add(left, { x: box.x, y: innerTop, width: widths[3], height: innerHeight });
    add(right, { x: box.x + box.width - widths[1], y: innerTop, width: widths[1], height: innerHeight });
  }
  if (ringPiece) pieces.push(ringPiece);
  for (const piece of pieces) push(context, state, piece);
}

function imagePiece(image: HTMLImageElement, box: HtmlBox, style: Style, state: State, context: Context) {
  const src = image.getAttribute("src")?.trim();
  if (!src || !image.naturalWidth || !image.naturalHeight) return;
  const { radius, ellipse } = radiusOf(style, box.width, box.height);
  const fit = style.objectFit === "contain" || style.objectFit === "scale-down" ? "contain" : "cover";
  const [horizontal = "50%", vertical = "50%"] = (style.objectPosition || "50% 50%").split(/\s+/);
  const scale = fit === "cover" ? Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight) : Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const position = (value: string, free: number) => value.endsWith("%") ? Number.parseFloat(value) : Math.abs(free) > EPSILON ? Math.max(0, Math.min(100, px(value) / free * 100)) : 50;
  const alt = image.getAttribute("alt")?.trim();
  push(context, state, {
    kind: "image", name: alt ? alt.slice(0, 80) : "Image", box, rotation: 0, opacity: state.opacity, ...blendOf(style),
    src, fit, positionX: round(position(horizontal, box.width - image.naturalWidth * scale), 2), positionY: round(position(vertical, box.height - image.naturalHeight * scale), 2),
    radius, ellipse, ...(alt ? { alt } : {}), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
  });
}

// ---------------------------------------------------------------------------
// Text

type RunNode = { node: Text; parent: Element };
/** A word's text box (its font's ascent above the baseline, descent below) and its font's line spacing. */
type Strut = { top: number; height: number; ascent: number; lineHeight: number; fontSize: number };
type Token = { text: string; rect?: DOMRect; style: HtmlTextStyle; strut?: Strut; space: boolean; hard?: boolean };
type Segment = { left: number; right: number; top: number; bottom: number; runs: HtmlTextRun[]; struts: Strut[] };
type Line = { top: number; bottom: number; lastRight: number; segments: Segment[] };

/** Text nodes in a block's own inline content: its text and its inline elements' text. */
function inlineTextNodes(block: Element): RunNode[] {
  const nodes: RunNode[] = [];
  const blockified = isFlexLike(styleOf(block));
  const walk = (parent: Element) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { if ((child as Text).data) nodes.push({ node: child as Text, parent }); continue; }
      if (!(child instanceof Element) || (blockified && parent === block) || isReplaced(child)) continue;
      const display = styleOf(child).display;
      if (display === "inline" || display === "contents") walk(child);
    }
  };
  walk(block);
  return nodes;
}

let range: Range | null = null;
function rects(node: Text, start: number, end: number): DOMRect[] {
  range ??= document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return [...range.getClientRects()].filter(rect => rect.width > 0.01);
}
const lineHeightOf = (style: Style) => style.lineHeight === "normal" || !style.lineHeight ? 0 : px(style.lineHeight);

const baselineMark = () => {
  const mark = document.createElement("span");
  mark.style.cssText = "display:inline-block;width:0;height:0;margin:0;padding:0;border:0;vertical-align:baseline;";
  return mark;
};
/** How far a font's text boxes (Range rects) reach above its baseline, as laid out
 * here: the font's ascent, which the browser rounds to whole px. */
function ascentOf(style: Style, context: Context): number {
  const key = [style.fontStyle, style.fontWeight, style.fontStretch, style.fontSize, style.fontFamily, style.fontVariationSettings, style.fontOpticalSizing].join("|");
  let ascent = context.ascents.get(key);
  if (ascent === undefined) {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;left:0;top:0;width:max-content;white-space:pre;line-height:normal;margin:0;padding:0;";
    Object.assign(probe.style, { fontStyle: style.fontStyle, fontWeight: style.fontWeight, fontStretch: style.fontStretch, fontSize: style.fontSize, fontFamily: style.fontFamily, fontVariationSettings: style.fontVariationSettings, fontOpticalSizing: style.fontOpticalSizing });
    const text = document.createTextNode("Hg"), mark = baselineMark();
    probe.append(text, mark);
    context.probes.append(probe);
    const box = rects(text, 0, text.data.length)[0];
    ascent = box ? mark.getBoundingClientRect().top - box.top : 0;
    probe.remove();
    context.ascents.set(key, ascent);
  }
  return ascent;
}

/** Where a text layer made from `piece` draws its first line's baseline, below
 * that line box's top, in design px: laid out in scene units with the numbers
 * html-break.ts gives it (textLayerSize), as canvas.tsx draws a text layer. */
function layerBaselineOf(piece: HtmlTextPiece, scale: number, fonts: Readonly<Record<string, string>> | undefined, host: HTMLElement): number | undefined {
  const line = piece.lines.find(item => item.runs.length);
  if (!line || !(scale > 0)) return undefined;
  const base = piece.style, size = textLayerSize(base.fontSize, piece.lineHeight, scale);
  const family = (style: HtmlTextStyle) => (style.font && fonts?.[style.font]) || style.fontFamily;
  const block = document.createElement("div");
  block.style.cssText = "position:absolute;left:0;top:0;width:max-content;white-space:pre;margin:0;padding:0;font-kerning:normal;";
  Object.assign(block.style, { fontFamily: family(base), fontSize: `${size.fontSize}px`, lineHeight: String(size.lineHeight), fontWeight: String(Math.round(clamp(base.fontWeight, 100, 900))), fontStyle: base.italic ? "italic" : "normal" });
  const row = document.createElement("div");
  for (const run of line.runs) {
    // As html-break.ts writes a rich-text span for a run that differs.
    const span = document.createElement("span");
    span.textContent = run.text;
    if (Math.abs(run.fontSize - base.fontSize) > 0.01) span.style.fontSize = `${textLayerSpanSize(run.fontSize, scale)}px`;
    if (run.fontWeight !== base.fontWeight) span.style.fontWeight = `${clamp(Math.round(run.fontWeight / 100), 1, 9)}00`;
    if (run.italic !== base.italic) span.style.fontStyle = run.italic ? "italic" : "normal";
    if (family(run) !== family(base)) span.style.fontFamily = family(run);
    row.append(span);
  }
  const mark = baselineMark();
  row.append(mark);
  block.append(row);
  host.append(block);
  const offset = mark.getBoundingClientRect().top - row.getBoundingClientRect().top;
  block.remove();
  return round(offset / scale, 4);
}

/** A word that the browser broke across lines, as one piece per line. */
function splitWord(node: Text, start: number, end: number): { text: string; rect: DOMRect }[] {
  const pieces: { text: string; rect: DOMRect }[] = [];
  let current: { text: string; rect: DOMRect } | null = null;
  for (let index = start; index < end;) {
    const size = (node.data.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    const character = node.data.slice(index, index + size);
    const found = rects(node, index, index + size)[0];
    index += size;
    if (!found) { if (current) current.text += character; continue; }
    if (current && Math.abs(found.top - current.rect.top) < Math.max(1, found.height * 0.5) && found.left >= current.rect.left - 0.5) {
      const top = Math.min(current.rect.top, found.top), bottom = Math.max(current.rect.bottom, found.bottom);
      current = { text: current.text + character, rect: new DOMRect(current.rect.left, top, Math.max(current.rect.right, found.right) - current.rect.left, bottom - top) };
    } else {
      if (current) pieces.push(current);
      current = { text: character, rect: found };
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function tokensOf(block: Element, context: Context): Token[] {
  const tokens: Token[] = [];
  let wordStart = true;
  for (const { node, parent } of inlineTextNodes(block)) {
    const parentStyle = styleOf(parent);
    if (parentStyle.visibility !== "visible") continue;
    const style = textStyleOf(parent, block, context.resolve);
    if (alphaOf(style.color) < 0.003) continue;
    const preserve = /^(pre|pre-wrap|break-spaces)$/.test(parentStyle.whiteSpace);
    const breaks = preserve || parentStyle.whiteSpace === "pre-line";
    const strutBase = { lineHeight: lineHeightOf(parentStyle), fontSize: style.fontSize, ascent: ascentOf(parentStyle, context) };
    const pattern = preserve ? /(\n)|([^\n]+)/g : /([ \t\n\r\f]+)|([^ \t\n\r\f]+)/g;
    for (const match of node.data.matchAll(pattern)) {
      const start = match.index ?? 0, end = start + match[0].length;
      if (match[1] !== undefined) {
        tokens.push({ text: " ", style, space: true, hard: breaks && match[1].includes("\n") });
        wordStart = true;
        continue;
      }
      const found = rects(node, start, end);
      if (!found.length) continue;
      const parts = found.length > 1 ? splitWord(node, start, end) : [{ text: match[0], rect: found[0] }];
      for (const part of parts) {
        tokens.push({ text: transformText(part.text, parentStyle.textTransform, wordStart), rect: part.rect, style, strut: { ...strutBase, top: part.rect.top, height: part.rect.height }, space: false });
        wordStart = false;
      }
    }
  }
  return tokens;
}

function isNewLine(rect: DOMRect, line: Line): boolean {
  const overlap = Math.min(rect.bottom, line.bottom) - Math.max(rect.top, line.top);
  if (overlap < Math.min(rect.height, line.bottom - line.top) * 0.5) return true;
  // Back at the left and lower down: a new line, even with tight line spacing.
  return rect.left < line.lastRight - 0.5 && rect.top > line.top + 0.5;
}

/** Words into lines as the browser placed them; a wide gap inside a line starts a new segment. */
function linesOf(tokens: Token[], collapse: boolean, justify: boolean): Line[] {
  const lines: Line[] = [];
  let line: Line | null = null, pending: Token | null = null, hard = false;
  for (const token of tokens) {
    if (token.space) { if (token.hard) hard = true; else pending = token; continue; }
    const rect = token.rect!;
    let segment: Segment;
    if (!line || hard || isNewLine(rect, line)) {
      segment = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, runs: [], struts: [] };
      line = { top: rect.top, bottom: rect.bottom, lastRight: rect.right, segments: [segment] };
      lines.push(line);
    } else {
      segment = line.segments[line.segments.length - 1];
      const gap = rect.left - line.lastRight;
      const allowed = (pending ? (justify ? Infinity : token.style.fontSize * 0.6) : token.style.fontSize * 0.2) + Math.max(0, token.style.letterSpacing) * 2 + 1.5;
      if (gap > allowed) {
        segment = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, runs: [], struts: [] };
        line.segments.push(segment);
      } else if (pending) {
        const last = segment.runs.at(-1);
        if (last && !(collapse && last.text.endsWith(" "))) last.text += " ";
      }
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
      line.lastRight = rect.right;
    }
    pending = null;
    hard = false;
    segment.left = Math.min(segment.left, rect.left); segment.right = Math.max(segment.right, rect.right);
    segment.top = Math.min(segment.top, rect.top); segment.bottom = Math.max(segment.bottom, rect.bottom);
    const last = segment.runs.at(-1);
    if (last && sameStyle(last, token.style)) last.text += token.text; else segment.runs.push({ ...token.style, text: token.text });
    if (token.strut) segment.struts.push(token.strut);
  }
  if (collapse) for (const each of lines) for (const segment of each.segments) {
    const last = segment.runs.at(-1);
    if (last) last.text = last.text.replace(/ +$/, "");
  }
  return lines;
}

function mostUsed(lines: Line[]): HtmlTextStyle | null {
  const counts: { style: HtmlTextStyle; count: number }[] = [];
  for (const line of lines) for (const segment of line.segments) for (const run of segment.runs) {
    const found = counts.find(item => sameStyle(item.style, run));
    if (found) found.count += run.text.length; else counts.push({ style: styleOnly(run), count: run.text.length });
  }
  counts.sort((a, b) => b.count - a.count);
  return counts[0]?.style ?? null;
}

function alignOf(value: string, direction: string): "left" | "center" | "right" {
  if (value === "center" || value === "-webkit-center") return "center";
  if (value === "right" || value === "-webkit-right") return "right";
  if (value === "end") return direction === "rtl" ? "left" : "right";
  if (value === "start") return direction === "rtl" ? "right" : "left";
  return "left";
}

/** A block's words as text pieces: lines that line up and are evenly spaced share one. */
function textPieces(block: Element, blockStyle: Style, state: State, context: Context) {
  const tokens = tokensOf(block, context);
  if (!tokens.some(token => !token.space && /\S/.test(token.text))) return;
  const collapse = !/^(pre|pre-wrap|break-spaces)$/.test(blockStyle.whiteSpace);
  const lines = linesOf(tokens, collapse, blockStyle.textAlign === "justify");
  const base = mostUsed(lines);
  if (!base) return;
  const { origin } = context;
  const align = alignOf(blockStyle.textAlign, blockStyle.direction);
  const declared = lineHeightOf(blockStyle);
  // Each segment's line-box top: a run in the base size, with half its leading above it.
  type Placed = { top: number; baseline?: number; contentTop: number; contentBottom: number; left: number; right: number; runs: HtmlTextRun[]; solo: boolean };
  const placed: Placed[][] = lines.map(line => line.segments.map(segment => {
    const strut = segment.struts.find(item => Math.abs(item.fontSize - base.fontSize) < 0.01) ?? segment.struts[0];
    const own = strut ? strut.lineHeight || strut.height : 0;
    const top = strut ? strut.top - (own - strut.height) / 2 : segment.top;
    return {
      top: top - origin.y, ...(strut ? { baseline: strut.top + strut.ascent - origin.y } : {}),
      contentTop: segment.top - origin.y, contentBottom: segment.bottom - origin.y, left: segment.left - origin.x, right: segment.right - origin.x, runs: segment.runs.filter(run => run.text), solo: line.segments.length === 1,
    };
  }));
  // line-height: normal is the distance between lines when there are several, else the glyphs' height.
  let lineHeight = declared;
  if (!lineHeight) {
    const tops = placed.filter(line => line.length === 1).map(line => line[0].top);
    const pitches = tops.slice(1).map((top, index) => top - tops[index]).filter(pitch => pitch > 0.5).sort((a, b) => a - b);
    const strut = lines[0].segments[0].struts[0];
    lineHeight = pitches.length ? pitches[Math.floor(pitches.length / 2)] : strut?.height ?? base.fontSize * 1.2;
  }
  const tolerance = 1.5 + base.fontSize * 0.04;
  const anchor = (line: Placed) => align === "left" ? line.left : align === "right" ? line.right : (line.left + line.right) / 2;
  const groups: { lines: (Placed | null)[]; first: Placed; last: Placed }[] = [];
  let group: (typeof groups)[number] | null = null;
  for (const segments of placed) for (const segment of segments) {
    if (!segment.runs.length) continue;
    if (!segment.solo) { group = null; groups.push({ lines: [segment], first: segment, last: segment }); continue; }
    if (group) {
      const pitch = segment.top - group.last.top, steps = Math.round(pitch / lineHeight);
      if (steps >= 1 && steps <= 4 && Math.abs(pitch - steps * lineHeight) <= 0.75 + lineHeight * 0.03 && Math.abs(anchor(segment) - anchor(group.first)) <= tolerance) {
        for (let empty = 1; empty < steps; empty++) group.lines.push(null);
        group.lines.push(segment);
        group.last = segment;
        continue;
      }
    }
    group = { lines: [segment], first: segment, last: segment };
    groups.push(group);
  }
  const blockBox = relative(block.getBoundingClientRect(), origin);
  const gradient = backgroundClipsText(blockStyle) ? splitTop(blockStyle.backgroundImage).map(image => parseCssGradient(image, blockBox.width, blockBox.height)).find(Boolean) ?? undefined : undefined;
  const textShadow = shadowsOf(blockStyle.textShadow).find(item => item.color);
  for (const { lines: members, first } of groups) {
    const real = members.filter((line): line is Placed => !!line);
    const left = Math.min(...real.map(line => line.left)), right = Math.max(...real.map(line => line.right));
    // Glyphs that reach past their line box (tight line spacing) need room, or the text box clips them.
    let overflow = 0;
    members.forEach((line, index) => {
      if (!line) return;
      const boxTop = first.top + index * lineHeight;
      overflow = Math.max(overflow, boxTop - line.contentTop, line.contentBottom - (boxTop + lineHeight));
    });
    const text = real.map(line => line.runs.map(run => run.text).join("")).join(" ").replace(/\s+/g, " ").trim();
    push(context, state, {
      kind: "text", name: text.slice(0, 80) || "Text", box: { x: left, y: first.top, width: Math.max(right - left, 0.5), height: members.length * lineHeight },
      rotation: 0, opacity: state.opacity, ...blendOf(blockStyle),
      align: first.solo ? align : "left", lineHeight, padding: round(Math.max(0, overflow) + base.fontSize * 0.1 + 1), style: base,
      lines: members.map((line, index) => line
        ? { box: { x: line.left, y: line.contentTop, width: line.right - line.left, height: line.contentBottom - line.contentTop }, runs: line.runs, ...(line.baseline === undefined ? {} : { baseline: line.baseline }) }
        : { box: { x: left, y: first.top + index * lineHeight, width: 0, height: lineHeight }, runs: [] }),
      ...(gradient ? { gradient } : {}),
      ...(textShadow ? { shadow: { color: textShadow.color!, offsetX: textShadow.x, offsetY: textShadow.y, blur: textShadow.blur, spread: 0 } } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// SVG

const SVG_PROPERTIES = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity", "visibility", "display", "clip-path", "clip-rule", "mask", "filter", "stop-color", "stop-opacity", "flood-color", "flood-opacity", "lighting-color", "color", "font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-variant-numeric", "font-feature-settings", "letter-spacing", "word-spacing", "text-anchor", "dominant-baseline", "alignment-baseline", "baseline-shift", "text-decoration-line", "white-space", "paint-order", "vector-effect", "marker-start", "marker-mid", "marker-end", "shape-rendering", "mix-blend-mode", "transform", "transform-origin", "transform-box", "image-rendering"];
const SVG_ROOT_SKIP = new Set(["transform", "transform-origin", "transform-box", "display", "visibility", "opacity", "mix-blend-mode", "filter", "clip-path", "mask"]);
const SVG_GEOMETRY = ["cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "d"];

/** SVG text that a text layer can draw: one line, one solid fill, no outline, not turned. */
function convertibleText(text: SVGTextElement): boolean {
  if (text.closest("defs, clipPath, mask, pattern, marker, symbol")) return false;
  if (text.querySelector("textPath, a, [x], [y], [dx], [dy], [rotate], [textLength]") || text.hasAttribute("textLength") || text.hasAttribute("rotate")) return false;
  for (const name of ["x", "y", "dx", "dy"]) { const value = text.getAttribute(name); if (value && value.trim().split(/[\s,]+/).length > 1) return false; }
  const style = styleOf(text);
  if (style.writingMode && !/^(horizontal-tb|lr|lr-tb|rl|rl-tb)$/.test(style.writingMode)) return false;
  if (style.direction === "rtl") return false;
  for (const element of [text, ...text.querySelectorAll("tspan")]) {
    const own = styleOf(element);
    if (!/^(rgb|#)/.test(own.fill) || (own.stroke !== "none" && px(own.strokeWidth) > 0)) return false;
    if (own.baselineShift && !/^(0px|0|baseline)$/.test(own.baselineShift)) return false;
    if (element !== text && own.alignmentBaseline && !/^(auto|baseline|alphabetic)$/.test(own.alignmentBaseline)) return false;
  }
  const matrix = text.getScreenCTM();
  if (!matrix || Math.abs(matrix.b) > 1e-4 || Math.abs(matrix.c) > 1e-4 || matrix.a <= 0 || Math.abs(matrix.a - matrix.d) > 1e-3 * matrix.a) return false;
  return text.getNumberOfChars() > 0;
}

/** The first glyph's alphabetic baseline, in the text's user units. getStartPositionOfChar
 * ignores dominant-baseline, so a shifted text is compared with itself unshifted. */
function svgBaseline(text: SVGTextElement): number {
  const start = text.getStartPositionOfChar(0).y;
  if (/^(auto|alphabetic)?$/.test(styleOf(text).dominantBaseline)) return start;
  const shifted = text.getExtentOfChar(0).y;
  const inline = text.style.getPropertyValue("dominant-baseline"), priority = text.style.getPropertyPriority("dominant-baseline");
  text.style.setProperty("dominant-baseline", "alphabetic", "important");
  const plain = text.getExtentOfChar(0).y;
  if (inline) text.style.setProperty("dominant-baseline", inline, priority); else text.style.removeProperty("dominant-baseline");
  return start + shifted - plain;
}

/** `paint` maps a page point to design px where the canvas paints it (see svgPieces). */
function svgTextPiece(text: SVGTextElement, state: State, context: Context, paint: (x: number, y: number) => Point): HtmlTextPiece | null {
  const style = styleOf(text);
  if (style.visibility !== "visible" || style.display === "none") return null;
  const opacity = state.opacity * opacityBetween(text, text.ownerSVGElement ?? text);
  if (opacity < 0.002) return null;
  const matrix = text.getScreenCTM()!;
  const scale = matrix.a;
  const runs: HtmlTextRun[] = [];
  const walk = (element: Element) => {
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const runStyle = textStyleOf(element, text, context.resolve, scale, true);
        const last = runs.at(-1);
        if (last && sameStyle(last, runStyle)) last.text += (child as Text).data; else runs.push({ ...runStyle, text: (child as Text).data });
      } else if (child instanceof SVGTSpanElement) walk(child);
    }
  };
  walk(text);
  // SVG text collapses white space as HTML does: one space between words, none at the ends.
  let afterSpace = true;
  for (const run of runs) {
    run.text = run.text.replace(/[ \t\n\r\f]+/g, " ");
    if (afterSpace) run.text = run.text.replace(/^ /, "");
    if (run.text) afterSpace = run.text.endsWith(" ");
  }
  const visible = runs.filter(run => run.text);
  if (visible.length) visible[visible.length - 1].text = visible[visible.length - 1].text.replace(/ $/, "");
  const kept = visible.filter(run => run.text);
  if (!kept.length || alphaOf(kept[0].color) < 0.003) return null;
  const extent = text.getExtentOfChar(0);
  const user = (x: number, y: number) => paint(matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f);
  const corner = user(extent.x, extent.y), baseline = user(extent.x, svgBaseline(text)).y;
  const height = user(extent.x, extent.y + extent.height).y - corner.y;
  const rect = text.getBoundingClientRect(), near = paint(rect.left, rect.top), far = paint(rect.right, rect.bottom);
  const bounds = { x: near.x, width: far.x - near.x };
  const anchor = style.textAnchor;
  const base = styleOnly(kept[0]);
  return {
    kind: "text", name: kept.map(run => run.text).join("").trim().slice(0, 80) || "Text", box: { x: bounds.x, y: corner.y, width: Math.max(bounds.width, 0.5), height },
    rotation: 0, opacity, align: anchor === "middle" ? "center" : anchor === "end" ? "right" : "left", lineHeight: height, padding: round(base.fontSize * 0.1 + 1), style: base,
    lines: [{ box: { x: bounds.x, y: corner.y, width: bounds.width, height }, runs: kept, baseline }],
  };
}

function svgPieces(svg: SVGSVGElement, box: HtmlBox, style: Style, state: State, context: Context) {
  const matrix = svg.getScreenCTM();
  if (!matrix || Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6 || matrix.a <= 0 || matrix.d <= 0) return;
  const { origin } = context;
  // Chromium paints an outer <svg> from its border box's corner snapped to whole
  // px, so its drawing can sit up to half a px from where getScreenCTM puts it.
  // `paint` maps a page point to design px where it is painted.
  const shiftX = state.chain.length ? 0 : Math.round(box.x) - box.x, shiftY = state.chain.length ? 0 : Math.round(box.y) - box.y;
  const snapped = { ...box, x: box.x + shiftX, y: box.y + shiftY };
  const paint = (x: number, y: number): Point => ({ x: x - origin.x + shiftX, y: y - origin.y + shiftY });
  const toPage = (x: number, y: number): Point => ({ x: x + origin.x - shiftX, y: y + origin.y - shiftY });
  // What it draws: its viewport, and with overflow: visible whatever reaches past it.
  let region: HtmlBox = snapped;
  if (style.overflowX === "visible" || style.overflowY === "visible") {
    try {
      const content = svg.getBBox();
      let stroke = 0;
      for (const child of svg.querySelectorAll("*")) { const own = styleOf(child); if (own.stroke && own.stroke !== "none") stroke = Math.max(stroke, px(own.strokeWidth)); }
      const margin = stroke / 2 + 2;
      if (content.width > 0 || content.height > 0) {
        const near = paint(matrix.a * (content.x - margin) + matrix.e, matrix.d * (content.y - margin) + matrix.f);
        const far = paint(matrix.a * (content.x + content.width + margin) + matrix.e, matrix.d * (content.y + content.height + margin) + matrix.f);
        const x = Math.min(region.x, near.x), y = Math.min(region.y, near.y);
        region = { x, y, width: Math.max(region.x + region.width, far.x) - x, height: Math.max(region.y + region.height, far.y) - y };
      }
    } catch { /* not drawn */ }
  }
  const limit = state.clip && !state.chain.length ? intersect(state.clip.box, context.layer) : context.layer;
  let area = limit ? intersect(region, limit) : null;
  if (!area) return;
  // Cut on whole scene units, so the image's pixels land on output pixels.
  const grid = context.grid && !state.chain.length ? context.grid : undefined;
  if (grid) {
    const x = Math.floor(area.x / grid.unit + 1e-6) * grid.unit, y = Math.floor(area.y / grid.unit + 1e-6) * grid.unit;
    area = { x, y, width: Math.ceil((area.x + area.width) / grid.unit - 1e-6) * grid.unit - x, height: Math.ceil((area.y + area.height) / grid.unit - 1e-6) * grid.unit - y };
  }
  const texts = [...svg.querySelectorAll("text")].filter((text): text is SVGTextElement => text instanceof SVGTextElement && convertibleText(text));
  const textPieces = texts.map(text => svgTextPiece(text, state, context, paint));
  const label = svg.getAttribute("aria-label")?.trim() || svg.querySelector("title")?.textContent?.trim() || undefined;
  let alt = label;
  if (!alt && state.label && !state.label.used) { alt = state.label.text; state.label.used = true; }
  const toUser = (x: number, y: number) => { const page = toPage(x, y); return { x: (page.x - matrix.e) / matrix.a, y: (page.y - matrix.f) / matrix.d }; };
  const start = toUser(area.x, area.y), end = toUser(area.x + area.width, area.y + area.height);
  const draft: Draft = {
    piece: {
      kind: "image", name: label ? label.slice(0, 80) : nameOf(svg, context.scope, "Graphic"), box: area, rotation: 0, opacity: state.opacity, ...blendOf(style),
      src: "", fit: "cover", positionX: 50, positionY: 50, radius: 0, ellipse: false, ...(alt ? { alt: alt.slice(0, 2000) } : {}), graphic: true,
    },
    chain: state.chain, ...(state.clip ? { clip: state.clip } : {}),
  };
  context.drafts.push(draft);
  context.rasters.push({ draft, svg, hidden: new Set(texts), user: { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y }, ...(grid ? { step: grid.step } : {}) });
  for (const piece of textPieces) if (piece) push(context, state, piece);
}

/** Draws an <svg> to a PNG, its computed styles inlined, trimmed to what it paints. */
async function rasterize(raster: Raster, outputScale: number, maxSide: number, signal?: AbortSignal): Promise<boolean> {
  const { svg, hidden, user, draft } = raster;
  const piece = draft.piece as HtmlImagePiece, box = piece.box;
  const scale = Math.min(outputScale, maxSide / Math.max(box.width, box.height));
  // Cut on whole scene units (svgPieces): trim in whole units too, so it stays on the grid.
  const step = raster.step && scale === outputScale ? raster.step : 0;
  const width = Math.max(1, Math.round(box.width * scale)), height = Math.max(1, Math.round(box.height * scale));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll("*")], copies = [clone, ...clone.querySelectorAll("*")];
  originals.forEach((original, index) => {
    const copy = copies[index];
    if (!copy) return;
    copy.removeAttribute("class");
    copy.removeAttribute("data-te-node");
    if (hidden.has(original)) { copy.setAttribute("style", "display:none"); return; }
    const style = styleOf(original);
    const declarations: string[] = [];
    for (const name of SVG_PROPERTIES) {
      if (original === svg && SVG_ROOT_SKIP.has(name)) continue;
      const value = style.getPropertyValue(name);
      if (value) declarations.push(`${name}:${value}`);
    }
    if (original !== svg) for (const name of SVG_GEOMETRY) {
      if (original.hasAttribute(name)) continue;
      const value = style.getPropertyValue(name);
      if (value && value !== "auto" && value !== "none" && (name !== "d" || value.startsWith("path("))) declarations.push(`${name}:${value}`);
    }
    copy.setAttribute("style", declarations.join(";"));
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${user.x} ${user.y} ${user.width} ${user.height}`);
  clone.setAttribute("preserveAspectRatio", "none");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.style.setProperty("overflow", "hidden");
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The graphic could not be drawn.")); });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  try { await withAbort(loaded, signal); } catch (error) { if (signal?.aborted) throw error; return false; }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(image, 0, 0, width, height);
  // Trim transparent edges, so the layer is only as big as what it draws.
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] <= 2) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return false;
  if (step) {
    minX = Math.floor(minX / step) * step; minY = Math.floor(minY / step) * step;
    maxX = Math.min(width, Math.ceil((maxX + 1) / step) * step) - 1; maxY = Math.min(height, Math.ceil((maxY + 1) / step) * step) - 1;
  } else {
    minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1); maxX = Math.min(width - 1, maxX + 1); maxY = Math.min(height - 1, maxY + 1);
  }
  let output = canvas;
  if (minX > 0 || minY > 0 || maxX < width - 1 || maxY < height - 1) {
    output = document.createElement("canvas");
    output.width = maxX - minX + 1; output.height = maxY - minY + 1;
    output.getContext("2d")!.drawImage(canvas, minX, minY, output.width, output.height, 0, 0, output.width, output.height);
    const sx = box.width / width, sy = box.height / height;
    piece.box = { x: box.x + minX * sx, y: box.y + minY * sy, width: output.width * sx, height: output.height * sy };
  }
  piece.src = output.toDataURL("image/png");
  piece.naturalWidth = output.width;
  piece.naturalHeight = output.height;
  return true;
}

// ---------------------------------------------------------------------------
// The tree

function visit(element: Element, state: State, context: Context) {
  if (element instanceof SVGElement && !(element instanceof SVGSVGElement && !element.ownerSVGElement)) return;
  const style = styleOf(element);
  if (style.display === "none") return;
  const opacity = state.opacity * (Number.parseFloat(style.opacity) || 0);
  if (opacity < 0.002) return;
  const label = element.getAttribute("role") === "img" ? element.getAttribute("aria-label")?.trim() : undefined;
  const own: State = { ...state, opacity, chain: context.chains?.get(element) ?? state.chain, ...(label ? { label: { text: label, used: false } } : {}) };
  const contents = style.display === "contents";
  const box = contents ? null : relative(element.getBoundingClientRect(), context.origin);
  const drawn = !!box && box.width > EPSILON && box.height > EPSILON && style.visibility === "visible" && !(state.clip && !state.clip.box.width);
  if (box && drawn && !(state.clip && !own.chain.length && !intersect(state.clip.box, box))) {
    const root = element.classList.contains("te-canvas-html-root");
    const name = element.hasAttribute("data-te-pseudo") ? nameOf(element.parentElement ?? element, context.scope, "Decoration") : nameOf(element, context.scope, element instanceof HTMLImageElement ? "Image" : root ? "Background" : "Box");
    boxPieces(box, style, own, context, name);
    if (element instanceof HTMLImageElement) imagePiece(element, box, style, own, context);
    if (element instanceof SVGSVGElement) svgPieces(element, box, style, own, context);
  }
  if (element instanceof HTMLImageElement || element instanceof SVGSVGElement) return;
  let inside = own;
  if (box && (style.overflowX !== "visible" || style.overflowY !== "visible")) {
    const inner = { x: box.x + px(style.borderLeftWidth), y: box.y + px(style.borderTopWidth), width: box.width - px(style.borderLeftWidth) - px(style.borderRightWidth), height: box.height - px(style.borderTopWidth) - px(style.borderBottomWidth) };
    const clipped = state.clip && state.clip.depth === own.chain.length ? intersect(state.clip.box, inner) : inner;
    inside = { ...own, clip: { box: clipped ?? { x: inner.x, y: inner.y, width: 0, height: 0 }, depth: own.chain.length } };
  }
  // Paint order among siblings: negative z-index, then the normal flow, then positioned boxes, then positive z-index.
  const children = [...element.children].map((child, index) => {
    const childStyle = styleOf(child);
    const z = childStyle.zIndex === "auto" ? Number.NaN : Number.parseInt(childStyle.zIndex, 10);
    const stacked = childStyle.position !== "static" || (isFlexLike(style) && Number.isFinite(z));
    const layer = !stacked ? 0 : !Number.isFinite(z) || z === 0 ? 1 : z < 0 ? -1 : 2;
    return { child, index, layer, z: Number.isFinite(z) ? z : 0 };
  }).sort((a, b) => a.layer - b.layer || (a.layer !== 0 && a.layer !== 1 ? a.z - b.z : 0) || a.index - b.index);
  for (const { child } of children) visit(child, inside, context);
  if (!contents && !isReplaced(element) && style.display !== "inline" && !(inside.clip && !inside.clip.box.width)) textPieces(element, style, inside, context);
}

async function settle(root: HTMLElement, signal?: AbortSignal) {
  void root.getBoundingClientRect();
  const loads = new Map<string, string>();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element instanceof SVGElement && !(element instanceof SVGTextContentElement)) continue;
    const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => (node as Text).data).join("").trim();
    if (!text) continue;
    const style = styleOf(element);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const known = loads.get(font) ?? "";
    if (known.length < 400) loads.set(font, known + text.slice(0, 200));
  }
  await withAbort(Promise.all([...loads].map(([font, text]) => document.fonts.load(font, text).catch(() => []))), signal);
  await withAbort(document.fonts.ready, signal);
  await withAbort(Promise.all([...root.querySelectorAll("img")].map(image => image.decode().catch(() => undefined))), signal);
}

/**
 * Mounts prepared, scoped markup (prepareHtmlLayer, then scopeHtmlLayer) at its
 * design size and returns its pieces in paint order. Rejects with an AbortError
 * when `signal` aborts. The markup is removed either way.
 */
export async function measureHtmlMarkup(input: HtmlMarkupInput, options: HtmlMeasureOptions = {}): Promise<HtmlPiece[]> {
  const { signal } = options;
  checkAbort(signal);
  const width = Math.max(1, input.designWidth), height = Math.max(1, input.designHeight);
  // Inside .gf-root when there is one, as smart-text.ts measures: its classes carry Engine's font variables.
  const host = document.querySelector(".gf-root") ?? document.body;
  const container = document.createElement("div");
  container.setAttribute(MEASURE_ATTRIBUTE, "");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText = `position:fixed;left:${-(width + 1000)}px;top:0;width:${width}px;height:${height}px;overflow:hidden;contain:layout paint style;isolation:isolate;pointer-events:none;z-index:-2147483647;margin:0;padding:0;border:0;transform:none;`;
  const sheet = document.createElement("style");
  sheet.textContent = input.css;
  const frame = document.createElement("div");
  frame.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;`;
  const root = document.createElement("div");
  root.className = `te-canvas-html-root ${input.scope}`;
  root.innerHTML = input.html;
  frame.append(root);
  container.append(sheet, frame);
  host.append(container);
  try {
    materializePseudoElements(root, sheet);
    await settle(root, signal);
    checkAbort(signal);
    const chains = untransform(root);
    const resolve = fontResolver(root, options.fonts);
    const rootRect = root.getBoundingClientRect();
    const outputScale = options.outputScale ?? 1, sceneScale = options.sceneScale && options.sceneScale > 0 ? options.sceneScale : undefined;
    const step = sceneScale ? outputScale / sceneScale : 0;
    const context: Context = {
      origin: { x: rootRect.left, y: rootRect.top }, layer: { x: 0, y: 0, width, height }, scope: input.scope, resolve, chains, drafts: [], rasters: [],
      probes: container, ascents: new Map(),
      ...(sceneScale && step >= 1 && Math.abs(step - Math.round(step)) < 1e-6 ? { grid: { unit: 1 / sceneScale, step: Math.round(step) } } : {}),
    };
    visit(root, { opacity: 1, chain: [] }, context);
    for (const raster of context.rasters) {
      checkAbort(signal);
      if (!await rasterize(raster, outputScale, options.maxRasterSide ?? 2400, signal)) context.drafts.splice(context.drafts.indexOf(raster.draft), 1);
    }
    const pieces = context.drafts.map(draft => finish(draft, context.layer)).filter((piece): piece is HtmlPiece => !!piece);
    if (sceneScale) for (const piece of pieces) {
      if (piece.kind !== "text") continue;
      const offset = layerBaselineOf(piece, sceneScale, options.fonts, container);
      if (offset !== undefined) piece.layerBaseline = offset;
    }
    return pieces;
  } finally {
    container.remove();
  }
}
