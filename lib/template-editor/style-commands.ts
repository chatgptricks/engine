import { IMAGE_BORDER_MAX_WIDTH, IMAGE_BORDER_STYLES, richTextToPlain, sanitizeRichText, type CanvasElement, type CanvasScene, type ImageBorder, type ImageElement, type ShapeElement, type TextElement } from "./model";
import { canEditElement, isElementHidden } from "./commands";

/** The selection toolbar's actions as named commands. The toolbar, keyboard
 * shortcuts and the agent API (engine_update_deck) all run these, so a person
 * and an agent get the same result from the same name. */
export const ELEMENT_COMMANDS = [
  { id: "text.case", label: "Change case", applies: ["text"], agent: "update_element {textCase: upper | lower | title | sentence}" },
  { id: "image.border", label: "Border", applies: ["image", "video"], agent: "update_element {border: {style, width, color} | null}" },
  { id: "image.corners", label: "Corner rounding", applies: ["image", "video"], agent: "update_element {radius}" },
  { id: "image.flip", label: "Flip", applies: ["image", "video"], agent: "update_element {flipX, flipY}" },
  { id: "image.crop.aspect", label: "Crop to a shape", applies: ["image", "video"], agent: "update_element {cropAspect: original | 1:1 | 4:5 | 3:4 | 16:9 | 9:16}" },
  { id: "layer.transparency", label: "Transparency", applies: ["text", "image", "video", "shape", "html"], agent: "update_element {opacity}" },
  { id: "video.trim", label: "Trim", applies: ["video"], agent: "update_element {start, end}" },
  { id: "video.volume", label: "Volume", applies: ["video"], agent: "update_element {volume, muted, fadeIn, fadeOut}" },
  { id: "video.speed", label: "Speed", applies: ["video"], agent: "update_element {speed}" },
  { id: "style.copy", label: "Copy style", applies: ["text", "image", "video", "shape", "html"], agent: "copy_style {pageId, from, to: [ids]}" },
] as const;
export type ElementCommandId = (typeof ELEMENT_COMMANDS)[number]["id"];

// ---------- Case ----------

export const TEXT_CASES = ["upper", "lower", "title", "sentence"] as const;
export type TextCase = (typeof TEXT_CASES)[number];

/** Words that stay lower case inside a title, unless they start it. */
const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "via", "with"]);

/** Changes the case of plain text in pieces, carrying where the last piece
 * stopped (inside a word, after a sentence's end), so styled runs of one
 * sentence change exactly as the whole sentence would. */
function caseChanger(mode: TextCase) {
  let inWord = false, sentenceStart = true, wordIndex = 0, word = "";
  return (value: string) => {
    if (mode === "upper") return value.toLocaleUpperCase();
    if (mode === "lower") return value.toLocaleLowerCase();
    let out = "";
    const chars = Array.from(value);
    for (let index = 0; index < chars.length; index++) {
      const char = chars[index];
      const letter = /[\p{L}\p{N}'’]/u.test(char);
      if (letter && !inWord) {
        // Read the whole word ahead (it may continue into the next piece; then the start is enough).
        let end = index;
        while (end < chars.length && /[\p{L}\p{N}'’]/u.test(chars[end])) end++;
        word = chars.slice(index, end).join("").toLocaleLowerCase();
        const isAcronym = chars.slice(index, end).join("").length > 1 && chars.slice(index, end).join("") === chars.slice(index, end).join("").toLocaleUpperCase() && /\p{Lu}/u.test(chars.slice(index, end).join(""));
        const capital = mode === "sentence" ? sentenceStart : sentenceStart || wordIndex === 0 || !MINOR_WORDS.has(word);
        if (isAcronym && mode === "title") { out += chars.slice(index, end).join(""); index = end - 1; inWord = true; sentenceStart = false; wordIndex++; continue; }
        out += capital ? char.toLocaleUpperCase() : char.toLocaleLowerCase();
        inWord = true; sentenceStart = false; wordIndex++;
        continue;
      }
      if (letter) { out += char.toLocaleLowerCase(); continue; }
      inWord = false;
      if (/[.!?]/.test(char)) sentenceStart = true;
      if (char === "\n") { sentenceStart = true; wordIndex = 0; }
      out += char;
    }
    return out;
  };
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** UPPER, lower, Title Case or Sentence case, keeping every styled run (accent words) in place. */
export function changeTextCaseMode(element: TextElement, mode: TextCase): TextElement {
  const safe = sanitizeRichText(element.richText);
  if (safe === undefined) return { ...element, text: caseChanger(mode)(element.text).slice(0, 20_000) };
  const change = caseChanger(mode);
  const richText = sanitizeRichText(safe.split(/(<[^>]*>)/g).map(token => token.startsWith("<") ? token : escapeHtml(change(richTextToPlain(token)))).join(""));
  return { ...element, richText, text: (richText === undefined ? element.text : richTextToPlain(richText)).slice(0, 20_000) };
}

/** Which case the text is in now, when it is clearly one of them. */
export function detectTextCase(texts: readonly TextElement[]): TextCase | undefined {
  const modes = texts.map(element => {
    if (!/\p{L}/u.test(element.text)) return undefined;
    for (const mode of TEXT_CASES) if (caseChanger(mode)(element.text) === element.text) return mode;
    return undefined;
  });
  return modes.length && modes.every(mode => mode === modes[0]) ? modes[0] : undefined;
}

// ---------- Photo and video frames ----------

/** The photo a layer shows: an image layer itself, or a shape's photo fill. */
type Framed = ImageElement | (ShapeElement & { imageFill: NonNullable<ShapeElement["imageFill"]> });

export function flipElement(element: CanvasElement, axis: "horizontal" | "vertical"): CanvasElement {
  const key = axis === "horizontal" ? "flipX" : "flipY";
  if (element.type === "image") return { ...element, [key]: !element[key] };
  if (element.type === "shape" && element.imageFill) return { ...element, imageFill: { ...element.imageFill, [key]: !element.imageFill[key] } };
  return element;
}

/** Sets or removes (null, or width 0) a photo's border. Width in scene units, capped. */
export function setImageBorder(element: CanvasElement, border: ImageBorder | null): CanvasElement {
  if (element.type !== "image") return element;
  if (!border || border.width <= 0) { const next = { ...element }; delete next.border; return next; }
  if (!IMAGE_BORDER_STYLES.includes(border.style)) throw new Error(`Border style must be one of ${IMAGE_BORDER_STYLES.join(", ")}.`);
  return { ...element, border: { style: border.style, width: Math.min(IMAGE_BORDER_MAX_WIDTH, border.width), color: border.color } };
}

/** The dash pattern for a border style, in multiples of its width (SVG stroke-dasharray). */
export function borderDashArray(border: ImageBorder): string | undefined {
  const w = border.width;
  return border.style === "long-dash" ? `${w * 4} ${w * 2}` : border.style === "short-dash" ? `${w * 1.5} ${w * 1.5}` : border.style === "dots" ? `0 ${w * 3}` : undefined;
}

export const CROP_ASPECTS = ["original", "1:1", "4:5", "3:4", "16:9", "9:16"] as const;
export type CropAspect = (typeof CROP_ASPECTS)[number];

/** Reshapes a photo's frame to an aspect ratio around its center, keeping about
 * the same area, and fills the new frame with the photo (fit cover). Original
 * uses the picture's own shape. */
export function cropToAspect(element: CanvasElement, aspect: CropAspect): CanvasElement {
  const framed = element.type === "image" || element.type === "shape" && element.imageFill ? element as Framed : undefined;
  if (!framed) return element;
  const photo = framed.type === "image" ? framed : framed.imageFill;
  const ratio = aspect === "original"
    ? (photo.video ? photo.video.width / photo.video.height : photo.intrinsicWidth && photo.intrinsicHeight ? photo.intrinsicWidth / photo.intrinsicHeight : undefined)
    : Number(aspect.split(":")[0]) / Number(aspect.split(":")[1]);
  if (!ratio || !Number.isFinite(ratio)) throw new Error("This photo's own size isn't known, so Original can't be used. Pick a ratio.");
  const area = element.width * element.height;
  const width = Math.sqrt(area * ratio), height = width / ratio;
  const geometry = { x: element.x + (element.width - width) / 2, y: element.y + (element.height - height) / 2, width, height };
  return framed.type === "image"
    ? { ...framed, ...geometry, fit: "cover", cropX: 50, cropY: 50, cropScale: 1 }
    : { ...framed, ...geometry, imageFill: { ...framed.imageFill, objectFit: "cover", cropX: 50, cropY: 50, cropScale: 1 } };
}

// ---------- Copy style ----------

const COMMON_KEYS = ["opacity", "shadow", "blur", "blendMode"] as const;
const TEXT_KEYS = ["font", "fontSize", "fontWeight", "italic", "underline", "strikethrough", "color", "gradient", "align", "lineHeight", "letterSpacing", "paragraphSpacing", "verticalAlign", "textureFill"] as const;
const IMAGE_KEYS = ["radius", "mask", "border"] as const;
const SHAPE_KEYS = ["fill", "gradient", "stroke", "strokeWidth", "strokeDash", "strokeAlign", "radius"] as const;

/** A layer's look, without its content, place or size. */
export type StyleSnapshot = { kind: "text" | "image" | "shape" | "html"; values: Record<string, unknown> };

const styleKeys = (kind: StyleSnapshot["kind"]): readonly string[] => [...COMMON_KEYS, ...(kind === "text" ? TEXT_KEYS : kind === "image" ? IMAGE_KEYS : kind === "shape" ? SHAPE_KEYS : [])];

export function copyStyle(element: CanvasElement): StyleSnapshot {
  const values: Record<string, unknown> = {};
  const source = element as unknown as Record<string, unknown>;
  for (const key of styleKeys(element.type)) values[key] = structuredClone(source[key]);
  return { kind: element.type, values };
}

/** Pastes a copied look. The same kind of layer takes all of it; another kind
 * takes what they share (transparency, shadow, blur, blend). A text's own
 * coloured words keep their colour. Keys the source didn't have are cleared. */
export function pasteStyle(element: CanvasElement, snapshot: StyleSnapshot): CanvasElement {
  const keys = snapshot.kind === element.type ? styleKeys(element.type) : COMMON_KEYS;
  const next = { ...element } as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = snapshot.values[key];
    if (value === undefined) delete next[key]; else next[key] = structuredClone(value);
  }
  // Required fields always keep a value.
  if (next.opacity === undefined) next.opacity = 1;
  return next as unknown as CanvasElement;
}

/** Pastes onto every listed layer the person may restyle; others (locked, template-fixed, hidden) are skipped. */
export function pasteStyleOnScene(scene: CanvasScene, ids: readonly string[], snapshot: StyleSnapshot): { scene: CanvasScene; changed: string[]; skipped: string[] } {
  const targets = new Set(ids), changed: string[] = [], skipped: string[] = [];
  const elements = scene.elements.map(element => {
    if (!targets.has(element.id)) return element;
    if (isElementHidden(scene, element) || !canEditElement(scene, element, "style")) { skipped.push(element.id); return element; }
    changed.push(element.id);
    return pasteStyle(element, snapshot);
  });
  return { scene: changed.length ? { ...scene, elements } : scene, changed, skipped };
}
