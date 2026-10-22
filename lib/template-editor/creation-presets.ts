import type { DesignFormat, DesignTemplate, EditorLibrary } from "./model";
import type { CreationOptions } from "./library-workflows";

export const DESIGN_PRESETS: {id: string; name: string; format: DesignFormat; width: number; height: number}[] = [
  {id: "portrait", name: "Instagram post", format: "portrait", width: 1080, height: 1350},
  {id: "tall", name: "Portrait 3:4", format: "portrait", width: 1080, height: 1440},
  {id: "square", name: "Square post", format: "square", width: 1080, height: 1080},
  {id: "story", name: "Story / Reel", format: "story", width: 1080, height: 1920},
];

/** A template opens at its own dimensions, with its artwork and brand intact. */
export function templateCreationOptions(template: DesignTemplate, library: Pick<EditorLibrary, "activeBrandKitId">): CreationOptions {
  return {
    name: template.name,
    template,
    format: template.format,
    pageCount: template.pages.length,
    layout: template.continuousCanvas ? "continuous" : "separate",
    brandKitId: library.activeBrandKitId,
    applyBrand: false,
    ...(template.customSize ? {size: {...template.customSize}} : {}),
  };
}
