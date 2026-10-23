import { canEditElement, isElementHidden, isElementLocked } from "./commands";
import { isChatGPTricksTemplate, mergeTemplateText, prepareSmartTemplate, type CanvasScene, type DesignDocument, type DesignTemplate, type TextElement } from "./model";

/** A renamed project still belongs to its source template. */
export function supportsSmartTemplate(design: DesignDocument, templates: readonly DesignTemplate[] = []): boolean {
  if (design.continuousCanvas) return false;
  return design.pages.some(page => page.canvas?.elements.some(element => element.type === "text" && element.smartText))
    || isChatGPTricksTemplate(design)
    || templates.some(template => (template.id === design.templateId || template.id === design.editingTemplateId) && isChatGPTricksTemplate(template));
}

/** Preview smart controls without migrating saved artwork merely by opening it. */
export function smartTemplatePage(design: DesignDocument, pageId: string, templates: readonly DesignTemplate[] = []): CanvasScene | null {
  if (!supportsSmartTemplate(design, templates)) return null;
  const index = design.pages.findIndex(page => page.id === pageId);
  if (index < 0 || !design.pages[index].canvas) return null;
  const original = design.pages[index].canvas!;
  if (original.elements.some(element => element.type === "text" && element.smartText)) {
    const height = 360 * (design.customSize?.height ?? (design.format === "story" ? 1920 : design.format === "square" ? 1080 : 1350)) / (design.customSize?.width ?? 1080);
    const elements = original.elements.map(element => {
      if (element.type !== "text" || element.smartText || !canEditElement(original, element, "content") || isElementHidden(original, element) || /^(#[\da-f]{6}|image)$/i.test(element.text.trim()) || element.name.startsWith("Instagram ·")) return element;
      const cover = index === 0 || /^cta/i.test(design.pages[index].label ?? "");
      return { ...element, smartText: {
        role: cover ? "cover" as const : "body" as const,
        lines: 0 as const,
        minFontSize: Math.min(element.fontSize, cover ? 18 : 11),
        maxFontSize: Math.min(500, element.fontSize * 1.65),
        maxHeight: Math.max(1, Math.min(Math.max(element.height, element.fontSize * element.lineHeight * 4), height - element.y - 20)),
      } };
    });
    return elements.every((element, position) => element === original.elements[position]) ? original : { ...original, elements };
  }
  const source: DesignTemplate = {
    id: design.id,
    name: "@chatgptricks",
    description: "",
    category: "My templates",
    format: design.format,
    customSize: design.customSize,
    // Keep the original page index so an interior slide does not become a cover.
    // Only this page needs a preview; all other artwork stays untouched.
    pages: design.pages.map((page, position) => position === index ? page : { ...page, canvas: undefined }),
  };
  const scene = prepareSmartTemplate(source).pages[index].canvas;
  if (!scene) return null;
  if (scene === original) return scene;
  // Conversion detaches content runs from their import groups. Keep protected
  // descendants as authored so an inherited lock or visibility is not lost.
  return { ...scene, elements: scene.elements.map(element => {
    const saved = original.elements.find(item => item.id === element.id);
    return saved && (isElementLocked(original, saved) || isElementHidden(original, saved)) ? saved : element;
  }) };
}

/** Map selected imported fragments to their retained smart-text identity. */
export function smartTemplateTextIds(design: DesignDocument, pageId: string, selectedIds: readonly string[], templates: readonly DesignTemplate[] = []): string[] {
  if (!selectedIds.length) return [];
  const scene = smartTemplatePage(design, pageId, templates);
  const original = design.pages.find(page => page.id === pageId)?.canvas;
  if (!scene || !original) return [];
  const sourceIds = new Map<string, string>();
  if (original.elements.some(element => element.type === "text" && element.smartText)) {
    for (const element of original.elements) sourceIds.set(element.id, element.id);
  } else mergeTemplateText(original, sourceIds);
  const selected = new Set(selectedIds.map(id => sourceIds.get(id) ?? id));
  return scene.elements.filter(element => element.type === "text" && element.smartText && selected.has(element.id)).map(element => element.id);
}

export type SmartTemplateTextPatch = { lines?: NonNullable<TextElement["smartText"]>["lines"]; text?: string };

/** Adopt smart layout as part of one deliberate, undoable content edit. */
export function updateSmartTemplateText(design: DesignDocument, pageId: string, elementId: string, patch: SmartTemplateTextPatch, templates: readonly DesignTemplate[] = []): DesignDocument {
  if (patch.lines === undefined && patch.text === undefined) return design;
  if (patch.lines !== undefined && ![0, 2, 3, 4].includes(patch.lines)) return design;
  const scene = smartTemplatePage(design, pageId, templates);
  const target = scene?.elements.find(element => element.id === elementId);
  if (!scene || target?.type !== "text" || !target.smartText || !canEditElement(scene, target, "content") || isElementHidden(scene, target)) return design;
  const changedText = patch.text !== undefined && patch.text !== target.text;
  const changedLines = patch.lines !== undefined && patch.lines !== target.smartText.lines;
  const original = design.pages.find(page => page.id === pageId)!.canvas;
  const originalTarget = original?.elements.find(element => element.id === elementId);
  if (original && originalTarget && (!canEditElement(original, originalTarget, "content") || isElementHidden(original, originalTarget))) return design;
  if (originalTarget?.type === "text" && originalTarget.smartText && !changedText && !changedLines) return design;
  const replacement: TextElement = {
    ...target,
    ...(changedText ? { text: patch.text!, richText: undefined, wordTextures: undefined } : {}),
    ...(patch.lines === undefined ? {} : { smartText: { ...target.smartText, lines: patch.lines } }),
  };
  const base = original?.elements.some(element => element.type === "text" && element.smartText) ? original : scene;
  return {
    ...design,
    pages: design.pages.map(page => page.id === pageId ? { ...page, canvas: { ...base, elements: base.elements.map(element => element.id === elementId ? replacement : element) } } : page),
  };
}
