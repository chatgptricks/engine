import {
  createDesign, duplicateCanvasScene, sceneForPage, formatDimensions, parseLibrary, EMPTY_LIBRARY, sanitizeRichText, parseShapeImageFill,
  duplicatePage, createCanvasElement,
  type CanvasScene, type CanvasElement, type DesignDocument, type DesignPage, type DesignTemplate,
  type TextElement, type TextStyle, type ReusableComponent, type DesignVersion,
} from "./model";
import { copySelection, canEditElement, isElementHidden, groupSelection, type SceneCommandResult, type ScenePoint } from "./commands";
import { sliceSceneForPage } from "./continuous-carousel";
import { sceneVisualBounds, elementVisualBounds, elementIntersectsCanvas } from "./canvas-geometry";
export { isElementHidden, isElementLocked, canEditElement, fillShapeWithImage, removeShapeImageFill, applyTextTexture, clearRichTextureRefs } from "./commands";

type CompositionSource = Pick<DesignDocument, "format" | "pages" | "continuousCanvas" | "masterScene" | "customSize">;

/** Master artwork stays below page artwork and is protected in ordinary editing. */
export function composeScene(design: CompositionSource, page: DesignPage | number): CanvasScene {
  const index = typeof page === "number" ? page : design.pages.findIndex(item => item.id === page.id);
  const target = design.pages[index];
  if (!target) throw new Error("This page does not belong to the design.");
  const content = design.continuousCanvas ? sliceSceneForPage(design, target) : sceneForPage(target, design.format);
  if (!design.masterScene || target.useMaster === false) return content;
  const groupIds = new Map(design.masterScene.groups?.map(group => [group.id, `master-${group.id}`]) ?? []);
  const master = design.masterScene.elements.map(element => ({ ...element, id: `master-${element.id}`, master: true, locked: true, ...(element.groupId ? { groupId: groupIds.get(element.groupId) } : {}) }));
  return { ...content, groups: [...(design.masterScene.groups ?? []).map(group => ({ ...group, id: groupIds.get(group.id)!, ...(group.parentId ? { parentId: groupIds.get(group.parentId) } : {}) })), ...(content.groups ?? [])], elements: [...master, ...content.elements] };
}

const STYLE_KEYS = ["font", "fontSize", "fontWeight", "italic", "underline", "color", "align", "lineHeight", "letterSpacing", "verticalAlign", "padding", "paragraphSpacing", "strikethrough", "listStyle", "textureFill"] as const;
export function textStyleFromElement(element: TextElement, name = "Text style"): TextStyle {
  const style: Record<string, unknown> = { id: crypto.randomUUID(), name: name.trim().slice(0, 200) || "Text style" };
  for (const key of STYLE_KEYS) if (element[key] !== undefined) style[key] = structuredClone(element[key]);
  return style as TextStyle;
}
export function applyTextStyle(scene: CanvasScene, ids: readonly string[], style: TextStyle): SceneCommandResult {
  const selected = new Set(ids);
  const elements = scene.elements.map(element => {
    if (element.type !== "text" || !selected.has(element.id) || !canEditElement(scene, element, "style")) return element;
    const copy = { ...element, textStyleId: style.id };
    for (const key of STYLE_KEYS) {
      if (key === "textureFill" && (!canEditElement(scene, element, "content") || isElementHidden(scene, element))) continue;
      if (style[key] === undefined) delete (copy as unknown as Record<string, unknown>)[key];
      else Object.assign(copy, { [key]: structuredClone(style[key]) });
    }
    return copy;
  });
  return { scene: { ...scene, elements }, selectedIds: elements.filter(element => selected.has(element.id)).map(element => element.id), limited: false };
}
function mapScenes(design: DesignDocument, recipe: (scene: CanvasScene, canvasWidth: number) => CanvasScene): DesignDocument {
  return { ...design, pages: design.pages.map(page => ({ ...page, canvas: recipe(page.canvas ?? sceneForPage(page, design.format), 360) })), ...(design.continuousCanvas ? { continuousCanvas: recipe(design.continuousCanvas, 360 * design.pages.length) } : {}), ...(design.masterScene ? { masterScene: recipe(design.masterScene, 360) } : {}) };
}
export function updateTextStyle(design: DesignDocument, style: TextStyle): DesignDocument {
  const result = mapScenes(design, scene => {
    const matching = scene.elements.filter(element => element.type === "text" && element.textStyleId === style.id).map(element => element.id);
    return applyTextStyle(scene, matching, style).scene;
  });
  return { ...result, styles: [...(design.styles ?? []).filter(item => item.id !== style.id), structuredClone(style)] };
}

export function updateColorRole(design: DesignDocument, role: { id: string; name: string; color: string }): DesignDocument {
  const result = mapScenes(design, scene => ({ ...scene, elements: scene.elements.map(element => element.colorRoleId === role.id && canEditElement(scene, element, "style") ? element.type === "text" ? { ...element, color: role.color } : element.type === "shape" ? { ...element, fill: role.color } : element : element) }));
  return { ...result, colorRoles: [...(design.colorRoles ?? []).filter(item => item.id !== role.id), { ...role }] };
}

export function removeColorRole(design: DesignDocument, id: string): DesignDocument {
  const result = mapScenes(design, scene => ({ ...scene, elements: scene.elements.map(element => element.colorRoleId === id ? { ...element, colorRoleId: undefined } : element) }));
  return { ...result, colorRoles: (design.colorRoles ?? []).filter(role => role.id !== id) };
}

export function componentFromSelection(scene: CanvasScene, ids: readonly string[], name = "Component"): ReusableComponent {
  const snapshot = copySelection(scene, ids);
  if (!snapshot.length) throw new Error("Select at least one element to create a component.");
  const content: CanvasScene = { background: "transparent", elements: snapshot, ...(snapshot.groups ? { groups: snapshot.groups } : {}) };
  const bounds = sceneVisualBounds(content)!;
  const normalized = { ...content, elements: content.elements.map(element => ({ ...element, x: element.x - bounds.x, y: element.y - bounds.y, ...(element.clipBounds ? { clipBounds: { ...element.clipBounds, x: element.clipBounds.x - bounds.x, y: element.clipBounds.y - bounds.y } } : {}) })) };
  return { id: crypto.randomUUID(), name: name.trim().slice(0, 200) || "Component", width: bounds.width, height: bounds.height, scene: normalized };
}
export function insertComponent(scene: CanvasScene, component: ReusableComponent, position: ScenePoint = { x: 24, y: 24 }): SceneCommandResult {
  if (scene.elements.length + component.scene.elements.length > 100 || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return { scene, selectedIds: [], limited: true };
  const copy = duplicateCanvasScene(component.scene), instanceId = crypto.randomUUID();
  let combined: CanvasScene = { ...scene, groups: [...(scene.groups ?? []), ...(copy.groups ?? [])], elements: [...scene.elements, ...copy.elements.map((element, index) => ({ ...element, x: element.x + position.x, y: element.y + position.y, ...(element.clipBounds ? { clipBounds: { ...element.clipBounds, x: element.clipBounds.x + position.x, y: element.clipBounds.y + position.y } } : {}), componentId: component.id, componentInstanceId: instanceId, componentSourceId: component.scene.elements[index].id }))] };
  const ids = copy.elements.map(element => element.id);
  if (ids.length > 1) combined = groupSelection(combined, ids, component.name).scene;
  return { scene: combined, selectedIds: ids, limited: false };
}
/** Replace linked artwork only; instance position and scale survive a component update. */
export function updateComponentInstances(design: DesignDocument, component: ReusableComponent): DesignDocument {
  const previousDefinition = design.components?.find(item => item.id === component.id);
  const wordAppearance = (element: TextElement) => {
    const resources = element.wordTextures ?? [];
    const ids = new Map(resources.map((texture, index) => [texture.id, index]));
    return JSON.stringify({ richText: element.richText?.replace(/data-texture-id="([a-zA-Z0-9_-]+)"/g, (attribute, id: string) => ids.has(id) ? `data-texture-id="resource-${ids.get(id)}"` : attribute), resources: resources.map(texture => { const copy = { ...texture }; delete (copy as Partial<typeof copy>).id; return copy; }) });
  };
  const result = mapScenes(design, scene => {
    const instances = new Set(scene.elements.filter(element => element.componentId === component.id && element.componentInstanceId).map(element => element.componentInstanceId!));
    let next = scene;
    for (const instance of instances) {
      const elements = next.elements.filter(element => element.componentInstanceId === instance);
      if (elements.some(element => !canEditElement(next, element, "style"))) continue;
      const bounds = sceneVisualBounds({ background: "transparent", elements })!;
      const copy = duplicateCanvasScene(component.scene);
      if (next.elements.length - elements.length + copy.elements.length > 100) throw new Error("Updating this component would exceed the page's 100-element limit.");
      const anchor = elements[0], oldAnchor = previousDefinition?.scene.elements.find(element => element.id === anchor.componentSourceId) ?? previousDefinition?.scene.elements[0];
      const sx = oldAnchor ? anchor.width / oldAnchor.width : bounds.width / component.width, sy = oldAnchor ? anchor.height / oldAnchor.height : bounds.height / component.height;
      const rotation = oldAnchor ? anchor.rotation - oldAnchor.rotation : 0, radians = rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
      const oldCenter = oldAnchor ? { x: (oldAnchor.x + oldAnchor.width / 2) * sx, y: (oldAnchor.y + oldAnchor.height / 2) * sy } : { x: 0, y: 0 };
      const origin = oldAnchor ? { x: anchor.x + anchor.width / 2 - cos * oldCenter.x + sin * oldCenter.y, y: anchor.y + anchor.height / 2 - sin * oldCenter.x - cos * oldCenter.y } : { x: bounds.x, y: bounds.y };
      const groupMap = new Map(next.groups?.map(group => [group.id, group]) ?? []);
      const ancestors = (id?: string) => { const result: string[] = [], seen = new Set<string>(); while (id && !seen.has(id)) { seen.add(id); result.push(id); id = groupMap.get(id)?.parentId; } return result; };
      const exclusiveGroups = new Set((next.groups ?? []).filter(group => { const members = next.elements.filter(element => ancestors(element.groupId).includes(group.id)); return members.length && members.every(element => element.componentInstanceId === instance); }).map(group => group.id));
      const wrapperId = ancestors(anchor.groupId).filter(id => exclusiveGroups.has(id)).at(-1);
      const replacement = copy.elements.map((element, index) => {
        const original = component.scene.elements[index], oldSource = previousDefinition?.scene.elements.find(item => item.id === original.id) ?? previousDefinition?.scene.elements[index];
        const current = oldSource ? elements.find(item => item.componentSourceId === oldSource.id) ?? elements[index] : undefined;
        const width = Math.max(1, element.width * sx), height = Math.max(1, element.height * sy), cx = (element.x + element.width / 2) * sx, cy = (element.y + element.height / 2) * sy;
        let updated: CanvasElement = { ...element, x: origin.x + cos * cx - sin * cy - width / 2, y: origin.y + sin * cx + cos * cy - height / 2, width, height, rotation: element.rotation + rotation, componentId: component.id, componentInstanceId: instance, componentSourceId: original.id, ...(element.type === "text" ? { fontSize: Math.min(500, element.fontSize * Math.min(sx, sy)) } : {}), ...(element.groupId ? {} : wrapperId ? { groupId: wrapperId } : {}) };
        if (current && oldSource && current.type === "text" && oldSource.type === "text" && updated.type === "text" && current.text !== oldSource.text) updated = { ...updated, text: current.text, richText: current.richText };
        if (current && oldSource && current.type === "image" && oldSource.type === "image" && updated.type === "image" && current.src !== oldSource.src) updated = { ...updated, src: current.src, intrinsicWidth: current.intrinsicWidth, intrinsicHeight: current.intrinsicHeight, directive: current.directive, rightsNote: current.rightsNote, sourceUrl: current.sourceUrl, provenance: current.provenance ? structuredClone(current.provenance) : undefined };
        if (current?.type === "shape" && oldSource?.type === "shape" && updated.type === "shape" && JSON.stringify(current.imageFill) !== JSON.stringify(oldSource.imageFill)) updated = { ...updated, imageFill: current.imageFill ? structuredClone(current.imageFill) : undefined };
        if (current?.type === "text" && oldSource?.type === "text" && updated.type === "text") {
          if (JSON.stringify(current.textureFill) !== JSON.stringify(oldSource.textureFill)) updated = { ...updated, textureFill: current.textureFill ? structuredClone(current.textureFill) : undefined };
          if (wordAppearance(current) !== wordAppearance(oldSource)) updated = { ...updated, richText: current.richText, wordTextures: current.wordTextures ? structuredClone(current.wordTextures) : undefined };
        }
        if (current?.clipBounds) updated = { ...updated, clipBounds: { ...current.clipBounds } };
        return updated;
      });
      const firstIndex = next.elements.findIndex(element => element.componentInstanceId === instance);
      const retained = next.elements.filter(element => element.componentInstanceId !== instance);
      next = { ...next, groups: [...(next.groups ?? []).filter(group => !exclusiveGroups.has(group.id) || group.id === wrapperId), ...(copy.groups ?? []).map(group => !group.parentId && wrapperId ? { ...group, parentId: wrapperId } : group)], elements: [...retained.slice(0, firstIndex), ...replacement, ...retained.slice(firstIndex)] };
    }
    return next;
  });
  return { ...result, components: [...(design.components ?? []).filter(item => item.id !== component.id), structuredClone(component)] };
}

export function instantiateTemplate(template: DesignTemplate, data: Record<string, string>, name?: string): DesignDocument {
  const values: Record<string, string> = Object.create(null);
  for (const parameter of template.parameters ?? []) {
    const value = data[parameter.id] ?? data[parameter.name] ?? parameter.defaultValue ?? "";
    if (parameter.required && !value.trim()) throw new Error(`Provide a value for ${parameter.name}.`);
    if (parameter.maxLength && value.length > parameter.maxLength) throw new Error(`${parameter.name} exceeds its ${parameter.maxLength}-character limit.`);
    values[parameter.id] = value; values[parameter.name] = value;
  }
  for (const [key, value] of Object.entries(data)) if (!Object.hasOwn(values, key)) values[key] = value;
  const escaped = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const interpolate = (value: string, html = false) => value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (original, key: string) => Object.hasOwn(values, key) ? html ? escaped(values[key]) : values[key] : original);
  const photoFill = (src: string, previous?: NonNullable<Extract<CanvasElement, { type: "shape" }>["imageFill"]>) => {
    const parsed = parseShapeImageFill({ objectFit: "cover", cropX: 50, cropY: 50, cropScale: 1, ...previous, src });
    if (!parsed) throw new Error("A template photo field contains an invalid image URL.");
    return parsed;
  };
  let design = createDesign(template);
  design = mapScenes(design, scene => ({ ...scene, elements: scene.elements.map(element => {
    const slotValue = element.slot ? values[element.slot] : undefined;
    const parameter = template.parameters?.find(item => item.id === element.slot || item.name === element.slot);
    if (element.type === "text" && parameter?.type === "color" && slotValue) return { ...element, color: slotValue };
    if (element.type === "text") return { ...element, text: parameter?.type === "image" ? interpolate(element.text) : slotValue ?? interpolate(element.text), ...(element.richText ? { richText: sanitizeRichText(slotValue !== undefined && parameter?.type !== "image" ? escaped(slotValue) : interpolate(element.richText, true)) } : {}), ...(parameter?.type === "image" && slotValue ? { textureFill: photoFill(slotValue, element.textureFill) } : element.textureFill ? { textureFill: photoFill(interpolate(element.textureFill.src), element.textureFill) } : {}), ...(element.wordTextures ? { wordTextures: element.wordTextures.map(texture => ({ ...photoFill(interpolate(texture.src), texture), id: texture.id })) } : {}) };
    if (element.type === "image") return slotValue !== undefined && slotValue ? { ...element, src: slotValue } : element;
    if (element.type === "shape") {
      if (parameter?.type === "image" && slotValue) return { ...element, imageFill: photoFill(slotValue, element.imageFill) };
      return { ...element, ...(slotValue !== undefined && slotValue ? { fill: slotValue } : {}), ...(element.imageFill ? { imageFill: photoFill(interpolate(element.imageFill.src), element.imageFill) } : {}) };
    }
    return element;
  }) }));
  design.name = (name ?? template.name).trim().slice(0, 200) || template.name;
  const validated = parseLibrary({ ...EMPTY_LIBRARY, designs: [design] });
  if (!validated) throw new Error("The supplied values produce invalid artwork. Check image URLs and colors.");
  return validated.designs[0];
}

/** CSV/TSV parser with quoted commas, escaped quotes and multiline cells. */
export function parseTabularData(source: string): Record<string, string>[] {
  if (source.length > 1_000_000) throw new Error("Choose a data file smaller than 1 MB.");
  const delimiter = source.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [], current: string[] = []; let cell = "", quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++; }
      else if (quoted || !cell) quoted = !quoted;
      else cell += character;
    } else if (!quoted && (character === delimiter || character === "\n" || character === "\r")) {
      current.push(cell); cell = "";
      if (character !== delimiter) { rows.push([...current]); current.length = 0; if (character === "\r" && source[index + 1] === "\n") index++; }
    } else cell += character;
  }
  if (quoted) throw new Error("A quoted data cell is missing its closing quote.");
  if (cell || current.length) { current.push(cell); rows.push(current); }
  const headers = rows.shift()?.map(header => header.replace(/^\uFEFF/, "").trim());
  if (!headers?.length || headers.some(header => !header || header === "__proto__" || header === "constructor" || header === "prototype") || new Set(headers).size !== headers.length) throw new Error("Use unique, nonempty column names.");
  const data = rows.filter(row => row.some(value => value.trim()));
  if (data.length > 150) throw new Error("Generate at most 150 designs at a time.");
  return data.map(row => {
    if (row.length !== headers.length) throw new Error("Each row must have the same number of cells as the header.");
    return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  });
}

export function saveDesignVersion(design: DesignDocument, name = "Saved version"): DesignDocument {
  const version: DesignVersion = { id: crypto.randomUUID(), name: name.trim().slice(0, 200) || "Saved version", createdAt: new Date().toISOString(), format: design.format, pages: structuredClone(design.pages), caption: design.caption, styles: structuredClone(design.styles ?? []), components: structuredClone(design.components ?? []), colorRoles: structuredClone(design.colorRoles ?? []), parameters: structuredClone(design.parameters ?? []), ...(design.continuousCanvas ? { continuousCanvas: structuredClone(design.continuousCanvas) } : {}), ...(design.masterScene ? { masterScene: structuredClone(design.masterScene) } : {}), ...(design.customSize ? { customSize: { ...design.customSize } } : {}) };
  return { ...design, versions: [...(design.versions ?? []).slice(-19), version] };
}
export function restoreDesignVersion(design: DesignDocument, versionId: string): DesignDocument {
  const version = design.versions?.find(item => item.id === versionId);
  if (!version) throw new Error("This version is no longer available.");
  const next = { ...design, ...structuredClone(version), id: design.id, name: design.name, createdAt: design.createdAt, updatedAt: new Date().toISOString() };
  if (!version.continuousCanvas) delete next.continuousCanvas;
  if (!version.masterScene) delete next.masterScene;
  if (!version.customSize) delete next.customSize;
  return next;
}
export function applySceneToPages(design: DesignDocument, scene: CanvasScene, pageIds: readonly string[], mode: "replace" | "append" = "replace"): DesignDocument {
  const selected = new Set(pageIds);
  return { ...design, pages: design.pages.map(page => {
    if (!selected.has(page.id)) return page;
    const copy = duplicateCanvasScene(scene), existing = page.canvas ?? sceneForPage(page, design.format);
    if (mode === "append" && existing.elements.length + copy.elements.length > 100) throw new Error("A page supports at most 100 elements.");
    return { ...page, canvas: mode === "replace" ? copy : { ...existing, groups: [...(existing.groups ?? []), ...(copy.groups ?? [])], elements: [...existing.elements, ...copy.elements] } };
  }) };
}

export function resizeDocument(design: DesignDocument, size: { width: number; height: number }, mode: "contain" | "cover" | "reflow" = "contain"): DesignDocument {
  if (![size.width, size.height].every(value => Number.isFinite(value) && value >= 100 && value <= 8192)) throw new Error("Use dimensions between 100 and 8192 pixels.");
  const before = formatDimensions(design), oldHeight = 360 * before.height / before.width, newHeight = 360 * size.height / size.width;
  const scale = mode === "reflow" ? before.width / size.width : mode === "cover" ? Math.max(1, newHeight / oldHeight) : Math.min(1, newHeight / oldHeight);
  const scaleRichText = (value: string | undefined) => value?.replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi, (_match, pixels: string) => `font-size:${Math.round(Number(pixels) * scale * 10000) / 10000}px`);
  const appearance = (element: CanvasElement): Partial<CanvasElement> => ({
    ...(element.clipBounds ? { clipBounds: { x: element.clipBounds.x * scale, y: element.clipBounds.y * scale, width: element.clipBounds.width * scale, height: element.clipBounds.height * scale } } : {}),
    ...(element.blur !== undefined ? { blur: element.blur * scale } : {}),
    ...(element.strokeDash ? { strokeDash: element.strokeDash.map(dash => dash * scale) } : {}),
    ...(element.shadow ? { shadow: { ...element.shadow, offsetX: element.shadow.offsetX * scale, offsetY: element.shadow.offsetY * scale, blur: element.shadow.blur * scale, spread: element.shadow.spread * scale } } : {}),
    ...(element.type === "text" ? { fontSize: element.fontSize * scale, letterSpacing: element.letterSpacing * scale, ...(element.padding !== undefined ? { padding: element.padding * scale } : {}), ...(element.paragraphSpacing !== undefined ? { paragraphSpacing: element.paragraphSpacing * scale } : {}), ...(element.richText !== undefined ? { richText: scaleRichText(element.richText) } : {}) } : { radius: element.radius * scale, ...(element.type === "shape" ? { strokeWidth: element.strokeWidth * scale } : {}) }),
  });
  const next = mapScenes(design, (scene, canvasWidth) => ({ ...scene, ...(mode === "reflow" && scene.layout ? { layout: {
    ...scene.layout,
    ...(scene.layout.guides ? { guides: scene.layout.guides.map(guide => ({ ...guide, position: guide.position * scale })) } : {}),
    ...(scene.layout.margins ? { margins: { ...scene.layout.margins, top: scene.layout.margins.top * scale, right: scene.layout.margins.right * scale, bottom: scene.layout.margins.bottom * scale, left: scene.layout.margins.left * scale } } : {}),
    ...(scene.layout.safeArea ? { safeArea: { ...scene.layout.safeArea, top: scene.layout.safeArea.top * scale, right: scene.layout.safeArea.right * scale, bottom: scene.layout.safeArea.bottom * scale, left: scene.layout.safeArea.left * scale } } : {}),
    ...(scene.layout.grid ? { grid: { ...scene.layout.grid, size: scene.layout.grid.size * scale, gutter: scene.layout.grid.gutter * scale } } : {}),
  } } : {}), elements: scene.elements.map(element => {
    if (mode === "reflow") {
      const horizontal = element.anchors?.horizontal ?? "center", vertical = element.anchors?.vertical ?? "middle";
      const dx = canvasWidth * (1 - scale), dy = newHeight - oldHeight * scale;
      const x = element.x * scale + (horizontal === "right" ? dx : horizontal === "center" ? dx / 2 : 0);
      const y = element.y * scale + (vertical === "bottom" ? dy : vertical === "middle" ? dy / 2 : 0);
      const width = Math.max(1, element.width * scale + (horizontal === "stretch" ? dx : 0)), height = Math.max(1, element.height * scale + (vertical === "stretch" ? dy : 0));
      const clip = element.clipBounds;
      const clipBounds = clip ? clip.width === 360 && clip.y === 0 && Math.abs(clip.height - oldHeight) < 1e-7 && Math.abs(clip.x / 360 - Math.round(clip.x / 360)) < 1e-7 ? { x: clip.x, y: 0, width: 360, height: newHeight } : { x: clip.x * scale + (horizontal === "right" ? dx : horizontal === "center" ? dx / 2 : 0), y: clip.y * scale + (vertical === "bottom" ? dy : vertical === "middle" ? dy / 2 : 0), width: clip.width * scale, height: clip.height * scale } : undefined;
      return { ...element, ...appearance(element), x, y, width, height, ...(clipBounds ? { clipBounds } : {}) } as CanvasElement;
    }
    const dx = (canvasWidth - canvasWidth * scale) / 2, dy = (newHeight - oldHeight * scale) / 2;
    return { ...element, ...appearance(element), x: dx + element.x * scale, y: dy + element.y * scale, width: element.width * scale, height: element.height * scale, ...(element.clipBounds ? { clipBounds: { x: dx + element.clipBounds.x * scale, y: dy + element.clipBounds.y * scale, width: element.clipBounds.width * scale, height: element.clipBounds.height * scale } } : {}) } as CanvasElement;
  }) }));
  const result: DesignDocument = { ...next, customSize: { ...size }, ...(design.styles ? { styles: design.styles.map(style => ({ ...style, fontSize: style.fontSize * scale, letterSpacing: style.letterSpacing * scale, ...(style.padding !== undefined ? { padding: style.padding * scale } : {}), ...(style.paragraphSpacing !== undefined ? { paragraphSpacing: style.paragraphSpacing * scale } : {}) })) } : {}), ...(design.components ? { components: design.components.map(component => ({ ...component, width: component.width * scale, height: component.height * scale, scene: { ...component.scene, elements: component.scene.elements.map(element => ({ ...element, ...appearance(element), x: element.x * scale, y: element.y * scale, width: element.width * scale, height: element.height * scale } as CanvasElement)) } })) } : {}) };
  const parsed = parseLibrary({ ...EMPTY_LIBRARY, designs: [result] });
  if (!parsed) throw new Error("These dimensions make an object or text style too small or large to edit. Choose a closer size, or resize the affected elements first.");
  return parsed.designs[0];
}

export function resizeDesignDocument(design: DesignDocument, size: { width: number; height: number }, mode: "scale" | "reflow" | "contain" = "contain"): DesignDocument {
  return resizeDocument(design, size, mode === "scale" ? "cover" : mode);
}

export type TemplateApplicationOptions = { pageId: string; templatePageId: string; mode: "replace" | "append-page" | "append-all"; values?: Record<string, string>; preserveSlots?: boolean };

export function templateSlotContent(element: CanvasElement, type?: "text" | "image" | "color"): string | undefined {
  if (type === "image") return element.type === "image" ? element.src : element.type === "shape" ? element.imageFill?.src : element.textureFill?.src;
  if (type === "color") return element.type === "text" ? element.color : element.type === "shape" ? element.fill : undefined;
  return element.type === "text" ? element.text : element.type === "image" ? element.src : element.fill;
}

/** Shared application path for every template page, resource merge and continuous artwork. */
export function applyTemplateToDesign(design: DesignDocument, template: DesignTemplate, options: TemplateApplicationOptions): DesignDocument {
  const currentPage = design.pages.find(page => page.id === options.pageId);
  if (!currentPage) throw new Error("Choose an existing page.");
  const values = { ...(options.values ?? {}) };
  if (options.preserveSlots !== false) {
    const size = formatDimensions(design), height = 360 * size.height / size.width;
    const sliced = design.continuousCanvas ? sliceSceneForPage(design, currentPage) : currentPage.canvas ?? sceneForPage(currentPage, design.format);
    const current = design.continuousCanvas ? { ...sliced, elements: sliced.elements.filter(element => elementIntersectsCanvas(element, 360, height)) } : sliced;
    for (const element of current.elements) if (element.slot && values[element.slot] === undefined) {
      const parameter = template.parameters?.find(parameter => parameter.id === element.slot || parameter.name === element.slot);
      const value = templateSlotContent(element, parameter?.type);
      if (value) values[element.slot] = value;
    }
    for (const parameter of template.parameters ?? []) if (values[parameter.id] === undefined && values[parameter.name] === undefined) {
      const match = current.elements.find(element => element.slot === parameter.id || element.slot === parameter.name);
      if (match) { const value = templateSlotContent(match, parameter.type); if (value) values[parameter.id] = value; }
    }
  }
  const instantiated = instantiateTemplate(template, values), sourceWasContinuous = Boolean(instantiated.continuousCanvas);
  const independent = { ...instantiated, pages: instantiated.pages.map(page => ({ ...page, canvas: instantiated.continuousCanvas ? sliceSceneForPage(instantiated, page) : page.canvas })) };
  if (independent.masterScene) {
    const size = formatDimensions(independent), height = 360 * size.height / size.width;
    independent.masterScene = { ...independent.masterScene, elements: independent.masterScene.elements.flatMap(element => {
      const clip = element.clipBounds, x = Math.max(0, clip?.x ?? 0), y = Math.max(0, clip?.y ?? 0);
      const right = Math.min(360, clip ? clip.x + clip.width : 360), bottom = Math.min(height, clip ? clip.y + clip.height : height);
      return right > x && bottom > y ? [{ ...element, clipBounds: { x, y, width: right - x, height: bottom - y } }] : [];
    }) };
  }
  delete independent.continuousCanvas;
  const source = resizeDocument(independent, formatDimensions(design), "contain");
  const resources = { styles: [...(design.styles ?? [])], components: [...(design.components ?? [])], parameters: [...(design.parameters ?? [])], colorRoles: [...(design.colorRoles ?? [])] };
  const importedComponentIds = new Set<string>();
  const remaps = { styles: new Map<string, string>(), components: new Map<string, string>(), parameters: new Map<string, string>(), colorRoles: new Map<string, string>() };
  for (const key of ["styles", "components", "parameters", "colorRoles"] as const) for (const entry of source[key] ?? []) {
    const existing = (resources[key] as { id: string }[]).find(item => item.id === entry.id);
    const id = existing && JSON.stringify(existing) !== JSON.stringify(entry) ? crypto.randomUUID() : entry.id;
    remaps[key].set(entry.id, id);
    if (!existing || id !== entry.id) {
      (resources[key] as { id: string }[]).push({ ...structuredClone(entry), id });
      if (key === "components") importedComponentIds.add(id);
    }
  }
  const remap = (scene: CanvasScene): CanvasScene => ({ ...scene, elements: scene.elements.map(element => ({ ...element, ...(element.type === "text" && element.textStyleId ? { textStyleId: remaps.styles.get(element.textStyleId) ?? element.textStyleId } : {}), ...(element.componentId ? { componentId: remaps.components.get(element.componentId) ?? element.componentId } : {}), ...(element.colorRoleId ? { colorRoleId: remaps.colorRoles.get(element.colorRoleId) ?? element.colorRoleId } : {}), ...(element.slot ? { slot: remaps.parameters.get(element.slot) ?? element.slot } : {}) })) });
  resources.components = resources.components.map(component => importedComponentIds.has(component.id) ? { ...component, scene: remap(component.scene) } : component);
  const selectedPage = source.pages.find(page => page.id === options.templatePageId) ?? source.pages[template.pages.findIndex(page => page.id === options.templatePageId)];
  if (!selectedPage) throw new Error("Choose a page from this template.");
  const sourcePages = options.mode === "append-all" ? source.pages : [selectedPage];
  if (options.mode !== "replace" && design.pages.length + sourcePages.length > 20) throw new Error("A design supports up to 20 pages.");
  const prepared = sourcePages.map(page => {
    const composed = remap(composeScene(source, page));
    const size = formatDimensions(source), height = 360 * size.height / size.width;
    // A source master is baked into these local pages. Its display-only marker
    // must not trigger promotion to the destination's shared master on editing.
    const canvas = duplicateCanvasScene({ ...composed, elements: composed.elements.filter(element => !element.master || elementIntersectsCanvas(element, 360, height)).map(element => {
      const local = { ...element };
      if (element.master) {
        const clip = element.clipBounds;
        const x = Math.max(0, clip?.x ?? 0), y = Math.max(0, clip?.y ?? 0);
        const right = Math.min(360, clip ? clip.x + clip.width : 360), bottom = Math.min(height, clip ? clip.y + clip.height : height);
        local.clipBounds = { x, y, width: right - x, height: bottom - y };
      }
      delete local.master; return local;
    }) });
    return { ...duplicatePage(page), canvas };
  });
  for (const page of prepared) if (sourceWasContinuous) {
    const dimensions = formatDimensions(design), height = 360 * dimensions.height / dimensions.width;
    page.canvas!.elements = page.canvas!.elements.filter(element => elementIntersectsCanvas(element, 360, height));
    const used = new Set(page.canvas!.elements.map(element => element.groupId));
    let added = true;
    while (added) { added = false; for (const group of page.canvas!.groups ?? []) if (used.has(group.id) && group.parentId && !used.has(group.parentId)) { used.add(group.parentId); added = true; } }
    page.canvas!.groups = page.canvas!.groups?.filter(group => used.has(group.id));
  }
  if (!design.continuousCanvas) {
    const pages = options.mode === "replace" ? design.pages.map(page => page.id === options.pageId ? { ...page, canvas: prepared[0].canvas } : page) : [...design.pages, ...prepared];
    return { ...design, ...resources, pages };
  }
  const activeIndex = design.pages.indexOf(currentPage), dimensions = formatDimensions(design), height = 360 * dimensions.height / dimensions.width;
  let canvas = structuredClone(design.continuousCanvas);
  if (options.mode === "replace") canvas.elements = canvas.elements.filter(element => {
    const box = elementVisualBounds(element);
    return !(box.x >= activeIndex * 360 && box.x + box.width <= (activeIndex + 1) * 360 && box.y >= 0 && box.y + box.height <= height);
  });
  const artwork = prepared.flatMap((page, index) => {
    const offset = (options.mode === "replace" ? activeIndex : design.pages.length + index) * 360;
    const elements = page.canvas!.elements.map(element => ({ ...element, x: element.x + offset, ...(element.clipBounds ? { clipBounds: { ...element.clipBounds, x: element.clipBounds.x + offset } } : {}) }));
    if (page.canvas!.background !== canvas.background) elements.unshift(createCanvasElement("shape", { name: "Template page background", x: offset, y: 0, width: 360, height, shape: "rectangle", fill: page.canvas!.background, stroke: "transparent", strokeWidth: 0, locked: true }));
    return elements;
  });
  if (canvas.elements.length + artwork.length > 100) throw new Error("These template pages exceed the carousel's 100-element limit.");
  canvas = { ...canvas, groups: [...(canvas.groups ?? []), ...prepared.flatMap(page => page.canvas!.groups ?? [])], elements: [...canvas.elements, ...artwork] };
  const pages = options.mode === "replace" ? design.pages : [...design.pages, ...prepared.map(page => ({ ...page, canvas: { background: canvas.background, elements: [] } }))];
  return { ...design, ...resources, pages, continuousCanvas: canvas };
}
