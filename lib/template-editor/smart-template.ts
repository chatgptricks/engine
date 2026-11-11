import type { CanvasScene } from "./model";
import { canEditElement, isFade, isXPostText } from "./commands";
export { isChatGPTricksTemplate, prepareSmartTemplate, mergeTemplateText } from "./model";

/** Content editing cannot detach or restyle the fixed template skeleton. */
export function constrainSmartTemplate(previous: CanvasScene, next: CanvasScene): CanvasScene {
  if (!previous.elements.some(element => element.templateRole || element.type === "text" && element.smartText)) return next;
  const byId = new Map(next.elements.map(element => [element.id, element]));
  for (const original of previous.elements) {
    if (!original.templateRole && !(original.type === "text" && original.smartText)) continue;
    const changed = byId.get(original.id);
    // A picture or fade the person deleted stays deleted.
    if (!changed && canEditElement(previous, original, "delete")) continue;
    if (!changed || changed.type !== original.type) { byId.set(original.id, original); continue; }
    if (original.type === "text" && original.smartText && changed.type === "text") {
      // The words, their look, their line count and a size the person set are
      // theirs; the slot (place, box, role), the fit's base size and the rest of the
      // rule are the template's. The fitted size must not feed the next fit, or
      // the layout never settles (a crash on X post pages, 2026-11-11).
      const smartText = { ...original.smartText, lines: changed.smartText?.lines ?? original.smartText.lines };
      if (changed.smartText?.fontSize !== undefined) smartText.fontSize = changed.smartText.fontSize; else delete smartText.fontSize;
      if (isXPostText(original)) byId.set(original.id, { ...original, text: changed.text, richText: changed.richText, wordTextures: changed.wordTextures, smartText });
      else byId.set(original.id, { ...changed, id: original.id, name: original.name, x: original.x, y: original.y, width: original.width, height: original.height, fontSize: original.fontSize, autoFitFontSize: original.autoFitFontSize, rotation: original.rotation, hidden: original.hidden, groupId: original.groupId, locked: original.locked, slot: original.slot, templateRole: original.templateRole, protected: original.protected, smartFlow: original.smartFlow, smartCenter: original.smartCenter, textMode: original.textMode, smartText });
    } else if (original.templateRole === "media") {
      // A spanning photo moves and resizes with its seam (spanning-photos.ts keeps it in place).
      const geometry = original.type === "image" && original.span && changed.type === "image" && changed.span ? changed : original;
      byId.set(original.id, { ...changed, templateRole: original.templateRole, protected: original.protected, smartFlow: original.smartFlow, slot: original.slot, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotation: geometry.rotation, hidden: original.hidden, groupId: original.groupId });
    } else if (isFade(original) && canEditElement(previous, original, "position")) {
      // A fade can be moved and resized; nothing else about it changes.
      byId.set(original.id, { ...original, x: changed.x, y: changed.y, width: changed.width, height: changed.height });
    } else byId.set(original.id, original);
  }
  const elements = next.elements.map(element => byId.get(element.id)!);
  for (const original of previous.elements) if (!next.elements.some(element => element.id === original.id) && byId.has(original.id)) elements.push(byId.get(original.id)!);
  return { ...next, background: previous.background, elements };
}
