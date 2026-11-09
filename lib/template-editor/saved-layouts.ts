/**
 * Save as layout: one slide of a post becomes a new page in the template the
 * post was made from, under a name and with a line saying when to use it.
 * Recreate's designer sees it in the template's page list
 * (lib/engine/agents/pages.ts) and can start a slide from it, like from any of
 * the template's own pages.
 *
 *   - HTML layers keep the slide's pattern (a chart, a table, a post card). The
 *     designer fills them with a new post's own data.
 *   - The slide's other text layers become text slots. Their words stay as the
 *     sample, and new copy fits the same box (smart text, down to 70% size).
 *   - Its photos and logos become photo slots with a grey placeholder, so no
 *     picture from the post stays in the template.
 *   - The template's brand layers (fades, logos, hairlines), hidden layers and
 *     master layers stay as they are.
 *
 * The page's `savedLayout` field marks it and holds its "use when" line. It
 * travels with the page through copies, exports and the template editor's
 * Update template. Saving under the layout's name again replaces it, with a new
 * line.
 *
 * A built-in template gets a copy in the workspace under its own id, which
 * takes its place everywhere (template-catalog.ts). The first copy carries the
 * fingerprint of the built-in it was made from (`builtInFingerprint`). While no
 * one has changed the built-in's part of it, libraryTemplates shows the
 * built-in's current pages and then the saved layouts, so Engine's later
 * changes still reach it. A copy someone edited, or one that was there before
 * (no fingerprint), is theirs: a layout is added to it and the rest stays as it
 * is.
 *
 * Pure and client-safe: the editor's page menu (design-editor.tsx) and the
 * chat's save_layout (lib/engine/agents/layouts.ts) share it.
 */
import { duplicatePage, formatDimensions, MAX_SAVED_LAYOUT_USE_WHEN, sceneForPage, templateFingerprint, type CanvasElement, type DesignDocument, type DesignPage, type DesignTemplate, type EditorLibrary, type ImageElement, type ShapeElement, type SmartTextRole, type TextElement } from "./model";
import { libraryTemplates, trashedTemplates } from "./template-catalog";

export const MAX_LAYOUT_NAME = 80;
export const MAX_LAYOUT_USE_WHEN = MAX_SAVED_LAYOUT_USE_WHEN;
/** parseLibrary's limits: pages in a template, and the workspace's own templates. */
const MAX_TEMPLATE_PAGES = 20, MAX_TEMPLATES = 80;

/** A save that can't happen, saying what to do instead. `status` is what an API answers with. */
export class SavedLayoutError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "SavedLayoutError";
  }
}

export type SaveLayoutRequest = { pageId: string; name: string; useWhen: string };
export type SavedLayoutResult = {
  templateId: string;
  templateName: string;
  /** 0-based, as the designer's page list counts. */
  pageIndex: number;
  pageCount: number;
  name: string;
  /** True when it took the place of a saved layout of the same name. */
  replaced: boolean;
};

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const sameName = (label: string | undefined, name: string) => clean(label ?? "").toLowerCase() === name.toLowerCase();
const round = (value: number) => Math.round(value * 100) / 100;

/** When to use a saved layout, or null for a page that isn't one. */
export function layoutUseWhen(page: DesignPage): string | null {
  const text = page.savedLayout?.useWhen.trim();
  return text ? text : null;
}
export const isSavedLayout = (page: DesignPage) => Boolean(page.savedLayout);

/** The template a post's slides would be saved in, or null when it isn't in the workspace. */
export function layoutTemplateOf(library: EditorLibrary, document: Pick<DesignDocument, "templateId">): DesignTemplate | null {
  return libraryTemplates(library).find(template => template.id === document.templateId) ?? null;
}

function templateFor(library: EditorLibrary, document: DesignDocument): DesignTemplate {
  const template = layoutTemplateOf(library, document);
  if (template) return template;
  const trashed = trashedTemplates(library).find(item => item.id === document.templateId);
  if (trashed) throw new SavedLayoutError(`The template this post was made from, ${trashed.name}, is in Trash. Restore it, then save the layout again.`, 409);
  throw new SavedLayoutError("The template this post was made from isn't in the workspace anymore, so there's no template to save the layout in.", 404);
}

/** A grey photo placeholder with a faint picture icon (the chatgptricks template's own). Code
 * recognises an empty photo slot by its data: SVG (spanning-photos.ts, stored-images.ts). */
function placeholder(width: number, height: number): string {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height)), cx = w / 2, cy = h / 2, s = Math.min(1, w / 240, h / 192);
  const n = (value: number) => String(round(value));
  const [l, t, r, b] = [cx - 60 * s, cy - 48 * s, cx + 60 * s, cy + 48 * s];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M0 0H${w}V${h}H0Z" fill="#1A242B"/><g opacity="0.3">`
    + `<path d="M${n(l)} ${n(t)}H${n(r)}V${n(b)}H${n(l)}ZM${n(l + 6 * s)} ${n(t + 6 * s)}V${n(b - 6 * s)}H${n(r - 6 * s)}V${n(t + 6 * s)}Z" fill="#D9D9D9" fill-rule="evenodd"/>`
    + `<path d="M${n(l + 14 * s)} ${n(b - 14 * s)}L${n(cx - 16 * s)} ${n(cy - 4 * s)}L${n(cx + 6 * s)} ${n(cy + 18 * s)}L${n(cx + 22 * s)} ${n(cy + 4 * s)}L${n(r - 14 * s)} ${n(b - 14 * s)}Z" fill="#D9D9D9"/>`
    + `<path d="M${n(cx + 17 * s)} ${n(cy - 22 * s)}a${n(9 * s)} ${n(9 * s)} 0 1 0 ${n(18 * s)} 0a${n(9 * s)} ${n(9 * s)} 0 1 0 ${n(-18 * s)} 0Z" fill="#D9D9D9"/></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Where a photo came from and how it was cut: none of it belongs to the placeholder. */
const PHOTO_DETAILS = ["previewSrc", "publicAlt", "alt", "rightsNote", "sourceUrl", "provenance", "cropScale", "flipX", "flipY"] as const;
function without<T extends object>(value: T, keys: readonly string[]): T {
  const next = { ...value } as Record<string, unknown>;
  for (const key of keys) delete next[key];
  return next as T;
}

const slug = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** A text layer as a slot: its words are the sample, and longer copy shrinks to fit its box. */
function textSlot(element: TextElement, slot: string, role: SmartTextRole): TextElement {
  if (element.smartText) return { ...element, slot };
  const next = without(element, ["autoFitFontSize", "autoFitMinFontSize", "autoFitMaxFontSize"]);
  return {
    ...next, slot, layoutRole: element.layoutRole ?? "text", textMode: "auto-fit",
    smartText: { role, lines: 0, minFontSize: Math.max(1, round(element.fontSize * .7)), maxFontSize: element.fontSize, maxHeight: element.height + .01, baseHeight: element.height + .01, softMinFontSize: Math.max(1, round(element.fontSize * .85)) },
  };
}

/** A photo or logo as a slot: the same frame, with the grey placeholder in it. `scale` turns scene units into output pixels. */
function photoSlot(element: ImageElement, slot: string, scale: number): ImageElement {
  const width = Math.max(1, Math.round(element.width * scale)), height = Math.max(1, Math.round(element.height * scale));
  return {
    ...without(element, PHOTO_DETAILS), slot, templateRole: "media", layoutRole: element.layoutRole ?? "media",
    src: placeholder(width, height), fit: "cover", cropX: 50, cropY: 50, intrinsicWidth: width, intrinsicHeight: height,
    directive: element.directive ?? `A photo for this slide (${element.name || slot})`,
  };
}

function frameSlot(element: ShapeElement, slot: string, scale: number): ShapeElement {
  const fill = element.imageFill!;
  return { ...element, slot, templateRole: "media", imageFill: { ...without(fill, PHOTO_DETAILS), src: placeholder(element.width * scale, element.height * scale) } };
}

/** Drops links to the post's own styles, components and colour roles that the template doesn't have. */
function unlinked(element: CanvasElement, template: DesignTemplate): CanvasElement {
  const has = (list: { id: string }[] | undefined, id: string | undefined) => Boolean(id && list?.some(item => item.id === id));
  const drop: string[] = [];
  if (element.type === "text" && element.textStyleId && !has(template.styles, element.textStyleId)) drop.push("textStyleId");
  if (element.componentId && !has(template.components, element.componentId)) drop.push("componentId", "componentInstanceId", "componentSourceId");
  if (element.colorRoleId && !has(template.colorRoles, element.colorRoleId)) drop.push("colorRoleId");
  return drop.length ? without(element, drop) : element;
}

/**
 * A slide as a template page: a fresh copy with its own ids, named `name`,
 * its text and photo layers made slots, marked as a saved layout with its "use
 * when" line. Throws a SavedLayoutError for a slide that can't be one.
 */
export function layoutPageFrom(document: DesignDocument, pageId: string, layout: { name: string; useWhen: string }, template: DesignTemplate): DesignPage {
  const index = document.pages.findIndex(page => page.id === pageId), source = document.pages[index];
  if (!source) throw new SavedLayoutError("That slide isn't in this post anymore.", 404);
  if (document.continuousCanvas) throw new SavedLayoutError("This post is one wide canvas across its slides, so a slide can't be saved on its own.");
  const scene = source.canvas ?? sceneForPage(source, document.format);
  if (scene.elements.some(element => !element.hidden && element.type === "image" && element.span)) throw new SavedLayoutError(`Slide ${index + 1} holds half of a photo that runs across two slides, so it can't be saved on its own. Save a slide without a photo pair.`);
  const copy = duplicatePage({ ...source, canvas: scene }), copied = copy.canvas!.elements;
  // Copies get new ids, so flows that follow a layer by its id follow its copy.
  const ids = new Map(scene.elements.map((element, at) => [element.id, copied[at].id]));
  const follow = (anchor: string) => ids.get(anchor) ?? anchor;
  const taken = new Set(copied.flatMap(element => element.slot ? [element.slot] : []));
  const slotFor = (element: CanvasElement, fallback: string) => {
    if (element.slot) return element.slot;
    const base = slug(element.name ?? "") || fallback;
    let slot = base;
    for (let n = 2; taken.has(slot); n++) slot = `${base}-${n}`;
    taken.add(slot);
    return slot;
  };
  const scale = formatDimensions(document).width / 360;
  const editable = (element: CanvasElement) => !element.hidden && element.templateRole !== "brand" && !element.master;
  const largest = Math.max(0, ...copied.filter(element => element.type === "text" && editable(element)).map(element => (element as TextElement).fontSize));
  const elements = copied.map((original): CanvasElement => {
    let element = unlinked(original, template);
    if (element.smartFlow) element = { ...element, smartFlow: { ...element.smartFlow, after: follow(element.smartFlow.after), ...(element.smartFlow.hug ? { hug: { ...element.smartFlow.hug, after: follow(element.smartFlow.hug.after) } } : {}) } };
    if (!editable(element)) return element;
    if (element.type === "text") return textSlot(element, slotFor(element, "text"), element.listStyle && element.listStyle !== "none" ? "list" : element.fontSize >= largest * .8 ? "heading" : "body");
    if (element.type === "image") return photoSlot(element, slotFor(element, "photo"), scale);
    if (element.type === "shape" && element.imageFill) return frameSlot(element, slotFor(element, "photo"), scale);
    return element;
  });
  // The page's legacy photo and style come from the template, so no picture or words of the post stay behind there.
  const first = template.pages[0];
  const page: DesignPage = {
    ...copy, label: layout.name, canvas: { ...copy.canvas!, elements }, savedLayout: { useWhen: layout.useWhen },
    ...(first ? { image: { ...first.image, id: copy.image.id }, style: { ...first.style } } : {}),
  };
  delete page.publicDescription;
  return page;
}

/**
 * The library with slide `pageId` of `document` saved as a layout in the
 * post's template: a new last page, or in place of the saved layout that has
 * the same name. A built-in template's first copy remembers the built-in it
 * was made from. Throws a SavedLayoutError when it can't be saved.
 */
export function withSavedLayout(library: EditorLibrary, document: DesignDocument, request: SaveLayoutRequest): { library: EditorLibrary; saved: SavedLayoutResult } {
  const name = clean(request.name), useWhen = clean(request.useWhen);
  if (!name) throw new SavedLayoutError("Give the layout a name.");
  if (!useWhen) throw new SavedLayoutError("Say in a line when to use the layout.");
  if (name.length > MAX_LAYOUT_NAME) throw new SavedLayoutError(`A layout's name is at most ${MAX_LAYOUT_NAME} characters.`);
  if (useWhen.length > MAX_LAYOUT_USE_WHEN) throw new SavedLayoutError(`The "use when" line is at most ${MAX_LAYOUT_USE_WHEN} characters.`);
  if (document.purpose === "template") throw new SavedLayoutError("This is a template draft, so its pages are already the template's. Use Update template instead.");
  const template = templateFor(library, document);
  if (template.continuousCanvas) throw new SavedLayoutError(`${template.name} is one wide canvas, so it can't take a layout page.`);
  const post = formatDimensions(document), frame = formatDimensions(template);
  if (post.width !== frame.width || post.height !== frame.height) throw new SavedLayoutError(`This post is ${post.width}×${post.height} and ${template.name} is ${frame.width}×${frame.height}, so its slides can't be pages of that template.`);
  const page = layoutPageFrom(document, request.pageId, { name, useWhen }, template);
  // The template as people see it: a copy that still follows its built-in has the built-in's current pages, then its layouts.
  const own = library.templates.find(item => item.id === template.id), pages = template.pages;
  const same = pages.findIndex(item => sameName(item.label, name));
  if (same >= 0 && !isSavedLayout(pages[same])) throw new SavedLayoutError(`${template.name} already has a page called "${clean(pages[same].label ?? name)}". Pick another name for the layout.`, 409);
  if (same < 0 && pages.length >= MAX_TEMPLATE_PAGES) throw new SavedLayoutError(`${template.name} has ${MAX_TEMPLATE_PAGES} pages, the most a template holds. Delete a saved layout from it in the template editor, or save over one by giving its name.`, 413);
  if (!own && library.templates.length >= MAX_TEMPLATES) throw new SavedLayoutError(`The workspace has ${MAX_TEMPLATES} templates of its own, the most it holds. Delete one, then save the layout again.`, 413);
  if (same >= 0) page.id = pages[same].id;
  const nextPages = same >= 0 ? pages.map((item, at) => at === same ? page : item) : [...pages, page];
  // No copy yet means `template` is the built-in: its copy carries the built-in's fingerprint, so it keeps following it.
  const builtInFingerprint = own ? null : templateFingerprint(template);
  const next: DesignTemplate = own
    ? { ...template, ...(own.deletedAt ? { deletedAt: own.deletedAt } : {}), pages: nextPages }
    : { ...template, custom: true, ...(builtInFingerprint ? { builtInFingerprint } : {}), pages: nextPages };
  const templates = own ? library.templates.map(item => item.id === next.id ? next : item) : [next, ...library.templates];
  return {
    library: { ...library, templates },
    saved: { templateId: next.id, templateName: next.name, pageIndex: same >= 0 ? same : nextPages.length - 1, pageCount: nextPages.length, name, replaced: same >= 0 },
  };
}
