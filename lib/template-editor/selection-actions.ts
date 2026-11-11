import type { CanvasScene } from "./model";
import { canEditElement, isElementHidden, isElementLocked } from "./commands";

const MAX_ELEMENTS = 100;

/** What the small bar over a selection may do: lock or unlock, duplicate, delete. */
export function selectionActionState(scene: CanvasScene, selectedIds: readonly string[]) {
  const selected = scene.elements.filter(element => selectedIds.includes(element.id) && !isElementHidden(scene, element));
  const duplicable = selected.filter(element => !isElementLocked(scene, element));
  return {
    selected,
    locked: selected.length > 0 && selected.every(element => isElementLocked(scene, element)),
    // A lock inherited from a locked group is undone from that group, in Layers.
    canLock: selected.length > 0 && !selected.some(element => isElementLocked(scene, { ...element, locked: false })),
    canDuplicate: duplicable.length > 0 && scene.elements.length + duplicable.length <= MAX_ELEMENTS,
    canDelete: selected.some(element => canEditElement(scene, element, "delete")),
  };
}
