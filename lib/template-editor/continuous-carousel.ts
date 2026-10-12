import {
  createBlankDesign,
  createCanvasElement,
  formatDimensions,
  duplicateCanvasScene,
  sceneForPage,
  type CanvasElement,
  type CanvasScene,
  type DesignDocument,
  type DesignPage,
} from "./model";
import { elementIntersectsCanvas } from "./canvas-geometry";

export const CONTINUOUS_PAGE_WIDTH = 360;
const MAX_CONTINUOUS_LAYERS = 100;
const MAX_CAROUSEL_PAGES = 20;
type SliceSource = Pick<DesignDocument, "format" | "pages" | "continuousCanvas" | "customSize">;

function pageHeight(design: SliceSource): number {
  const format = formatDimensions(design);
  return CONTINUOUS_PAGE_WIDTH * format.height / format.width;
}

function assertPageCount(design: SliceSource): void {
  if (design.pages.length < 1 || design.pages.length > MAX_CAROUSEL_PAGES) {
    throw new Error("A carousel needs between 1 and 20 existing slides before conversion.");
  }
}

function assertLayerCount(count: number): void {
  if (count > MAX_CONTINUOUS_LAYERS) {
    throw new Error("A continuous carousel supports up to 100 layers, including slide backgrounds. Remove some layers before combining these slides.");
  }
}

function colorAlpha(color: string): number {
  if (color.toLowerCase() === "transparent") return 0;
  if (color.startsWith("#") && color.length === 5) return parseInt(color[4], 16) / 15;
  if (color.startsWith("#") && color.length === 9) return parseInt(color.slice(7), 16) / 255;
  return 1;
}

function shifted(element: CanvasElement, offset: number): CanvasElement {
  return { ...element, x: element.x + offset, ...(element.clipBounds ? { clipBounds: { ...element.clipBounds, x: element.clipBounds.x + offset } } : {}) };
}

function assertPersistablePosition(element: CanvasElement): void {
  if (!Number.isFinite(element.x) || !Number.isFinite(element.y) || Math.abs(element.x) > 10_000 || Math.abs(element.y) > 10_000) {
    throw new Error("A layer is too far outside the slides to convert safely. Move parked layers closer to the canvas and try again.");
  }
}

/** Combine page artwork into a single wide scene without changing document or
 * existing page IDs. Geometry, type, image crops and hidden layers are retained.
 * Metadata pages are emptied after flattening so image data is not duplicated. */
export function enableContinuousCarousel(design: DesignDocument): DesignDocument {
  assertPageCount(design);
  if (design.continuousCanvas) {
    if (design.pages.length < 2) throw new Error("A continuous carousel needs at least 2 slides.");
    return design;
  }
  const sourcePages = [...design.pages];
  const firstScene = sceneForPage(sourcePages[0], design.format);
  if (sourcePages.length < 2) {
    const blank = createBlankDesign("Blank slide", design.format).pages[0];
    blank.canvas = { background: firstScene.background, elements: [] };
    sourcePages.push(blank);
  }
  const scenes = sourcePages.map(page => sceneForPage(page, design.format));
  const firstBackground = scenes[0].background;
  const mixedBackgrounds = scenes.some(scene => scene.background !== firstBackground);
  // An alpha rectangle over an opaque shared background would change its color.
  // Mixed translucent pages need independent backgrounds on a transparent base.
  const transparentBase = mixedBackgrounds && scenes.some(scene => colorAlpha(scene.background) < 1);
  const background = transparentBase ? "transparent" : firstBackground;
  const needsBackground = (scene: CanvasScene) => transparentBase
    ? colorAlpha(scene.background) > 0
    : scene.background !== background;
  const extraBackgrounds = scenes.filter(needsBackground).length;
  assertLayerCount(scenes.reduce((count, scene) => count + scene.elements.length, extraBackgrounds));
  const usedIds = new Set<string>();
  const usedGroupIds = new Set<string>();
  const groups: NonNullable<CanvasScene["groups"]> = [];
  const guides: NonNullable<NonNullable<CanvasScene["layout"]>["guides"]> = [];
  const backgrounds: CanvasElement[] = [];
  const artwork: CanvasElement[] = [];
  const height = pageHeight(design);
  scenes.forEach((scene, index) => {
    const groupIds = new Map((scene.groups ?? []).map(group => {
      let id = group.id;
      while (usedGroupIds.has(id)) id = crypto.randomUUID();
      usedGroupIds.add(id); return [group.id, id];
    }));
    groups.push(...(scene.groups ?? []).map(group => ({ ...structuredClone(group), id: groupIds.get(group.id)!, ...(group.parentId ? { parentId: groupIds.get(group.parentId) } : {}) })));
    for (const guide of scene.layout?.guides ?? []) guides.push({ ...guide, id: crypto.randomUUID(), position: guide.position + (guide.axis === "x" ? index * CONTINUOUS_PAGE_WIDTH : 0) });
    if (needsBackground(scene)) {
      const element = createCanvasElement("shape", {
        name: `Slide ${index + 1} background`, x: index * CONTINUOUS_PAGE_WIDTH, y: 0,
        width: CONTINUOUS_PAGE_WIDTH, height, shape: "rectangle",
        fill: scene.background, stroke: scene.background, strokeWidth: 0, radius: 0, locked: true,
      });
      while (usedIds.has(element.id)) element.id = crypto.randomUUID();
      backgrounds.push(element);
      usedIds.add(element.id);
    }
    for (const element of scene.elements) {
      const copy = shifted(element, index * CONTINUOUS_PAGE_WIDTH);
      if (copy.groupId) copy.groupId = groupIds.get(copy.groupId);
      assertPersistablePosition(copy);
      while (usedIds.has(copy.id)) copy.id = crypto.randomUUID();
      usedIds.add(copy.id);
      artwork.push(copy);
    }
  });
  return {
    ...design,
    pages: sourcePages.map((page, index) => ({
      ...page, image: { ...page.image }, style: { ...page.style },
      canvas: { ...scenes[index], background: scenes[index].background, elements: [], groups: [] },
    })),
    continuousCanvas: { ...firstScene, background, elements: [...backgrounds, ...artwork], ...(groups.length ? { groups } : {}), ...(firstScene.layout || guides.length ? { layout: { ...firstScene.layout, guides } } : {}) },
  };
}

/** Stable-ID render slice. Only X changes; image sizing, crop and text layout
 * stay identical across boundaries. The renderer clips the 360px output frame.
 * Hidden and parked elements remain in the scene; visibility belongs to render. */
export function sliceSceneForPage(design: SliceSource, page: DesignPage | number): CanvasScene {
  const index = typeof page === "number" ? page : design.pages.findIndex(candidate => candidate.id === page.id);
  if (!Number.isInteger(index) || index < 0 || index >= design.pages.length) throw new Error("This slide is not part of the carousel.");
  if (!design.continuousCanvas) return sceneForPage(design.pages[index], design.format);
  return {
    ...design.continuousCanvas,
    background: design.continuousCanvas.background,
    elements: design.continuousCanvas.elements.map(element => shifted(element, -index * CONTINUOUS_PAGE_WIDTH)),
    ...(design.continuousCanvas.layout ? { layout: { ...design.continuousCanvas.layout, guides: design.continuousCanvas.layout.guides?.map(guide => ({ ...guide, position: guide.position - (guide.axis === "x" ? index * CONTINUOUS_PAGE_WIDTH : 0) })) } } : {}),
  };
}

/** Separate a wide scene into independent pages. Crossing layers receive an
 * independent copy on every intersected page. Completely parked artwork is
 * retained on page one so switching modes never silently discards layers. */
export function splitContinuousCarousel(design: DesignDocument): DesignDocument {
  if (!design.continuousCanvas) return design;
  assertPageCount(design);
  if (design.pages.length < 2) throw new Error("A continuous carousel needs at least 2 slides.");
  const source = design.continuousCanvas;
  assertLayerCount(source.elements.length);
  const height = pageHeight(design);
  const width = design.pages.length * CONTINUOUS_PAGE_WIDTH;
  const parked = new Set(source.elements.filter(element => !elementIntersectsCanvas(element, width, height)).map(element => element.id));
  const pages = design.pages.map((page, index) => {
    const elements: CanvasElement[] = [];
    for (const element of source.elements) {
      const copy = shifted(element, -index * CONTINUOUS_PAGE_WIDTH);
      if (!elementIntersectsCanvas(copy, CONTINUOUS_PAGE_WIDTH, height) && !(index === 0 && parked.has(element.id))) continue;
      assertPersistablePosition(copy);
      copy.id = crypto.randomUUID();
      elements.push(copy);
    }
    const used = new Set(elements.map(element => element.groupId).filter(Boolean));
    let added = true;
    while (added) { added = false; for (const group of source.groups ?? []) if (used.has(group.id) && group.parentId && !used.has(group.parentId)) { used.add(group.parentId); added = true; } }
    const layout = source.layout ? { ...source.layout, guides: source.layout.guides?.filter(guide => guide.axis === "y" || (guide.position >= index * CONTINUOUS_PAGE_WIDTH && guide.position <= (index + 1) * CONTINUOUS_PAGE_WIDTH)).map(guide => ({ ...guide, id: crypto.randomUUID(), position: guide.position - (guide.axis === "x" ? index * CONTINUOUS_PAGE_WIDTH : 0) })) } : undefined;
    const canvas = duplicateCanvasScene({ background: source.background, elements, ...(source.groups ? { groups: source.groups.filter(group => used.has(group.id)) } : {}), ...(layout ? { layout } : {}) });
    return { ...page, image: { ...page.image }, style: { ...page.style }, canvas };
  });
  const result = { ...design, pages };
  delete result.continuousCanvas;
  return result;
}
