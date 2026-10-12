import { formatDimensions, sceneForPage, type CanvasElement, type CanvasScene, type DesignDocument, type TextElement } from "./model";
import { elementIntersectsCanvas, elementVisualBounds } from "./canvas-geometry";
import { isElementHidden } from "./commands";
import { imageResolution } from "./property-utils";

export type PreflightIssue = {
  id: string;
  code: "image-resolution" | "image-unavailable" | "font-unavailable" | "text-overflow" | "safe-area" | "empty-slot" | "unresolved-placeholder";
  severity: "warning" | "error";
  pageId: string;
  elementId: string;
  master?: boolean;
  message: string;
};
export type PreflightOptions = {
  /** Return undefined when the source has not been checked. Unknown is not failure. */
  imageAvailable?: (src: string, element: CanvasElement) => boolean | undefined;
  fontAvailable?: (font: string) => boolean | undefined;
  /** Actual rendered outer text bounds in canonical scene units, including padding. */
  measureText?: (element: TextElement, pageId: string) => { width: number; height: number } | undefined;
  /** Word range bounds in canonical units; unknown bounds skip its detail estimate. */
  measureTexture?: (element: TextElement, textureId: string, pageId: string) => { width: number; height: number } | undefined;
};

/** Read-only checks: export UI decides whether to continue or navigate to a finding. */
export function preflightDesign(design: DesignDocument, options: PreflightOptions = {}): PreflightIssue[] {
  const dimensions = formatDimensions(design);
  const width = 360;
  const height = width * dimensions.height / dimensions.width;
  const outputScale = dimensions.width / width;
  const findings: PreflightIssue[] = [];
  design.pages.forEach((page, pageIndex) => {
    const content: CanvasScene = design.continuousCanvas ? { ...design.continuousCanvas, elements: design.continuousCanvas.elements.map(element => ({ ...element, x: element.x - pageIndex * width, ...(element.clipBounds ? {clipBounds:{...element.clipBounds,x:element.clipBounds.x-pageIndex*width}} : {}) })) } : page.canvas ?? sceneForPage(page, design.format);
    const scenes = page.useMaster === false || !design.masterScene ? [content] : [design.masterScene, content];
    for (const scene of scenes) for (const element of scene.elements) {
      if (isElementHidden(scene, element) || element.opacity === 0 || !elementIntersectsCanvas(element, width, height)) continue;
      const name = element.name.trim() || element.type;
      const add = (code: PreflightIssue["code"], message: string, severity: PreflightIssue["severity"] = "warning", resource = "") => findings.push({ id: `${page.id}:${element.id}:${code}${resource ? `:${resource}` : ""}`, code, message, severity, pageId: page.id, elementId: element.id, ...(scene === design.masterScene ? { master: true } : {}) });
      const photo = element.type === "shape" ? element.imageFill : undefined;
      if (element.type === "image" || photo) {
        const src = element.type === "image" ? element.src : photo!.src;
        const resolution = imageResolution(element.type === "image" ? element : {...photo,width:element.width,height:element.height,fit:photo!.objectFit}, outputScale);
        if (resolution?.low) add("image-resolution", `${name} has less image detail than the exported size requires (${Math.round(resolution.ratio * 100)}%).`);
        if (options.imageAvailable?.(src, element) === false) add("image-unavailable", `${name} could not be loaded. Replace it before exporting.`, "error");
        if (element.slot && !src.trim()) add("empty-slot", `${name} has an empty image slot.`, "error");
      }
      if (element.type === "text") {
        const textureIds = new Set([...((element.richText ?? "").matchAll(/data-texture-id="([^"]+)"/g))].map(match => match[1]));
        const textures = [...(element.textureFill ? [{id:"whole",fill:element.textureFill}] : []),...(element.wordTextures ?? []).filter(fill => textureIds.has(fill.id)).map(fill => ({id:fill.id,fill}))];
        for (const {id,fill} of textures) {
          const box = options.measureTexture?.(element,id,page.id) ?? (id === "whole" ? {width:element.width,height:element.height} : undefined);
          const resolution = box ? imageResolution({...fill,...box,fit:fill.objectFit},outputScale) : null;
          if (resolution?.low) add("image-resolution",`${name}'s texture has less image detail than the exported size requires (${Math.round(resolution.ratio * 100)}%).`,"warning",id);
          if (options.imageAvailable?.(fill.src,element) === false) add("image-unavailable",`${name}'s texture could not be loaded. Replace it before exporting.`,"error",id);
        }
        if (options.fontAvailable?.(element.font) === false) add("font-unavailable", `${name}'s typeface is unavailable; the exported text will use a fallback.`);
        const measurement = options.measureText?.(element, page.id);
        if (measurement && [measurement.width, measurement.height].every(Number.isFinite) && (measurement.width > element.width + .5 || measurement.height > element.height + .5)) add("text-overflow", `${name} does not fit inside its text box.`);
        if (element.slot && !element.text.trim()) add("empty-slot", `${name} has an empty text slot.`, "error");
        if (/\{\{\s*[^{}]+\s*\}\}/.test(element.text)) add("unresolved-placeholder", `${name} still contains a template placeholder.`, "error");
        const safe = content.layout?.safeArea;
        if (safe?.enabled) {
          const bounds = elementVisualBounds(element);
          if (bounds.x < safe.left - .01 || bounds.y < safe.top - .01 || bounds.x + bounds.width > width - safe.right + .01 || bounds.y + bounds.height > height - safe.bottom + .01) add("safe-area", `${name} extends outside the safe area.`);
        }
      }
    }
  });
  return findings;
}
