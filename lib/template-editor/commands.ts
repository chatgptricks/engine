import { createCanvasElement, duplicateTextTextureIds, parseShapeImageFill, sanitizeRichText, type CanvasElement, type CanvasScene, type CanvasGroup, type ImageElement, type ShapeImageFill, type ProtectedProperty } from "./model";

export const MAX_SCENE_ELEMENTS = 100;
export type ScenePoint = { x: number; y: number };
export type PageSize = { width: number; height: number };
export type LayerOrder = "forward" | "backward" | "front" | "back";
export type PageAlignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type SceneCommandResult = {
  scene: CanvasScene;
  selectedIds: string[];
  /** True when the page's 100-element limit prevented some or all insertion. */
  limited: boolean;
};

type VisualBounds = ScenePoint & PageSize;
const MIN_POSITION = -10_000;
const MAX_POSITION = 10_000;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const close = (left: number, right: number) => Math.abs(left - right) < 1e-8;

function selectedElements(scene: CanvasScene, ids: readonly string[], includeLocked = false): CanvasElement[] {
  const selected = new Set(ids);
  return scene.elements.filter(element => selected.has(element.id) && (includeLocked || !isElementLocked(scene, element)));
}

function ancestorGroups(scene: CanvasScene, groupId?: string): CanvasGroup[] {
  const map = new Map(scene.groups?.map(group => [group.id, group]) ?? []);
  const ancestors: CanvasGroup[] = [], seen = new Set<string>();
  while (groupId && !seen.has(groupId)) {
    seen.add(groupId); const group = map.get(groupId);
    if (!group) break;
    ancestors.push(group); groupId = group.parentId;
  }
  return ancestors;
}
export function isElementLocked(scene: CanvasScene, element: CanvasElement): boolean {
  return element.locked || ancestorGroups(scene, element.groupId).some(group => group.locked);
}
export function isElementHidden(scene: CanvasScene, element: CanvasElement): boolean {
  return Boolean(element.hidden) || ancestorGroups(scene, element.groupId).some(group => group.hidden);
}
export function canEditElement(scene: CanvasScene, element: CanvasElement, property: ProtectedProperty): boolean {
  return !isElementLocked(scene, element) && !element.protected?.includes(property);
}

export type FillShapeImageOptions = { sourceImageId?: string; preserveCrop?: boolean };
/** Atomically move a photo into a shape, keeping the target frame's identity and geometry.
 * A photo entering a new frame starts centered in cover mode; explicit fill descriptors
 * or preserveCrop keep the supplied crop. Reading protected content is never consumed. */
export function fillShapeWithImage(scene: CanvasScene, shapeId: string, image: ImageElement | ShapeImageFill, source?: string | FillShapeImageOptions): SceneCommandResult {
  const target = scene.elements.find(element => element.id === shapeId);
  const options = typeof source === "string" ? { sourceImageId: source } : source ?? {};
  if (!target || target.type !== "shape" || !canEditElement(scene, target, "content") || isElementHidden(scene, target)) return result(scene, []);
  const consumed = options.sourceImageId ? scene.elements.find(element => element.id === options.sourceImageId) : undefined;
  if (options.sourceImageId && (!consumed || consumed.type !== "image" || isElementHidden(scene, consumed) || !canEditElement(scene, consumed, "content") || !canEditElement(scene, consumed, "delete"))) return result(scene, [shapeId]);
  const photo = consumed?.type === "image" ? consumed : "type" in image && image.type === "image" ? image : undefined;
  const candidate = photo ? {
    src: photo.src,
    alt: photo.name,
    objectFit: options.preserveCrop ? photo.fit : "cover",
    cropX: options.preserveCrop ? photo.cropX : 50,
    cropY: options.preserveCrop ? photo.cropY : 50,
    cropScale: options.preserveCrop ? photo.cropScale ?? 1 : 1,
    ...(photo.flipX !== undefined ? { flipX: photo.flipX } : {}),
    ...(photo.flipY !== undefined ? { flipY: photo.flipY } : {}),
    ...(photo.intrinsicWidth !== undefined ? { intrinsicWidth: photo.intrinsicWidth } : {}),
    ...(photo.intrinsicHeight !== undefined ? { intrinsicHeight: photo.intrinsicHeight } : {}),
    ...(photo.publicAlt !== undefined ? {publicAlt:photo.publicAlt} : {}),
    ...(photo.previewSrc !== undefined ? { previewSrc: photo.previewSrc } : {}),
    ...(photo.directive !== undefined ? { directive: photo.directive } : {}),
    ...(photo.rightsNote !== undefined ? { rightsNote: photo.rightsNote } : {}),
    ...(photo.sourceUrl !== undefined ? { sourceUrl: photo.sourceUrl } : {}),
    ...(photo.provenance !== undefined ? { provenance: structuredClone(photo.provenance) } : {}),
  } : image;
  const imageFill = parseShapeImageFill(candidate);
  if (!imageFill) throw new Error("Choose a valid photo URL and crop settings for this frame.");
  const live = options.sourceImageId ? removeSelection(scene, [options.sourceImageId]).scene : scene;
  return result({ ...live, elements: live.elements.map(element => element.id === shapeId ? { ...element, imageFill } : element) }, [shapeId]);
}

export function removeShapeImageFill(scene: CanvasScene, shapeId: string): SceneCommandResult {
  const target = scene.elements.find(element => element.id === shapeId);
  if (!target || target.type !== "shape" || !target.imageFill || !canEditElement(scene, target, "content") || isElementHidden(scene, target)) return result(scene, []);
  const replacement = { ...target }; delete replacement.imageFill;
  return result({ ...scene, elements: scene.elements.map(element => element.id === shapeId ? replacement : element) }, [shapeId]);
}

/** Strip local texture references while retaining font, color and emphasis markup. */
export function clearRichTextureRefs(value: string | undefined): string | undefined {
  const safe = value === undefined ? undefined : sanitizeRichText(value);
  return safe?.replace(/\sdata-texture-id="[a-zA-Z0-9_-]+"/g, "");
}

export function applyTextTexture(scene: CanvasScene, ids: readonly string[], texture: ShapeImageFill | null): SceneCommandResult {
  const parsed = texture === null ? null : parseShapeImageFill(texture);
  if (texture !== null && !parsed) throw new Error("Choose a valid photo URL and crop settings for this text texture.");
  const selection = new Set(ids);
  let changed = false;
  const elements = scene.elements.map(element => {
    if (element.type !== "text" || !selection.has(element.id) || isElementHidden(scene, element) || !canEditElement(scene, element, "content") || !canEditElement(scene, element, "style")) return element;
    const copy = { ...element };
    delete copy.wordTextures;
    if (element.richText !== undefined) copy.richText = clearRichTextureRefs(element.richText);
    if (parsed) copy.textureFill = structuredClone(parsed);
    else delete copy.textureFill;
    changed = true;
    return copy;
  });
  return result(changed ? { ...scene, elements } : scene, ids);
}

export type ElementSnapshot = CanvasElement[] & { groups?: CanvasGroup[]; origin?: ScenePoint };

function result(scene: CanvasScene, ids: readonly string[], limited = false): SceneCommandResult {
  const selected = new Set(ids);
  return { scene, selectedIds: scene.elements.filter(element => selected.has(element.id)).map(element => element.id), limited };
}

/** Rotation-aware visual bounds, rather than the unrotated CSS box. */
function visualBounds(elements: readonly CanvasElement[]): VisualBounds {
  const boxes = elements.map(element => {
    const radians = element.rotation * Math.PI / 180;
    const width = Math.abs(element.width * Math.cos(radians)) + Math.abs(element.height * Math.sin(radians));
    const height = Math.abs(element.width * Math.sin(radians)) + Math.abs(element.height * Math.cos(radians));
    return { x: element.x + (element.width - width) / 2, y: element.y + (element.height - height) / 2, width, height };
  });
  const x = Math.min(...boxes.map(box => box.x));
  const y = Math.min(...boxes.map(box => box.y));
  return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
}

/** Clamp one shared translation so relative offsets survive at model limits. */
function boundedTranslation(elements: readonly CanvasElement[], requested: ScenePoint): ScenePoint {
  const minimumX = Math.min(...elements.map(element => element.x));
  const maximumX = Math.max(...elements.map(element => element.x));
  const minimumY = Math.min(...elements.map(element => element.y));
  const maximumY = Math.max(...elements.map(element => element.y));
  return {
    x: clamp(requested.x, MIN_POSITION - minimumX, MAX_POSITION - maximumX),
    y: clamp(requested.y, MIN_POSITION - minimumY, MAX_POSITION - maximumY),
  };
}

/** A detached snapshot in stacking order. Copying a locked layer is allowed. */
export function copySelection(scene: CanvasScene, ids: readonly string[], isolationGroupId?: string, origin?: ScenePoint): ElementSnapshot {
  const elements: ElementSnapshot = structuredClone(selectedElements(scene, scopeSelection(scene, ids, isolationGroupId), true));
  const groups = new Map(elements.flatMap(element => {
    const ancestors = ancestorGroups(scene, element.groupId);
    const isolation = ancestors.findIndex(group => group.id === isolationGroupId);
    return (isolationGroupId ? ancestors.slice(0, isolation) : ancestors).map(group => [group.id, group] as const);
  }));
  if (isolationGroupId) {
    for (const element of elements) if (element.groupId === isolationGroupId) delete element.groupId;
    for (const [id, group] of groups) if (group.parentId === isolationGroupId) groups.set(id, { ...group, parentId: undefined });
  }
  if (groups.size) elements.groups = structuredClone(Array.from(groups.values()));
  if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) elements.origin = { ...origin };
  return elements;
}

function insertCopies(
  scene: CanvasScene,
  snapshot: readonly CanvasElement[],
  position: ScenePoint | undefined,
  previousSelection: readonly string[],
  targetOrigin?: ScenePoint,
): SceneCommandResult {
  if (!snapshot.length || (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y)))) {
    return result(scene, previousSelection);
  }
  const capacity = Math.max(0, MAX_SCENE_ELEMENTS - scene.elements.length);
  const limited = snapshot.length > capacity;
  if (!capacity) return result(scene, previousSelection, limited);
  const originals = structuredClone(snapshot.slice(0, capacity));
  const bounds = visualBounds(originals);
  const sourceOrigin = (snapshot as ElementSnapshot).origin ?? { x: 0, y: 0 };
  const originDelta = targetOrigin ? { x: targetOrigin.x - sourceOrigin.x, y: targetOrigin.y - sourceOrigin.y } : { x: 0, y: 0 };
  if (!Number.isFinite(originDelta.x) || !Number.isFinite(originDelta.y)) return result(scene, previousSelection);
  const delta = boundedTranslation(originals, position ? { x: position.x - bounds.x, y: position.y - bounds.y } : { x: originDelta.x + 12, y: originDelta.y + 12 });
  const copies = originals.map(element => duplicateTextTextureIds(createCanvasElement(element.type, {
    ...element,
    name: `${element.name.slice(0, 195)} copy`,
    locked: false,
    x: element.x + delta.x,
    y: element.y + delta.y,
    ...(element.clipBounds ? { clipBounds: { ...element.clipBounds, x: element.clipBounds.x + originDelta.x, y: element.clipBounds.y + originDelta.y } } : {}),
  })));
  const sourceGroups = (snapshot as ElementSnapshot).groups ?? [];
  const neededGroups = new Set(originals.flatMap(element => ancestorGroups({ ...scene, groups: sourceGroups }, element.groupId).map(group => group.id)));
  const groupIds = new Map(sourceGroups.filter(group => neededGroups.has(group.id)).map(group => [group.id, crypto.randomUUID()]));
  const groups = sourceGroups.filter(group => neededGroups.has(group.id)).map(group => ({ ...structuredClone(group), id: groupIds.get(group.id)!, locked: false, ...(group.parentId ? { parentId: groupIds.get(group.parentId) } : {}) }));
  const instanceIds = new Map<string, string>();
  for (const copy of copies) {
    if (copy.groupId) { const id = groupIds.get(copy.groupId); if (id) copy.groupId = id; else delete copy.groupId; }
    if (copy.componentInstanceId) {
      if (!instanceIds.has(copy.componentInstanceId)) instanceIds.set(copy.componentInstanceId, crypto.randomUUID());
      copy.componentInstanceId = instanceIds.get(copy.componentInstanceId)!;
    }
  }
  return { scene: { ...scene, elements: [...scene.elements, ...copies], ...(groups.length ? { groups: [...(scene.groups ?? []), ...groups] } : {}) }, selectedIds: copies.map(element => element.id), limited };
}

/** Duplicates only unlocked layers, with fresh IDs and a default 12px offset. */
export function duplicateSelection(scene: CanvasScene, ids: readonly string[], position?: ScenePoint, isolationGroupId?: string): SceneCommandResult {
  return insertCopies(scene, copySelection(scene, selectedElements(scene, ids).map(element => element.id), isolationGroupId), position, ids);
}

/** Places the copied group's visual top-left at position, or offsets by 12px.
 * Originals (including copied locked layers) remain untouched; new copies are
 * unlocked. A partial paste retains the source's stacking order. */
export function pasteSelection(scene: CanvasScene, snapshot: readonly CanvasElement[], position?: ScenePoint, targetOrigin?: ScenePoint): SceneCommandResult {
  return insertCopies(scene, snapshot, position, [], targetOrigin);
}

export function removeSelection(scene: CanvasScene, ids: readonly string[]): SceneCommandResult {
  const removable = new Set(selectedElements(scene, ids).filter(element => canEditElement(scene, element, "delete")).map(element => element.id));
  if (!removable.size) return result(scene, ids);
  const next = { ...scene, elements: scene.elements.filter(element => !removable.has(element.id)) };
  const usedGroups = new Set(next.elements.flatMap(element => ancestorGroups(next, element.groupId).map(group => group.id)));
  if (next.groups) next.groups = next.groups.filter(group => usedGroups.has(group.id));
  return result(next, ids);
}

export function setSelectionLocked(scene: CanvasScene, ids: readonly string[], locked: boolean): SceneCommandResult {
  const selected = new Set(ids);
  let changed = false;
  const elements = scene.elements.map(element => {
    if (!selected.has(element.id) || element.locked === locked) return element;
    changed = true;
    return { ...element, locked };
  });
  return result(changed ? { ...scene, elements } : scene, ids);
}

/** Elements are ordered back to front. Selected unlocked blocks move one
 * neighboring step, or to the requested end; both groups keep stable order. */
export function reorderSelection(scene: CanvasScene, ids: readonly string[], order: LayerOrder): SceneCommandResult {
  const moving = new Set(selectedElements(scene, ids).map(element => element.id));
  if (!moving.size) return result(scene, ids);
  let elements = [...scene.elements];
  if (order === "front" || order === "back") {
    const selected = elements.filter(element => moving.has(element.id));
    const stationary = elements.filter(element => !moving.has(element.id));
    elements = order === "front" ? [...stationary, ...selected] : [...selected, ...stationary];
  } else if (order === "forward") {
    for (let index = elements.length - 2; index >= 0; index--) {
      if (moving.has(elements[index].id) && !moving.has(elements[index + 1].id)) {
        [elements[index], elements[index + 1]] = [elements[index + 1], elements[index]];
      }
    }
  } else {
    for (let index = 1; index < elements.length; index++) {
      if (moving.has(elements[index].id) && !moving.has(elements[index - 1].id)) {
        [elements[index], elements[index - 1]] = [elements[index - 1], elements[index]];
      }
    }
  }
  const changed = elements.some((element, index) => element !== scene.elements[index]);
  return result(changed ? { ...scene, elements } : scene, ids);
}

function alignmentOffset(bounds: VisualBounds, align: PageAlignment, page: PageSize): ScenePoint {
  if (align === "left") return { x: -bounds.x, y: 0 };
  if (align === "center") return { x: (page.width - bounds.width) / 2 - bounds.x, y: 0 };
  if (align === "right") return { x: page.width - bounds.width - bounds.x, y: 0 };
  if (align === "top") return { x: 0, y: -bounds.y };
  if (align === "middle") return { x: 0, y: (page.height - bounds.height) / 2 - bounds.y };
  return { x: 0, y: page.height - bounds.height - bounds.y };
}

/** Align individual visible boxes to the page by default, matching the
 * inspector. Group mode aligns the full selection without changing offsets. */
export function alignSelection(
  scene: CanvasScene,
  ids: readonly string[],
  align: PageAlignment,
  page: PageSize,
  mode: "individual" | "group" = "individual",
): SceneCommandResult {
  const selected = selectedElements(scene, ids).filter(element => canEditElement(scene, element, "position"));
  if (!selected.length || !Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0) return result(scene, ids);
  const movable = new Set(selected.map(element => element.id));
  const groupOffset = mode === "group" ? boundedTranslation(selected, alignmentOffset(visualBounds(selected), align, page)) : null;
  let changed = false;
  const elements = scene.elements.map(element => {
    if (!movable.has(element.id)) return element;
    const delta = groupOffset ?? boundedTranslation([element], alignmentOffset(visualBounds([element]), align, page));
    if (close(delta.x, 0) && close(delta.y, 0)) return element;
    changed = true;
    return { ...element, x: element.x + delta.x, y: element.y + delta.y };
  });
  return result(changed ? { ...scene, elements } : scene, ids);
}

export type AlignmentOptions = {
  scope: "page" | "selection" | "key-object";
  page: PageSize & Partial<ScenePoint>;
  keyObjectId?: string;
  mode?: "individual" | "group";
};
export function alignSelectionTo(scene: CanvasScene, ids: readonly string[], align: PageAlignment, options: AlignmentOptions): SceneCommandResult {
  const selected = selectedElements(scene, ids).filter(element => canEditElement(scene, element, "position"));
  if (!selected.length) return result(scene, ids);
  const key = scene.elements.find(element => element.id === options.keyObjectId);
  const target = options.scope === "key-object" ? (key ? visualBounds([key]) : null) : options.scope === "selection" ? visualBounds(selected) : { x: options.page.x ?? 0, y: options.page.y ?? 0, width: options.page.width, height: options.page.height };
  if (!target || !Object.values(target).every(Number.isFinite) || target.width <= 0 || target.height <= 0) return result(scene, ids);
  const offset = (bounds: VisualBounds) => {
    const relative = { ...bounds, x: bounds.x - target.x, y: bounds.y - target.y };
    return alignmentOffset(relative, align, target);
  };
  const groupOffset = options.mode === "group" ? boundedTranslation(selected, offset(visualBounds(selected))) : undefined;
  const selectedIds = new Set(selected.map(element => element.id));
  const elements = scene.elements.map(element => {
    if (!selectedIds.has(element.id) || (options.scope === "key-object" && element.id === key?.id)) return element;
    const delta = groupOffset ?? boundedTranslation([element], offset(visualBounds([element])));
    return close(delta.x, 0) && close(delta.y, 0) ? element : { ...element, x: element.x + delta.x, y: element.y + delta.y };
  });
  return result(elements.some((element, index) => element !== scene.elements[index]) ? { ...scene, elements } : scene, ids);
}

export function distributeSelection(scene: CanvasScene, ids: readonly string[], axis: "horizontal" | "vertical", mode: "centers" | "gaps" = "gaps", gap?: number): SceneCommandResult {
  const selected = selectedElements(scene, ids).filter(element => canEditElement(scene, element, "position"));
  if (selected.length < 3 && gap === undefined || selected.length < 2 || (gap !== undefined && (!Number.isFinite(gap) || Math.abs(gap) > 10_000))) return result(scene, ids);
  const coordinate = axis === "horizontal" ? "x" : "y", extent = axis === "horizontal" ? "width" : "height";
  const sorted = selected.map(element => ({ element, box: visualBounds([element]) })).sort((a, b) => a.box[coordinate] - b.box[coordinate]);
  const first = sorted[0].box, last = sorted.at(-1)!.box;
  const automaticGap = (last[coordinate] + last[extent] - first[coordinate] - sorted.reduce((sum, item) => sum + item.box[extent], 0)) / (sorted.length - 1);
  const firstCenter = first[coordinate] + first[extent] / 2;
  const centerStep = (last[coordinate] + last[extent] / 2 - firstCenter) / (sorted.length - 1);
  let nextPosition = first[coordinate];
  const positions = new Map<string, number>();
  sorted.forEach((item, index) => {
    const wanted = mode === "centers" ? firstCenter + centerStep * index - item.box[extent] / 2 : nextPosition;
    positions.set(item.element.id, wanted - item.box[coordinate]);
    nextPosition += item.box[extent] + (gap ?? automaticGap);
  });
  const elements = scene.elements.map(element => {
    const delta = positions.get(element.id);
    if (delta === undefined || close(delta, 0)) return element;
    return { ...element, [coordinate]: clamp(element[coordinate] + delta, MIN_POSITION, MAX_POSITION) };
  });
  return result(elements.some((element, index) => element !== scene.elements[index]) ? { ...scene, elements } : scene, ids);
}

export function matchSelectionSize(scene: CanvasScene, ids: readonly string[], mode: "width" | "height" | "both", referenceId?: string): SceneCommandResult {
  const selected = selectedElements(scene, ids).filter(element => canEditElement(scene, element, "position"));
  const reference = scene.elements.find(element => element.id === referenceId) ?? selected[0];
  if (!reference || selected.length < 2) return result(scene, ids);
  const selectedIds = new Set(selected.map(element => element.id));
  const elements = scene.elements.map(element => selectedIds.has(element.id) && element.id !== reference.id ? { ...element, ...(mode !== "height" ? { width: reference.width } : {}), ...(mode !== "width" ? { height: reference.height } : {}) } : element);
  return result({ ...scene, elements }, ids);
}

export type ElementAppearance = { type: CanvasElement["type"]; properties: Record<string, unknown> };
const APPEARANCE_BASE = ["opacity", "gradient", "shadow", "blur", "blendMode", "strokeDash", "colorRoleId"] as const;
const APPEARANCE_TYPE = {
  text: ["font", "fontSize", "fontWeight", "italic", "underline", "color", "align", "lineHeight", "letterSpacing", "verticalAlign", "padding", "paragraphSpacing", "strikethrough", "listStyle", "textStyleId", "textureFill"],
  image: ["fit", "cropScale", "cropX", "cropY", "radius", "mask", "flipX", "flipY"],
  shape: ["fill", "stroke", "strokeWidth", "strokeAlign", "radius", "imageFill"],
};
export function copyAppearance(element: CanvasElement): ElementAppearance {
  const properties: Record<string, unknown> = {};
  for (const key of [...APPEARANCE_BASE, ...APPEARANCE_TYPE[element.type]]) properties[key] = structuredClone((element as unknown as Record<string, unknown>)[key]);
  return { type: element.type, properties };
}
export function pasteAppearance(scene: CanvasScene, ids: readonly string[], appearance: ElementAppearance): SceneCommandResult {
  const selection = new Set(ids);
  const elements = scene.elements.map(element => {
    if (!selection.has(element.id) || !canEditElement(scene, element, "style")) return element;
    const copy = { ...element } as CanvasElement;
    for (const key of [...APPEARANCE_BASE, ...(element.type === appearance.type ? APPEARANCE_TYPE[element.type] : [])]) {
      if (["imageFill", "textureFill"].includes(key) && (!canEditElement(scene, element, "content") || isElementHidden(scene, element))) continue;
      const value = appearance.properties[key];
      if (["imageFill", "textureFill"].includes(key) && value !== undefined) {
        const fill = parseShapeImageFill(value);
        if (!fill) throw new Error("The copied photo appearance is invalid.");
        Object.assign(copy, { [key]: fill });
        continue;
      }
      if (value === undefined) delete (copy as unknown as Record<string, unknown>)[key];
      else Object.assign(copy, { [key]: structuredClone(value) });
    }
    return copy;
  });
  return result({ ...scene, elements }, ids);
}

export function expandGroupSelection(scene: CanvasScene, ids: readonly string[], isolationGroupId?: string): string[] {
  const selected = new Set(scopeSelection(scene, ids, isolationGroupId));
  const groups = new Set(scene.elements.filter(element => selected.has(element.id)).flatMap(element => {
    const ancestors = ancestorGroups(scene, element.groupId);
    if (!ancestors.length) return [];
    if (!isolationGroupId) return [ancestors.at(-1)!.id];
    const index = ancestors.findIndex(group => group.id === isolationGroupId);
    return index > 0 ? [ancestors[index - 1].id] : [];
  }));
  return scopeSelection(scene, scene.elements.filter(element => selected.has(element.id) || ancestorGroups(scene, element.groupId).some(group => groups.has(group.id))).map(element => element.id), isolationGroupId);
}
/** Apply the same group boundary to selection, menus, shortcuts and async edits. */
export function scopeSelection(scene: CanvasScene, ids: readonly string[], isolationGroupId?: string): string[] {
  const selected = new Set(ids);
  return scene.elements.filter(element => selected.has(element.id) && (!isolationGroupId || ancestorGroups(scene, element.groupId).some(group => group.id === isolationGroupId))).map(element => element.id);
}

/** Keep a command confined to the isolated subtree, including added layers and groups.
 * Outside layers retain their identities and relative stacking order. */
export function constrainSceneToIsolation(scene: CanvasScene, next: CanvasScene, isolationGroupId?: string): CanvasScene {
  if (!isolationGroupId) return next;
  const isolation = scene.groups?.find(group => group.id === isolationGroupId);
  if (!isolation) return scene;
  const allowedIds = new Set(scopeSelection(scene, scene.elements.map(element => element.id), isolationGroupId));
  const previousIds = new Set(scene.elements.map(element => element.id));
  const insideGroups = new Set(scene.groups?.filter(group => ancestorGroups(scene, group.id).some(parent => parent.id === isolationGroupId)).map(group => group.id));
  const previousGroups = new Set(scene.groups?.map(group => group.id));
  const nextGroups = next.groups ?? [];
  const nextIsolation = nextGroups.find(group => group.id === isolationGroupId);
  const editableGroups = nextGroups.filter(group => group.id !== isolationGroupId && (insideGroups.has(group.id) || !previousGroups.has(group.id)));
  const groupIds = new Set([isolationGroupId, ...editableGroups.map(group => group.id)]);
  const groups = [
    ...(scene.groups ?? []).filter(group => !insideGroups.has(group.id) || group.id === isolationGroupId).map(group => group.id === isolationGroupId && nextIsolation ? { ...nextIsolation, parentId: isolation.parentId } : group),
    ...editableGroups.map(group => ({ ...group, parentId: group.parentId && groupIds.has(group.parentId) ? group.parentId : isolationGroupId })),
  ];
  const scoped = next.elements.filter(element => allowedIds.has(element.id) || !previousIds.has(element.id)).map(element => ({
    ...element,
    groupId: element.groupId && groupIds.has(element.groupId) ? element.groupId : isolationGroupId,
  }));
  const lastInside = scene.elements.findLastIndex(element => allowedIds.has(element.id));
  const elements: CanvasElement[] = [];
  let cursor = 0;
  scene.elements.forEach((element, index) => {
    if (!allowedIds.has(element.id)) elements.push(element);
    else if (cursor < scoped.length) elements.push(scoped[cursor++]);
    if (index === lastInside) while (cursor < scoped.length) elements.push(scoped[cursor++]);
  });
  if (lastInside < 0) elements.push(...scoped);
  return { ...next, elements, groups };
}

export function groupSelection(scene: CanvasScene, ids: readonly string[], name = "Group", isolationGroupId?: string): SceneCommandResult {
  const selected = selectedElements(scene, expandGroupSelection(scene, ids, isolationGroupId)).filter(element => canEditElement(scene, element, "position"));
  if (selected.length < 2 || (scene.groups?.length ?? 0) >= 100) return result(scene, ids);
  const group: CanvasGroup = { id: crypto.randomUUID(), name: name.trim().slice(0, 200) || "Group", ...(isolationGroupId ? { parentId: isolationGroupId } : {}) };
  const selectedIds = new Set(selected.map(element => element.id));
  const roots = new Set(selected.flatMap(element => {
    const ancestors = ancestorGroups(scene, element.groupId);
    const index = ancestors.findIndex(parent => parent.id === isolationGroupId);
    return (isolationGroupId ? index > 0 ? ancestors[index - 1].id : undefined : ancestors.at(-1)?.id) ?? [];
  }));
  return result({ ...scene, groups: [...(scene.groups ?? []).map(existing => roots.has(existing.id) ? { ...existing, parentId: group.id } : existing), group], elements: scene.elements.map(element => selectedIds.has(element.id) && (!element.groupId || element.groupId === isolationGroupId) ? { ...element, groupId: group.id } : element) }, Array.from(selectedIds));
}
export function ungroupSelection(scene: CanvasScene, ids: readonly string[], isolationGroupId?: string): SceneCommandResult {
  const selected = new Set(scopeSelection(scene, ids, isolationGroupId));
  const groups = new Set(scene.elements.filter(element => selected.has(element.id) && canEditElement(scene, element, "position")).flatMap(element => {
    const ancestors = ancestorGroups(scene, element.groupId);
    const index = ancestors.findIndex(parent => parent.id === isolationGroupId);
    return (isolationGroupId ? index > 0 ? ancestors[index - 1].id : undefined : ancestors.at(-1)?.id) ?? [];
  }));
  if (!groups.size) return result(scene, ids);
  return result({ ...scene, groups: scene.groups?.filter(group => !groups.has(group.id)).map(group => group.parentId && groups.has(group.parentId) ? { ...group, parentId: isolationGroupId } : group), elements: scene.elements.map(element => element.groupId && groups.has(element.groupId) ? { ...element, groupId: isolationGroupId } : element) }, expandGroupSelection(scene, ids, isolationGroupId));
}
export function setGroupLocked(scene: CanvasScene, groupId: string, locked: boolean): SceneCommandResult {
  return result({ ...scene, groups: scene.groups?.map(group => group.id === groupId ? { ...group, locked } : group) }, []);
}
export function setGroupHidden(scene: CanvasScene, groupId: string, hidden: boolean): SceneCommandResult {
  return result({ ...scene, groups: scene.groups?.map(group => group.id === groupId ? { ...group, hidden } : group) }, []);
}

export function transformSelection(scene: CanvasScene, ids: readonly string[], transform: { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number }, pivot?: ScenePoint): SceneCommandResult {
  const selected = selectedElements(scene, ids).filter(element => canEditElement(scene, element, "position"));
  if (!selected.length || Object.values(transform).some(value => !Number.isFinite(value)) || (transform.scaleX !== undefined && transform.scaleX <= 0) || (transform.scaleY !== undefined && transform.scaleY <= 0)) return result(scene, ids);
  const bounds = visualBounds(selected), origin = pivot ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const sx = transform.scaleX ?? 1, sy = transform.scaleY ?? sx, angle = (transform.rotation ?? 0) * Math.PI / 180;
  const selection = new Set(selected.map(element => element.id));
  const elements = scene.elements.map(element => {
    if (!selection.has(element.id)) return element;
    const dx = (element.x + element.width / 2 - origin.x) * sx, dy = (element.y + element.height / 2 - origin.y) * sy;
    const width = clamp(element.width * sx, 1, 10_000), height = clamp(element.height * sy, 1, 10_000);
    return { ...element, x: clamp(origin.x + dx * Math.cos(angle) - dy * Math.sin(angle) - width / 2 + (transform.x ?? 0), MIN_POSITION, MAX_POSITION), y: clamp(origin.y + dx * Math.sin(angle) + dy * Math.cos(angle) - height / 2 + (transform.y ?? 0), MIN_POSITION, MAX_POSITION), width, height, rotation: clamp(element.rotation + (transform.rotation ?? 0), -3600, 3600), ...(element.type === "text" ? { fontSize: clamp(element.fontSize * Math.min(sx, sy), 1, 500) } : {}) };
  });
  return result({ ...scene, elements }, ids);
}
