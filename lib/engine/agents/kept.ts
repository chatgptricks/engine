/**
 * Placing a kept picture (an official screenshot, or its original found
 * online) and checking it stays placed well: whole, at its own shape, on the
 * page's margins. Never cropped through its content, stretched or padded.
 *
 * The designer puts the picture in the template's photo frame; placeKept then
 * fits the frame to the picture: as wide as the space between the margins
 * (narrower, and centred, only when the frame's height runs out), its own
 * proportions, centred in the frame's room. A brand whose photos fill their
 * frames gets the same: a frame cut to the picture's shape is filled without
 * cropping anything.
 */
import type { BrandGuide } from "../../template-editor/brand-guide";
import { formatDimensions, type CanvasElement, type DesignDocument, type ImageElement } from "../../template-editor/model";
import type { CheckIssue } from "./schemas";

/** The canvas is this many units wide, whatever the export size (canvas.tsx). */
const CANVAS_WIDTH = 360;
/** Slack for rounding, in canvas units. */
const SLACK = .75;

export type Margins = { left: number; right: number; top: number; bottom: number };
/** The page's margins in canvas units: the guide's, else the brand's CSS variables, else 72 px of a 1080-px page a side. */
export function pageMargins(guide: BrandGuide | null | undefined, tokens: Record<string, string> = {}): Margins {
  const px = (name: string) => { const value = tokens[name]; return value && /^-?[\d.]+px$/.test(value.trim()) ? parseFloat(value) : null; };
  if (guide?.layout) {
    const unit = CANVAS_WIDTH / (guide.layout.width || 1080);
    return { left: guide.layout.marginLeft * unit, right: guide.layout.marginRight * unit, top: guide.layout.marginTop * unit, bottom: guide.layout.marginBottom * unit };
  }
  const width = px("--page-width") ?? 1080, unit = CANVAS_WIDTH / width;
  return { left: (px("--margin-left") ?? 72) * unit, right: (px("--margin-right") ?? 72) * unit, top: (px("--margin-top") ?? 90) * unit, bottom: (px("--margin-bottom") ?? 88) * unit };
}

const pageHeightOf = (document: DesignDocument) => { const { width, height } = formatDimensions(document); return CANVAS_WIDTH * height / width; };
const keptLayer = (element: CanvasElement, kept: ReadonlyMap<string, { width: number; height: number }>): element is ImageElement =>
  element.type === "image" && !element.hidden && kept.has(element.src);

/**
 * Fits each kept picture's frame to the picture, on the margins. Returns the
 * slides (from 1) it moved a picture on.
 */
export function placeKept(document: DesignDocument, kept: ReadonlyMap<string, { width: number; height: number }>, margins: Margins): number[] {
  const height = pageHeightOf(document), moved: number[] = [];
  document.pages.forEach((page, index) => {
    for (const element of page.canvas?.elements ?? []) {
      if (!keptLayer(element, kept)) continue;
      const size = kept.get(element.src)!, ratio = size.width / size.height;
      if (!(ratio > 0)) continue;
      const left = margins.left, right = CANVAS_WIDTH - margins.right;
      // The frame's own room up and down, kept inside the top and bottom margins.
      const top = Math.max(element.y, margins.top), bottom = Math.min(element.y + element.height, height - margins.bottom);
      const room = bottom - top;
      if (room <= 0 || right <= left) continue;
      let width = right - left, tall = width / ratio;
      if (tall > room) [tall, width] = [room, room * ratio];
      const next = { x: left + (right - left - width) / 2, y: top + (room - tall) / 2, width, height: tall };
      const before = [element.x, element.y, element.width, element.height, element.fit, element.cropScale ?? 1].join();
      Object.assign(element, next, { fit: "contain", cropX: 50, cropY: 50, cropScale: 1, flipX: false, flipY: false, intrinsicWidth: size.width, intrinsicHeight: size.height });
      delete element.span;
      if (element.smartFlow?.media) element.smartFlow = { ...element.smartFlow, media: { x: next.x, width: next.width } };
      if (before !== [element.x, element.y, element.width, element.height, element.fit, element.cropScale].join()) moved.push(index + 1);
    }
  });
  return [...new Set(moved)];
}

/**
 * Engine's check on kept pictures: one cropped by its frame or stretched out
 * of shape is must_fix; one past the page's margins is should_fix.
 */
export function keptChecks(document: DesignDocument, kept: ReadonlyMap<string, { width: number; height: number }>, margins: Margins): CheckIssue[] {
  const issues: CheckIssue[] = [], height = pageHeightOf(document);
  document.pages.forEach((page, index) => {
    for (const element of page.canvas?.elements ?? []) {
      if (!keptLayer(element, kept)) continue;
      const size = kept.get(element.src)!, ratio = size.width / size.height, frame = element.width / element.height, slide = index + 1;
      const zoom = element.cropScale ?? 1;
      if (element.fit === "cover" && Math.abs(Math.log(frame / ratio)) > .02 || zoom > 1.02) {
        issues.push({ slide, problem: "A kept picture (an official screenshot) is cropped by its frame", fix: "Show it whole: fit contain at cropScale 1, its frame at the picture's own shape, between the page's margins", severity: "must_fix", route: "design" });
      }
      if (element.fit === "contain" && element.intrinsicWidth && element.intrinsicHeight && Math.abs(Math.log((element.intrinsicWidth / element.intrinsicHeight) / ratio)) > .02) {
        issues.push({ slide, problem: "A kept picture is drawn out of its own shape", fix: "Give it its own proportions, never stretched", severity: "must_fix", route: "design" });
      }
      const out = element.x < margins.left - SLACK || element.x + element.width > CANVAS_WIDTH - margins.right + SLACK
        || element.y < margins.top - SLACK || element.y + element.height > height - margins.bottom + SLACK;
      if (out) issues.push({ slide, problem: "A kept picture runs past the page's margins", fix: "Place it between the margins, as wide as they allow", severity: "should_fix", route: "design" });
    }
  });
  return issues;
}
