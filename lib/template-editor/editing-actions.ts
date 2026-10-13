import { applyTextStyle, updateTextStyle } from "./advanced";
import { canEditElement, isElementHidden } from "./commands";
import { sanitizeRichText, richTextToPlain, type CanvasElement, type CanvasGradient, type DesignDocument, type TextElement, type TextStyle } from "./model";

/** Save, propagate and link selection in one document transaction. */
export function saveSelectionTextStyle(design: DesignDocument, style: TextStyle, ids: readonly string[], target: { pageId: string; master?: boolean }): DesignDocument {
  const next = updateTextStyle(design, style);
  if (target.master) return next.masterScene ? { ...next, masterScene: applyTextStyle(next.masterScene, ids, style).scene } : next;
  if (next.continuousCanvas) return { ...next, continuousCanvas: applyTextStyle(next.continuousCanvas, ids, style).scene };
  return { ...next, pages: next.pages.map(page => page.id === target.pageId && page.canvas ? { ...page, canvas: applyTextStyle(page.canvas, ids, style).scene } : page) };
}

/** Each object retains its unrelated stops, including differing stop counts. */
export function editGradientStop(element: CanvasElement, index: number, patch: Partial<CanvasGradient["stops"][number]> | "remove" | "add"): CanvasElement {
  const gradient = element.gradient;
  if (!gradient || patch !== "add" && !gradient.stops[index]) return element;
  if (patch === "remove" && gradient.stops.length <= 2 || patch === "add" && gradient.stops.length >= 20) return element;
  const stops = patch === "add" ? [...gradient.stops, { color: "#ffffff", position: 50 }] : patch === "remove" ? gradient.stops.filter((_, i) => i !== index) : gradient.stops.map((stop, i) => i === index ? { ...stop, ...patch } : stop);
  return { ...element, gradient: { ...gradient, stops: stops.sort((a, b) => a.position - b.position) } };
}

export function changeStyledTextCase(element: TextElement, upper: boolean): TextElement {
  const change = (value: string) => upper ? value.toUpperCase() : value.toLowerCase();
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safe = sanitizeRichText(element.richText);
  const richText = safe === undefined ? undefined : sanitizeRichText(safe.split(/(<[^>]*>)/g).map(token => token.startsWith("<") ? token : escape(change(richTextToPlain(token)))).join(""));
  return { ...element, text: (richText === undefined ? change(element.text) : richTextToPlain(richText)).slice(0, 20_000), richText };
}

/** Transform handles have an actual keyboard action, with the same protection. */
export function keyboardTransform(scene: import("./model").CanvasScene, ids: readonly string[], key: string, amount: number, handle?: string): import("./model").CanvasScene {
  const selected = new Set(ids);
  const elements = scene.elements.map(element => {
    if (!selected.has(element.id) || (!canEditElement(scene, element, "position")||isElementHidden(scene,element))) return element;
    if (!handle) return { ...element, rotation: ((element.rotation + (key === "ArrowLeft" || key === "ArrowDown" ? -amount : amount))%360+540)%360-180 };
    const dx = key === "ArrowLeft" ? -amount : key === "ArrowRight" ? amount : 0, dy = key === "ArrowUp" ? -amount : key === "ArrowDown" ? amount : 0;
    const horizontal = handle.includes("w") ? -dx : handle.includes("e") ? dx : 0, vertical = handle.includes("n") ? -dy : handle.includes("s") ? dy : 0;
    const width = Math.max(1, Math.min(10000, element.width + horizontal)), height = Math.max(1, Math.min(10000, element.height + vertical));
    const localX = handle.includes("w") ? -(width - element.width) / 2 : (width - element.width) / 2;
    const localY = handle.includes("n") ? -(height - element.height) / 2 : (height - element.height) / 2;
    const radians = element.rotation * Math.PI / 180;
    return { ...element, width, height, x: element.x + element.width / 2 + localX * Math.cos(radians) - localY * Math.sin(radians) - width / 2, y: element.y + element.height / 2 + localX * Math.sin(radians) + localY * Math.cos(radians) - height / 2 };
  });
  return { ...scene, elements };
}
