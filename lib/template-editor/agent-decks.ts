/** Agent authoring uses output pixels; Engine stores editable layers on a 360-wide scene. */
import {
  BUILT_IN_TEMPLATES, EMPTY_LIBRARY, createBlankDesign, createCanvasElement,
  createDesign, formatDimensions, parseCanvasScene, parseLibrary, sceneForPage,
  type CanvasElement, type CanvasScene, type DesignDocument, type DesignPage,
  type DesignTemplate, type EditorLibrary,
} from "./model";

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
const LIMITS = { slides: 20, elementsPerSlide: 100, operations: 200, textCharacters: 20_000, requestCharacters: 4_000_000, minSize: 100, maxSize: 8192 };
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
  src: str(2_000_000, { minLength: 1 }), publicAlt: str(2000), fit: choice(["cover", "contain"]),
  cropX: num(0, 100), cropY: num(0, 100), cropScale: num(.1, 20), radius: num(0, 100_000),
  flipX: bool, flipY: bool, mask: choice(["none", "ellipse", "triangle", "diamond"]),
};
const shapeProperties = {
  shape: choice(["rectangle", "ellipse", "triangle", "diamond", "polygon", "star", "arrow"]),
  fill: color, stroke: color, strokeWidth: num(0, 10_000), radius: num(0, 100_000),
  sides: { type: "integer", minimum: 3, maximum: 30 }, starPoints: { type: "integer", minimum: 3, maximum: 30 },
  innerRadius: num(.05, .95), strokeAlign: choice(["inside", "center", "outside"]),
};
const elementSchema: Schema = { oneOf: [
  obj({ ...baseProperties, type: { const: "text" }, ...textProperties }, ["type", "text", "x", "y", "width", "height"]),
  obj({ ...baseProperties, type: { const: "image" }, ...imageProperties }, ["type", "src", "x", "y", "width", "height"]),
  obj({ ...baseProperties, type: { const: "shape" }, ...shapeProperties }, ["type", "x", "y", "width", "height"]),
] };
const slideImageSchema = obj({ src: imageProperties.src, alt: str(2000), fit: imageProperties.fit }, ["src"]);
const slideSchema = obj({
  id, label: str(200), layout: choice(LAYOUTS), background: color, title: str(20_000), body: str(20_000),
  bullets: { type: "array", maxItems: 40, items: str(2000) }, image: slideImageSchema,
  elements: { type: "array", maxItems: 100, items: elementSchema },
  slots: { type: "object", maxProperties: 100, additionalProperties: str(20_000) },
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
function makeElement(input: RecordValue, scale: number, theme: Theme, used: Set<string>, path: string): CanvasElement {
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
function makeSlide(spec: RecordValue, size: { width: number; height: number }, theme: Theme, used: Set<string>, path: string): DesignPage {
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
  for (const [index, element] of ((spec.elements ?? []) as RecordValue[]).entries()) elements.push(makeElement(element, scale, theme, used, `${path}.elements[${index}]`));
  if (elements.length > LIMITS.elementsPerSlide) fail(`${path}.elements`, "combined generated and precise layers exceed 100 elements");
  if (spec.slots !== undefined) fail(`${path}.slots`, "slots require templateId");
  page.canvas = { background: String(spec.background ?? theme.background), elements };
  page.readingOrder = elements.filter(element => element.type !== "shape").map(element => element.id);
  return page;
}
function validateDocument(document: DesignDocument): DesignDocument {
  if (!parseLibrary({ ...structuredClone(EMPTY_LIBRARY), designs: [document] })) fail("$", "result exceeds Engine's editable document limits");
  return document;
}
function templateSlide(page: DesignPage, spec: RecordValue, document: DesignDocument, used: Set<string>, path: string): DesignPage {
  if (spec.layout !== undefined || spec.bullets !== undefined) fail(path, "template slides support title, body, image, slots, and precise elements; omit layout and bullets");
  const canvas = page.canvas ?? sceneForPage(page, document.format);
  page.canvas = canvas;
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
  const replacements = new Map<CanvasElement, string>();
  for (const [key, value] of Object.entries((spec.slots ?? {}) as RecordValue)) {
    const target = canvas.elements.find(element => element.slot === key || element.id === key || element.name === key);
    if (!target || target.type !== "text" && target.type !== "image") fail(`${path}.slots.${key}`, "must identify an existing text or image slot");
    replacements.set(target, String(value));
  }
  for (const key of ["title", "body"] as const) if (spec[key] !== undefined) {
    const candidates = key === "title" ? ["title", "heading"] : ["body", "description"];
    const target = text.find(element => candidates.includes(element.slot ?? "")) ?? text[key === "title" ? 0 : 1];
    if (!target) fail(`${path}.${key}`, "template does not have a matching editable text slot");
    replacements.set(target, String(spec[key]));
  }
  for (const [element, value] of replacements) {
    ensureEditable(element, canvas, element.type === "text" ? ["text"] : ["src"], path);
    if (element.type === "text") { element.text = value; delete element.richText; }
    else if (element.type === "image") element.src = value;
    checkNativeElement(element, path);
  }
  if (spec.image) {
    const element = canvas.elements.find(element => element.type === "image");
    if (!element || element.type !== "image") fail(`${path}.image`, "template has no editable image layer");
    ensureEditable(element, canvas, ["src", "publicAlt", "fit"], `${path}.image`);
    const image = spec.image as RecordValue;
    element.src = String(image.src); element.publicAlt = String(image.alt ?? "");
    if (image.fit !== undefined) element.fit = image.fit as "cover" | "contain";
    checkNativeElement(element, `${path}.image`);
  }
  const size = formatDimensions(document), theme = themeFor(size);
  for (const [index, element] of ((spec.elements ?? []) as RecordValue[]).entries()) canvas.elements.push(makeElement(element, 360 / size.width, theme, used, `${path}.elements[${index}]`));
  return page;
}
export function createAgentDeck(input: unknown, templates: DesignTemplate[] = BUILT_IN_TEMPLATES): DesignDocument {
  const spec = checked(input, AGENT_DECK_SPEC_SCHEMA);
  const used = new Set<string>();
  let document: DesignDocument;
  if (spec.templateId !== undefined) {
    const template = templates.find(candidate => candidate.id === spec.templateId);
    if (!template) fail("$.templateId", "template was not found");
    if (spec.format !== undefined || spec.size !== undefined || spec.theme !== undefined) fail("$", "templateId preserves the template dimensions and theme; omit format, size, and theme");
    document = createDesign(template);
    const slides = (spec.slides ?? template.pages.map(() => ({}))) as RecordValue[];
    if (slides.length !== document.pages.length) fail("$.slides", `template requires exactly ${document.pages.length} slides; omit slides to copy the full template`);
    document.pages = document.pages.map((page, index) => templateSlide(page, slides[index], document, used, `$.slides[${index}]`));
    if (document.continuousCanvas && spec.slides !== undefined) fail("$.slides", "continuous canvas templates must be copied without slide replacements");
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
    document.pages = (spec.slides as RecordValue[]).map((slide, index) => makeSlide(slide, size, theme, used, `$.slides[${index}]`));
  }
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
export function updateAgentDeck(document: DesignDocument, input: unknown): DesignDocument {
  const spec = checked(input, AGENT_UPDATE_SCHEMA), next = structuredClone(document);
  validateDocument(next);
  const size = formatDimensions(next), scale = 360 / size.width, theme = themeFor(size), used = allIds(next);
  for (const [index, operation] of (spec.operations as RecordValue[]).entries()) {
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
      next.pages.splice(target, 0, makeSlide(operation.slide as RecordValue, size, theme, used, `${path}.slide`));
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
      canvas.elements.push(element); if (page.readingOrder) page.readingOrder.push(element.id); continue;
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
  next.updatedAt = new Date().toISOString();
  return validateDocument(next);
}
/** Inspect and patch using the same pixel coordinate system as the authoring API. */
export function agentDeckView(document: DesignDocument) {
  const size = formatDimensions(document), scale = size.width / 360;
  const viewScene = (scene: CanvasScene) => ({
    background: scene.background,
    elements: scene.elements.map(element => ({
      ...toScene(structuredClone(element) as unknown as RecordValue, scale),
      ...(element.clipBounds ? { clipBounds: toScene(element.clipBounds, scale) } : {}),
      ...(element.shadow ? { shadow: { ...element.shadow, offsetX: element.shadow.offsetX * scale, offsetY: element.shadow.offsetY * scale, blur: element.shadow.blur * scale, spread: element.shadow.spread * scale } } : {}),
      ...(element.strokeDash ? { strokeDash: element.strokeDash.map(length => length * scale) } : {}),
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
  return {
    version: 1, coordinates: "output pixels (including fontSize); native scene width is 360",
    editable: ["text", "image", "shape"], layouts: LAYOUTS, presets: PRESETS, fonts: FONTS, limits: LIMITS,
    deckSchema: AGENT_DECK_SPEC_SCHEMA, updateSchema: AGENT_UPDATE_SCHEMA,
    templates: BUILT_IN_TEMPLATES.map(template => ({ id: template.id, name: template.name, pages: template.pages.length, size: formatDimensions(template) })),
    example: { id: "agent-demo", name: "An editable presentation", format: "presentation", slides: [
      { id: "intro", layout: "title", title: "Build with editable layers", body: "Every word, image, and shape stays editable in Engine" },
      { id: "details", layout: "content", title: "A simple agent workflow", bullets: ["Read capabilities", "Create a deck", "Refine individual elements"] },
    ] },
    updateExample: { operations: [{ op: "update_slide", pageId: "intro", label: "Opening slide" }, { op: "rename", name: "My editable presentation" }] },
    notes: ["Read the saved deck to obtain generated element IDs before patching.", "Updates are atomic; locked and protected layers cannot be bypassed.", "Use templateId to copy native templates; slides must match the template slide count and may replace text/image slots.", "Engine JSON imports preserve editable layers. Private uploaded media requires a portable ZIP backup for transfer to another workspace."],
  };
}
