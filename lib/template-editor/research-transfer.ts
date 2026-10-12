import type {Story} from "@/lib/engine/types";
import {createBlankDesign, duplicatePage, sceneForPage, parseLibrary, EMPTY_LIBRARY, type DesignDocument} from "./model";
const KEY = "engine:research-transfer";
export function createResearchDesign(story: Story): DesignDocument {
  const design = createBlankDesign(story.title.slice(0,200), "portrait"), initial = design.pages[0];
  const selected = story.curation.order.length ? story.curation.order : story.curation.selectedImageIds;
  const source = selected.length ? selected.flatMap(id => story.images.filter(image => image.id === id)) : story.images;
  const images = source.filter(image => image.mediaType !== "video").slice(0,20);
  design.caption = story.curation.captionEdited ?? story.caption.draft;
  design.pages = images.length ? images.map((image, index) => ({...duplicatePage(initial), image: {...image, id: crypto.randomUUID()}, style: {...initial.style, heading: index === 0 ? story.caption.titleOverImage.text || story.title : "", body: "", ...story.curation.slideStyles[image.id], template: story.curation.slideStyles[image.id]?.template ?? "overlay"}, canvas: undefined})) : [{...initial, style: {...initial.style, heading: story.title, body: story.description}, canvas: undefined}];
  const safe = parseLibrary({...EMPTY_LIBRARY, designs: [design]});
  if (!safe) throw new Error("Some research artwork could not be transferred. Use saved JPG, PNG or WebP images and try again.");
  const result = safe.designs[0]; result.pages = result.pages.map(page => ({...page, canvas: sceneForPage(page, result.format)}));
  return result;
}
export function transferResearch(story: Story): void {
  const document = createResearchDesign(story), json = JSON.stringify(document);
  if (new TextEncoder().encode(json).byteLength > 10 * 1024 * 1024) throw new Error("This research is too large to transfer. Choose fewer images.");
  sessionStorage.setItem(KEY, json);
}
export function consumeResearchTransfer(): DesignDocument | null {
  try {
    const json = sessionStorage.getItem(KEY); if (!json) return null;
    const parsed = parseLibrary({...EMPTY_LIBRARY, designs: [JSON.parse(json)]});
    sessionStorage.removeItem(KEY); return parsed?.designs[0] ?? null;
  } catch { return null; }
}
