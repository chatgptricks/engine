import type { CanvasScene } from "./model";
export { isChatGPTricksTemplate, prepareSmartTemplate, mergeTemplateText } from "./model";

/** Content editing cannot detach or restyle the fixed template skeleton. */
export function constrainSmartTemplate(previous: CanvasScene, next: CanvasScene): CanvasScene {
  if (!previous.elements.some(element => element.templateRole || element.type === "text" && element.smartText)) return next;
  const byId = new Map(next.elements.map(element => [element.id, element]));
  for (const original of previous.elements) {
    if (!original.templateRole && !(original.type === "text" && original.smartText)) continue;
    const changed = byId.get(original.id);
    if (!changed || changed.type !== original.type) { byId.set(original.id, original); continue; }
    if (original.type === "text" && original.smartText && changed.type === "text") {
      byId.set(original.id, { ...original, text: changed.text, richText: changed.richText, wordTextures: changed.wordTextures, smartText: { ...original.smartText, lines: changed.smartText?.lines ?? original.smartText.lines } });
    } else if (original.templateRole === "media") {
      byId.set(original.id, { ...changed, templateRole: original.templateRole, protected: original.protected, smartFlow: original.smartFlow, slot: original.slot, x: original.x, y: original.y, width: original.width, height: original.height, rotation: original.rotation, hidden: original.hidden, groupId: original.groupId });
    } else byId.set(original.id, original);
  }
  const elements = next.elements.map(element => byId.get(element.id)!);
  for (const original of previous.elements) if (!next.elements.some(element => element.id === original.id) && byId.has(original.id)) elements.push(byId.get(original.id)!);
  return { ...next, background: previous.background, elements };
}
