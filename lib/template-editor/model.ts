import type { SlideStyle, Story, StoryImage } from "../engine/types";

export type DesignFormat = "portrait" | "square" | "story";

export type CanvasInsets = { enabled: boolean; top: number; right: number; bottom: number; left: number };
export type CanvasGuide = { id: string; axis: "x" | "y"; position: number; locked?: boolean };
export type CanvasLayout = {
  rulers?: boolean; showGuides?: boolean; guides?: CanvasGuide[];
  margins?: CanvasInsets; safeArea?: CanvasInsets;
  grid?: { enabled: boolean; size: number; columns: number; rows: number; gutter: number };
  snapping?: { enabled: boolean; objects: boolean; page: boolean; guides: boolean; grid: boolean; spacing: boolean; tolerance: number };
};
export type CanvasGroup = { id: string; name: string; parentId?: string; locked?: boolean; hidden?: boolean; opacity?: number };
export type CanvasGradient = { type: "linear" | "radial"; angle: number; stops: { color: string; position: number }[] };
export type CanvasShadow = { color: string; offsetX: number; offsetY: number; blur: number; spread: number };
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "color-dodge" | "color-burn" | "hard-light" | "soft-light" | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";
export type ProtectedProperty = "content" | "position" | "style" | "delete";

export const FORMATS: Record<
  DesignFormat,
  { label: string; width: number; height: number }
> = {
  portrait: { label: "Portrait post", width: 1080, height: 1350 },
  square: { label: "Square post", width: 1080, height: 1080 },
  story: { label: "Story", width: 1080, height: 1920 },
};

/** Scene coordinates and font sizes use a 360px-wide canvas at every format. */
export type CanvasElementBase = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  /** Hidden layers remain editable in the layer list but are omitted from artwork. */
  hidden?: boolean;
  groupId?: string;
  master?: boolean;
  gradient?: CanvasGradient;
  shadow?: CanvasShadow;
  blur?: number;
  blendMode?: BlendMode;
  strokeDash?: number[];
  anchors?: { horizontal: "left" | "center" | "right" | "stretch"; vertical: "top" | "middle" | "bottom" | "stretch" };
  slot?: string;
  protected?: ProtectedProperty[];
  /** Template artwork stays fixed; photo content can still be replaced/cropped. */
  templateRole?: "brand" | "media";
  smartFlow?: { after: string; gap: number; bottom: number; edge?: "top"; resize?: boolean };
  componentId?: string;
  componentInstanceId?: string;
  componentSourceId?: string;
  colorRoleId?: string;
  /** Axis-aligned crop in scene coordinates, independent of layer rotation. */
  clipBounds?: { x: number; y: number; width: number; height: number };
};
export type TextElement = CanvasElementBase & {
  type: "text";
  text: string;
  font: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  richText?: string;
  textMode?: "fixed" | "auto-height" | "auto-fit";
  autoFitMinFontSize?: number;
  autoFitMaxFontSize?: number;
  autoFitFontSize?: number;
  smartText?: { role: "cover" | "heading" | "body"; lines: 0 | 2 | 3 | 4; minFontSize: number; maxFontSize: number; maxHeight: number };
  verticalAlign?: "top" | "middle" | "bottom";
  padding?: number;
  paragraphSpacing?: number;
  strikethrough?: boolean;
  listStyle?: "none" | "bullet" | "number";
  textStyleId?: string;
  textureFill?: ShapeImageFill;
  wordTextures?: (ShapeImageFill & { id: string })[];
};
export type PhotoMetadata = {
  /** Intentionally public description; internal directives never become alt text. */
  publicAlt?: string;
  /** Lightweight editor preview; src always keeps the original. */
  previewSrc?: string;
  directive?: string;
  rightsNote?: string;
  sourceUrl?: string;
  provenance?: { source?: string; imageId?: string; description?: string; cosmosManual?: boolean };
};
export type ShapeImageFill = PhotoMetadata & {
  src: string;
  previewSrc?: string;
  publicAlt?: string;
  alt?: string;
  objectFit: "cover" | "contain";
  cropX: number;
  cropY: number;
  cropScale?: number;
  flipX?: boolean;
  flipY?: boolean;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
};
export type ImageElement = CanvasElementBase & PhotoMetadata & {
  type: "image";
  src: string;
  previewSrc?: string;
  publicAlt?: string;
  fit: "cover" | "contain";
  /** Object-position percentages, from 0 through 100; 50 centers the image. */
  cropX: number;
  cropY: number;
  radius: number;
  cropScale?: number;
  flipX?: boolean;
  flipY?: boolean;
  mask?: "none" | "ellipse" | "triangle" | "diamond";
  intrinsicWidth?: number;
  intrinsicHeight?: number;
};
export type ShapeElement = CanvasElementBase & {
  type: "shape";
  shape: "rectangle" | "ellipse" | "triangle" | "diamond" | "polygon" | "star" | "arrow" | "path";
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  sides?: number;
  starPoints?: number;
  innerRadius?: number;
  path?: string;
  viewBox?: string;
  fillRule?: "nonzero" | "evenodd";
  imageFill?: ShapeImageFill;
  strokeAlign?: "inside" | "center" | "outside";
};
export type CanvasElement = TextElement | ImageElement | ShapeElement;
export type CanvasScene = { background: string; elements: CanvasElement[]; groups?: CanvasGroup[]; layout?: CanvasLayout };
export type TextStyle = Omit<TextElement, keyof CanvasElementBase | "type" | "text" | "richText" | "textStyleId" | "textMode" | "wordTextures" | "autoFitFontSize"> & { id: string; name: string; workspaceSourceId?: string };
export type ReusableComponent = { id: string; name: string; scene: CanvasScene; width: number; height: number; workspaceSourceId?: string };
export type TemplateParameter = { id: string; name: string; type: "text" | "image" | "color"; defaultValue?: string; required?: boolean; maxLength?: number };
export type DesignComment = { id: string; pageId?: string; elementId?: string; text: string; createdAt: string; resolved?: boolean };
export type DesignVersion = Pick<DocumentResources, "styles" | "components" | "colorRoles" | "parameters"> & { id: string; name: string; createdAt: string; format: DesignFormat; pages: DesignPage[]; continuousCanvas?: CanvasScene; caption: string; masterScene?: CanvasScene; customSize?: { width: number; height: number } };
export type DocumentResources = { styles?: TextStyle[]; colorRoles?: { id: string; name: string; color: string }[]; components?: ReusableComponent[]; parameters?: TemplateParameter[]; masterScene?: CanvasScene; customSize?: { width: number; height: number }; tags?: string[]; folderId?: string; favorite?: boolean; deletedAt?: string };
export type DesignPage = {
  id: string;
  image: StoryImage;
  style: SlideStyle;
  /** Absent on legacy pages until the editor explicitly adopts a scene. */
  canvas?: CanvasScene;
  label?: string;
  useMaster?: boolean;
  publicDescription?: string;
  readingOrder?: string[];
};
export type DesignDocument = DocumentResources & {
  id: string;
  name: string;
  templateId: string;
  format: DesignFormat;
  pages: DesignPage[];
  /** One wide scene spanning all slides; ordinary pages remain the slide metadata. */
  continuousCanvas?: CanvasScene;
  caption: string;
  createdAt: string;
  updatedAt: string;
  /** A saved editor draft for authoring a reusable template. */
  purpose?: "template";
  /** The reusable template this draft edits; ordinary designs never carry it. */
  editingTemplateId?: string;
  reviewStatus?: "draft" | "review" | "approved";
  comments?: DesignComment[];
  versions?: DesignVersion[];
  reviewLinks?: { id: string; url: string; expiresAt: string }[];
  /** Bounded receipts make agent retries safe without replacing later artwork. */
  agentOperations?: {id: string; inputHash: string}[];
};
export type DesignTemplate = DocumentResources & {
  id: string;
  name: string;
  description: string;
  category: string;
  format: DesignFormat;
  pages: DesignPage[];
  continuousCanvas?: CanvasScene;
  custom?: boolean;
};
export type BrandKit = {
  name: string;
  font: string;
  background: string;
  text: string;
};
export type BrandAsset = PhotoMetadata & {
  id: string;
  name: string;
  src: string;
  previewSrc?: string;
  width: number;
  height: number;
  kind: "logo" | "image";
  tags?: string[];
  favorite?: boolean;
  variant?: "universal" | "light" | "dark";
};
export type SavedBrandKit = BrandKit & {
  id: string;
  palette: string[];
  assets: BrandAsset[];
};
export const MAX_BRAND_KITS = 20;
export const MAX_BRAND_ASSETS = 40;
export const MAX_BRAND_COLORS = 20;
export const MAX_BRAND_ASSET_CHARS = 2_000_000;
export const DEFAULT_BRAND_KIT_ID = "brand-default";
export type BuiltInTemplateState = { id: string; updatedAt: string; deletedAt?: string; permanentlyDeleted?: boolean };
export type EditorLibrary = {
  version: 2;
  designs: DesignDocument[];
  templates: DesignTemplate[];
  /** Compatibility projection of the active kit. Update kits via withBrandKits. */
  brand: BrandKit;
  brandKits: SavedBrandKit[];
  activeBrandKitId: string;
  folders?: { id: string; name: string }[];
  workspaceStyles?: TextStyle[];
  workspaceComponents?: ReusableComponent[];
  /** Workspace decisions for bundled templates; absent in older saved libraries. */
  builtInTemplateStates?: BuiltInTemplateState[];
};

export const DEFAULT_BRAND: BrandKit = {
  name: "My brand",
  font: "geist",
  background: "#f3efe6",
  text: "#263e35",
};
export const EMPTY_LIBRARY: EditorLibrary = {
  version: 2,
  designs: [],
  templates: [],
  brand: { ...DEFAULT_BRAND },
  brandKits: [{ ...DEFAULT_BRAND, id: DEFAULT_BRAND_KIT_ID, palette: [DEFAULT_BRAND.background, DEFAULT_BRAND.text], assets: [] }],
  activeBrandKitId: DEFAULT_BRAND_KIT_ID,
};

function brandProjection(kit: BrandKit): BrandKit {
  return { name: kit.name, font: kit.font, background: kit.background, text: kit.text };
}

/** Returns detached kit objects, including migration of a legacy in-memory library. */
export function libraryBrandKits(library: EditorLibrary): SavedBrandKit[] {
  if (library.brandKits?.length) return library.brandKits.map(kit => ({
    ...kit,
    palette: [...kit.palette],
    assets: structuredClone(kit.assets),
  }));
  return [{ ...brandProjection(library.brand), id: DEFAULT_BRAND_KIT_ID, palette: [library.brand.background, library.brand.text], assets: [] }];
}

export function activeBrandKit(library: EditorLibrary): SavedBrandKit {
  const kits = libraryBrandKits(library);
  return kits.find(kit => kit.id === library.activeBrandKitId) ?? kits[0];
}

export function createBrandKit(name = "My brand", base: BrandKit = DEFAULT_BRAND): SavedBrandKit {
  return {
    ...brandProjection(base),
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 200) || "Untitled brand",
    palette: Array.from(new Set([base.background, base.text])),
    assets: [],
  };
}

/** The single write path keeps the active-kit projection in sync with its source. */
export function withBrandKits(library: EditorLibrary, kits: SavedBrandKit[], activeId = library.activeBrandKitId): EditorLibrary {
  const parsed = parseBrandKits(kits);
  if (!parsed) throw new Error("Use 1–20 valid brand kits, with at most 20 colors and 40 images per kit.");
  const active = parsed.find(kit => kit.id === activeId) ?? parsed[0];
  return { ...library, brand: brandProjection(active), brandKits: parsed, activeBrandKitId: active.id };
}
export const TEMPLATE_CATEGORIES = [
  "All",
  "Editorial",
  "Carousels",
  "Quotes",
  "Announcements",
  "Education",
  "Stories",
];

function page(key: string, artwork: string, style: SlideStyle): DesignPage {
  return {
    id: `${key}-page`,
    image: {
      id: `${key}-image`,
      url: `/template-editor/${artwork}.svg`,
      source: "upload",
      kind: "atmospheric",
      directive: "",
      width: 1080,
      height: 1350,
      rightsNote: "Original Engine template artwork",
      cosmosManual: false,
      description: "Abstract editorial artwork. Replace with your own image.",
      mediaType: "image",
    },
    style,
  };
}

const ink = "#273f35";
const paper = "#f4efe5";

export const BUILT_IN_TEMPLATES: DesignTemplate[] = [
  {
    id: "slow-mornings",
    name: "Slow mornings",
    category: "Carousels",
    format: "portrait",
    description:
      "A four-page story with a striking cover, a thought, and room to reflect.",
    pages: [
      page("slow-1", "forest", {
        template: "fullbleed",
        heading: "Make room\nfor slower days.",
        body: "A LITTLE LESS RUSH. A LITTLE MORE LIFE.  →",
        font: "dmserif",
        align: "bottom",
        textAlign: "left",
        textScale: 1.2,
      }),
      page("slow-2", "forest", {
        template: "quote",
        heading: "You do not have to fill every quiet moment.",
        body: "01 / LEAVE SOME SPACE",
        font: "dmserif",
        bgMode: "color",
        bgColor: paper,
        textColor: ink,
        textScale: 1.15,
      }),
      page("slow-3", "dunes", {
        template: "stacked",
        heading: "Find your own pace.",
        body: "Choose one small thing to do with your full attention today.",
        font: "dmserif",
        bgMode: "color",
        bgColor: paper,
        textColor: ink,
        mediaRadius: 4,
      }),
      page("slow-4", "forest", {
        template: "overlay",
        heading: "Start with\none quiet minute.",
        body: "SAVE THIS FOR YOUR NEXT SLOW MORNING",
        font: "dmserif",
        textScale: 1.2,
      }),
    ],
  },
  {
    id: "quiet-thought",
    name: "A thought worth keeping",
    category: "Quotes",
    format: "portrait",
    description: "An elegant, type-led quote in warm paper and forest green.",
    pages: [
      page("thought", "folds", {
        template: "quote",
        heading: "Good things\ntake their\nown time.",
        body: "A NOTE TO MYSELF",
        font: "dmserif",
        bgMode: "color",
        bgColor: "#dce5d8",
        textColor: ink,
        textScale: 1.35,
        lineHeight: 1.05,
      }),
    ],
  },
  {
    id: "studio-notes",
    name: "Studio notes",
    category: "Editorial",
    format: "portrait",
    description:
      "A considered image-and-text composition for stories, ideas, and discoveries.",
    pages: [
      page("studio", "dunes", {
        template: "stacked",
        heading: "The beauty\nin between.",
        body: "STUDIO NOTES — VOL. 01\nA new perspective on the everyday.",
        font: "dmserif",
        textScale: 1.25,
        textAlign: "left",
        bgMode: "color",
        bgColor: paper,
        textColor: "#533c2a",
        mediaRadius: 3,
      }),
    ],
  },
  {
    id: "new-chapter",
    name: "Something new",
    category: "Announcements",
    format: "square",
    description:
      "Bold color and confident typography for a launch or an important date.",
    pages: [
      page("chapter", "coral", {
        template: "overlay",
        heading: "A new\nchapter.",
        body: "SOMETHING GOOD IS COMING.\nOCTOBER 24 · SAVE THE DATE",
        font: "space",
        textScale: 1.65,
        fontWeight: 700,
        textAlign: "left",
        align: "bottom",
        textColor: "#fff6e6",
        lineHeight: 0.9,
      }),
    ],
  },
  {
    id: "small-rituals",
    name: "Small rituals, big ideas",
    category: "Education",
    format: "portrait",
    description:
      "A ready-to-write five-page lesson: cover, three useful ideas, and a closing prompt.",
    pages: [
      page("ritual-1", "folds", {
        template: "stacked",
        heading: "3 small rituals.\nA fresh perspective.",
        body: "YOUR EVERYDAY FIELD GUIDE  →",
        font: "geist",
        fontWeight: 700,
        bgMode: "color",
        bgColor: "#e9eedb",
        textColor: ink,
        textAlign: "left",
      }),
      page("ritual-2", "folds", {
        template: "overlay",
        heading: "01\nBegin with less.",
        body: "Clear a little space. Choose one thing that deserves your attention.",
        font: "geist",
        fontWeight: 700,
        bgMode: "color",
        bgColor: ink,
        mediaOpacity: 0,
        textAlign: "left",
        textScale: 1.15,
      }),
      page("ritual-3", "dunes", {
        template: "stacked",
        heading: "02\nNotice the ordinary.",
        body: "Write down something you usually walk past. There is a story in the details.",
        font: "geist",
        fontWeight: 700,
        bgMode: "color",
        bgColor: paper,
        textColor: ink,
        textAlign: "left",
      }),
      page("ritual-4", "orbits", {
        template: "overlay",
        heading: "03\nMake it yours.",
        body: "Start small enough to repeat. A useful ritual fits the life you already have.",
        font: "geist",
        fontWeight: 700,
        textAlign: "left",
        textScale: 1.15,
      }),
      page("ritual-5", "folds", {
        template: "overlay",
        heading: "Which one\nwill you try?",
        body: "SAVE YOUR FAVORITE.\nSHARE IT WITH SOMEONE WHO NEEDS IT.",
        font: "geist",
        fontWeight: 700,
        textScale: 1.3,
      }),
    ],
  },
  {
    id: "somewhere-quiet",
    name: "Somewhere quiet",
    category: "Stories",
    format: "story",
    description: "A full-height visual story with a calm, cinematic title.",
    pages: [
      page("quiet", "forest", {
        template: "fullbleed",
        heading: "A moment\nto breathe.",
        body: "TAKE THE SCENIC ROUTE",
        font: "dmserif",
        textScale: 1.4,
        align: "bottom",
        textAlign: "left",
      }),
    ],
  },
  {
    id: "form-feeling",
    name: "Form & feeling",
    category: "Editorial",
    format: "square",
    description:
      "An architectural composition for your work, a product, or a visual idea.",
    pages: [
      page("form", "sculpture", {
        template: "stacked",
        heading: "Form & feeling.",
        body: "OBJECTS WITH A POINT OF VIEW",
        font: "space",
        textAlign: "left",
        bgMode: "color",
        bgColor: "#e8e4dd",
        textColor: "#403a32",
        textScale: 1.1,
      }),
    ],
  },
  {
    id: "fresh-perspective",
    name: "A fresh perspective",
    category: "Quotes",
    format: "square",
    description:
      "Bright blue, playful geometry, and a short thought that makes people pause.",
    pages: [
      page("perspective", "orbits", {
        template: "overlay",
        heading: "See things\na little\ndifferently.",
        body: "THERE IS ALWAYS ANOTHER ANGLE.",
        font: "space",
        fontWeight: 700,
        textScale: 1.4,
        lineHeight: 0.9,
        textAlign: "left",
        textColor: "#f7f2df",
      }),
    ],
  },
];

export function createCanvasElement<T extends CanvasElement["type"]>(
  type: T,
  options?: Partial<Omit<Extract<CanvasElement, { type: T }>, "type" | "id">>,
): Extract<CanvasElement, { type: T }>;
export function createCanvasElement(
  type: CanvasElement["type"],
  options: Partial<CanvasElement> = {},
): CanvasElement {
  const base = {
    name: type === "text" ? "Text" : type === "image" ? "Image" : "Shape",
    x: 36,
    y: 60,
    width: 288,
    height: 90,
    rotation: 0,
    opacity: 1,
    locked: false,
  };
  const defaults = {
    text: {
      text: "Your text",
      font: "geist",
      fontSize: 32,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: DEFAULT_BRAND.text,
      align: "left",
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    image: {
      height: 216,
      src: "/template-editor/folds.svg",
      fit: "cover",
      cropX: 50,
      cropY: 50,
      radius: 0,
    },
    shape: {
      width: 180,
      height: 120,
      shape: "rectangle",
      fill: "#dce5d8",
      stroke: DEFAULT_BRAND.text,
      strokeWidth: 0,
      radius: 0,
    },
  };
  return {
    ...base,
    ...defaults[type],
    ...options,
    type,
    id: crypto.randomUUID(),
  } as CanvasElement;
}

/** New user-created text grows with its content; imported/template geometry stays unchanged. */
export function createTextBox(options: Partial<Omit<TextElement, "type" | "id">> = {}): TextElement {
  const fontSize = options.fontSize ?? 32, lineHeight = options.lineHeight ?? 1.2, padding = options.padding ?? 2;
  return createCanvasElement("text", {
    textMode: "auto-height",
    verticalAlign: "top",
    padding,
    height: Math.ceil(fontSize * lineHeight + padding * 2),
    ...options,
  });
}

export function duplicateCanvasScene(source: CanvasScene): CanvasScene {
  const copy = structuredClone(source);
  const groupIds = new Map(copy.groups?.map(group => [group.id, crypto.randomUUID()]) ?? []);
  const instanceIds = new Map<string, string>();
  copy.groups = copy.groups?.map(group => ({ ...group, id: groupIds.get(group.id)!, ...(group.parentId ? { parentId: groupIds.get(group.parentId) } : {}) }));
  if (!source.groups) delete copy.groups;
  copy.elements = copy.elements.map(element => {
    if (element.componentInstanceId && !instanceIds.has(element.componentInstanceId)) instanceIds.set(element.componentInstanceId, crypto.randomUUID());
    return { ...duplicateTextTextureIds(element), id: crypto.randomUUID(), ...(element.groupId ? { groupId: groupIds.get(element.groupId) } : {}), ...(element.componentInstanceId ? { componentInstanceId: instanceIds.get(element.componentInstanceId) } : {}) };
  });
  return copy;
}

/** Word texture IDs identify local runs, so copied layers receive their own resources. */
export function duplicateTextTextureIds<T extends CanvasElement>(element: T): T {
  if (element.type !== "text" || !element.wordTextures?.length) return element;
  const ids = new Map(element.wordTextures.map(texture => [texture.id, crypto.randomUUID()]));
  return { ...element, wordTextures: element.wordTextures.map(texture => ({ ...structuredClone(texture), id: ids.get(texture.id)! })), ...(element.richText !== undefined ? { richText: element.richText.replace(/data-texture-id=(?:"([a-zA-Z0-9_-]+)"|'([a-zA-Z0-9_-]+)')/g, (attribute, doubleId: string, singleId: string) => ids.has(doubleId ?? singleId) ? `data-texture-id="${ids.get(doubleId ?? singleId)}"` : attribute) } : {}) };
}

export function duplicatePage(source: DesignPage): DesignPage {
  const canvas=source.canvas?duplicateCanvasScene(source.canvas):undefined;
  const ids=new Map(source.canvas?.elements.map((element,index)=>[element.id,canvas!.elements[index].id])??[]);
  return {
    ...structuredClone(source),
    id: crypto.randomUUID(),
    image: { ...source.image, id: crypto.randomUUID() },
    style: { ...source.style },
    ...(source.canvas
      ? {
          canvas,
        }
      : {}),
    ...(source.readingOrder?{readingOrder:source.readingOrder.map(id=>ids.get(id)??id)}:{}),
  };
}

/** Adapt scene coordinates between the three formats without stretching type. */
export function resizeCanvasScene(
  scene: CanvasScene,
  from: DesignFormat,
  to: DesignFormat,
): CanvasScene {
  const factor = FORMATS[to].height / FORMATS[from].height;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  return {
    ...scene,
    elements: scene.elements.map((element) => ({
      ...element,
      y: clamp(element.y * factor, -10_000, 10_000),
      ...(element.type !== "text"
        ? { height: clamp(element.height * factor, 1, 10_000) }
        : {}),
    })),
  };
}

/** Adapt a legacy composition only when requested. Existing documents remain
 * untouched until the editor writes the returned scene. Stable migration IDs
 * also make repeated previews deterministic before that first write. */
export function sceneForPage(
  page: DesignPage,
  format: DesignFormat,
): CanvasScene {
  if (page.canvas) return page.canvas;
  const style = page.style;
  const width = 360;
  const height = (width * FORMATS[format].height) / FORMATS[format].width;
  const layout = style.template;
  const scene: CanvasScene = {
    background:
      style.bgColor ??
      (layout === "masonry"
        ? "#f3eee3"
        : layout === "quote"
          ? "#0d0d0f"
          : "#141417"),
    elements: [],
  };
  const limit = (n: number, low: number, high: number) =>
    Math.max(low, Math.min(high, n));
  const id = (part: string) => `${page.id.slice(0, 80)}-canvas-${part}`;
  const image = (
    part: string,
    x: number,
    y: number,
    w: number,
    h: number,
    radius = 0,
    opacity = style.mediaOpacity ?? 1,
  ) => {
    const element = createCanvasElement("image", {
      name:
        part === "image"
          ? "Image"
          : part === "backdrop"
            ? "Backdrop"
            : "Image panel",
      x,
      y,
      width: w,
      height: h,
      src: page.image.url,
      radius,
      opacity,
      cropX: limit(50 - (style.mediaInX ?? 0), 0, 100),
      cropY: limit(50 - (style.mediaInY ?? 0), 0, 100),
      ...(style.mediaScale !== undefined ? { cropScale: limit(style.mediaScale, .1, 20) } : {}),
      ...(part === "backdrop" ? { blur: 18 } : {}),
      intrinsicWidth: page.image.width,
      intrinsicHeight: page.image.height,
      directive: page.image.directive,
      rightsNote: page.image.rightsNote,
      ...(page.image.sourceUrl ? { sourceUrl: page.image.sourceUrl } : {}),
      provenance: { source: page.image.source, imageId: page.image.id, ...(page.image.description ? { description: page.image.description } : {}), cosmosManual: page.image.cosmosManual },
    });
    element.id = id(part);
    scene.elements.push(element);
  };
  const shade = (opacity: number) => {
    const element = createCanvasElement("shape", {
      name: "Image shading",
      x: 0,
      y: 0,
      width,
      height,
      fill: "#000000",
      stroke: "transparent",
      opacity,
    });
    element.id = id("shade");
    scene.elements.push(element);
  };
  const scale = style.textScale ?? 1;
  const isCard = layout === "stacked" || layout === "blur";
  const isQuote = layout === "quote";
  const isCover = layout === "masonry";
  const font = style.font ?? "libre";
  const align =
    style.align ??
    (layout === "fullbleed" || layout === "split"
      ? "bottom"
      : isCover
        ? "top"
        : "center");
  const textAlign =
    style.textAlign ??
    (layout === "overlay" || layout === "blur" || isCover ? "center" : "left");
  const textColor = style.textColor ?? (isCover ? "#1c1a17" : "#ffffff");
  const heading = style.heading ?? "";
  const body = style.body ?? "";
  const padding = isCard
    ? layout === "blur"
      ? 26
      : 20
    : isQuote
      ? 24
      : isCover
        ? 26
        : 22;
  const textWidth = width - padding * 2;
  const headSize = isCard
    ? layout === "blur"
      ? 18
      : 20 * scale
    : (isQuote ? 21 : isCover ? 29 : 22) * scale;
  const bodySize = isCard
    ? layout === "blur"
      ? 12.5
      : 13
    : (isQuote ? 12 : isCover ? 13.5 : 13) * scale;
  const headLine = isCard
    ? layout === "blur"
      ? 1.25
      : 1.2
    : (isQuote ? 1.34 : isCover ? 1.1 : 1.18) * (style.lineHeight ?? 1);
  const bodyLine =
    (isCover ? 1.45 : 1.5) * (isCard ? 1 : (style.lineHeight ?? 1));
  const textHeight = (text: string, size: number, line: number) => {
    if (!text) return 0;
    const columns = Math.max(1, Math.floor(textWidth / (size * 0.52)));
    const lines = text
      .split("\n")
      .reduce(
        (count, paragraph) =>
          count + Math.max(1, Math.ceil(paragraph.length / columns)),
        0,
      );
    return Math.min(10_000, Math.ceil(lines * size * line + 2));
  };
  const headHeight = textHeight(heading, headSize, headLine);
  const bodyHeight = textHeight(body, bodySize, bodyLine);
  const gap = heading && body ? (isQuote ? 16 : isCard ? 8 : 10) : 0;
  const quoteHeight = isQuote ? 37 : 0;
  const blockHeight = headHeight + bodyHeight + gap + quoteHeight;
  let textY =
    align === "top"
      ? padding
      : align === "bottom"
        ? height - blockHeight - padding
        : (height - blockHeight) / 2;

  if (isCard) {
    const cardW = style.cardW ?? style.cardScale ?? 1;
    const cardH = style.cardH ?? style.cardScale ?? 1;
    const imageWidth = textWidth * (layout === "blur" ? 0.78 : 1) * cardW;
    const imageHeight = textWidth * (layout === "blur" ? 0.78 : 0.75) * cardH;
    const groupHeight = imageHeight + (blockHeight ? 14 + blockHeight : 0);
    const start =
      align === "top"
        ? padding
        : align === "bottom"
          ? height - groupHeight - padding
          : (height - groupHeight) / 2;
    if (style.bgMode !== "color") {
      image("backdrop", 0, 0, width, height, 0, 0.3);
      shade(0.3);
    }
    image(
      "image",
      (width - imageWidth) / 2 + ((style.mediaX ?? 0) / 100) * imageWidth,
      start + ((style.mediaY ?? 0) / 100) * imageHeight,
      imageWidth,
      imageHeight,
      style.mediaRadius ?? (layout === "blur" ? 18 : 12),
    );
    textY = start + imageHeight + 14;
  } else if (isCover) {
    image(
      "image",
      width * 0.19,
      height * 0.48,
      width * 0.62,
      width * 0.62 * 0.75,
      16,
    );
  } else if (layout === "split") {
    image("image", 0, 0, width / 2, height, style.mediaRadius ?? 0);
    image("image-right", width / 2, 0, width / 2, height);
    shade(0.32);
  } else if (layout !== "text" && !isQuote) {
    const imageWidth = (width * (style.mediaW ?? 100)) / 100;
    const imageHeight = (height * (style.mediaH ?? 100)) / 100;
    image(
      "image",
      (width - imageWidth) / 2 + (width * (style.mediaX ?? 0)) / 100,
      (height - imageHeight) / 2 + (height * (style.mediaY ?? 0)) / 100,
      imageWidth,
      imageHeight,
      style.mediaRadius ?? 0,
    );
    if (layout === "overlay") shade(0.42);
    if (layout === "fullbleed") shade(0.28);
  } else if (style.bgMode === "blur") {
    image("backdrop", 0, 0, width, height, 0, 0.3);
    shade(0.3);
  }

  const x = limit(
    padding + (width * (style.textX ?? 0)) / 100,
    -10_000,
    10_000,
  );
  textY = limit(
    textY + (blockHeight * (style.textY ?? 0)) / 100,
    -10_000,
    10_000,
  );
  const text = (
    part: string,
    content: string,
    y: number,
    h: number,
    fontSize: number,
    lineHeight: number,
    opacity = style.textOpacity ?? 1,
  ) => {
    if (!content) return;
    const element = createCanvasElement("text", {
      name:
        part === "heading"
          ? "Heading"
          : part === "body"
            ? "Body"
            : "Quote mark",
      text: content,
      ...(part === "heading" && style.headingHtml ? { richText: sanitizeRichText(style.headingHtml) } : part === "body" && style.bodyHtml ? { richText: sanitizeRichText(style.bodyHtml) } : {}),
      x,
      y: limit(y, -10_000, 10_000),
      width: textWidth,
      height: Math.max(1, h),
      font,
      fontSize,
      fontWeight:
        part === "heading" && !isQuote ? (style.fontWeight ?? 600) : 400,
      color: textColor,
      align: textAlign,
      lineHeight,
      opacity,
      letterSpacing: (style.letterSpacing ?? 0) * fontSize,
    });
    element.id = id(part);
    scene.elements.push(element);
  };
  if (layout !== "plain") {
    if (isQuote)
      text("quote", "“", textY, 37, 54, 0.7, (style.textOpacity ?? 1) * 0.85);
    text(
      "heading",
      heading,
      textY + quoteHeight,
      headHeight,
      headSize,
      headLine,
    );
    text(
      "body",
      body,
      textY + quoteHeight + headHeight + gap,
      bodyHeight,
      bodySize,
      bodyLine,
      (style.textOpacity ?? 1) * (isQuote ? 0.68 : 0.92),
    );
  }
  if (style.credit) {
    const credit = [page.image.description, page.image.sourceUrl].filter(Boolean).join("\n");
    if (credit) text("credit", credit, height - 32, 24, 8, 1.3, .8);
  }
  return scene;
}

export function isChatGPTricksTemplate(template: Pick<DesignTemplate, "name">): boolean {
  return /^@?chatgptricks$/i.test(template.name.trim());
}
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
const isPlaceholder = (element: TextElement) => /^(#[\da-f]{6}|image)$/i.test(element.text.trim());
const isProfile = (element: CanvasElement) => element.name.startsWith("Instagram ·") || (element.type === "text" && ["Follow", "Message", "2,475", "2.7M", "87"].includes(element.text));

/** Imported Canva runs are separate objects. Join only adjacent, compatible
 * text runs in the same group, keeping each run's color and emphasis. */
export function mergeTemplateText(scene: CanvasScene): CanvasScene {
  const consumed = new Set<string>(), replacements = new Map<string, TextElement>();
  for (const element of scene.elements) {
    if (element.type !== "text" || !element.groupId || consumed.has(element.id) || isPlaceholder(element) || isProfile(element)) continue;
    const runs = scene.elements.filter((other): other is TextElement => other.type === "text" && other.groupId === element.groupId && other.font === element.font && Math.abs(other.fontSize - element.fontSize) < .1 && !isPlaceholder(other) && !isProfile(other)).sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y);
    if (runs.length < 2 || runs.some(run => run.rotation !== 0 || run.hidden || run.locked || run.wordTextures?.length || run.textureFill)) continue;
    const adjacent = runs.every((run, index) => !index || Math.abs(run.y - runs[index - 1].y) < 2 && Math.abs(run.x - runs[index - 1].x - runs[index - 1].width) < 8 || Math.abs(run.x - runs[0].x) < 2 && Math.abs(run.y - runs[index - 1].y - runs[index - 1].height) < 8);
    if (!adjacent) continue;
    const first = runs[0], left = Math.min(...runs.map(run => run.x)), top = Math.min(...runs.map(run => run.y));
    const richText = runs.map((run, index) => {
      const separator = index ? Math.abs(run.y - runs[index - 1].y) < 2 ? " " : "<br>" : "";
      return `${separator}<span style="color:${run.color};font-weight:${run.fontWeight};font-style:${run.italic ? "italic" : "normal"}">${run.richText ?? escape(run.text.trim())}</span>`;
    }).join("");
    replacements.set(first.id, { ...first, groupId: undefined, x: left, y: top, width: Math.max(...runs.map(run => run.x + run.width)) - left, height: Math.max(...runs.map(run => run.y + run.height)) - top, text: runs.map(run => run.text.trim()).join(" "), richText });
    runs.forEach(run => consumed.add(run.id));
  }
  return { ...scene, elements: scene.elements.flatMap(element => replacements.has(element.id) ? [replacements.get(element.id)!] : consumed.has(element.id) ? [] : [element]) };
}

/** Applied to new copies only. Saved artwork and the source template are never
 * rewritten on load, and deleted templates are never reintroduced. */
export function prepareSmartTemplate(template: DesignTemplate): DesignTemplate {
  if (!isChatGPTricksTemplate(template) || template.continuousCanvas) return template;
  const height = 360 * (template.customSize?.height ?? (template.format === "story" ? 1920 : template.format === "square" ? 1080 : 1350)) / (template.customSize?.width ?? 1080);
  return { ...template, pages: template.pages.map((page, pageIndex) => {
    if (!page.canvas || page.canvas.elements.some(element => element.type === "text" && element.smartText)) return page;
    // The asset sheet is a toolbox, not a publishing layout.
    if (/^assets$/i.test(page.label ?? "")) return page;
    const merged = mergeTemplateText(page.canvas), label = page.label?.toLowerCase() ?? "";
    const texts = merged.elements.filter((element): element is TextElement => element.type === "text" && !isPlaceholder(element) && !isProfile(element)).sort((a, b) => a.y - b.y);
    const media = merged.elements.filter(element => !isProfile(element) && element.name !== "Logo" && (element.type === "image" || element.type === "shape" && element.width > 180 && element.height > 100 && !element.gradient && !/fade/i.test(element.name)));
    const textIds = new Set(texts.map(element => element.id)), mediaIds = new Set(media.map(element => element.id));
    let elements: CanvasElement[] = merged.elements.map(element => {
      if (element.type === "text" && textIds.has(element.id)) {
        const index = texts.findIndex(text => text.id === element.id), cover = pageIndex === 0 || /^cta/.test(label);
        const role = cover ? "cover" : index === 0 ? "heading" : "body";
        const next = texts[index + 1];
        const bottom = Math.min(height - 20, next ? next.y - 8 : height - 20);
        const x = Math.max(18, element.x), width = Math.min(element.width, 360 - x - 18);
        const base = { ...element, groupId: undefined, slot: `smart-text-${index}`, x, width, align: cover ? "center" as const : "left" as const, textMode: "auto-fit" as const, verticalAlign: "top" as const, protected: ["position", "style", "delete"] as const };
        const maxHeight = Math.max(element.height, bottom - element.y);
        const minimum = Math.min(element.fontSize, role === "cover" ? 18 : 11);
        return { ...base, protected: [...base.protected], smartText: { role, lines: pageIndex === 0 ? 3 : 0, minFontSize: minimum, maxFontSize: Math.min(100, element.fontSize * 1.65), maxHeight } };
      }
      if (mediaIds.has(element.id)) return { ...element, groupId: undefined, slot: "smart-media", name: element.type === "shape" ? "Photo frame" : element.name, templateRole: "media" as const, protected: ["position", "delete"] };
      return { ...element, templateRole: "brand" as const, ...(element.type === "text" && isPlaceholder(element) ? { hidden: true } : {}), protected: ["content", "position", "style", "delete"] };
    });
    const patchText = (index: number, patch: Partial<TextElement>, maxHeight?: number) => {
      elements = elements.map(element => element.type === "text" && element.slot === `smart-text-${index}` ? { ...element, ...patch, smartText: { ...element.smartText!, ...(maxHeight === undefined ? {} : { maxHeight }) } } : element);
    };
    if (label === "text + media" && texts[0] && media[0]) {
      patchText(0, { x: media[0].x, width: media[0].width }, 120);
      elements = elements.map(element => element.id === media[0].id ? { ...element, smartFlow: { after: "smart-text-0", gap: 8, bottom: media[0].y + media[0].height, resize: true } } : element);
    }
    if (label === "full bleed + text" && texts.length >= 2) {
      patchText(0, {}, 72);
      patchText(1, { smartFlow: { after: "smart-text-0", gap: 8, bottom: height - 28 } }, 100);
    }
    if (label === "prompt" && texts.length >= 2 && media[0]) {
      patchText(0, {}, 72);
      elements = elements.map(element => element.id === media[0].id ? { ...element, templateRole: "brand", smartFlow: { after: "smart-text-0", gap: 8, bottom: media[0].y + media[0].height, resize: true } } : element);
      patchText(1, { smartFlow: { after: "smart-media", edge: "top", gap: 15, bottom: media[0].y + media[0].height - 52 } }, media[0].height - 70);
    }
    if (label === "title quote" && texts.length >= 2) {
      patchText(0, {}, Math.max(texts[0].height, height - 65 - texts[0].y));
      patchText(1, { smartFlow: { after: "smart-text-0", gap: 8, bottom: height - 25 } }, 40);
    }
    const canvas: CanvasScene = { ...merged, elements, layout: { ...merged.layout, showGuides: true, margins: { enabled: true, top: 20, right: 20, bottom: 20, left: 20 }, snapping: { enabled: true, objects: true, page: true, guides: true, grid: false, spacing: true, tolerance: 6 } } };
    return { ...page, canvas };
  }) };
}


export function createDesign(template: DesignTemplate): DesignDocument {
  template = prepareSmartTemplate(template);
  const now = new Date().toISOString();
  const design: DesignDocument = {
    ...copyResources(template),
    id: crypto.randomUUID(),
    name: template.name,
    templateId: template.id,
    format: template.format,
    pages: template.pages.map(duplicatePage),
    ...(template.continuousCanvas ? { continuousCanvas: duplicateCanvasScene(template.continuousCanvas) } : {}),
    caption: "",
    createdAt: now,
    updatedAt: now,
  };
  return remapCopiedComponentReferences(design, template);
}

export function createBlankDesign(
  name: string,
  format: DesignFormat,
): DesignDocument {
  return createDesign({
    id: "blank-design",
    name: name.trim() || "Untitled design",
    description: "",
    category: "My templates",
    format,
    pages: [
      {
        ...page("blank-design", "folds", {
          template: "text",
          heading: "",
          body: "",
          bgMode: "color",
          bgColor: DEFAULT_BRAND.background,
          textColor: DEFAULT_BRAND.text,
          font: DEFAULT_BRAND.font,
          align: "center",
          textAlign: "left",
        }),
        canvas: { background: DEFAULT_BRAND.background, elements: [] },
      },
    ],
  });
}

export function createBlankTemplateDesign(
  name: string,
  format: DesignFormat,
): DesignDocument {
  return {
    ...createBlankDesign(name.trim() || "Untitled template", format),
    templateId: "blank-template",
    purpose: "template",
  };
}

export function editTemplateDesign(template: DesignTemplate): DesignDocument {
  return {
    ...createDesign(template),
    purpose: "template",
    editingTemplateId: template.id,
  };
}

export function cloneDesign(design: DesignDocument): DesignDocument {
  const now = new Date().toISOString();
  const copy: DesignDocument = {
    ...structuredClone(design),
    ...copyResources(design),
    id: crypto.randomUUID(),
    name: `${design.name} copy`,
    pages: design.pages.map(duplicatePage),
    ...(design.continuousCanvas ? { continuousCanvas: duplicateCanvasScene(design.continuousCanvas) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  if (design.versions) copy.versions = design.versions.map(version => remapCopiedComponentReferences({ ...structuredClone(version), ...copyResources(version), pages: version.pages.map(duplicatePage), ...(version.continuousCanvas ? { continuousCanvas: duplicateCanvasScene(version.continuousCanvas) } : {}) }, version));
  delete copy.purpose;
  delete copy.editingTemplateId;
  delete copy.deletedAt;
  delete copy.reviewLinks;
  if (copy.comments) {
    const pageIds = new Map(design.pages.map((page, index) => [page.id, copy.pages[index].id]));
    const elementIds = new Map(design.pages.flatMap((page, index) => page.canvas?.elements.map((element, position) => [element.id, copy.pages[index].canvas!.elements[position].id] as const) ?? []));
    design.continuousCanvas?.elements.forEach((element, index) => elementIds.set(element.id, copy.continuousCanvas!.elements[index].id));
    design.masterScene?.elements.forEach((element, index) => elementIds.set(element.id, copy.masterScene!.elements[index].id));
    copy.comments = copy.comments.map(comment => ({ ...comment, id: crypto.randomUUID(), ...(comment.pageId ? { pageId: pageIds.get(comment.pageId) ?? comment.pageId } : {}), ...(comment.elementId ? { elementId: elementIds.get(comment.elementId) ?? comment.elementId } : {}) }));
  }
  return remapCopiedComponentReferences(copy, design);
}

export function designAsTemplate(
  design: DesignDocument,
  name: string,
): DesignTemplate {
  const template: DesignTemplate = {
    ...copyResources(design),
    id: crypto.randomUUID(),
    name: name.trim() || design.name,
    description: `Your reusable ${design.pages.length}-page template.`,
    category: "My templates",
    format: design.format,
    pages: design.pages.map(duplicatePage),
    ...(design.continuousCanvas ? { continuousCanvas: duplicateCanvasScene(design.continuousCanvas) } : {}),
    custom: true,
  };
  return remapCopiedComponentReferences(template, design);
}

function copyResources(source: DocumentResources): DocumentResources {
  const result: DocumentResources = {};
  for (const key of ["styles", "colorRoles", "components", "parameters", "masterScene", "customSize", "tags", "folderId", "favorite"] as const) {
    if (source[key] !== undefined) Object.assign(result, { [key]: structuredClone(source[key]) });
  }
  if (source.masterScene) result.masterScene = duplicateCanvasScene(source.masterScene);
  if (source.components) result.components = source.components.map(component => ({ ...structuredClone(component), scene: duplicateCanvasScene(component.scene) }));
  return result;
}

function remapCopiedComponentReferences<T extends DocumentResources & { pages: DesignPage[]; continuousCanvas?: CanvasScene; versions?: DesignVersion[] }>(copy: T, source: DocumentResources & {pages?:DesignPage[];continuousCanvas?:CanvasScene}): T {
  const references = new Map<string, string>();
  for (const original of source.components ?? []) {
    const duplicated = copy.components?.find(component => component.id === original.id);
    original.scene.elements.forEach((element, index) => { if (duplicated?.scene.elements[index]) references.set(`${original.id}:${element.id}`, duplicated.scene.elements[index].id); });
  }
  const remap = (scene?: CanvasScene) => { if (!scene) return; for (const element of scene.elements) if (element.componentId && element.componentSourceId) element.componentSourceId = references.get(`${element.componentId}:${element.componentSourceId}`) ?? element.componentSourceId; };
  copy.pages.forEach(page => remap(page.canvas)); remap(copy.continuousCanvas); remap(copy.masterScene);
  copy.components?.forEach(component => remap(component.scene));
  copy.versions?.forEach(version => { version.pages.forEach(page => remap(page.canvas)); remap(version.continuousCanvas); remap(version.masterScene); });
  const ids=new Map<string,string>();
  const mapScene=(before?:CanvasScene,after?:CanvasScene)=>before?.elements.forEach((element,index)=>{if(after?.elements[index])ids.set(element.id,after.elements[index].id);});
  mapScene(source.masterScene,copy.masterScene);mapScene(source.continuousCanvas,copy.continuousCanvas);
  source.pages?.forEach((page,index)=>mapScene(page.canvas,copy.pages[index]?.canvas));
  source.pages?.forEach((page,index)=>{if(page.readingOrder&&copy.pages[index])copy.pages[index].readingOrder=page.readingOrder.map(id=>ids.get(id)??id);});
  return copy;
}

export function formatDimensions(design: Pick<DesignDocument, "format" | "customSize">): { width: number; height: number } {
  return design.customSize ?? FORMATS[design.format];
}

/** Adapts a design to the established slide renderer and export contract. */
export function storyForDesign(design: DesignDocument): Story {
  const images = design.pages.map((p) => p.image);
  const ids = images.map((image) => image.id);
  return {
    id: design.id,
    title: design.name,
    description: "",
    status: "queue",
    researchCompletedAt: design.createdAt,
    leadImageId: images[0]?.id ?? "",
    techOvert: false,
    dossier: {
      verificationStatus: "unverifiable",
      verifiedFacts: [],
      primarySources: [],
      contestedPoints: [],
    },
    caption: {
      draft: design.caption,
      titleOverImage: { use: false, text: "" },
    },
    images,
    curation: {
      selectedImageIds: ids,
      order: [...ids],
      captionEdited: design.caption,
      publishedAt: null,
      slideStyles: Object.fromEntries(
        design.pages.map((p) => [p.image.id, p.style]),
      ),
    },
  };
}

const FONT_IDS = new Set([
  "serif",
  "sans",
  "walsheim",
  "walsheimcond",
  "kyoto",
  "century",
  "libre",
  "geist",
  "sfpro",
  "playfair",
  "dmserif",
  "lora",
  "cormorant",
  "crimson",
  "inter",
  "space",
  "montserrat",
  "bebas",
  "bebascanva",
  "plexmono",
  "caveat",
]);
const LAYOUTS = new Set([
  "text",
  "plain",
  "overlay",
  "fullbleed",
  "quote",
  "stacked",
  "blur",
  "split",
  "masonry",
]);
const MAX_LIBRARY_CHARS = 30 * 1024 * 1024;
const MAX_IMAGE_CHARS = 12 * 1024 * 1024;
/** Match JSON's character budget without allocating a second copy of every
 * embedded image. Stop as soon as the limit is exceeded. */
export function fitsJsonCharacterLimit(input: unknown, maximum: number, deduplicateImages = false): boolean {
  let length = 0;
  const ancestors = new Set<object>();
  const images = new Set<string>();
  const add = (count: number) => (length += count) <= maximum;
  const omitted = (value: unknown) => value === undefined || typeof value === "function" || typeof value === "symbol";
  function normalize(value: unknown, key: string): unknown {
    if (value && typeof value === "object") {
      const toJSON = (value as {toJSON?: unknown}).toJSON;
      if (typeof toJSON === "function") value = toJSON.call(value, key);
      if (value instanceof Number || value instanceof String || value instanceof Boolean) value = value.valueOf();
    }
    return value;
  }
  function text(value: string): boolean {
    if (!add(value.length + 2)) return false;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 34 || code === 92) { if (!add(1)) return false; }
      else if (code < 32) { if (!add([8, 9, 10, 12, 13].includes(code) ? 1 : 5)) return false; }
      else if (code >= 0xd800 && code <= 0xdfff) {
        const next = value.charCodeAt(index + 1);
        if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) index++;
        else if (!add(5)) return false;
      }
    }
    return true;
  }
  function visit(value: unknown, field = ""): boolean {
    if (value === null) return add(4);
    if (typeof value === "string") {
      if (deduplicateImages && ["src", "url", "previewSrc"].includes(field) && value.startsWith("data:image/")) {
        if (images.has(value)) return add(79);
        images.add(value);
      }
      return text(value);
    }
    if (typeof value === "boolean") return add(value ? 4 : 5);
    if (typeof value === "number") return add(JSON.stringify(value).length);
    if (typeof value !== "object") return false;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    try {
      if (!add(2)) return false;
      let first = true;
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
          if (!first && !add(1)) return false;
          first = false;
          const child = normalize(value[index], String(index));
          if (!(omitted(child) ? add(4) : visit(child))) return false;
        }
      } else {
        for (const key of Object.keys(value)) {
          const child = normalize((value as Record<string, unknown>)[key], key);
          if (omitted(child)) continue;
          if (!first && !add(1)) return false;
          first = false;
          if (!text(key) || !add(1) || !visit(child, key)) return false;
        }
      }
      return true;
    } finally { ancestors.delete(value); }
  }
  try {
    const value = normalize(input, "");
    return omitted(value) || visit(value);
  } catch { return false; }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const identity = (value: unknown): value is string =>
  string(value, 120) && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value);
const format = (value: unknown): value is DesignFormat =>
  value === "portrait" || value === "square" || value === "story";
const color = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})|black|white|transparent)$/i.test(
    value,
  );

/** Retain only a small, balanced inline grammar. Unsafe HTML is discarded;
 * its existing plain-text mirror remains available to the renderer. This
 * works identically during server validation and in the browser. */
export function sanitizeRichText(value: unknown): string | undefined {
  if (!string(value, 20_000)) return undefined;
  const stack: string[] = [];
  const chunks = value.split(/(<[^>]*>)/g);
  const result: string[] = [];
  for (const chunk of chunks) {
    if (!chunk.startsWith("<")) {
      if (chunk.includes("<")) return undefined;
      result.push(chunk);
      continue;
    }
    if (/^<br\s*\/?\s*>$/i.test(chunk)) {
      result.push("<br>");
      continue;
    }
    const close = chunk.match(/^<\/(b|strong|i|em|u|s|strike|span)>$/i);
    if (close) {
      const tag = close[1].toLowerCase();
      if (stack.pop() !== tag) return undefined;
      result.push(`</${tag}>`);
      continue;
    }
    const basic = chunk.match(/^<(b|strong|i|em|u|s|strike)>$/i);
    if (basic) {
      const tag = basic[1].toLowerCase();
      stack.push(tag);
      result.push(`<${tag}>`);
      continue;
    }
    const span = chunk.match(
      /^<span((?:\s+(?:class|style|data-texture-id)=(?:"[^"]*"|'[^']*')){0,3})\s*>$/i,
    );
    if (!span) return undefined;
    const attrs: string[] = [];
    const seen = new Set<string>();
    for (const match of span[1].matchAll(/\s+(class|style|data-texture-id)=(?:"([^"]*)"|'([^']*)')/gi)) {
      const key = match[1].toLowerCase();
      const attributeValue = match[2] ?? match[3];
      if (seen.has(key)) return undefined;
      seen.add(key);
      if (key === "class") {
        if (
          !attributeValue.startsWith("gf-font-") ||
          !FONT_IDS.has(attributeValue.slice(8))
        )
          return undefined;
        attrs.push(`class="${attributeValue}"`);
      } else if (key === "data-texture-id") {
        if (!identity(attributeValue)) return undefined;
        attrs.push(`data-texture-id="${attributeValue}"`);
      } else {
        const declarations = attributeValue
          .split(";")
          .map((v) => v.trim())
          .filter(Boolean);
        if (
          !declarations.every((v) => {
            const fontSize = v.match(/^font-size\s*:\s*(\d+(?:\.\d+)?)px$/i);
            if (fontSize) return numberIn(Number(fontSize[1]), 1, 500);
            const textColor = v.match(/^color\s*:\s*(\S+)$/i);
            if (textColor) return color(textColor[1]);
            return /^(?:font-weight\s*:\s*(?:[1-9]00|normal|bold)|font-style\s*:\s*(?:normal|italic)|text-decoration(?:-line)?\s*:\s*(?:none|underline|line-through|underline line-through|line-through underline))$/i.test(v);
          })
        )
          return undefined;
        attrs.push(`style="${declarations.join("; ")}"`);
      }
    }
    stack.push("span");
    result.push(`<span${attrs.length ? ` ${attrs.join(" ")}` : ""}>`);
  }
  return stack.length ? undefined : result.join("");
}
const safeRichHtml = sanitizeRichText;

export function richTextToPlain(value: string): string {
  const safe = sanitizeRichText(value);
  if (safe === undefined) return "";
  return safe.replace(/<br>/g, "\n").replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (named[code.toLowerCase()]) return named[code.toLowerCase()];
    const point = code.toLowerCase().startsWith("#x") ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}

const BLEND_MODES = new Set(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
const optional = (value: Record<string, unknown>, key: string, check: (candidate: unknown) => boolean) => value[key] === undefined || check(value[key]);
const boolean = (value: unknown): value is boolean => typeof value === "boolean";
const choice = (values: string[]) => (value: unknown) => typeof value === "string" && values.includes(value);
const uniqueIds = (values: { id: string }[]) => new Set(values.map(value => value.id)).size === values.length;

export function isSafeVectorPath(value: unknown): value is string {
  if (!string(value, 20_000) || !/^[Mm][MmLlHhVvCcSsQqTtAaZz\d\s.,+\-eE]*$/.test(value)) return false;
  const grammar = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g;
  if (value.replace(grammar, "").replace(/[\s,]+/g, "")) return false;
  const tokens = value.match(grammar) ?? [], counts: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
  let index = 0, command = "";
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) {
      command = tokens[index++].toUpperCase();
      if (command === "Z") { command = ""; continue; }
    }
    const count = counts[command];
    if (!count || index + count > tokens.length) return false;
    for (let position = 0; position < count; position++) {
      const token = tokens[index + position], number = Number(token);
      if (/^[a-z]$/i.test(token) || !Number.isFinite(number) || Math.abs(number) > 100_000 || (command === "A" && [3, 4].includes(position) && number !== 0 && number !== 1)) return false;
    }
    index += count;
    if (command === "M") command = "L";
  }
  return tokens.length >= 3 && tokens[0]?.toUpperCase() === "M";
}

function parseLayout(value: unknown): CanvasLayout | null {
  if (!object(value)) return null;
  const result: CanvasLayout = {};
  for (const key of ["rulers", "showGuides"] as const) {
    if (!optional(value, key, boolean)) return null;
    if (value[key] !== undefined) result[key] = value[key] as boolean;
  }
  if (value.guides !== undefined) {
    if (!Array.isArray(value.guides) || value.guides.length > 200) return null;
    const guides: CanvasGuide[] = [];
    for (const guide of value.guides) {
      if (!object(guide) || !identity(guide.id) || !choice(["x", "y"])(guide.axis) || !numberIn(guide.position, -10_000, 10_000) || !optional(guide, "locked", boolean)) return null;
      guides.push({ id: guide.id, axis: guide.axis as "x" | "y", position: guide.position, ...(guide.locked !== undefined ? { locked: guide.locked as boolean } : {}) });
    }
    if (!uniqueIds(guides)) return null;
    result.guides = guides;
  }
  for (const key of ["margins", "safeArea"] as const) {
    const inset = value[key];
    if (inset !== undefined) {
      if (!object(inset) || !boolean(inset.enabled) || !["top", "right", "bottom", "left"].every(side => numberIn(inset[side], 0, 10_000))) return null;
      result[key] = { enabled: inset.enabled, top: inset.top as number, right: inset.right as number, bottom: inset.bottom as number, left: inset.left as number };
    }
  }
  if (value.grid !== undefined) {
    const grid = value.grid;
    if (!object(grid) || !boolean(grid.enabled) || !numberIn(grid.size, 1, 10_000) || !numberIn(grid.columns, 1, 100) || !Number.isInteger(grid.columns) || !numberIn(grid.rows, 1, 100) || !Number.isInteger(grid.rows) || !numberIn(grid.gutter, 0, 10_000)) return null;
    result.grid = { enabled: grid.enabled, size: grid.size, columns: grid.columns, rows: grid.rows, gutter: grid.gutter };
  }
  if (value.snapping !== undefined) {
    const snap = value.snapping;
    if (!object(snap) || !["enabled", "objects", "page", "guides", "grid", "spacing"].every(key => boolean(snap[key])) || !numberIn(snap.tolerance, 0, 100)) return null;
    result.snapping = { enabled: snap.enabled as boolean, objects: snap.objects as boolean, page: snap.page as boolean, guides: snap.guides as boolean, grid: snap.grid as boolean, spacing: snap.spacing as boolean, tolerance: snap.tolerance };
  }
  return result;
}

function parseBaseExtensions(value: Record<string, unknown>): Partial<CanvasElementBase> | null {
  const result: Partial<CanvasElementBase> = {};
  if (!optional(value, "templateRole", choice(["brand", "media"]))) return null;
  if (value.templateRole !== undefined) result.templateRole = value.templateRole as CanvasElementBase["templateRole"];
  if (value.smartFlow !== undefined) {
    const flow = value.smartFlow;
    if (!object(flow) || !string(flow.after, 200) || !flow.after || !numberIn(flow.gap, 0, 1000) || !numberIn(flow.bottom, -10000, 10000) || !optional(flow, "edge", choice(["top"])) || !optional(flow, "resize", boolean)) return null;
    result.smartFlow = { after: flow.after, gap: flow.gap, bottom: flow.bottom, ...(flow.edge === "top" ? { edge: "top" } : {}), ...(typeof flow.resize === "boolean" ? { resize: flow.resize } : {}) };
  }
  for (const key of ["groupId", "componentId", "componentInstanceId", "componentSourceId", "colorRoleId"] as const) {
    if (!optional(value, key, identity)) return null;
    if (value[key] !== undefined) result[key] = value[key] as string;
  }
  if (!optional(value, "slot", candidate => string(candidate, 200)) || !optional(value, "master", boolean) || !optional(value, "blur", candidate => numberIn(candidate, 0, 500)) || !optional(value, "blendMode", candidate => typeof candidate === "string" && BLEND_MODES.has(candidate))) return null;
  for (const key of ["slot", "master", "blur", "blendMode"] as const) if (value[key] !== undefined) Object.assign(result, { [key]: value[key] });
  if (value.clipBounds !== undefined) {
    const bounds = value.clipBounds;
    if (!object(bounds) || !numberIn(bounds.x, -10_000, 10_000) || !numberIn(bounds.y, -10_000, 10_000) || !numberIn(bounds.width, .0001, 10_000) || !numberIn(bounds.height, .0001, 10_000)) return null;
    result.clipBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  if (value.protected !== undefined) {
    if (!Array.isArray(value.protected) || value.protected.length > 4 || !value.protected.every(choice(["content", "position", "style", "delete"]))) return null;
    result.protected = Array.from(new Set(value.protected)) as ProtectedProperty[];
  }
  if (value.strokeDash !== undefined) {
    if (!Array.isArray(value.strokeDash) || value.strokeDash.length > 20 || !value.strokeDash.every(candidate => numberIn(candidate, 0, 1000))) return null;
    result.strokeDash = [...value.strokeDash];
  }
  if (value.anchors !== undefined) {
    const anchors = value.anchors;
    if (!object(anchors) || !choice(["left", "center", "right", "stretch"])(anchors.horizontal) || !choice(["top", "middle", "bottom", "stretch"])(anchors.vertical)) return null;
    result.anchors = { horizontal: anchors.horizontal as NonNullable<CanvasElementBase["anchors"]>["horizontal"], vertical: anchors.vertical as NonNullable<CanvasElementBase["anchors"]>["vertical"] };
  }
  if (value.gradient !== undefined) {
    const gradient = value.gradient;
    if (!object(gradient) || !choice(["linear", "radial"])(gradient.type) || !numberIn(gradient.angle, -3600, 3600) || !Array.isArray(gradient.stops) || gradient.stops.length < 2 || gradient.stops.length > 20) return null;
    const stops: CanvasGradient["stops"] = [];
    for (const stop of gradient.stops) {
      if (!object(stop) || !color(stop.color) || !numberIn(stop.position, 0, 100)) return null;
      stops.push({ color: stop.color, position: stop.position });
    }
    result.gradient = { type: gradient.type as CanvasGradient["type"], angle: gradient.angle, stops };
  }
  if (value.shadow !== undefined) {
    const shadow = value.shadow;
    if (!object(shadow) || !color(shadow.color) || !numberIn(shadow.offsetX, -1000, 1000) || !numberIn(shadow.offsetY, -1000, 1000) || !numberIn(shadow.blur, 0, 1000) || !numberIn(shadow.spread, -1000, 1000)) return null;
    result.shadow = { color: shadow.color, offsetX: shadow.offsetX, offsetY: shadow.offsetY, blur: shadow.blur, spread: shadow.spread };
  }
  return result;
}

function parseTextExtensions(value: Record<string, unknown>): Partial<TextElement> | null {
  if (!["autoFitMinFontSize","autoFitMaxFontSize","autoFitFontSize"].every(key=>optional(value,key,candidate=>numberIn(candidate,1,500))) || value.autoFitMinFontSize!==undefined && value.autoFitMaxFontSize!==undefined && Number(value.autoFitMinFontSize)>Number(value.autoFitMaxFontSize)) return null;
  if (!optional(value, "textMode", choice(["fixed", "auto-height", "auto-fit"])) || !optional(value, "verticalAlign", choice(["top", "middle", "bottom"])) || !optional(value, "listStyle", choice(["none", "bullet", "number"])) || !optional(value, "padding", candidate => numberIn(candidate, 0, 1000)) || !optional(value, "paragraphSpacing", candidate => numberIn(candidate, 0, 1000)) || !optional(value, "strikethrough", boolean) || !optional(value, "textStyleId", identity)) return null;
  const result: Partial<TextElement> = {};
  if (value.smartText !== undefined) {
    const smart = value.smartText;
    if (!object(smart) || !choice(["cover", "heading", "body"])(smart.role) || ![0, 2, 3, 4].includes(Number(smart.lines)) || typeof smart.lines !== "number" || !numberIn(smart.minFontSize, 1, 500) || !numberIn(smart.maxFontSize, smart.minFontSize as number, 500) || !numberIn(smart.maxHeight, 1, 10000)) return null;
    result.smartText = { role: smart.role as "cover" | "heading" | "body", lines: smart.lines as 0 | 2 | 3 | 4, minFontSize: smart.minFontSize, maxFontSize: smart.maxFontSize, maxHeight: smart.maxHeight };
  }
  for (const key of ["textMode", "verticalAlign", "listStyle", "padding", "paragraphSpacing", "strikethrough", "textStyleId", "autoFitMinFontSize", "autoFitMaxFontSize", "autoFitFontSize"] as const) if (value[key] !== undefined) Object.assign(result, { [key]: value[key] });
  if (value.richText !== undefined) {
    const sanitized = sanitizeRichText(value.richText);
    if (sanitized !== undefined) result.richText = sanitized;
  }
  if (value.textureFill !== undefined) {
    const texture = parseShapeImageFill(value.textureFill);
    if (!texture) return null;
    result.textureFill = texture;
  }
  if (value.wordTextures !== undefined) {
    if (!Array.isArray(value.wordTextures) || value.wordTextures.length > 30) return null;
    const textures: NonNullable<TextElement["wordTextures"]> = [];
    for (const texture of value.wordTextures) {
      if (!object(texture) || !identity(texture.id)) return null;
      const fill = parseShapeImageFill(texture);
      if (!fill) return null;
      textures.push({ ...fill, id: texture.id });
    }
    if (!uniqueIds(textures)) return null;
    result.wordTextures = textures;
  }
  const textureIds = new Set(result.wordTextures?.map(texture => texture.id));
  for (const reference of result.richText?.matchAll(/<span\b[^>]*\bdata-texture-id="([a-zA-Z0-9_-]+)"/g) ?? []) if (!textureIds.has(reference[1])) return null;
  return result;
}

function parseResources(value: Record<string, unknown>): DocumentResources | null {
  const resources: DocumentResources = {};
  if (!optional(value, "folderId", identity) || !optional(value, "favorite", boolean) || !optional(value, "deletedAt", candidate => string(candidate, 40) && Number.isFinite(Date.parse(candidate)))) return null;
  for (const key of ["folderId", "favorite", "deletedAt"] as const) if (value[key] !== undefined) Object.assign(resources, { [key]: value[key] });
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > 40 || !value.tags.every(tag => string(tag, 100))) return null;
    resources.tags = Array.from(new Set(value.tags));
  }
  if (value.customSize !== undefined) {
    if (!object(value.customSize) || !numberIn(value.customSize.width, 100, 8192) || !numberIn(value.customSize.height, 100, 8192)) return null;
    resources.customSize = { width: value.customSize.width, height: value.customSize.height };
  }
  if (value.masterScene !== undefined) {
    const master = parseCanvas(value.masterScene);
    if (!master) return null;
    resources.masterScene = master;
  }
  if (value.styles !== undefined) {
    if (!Array.isArray(value.styles) || value.styles.length > 80) return null;
    const styles: TextStyle[] = [];
    for (const style of value.styles) {
      if (!object(style) || !identity(style.id) || !string(style.name, 200) || !optional(style,"workspaceSourceId",identity)) return null;
      const parsed = parseCanvas({ background: "transparent", elements: [{ ...createCanvasElement("text"), ...style, type: "text", text: "", x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1, locked: false }] });
      const element = parsed?.elements[0];
      if (!element || element.type !== "text") return null;
      const textStyle: Record<string, unknown> = { id: style.id, name: style.name, ...(style.workspaceSourceId !== undefined ? {workspaceSourceId:style.workspaceSourceId} : {}) };
      for (const key of ["font", "fontSize", "fontWeight", "italic", "underline", "color", "align", "lineHeight", "letterSpacing", "verticalAlign", "padding", "paragraphSpacing", "strikethrough", "listStyle", "textureFill", "autoFitMinFontSize", "autoFitMaxFontSize"] as const) if (element[key] !== undefined) textStyle[key] = element[key];
      styles.push(textStyle as TextStyle);
    }
    if (!uniqueIds(styles)) return null;
    resources.styles = styles;
  }
  if (value.colorRoles !== undefined) {
    if (!Array.isArray(value.colorRoles) || value.colorRoles.length > 40) return null;
    const roles: NonNullable<DocumentResources["colorRoles"]> = [];
    for (const role of value.colorRoles) {
      if (!object(role) || !identity(role.id) || !string(role.name, 200) || !color(role.color)) return null;
      roles.push({ id: role.id, name: role.name, color: role.color });
    }
    if (!uniqueIds(roles)) return null;
    resources.colorRoles = roles;
  }
  if (value.components !== undefined) {
    if (!Array.isArray(value.components) || value.components.length > 40) return null;
    const components: ReusableComponent[] = [];
    for (const component of value.components) {
      if (!object(component) || !identity(component.id) || !string(component.name, 200) || !numberIn(component.width, 1, 10_000) || !numberIn(component.height, 1, 10_000) || !optional(component,"workspaceSourceId",identity)) return null;
      const scene = parseCanvas(component.scene);
      if (!scene) return null;
      components.push({ id: component.id, name: component.name, width: component.width, height: component.height, scene, ...(component.workspaceSourceId !== undefined ? {workspaceSourceId:component.workspaceSourceId as string} : {}) });
    }
    if (!uniqueIds(components)) return null;
    resources.components = components;
  }
  if (value.parameters !== undefined) {
    if (!Array.isArray(value.parameters) || value.parameters.length > 100) return null;
    const parameters: TemplateParameter[] = [];
    for (const parameter of value.parameters) {
      if (!object(parameter) || !identity(parameter.id) || !string(parameter.name, 200) || !choice(["text", "image", "color"])(parameter.type) || !optional(parameter, "defaultValue", candidate => string(candidate, 20_000)) || !optional(parameter, "required", boolean) || !optional(parameter, "maxLength", candidate => numberIn(candidate, 1, 20_000) && Number.isInteger(candidate))) return null;
      if (parameter.defaultValue !== undefined && parameter.defaultValue !== "" && (parameter.type === "color" ? !color(parameter.defaultValue) : parameter.type === "image" ? !safeImageUrl(parameter.defaultValue) : false)) return null;
      parameters.push({ id: parameter.id, name: parameter.name, type: parameter.type as TemplateParameter["type"], ...(parameter.defaultValue !== undefined ? { defaultValue: parameter.defaultValue as string } : {}), ...(parameter.required !== undefined ? { required: parameter.required as boolean } : {}), ...(parameter.maxLength !== undefined ? { maxLength: parameter.maxLength as number } : {}) });
    }
    if (!uniqueIds(parameters)) return null;
    resources.parameters = parameters;
  }
  return resources;
}

const NUMERIC_STYLE: Partial<Record<keyof SlideStyle, [number, number]>> = {
  textX: [-400, 400],
  textY: [-400, 400],
  textScale: [0.5, 2.5],
  textOpacity: [0, 1],
  lineHeight: [0.7, 2],
  letterSpacing: [-0.2, 1],
  fontWeight: [100, 900],
  mediaOpacity: [0, 1],
  mediaRadius: [0, 200],
  cardScale: [0.4, 1.6],
  cardW: [0.4, 1.6],
  cardH: [0.4, 1.6],
  mediaX: [-200, 200],
  mediaY: [-200, 200],
  mediaW: [20, 320],
  mediaH: [20, 320],
  mediaInX: [-50, 50],
  mediaInY: [-50, 50],
  mediaScale: [0.4, 4],
  mediaStart: [0, 86_400],
  mediaEnd: [0, 86_400],
};

function parseStyle(value: unknown): SlideStyle | null {
  if (
    !object(value) ||
    typeof value.template !== "string" ||
    !LAYOUTS.has(value.template)
  )
    return null;
  const style: SlideStyle = {
    template: value.template as SlideStyle["template"],
  };
  for (const key of [
    "heading",
    "body",
    "creditText",
    "creditSource",
  ] as const) {
    if (value[key] !== undefined) {
      if (!string(value[key], 10_000)) return null;
      style[key] = value[key];
    }
  }
  for (const key of ["headingHtml", "bodyHtml"] as const) {
    const html = safeRichHtml(value[key]);
    if (html !== undefined) style[key] = html;
  }
  if (typeof value.font === "string" && FONT_IDS.has(value.font))
    style.font = value.font;
  if (
    value.align === "top" ||
    value.align === "center" ||
    value.align === "bottom"
  )
    style.align = value.align;
  if (
    value.textAlign === "left" ||
    value.textAlign === "center" ||
    value.textAlign === "right"
  )
    style.textAlign = value.textAlign;
  if (value.bgMode === "color" || value.bgMode === "blur")
    style.bgMode = value.bgMode;
  if (color(value.bgColor)) style.bgColor = value.bgColor;
  if (color(value.textColor)) style.textColor = value.textColor;
  if (typeof value.credit === "boolean") style.credit = value.credit;
  for (const [key, bounds] of Object.entries(NUMERIC_STYLE)) {
    const n = value[key];
    if (typeof n === "number" && Number.isFinite(n))
      Object.assign(style, {
        [key]: Math.max(bounds[0], Math.min(bounds[1], n)),
      });
  }
  return style;
}

function parseBrand(value: unknown): BrandKit | null {
  if (!object(value) || !string(value.name, 200) || typeof value.font !== "string" || !FONT_IDS.has(value.font) || !color(value.background) || !color(value.text)) return null;
  return { name: value.name, font: value.font, background: value.background, text: value.text };
}

function parseBrandKits(value: unknown): SavedBrandKit[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BRAND_KITS) return null;
  const kits: SavedBrandKit[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const brand = parseBrand(candidate);
    if (!brand || !object(candidate) || !identity(candidate.id) || ids.has(candidate.id) ||
      !Array.isArray(candidate.palette) || candidate.palette.length > MAX_BRAND_COLORS || !candidate.palette.every(color) ||
      !Array.isArray(candidate.assets) || candidate.assets.length > MAX_BRAND_ASSETS) return null;
    const assets: BrandAsset[] = [];
    const assetIds = new Set<string>();
    for (const asset of candidate.assets) {
      if (!object(asset) || !identity(asset.id) || assetIds.has(asset.id) || !string(asset.name, 200) ||
        !string(asset.src, MAX_BRAND_ASSET_CHARS) || !safeImageUrl(asset.src) ||
        !numberIn(asset.width, 1, 100_000) || !numberIn(asset.height, 1, 100_000) ||
        (asset.kind !== "logo" && asset.kind !== "image")) return null;
      const metadata = parsePhotoMetadata(asset);
      if (!metadata || !optional(asset, "previewSrc", safeImageUrl) || !optional(asset, "favorite", boolean) || !optional(asset, "variant", choice(["universal", "light", "dark"])) || !optional(asset, "tags", candidate => Array.isArray(candidate) && candidate.length <= 20 && candidate.every(tag => string(tag, 40)))) return null;
      assets.push({ ...metadata, id: asset.id, name: asset.name, src: asset.src, width: asset.width, height: asset.height, kind: asset.kind, ...(asset.previewSrc !== undefined ? { previewSrc: asset.previewSrc as string } : {}), ...(asset.favorite !== undefined ? { favorite: asset.favorite as boolean } : {}), ...(asset.variant !== undefined ? { variant: asset.variant as BrandAsset["variant"] } : {}), ...(asset.tags !== undefined ? { tags: [...asset.tags as string[]] } : {}) });
      assetIds.add(asset.id);
    }
    kits.push({ ...brand, id: candidate.id, palette: [...candidate.palette], assets });
    ids.add(candidate.id);
  }
  return kits;
}

function safeImageUrl(value: unknown): value is string {
  if (!string(value, MAX_IMAGE_CHARS) || !value) return false;
  if (isSafeBrandSvgUrl(value)) return true;
  if (value.startsWith("data:")) {
    const match = value.match(
      /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/,
    );
    if (!match || match[2].length % 4 !== 0) return false;
    try {
      const head = atob(match[2].slice(0, 64));
      if (match[1] === "png") return head.startsWith("\x89PNG\r\n\x1a\n");
      if (match[1] === "jpeg") return head.startsWith("\xff\xd8\xff");
      if (match[1] === "gif")
        return head.startsWith("GIF87a") || head.startsWith("GIF89a");
      if (match[1] === "webp")
        return head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
      return head.slice(4, 8) === "ftyp" && /avif|avis/.test(head.slice(8));
    } catch {
      return false;
    }
  }
  if (/^\/(?!\/)[a-zA-Z0-9_./%?=&-]+$/.test(value))
    return !/%(?:2f|5c)/i.test(value);
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

const numberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

function parsePhotoMetadata(value: Record<string, unknown>): PhotoMetadata | null {
  if (!optional(value,"publicAlt",candidate=>string(candidate,2000)) || !optional(value,"previewSrc",safeImageUrl)) return null;
  if (!optional(value, "directive", candidate => string(candidate, 2000)) || !optional(value, "rightsNote", candidate => string(candidate, 2000))) return null;
  const result: PhotoMetadata = {};
  for (const key of ["directive", "rightsNote", "publicAlt", "previewSrc"] as const) if (value[key] !== undefined) result[key] = value[key] as string;
  if (value.sourceUrl !== undefined) {
    if (!string(value.sourceUrl, 4000)) return null;
    try { const url = new URL(value.sourceUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null; } catch { return null; }
    result.sourceUrl = value.sourceUrl;
  }
  if (value.provenance !== undefined) {
    const provenance = value.provenance;
    if (!object(provenance) || !optional(provenance, "source", candidate => string(candidate, 200)) || !optional(provenance, "imageId", identity) || !optional(provenance, "description", candidate => string(candidate, 10_000)) || !optional(provenance, "cosmosManual", boolean)) return null;
    result.provenance = {};
    for (const key of ["source", "imageId", "description", "cosmosManual"] as const) if (provenance[key] !== undefined) Object.assign(result.provenance, { [key]: provenance[key] });
  }
  return result;
}

/** Validate nested photo fills with the same URL and crop constraints as image layers. */
export function parseShapeImageFill(value: unknown): ShapeImageFill | null {
  if (object(value) && (!optional(value, "previewSrc", safeImageUrl) || !optional(value, "publicAlt", candidate => string(candidate, 2000)))) return null;
  if (!object(value) || !safeImageUrl(value.src) || !choice(["cover", "contain"])(value.objectFit) || !numberIn(value.cropX, 0, 100) || !numberIn(value.cropY, 0, 100) || !optional(value, "alt", candidate => string(candidate, 10_000)) || !optional(value, "cropScale", candidate => numberIn(candidate, .1, 20)) || !optional(value, "flipX", boolean) || !optional(value, "flipY", boolean) || !optional(value, "intrinsicWidth", candidate => numberIn(candidate, 1, 100_000)) || !optional(value, "intrinsicHeight", candidate => numberIn(candidate, 1, 100_000))) return null;
  const metadata = parsePhotoMetadata(value);
  if (!metadata) return null;
  const result: ShapeImageFill = { ...metadata, src: value.src, objectFit: value.objectFit as ShapeImageFill["objectFit"], cropX: value.cropX, cropY: value.cropY };
  for (const key of ["alt", "publicAlt", "previewSrc", "cropScale", "flipX", "flipY", "intrinsicWidth", "intrinsicHeight"] as const) if (value[key] !== undefined) Object.assign(result, { [key]: value[key] });
  return result;
}

export function parseCanvas(value: unknown): CanvasScene | null {
  if (
    !object(value) ||
    !color(value.background) ||
    !Array.isArray(value.elements) ||
    value.elements.length > 100
  )
    return null;
  const scene: CanvasScene = { background: value.background, elements: [] };
  if (value.layout !== undefined) {
    const layout = parseLayout(value.layout);
    if (!layout) return null;
    scene.layout = layout;
  }
  if (value.groups !== undefined) {
    if (!Array.isArray(value.groups) || value.groups.length > 100) return null;
    const groups: CanvasGroup[] = [];
    for (const group of value.groups) {
      if (!object(group) || !identity(group.id) || !string(group.name, 200) || !optional(group, "parentId", identity) || !optional(group, "locked", boolean) || !optional(group, "hidden", boolean) || !optional(group,"opacity",candidate=>numberIn(candidate,0,1))) return null;
      groups.push({ id: group.id, name: group.name, ...(group.parentId !== undefined ? { parentId: group.parentId as string } : {}), ...(group.locked !== undefined ? { locked: group.locked as boolean } : {}), ...(group.hidden !== undefined ? { hidden: group.hidden as boolean } : {}), ...(group.opacity!==undefined?{opacity:group.opacity as number}:{}) });
    }
    if (!uniqueIds(groups)) return null;
    const map = new Map(groups.map(group => [group.id, group]));
    for (const group of groups) {
      const seen = new Set([group.id]);
      let parentId = group.parentId;
      while (parentId) {
        if (seen.has(parentId) || !map.has(parentId)) return null;
        seen.add(parentId); parentId = map.get(parentId)!.parentId;
      }
    }
    scene.groups = groups;
  }
  const ids = new Set<string>();
  for (const element of value.elements) {
    if (
      !object(element) ||
      !identity(element.id) ||
      ids.has(element.id) ||
      !string(element.name, 200) ||
      !numberIn(element.x, -10_000, 10_000) ||
      !numberIn(element.y, -10_000, 10_000) ||
      !numberIn(element.width, 1, 10_000) ||
      !numberIn(element.height, 1, 10_000) ||
      !numberIn(element.rotation, -3600, 3600) ||
      !numberIn(element.opacity, 0, 1) ||
      typeof element.locked !== "boolean" ||
      (element.hidden !== undefined && typeof element.hidden !== "boolean")
    )
      return null;
    const extensions = parseBaseExtensions(element);
    if (!extensions || (extensions.groupId && !scene.groups?.some(group => group.id === extensions.groupId))) return null;
    const base: CanvasElementBase = {
      ...extensions,
      id: element.id,
      name: element.name,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      opacity: element.opacity,
      locked: element.locked,
      ...(typeof element.hidden === "boolean" ? { hidden: element.hidden } : {}),
    };
    if (element.type === "text") {
      if (
        !string(element.text, 20_000) ||
        typeof element.font !== "string" ||
        !FONT_IDS.has(element.font) ||
        !numberIn(element.fontSize, 1, 500) ||
        !numberIn(element.fontWeight, 100, 900) ||
        typeof element.italic !== "boolean" ||
        typeof element.underline !== "boolean" ||
        !color(element.color) ||
        !numberIn(element.lineHeight, 0.5, 5) ||
        !numberIn(element.letterSpacing, -20, 100) ||
        (element.align !== "left" &&
          element.align !== "center" &&
          element.align !== "right")
      )
        return null;
      const textExtensions = parseTextExtensions(element);
      if (!textExtensions) return null;
      scene.elements.push({
        ...textExtensions,
        ...base,
        type: "text",
        text: element.text,
        font: element.font,
        fontSize: element.fontSize,
        fontWeight: element.fontWeight,
        italic: element.italic,
        underline: element.underline,
        color: element.color,
        align: element.align,
        lineHeight: element.lineHeight,
        letterSpacing: element.letterSpacing,
      });
    } else if (element.type === "image") {
      if (!optional(element, "previewSrc", safeImageUrl) || !optional(element, "publicAlt", candidate => string(candidate, 2000))) return null;
      if (
        !safeImageUrl(element.src) ||
        (element.fit !== "cover" && element.fit !== "contain") ||
        !numberIn(element.cropX, 0, 100) ||
        !numberIn(element.cropY, 0, 100) ||
        !numberIn(element.radius, 0, 5000)
      )
        return null;
      if (!optional(element, "cropScale", candidate => numberIn(candidate, 0.1, 20)) || !optional(element, "flipX", boolean) || !optional(element, "flipY", boolean) || !optional(element, "mask", choice(["none", "ellipse", "triangle", "diamond"])) || !optional(element, "intrinsicWidth", candidate => numberIn(candidate, 1, 100_000)) || !optional(element, "intrinsicHeight", candidate => numberIn(candidate, 1, 100_000))) return null;
      const imageExtensions: Partial<ImageElement> = {};
      const photoMetadata = parsePhotoMetadata(element);
      if (!photoMetadata) return null;
      for (const key of ["publicAlt", "previewSrc", "cropScale", "flipX", "flipY", "mask", "intrinsicWidth", "intrinsicHeight"] as const) if (element[key] !== undefined) Object.assign(imageExtensions, { [key]: element[key] });
      scene.elements.push({
        ...photoMetadata,
        ...imageExtensions,
        ...base,
        type: "image",
        src: element.src,
        fit: element.fit,
        cropX: element.cropX,
        cropY: element.cropY,
        radius: element.radius,
      });
    } else if (element.type === "shape") {
      if (
        !choice(["rectangle", "ellipse", "triangle", "diamond", "polygon", "star", "arrow", "path"])(element.shape) ||
        !color(element.fill) ||
        !color(element.stroke) ||
        !numberIn(element.strokeWidth, 0, 200) ||
        !numberIn(element.radius, 0, 5000)
      )
        return null;
      if (!optional(element, "sides", candidate => numberIn(candidate, 3, 30) && Number.isInteger(candidate)) || !optional(element, "starPoints", candidate => numberIn(candidate, 3, 30) && Number.isInteger(candidate)) || !optional(element, "innerRadius", candidate => numberIn(candidate, 0.05, 0.95)) || !optional(element, "path", isSafeVectorPath) || (element.shape === "path" && !isSafeVectorPath(element.path)) || !optional(element, "viewBox", candidate => typeof candidate === "string" && candidate.trim().split(/[\s,]+/).length === 4 && candidate.trim().split(/[\s,]+/).every(part => Number.isFinite(Number(part)) && Math.abs(Number(part)) <= 100_000) && Number(candidate.trim().split(/[\s,]+/)[2]) > 0 && Number(candidate.trim().split(/[\s,]+/)[3]) > 0)) return null;
      const shapeExtensions: Partial<ShapeElement> = {};
      if (!optional(element, "fillRule", choice(["nonzero", "evenodd"])) || !optional(element, "strokeAlign", choice(["inside", "center", "outside"]))) return null;
      for (const key of ["sides", "starPoints", "innerRadius", "path", "viewBox", "fillRule", "strokeAlign"] as const) if (element[key] !== undefined) Object.assign(shapeExtensions, { [key]: element[key] });
      if (element.imageFill !== undefined) {
        const fill = parseShapeImageFill(element.imageFill);
        if (!fill) return null;
        shapeExtensions.imageFill = fill;
      }
      scene.elements.push({
        ...shapeExtensions,
        ...base,
        type: "shape",
        shape: element.shape as ShapeElement["shape"],
        fill: element.fill,
        stroke: element.stroke,
        strokeWidth: element.strokeWidth,
        radius: element.radius,
      });
    } else return null;
    ids.add(element.id);
  }
  return scene;
}

export function parseCanvasScene(value: unknown): CanvasScene | null {
  return parseCanvas(value);
}

export function parseBuiltInTemplateState(value: unknown): BuiltInTemplateState | null {
  if (!object(value) || !identity(value.id) || !BUILT_IN_TEMPLATES.some(template => template.id === value.id) || !string(value.updatedAt, 40) || !Number.isFinite(Date.parse(value.updatedAt)) || !optional(value, "deletedAt", candidate => string(candidate, 40) && Number.isFinite(Date.parse(candidate))) || !optional(value, "permanentlyDeleted", boolean)) return null;
  return { id: value.id, updatedAt: value.updatedAt, ...(value.deletedAt !== undefined ? { deletedAt: value.deletedAt as string } : {}), ...(value.permanentlyDeleted !== undefined ? { permanentlyDeleted: value.permanentlyDeleted as boolean } : {}) };
}

function parsePages(value: unknown): DesignPage[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 20) return null;
  const pages: DesignPage[] = [];
  const pageIds = new Set<string>();
  const imageIds = new Set<string>();
  for (const p of value) {
    if (!object(p) || !identity(p.id) || pageIds.has(p.id) || !object(p.image))
      return null;
    const image = p.image;
    if (
      !identity(image.id) ||
      imageIds.has(image.id) ||
      !safeImageUrl(image.url)
    )
      return null;
    if (image.mediaType !== undefined && image.mediaType !== "image")
      return null;
    if (
      typeof image.width !== "number" ||
      !Number.isFinite(image.width) ||
      image.width <= 0 ||
      image.width > 30_000 ||
      typeof image.height !== "number" ||
      !Number.isFinite(image.height) ||
      image.height <= 0 ||
      image.height > 30_000
    )
      return null;
    const style = parseStyle(p.style);
    if (!style) return null;
    const canvas = p.canvas === undefined ? undefined : parseCanvas(p.canvas);
    if (canvas === null) return null;
    if (!optional(p, "label", candidate => string(candidate, 200)) || !optional(p, "useMaster", boolean)) return null;
    if (!optional(p, "publicDescription", candidate => string(candidate, 5000)) || !optional(p, "readingOrder", candidate => Array.isArray(candidate) && candidate.length <= 200 && candidate.every(identity) && new Set(candidate).size === candidate.length)) return null;
    const source: StoryImage["source"] = [
      "google",
      "pinterest",
      "apify",
      "cosmos_manual",
      "web",
      "x",
      "upload",
    ].includes(String(image.source))
      ? (image.source as StoryImage["source"])
      : "upload";
    pages.push({
      id: p.id,
      style,
      ...(p.label !== undefined ? { label: p.label as string } : {}),
      ...(p.useMaster !== undefined ? { useMaster: p.useMaster as boolean } : {}),
      ...(p.publicDescription !== undefined ? { publicDescription: p.publicDescription as string } : {}),
      ...(p.readingOrder !== undefined ? { readingOrder: [...p.readingOrder as string[]] } : {}),
      ...(canvas ? { canvas } : {}),
      image: {
        id: image.id,
        url: image.url,
        width: image.width,
        height: image.height,
        source,
        kind: image.kind === "real_subject" ? "real_subject" : "atmospheric",
        directive: string(image.directive, 2000) ? image.directive : "",
        rightsNote: string(image.rightsNote, 2000) ? image.rightsNote : "",
        cosmosManual: image.cosmosManual === true,
        ...(string(image.description, 5000)
          ? { description: image.description }
          : {}),
        ...(string(image.sourceUrl, 4000) &&
        /^https?:\/\//.test(image.sourceUrl)
          ? { sourceUrl: image.sourceUrl }
          : {}),
        mediaType: "image",
      },
    });
    pageIds.add(p.id);
    imageIds.add(image.id);
  }
  return pages;
}

function normalizeReadingOrders(pages:DesignPage[],continuous?:CanvasScene,master?:CanvasScene) {
  for(const page of pages)if(page.readingOrder){const available=new Set([...(continuous?.elements??page.canvas?.elements??[]),...(master?.elements??[])].map(element=>element.id));page.readingOrder=page.readingOrder.filter(id=>available.has(id));}
}

/** Validate untrusted imports and browser storage before anything is rendered.
 * Limits are deliberately shared by both paths. The returned object contains
 * only known fields, fresh objects, safe image URLs, and normalized styles. */
export function parseLibrary(input: unknown): EditorLibrary | null {
  try {
    if (typeof input === "string") {
      // Legacy JSON backups may repeat the same embedded image many times.
      // Packed saves remain bounded separately by the 12 MiB wire limit.
      if (input.length > 200 * 1024 * 1024) return null;
      input = JSON.parse(input);
    }
    if (!fitsJsonCharacterLimit(input, MAX_LIBRARY_CHARS, true)) return null;
    if (
      !object(input) ||
      (input.version !== 1 && input.version !== 2) ||
      !Array.isArray(input.designs) ||
      input.designs.length > 150 ||
      !Array.isArray(input.templates) ||
      input.templates.length > 80 ||
      !object(input.brand)
    )
      return null;
    const b = parseBrand(input.brand);
    if (!b) return null;
    const kits = input.brandKits === undefined
      ? [{ ...b, id: DEFAULT_BRAND_KIT_ID, palette: Array.from(new Set([b.background, b.text])), assets: [] }]
      : parseBrandKits(input.brandKits);
    const activeId = input.activeBrandKitId;
    if (!kits || (activeId !== undefined && (!identity(activeId) || !kits.some(kit => kit.id === activeId)))) return null;
    const active = kits.find(kit => kit.id === activeId) ?? kits[0];
    const library: EditorLibrary = {
      version: 2,
      designs: [],
      templates: [],
      brand: brandProjection(active),
      brandKits: kits,
      activeBrandKitId: active.id,
    };
    if (input.folders !== undefined) {
      if (!Array.isArray(input.folders) || input.folders.length > 80) return null;
      const folders: { id: string; name: string }[] = [];
      for (const folder of input.folders) {
        if (!object(folder) || !identity(folder.id) || !string(folder.name, 200)) return null;
        folders.push({ id: folder.id, name: folder.name });
      }
      if (!uniqueIds(folders)) return null;
      library.folders = folders;
    }
    if (input.builtInTemplateStates !== undefined) {
      if (!Array.isArray(input.builtInTemplateStates) || input.builtInTemplateStates.length > BUILT_IN_TEMPLATES.length) return null;
      const states: BuiltInTemplateState[] = [];
      for (const candidate of input.builtInTemplateStates) {
        const state = parseBuiltInTemplateState(candidate);
        if (!state) return null;
        states.push(state);
      }
      if (!uniqueIds(states)) return null;
      library.builtInTemplateStates = states;
    }
    const designIds = new Set<string>();
    const workspaceResources = parseResources({ styles: input.workspaceStyles, components: input.workspaceComponents });
    if (!workspaceResources) return null;
    if (input.workspaceStyles !== undefined) library.workspaceStyles = workspaceResources.styles;
    if (input.workspaceComponents !== undefined) library.workspaceComponents = workspaceResources.components;
    const templateIds = new Set<string>();
    for (const d of input.designs) {
      if (
        !object(d) ||
        !identity(d.id) ||
        designIds.has(d.id) ||
        !identity(d.templateId) ||
        !string(d.name, 200) ||
        !format(d.format) ||
        !string(d.caption, 20_000) ||
        !string(d.createdAt, 40) ||
        !Number.isFinite(Date.parse(d.createdAt)) ||
        !string(d.updatedAt, 40) ||
        !Number.isFinite(Date.parse(d.updatedAt)) ||
        (d.purpose !== undefined && d.purpose !== "template") ||
        (d.editingTemplateId !== undefined &&
          (d.purpose !== "template" || !identity(d.editingTemplateId)))
      )
        return null;
      const pages = parsePages(d.pages);
      if (!pages) return null;
      const resources = parseResources(d);
      if (!resources || !optional(d, "reviewStatus", choice(["draft", "review", "approved"]))) return null;
      const metadata: Pick<DesignDocument, "reviewStatus" | "comments" | "versions" | "agentOperations"> = {};
      if (d.agentOperations !== undefined) {
        if (!Array.isArray(d.agentOperations) || d.agentOperations.length > 20) return null;
        const operations: NonNullable<DesignDocument["agentOperations"]> = [];
        for (const operation of d.agentOperations) {
          if (!object(operation) || typeof operation.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(operation.id) || typeof operation.inputHash !== "string" || !/^[a-f0-9]{64}$/.test(operation.inputHash)) return null;
          operations.push({id: operation.id, inputHash: operation.inputHash});
        }
        if (!uniqueIds(operations)) return null;
        metadata.agentOperations = operations;
      }
      const reviewLinks: NonNullable<DesignDocument["reviewLinks"]> = [];
      if (d.reviewLinks !== undefined) {
        if (!Array.isArray(d.reviewLinks) || d.reviewLinks.length > 20) return null;
        for (const link of d.reviewLinks) {
          if (!object(link) || !identity(link.id) || !string(link.url, 4000) || !string(link.expiresAt, 40) || !Number.isFinite(Date.parse(link.expiresAt)) || /[\s\\]/.test(link.url)) return null;
          if (link.url.startsWith("/") ? link.url.startsWith("//") : !/^https:\/\//i.test(link.url)) return null;
          if (link.url.startsWith("https://")) { const url = new URL(link.url); if (!url.hostname || url.username || url.password) return null; }
          reviewLinks.push({ id: link.id, url: link.url, expiresAt: link.expiresAt });
        }
        if (!uniqueIds(reviewLinks)) return null;
      }
      if (d.reviewStatus !== undefined) metadata.reviewStatus = d.reviewStatus as DesignDocument["reviewStatus"];
      if (d.comments !== undefined) {
        if (!Array.isArray(d.comments) || d.comments.length > 500) return null;
        const comments: DesignComment[] = [];
        for (const comment of d.comments) {
          if (!object(comment) || !identity(comment.id) || !string(comment.text, 5000) || !string(comment.createdAt, 40) || !Number.isFinite(Date.parse(comment.createdAt)) || !optional(comment, "pageId", identity) || !optional(comment, "elementId", identity) || !optional(comment, "resolved", boolean)) return null;
          comments.push({ id: comment.id, text: comment.text, createdAt: comment.createdAt, ...(comment.pageId !== undefined ? { pageId: comment.pageId as string } : {}), ...(comment.elementId !== undefined ? { elementId: comment.elementId as string } : {}), ...(comment.resolved !== undefined ? { resolved: comment.resolved as boolean } : {}) });
        }
        if (!uniqueIds(comments)) return null;
        metadata.comments = comments;
      }
      if (d.versions !== undefined) {
        if (!Array.isArray(d.versions) || d.versions.length > 20) return null;
        const versions: DesignVersion[] = [];
        for (const version of d.versions) {
          if (!object(version) || !identity(version.id) || !string(version.name, 200) || !string(version.createdAt, 40) || !Number.isFinite(Date.parse(version.createdAt)) || !format(version.format) || !string(version.caption, 20_000)) return null;
          const versionPages = parsePages(version.pages);
          const versionCanvas = version.continuousCanvas === undefined ? undefined : parseCanvas(version.continuousCanvas);
          const versionMaster = version.masterScene === undefined ? undefined : parseCanvas(version.masterScene);
          if (!versionPages || versionCanvas === null || versionMaster === null || (versionCanvas && versionPages.length < 2)) return null;
          if (version.customSize !== undefined && (!object(version.customSize) || !numberIn(version.customSize.width, 100, 8192) || !numberIn(version.customSize.height, 100, 8192))) return null;
          const versionResources = parseResources(version);
          if (!versionResources) return null;
          normalizeReadingOrders(versionPages,versionCanvas??undefined,versionMaster??undefined);
          versions.push({ id: version.id, name: version.name, createdAt: version.createdAt, format: version.format, pages: versionPages, caption: version.caption, ...(versionCanvas ? { continuousCanvas: versionCanvas } : {}), ...(versionMaster ? { masterScene: versionMaster } : {}), ...(version.customSize ? { customSize: { width: (version.customSize as {width:number}).width, height: (version.customSize as {height:number}).height } } : {}), ...(versionResources.styles !== undefined ? { styles: versionResources.styles } : {}), ...(versionResources.components !== undefined ? { components: versionResources.components } : {}), ...(versionResources.colorRoles !== undefined ? { colorRoles: versionResources.colorRoles } : {}), ...(versionResources.parameters !== undefined ? { parameters: versionResources.parameters } : {}) });
        }
        if (!uniqueIds(versions)) return null;
        metadata.versions = versions;
      }
      const continuousCanvas = d.continuousCanvas === undefined ? undefined : parseCanvas(d.continuousCanvas);
      if (d.continuousCanvas !== undefined && (!continuousCanvas || pages.length < 2)) return null;
      normalizeReadingOrders(pages,continuousCanvas??undefined,resources.masterScene);
      library.designs.push({
        ...resources,
        ...metadata,
        ...(d.reviewLinks !== undefined ? { reviewLinks } : {}),
        id: d.id,
        name: d.name,
        templateId: d.templateId,
        format: d.format,
        pages,
        ...(continuousCanvas ? { continuousCanvas } : {}),
        caption: d.caption,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        ...(d.purpose === "template" ? { purpose: "template" as const } : {}),
        ...(typeof d.editingTemplateId === "string"
          ? { editingTemplateId: d.editingTemplateId }
          : {}),
      });
      designIds.add(d.id);
    }
    for (const t of input.templates) {
      if (
        !object(t) ||
        !identity(t.id) ||
        templateIds.has(t.id) ||
        !string(t.name, 200) ||
        !string(t.description, 2000) ||
        !string(t.category, 100) ||
        !format(t.format)
      )
        return null;
      const pages = parsePages(t.pages);
      if (!pages) return null;
      const resources = parseResources(t);
      if (!resources) return null;
      const continuousCanvas = t.continuousCanvas === undefined ? undefined : parseCanvas(t.continuousCanvas);
      if (t.continuousCanvas !== undefined && (!continuousCanvas || pages.length < 2)) return null;
      normalizeReadingOrders(pages,continuousCanvas??undefined,resources.masterScene);
      library.templates.push({
        ...resources,
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        format: t.format,
        pages,
        ...(continuousCanvas ? { continuousCanvas } : {}),
        custom: true,
      });
      templateIds.add(t.id);
    }
    return library;
  } catch {
    return null;
  }
}

/** Only the passive vector grammar produced by the Brand importer is accepted.
 * No script, CSS, links, embedded images, entities or external references. */
export const BRAND_SVG_PREFIX = "data:image/svg+xml;charset=utf-8,";
const brandSvgNumeric = (value: string) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 100_000;
const brandSvgNumbers = (value: string) => value.trim().split(/[ ,]+/).every(brandSvgNumeric);
const brandSvgPaint = (value: string) => /^(?:transparent|black|white|none|#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|url\(#brand-g\d+\))$/i.test(value);
const brandSvgAllowed: Record<string, Set<string>> = {
  svg: new Set(["xmlns", "width", "height", "viewBox"]),
  defs: new Set(), g: new Set(["transform", "opacity"]),
  path: new Set(["d", "fill", "stroke", "stroke-width", "fill-rule", "stroke-dasharray", "transform", "opacity"]),
  linearGradient: new Set(["id", "x1", "y1", "x2", "y2"]), radialGradient: new Set(["id", "cx", "cy", "r"]),
  stop: new Set(["offset", "stop-color"]),
};
export function isSafeBrandSvg(source: string): boolean {
  if (!source || source.length > 1_000_000 || /<!|<\?|&|[\u0000-\u0008]/.test(source)) return false;
  const stack: string[] = [], ids = new Set<string>(), references: string[] = [];
  const tokens = source.match(/<[^>]+>|[^<]+/g) ?? [];
  let roots = 0;
  for (const token of tokens) {
    if (!token.startsWith("<")) { if (token.trim()) return false; continue; }
    const close = token.match(/^<\/(\w+)>$/);
    if (close) { if (stack.pop() !== close[1]) return false; continue; }
    const tag = token.match(/^<(\w+)([\s\S]*?)\s*(\/?)>$/);
    if (!tag || !brandSvgAllowed[tag[1]]) return false;
    if (!stack.length) { if (tag[1] !== "svg" || ++roots !== 1) return false; }
    if (tag[1] === "svg" && stack.length) return false;
    const attributes = tag[2], seen = new Set<string>();
    if (attributes.replace(/\s+[\w-]+="[^"]*"/g, "").trim()) return false;
    for (const attr of attributes.matchAll(/\s+([\w-]+)="([^"]*)"/g)) {
      const [, name, value] = attr;
      if (!brandSvgAllowed[tag[1]].has(name) || seen.has(name)) return false;
      seen.add(name);
      if (name === "xmlns") { if (value !== "http://www.w3.org/2000/svg") return false; }
      else if (name === "id") { if (!/^brand-g\d+$/.test(value) || ids.has(value)) return false; ids.add(value); }
      else if (name === "d") { if (!value || value.length > 20_000 || !/^[MmLlHhVvCcSsQqTtAaZz\d.,+\-eE\s]+$/.test(value)) return false; }
      else if (["fill", "stroke", "stop-color"].includes(name)) { if (!brandSvgPaint(value)) return false; const ref = value.match(/^url\(#(brand-g\d+)\)$/); if (ref) references.push(ref[1]); }
      else if (name === "fill-rule") { if (!/^(?:evenodd|nonzero)$/.test(value)) return false; }
      else if (name === "transform") { if (!value || value.replace(/(?:translate|rotate|scale|matrix)\(([-\d.eE+, ]+)\)/g, "").trim()) return false; for (const values of value.matchAll(/\(([^)]+)\)/g)) if (!brandSvgNumbers(values[1])) return false; }
      else if (name === "viewBox") { const box = value.trim().split(/[ ,]+/); if (box.length !== 4 || !brandSvgNumbers(value) || Number(box[2]) <= 0 || Number(box[3]) <= 0) return false; }
      else if (name === "stroke-dasharray") { if (!brandSvgNumbers(value)) return false; }
      else if (!brandSvgNumeric(value.replace(/%$/, ""))) return false;
    }
    if (tag[1] === "svg" && (!seen.has("viewBox") || !seen.has("xmlns"))) return false;
    if (!tag[3]) stack.push(tag[1]);
  }
  return roots === 1 && stack.length === 0 && references.every(id => ids.has(id));
}
export function isSafeBrandSvgUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.startsWith(BRAND_SVG_PREFIX)) return false;
  try { return isSafeBrandSvg(decodeURIComponent(value.slice(BRAND_SVG_PREFIX.length))); } catch { return false; }
}
