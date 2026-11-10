/**
 * "Break into layers": an HTML layer becomes ordinary text, image and shape
 * layers that look the same.
 *
 *   1. measureHtmlLayer draws the layer offscreen and reads its pieces
 *      (html-measure.ts; browser only).
 *   2. htmlPiecesToLayers turns the pieces into canvas elements (pure).
 *   3. breakHtmlLayer swaps them in for the HTML layer (pure, a scene command).
 *
 * Pieces are in the layer's design px. A layer is `designWidth` px wide and
 * scaled to its box, so a piece at design x lands at `x + px * width / designWidth`
 * in scene units, and font sizes, borders and radii scale the same way. A rotated
 * layer's pieces turn with it around the layer's centre.
 *
 * An upright layer is matched to how the canvas paints it (Chromium): its content
 * starts at the whole unit nearest the layer's corner, boxes snap to whole design
 * px, and text sits on the baseline it was drawn on. Text layers are laid out in
 * scene units, so their line spacing rounds differently from the HTML's; each
 * text layer is placed by its baseline (HtmlTextPiece.layerBaseline) instead.
 */
import { canEditElement, isElementLocked, MAX_SCENE_ELEMENTS, type SceneCommandResult } from "./commands";
import { HTML_FONT_STACKS, prepareHtmlLayer, scopeHtmlLayer } from "./html-layer";
import { measureHtmlMarkup, textLayerSize, textLayerSpanSize, type HtmlBox, type HtmlImagePiece, type HtmlPiece, type HtmlShapePiece, type HtmlTextPiece, type HtmlTextRun, type HtmlTextStyle } from "./html-measure";
import { parseCanvasScene, sanitizeRichText, type BlendMode, type CanvasElement, type CanvasElementBase, type CanvasGroup, type CanvasScene, type HtmlElement, type ImageElement, type ShapeElement, type TextElement } from "./model";

export type { HtmlPiece } from "./html-measure";
export type MeasureHtmlLayerOptions = {
  signal?: AbortSignal;
  /** Output px per scene unit, for drawing SVG (3 on a 1080 px wide slide). */
  pixelsPerUnit?: number;
};

let measured = 0;
/** Draws an HTML layer offscreen, as the canvas does, and reads its pieces. Browser only.
 * Pass the layer as laid out, after smart layout, when a flow may have moved it. */
export function measureHtmlLayer(element: HtmlElement, options: MeasureHtmlLayerOptions = {}): Promise<HtmlPiece[]> {
  const prepared = prepareHtmlLayer(element);
  const scope = `teh-${prepared.key}-break${++measured}`;
  const scale = element.width / element.designWidth;
  return measureHtmlMarkup(
    { html: scopeHtmlLayer(prepared.html, scope), css: scopeHtmlLayer(prepared.css, scope), scope, designWidth: element.designWidth, designHeight: element.height / scale },
    { signal: options.signal, fonts: HTML_FONT_STACKS, outputScale: (options.pixelsPerUnit ?? 3) * scale, sceneScale: scale },
  );
}

// ---------------------------------------------------------------------------
// Fonts

const FONT_IDS = Object.keys(HTML_FONT_STACKS);
const familyList = (family: string) => family.split(",").map(name => name.trim().replace(/^["']|["']$/g, "").toLowerCase()).filter(Boolean);
const STACKS = new Map(FONT_IDS.map(id => [familyList(HTML_FONT_STACKS[id]).join(","), id] as const).reverse());
const GENERIC: Record<string, string> = { serif: "serif", "ui-serif": "serif", "sans-serif": "sans", "system-ui": "sans", "ui-sans-serif": "sans", monospace: "plexmono", "ui-monospace": "plexmono", cursive: "caveat" };

/** The Engine font for a run: the id html-measure resolved, else the stack it came
 * from (HTML_FONT_STACKS, inverted), else the family's name, else Geist. */
export function engineFontId(style: Pick<HtmlTextStyle, "fontFamily" | "font">): string {
  if (style.font && style.font in HTML_FONT_STACKS) return style.font;
  const families = familyList(style.fontFamily);
  const stack = STACKS.get(families.join(","));
  if (stack) return stack;
  for (const family of families) {
    const variable = /^var\(--(?:gf-f-([a-z]+)|font-(sans|serif))\)/.exec(family);
    if (variable) {
      const id = variable[1] ?? variable[2];
      if (id in HTML_FONT_STACKS) return id;
    }
    if (GENERIC[family]) return GENERIC[family];
    const compact = family.replace(/^gf\s+/, "").replace(/[^a-z]/g, "");
    if (!compact) continue;
    if (compact.includes("bebas")) return compact.includes("canva") || compact.includes("bold") ? "bebascanva" : "bebas";
    if (compact.includes("walsheim")) return compact.includes("cond") ? "walsheimcond" : "walsheim";
    const named = FONT_IDS.filter(id => !["serif", "sans", "bebas", "bebascanva", "walsheim", "walsheimcond"].includes(id) && compact.includes(id)).sort((a, b) => b.length - a.length)[0];
    if (named) return named;
    if (compact.includes("baskerville")) return "libre";
    if (compact.includes("plex")) return "plexmono";
  }
  return "geist";
}

// ---------------------------------------------------------------------------
// Pieces to layers

const BLEND_MODES = new Set<string>(["multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number, places = 4) => { const factor = 10 ** places; return Math.round(value * factor) / factor; };
const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function wrapRotation(rotation: number): number {
  const turned = Math.abs(rotation) > 3600 ? rotation % 360 : rotation;
  return round(turned, 3);
}

type Placement = Pick<CanvasElementBase, "x" | "y" | "width" | "height" | "rotation">;

/**
 * Turns measured pieces into canvas elements, bottom first, for breakHtmlLayer.
 * Pure. Each layer is checked as parseCanvasScene would check it; a piece that
 * can't become a valid layer is left out.
 */
export function htmlPiecesToLayers(element: HtmlElement, pieces: readonly HtmlPiece[]): CanvasElement[] {
  const scale = element.width / element.designWidth;
  const centerX = element.x + element.width / 2, centerY = element.y + element.height / 2;
  const radians = element.rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const upright = Math.abs(element.rotation % 360) < 1e-6;
  // The canvas paints an upright HTML layer's content from the nearest whole unit
  // (Chromium drops the fraction at the layer's scale transform).
  const originX = upright ? Math.round(element.x) : element.x, originY = upright ? Math.round(element.y) : element.y;
  const snaps = (piece: HtmlPiece) => upright && !piece.rotation;
  /** A design-px box in the layer, as a scene box: scaled, then turned with the layer. */
  const place = (box: HtmlBox, rotation: number, minimum = 0): Placement => {
    const width = Math.max(box.width * scale, minimum), height = Math.max(box.height * scale, minimum);
    const dx = originX + (box.x + box.width / 2) * scale - centerX, dy = originY + (box.y + box.height / 2) * scale - centerY;
    const x = centerX + dx * cos - dy * sin, y = centerY + dx * sin + dy * cos;
    return { x: round(x - width / 2), y: round(y - height / 2), width: round(width), height: round(height), rotation: wrapRotation(element.rotation + rotation) };
  };
  const clipOf = (piece: HtmlPiece): CanvasElementBase["clipBounds"] | null | undefined => {
    // clipBounds is upright in scene units, so a turned layer keeps only its own clip.
    const own = piece.clip && upright ? { x: originX + piece.clip.x * scale, y: originY + piece.clip.y * scale, width: piece.clip.width * scale, height: piece.clip.height * scale } : undefined;
    const outer = element.clipBounds;
    if (!own) return outer ? { ...outer } : undefined;
    if (!outer) return { x: round(own.x), y: round(own.y), width: round(own.width), height: round(own.height) };
    const x = Math.max(own.x, outer.x), y = Math.max(own.y, outer.y), right = Math.min(own.x + own.width, outer.x + outer.width), bottom = Math.min(own.y + own.height, outer.y + outer.height);
    return right - x > 1e-4 && bottom - y > 1e-4 ? { x: round(x), y: round(y), width: round(right - x), height: round(bottom - y) } : null;
  };
  const layers: CanvasElement[] = [];
  for (const piece of pieces) {
    const clip = clipOf(piece);
    if (clip === null) continue;
    const common = {
      id: crypto.randomUUID(),
      name: piece.name.trim().slice(0, 200) || "Layer",
      opacity: round(clamp(piece.opacity * element.opacity, 0, 1)),
      locked: false,
      ...(piece.blendMode && BLEND_MODES.has(piece.blendMode) ? { blendMode: piece.blendMode as BlendMode } : {}),
      ...(element.blur ? { blur: element.blur } : {}),
      ...(clip ? { clipBounds: clip } : {}),
    };
    // Boxes snap to whole design px, as painted; a drawn SVG is already cut on whole units.
    const snap = snaps(piece) && !(piece.kind === "image" && piece.graphic);
    const made = piece.kind === "text" ? textLayers(piece, common, place, scale, snaps(piece)) : piece.kind === "image" ? [imageLayer(piece, common, place, scale, snap)] : [shapeLayer(piece, common, place, scale, snap)];
    for (const layer of made) if (parseCanvasScene({ background: "transparent", elements: [layer] })) layers.push(layer);
  }
  return layers;
}

type Common = Pick<CanvasElementBase, "id" | "name" | "opacity" | "locked" | "blendMode" | "blur" | "clipBounds">;
type Place = (box: HtmlBox, rotation: number, minimum?: number) => Placement;

/** A box with its edges on whole px, as Chromium paints boxes; as it was if that would empty it. */
function pixelSnap(box: HtmlBox): HtmlBox {
  const x = Math.round(box.x), y = Math.round(box.y), width = Math.round(box.x + box.width) - x, height = Math.round(box.y + box.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : box;
}

const shadowOf = (shadow: HtmlShapePiece["shadow"], scale: number) => shadow ? {
  color: shadow.color, offsetX: round(clamp(shadow.offsetX * scale, -1000, 1000)), offsetY: round(clamp(shadow.offsetY * scale, -1000, 1000)),
  blur: round(clamp(shadow.blur * scale, 0, 1000)), spread: round(clamp(shadow.spread * scale, -1000, 1000)),
} : undefined;

function shapeLayer(piece: HtmlShapePiece, common: Common, place: Place, scale: number, snap: boolean): ShapeElement {
  const source = snap ? pixelSnap(piece.box) : piece.box;
  const placed = place(source, piece.rotation);
  const thin = (placed.width < 1 || placed.height < 1) && !piece.ellipse;
  const stroke = piece.stroke && !thin ? {
    stroke: piece.stroke.color, strokeWidth: round(clamp(piece.stroke.width * scale, 0, 200)), strokeAlign: piece.stroke.align,
    ...(piece.stroke.dash?.length ? { strokeDash: piece.stroke.dash.slice(0, 20).map(value => round(clamp(value * scale, 0, 1000))) } : {}),
  } : { stroke: "transparent", strokeWidth: 0 };
  const shadow = shadowOf(piece.shadow, scale);
  const fill = { fill: piece.fill ?? "transparent", ...(piece.gradient ? { gradient: piece.gradient } : {}), ...(shadow ? { shadow } : {}) };
  if (thin) {
    // Layers are at least 1 unit across: a hairline is a path filling part of a 1-unit box.
    const box = place(source, piece.rotation, 1);
    const fx = clamp(placed.width / box.width, 0, 1) * 100, fy = clamp(placed.height / box.height, 0, 1) * 100;
    const x0 = round((100 - fx) / 2, 3), y0 = round((100 - fy) / 2, 3);
    return { ...common, ...box, type: "shape", shape: "path", path: `M${x0} ${y0}H${round(x0 + fx, 3)}V${round(y0 + fy, 3)}H${x0}Z`, viewBox: "0 0 100 100", radius: 0, ...fill, ...stroke };
  }
  const radius = piece.ellipse ? 0 : round(clamp(piece.radius * scale, 0, Math.min(5000, placed.width / 2, placed.height / 2)));
  return { ...common, ...placed, type: "shape", shape: piece.ellipse ? "ellipse" : "rectangle", radius, ...fill, ...stroke };
}

function imageLayer(piece: HtmlImagePiece, common: Common, place: Place, scale: number, snap: boolean): ImageElement {
  const placed = place(snap ? pixelSnap(piece.box) : piece.box, piece.rotation, 1);
  const size = (value: number | undefined) => value && Number.isFinite(value) ? Math.round(clamp(value, 1, 100_000)) : undefined;
  const intrinsicWidth = size(piece.naturalWidth), intrinsicHeight = size(piece.naturalHeight);
  return {
    ...common, ...placed, type: "image", src: piece.src, fit: piece.fit,
    cropX: round(clamp(piece.positionX, 0, 100), 2), cropY: round(clamp(piece.positionY, 0, 100), 2),
    radius: piece.ellipse ? 0 : round(clamp(piece.radius * scale, 0, Math.min(5000, placed.width / 2, placed.height / 2))),
    ...(piece.ellipse ? { mask: "ellipse" as const } : {}),
    ...(piece.alt ? { publicAlt: piece.alt.slice(0, 2000) } : {}),
    ...(intrinsicWidth && intrinsicHeight ? { intrinsicWidth, intrinsicHeight } : {}),
  };
}

/** Rich-text span for a run that differs from the layer's own style; plain when it doesn't. */
function richRun(run: HtmlTextRun, base: HtmlTextStyle, baseFont: string, scale: number): string {
  const text = escapeText(run.text);
  const declarations: string[] = [];
  if (Math.abs(run.fontSize - base.fontSize) > 0.01) declarations.push(`font-size: ${textLayerSpanSize(run.fontSize, scale)}px`);
  if (run.color !== base.color) declarations.push(`color: ${run.color}`);
  if (run.fontWeight !== base.fontWeight) declarations.push(`font-weight: ${clamp(Math.round(run.fontWeight / 100), 1, 9)}00`);
  if (run.italic !== base.italic) declarations.push(`font-style: ${run.italic ? "italic" : "normal"}`);
  if (run.underline !== base.underline || run.strikethrough !== base.strikethrough) declarations.push(`text-decoration-line: ${[run.underline ? "underline" : "", run.strikethrough ? "line-through" : ""].filter(Boolean).join(" ") || "none"}`);
  const font = engineFontId(run);
  const attributes = `${font !== baseFont ? ` class="gf-font-${font}"` : ""}${declarations.length ? ` style="${declarations.join("; ")}"` : ""}`;
  return attributes ? `<span${attributes}>${text}</span>` : text;
}

function textLayers(piece: HtmlTextPiece, common: Common, place: Place, scale: number, snap: boolean): TextElement[] {
  const base = piece.style, font = engineFontId(base);
  const multiplier = piece.lineHeight / base.fontSize;
  const fits = multiplier >= 0.5 && multiplier <= 5;
  const size = textLayerSize(base.fontSize, piece.lineHeight, scale);
  const groups: { lines: HtmlTextPiece["lines"]; top: number; lineHeight: number }[] = fits
    ? [{ lines: piece.lines, top: piece.box.y, lineHeight: piece.lineHeight }]
    // Line spacing a text layer can't take: one layer per line, each centred where its line was.
    : piece.lines.flatMap((line, index) => {
      if (!line.runs.length) return [];
      const lineHeight = clamp(multiplier, 0.5, 5) * base.fontSize;
      return [{ lines: [line], top: piece.box.y + index * piece.lineHeight + (piece.lineHeight - lineHeight) / 2, lineHeight }];
    });
  const layers: TextElement[] = [];
  for (const [index, group] of groups.entries()) {
    const lines = group.lines;
    const width = fits ? piece.box.width : Math.max(...lines.map(line => line.box.width), 0.5);
    const left = fits ? piece.box.x : piece.align === "left" ? piece.box.x : piece.align === "right" ? piece.box.x + piece.box.width - width : piece.box.x + (piece.box.width - width) / 2;
    // On the baseline it was drawn on (whole design px when upright), where the layer knows to put it.
    const anchor = lines.findIndex(line => line.baseline !== undefined);
    const baseline = anchor >= 0 ? lines[anchor].baseline! : undefined;
    const top = baseline !== undefined && piece.layerBaseline !== undefined
      ? (snap ? Math.round(baseline) : baseline) - anchor * group.lineHeight - piece.layerBaseline
      : group.top;
    // Room for the glyphs, and a little more width so no line wraps again.
    const padding = piece.padding, slack = width * 0.03 + base.fontSize * 0.25 + 1;
    const shift = piece.align === "left" ? 0 : piece.align === "right" ? slack : slack / 2;
    const box = { x: left - padding - shift, y: top - padding, width: width + padding * 2 + slack, height: lines.length * group.lineHeight + padding * 2 };
    const text = lines.map(line => line.runs.map(run => run.text).join("")).join("\n").slice(0, 20_000);
    const rich = lines.some(line => line.runs.some(run => richRun(run, base, font, scale) !== escapeText(run.text)))
      ? sanitizeRichText(lines.map(line => line.runs.map(run => richRun(run, base, font, scale)).join("")).join("<br>"))
      : undefined;
    const shadow = shadowOf(piece.shadow, scale);
    layers.push({
      ...common, ...(index ? { id: crypto.randomUUID() } : {}), ...place(box, piece.rotation, 1),
      type: "text", text, font,
      fontSize: size.fontSize, fontWeight: Math.round(clamp(base.fontWeight, 100, 900)),
      italic: base.italic, underline: base.underline, ...(base.strikethrough ? { strikethrough: true } : {}),
      color: base.color, align: piece.align,
      lineHeight: size.lineHeight, letterSpacing: round(clamp(base.letterSpacing * scale, -20, 100)),
      textMode: "auto-height", verticalAlign: "top", padding: round(clamp(padding * scale, 0, 1000)),
      ...(rich && rich.length <= 20_000 ? { richText: rich } : {}),
      ...(piece.gradient ? { gradient: piece.gradient } : {}),
      ...(shadow ? { shadow } : {}),
    });
  }
  return layers;
}

// ---------------------------------------------------------------------------
// The command

function followers(scene: CanvasScene, element: CanvasElement): CanvasElement[] {
  const keys = new Set([element.id, ...(element.slot ? [element.slot] : [])]);
  return scene.elements.filter(other => other.id !== element.id && other.smartFlow && (keys.has(other.smartFlow.after) || (other.smartFlow.hug && keys.has(other.smartFlow.hug.after))));
}

/**
 * Replaces an HTML layer with `layers` (from htmlPiecesToLayers) at the same place
 * in the stack, in one new group named after it, and selects them. Pure.
 *
 * When the layer holds a place in a template's flow (smartFlow, smartCenter, a
 * slot, or layers that follow it), a transparent "Layout space" box takes that
 * place first in the group, so the title and body above don't move into the gap.
 * It leads the group (`leadsGroup`): when the copy above grows and smart layout
 * moves the space, the broken-out layers move with it, as the HTML layer did.
 *
 * Throws a plain-English Error when the layer is missing, locked, in a locked
 * group or protected, or when the slide would pass its layer or group limit.
 */
export function breakHtmlLayer(scene: CanvasScene, elementId: string, layers: readonly CanvasElement[]): SceneCommandResult {
  const index = scene.elements.findIndex(element => element.id === elementId);
  const element = scene.elements[index];
  if (!element) throw new Error("That layer isn't on this slide any more.");
  if (element.type !== "html") throw new Error("Only an HTML layer can be broken into layers.");
  if (element.locked) throw new Error("This layer is locked. Unlock it to break it into layers.");
  if (isElementLocked(scene, element)) throw new Error("This layer is in a locked group. Unlock the group to break it into layers.");
  if (!canEditElement(scene, element, "delete") || !canEditElement(scene, element, "content")) throw new Error("This layer is protected, so it can't be broken into layers.");
  if (!layers.length) throw new Error("There's nothing in this layer to turn into layers.");
  const flowing = !!(element.smartFlow || element.smartCenter || element.slot || followers(scene, element).length);
  const total = scene.elements.length - 1 + layers.length + (flowing ? 1 : 0);
  if (total > MAX_SCENE_ELEMENTS) throw new Error(`Breaking this layer would make ${total} layers on the slide, and a slide holds at most ${MAX_SCENE_ELEMENTS}. Simplify the HTML, or move some layers to another slide first.`);
  if ((scene.groups?.length ?? 0) >= 100) throw new Error("This slide already has 100 groups. Ungroup some layers first.");
  const group: CanvasGroup = {
    id: crypto.randomUUID(), name: element.name.trim().slice(0, 200) || "HTML layer",
    ...(element.groupId && scene.groups?.some(parent => parent.id === element.groupId) ? { parentId: element.groupId } : {}),
    ...(element.hidden ? { hidden: true } : {}),
  };
  const taken = new Set(scene.elements.filter(other => other.id !== element.id).map(other => other.id));
  const pieces = layers.map(layer => {
    const id = taken.has(layer.id) ? crypto.randomUUID() : layer.id;
    taken.add(id);
    return { ...layer, id, groupId: group.id } as CanvasElement;
  });
  let elements = scene.elements;
  const added: CanvasElement[] = [];
  if (flowing) {
    // It leads the group: when smart layout moves it, the broken-out layers move with it.
    const space: ShapeElement = {
      id: crypto.randomUUID(), name: "Layout space", type: "shape", shape: "rectangle",
      x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation, opacity: 1, locked: false,
      fill: "transparent", stroke: "transparent", strokeWidth: 0, radius: 0, groupId: group.id, leadsGroup: true,
      ...(element.smartFlow ? { smartFlow: structuredClone(element.smartFlow) } : {}),
      ...(element.smartCenter ? { smartCenter: { ...element.smartCenter } } : {}),
      ...(element.layoutRole ? { layoutRole: element.layoutRole } : {}),
      ...(element.slot ? { slot: element.slot } : {}),
      ...(element.anchors ? { anchors: { ...element.anchors } } : {}),
    };
    added.push(space);
    // Layers that followed the HTML layer by its id follow the space now (by slot, they still do).
    elements = elements.map(other => {
      const flow = other.smartFlow;
      if (!flow || other.id === element.id || (flow.after !== element.id && flow.hug?.after !== element.id)) return other;
      return { ...other, smartFlow: { ...flow, ...(flow.after === element.id ? { after: space.id } : {}), ...(flow.hug && flow.hug.after === element.id ? { hug: { ...flow.hug, after: space.id } } : {}) } };
    });
  }
  added.push(...pieces);
  const next: CanvasScene = { ...scene, groups: [...(scene.groups ?? []), group], elements: [...elements.slice(0, index), ...added, ...elements.slice(index + 1)] };
  return { scene: next, selectedIds: pieces.map(piece => piece.id), limited: false };
}

/** The most ids a page's reading order holds (parseDesignDocument's limit). */
const MAX_READING_ORDER = 200;

/**
 * A page's own reading order (`page.readingOrder`) after its HTML layer was broken:
 * the new words and pictures (text and image layers, in the order they were made)
 * are read where the HTML layer was. Pure. The same list when the page has none or
 * doesn't list the layer. If the list would pass 200 ids, the layer just leaves it,
 * and its pieces are read after the listed layers, top to bottom.
 */
export function readingOrderAfterBreak(order: string[] | undefined, elementId: string, pieces: readonly CanvasElement[]): string[] | undefined {
  if (!order?.includes(elementId)) return order;
  const readable = pieces.filter(piece => (piece.type === "text" || piece.type === "image") && !order.includes(piece.id)).map(piece => piece.id);
  const next = order.flatMap(id => id === elementId ? readable : [id]);
  return next.length <= MAX_READING_ORDER ? next : order.filter(id => id !== elementId);
}
