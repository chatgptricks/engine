/** Agent authoring uses output pixels; Engine stores editable layers on a 360-wide scene. */
import {
  BUILT_IN_TEMPLATES, EMPTY_LIBRARY, createBlankDesign, createCanvasElement,
  createDesign, duplicatePage, formatDimensions, parseCanvasScene, parseLibrary, prepareSmartTemplate, sceneForPage,
  type CanvasElement, type CanvasScene, type DesignDocument, type DesignPage,
  type DesignTemplate, type EditorLibrary, type SmartTextRole,
} from "./model";
import { findSpan, hasSpans, isSpanHalf, reconcileSpans, seamOf, setSeam, spanPairs, spanPhoto, syncSpans, unlinkSpan } from "./spanning-photos";

type RecordValue = Record<string, unknown>;
type Schema = Record<string, unknown>;
export type AgentDeckIssue = { path: string; message: string };
export class AgentDeckValidationError extends Error {
  readonly issues: AgentDeckIssue[];
  constructor(issues: AgentDeckIssue[] | string, path = "$") {
    const normalized = typeof issues === "string" ? [{ path, message: issues }] : issues;
    super(normalized.map(issue => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "AgentDeckValidationError";
    this.issues = normalized;
  }
}
const FONTS = ["serif", "sans", "walsheim", "walsheimcond", "kyoto", "century", "libre", "geist", "sfpro", "playfair", "dmserif", "lora", "cormorant", "crimson", "inter", "space", "montserrat", "bebas", "bebascanva", "plexmono", "caveat"];
const LAYOUTS = ["title", "content", "split", "quote", "blank"];
const PRESETS = {
  presentation: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1440 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};
const LIMITS = { slides: 20, elementsPerSlide: 100, operations: 200, textCharacters: 20_000, imageCharacters: 2_000_000, requestCharacters: 4_000_000, minSize: 100, maxSize: 8192 };
const str = (maxLength: number, extra: Schema = {}): Schema => ({ type: "string", maxLength, ...extra });
const num = (minimum: number, maximum: number): Schema => ({ type: "number", minimum, maximum });
const choice = (values: string[]): Schema => ({ type: "string", enum: values });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: "object", properties, required, additionalProperties: false, ...extra });
const id = str(120, { minLength: 1, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]*$" });
const color = str(20, { pattern: "^(?:#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})|black|white|transparent)$" });
const bool: Schema = { type: "boolean" };
const baseProperties = {
  id, name: str(200), x: num(-100_000, 100_000), y: num(-100_000, 100_000),
  width: num(1, 100_000), height: num(1, 100_000), rotation: num(-3600, 3600),
  opacity: num(0, 1), hidden: bool, locked: bool, slot: str(200),
  protected: { type: "array", maxItems: 4, uniqueItems: true, items: choice(["content", "position", "style", "delete"]) },
};
const textProperties = {
  text: str(20_000), font: choice(FONTS), fontSize: num(1, 10_000), fontWeight: num(100, 900),
  italic: bool, underline: bool, strikethrough: bool, color, align: choice(["left", "center", "right"]),
  verticalAlign: choice(["top", "middle", "bottom"]), lineHeight: num(.5, 5),
  letterSpacing: num(-1000, 1000), padding: num(0, 10_000), paragraphSpacing: num(0, 10_000),
  textMode: choice(["fixed", "auto-height", "auto-fit"]), listStyle: choice(["none", "bullet", "number"]),
};
const imageProperties = {
  src: str(LIMITS.imageCharacters, { minLength: 1 }), publicAlt: str(2000), fit: choice(["cover", "contain"]),
  cropX: num(0, 100), cropY: num(0, 100), cropScale: num(.1, 20), radius: num(0, 100_000),
  flipX: bool, flipY: bool, mask: choice(["none", "ellipse", "triangle", "diamond"]),
  // The photo's own size in pixels: a spanning photo's frame takes its proportions.
  intrinsicWidth: num(1, 100_000), intrinsicHeight: num(1, 100_000),
};
const seamSchema = (description: string): Schema => ({ ...num(.1, .9), description });
const shapeProperties = {
  shape: choice(["rectangle", "ellipse", "triangle", "diamond", "polygon", "star", "arrow"]),
  fill: color, stroke: color, strokeWidth: num(0, 10_000), radius: num(0, 100_000),
  sides: { type: "integer", minimum: 3, maximum: 30 }, starPoints: { type: "integer", minimum: 3, maximum: 30 },
  innerRadius: num(.05, .95), strokeAlign: choice(["inside", "center", "outside"]),
};
const elementSchema: Schema = { oneOf: [
  obj({ ...baseProperties, type: { const: "text" }, ...textProperties }, ["type", "text", "x", "y", "width", "height"]),
  obj({ ...baseProperties, type: { const: "image" }, ...imageProperties,
    span: { const: "next", description: "Continue this photo on the next slide: Engine places the whole photo across the seam in its own proportions (intrinsicWidth/intrinsicHeight, or the frame's), keeping its height, on the next slide when that slide shows no photo of its own and otherwise on a new slide after this one" },
    seam: seamSchema("With span: the share of the photo on this slide, from 0.1 to 0.9 (default 0.5). Choose it so the cut misses faces and text"),
  }, ["type", "src", "x", "y", "width", "height"]),
  obj({ ...baseProperties, type: { const: "shape" }, ...shapeProperties }, ["type", "x", "y", "width", "height"]),
] };
const slideImageSchema = obj({ src: imageProperties.src, alt: str(2000), fit: imageProperties.fit }, ["src"]);
const slideSchema = obj({
  id, label: str(200), layout: choice(LAYOUTS), background: color, title: str(20_000), body: str(20_000),
  bullets: { type: "array", maxItems: 40, items: str(2000) }, image: slideImageSchema,
  elements: { type: "array", maxItems: 100, items: elementSchema },
  // Text slots allow 20,000 characters (checked per slot); photo slots take an image URL as long as `image.src`.
  slots: { type: "object", maxProperties: 100, additionalProperties: str(LIMITS.imageCharacters) },
  templatePage: { type: "integer", minimum: 0, maximum: LIMITS.slides - 1, description: "With templateId: 0-based index of the template page this slide copies. Set it on every slide or none; pages may repeat, reorder or be left out." },
  seam: seamSchema("With templateId, on a page whose photo continues on the next page (pageTypes marks it with pair, such as the @chatgptricks Wide photo pair): the share of the photo on this slide, from 0.1 to 0.9 (default 0.5). Choose it so the cut misses faces and text"),
  photoSize: obj({ width: num(1, 100_000), height: num(1, 100_000) }, ["width", "height"], { description: "With templateId, on that same page: the photo's size in pixels, so the frame takes its proportions instead of the placeholder's 16:9" }),
});
const themeSchema = obj({
  background: color, text: color, accent: color, font: choice(FONTS),
  titleSize: num(8, 1000), bodySize: num(8, 1000), margin: num(0, 1000),
});
/** JSON Schema is also the executable boundary: unknown fields are errors, never silently dropped. */
export const AGENT_DECK_SPEC_SCHEMA: Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema", title: "Engine editable deck",
  ...obj({
    id, name: str(200, { minLength: 1 }), format: choice([...Object.keys(PRESETS), "custom"]),
    size: obj({ width: num(100, 8192), height: num(100, 8192) }, ["width", "height"]),
    theme: themeSchema, caption: str(20_000), templateId: id,
    slides: { type: "array", minItems: 1, maxItems: 20, items: slideSchema },
  }, ["name"]),
};
const editableProperties = { ...baseProperties, ...textProperties, ...imageProperties, ...shapeProperties };
// Protection flags and identity cannot be changed through a property patch.
const patchProperties = Object.fromEntries(Object.entries(editableProperties).filter(([key]) => !["id", "locked", "protected"].includes(key)));
const operation = (op: string, properties: Record<string, Schema>, required: string[]) => obj({ op: { const: op }, ...properties }, ["op", ...required]);
export const AGENT_UPDATE_SCHEMA: Schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema", title: "Engine atomic deck edits",
  ...obj({ operations: { type: "array", minItems: 1, maxItems: 200, items: { oneOf: [
    operation("update_element", { pageId: id, elementId: id, properties: obj(patchProperties, [], { minProperties: 1 }) }, ["pageId", "elementId", "properties"]),
    operation("add_element", { pageId: id, element: elementSchema }, ["pageId", "element"]),
    operation("remove_element", { pageId: id, elementId: id }, ["pageId", "elementId"]),
    operation("add_slide", { slide: slideSchema, index: { type: "integer", minimum: 0, maximum: 20 } }, ["slide"]),
    operation("remove_slide", { pageId: id }, ["pageId"]),
    operation("move_slide", { pageId: id, index: { type: "integer", minimum: 0, maximum: 19 } }, ["pageId", "index"]),
    operation("update_slide", { pageId: id, background: color, label: str(200) }, ["pageId"]),
    operation("span_photo", { pageId: id, elementId: id, seam: seamSchema("The share of the photo on this slide, from 0.1 to 0.9. Default: 0.5, or the photo's current seam when it already spans") }, ["pageId", "elementId"]),
    operation("unlink_span", { pageId: id, elementId: id }, ["pageId", "elementId"]),
    operation("rename", { name: str(200, { minLength: 1 }) }, ["name"]),
    operation("caption", { caption: str(20_000) }, ["caption"]),
  ] } } }, ["operations"]),
};
const record = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
function fail(path: string, message: string): never { throw new AgentDeckValidationError(message, path); }
/** A deliberately small validator for the keywords used by our published JSON Schemas. */
function validate(schema: Schema, value: unknown, path: string): AgentDeckIssue[] {
  const issue = (message: string) => [{ path, message }];
  if (Array.isArray(schema.oneOf)) {
    const variants = schema.oneOf as Schema[];
    const matching = variants.find(variant => record(value) && record(variant.properties) && record(variant.properties.type) && variant.properties.type.const === value.type)
      ?? variants.find(variant => record(value) && record(variant.properties) && record(variant.properties.op) && variant.properties.op.const === value.op);
    if (matching) return validate(matching, value, path);
    return issue("must specify a supported type or operation");
  }
  if (schema.const !== undefined && value !== schema.const) return issue(`must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return issue(`must be one of ${schema.enum.join(", ")}`);
  if (schema.type === "object") {
    if (!record(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return issue("must be a JSON object");
    const keys = Object.keys(value), properties = (schema.properties ?? {}) as Record<string, Schema>;
    const issues: AgentDeckIssue[] = [];
    for (const key of (schema.required ?? []) as string[]) if (!Object.hasOwn(value, key)) issues.push({ path: `${path}.${key}`, message: "is required" });
    if (schema.minProperties !== undefined && keys.length < Number(schema.minProperties)) issues.push(...issue("must include at least one property"));
    if (schema.maxProperties !== undefined && keys.length > Number(schema.maxProperties)) issues.push(...issue(`allows at most ${schema.maxProperties} properties`));
    for (const key of keys) {
      if (["__proto__", "constructor", "prototype"].includes(key)) issues.push({ path: `${path}.${key}`, message: "is not supported" });
      else if (Object.hasOwn(properties, key)) issues.push(...validate(properties[key], value[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) issues.push({ path: `${path}.${key}`, message: "is not supported" });
      else if (record(schema.additionalProperties)) issues.push(...validate(schema.additionalProperties, value[key], `${path}.${key}`));
    }
    return issues;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return issue("must be an array");
    if (schema.minItems !== undefined && value.length < Number(schema.minItems)) return issue(`requires at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > Number(schema.maxItems)) return issue(`allows at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value).size !== value.length) return issue("must not contain duplicate values");
    return value.flatMap((item, index) => validate(schema.items as Schema, item, `${path}[${index}]`));
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return issue("must be a string");
    if (schema.minLength !== undefined && value.length < Number(schema.minLength)) return issue("must not be empty");
    if (schema.maxLength !== undefined && value.length > Number(schema.maxLength)) return issue(`allows at most ${schema.maxLength} characters`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "i").test(value)) return issue("has an unsupported format");
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || schema.type === "integer" && !Number.isInteger(value)) return issue(`must be a finite ${schema.type}`);
    if (schema.minimum !== undefined && value < Number(schema.minimum) || schema.maximum !== undefined && value > Number(schema.maximum)) return issue(`must be between ${schema.minimum} and ${schema.maximum}`);
  }
  if (schema.type === "boolean" && typeof value !== "boolean") return issue("must be a boolean");
  return [];
}
function checked(input: unknown, schema: Schema): RecordValue {
  let json: string | undefined;
  try { json = JSON.stringify(input); } catch { fail("$", "must be serializable JSON"); }
  if (!json || json.length > LIMITS.requestCharacters) fail("$", `request exceeds ${LIMITS.requestCharacters} characters`);
  const issues = validate(schema, input, "$");
  if (issues.length) throw new AgentDeckValidationError(issues.slice(0, 30));
  return input as RecordValue;
}
type Theme = { background: string; text: string; accent: string; font: string; titleSize: number; bodySize: number; margin: number };
function themeFor(size: { width: number; height: number }, input: unknown = {}): Theme {
  const shortest = Math.min(size.width, size.height), values = input as Partial<Theme>;
  return { background: "#0b1014", text: "#ffffff", accent: "#00d98a", font: "geist", titleSize: shortest * .075, bodySize: shortest * .038, margin: shortest * .07, ...values };
}
const pixelProperties = new Set(["x", "y", "width", "height", "fontSize", "letterSpacing", "padding", "paragraphSpacing", "strokeWidth", "radius", "blur", "autoFitFontSize", "autoFitMinFontSize", "autoFitMaxFontSize"]);
function toScene(properties: RecordValue, scale: number): RecordValue {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, pixelProperties.has(key) && typeof value === "number" ? value * scale : value]));
}
function checkNativeElement(element: CanvasElement, path: string): CanvasElement {
  if (!parseCanvasScene({ background: "#ffffff", elements: [{ ...element, groupId: undefined }] })) fail(path, "element contains an unsupported image URL or values outside Engine's editable layer limits");
  return element;
}
function makeElement(source: RecordValue, scale: number, theme: Theme, used: Set<string>, path: string): CanvasElement {
  // span and seam ask for a spanning photo once every slide exists (see SpanRequest); they aren't layer properties.
  const { span, seam, ...input } = source;
  if (seam !== undefined && span === undefined) fail(`${path}.seam`, "requires span: \"next\"");
  const type = input.type as CanvasElement["type"];
  const defaults: RecordValue = type === "text" ? { font: theme.font, color: theme.text, fontSize: theme.bodySize * scale, textMode: "auto-fit", verticalAlign: "top" }
    : type === "shape" ? { fill: theme.accent, stroke: "transparent" } : {};
  const element = { ...createCanvasElement(type), ...defaults, ...toScene(input, scale), id: input.id ?? crypto.randomUUID() } as CanvasElement;
  if (used.has(element.id)) fail(`${path}.id`, "must be unique across this deck");
  used.add(element.id);
  return checkNativeElement(element, path);
}
function textLayer(text: string, box: number[], fontSize: number, name: string, theme: Theme, scale: number, used: Set<string>, extra: RecordValue = {}): CanvasElement {
  return makeElement({ type: "text", text, name, x: box[0], y: box[1], width: box[2], height: box[3], fontSize, fontWeight: name === "Title" ? 700 : 400, slot: name.toLowerCase(), ...extra }, scale, theme, used, "$.slides");
}
/** An image that should continue on the next slide, applied once that slide exists. */
type SpanRequest = { pageId: string; elementId: string; seam?: number; path: string };
function spanRequest(input: RecordValue, pageId: string, element: CanvasElement, path: string, requests: SpanRequest[]) {
  if (input.span !== undefined) requests.push({ pageId, elementId: element.id, ...(input.seam !== undefined ? { seam: Number(input.seam) } : {}), path });
}
function applySpanRequests(document: DesignDocument, requests: SpanRequest[]): DesignDocument {
  for (const request of requests) {
    try { document = spanPhoto(document, request.pageId, request.elementId, request.seam ?? .5).design; }
    catch (error) { fail(`${request.path}.span`, error instanceof Error ? error.message : "could not continue on the next slide"); }
  }
  return document;
}
/** Every half of a spanning photo needs its partner right next to it. `sources`
 * holds each slide's template page, so the message names the template's own pair. */
function requireSpanPartners(document: DesignDocument, paths: string[], template?: DesignTemplate, sources: number[] = []) {
  const linked = new Set(spanPairs(document).flatMap(pair => [pair.start, pair.end]));
  const pairs = template ? spanPairs(template) : [];
  document.pages.forEach((page, index) => {
    const lonely = (page.canvas?.elements ?? []).find(element => isSpanHalf(element) && !linked.has(element));
    if (!lonely || !isSpanHalf(lonely)) return;
    const pair = pairs.find(item => item.startPage === sources[index] || item.endPage === sources[index]);
    const order = pair ? ` (page ${pair.startPage} then page ${pair.endPage})` : "";
    fail(`${paths[index] ?? `$.slides[${index}]`}.templatePage`, lonely.span.part === "start"
      ? `starts a photo that continues on the next slide: put the template page that shows its second half right after it${order}`
      : `shows the second half of the previous slide's photo: put the template page that starts it right before it${order}`);
  });
}
function makeSlide(spec: RecordValue, size: { width: number; height: number }, theme: Theme, used: Set<string>, path: string, requests: SpanRequest[] = []): DesignPage {
  if (spec.templatePage !== undefined) fail(`${path}.templatePage`, "requires create_deck with templateId");
  const { width: w, height: h } = size, scale = 360 / w;
  const m = Math.min(theme.margin, w * .22, h * .22), contentW = w - m * 2, contentH = h - m * 2;
  const layout = String(spec.layout ?? (spec.image ? "split" : "content"));
  const page = createBlankDesign("Slide", "portrait").pages[0];
  page.id = String(spec.id ?? crypto.randomUUID());
  if (used.has(page.id)) fail(`${path}.id`, "must be unique across this deck");
  used.add(page.id);
  page.image = { ...page.image, id: crypto.randomUUID(), width: w, height: h };
  if (spec.label !== undefined) page.label = String(spec.label);
  const elements: CanvasElement[] = [];
  const title = String(spec.title ?? ""), body = String(spec.body ?? ""), bullets = (spec.bullets ?? []) as string[];
  const textX = m;
  let textY = m, textW = contentW, textH = contentH;
  if (layout !== "blank") {
    if (spec.image) {
      const image = spec.image as RecordValue;
      let box: number[];
      if (layout === "split" && w > h) {
        textW = (contentW - m) * .48;
        box = [m + textW + m, m, contentW - textW - m, contentH];
      } else {
        const imageHeight = contentH * .43;
        box = [m, h - m - imageHeight, contentW, imageHeight];
        textH = contentH - imageHeight - m;
      }
      elements.push(makeElement({ type: "image", name: "Image", slot: "image", src: image.src, publicAlt: image.alt ?? "", fit: image.fit ?? "cover", x: box[0], y: box[1], width: box[2], height: box[3] }, scale, theme, used, `${path}.image`));
    }
    if (layout === "title") {
      textY = m + textH * .18;
      textH *= .7;
    }
    if (layout === "quote") {
      const quote = body || title;
      if (quote) elements.push(textLayer(quote, [textX, textY + textH * .12, textW, textH * .64], Math.min(theme.titleSize, textH * .12), "Quote", theme, scale, used, { fontWeight: 500 }));
      if (body && title) elements.push(textLayer(title, [textX, textY + textH * .82, textW, textH * .14], theme.bodySize, "Attribution", theme, scale, used));
      if (bullets.length) fail(`${path}.bullets`, "quote layout does not support bullets; use content or precise elements");
    } else {
      const hasCopy = Boolean(body || bullets.length), titleH = title ? Math.min(textH * (hasCopy ? .28 : .68), theme.titleSize * 3.4) : 0;
      if (title) elements.push(textLayer(title, [textX, textY, textW, titleH], Math.min(theme.titleSize, titleH * .48), "Title", theme, scale, used));
      const gap = title && hasCopy ? Math.min(m * .55, textH * .07) : 0;
      const copyY = textY + titleH + gap, copyH = textH - titleH - gap;
      if (body) {
        const bodyH = bullets.length ? copyH * .38 : copyH;
        elements.push(textLayer(body, [textX, copyY, textW, bodyH], Math.min(theme.bodySize, bodyH * .35), "Body", theme, scale, used));
      }
      if (bullets.length) {
        const offset = body ? copyH * .42 : 0;
        elements.push(textLayer(bullets.join("\n"), [textX, copyY + offset, textW, copyH - offset], Math.min(theme.bodySize, (copyH - offset) / (bullets.length * 1.4)), "Bullets", theme, scale, used, { listStyle: "bullet" }));
      }
    }
  } else if (title || body || bullets.length || spec.image) fail(path, "blank layout accepts precise elements only");
  for (const [index, element] of ((spec.elements ?? []) as RecordValue[]).entries()) {
    const made = makeElement(element, scale, theme, used, `${path}.elements[${index}]`);
    elements.push(made); spanRequest(element, page.id, made, `${path}.elements[${index}]`, requests);
  }
  if (elements.length > LIMITS.elementsPerSlide) fail(`${path}.elements`, "combined generated and precise layers exceed 100 elements");
  if (spec.slots !== undefined) fail(`${path}.slots`, "slots require templateId");
  if (spec.seam !== undefined || spec.photoSize !== undefined) fail(`${path}.${spec.seam !== undefined ? "seam" : "photoSize"}`, "requires templateId; use span: \"next\" on an image element instead");
  page.canvas = { background: String(spec.background ?? theme.background), elements };
  page.readingOrder = elements.filter(element => element.type !== "shape").map(element => element.id);
  return page;
}
export type AgentTemplateSlot = { pageId: string; pageIndex: number; pageLabel?: string; elementId: string; slot: string; type: "text" | "photo"; role?: SmartTextRole; sample?: string; maxCharacters?: number; fixedStyle: boolean };

/** Slots as a copy of the template will have them: text slots fit their copy
 * in the template's own style, photo slots take a new image in a fixed frame.
 * `maxCharacters` is a rough guide for copy that still reads at a good size. */
export function agentTemplateSlots(template: DesignTemplate): AgentTemplateSlot[] {
  const prepared = prepareSmartTemplate(template);
  return prepared.pages.flatMap((page, pageIndex) => [...(page.canvas ?? sceneForPage(page, template.format)).elements].sort((a, b) => a.y - b.y || a.x - b.x).flatMap((element): AgentTemplateSlot[] => {
    if (element.hidden || !element.slot && !element.templateRole && !(element.type === "text" && element.smartText)) return [];
    if (element.templateRole === "brand" && !(element.type === "text" && element.smartText)) return [];
    const base = { pageId: page.id, pageIndex, ...(page.label ? { pageLabel: page.label } : {}), elementId: element.id, slot: element.slot ?? element.id, fixedStyle: Boolean(element.protected?.includes("style")) };
    if (element.type === "text") {
      const rule = element.smartText, size = rule?.softMinFontSize ?? element.fontSize;
      const perLine = Math.max(1, (element.width - 2 * (element.padding ?? 0)) / (size * .52));
      // A list's length is its number of items, so it gets no character guide.
      const lines = rule && rule.role !== "list" ? Math.max(1, Math.floor(((rule.guideHeight ?? rule.maxHeight) - 2 * (element.padding ?? 0)) / (size * element.lineHeight))) : undefined;
      return [{ ...base, type: "text", ...(rule ? { role: rule.role } : {}), sample: element.text.slice(0, 200), ...(lines ? { maxCharacters: Math.max(8, Math.round(perLine * lines * .9)) } : {}) }];
    }
    if (element.type === "image" || element.type === "shape" && (element.templateRole === "media" || element.imageFill)) return [{ ...base, type: "photo" }];
    return [];
  }));
}
export type AgentTemplatePageSlot = Omit<AgentTemplateSlot, "pageId" | "pageIndex" | "pageLabel">;
/** `pair`: one photo starts on this page and continues on the page `with` (or the reverse). */
export type AgentTemplatePage = { index: number; label?: string; slots: AgentTemplatePageSlot[]; pair?: { part: "start" | "end"; with: number; note: string } };

/** The template's page types, for composing a carousel of any length with
 * `templatePage`. Pages without slots (a closing Follow page, say) are listed too. */
export function agentTemplatePages(template: DesignTemplate): AgentTemplatePage[] {
  const slots = agentTemplateSlots(template), pageKeys = new Set(["pageId", "pageIndex", "pageLabel"]);
  const pairs = spanPairs(template);
  return template.pages.map((page, index) => {
    const pair = pairs.find(item => item.startPage === index || item.endPage === index);
    const photo = pair && (pair.start.slot ?? "the photo");
    return {
      index, ...(page.label ? { label: page.label } : {}),
      slots: slots.filter(slot => slot.pageIndex === index).map(slot => Object.fromEntries(Object.entries(slot).filter(([key]) => !pageKeys.has(key))) as AgentTemplatePageSlot),
      ...(pair ? { pair: { part: pair.startPage === index ? "start" as const : "end" as const, with: pair.startPage === index ? pair.endPage : pair.startPage,
        note: `One photo runs across pages ${pair.startPage} and ${pair.endPage}: use them together, page ${pair.startPage} then page ${pair.endPage}, and fill ${photo} once, on page ${pair.startPage}. Give its photoSize and a seam there so the cut misses faces and text.` } } : {}),
    };
  });
}

function validateDocument(document: DesignDocument): DesignDocument {
  if (!parseLibrary({ ...structuredClone(EMPTY_LIBRARY), designs: [document] })) fail("$", "result exceeds Engine's editable document limits");
  return document;
}
/** `page` is a fresh copy of a prepared template page; `listed` holds that
 * template page's layer ids in paint order, as engine_list_templates reports
 * them. Copies keep the order but not the ids, so listed ids and smart flows
 * that name a layer id (rather than a slot) are resolved through it. */
/** A Wide photo's seam and size, applied once both of its pages exist. */
type SeamRequest = { pageId: string; elementId: string; seam?: number; path: string };
const isEndHalf = (element: CanvasElement | undefined) => isSpanHalf(element) && element.span.part === "end";
function templateSlide(page: DesignPage, spec: RecordValue, document: DesignDocument, used: Set<string>, path: string, listed: string[] = [], requests: { spans: SpanRequest[]; seams: SeamRequest[] } = { spans: [], seams: [] }): DesignPage {
  if (spec.layout !== undefined || spec.bullets !== undefined) fail(path, "template slides support templatePage, title, body, image, slots, and precise elements; omit layout and bullets");
  const canvas = page.canvas ?? sceneForPage(page, document.format);
  page.canvas = canvas;
  const listedLayers = listed.length === canvas.elements.length ? new Map(listed.map((layerId, index) => [layerId, canvas.elements[index]])) : new Map<string, CanvasElement>();
  const anchors = new Set(canvas.elements.flatMap(element => [element.id, ...(element.slot ? [element.slot] : [])]));
  for (const element of canvas.elements) {
    const anchor = element.smartFlow?.after, copied = anchor && !anchors.has(anchor) ? listedLayers.get(anchor) : undefined;
    if (copied) element.smartFlow = { ...element.smartFlow!, after: copied.id };
  }
  if (spec.id !== undefined) page.id = String(spec.id);
  if (used.has(page.id)) fail(`${path}.id`, "must be unique across this deck");
  used.add(page.id);
  for (const element of canvas.elements) {
    if (used.has(element.id)) fail(path, "template has duplicate layer identifiers");
    used.add(element.id);
  }
  if (spec.label !== undefined) page.label = String(spec.label);
  if (spec.background !== undefined) canvas.background = String(spec.background);
  const text = canvas.elements.filter(element => element.type === "text");
  const replacements = new Map<CanvasElement, { value: string; path: string }>();
  for (const [key, value] of Object.entries((spec.slots ?? {}) as RecordValue)) {
    const target = canvas.elements.find(element => element.slot === key || element.id === key || element.name === key) ?? listedLayers.get(key);
    if (!target || target.type !== "text" && target.type !== "image" && !(target.type === "shape" && (target.templateRole === "media" || target.imageFill))) fail(`${path}.slots.${key}`, "must identify an existing text, image or photo-frame slot");
    if (isEndHalf(target)) fail(`${path}.slots.${key}`, "is the second half of the previous slide's photo; fill the photo on that slide");
    if (target.type === "text" && String(value).length > LIMITS.textCharacters) fail(`${path}.slots.${key}`, `text slots allow at most ${LIMITS.textCharacters} characters`);
    replacements.set(target, { value: String(value), path: `${path}.slots.${key}` });
  }
  // Template copy slots in reading order; fixed brand text (handles, page furniture) is never a target.
  const copy = text.filter(element => element.type === "text" && element.smartText && !element.hidden).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const key of ["title", "body"] as const) if (spec[key] !== undefined) {
    const candidates = key === "title" ? ["title", "heading"] : ["body", "description"];
    const target = text.find(element => candidates.includes(element.slot ?? "")) ?? (copy.length ? copy[key === "title" ? 0 : 1] : text[key === "title" ? 0 : 1]);
    if (!target) fail(`${path}.${key}`, "template does not have a matching editable text slot");
    replacements.set(target, { value: String(spec[key]), path: `${path}.${key}` });
  }
  for (const [element, { value, path: slotPath }] of replacements) {
    ensureEditable(element, canvas, element.type === "text" ? ["text"] : ["src"], slotPath);
    if (element.type === "text") { element.text = value; delete element.richText; delete element.wordTextures; }
    else if (element.type === "image") element.src = value;
    else if (element.type === "shape") element.imageFill = { ...(element.imageFill ?? { objectFit: "cover", cropX: 50, cropY: 50 }), src: value };
    checkNativeElement(element, slotPath);
  }
  if (spec.image) {
    const element = canvas.elements.find(element => element.type === "image" && element.templateRole === "media") ?? canvas.elements.find(element => element.type === "image" && element.templateRole !== "brand") ?? canvas.elements.find(element => element.type === "image");
    if (!element || element.type !== "image") fail(`${path}.image`, "template has no editable image layer");
    if (isEndHalf(element)) fail(`${path}.image`, "this page shows the second half of the previous slide's photo; give the image on that slide");
    ensureEditable(element, canvas, ["src", "publicAlt", "fit"], `${path}.image`);
    const image = spec.image as RecordValue;
    element.src = String(image.src); element.publicAlt = String(image.alt ?? "");
    if (image.fit !== undefined) element.fit = image.fit as "cover" | "contain";
    checkNativeElement(element, `${path}.image`);
  }
  if (spec.seam !== undefined || spec.photoSize !== undefined) {
    const start = canvas.elements.find(element => isSpanHalf(element) && element.span.part === "start");
    if (!start || start.type !== "image") fail(`${path}.${spec.seam !== undefined ? "seam" : "photoSize"}`, "applies only to a page whose photo continues on the next page, such as the first page of the @chatgptricks Wide photo pair");
    if (spec.photoSize) {
      ensureEditable(start, canvas, ["src"], `${path}.photoSize`);
      const photoSize = spec.photoSize as { width: number; height: number };
      start.intrinsicWidth = photoSize.width; start.intrinsicHeight = photoSize.height;
    }
    requests.seams.push({ pageId: page.id, elementId: start.id, ...(spec.seam !== undefined ? { seam: Number(spec.seam) } : {}), path });
  }
  const size = formatDimensions(document), theme = themeFor(size);
  for (const [index, element] of ((spec.elements ?? []) as RecordValue[]).entries()) {
    const made = makeElement(element, 360 / size.width, theme, used, `${path}.elements[${index}]`);
    canvas.elements.push(made); spanRequest(element, page.id, made, `${path}.elements[${index}]`, requests.spans);
  }
  return page;
}
export function createAgentDeck(input: unknown, templates: DesignTemplate[] = BUILT_IN_TEMPLATES): DesignDocument {
  const spec = checked(input, AGENT_DECK_SPEC_SCHEMA);
  const used = new Set<string>(), requests = { spans: [] as SpanRequest[], seams: [] as SeamRequest[] };
  let document: DesignDocument, paths: string[] = [], pairTemplate: DesignTemplate | undefined, sourcePages: number[] = [];
  if (spec.templateId !== undefined) {
    const template = templates.find(candidate => candidate.id === spec.templateId);
    if (!template) fail("$.templateId", "template was not found");
    if (spec.format !== undefined || spec.size !== undefined || spec.theme !== undefined) fail("$", "templateId preserves the template dimensions and theme; omit format, size, and theme");
    // Pages are prepared as a whole template (cover/heading/body roles, brand
    // layers, smart flows) before any page is chosen, so a composed deck keeps
    // exactly the constraints a full copy has.
    document = createDesign(template);
    const prepared = prepareSmartTemplate(template);
    const listed = prepared.pages.map(page => (page.canvas ?? sceneForPage(page, prepared.format)).elements.map(element => element.id));
    const requested = spec.slides as RecordValue[] | undefined;
    if (requested?.some(slide => slide.templatePage !== undefined)) {
      if (document.continuousCanvas) fail("$.slides", "continuous canvas templates are copied whole; omit templatePage");
      const sources = document.pages;
      document.pages = requested.map((slide, index) => {
        const path = `$.slides[${index}]`, source = slide.templatePage as number | undefined;
        if (source === undefined) fail(`${path}.templatePage`, "is required on every slide once any slide sets templatePage");
        if (source >= sources.length) fail(`${path}.templatePage`, `must be a page index from 0 to ${sources.length - 1}; this template has ${sources.length} pages`);
        // The editor's page duplicate: fresh page, page image, layer, group,
        // component-instance and word-texture ids, with groupId/parentId,
        // reading order and rich-text texture runs remapped. Sources stay pristine.
        return templateSlide(duplicatePage(sources[source]), slide, document, used, path, listed[source], requests);
      });
      paths = requested.map((_, index) => `$.slides[${index}]`);
      pairTemplate = template; sourcePages = requested.map(slide => slide.templatePage as number);
    } else {
      const slides = requested ?? template.pages.map(() => ({}));
      if (slides.length !== document.pages.length) fail("$.slides", `template requires exactly ${document.pages.length} slides; omit slides to copy the full template, or set templatePage on every slide to choose pages`);
      document.pages = document.pages.map((page, index) => templateSlide(page, slides[index], document, used, `$.slides[${index}]`, listed[index], requests));
      if (document.continuousCanvas && spec.slides !== undefined) fail("$.slides", "continuous canvas templates must be copied without slide replacements");
    }
  } else {
    if (!spec.slides) fail("$.slides", "is required when templateId is omitted");
    const preset = String(spec.format ?? "presentation");
    if (preset === "custom" && !spec.size) fail("$.size", "is required for custom format");
    if (preset !== "custom" && spec.size !== undefined) fail("$.size", "requires format custom");
    const size = (preset === "custom" ? spec.size : PRESETS[preset as keyof typeof PRESETS]) as { width: number; height: number };
    const format = preset === "square" ? "square" : preset === "story" ? "story" : "portrait";
    document = createBlankDesign(String(spec.name), format);
    document.customSize = { ...size };
    const theme = themeFor(size, spec.theme);
    document.pages = (spec.slides as RecordValue[]).map((slide, index) => makeSlide(slide, size, theme, used, `$.slides[${index}]`, requests.spans));
  }
  // Spanning photos: both halves next to each other, the seam and photo shape applied, then any span requests.
  requireSpanPartners(document, paths, pairTemplate, sourcePages);
  for (const request of requests.seams) document = setSeam(document, request.pageId, request.elementId, request.seam ?? .5);
  document = applySpanRequests(reconcileSpans(document).design, requests.spans);
  document.id = String(spec.id ?? document.id);
  if (used.has(document.id)) fail("$.id", "must differ from page and element identifiers");
  document.name = String(spec.name).trim();
  if (!document.name) fail("$.name", "must include a visible character");
  document.caption = String(spec.caption ?? "");
  return validateDocument(document);
}
const positionKeys = new Set(["x", "y", "width", "height", "rotation"]);
const contentKeys = new Set(["text", "src", "publicAlt"]);
function ensureEditable(element: CanvasElement, scene: CanvasScene, properties: string[], path: string, deleting = false) {
  let group = scene.groups?.find(candidate => candidate.id === element.groupId);
  const seen = new Set<string>();
  while (group) {
    if (group.locked) fail(path, "element belongs to a locked group");
    if (seen.has(group.id)) break;
    seen.add(group.id); group = scene.groups?.find(candidate => candidate.id === group?.parentId);
  }
  if (element.locked) fail(path, "element is locked");
  if (deleting && element.protected?.includes("delete")) fail(path, "element is protected against deletion");
  for (const key of properties) {
    const category = positionKeys.has(key) ? "position" : contentKeys.has(key) ? "content" : "style";
    if (element.protected?.includes(category)) fail(`${path}.${key}`, `element ${category} is protected`);
  }
}
function allIds(document: DesignDocument) {
  return new Set([document.id, ...document.pages.flatMap(page => [page.id, page.image.id, ...(page.canvas?.elements.map(element => element.id) ?? [])]), ...(document.masterScene?.elements.map(element => element.id) ?? []), ...(document.continuousCanvas?.elements.map(element => element.id) ?? [])]);
}
/** The spanning photos' halves before an operation, enough for syncSpans to see what changed. */
function spanSnapshot(document: DesignDocument): DesignDocument | undefined {
  if (!hasSpans(document)) return undefined;
  return { ...document, pages: document.pages.map(page => page.canvas ? { ...page, canvas: { ...page.canvas, elements: page.canvas.elements.filter(isSpanHalf).map(element => structuredClone(element)) } } : page) };
}
export function updateAgentDeck(document: DesignDocument, input: unknown): DesignDocument {
  const spec = checked(input, AGENT_UPDATE_SCHEMA);
  let next = structuredClone(document), before: DesignDocument | undefined;
  validateDocument(next);
  const size = formatDimensions(next), scale = 360 / size.width, theme = themeFor(size), used = allIds(next);
  for (const [index, operation] of (spec.operations as RecordValue[]).entries()) {
    // Each operation's edits to one half of a spanning photo reach the other half before the next operation.
    if (before) next = syncSpans(before, next).design;
    before = spanSnapshot(next);
    const path = `$.operations[${index}]`, op = String(operation.op);
    if (op === "rename") {
      const name = String(operation.name).trim(); if (!name) fail(`${path}.name`, "must include a visible character");
      next.name = name; continue;
    }
    if (op === "caption") { next.caption = String(operation.caption); continue; }
    if (next.continuousCanvas) fail(path, "slide edits on a continuous canvas require the visual editor; rename and caption remain available");
    if (op === "add_slide") {
      if (next.pages.length >= LIMITS.slides) fail(path, "deck already contains the maximum 20 slides");
      const target = Number(operation.index ?? next.pages.length);
      if (target > next.pages.length) fail(`${path}.index`, "is outside the slide list");
      const spans: SpanRequest[] = [];
      next.pages.splice(target, 0, makeSlide(operation.slide as RecordValue, size, theme, used, `${path}.slide`, spans));
      next = applySpanRequests(next, spans);
      continue;
    }
    const pageIndex = next.pages.findIndex(page => page.id === operation.pageId);
    if (pageIndex < 0) fail(`${path}.pageId`, "slide was not found");
    const page = next.pages[pageIndex];
    if (op === "move_slide") {
      const target = Number(operation.index); if (target >= next.pages.length) fail(`${path}.index`, "is outside the slide list");
      next.pages.splice(pageIndex, 1); next.pages.splice(target, 0, page); continue;
    }
    if (op === "remove_slide") {
      if (next.pages.length === 1) fail(path, "a deck must retain at least one slide");
      const scene = page.canvas ?? sceneForPage(page, next.format);
      for (const element of scene.elements) ensureEditable(element, scene, [], path, true);
      next.pages.splice(pageIndex, 1); continue;
    }
    const canvas = page.canvas ?? sceneForPage(page, next.format);
    page.canvas = canvas;
    if (op === "update_slide") {
      if (operation.background === undefined && operation.label === undefined) fail(path, "requires background or label");
      if (operation.background !== undefined) canvas.background = String(operation.background);
      if (operation.label !== undefined) page.label = String(operation.label);
      continue;
    }
    if (op === "add_element") {
      if (canvas.elements.length >= 100) fail(path, "slide already contains the maximum 100 elements");
      const element = makeElement(operation.element as RecordValue, scale, theme, used, `${path}.element`);
      canvas.elements.push(element); if (page.readingOrder) page.readingOrder.push(element.id);
      const spans: SpanRequest[] = [];
      spanRequest(operation.element as RecordValue, page.id, element, `${path}.element`, spans);
      next = applySpanRequests(next, spans);
      continue;
    }
    if (op === "span_photo" || op === "unlink_span") {
      const element = canvas.elements.find(item => item.id === operation.elementId);
      if (!element || element.type !== "image") fail(`${path}.elementId`, "must identify an image on this slide");
      ensureEditable(element, canvas, [], path);
      const place = findSpan(next, page.id, element.id);
      if (op === "unlink_span") {
        if (!place) fail(`${path}.elementId`, "this image doesn't continue on another slide");
        next = unlinkSpan(next, page.id, element.id);
        continue;
      }
      try { next = spanPhoto(next, page.id, element.id, operation.seam !== undefined ? Number(operation.seam) : place ? seamOf(place.start) : .5).design; }
      catch (error) { fail(path, error instanceof Error ? error.message : "could not continue on the next slide"); }
      continue;
    }
    const elementIndex = canvas.elements.findIndex(element => element.id === operation.elementId);
    if (elementIndex < 0) fail(`${path}.elementId`, "element was not found on this slide");
    const element = canvas.elements[elementIndex];
    if (op === "remove_element") {
      ensureEditable(element, canvas, [], path, true);
      canvas.elements.splice(elementIndex, 1);
      if (page.readingOrder) page.readingOrder = page.readingOrder.filter(id => id !== element.id);
    } else {
      const properties = operation.properties as RecordValue;
      const allowed = new Set(Object.keys({ ...baseProperties, ...(element.type === "text" ? textProperties : element.type === "image" ? imageProperties : shapeProperties) }));
      for (const key of Object.keys(properties)) if (!allowed.has(key)) fail(`${path}.properties.${key}`, `is not supported on a ${element.type} element`);
      ensureEditable(element, canvas, Object.keys(properties), `${path}.properties`);
      const updated = { ...element, ...toScene(properties, scale) } as CanvasElement;
      if (element.type === "text") {
        const updatedText = updated as Extract<CanvasElement, { type: "text" }>;
        if (properties.text !== undefined) delete updatedText.richText;
        if (Object.keys(properties).some(key => ["text", "font", "fontSize", "fontWeight", "width", "height", "padding", "lineHeight", "letterSpacing"].includes(key))) delete updatedText.autoFitFontSize;
      }
      checkNativeElement(updated, `${path}.properties`);
      canvas.elements[elementIndex] = updated;
    }
  }
  if (before) next = syncSpans(before, next).design;
  next.updatedAt = new Date().toISOString();
  return validateDocument(next);
}
/** Inspect and patch using the same pixel coordinate system as the authoring API. */
export function agentDeckView(document: DesignDocument) {
  const size = formatDimensions(document), scale = size.width / 360;
  // Each half of a spanning photo names its partner slide and the seam (the share of the photo on the first slide).
  type SpanView = { id: string; part: "start" | "end"; partnerPageId: string; seam: number };
  const spans = new Map<CanvasElement, SpanView>(spanPairs(document).flatMap(pair => {
    const seam = Math.round(seamOf(pair.start) * 1000) / 1000;
    return [[pair.start, { ...pair.start.span, partnerPageId: document.pages[pair.endPage].id, seam }], [pair.end, { ...pair.end.span, partnerPageId: document.pages[pair.startPage].id, seam }]];
  }));
  const viewScene = (scene: CanvasScene) => ({
    background: scene.background,
    elements: scene.elements.map(element => ({
      ...toScene(structuredClone(element) as unknown as RecordValue, scale),
      ...(element.clipBounds ? { clipBounds: toScene(element.clipBounds, scale) } : {}),
      ...(element.shadow ? { shadow: { ...element.shadow, offsetX: element.shadow.offsetX * scale, offsetY: element.shadow.offsetY * scale, blur: element.shadow.blur * scale, spread: element.shadow.spread * scale } } : {}),
      ...(element.strokeDash ? { strokeDash: element.strokeDash.map(length => length * scale) } : {}),
      ...(spans.has(element) ? { span: spans.get(element) } : {}),
    })),
    ...(scene.groups ? { groups: structuredClone(scene.groups) } : {}),
  });
  return {
    id: document.id, name: document.name, size, coordinates: "output pixels", caption: document.caption,
    slides: document.pages.map(page => ({
      id: page.id, ...(page.label !== undefined ? { label: page.label } : {}),
      ...viewScene(page.canvas ?? sceneForPage(page, document.format)),
    })),
    ...(document.masterScene ? { master: viewScene(document.masterScene) } : {}),
    ...(document.continuousCanvas ? { continuousCanvas: viewScene(document.continuousCanvas) } : {}),
  };
}
export function agentDeckSummary(document: DesignDocument) {
  return { id: document.id, name: document.name, size: formatDimensions(document), pages: document.pages.length, updatedAt: document.updatedAt };
}
/** The standard .engine.json import format; all native layers and resources remain editable. */
export function editableDeckPackage(document: DesignDocument): EditorLibrary {
  return { ...structuredClone(EMPTY_LIBRARY), designs: [structuredClone(document)] };
}
export function agentCapabilities() {
  const composable = BUILT_IN_TEMPLATES.find(template => template.pages.length > 1 && !template.continuousCanvas);
  return {
    version: 1, coordinates: "output pixels (including fontSize); native scene width is 360",
    editable: ["text", "image", "shape"], layouts: LAYOUTS, presets: PRESETS, fonts: FONTS, limits: LIMITS,
    deckSchema: AGENT_DECK_SPEC_SCHEMA, updateSchema: AGENT_UPDATE_SCHEMA,
    templates: BUILT_IN_TEMPLATES.map(template => ({ id: template.id, name: template.name, pages: template.pages.length, size: formatDimensions(template), pageTypes: agentTemplatePages(template) })),
    imageSources: ["https:// or http:// URLs, or root-relative paths on the Engine origin","data:image/png|jpeg|webp|gif|avif;base64 (the bytes must match the declared type)", "data:image/svg+xml;charset=utf-8,<URI-encoded SVG> using only svg, g, path, defs and gradient elements (no text, rect, style or base64 SVG)"],
    example: { id: "agent-demo", name: "An editable presentation", format: "presentation", slides: [
      { id: "intro", layout: "title", title: "Build with editable layers", body: "Every word, image, and shape stays editable in Engine" },
      { id: "details", layout: "content", title: "A simple agent workflow", bullets: ["Read capabilities", "Create a deck", "Refine individual elements"] },
    ] },
    updateExample: { operations: [{ op: "update_slide", pageId: "intro", label: "Opening slide" }, { op: "rename", name: "My editable presentation" }] },
    ...(composable ? { templateExample: { name: "A carousel composed from template pages", templateId: composable.id, slides: [{ templatePage: 0 }, { templatePage: 1 }, { templatePage: 1 }, { templatePage: composable.pages.length - 1 }] } } : {}),
    notes: ["Read the saved deck to obtain generated element IDs before patching.", "Updates are atomic; locked and protected layers cannot be bypassed.", "Use templateId to copy native templates. Omit slides to copy every page, or pass exactly one slide per template page in order to fill its text/image slots.", "To build a carousel of any length (1–20 slides) from a template's page types, set templatePage (0-based template page index) on every slide; pages may repeat, reorder or be left out. Each slide gets fresh page and layer ids and keeps that page's smart-template rules. Setting templatePage on only some slides is an error. Template pages and their slots are listed per page as pageTypes.", "For consistent posts, prefer templateId + slots from engine_list_templates. Text slots keep the template font, colour and position; their size adapts to the copy and nearby content makes room. Stay within each slot's maxCharacters. Photo slots replace the image inside a fixed frame. Fixed brand layers cannot change.", "Photo slots and image.src accept the imageSources listed here, up to 2,000,000 characters. Render charts as PNG data URLs; base64 SVG is rejected.", "Engine JSON imports preserve editable layers. Private uploaded media requires a portable ZIP backup for transfer to another workspace.", "Spanning photos: one photo can start on one slide and continue on the next, split at the seam as people swipe. In a template, use the two pages pageTypes marks with pair together and in order, fill the photo once on the first and give its photoSize and seam (0.1 to 0.9, the share of the photo on that slide, chosen so the cut misses faces and text). In any deck, add an image with span: \"next\" (and seam), or use span_photo on an existing image; span_photo on a photo that already spans moves its seam. update_element on either half updates both, remove_element removes both, unlink_span leaves two ordinary photos, and a slide moved away from its partner unlinks them. engine_get_deck shows each half's span with its partnerPageId and seam."],
  };
}
