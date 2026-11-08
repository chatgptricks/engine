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
  /** Follow another slot. Down (default): sit `gap` below it (or below its top
   * with `edge: "top"`) and stop at `bottom`. Up: sit `gap` above it and reach
   * no higher than `bottom`. Right: sit `gap` after the end of its last line of
   * text, centred on that line, as a badge follows a name. `resize` keeps the
   * far edge and changes height. `hug` moves the bottom edge to `gap` below
   * another slot's bottom instead, so a card grows and shrinks with its copy; when
   * that slot is hidden, it hugs the slot the hidden one follows.
   * `media` (an image following down): the layer takes its picture's shape
   * instead, as large as fits across `media.x` to `media.x + media.width` and
   * down to `bottom`, centred across that span. Without the picture's size it
   * fills the span and height like `resize`. */
  smartFlow?: { after: string; gap: number; bottom: number; edge?: "top"; resize?: boolean; direction?: "up" | "right"; hug?: { after: string; gap: number }; media?: { x: number; width: number } };
  /** Starts a flow that is centred between `top` and `bottom`: this layer and
   * everything that follows it move down together when they leave room, so a
   * short page has no empty block at its foot. A full page starts at `top`. */
  smartCenter?: { top: number; bottom: number };
  /** Author's choice of how this layer behaves in copies of a template; inferred when absent. */
  layoutRole?: "fixed" | "text" | "media" | "free";
  componentId?: string;
  componentInstanceId?: string;
  componentSourceId?: string;
  colorRoleId?: string;
  /** Axis-aligned crop in scene coordinates, independent of layer rotation. */
  clipBounds?: { x: number; y: number; width: number; height: number };
};
export type SmartTextRole = "cover" | "heading" | "body" | "list";
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
  /** Copy fitting. Automatic fits first shrink type to `softMinFontSize` inside
   * `baseHeight`, then grow towards `maxHeight` (moving what follows), then
   * shrink to `minFontSize`. `anchorBottom` keeps the bottom edge fixed and
   * `anchorTop` the top edge (copy that starts a page's flow).
   *
   * A `list` (one item per paragraph) fills its box: short lists grow their
   * type up to `maxFontSize` (wrapping items only when single lines would
   * leave a fifth of the box empty), then open the gaps between items from
   * `paragraphSpacing` up to `maxParagraphSpacing`, scaled with the type; long
   * lists shrink type and gaps together down to `minFontSize`. Layers sharing
   * a `group` (a page's list columns, their headings) share one size, gap and
   * height, so their rows line up.
   * `guideHeight` is what agents' copy-length guide measures against when the
   * box may stretch past the copy the slot is written for. */
  smartText?: { role: SmartTextRole; lines: 0 | 2 | 3 | 4; minFontSize: number; maxFontSize: number; maxHeight: number; baseHeight?: number; softMinFontSize?: number; anchorBottom?: number; anchorTop?: number; group?: string; paragraphSpacing?: number; maxParagraphSpacing?: number; guideHeight?: number };
  verticalAlign?: "top" | "middle" | "bottom";
  padding?: number;
  paragraphSpacing?: number;
  strikethrough?: boolean;
  listStyle?: "none" | "bullet" | "number";
  /** A wrapped list item continues under its own text instead of under its marker. */
  hangingIndent?: boolean;
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

/** Colours of a post on X in dark mode, as phone screenshots show it. `border` is X's own
 * divider grey, used for the thin line around each card. */
export const X_POST_COLORS = { card: "#000000", text: "#E7E9EA", handle: "#71767B", border: "#2F3336" } as const;
/** The chatgptricks post cards in 1080-wide pixels. A card is 936 px wide with `pad` px of black
 * padding inside on every side (Ivan's call), so its content never touches the edge; Ivan's phone
 * screenshots of X (1206 px wide) scale by `scale` into the rest, which keeps X's line breaks.
 * `radius` and `border` round the corners a little and outline the card, so it stands out from
 * the page. A card is `textTop + lines × line + foot` tall, plus `mediaGap` and the photo when the
 * post has one. Reaction pages have no source line, so `room`, the cards' space, runs from 64 px
 * under the one-line title (90 + 56 × 1.04, the Text + Media title's line) down to the bottom
 * margin at `bottom`. */
export const X_CARD = (() => {
  const width = 936, pad = 24, scale = (width - 2 * pad) / 1206, shot = (value: number) => value * scale;
  const size = shot(57.9), line = shot(73.3), bottom = 1352, room = bottom - 90 - 56 * 1.04 - 64;
  // SF Pro Display's baseline sits 0.95 em plus half the leading under the top of its line box.
  const textTop = pad + shot(310.5) - ((line / size - 1.19) / 2 + .95) * size, foot = pad + shot(33.5);
  // `maxLines` is as much text as one card can show on a page of its own.
  return { width, pad, scale, inset: pad + shot(27), size, line, textTop, foot, between: 40, mediaGap: shot(31), mediaRadius: shot(48), radius: 24, border: 3, maxLines: Math.floor((room - textTop - foot) / line), bottom, room };
})();

/** The badges X shows after a verified name, drawn for Engine in a 100 × 100 box with the check
 * cut out (fill rule evenodd), so it shows the card's black: people and government accounts get
 * a rosette of eight round lobes (blue, grey), organizations a gold twelve-point seal. */
export const X_BADGES = (() => {
  const round = (value: number) => Math.round(value * 100) / 100;
  const outline = (points: [number, number][]) => `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`;
  const around = (count: number, radius: (index: number, angle: number) => number) => Array.from({ length: count }, (_, index): [number, number] => {
    const angle = index / count * 2 * Math.PI - Math.PI / 2, r = radius(index, angle);
    return [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)];
  });
  // A thick check whose arms meet at a right angle, centred in the box.
  const check = outline([[33.36, 46.64], [43, 56.28], [66.64, 32.64], [73.36, 39.36], [43, 69.72], [26.64, 53.36]]);
  const rosette = outline(around(160, (_, angle) => 43 + 7 * Math.abs(Math.cos(4 * (angle + Math.PI / 2))) ** .55)) + check;
  const seal = outline(around(24, index => index % 2 ? 41.5 : 50)) + check;
  return {
    blue: { path: rosette, fill: "#1D9BF0" },
    grey: { path: rosette, fill: "#829AAB" },
    gold: { path: seal, fill: "#E2B719", gradient: { type: "linear" as const, angle: 135, stops: [{ color: "#F8DF5C", position: 0 }, { color: "#D9A21B", position: 100 }] } },
  };
})();

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
  // Defined at the end of this file; chatgptricks-template.ts is its entry point.
  chatgptricksTemplate(),
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

/** Imported Canva runs are separate objects. Join spatially contiguous,
 * compatible runs, keeping each run's color and emphasis. */
export function mergeTemplateText(scene: CanvasScene, sourceIds?: Map<string, string>): CanvasScene {
  for (const element of scene.elements) sourceIds?.set(element.id, element.id);
  const consumed = new Set<string>(), replacements = new Map<string, TextElement>();
  const groups = new Map(scene.groups?.map(group => [group.id, group]) ?? []);
  const blockedGroup = (id?: string) => {
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id); const group = groups.get(id);
      if (!group) break;
      if (group.hidden || group.locked) return true;
      id = group.parentId;
    }
    return false;
  };
  const candidates = scene.elements.filter((element): element is TextElement => element.type === "text" && !isPlaceholder(element) && !isProfile(element) && !element.smartText && element.rotation === 0 && !element.hidden && !element.locked && !blockedGroup(element.groupId) && !element.wordTextures?.length && !element.textureFill);
  const readingOrder = (a: TextElement, b: TextElement) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y;
  const compatible = (a: TextElement, b: TextElement) => a.font === b.font && Math.abs(a.fontSize - b.fontSize) < .1 && a.align === b.align && Math.abs(a.lineHeight - b.lineHeight) < .02 && Math.abs(a.letterSpacing - b.letterSpacing) < .1 && a.opacity === b.opacity;
  const adjacent = (a: TextElement, b: TextElement) => {
    if (!compatible(a, b)) return false;
    const sameGroup = Boolean(a.groupId && a.groupId === b.groupId);
    const [left, right] = a.x < b.x ? [a, b] : [b, a];
    if (Math.abs(a.y - b.y) < 2 && Math.abs(a.height - b.height) < 2 && right.x > left.x + 1) {
      const gap = right.x - left.x - left.width;
      // A previously edited run can have a wider box than its remaining
      // grouped fragments. Their left-to-right order still identifies the copy.
      if (Math.abs(gap) < 8 || sameGroup && gap < 0 && right.x < left.x + left.width) return true;
    }
    const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
    return sameGroup && Math.abs(a.x - b.x) < 2 && Math.abs(bottom.y - top.y - top.height) < 8;
  };
  for (const element of candidates) {
    if (consumed.has(element.id)) continue;
    const runs = [element], joined = new Set([element.id]);
    for (let position = 0; position < runs.length; position++) for (const other of candidates) {
      if (!consumed.has(other.id) && !joined.has(other.id) && adjacent(runs[position], other)) { runs.push(other); joined.add(other.id); }
    }
    if (runs.length < 2) continue;
    runs.sort(readingOrder);
    const first = runs[0], left = Math.min(...runs.map(run => run.x)), top = Math.min(...runs.map(run => run.y));
    const richText = runs.map((run, index) => {
      const separator = index ? Math.abs(run.y - runs[index - 1].y) < 2 ? " " : "<br>" : "";
      const decoration = [run.underline ? "underline" : "", run.strikethrough ? "line-through" : ""].filter(Boolean).join(" ") || "none";
      return `${separator}<span style="color:${run.color};font-weight:${run.fontWeight};font-style:${run.italic ? "italic" : "normal"};text-decoration:${decoration}">${run.richText ?? escape(run.text.trim())}</span>`;
    }).join("");
    replacements.set(first.id, { ...first, groupId: undefined, x: left, y: top, width: Math.max(...runs.map(run => run.x + run.width)) - left, height: Math.max(...runs.map(run => run.y + run.height)) - top, text: runs.map(run => run.text.trim()).join(" "), richText });
    for (const run of runs) sourceIds?.set(run.id, first.id);
    runs.forEach(run => consumed.add(run.id));
  }
  return { ...scene, elements: scene.elements.flatMap(element => replacements.has(element.id) ? [replacements.get(element.id)!] : consumed.has(element.id) ? [] : [element]) };
}

/** How an element behaves when a template copy is made. `layoutRole` on an
 * element is an explicit author choice; otherwise the role is inferred. */
export type LayoutRole = "fixed" | "text" | "media" | "free";
export const LAYOUT_ROLE_LABELS: Record<LayoutRole, string> = { fixed: "Fixed brand element", text: "Text slot", media: "Photo slot", free: "Free element" };
type LayoutContext = { height: number; repeatedText?: ReadonlySet<string> };
const BRAND_NAME = /logo|icon|avatar|badge|watermark/i;
const DECOR_NAME = /fade|shad|background|backdrop|overlay|gradient/i;
const bottomOf = (element: CanvasElement) => element.y + element.height;
const containsBox = (outer: CanvasElement, inner: CanvasElement) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && bottomOf(inner) <= bottomOf(outer) + 1;
const overlapsX = (a: CanvasElement, b: CanvasElement) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) >= .5 * Math.min(a.width, b.width);

export function templateSceneHeight(template: Pick<DesignTemplate, "customSize" | "format">): number {
  return 360 * (template.customSize?.height ?? FORMATS[template.format].height) / (template.customSize?.width ?? FORMATS[template.format].width);
}

/** Small text that repeats on several pages (handles, profile cards, page
 * furniture) is branding, not copy. Repeated sample headlines stay copy. */
export function repeatedTemplateText(pages: readonly { canvas?: CanvasScene }[]): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const scene = page.canvas && mergeTemplateText(page.canvas);
    for (const text of new Set(scene?.elements.flatMap(element => element.type === "text" && element.fontSize < 14 ? [element.text.trim().toLowerCase()] : []) ?? [])) if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([text]) => text));
}

function baseLayoutRole(element: CanvasElement, context: LayoutContext): LayoutRole {
  if (element.layoutRole === "free" || element.layoutRole === "fixed") return element.layoutRole;
  if (element.layoutRole === "text") return element.type === "text" ? "text" : "fixed";
  if (element.layoutRole === "media") return element.type === "text" ? "fixed" : "media";
  if (element.master || element.componentInstanceId || element.hidden) return "free";
  if (element.locked || element.rotation % 360 !== 0) return "fixed";
  const area = element.width * element.height / (360 * context.height);
  if (element.type === "text") {
    const text = element.text.trim();
    if (!text || isPlaceholder(element) || isProfile(element) || /^@[\w.]+$/.test(text) || context.repeatedText?.has(text.toLowerCase())) return "fixed";
    return element.fontSize < 7 && text.split(/\s+/).length <= 4 ? "fixed" : "text";
  }
  if (isProfile(element) || BRAND_NAME.test(element.name) || area < .06) return "fixed";
  if (element.type === "image") return "media";
  if (element.imageFill) return "media";
  return element.width > 180 && element.height > 100 && area < .85 && !element.gradient && !DECOR_NAME.test(element.name) ? "media" : "fixed";
}

/** Roles for every layer of one page. A large panel that holds copy frames
 * that copy (it stays fixed and resizes with it) rather than taking a photo. */
export function inferLayoutRoles(scene: CanvasScene, context: LayoutContext): Map<string, LayoutRole> {
  const groups = new Map(scene.groups?.map(group => [group.id, group]) ?? []);
  const inherited = (element: CanvasElement, key: "hidden" | "locked") => {
    for (let id = element.groupId, steps = 0; id && steps < 100; id = groups.get(id)?.parentId, steps++) if (groups.get(id)?.[key]) return true;
    return false;
  };
  // Hidden layers stay as authored; a locked group is part of the fixed artwork.
  const roles = new Map(scene.elements.map(element => [element.id, inherited(element, "hidden") ? "free" : inherited(element, "locked") && !element.layoutRole ? "fixed" : baseLayoutRole(element, context)] as const));
  for (const element of scene.elements) {
    if (element.type !== "shape" || element.layoutRole || element.imageFill || roles.get(element.id) !== "media") continue;
    if (scene.elements.some(other => roles.get(other.id) === "text" && containsBox(element, other))) roles.set(element.id, "fixed");
  }
  return roles;
}

/** Connect the content of a page so copy can grow: what sits directly below a
 * text slot follows it (photos and frames keep their bottom edge and shrink, text
 * moves down), and copy that sits at the foot of the page grows upwards instead.
 * Each text slot gets the extra height its neighbours can actually give up. */
function inferSmartFlows(elements: CanvasElement[], height: number, margins: { top: number; bottom: number }): CanvasElement[] {
  const visible = elements.filter(element => !element.hidden);
  const isText = (element: CanvasElement): element is TextElement => element.type === "text" && Boolean(element.smartText);
  const pageSized = (element: CanvasElement) => element.width * element.height >= .85 * 360 * height;
  const frameOf = new Map<string, CanvasElement>();
  for (const text of visible.filter(isText)) {
    const frames = visible.filter(element => element.type === "shape" && element.templateRole === "brand" && !pageSized(element) && element.rotation % 360 === 0 && !element.gradient && element.opacity >= .5 && !DECOR_NAME.test(element.name) && containsBox(element, text)).sort((a, b) => a.width * a.height - b.width * b.height);
    if (frames[0]) frameOf.set(text.id, frames[0]);
  }
  const frames = new Set(frameOf.values());
  const participants = visible.filter(element => isText(element) || element.templateRole === "media" && !pageSized(element) || frames.has(element)).sort((a, b) => a.y - b.y || b.width * b.height - a.width * a.height);
  const slots = new Map<string, string>();
  participants.forEach((element, index) => slots.set(element.id, element.slot || `smart-${isText(element) ? "text" : frames.has(element) ? "frame" : "media"}-${index}`));
  const flows = new Map<string, NonNullable<CanvasElementBase["smartFlow"]>>();
  const after = new Map<string, CanvasElement>();
  const inset = (text: CanvasElement, frame: CanvasElement) => { const padding = bottomOf(frame) - bottomOf(text); return Math.min(padding, Math.max(8, padding / 2)); };
  for (const element of participants) {
    let anchor: CanvasElement | undefined;
    for (const candidate of participants) {
      if (candidate === element || !isText(candidate) || candidate.y >= element.y || frameOf.get(candidate.id) !== frameOf.get(element.id)) continue;
      const gap = element.y - bottomOf(candidate);
      if (gap < -1 || gap > 48 || !overlapsX(candidate, element)) continue;
      if (!anchor || bottomOf(candidate) > bottomOf(anchor)) anchor = candidate;
    }
    if (anchor) {
      after.set(element.id, anchor);
      flows.set(element.id, { after: slots.get(anchor.id)!, gap: Math.max(0, element.y - bottomOf(anchor)), bottom: bottomOf(element), ...(isText(element) ? {} : { resize: true }) });
      continue;
    }
    const frame = frameOf.get(element.id);
    if (frame && flows.has(frame.id)) {
      after.set(element.id, frame);
      flows.set(element.id, { after: slots.get(frame.id)!, edge: "top", gap: element.y - frame.y, bottom: bottomOf(frame) - inset(element, frame) });
    }
  }
  const reaches = (element: CanvasElement, target: CanvasElement) => { for (let current = after.get(element.id), steps = 0; current && steps < 200; current = after.get(current.id), steps++) if (current === target) return true; return false; };
  const lowerLimit = (element: CanvasElement) => {
    const frame = frameOf.get(element.id);
    let limit = frame ? bottomOf(frame) - inset(element, frame) : height - margins.bottom;
    for (const other of visible) if (other !== element && other !== frame && !pageSized(other) && !reaches(other, element) && !containsBox(other, element) && other.y >= bottomOf(element) - 1 && overlapsX(element, other)) limit = Math.min(limit, other.y - 8);
    return limit;
  };
  const upperLimit = (element: CanvasElement, chain: Set<CanvasElement>) => {
    let limit = margins.top;
    for (const other of visible) if (!chain.has(other) && !pageSized(other) && !containsBox(other, element) && bottomOf(other) <= element.y + 1 && overlapsX(element, other)) limit = Math.max(limit, bottomOf(other) + 8);
    return limit;
  };
  const followers = (element: CanvasElement) => participants.filter(other => after.get(other.id) === element && flows.get(other.id)?.edge !== "top");
  const growth = new Map<string, number>();
  const room = (element: CanvasElement): number => {
    if (growth.has(element.id)) return growth.get(element.id)!;
    growth.set(element.id, 0);
    let value = lowerLimit(element) - bottomOf(element);
    for (const follower of followers(element)) value = Math.min(value, isText(follower) ? room(follower) : follower.height * (frames.has(follower) ? .25 : .35));
    value = Math.max(0, value); growth.set(element.id, value); return value;
  };
  const result = new Map(elements.map(element => [element.id, element] as const));
  for (const element of participants) {
    const flow = flows.get(element.id);
    const next: CanvasElement = { ...element, slot: slots.get(element.id), ...(flow ? { smartFlow: flow } : {}) };
    if (isText(element) && next.type === "text") {
      // Copy heading a wider photo or panel spans that column (imported title
      // runs are often only as wide as their sample words).
      const column = followers(element).filter(other => !isText(other) && Math.abs(other.x - element.x) <= 12 && other.x + other.width > element.x + element.width);
      if (column.length && !element.layoutRole) next.width = Math.max(...column.map(other => other.x + other.width)) - next.x;
      const extra = room(element);
      next.smartText = { ...element.smartText!, maxHeight: Math.max(1, element.height + extra) };
      if (flow && !flow.edge) next.smartFlow = { ...flow, bottom: bottomOf(element) + extra };
    }
    result.set(element.id, next);
  }
  // Copy at the foot of the page has nowhere to go but up: the lowest line
  // keeps its baseline and the copy above it moves up with it.
  for (const root of participants.filter(element => isText(element) && !after.has(element.id) && !frameOf.has(element.id))) {
    const chain = [root];
    for (let next = followers(root)[0]; next && isText(next) && followers(chain.at(-1)!).length === 1; next = followers(next)[0]) chain.push(next);
    const last = chain.at(-1)!;
    if (followers(last).length || chain.some(element => followers(element).some(other => !isText(other)))) continue;
    const members = new Set<CanvasElement>(chain), down = room(root);
    const up = Math.max(0, root.y - upperLimit(root, members));
    const anchored = chain.some(element => element.type === "text" && element.verticalAlign === "bottom" || element.anchors?.vertical === "bottom");
    if (!anchored && !(bottomOf(last) > height * .55 && down < (bottomOf(last) - root.y) * .25 && up > down)) continue;
    const top = root.y - up;
    chain.forEach((element, index) => {
      const current = result.get(element.id)! as TextElement;
      const below = chain[index + 1];
      const rest: TextElement = { ...current };
      delete rest.smartFlow;
      result.set(element.id, {
        ...rest,
        ...(below ? { smartFlow: { after: slots.get(below.id)!, gap: Math.max(0, below.y - bottomOf(element)), bottom: top, direction: "up" as const } } : {}),
        smartText: { ...current.smartText!, maxHeight: Math.max(1, element.height + up), ...(below ? {} : { anchorBottom: bottomOf(element) }) },
      });
    });
  }
  return elements.map(element => result.get(element.id)!);
}

/** Older template copies predate staged fitting: keep their sample size as the
 * box to fill before neighbours move. */
function upgradeSmartPage(page: DesignPage): DesignPage {
  const canvas = page.canvas;
  if (!canvas || !canvas.elements.some(element => element.type === "text" && element.smartText && element.smartText.baseHeight === undefined)) return page;
  return { ...page, canvas: { ...canvas, elements: canvas.elements.map(element => element.type === "text" && element.smartText && element.smartText.baseHeight === undefined ? { ...element, smartText: { ...element.smartText, baseHeight: Math.max(1, Math.min(element.height, element.smartText.maxHeight)), softMinFontSize: Math.max(element.smartText.minFontSize, Math.min(element.fontSize, element.smartText.maxFontSize) * .85) } } : element) } };
}

const ROLE_PROTECTION = { text: ["position", "style", "delete"], media: ["position", "delete"], fixed: ["content", "position", "style", "delete"] } as const satisfies Record<Exclude<LayoutRole, "free">, readonly ProtectedProperty[]>;
/** Role protection adds to whatever the author already protected. */
const protect = (element: CanvasElement, role: Exclude<LayoutRole, "free">): ProtectedProperty[] => [...new Set([...(element.protected ?? []), ...ROLE_PROTECTION[role]])];

const BRAND_LABEL_LAYOUTS = new Set(["text + media", "full bleed + text", "prompt", "title quote"]);

/** Prepares new copies or an explicit smart-layout edit. Every template gets
 * fixed brand elements, text slots that fit their copy, and photo slots; the
 * page's own geometry decides what follows what. Opening saved artwork never
 * rewrites it, and deleted templates are never reintroduced. */
export function prepareSmartTemplate(template: DesignTemplate): DesignTemplate {
  if (template.continuousCanvas) return template;
  const brand = isChatGPTricksTemplate(template), height = templateSceneHeight(template);
  const repeatedText = repeatedTemplateText(template.pages);
  let changed = false;
  const pages = template.pages.map((page, pageIndex) => {
    const next = prepareSmartPage(page, pageIndex, { brand, height, repeatedText });
    if (next !== page) changed = true;
    return next;
  });
  return changed ? { ...template, pages } : template;
}

function prepareSmartPage(page: DesignPage, pageIndex: number, context: LayoutContext & { brand: boolean }): DesignPage {
  const { brand, height } = context;
  // The asset sheet is a toolbox, not a publishing layout.
  if (/^assets$/i.test(page.label ?? "")) return page;
  if (page.canvas?.elements.some(element => element.templateRole || element.type === "text" && element.smartText)) return upgradeSmartPage(page);
  // Legacy pages keep their original appearance until the editor adopts layers.
  if (!page.canvas) return page;
  const merged = mergeTemplateText(page.canvas), label = page.label?.toLowerCase() ?? "";
  const roles = inferLayoutRoles(merged, context);
  if (![...roles.values()].some(role => role === "text" || role === "media")) return page;
  const texts = merged.elements.filter((element): element is TextElement => element.type === "text" && roles.get(element.id) === "text").sort((a, b) => a.y - b.y);
  const media = merged.elements.filter(element => roles.get(element.id) === "media");
  const largest = Math.max(0, ...texts.map(text => text.fontSize)), cover = pageIndex === 0 || /^cta/.test(label);
  let elements: CanvasElement[] = merged.elements.map(element => {
    const role = roles.get(element.id)!;
    if (role === "free") return element;
    if (role === "text" && element.type === "text") {
      const index = texts.indexOf(element);
      const textRole = brand ? cover ? "cover" : index === 0 ? "heading" : "body" : element.fontSize >= largest * .8 ? pageIndex === 0 ? "cover" : "heading" : "body";
      const next = texts[index + 1];
      const bottom = Math.min(height - 20, next ? next.y - 8 : height - 20);
      const x = brand ? Math.max(18, element.x) : element.x, width = brand ? Math.min(element.width, 360 - x - 18) : element.width;
      const minimum = brand ? Math.min(element.fontSize, textRole === "cover" ? 18 : 11) : Math.min(element.fontSize, Math.max(textRole === "body" ? 9 : 12, element.fontSize * .55));
      return {
        ...element, groupId: undefined, slot: brand || !element.slot ? `smart-text-${index}` : element.slot, x, width,
        align: brand ? cover ? "center" as const : "left" as const : element.align, textMode: "auto-fit" as const,
        verticalAlign: brand ? "top" as const : element.verticalAlign ?? "top", protected: protect(element, "text"),
        smartText: { role: textRole, lines: brand && pageIndex === 0 ? 3 : 0, minFontSize: minimum, maxFontSize: brand ? Math.min(100, element.fontSize * 1.65) : Math.min(500, element.fontSize * 1.65), maxHeight: Math.max(element.height, bottom - element.y), baseHeight: element.height, softMinFontSize: Math.max(minimum, element.fontSize * .85) },
      };
    }
    if (role === "media") return { ...element, groupId: undefined, ...(brand ? { slot: "smart-media" } : {}), name: element.type === "shape" && !element.imageFill ? "Photo frame" : element.name, templateRole: "media" as const, protected: protect(element, "media") };
    return { ...element, templateRole: "brand" as const, ...(element.type === "text" && isPlaceholder(element) ? { hidden: true } : {}), protected: protect(element, "fixed") };
  });
  const margins = merged.layout?.margins?.enabled ? merged.layout.margins : { top: 20, bottom: 20 };
  if (brand && BRAND_LABEL_LAYOUTS.has(label)) {
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
  } else elements = inferSmartFlows(elements, height, margins);
  const layout: CanvasLayout = brand
    ? { ...merged.layout, showGuides: true, margins: { enabled: true, top: 20, right: 20, bottom: 20, left: 20 }, snapping: { enabled: true, objects: true, page: true, guides: true, grid: false, spacing: true, tolerance: 6 } }
    : { ...merged.layout, margins: merged.layout?.margins ?? { enabled: true, top: 20, right: 20, bottom: 20, left: 20 }, snapping: merged.layout?.snapping ?? { enabled: true, objects: true, page: true, guides: true, grid: false, spacing: true, tolerance: 6 } };
  return { ...page, canvas: { ...merged, elements, layout } };
}

/** A template being edited is raw artwork again: the author moves and restyles
 * freely, and roles are worked out afresh for the next copy. Explicit role
 * choices (`layoutRole`) are kept. */
export function releaseSmartLayout(scene: CanvasScene): CanvasScene {
  if (!scene.elements.some(element => element.templateRole || element.smartFlow || element.smartCenter || element.type === "text" && element.smartText)) return scene;
  return { ...scene, elements: scene.elements.map(element => {
    if (!element.templateRole && !element.smartFlow && !element.smartCenter && !(element.type === "text" && element.smartText)) return element;
    const released = { ...element } as CanvasElement & Record<string, unknown>;
    const role = element.type === "text" && element.smartText ? "text" : element.templateRole === "media" ? "media" : element.templateRole === "brand" ? "fixed" : undefined;
    const kept = element.protected?.filter(property => !role || !(ROLE_PROTECTION[role] as readonly ProtectedProperty[]).includes(property));
    delete released.templateRole; delete released.smartFlow; delete released.smartCenter; delete released.protected;
    if (kept?.length) released.protected = kept;
    if (released.slot?.startsWith("smart-")) delete released.slot;
    if (released.type === "text" && released.smartText) {
      const rule = released.smartText;
      delete released.smartText; delete released.autoFitFontSize;
      Object.assign(released, { textMode: "auto-fit", autoFitMinFontSize: Math.min(rule.minFontSize, released.fontSize), autoFitMaxFontSize: released.fontSize, ...(rule.paragraphSpacing !== undefined ? { paragraphSpacing: rule.paragraphSpacing } : {}) });
    }
    return released as CanvasElement;
  }) };
}


export function createDesign(template: DesignTemplate): DesignDocument {
  return designFromTemplate(prepareSmartTemplate(template));
}

function designFromTemplate(template: DesignTemplate): DesignDocument {
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

/** Fragment boxes from imports are measured tightly; a merged block gets a
 * little width (within the page) and grows to show all of its words. */
function mergeForAuthoring(scene: CanvasScene): CanvasScene {
  const sources = new Map<string, string>(), merged = mergeTemplateText(scene, sources);
  if (merged === scene || merged.elements.length === scene.elements.length) return merged;
  const absorbed = new Set([...sources].filter(([from, to]) => from !== to).map(([, to]) => to));
  return { ...merged, elements: merged.elements.map(element => element.type === "text" && absorbed.has(element.id) ? { ...element, width: Math.min(element.width * 1.15 + 4, Math.max(element.width, 360 - element.x - 18)), textMode: "auto-height" as const } : element) };
}

export function editTemplateDesign(template: DesignTemplate): DesignDocument {
  const design = designFromTemplate(template);
  return {
    ...design,
    // Imported title runs become one editable block, as they will in every copy.
    pages: design.pages.map(page => page.canvas ? { ...page, canvas: releaseSmartLayout(mergeForAuthoring(page.canvas)) } : page),
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
  if (!optional(value, "templateRole", choice(["brand", "media"])) || !optional(value, "layoutRole", choice(["fixed", "text", "media", "free"]))) return null;
  if (value.templateRole !== undefined) result.templateRole = value.templateRole as CanvasElementBase["templateRole"];
  if (value.layoutRole !== undefined) result.layoutRole = value.layoutRole as CanvasElementBase["layoutRole"];
  if (value.smartFlow !== undefined) {
    const flow = value.smartFlow;
    if (!object(flow) || !string(flow.after, 200) || !flow.after || !numberIn(flow.gap, 0, 1000) || !numberIn(flow.bottom, -10000, 10000) || !optional(flow, "edge", choice(["top"])) || !optional(flow, "resize", boolean) || !optional(flow, "direction", choice(["up", "right"]))) return null;
    const hug = flow.hug, media = flow.media;
    if (hug !== undefined && (!object(hug) || !string(hug.after, 200) || !hug.after || !numberIn(hug.gap, 0, 1000))) return null;
    if (media !== undefined && (!object(media) || !numberIn(media.x, -10000, 10000) || !numberIn(media.width, 1, 10000))) return null;
    result.smartFlow = { after: flow.after, gap: flow.gap, bottom: flow.bottom, ...(flow.edge === "top" ? { edge: "top" } : {}), ...(typeof flow.resize === "boolean" ? { resize: flow.resize } : {}), ...(flow.direction === "up" || flow.direction === "right" ? { direction: flow.direction } : {}), ...(object(hug) ? { hug: { after: hug.after as string, gap: hug.gap as number } } : {}), ...(object(media) ? { media: { x: media.x as number, width: media.width as number } } : {}) };
  }
  if (value.smartCenter !== undefined) {
    const center = value.smartCenter;
    if (!object(center) || !numberIn(center.top, -10000, 10000) || !numberIn(center.bottom, center.top, 10000)) return null;
    result.smartCenter = { top: center.top, bottom: center.bottom };
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
  if (!optional(value, "textMode", choice(["fixed", "auto-height", "auto-fit"])) || !optional(value, "verticalAlign", choice(["top", "middle", "bottom"])) || !optional(value, "listStyle", choice(["none", "bullet", "number"])) || !optional(value, "padding", candidate => numberIn(candidate, 0, 1000)) || !optional(value, "paragraphSpacing", candidate => numberIn(candidate, 0, 1000)) || !optional(value, "strikethrough", boolean) || !optional(value, "hangingIndent", boolean) || !optional(value, "textStyleId", identity)) return null;
  const result: Partial<TextElement> = {};
  if (value.smartText !== undefined) {
    const smart = value.smartText;
    if (!object(smart) || !choice(["cover", "heading", "body", "list"])(smart.role) || ![0, 2, 3, 4].includes(Number(smart.lines)) || typeof smart.lines !== "number" || !numberIn(smart.minFontSize, 1, 500) || !numberIn(smart.maxFontSize, smart.minFontSize as number, 500) || !numberIn(smart.maxHeight, 1, 10000) || !optional(smart, "baseHeight", candidate => numberIn(candidate, 1, 10000)) || !optional(smart, "softMinFontSize", candidate => numberIn(candidate, 1, 500)) || !optional(smart, "anchorBottom", candidate => numberIn(candidate, -10000, 10000)) || !optional(smart, "anchorTop", candidate => numberIn(candidate, -10000, 10000)) || !optional(smart, "group", candidate => typeof candidate === "string" && /^[\w-]{1,40}$/.test(candidate)) || !optional(smart, "paragraphSpacing", candidate => numberIn(candidate, 0, 1000)) || !optional(smart, "maxParagraphSpacing", candidate => numberIn(candidate, 0, 1000)) || !optional(smart, "guideHeight", candidate => numberIn(candidate, 1, 10000))) return null;
    result.smartText = { role: smart.role as SmartTextRole, lines: smart.lines as 0 | 2 | 3 | 4, minFontSize: smart.minFontSize, maxFontSize: smart.maxFontSize, maxHeight: smart.maxHeight, ...(smart.baseHeight !== undefined ? { baseHeight: smart.baseHeight as number } : {}), ...(smart.softMinFontSize !== undefined ? { softMinFontSize: smart.softMinFontSize as number } : {}), ...(smart.anchorBottom !== undefined ? { anchorBottom: smart.anchorBottom as number } : {}), ...(smart.anchorTop !== undefined ? { anchorTop: smart.anchorTop as number } : {}), ...(smart.group !== undefined ? { group: smart.group as string } : {}), ...(smart.paragraphSpacing !== undefined ? { paragraphSpacing: smart.paragraphSpacing as number } : {}), ...(smart.maxParagraphSpacing !== undefined ? { maxParagraphSpacing: smart.maxParagraphSpacing as number } : {}), ...(smart.guideHeight !== undefined ? { guideHeight: smart.guideHeight as number } : {}) };
  }
  for (const key of ["textMode", "verticalAlign", "listStyle", "hangingIndent", "padding", "paragraphSpacing", "strikethrough", "textStyleId", "autoFitMinFontSize", "autoFitMaxFontSize", "autoFitFontSize"] as const) if (value[key] !== undefined) Object.assign(result, { [key]: value[key] });
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

/** The @chatgptricks Instagram carousel at 3:4 (1080 × 1440): Cover, Text +
 * Media, List and Follow pages, then Reaction (one post from X) and Reactions
 * (two stacked posts), all native layers. Each layer's role (fixed
 * brand, text slot, photo slot) and its smart flow are authored here rather
 * than inferred. Geometry is written in output pixels and stored on the
 * 360-wide scene. Use it through chatgptricks-template.ts; it is defined in
 * this file because model.ts has no runtime imports, which the TypeScript test
 * loaders rely on. Its name is deliberately not exactly "@chatgptricks": that
 * name turns on tuned inference rules that rename slots to smart-text-N and
 * re-flow "Text + Media" pages around a single title. This is a function
 * declaration so BUILT_IN_TEMPLATES can call it above; it must not read
 * module-level constants declared after that array. */
function chatgptricksTemplate(): DesignTemplate {
  const px = (value: number) => value / 3;
  const night = "#0B1014", surface = "#1A242B", white = "#F9FFFE", green = "#00D98A", grey = "#D9D9D9", dim = "#7D858A";
  type Box = [x: number, y: number, width: number, height: number];
  type Rule = NonNullable<TextElement["smartText"]>;
  const at = (id: string, name: string, [x, y, width, height]: Box) => ({ id: `cgt-${id}`, name, x: px(x), y: px(y), width: px(width), height: px(height), rotation: 0, opacity: 1, locked: false });
  const fixed = () => ({ templateRole: "brand" as const, layoutRole: "fixed" as const, protected: ["content", "position", "style", "delete"] as ProtectedProperty[] });
  const textSlot = (slot: string) => ({ slot, layoutRole: "text" as const, textMode: "auto-fit" as const, verticalAlign: "top" as const, protected: ["position", "style", "delete"] as ProtectedProperty[] });
  const typeset = (font: string, size: number, weight: number, color: string, lineHeight: number, tracking: number, align: TextElement["align"] = "left") => ({ font, fontSize: px(size), fontWeight: weight, italic: false, underline: false, color, align, lineHeight, letterSpacing: px(size * tracking) });
  // Heights get a hair of slack so whole lines still divide them after floating-point rounding.
  const fit = (role: Rule["role"], lines: Rule["lines"], size: number, min: number, maxHeight: number, baseHeight: number, soft = size, anchorBottom?: number): Rule => ({ role, lines, minFontSize: px(min), maxFontSize: px(size), maxHeight: px(maxHeight) + .01, baseHeight: px(baseHeight) + .01, softMinFontSize: px(soft), ...(anchorBottom === undefined ? {} : { anchorBottom: px(anchorBottom) }) });
  const glow = (): CanvasShadow => ({ color: "#00000099", offsetX: 0, offsetY: px(5), blur: px(37.5), spread: 0 });
  // A #1A242B photo placeholder with a faint picture icon, as a vector the Brand SVG grammar accepts.
  const placeholder = (width: number, height: number, cx: number, cy: number) => {
    const [l, t, r, b] = [cx - 60, cy - 48, cx + 60, cy + 48];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="M0 0H${width}V${height}H0Z" fill="${surface}"/><g opacity="0.3"><path d="M${l} ${t}H${r}V${b}H${l}ZM${l + 6} ${t + 6}V${b - 6}H${r - 6}V${t + 6}Z" fill="${grey}" fill-rule="evenodd"/><path d="M${l + 14} ${b - 14}L${cx - 16} ${cy - 4}L${cx + 6} ${cy + 18}L${cx + 22} ${cy + 4}L${r - 14} ${b - 14}Z" fill="${grey}"/><path d="M${cx + 17} ${cy - 22}a9 9 0 1 0 18 0a9 9 0 1 0 -18 0Z" fill="${grey}"/></g></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const photo = (id: string, name: string, slot: string, box: Box, icon: [number, number], directive: string): ImageElement => ({
    type: "image", ...at(id, name, box), src: placeholder(Math.round(box[2]), Math.round(box[3]), ...icon), fit: "cover", cropX: 50, cropY: 50, radius: 0,
    intrinsicWidth: Math.round(box[2]), intrinsicHeight: Math.round(box[3]), directive, slot, templateRole: "media", layoutRole: "media", protected: ["position", "delete"],
  });
  const fade = (id: string, name: string, y: number, height: number, from: string, to: string): ShapeElement => ({
    type: "shape", ...at(id, name, [0, y, 1080, height]), shape: "rectangle", fill: night, stroke: "transparent", strokeWidth: 0, radius: 0,
    gradient: { type: "linear", angle: 180, stops: [{ color: from, position: 0 }, { color: to, position: 100 }] }, ...fixed(),
  });
  // Full-bleed photo from the top to y 926, fading in from the top and out into the page.
  const hero = (key: string, directive: string): CanvasElement[] => [
    photo(`${key}-photo`, "Photo", "photo", [0, 0, 1080, 926], [540, 333], directive),
    fade(`${key}-top-fade`, "Top fade", 0, 220, night, "#0B101400"),
    fade(`${key}-bottom-fade`, "Bottom fade", 506, 420, "#0B101400", night),
  ];
  // Hairlines are 2 px tall; a layer is at least 3 px, so each draws a 2 px bar inside a 3 px box.
  const hairline = (id: string, name: string, x: number, from: string, to: string): ShapeElement => ({
    type: "shape", ...at(id, name, [x, 1000.724, 461, 3]), shape: "path", path: "M0 0.5H461V2.5H0Z", viewBox: "0 0 461 3", fill: white, stroke: "transparent", strokeWidth: 0, radius: 0,
    gradient: { type: "linear", angle: 90, stops: [{ color: from, position: 0 }, { color: to, position: 100 }] }, ...fixed(),
    smartFlow: { after: "cover-headline", gap: px(63), bottom: px(90), direction: "up" },
  });
  // Content pages follow the style guide: 72 px text margins (936 px of text), the title at 90 in
  // 56 px bold (line height 1.04), the body 26 px under it in 42.67 px (1.115), about 64 px to the
  // media, and the source line at the bottom margin. The boxes are where copy starts, not where it
  // must stop: the title takes up to three lines and the body as many as it needs at full size, and
  // what follows makes room. The header ends by headerBottom, so a photo or chart under it keeps at
  // least 600 px. Agents are still asked for two title lines and two body lines (guideHeight).
  const titleLine = 56 * 1.04, bodyLine = 42.67 * 1.115, bodyTop = 90 + titleLine + 26, contentTop = bodyTop + 2 * bodyLine + 64;
  const headerBottom = 1252 - 64 - 600;
  const header = (key: string, title: string, body: string): TextElement[] => [
    { type: "text", ...at(`${key}-title`, "Title", [72, 90, 936, titleLine]), text: title, ...typeset("sfpro", 56, 700, green, 1.04, -1.2 / 56), ...textSlot("title"), smartText: { ...fit("heading", 0, 56, 56, 3 * titleLine, titleLine), anchorTop: px(90), guideHeight: px(2 * titleLine) + .01 } },
    { type: "text", ...at(`${key}-body`, "Body", [72, bodyTop, 936, 2 * bodyLine]), text: body, ...typeset("sfpro", 42.67, 400, white, 1.115, -.35 / 42.67), ...textSlot("body"), smartFlow: { after: "title", gap: px(26), bottom: px(headerBottom) }, smartText: { ...fit("body", 0, 42.67, 36, headerBottom - bodyTop, 2 * bodyLine), guideHeight: px(2 * bodyLine) + .01 } },
  ];
  // The source line is pinned to the bottom margin and grows upwards to two lines.
  const source = (key: string, text: string, lines: 1 | 2): TextElement => ({
    type: "text", ...at(`${key}-source`, "Source", [72, 1352 - 30 * lines, 936, 30 * lines]), text, ...typeset("sfpro", 24, 400, dim, 1.25, 0), ...textSlot("source"), verticalAlign: "bottom", smartText: fit("body", 0, 24, 20, 60, 60, 24, 1352),
  });
  // Two 448 px columns 40 px apart across the 936 px of text.
  const listHeading = (side: "left" | "right", x: number, word: string): TextElement => ({
    type: "text", ...at(`list-${side}-heading`, `${side === "left" ? "Left" : "Right"} column heading`, [x, contentTop, 448, 55.2]), text: `${word} From AI`, richText: `<span style="color:${green}; font-weight:700">${word}</span> From AI`,
    ...typeset("sfpro", 46, 400, white, 1.2, -.02), ...textSlot(`list-${side}-heading`), smartFlow: { after: "body", gap: px(64), bottom: px(headerBottom + 64 + 110.4) }, smartText: { ...fit("heading", 0, 46, 36, 110.4, 55.2, 46 * .9), group: "list-headings" },
  });
  // Bullet lists, one item per line, wrapped under their own text. The two columns share one
  // size and gap so their rows line up. A short list fills its column down to 1252: type grows
  // to 43 px, about the body's size (wrapping items only when single lines would leave a fifth of
  // the column empty and every line keeps two words), then gaps open to about twice the type size;
  // whatever is still left centres the page's copy between 90 and 1252 (balanceShortCopy in
  // smart-text.ts). A long list shrinks to 26 px.
  const listItems = (side: "left" | "right", x: number, items: string[]): TextElement => ({
    type: "text", ...at(`list-${side}-items`, `${side === "left" ? "Left" : "Right"} column items`, [x, contentTop + 55.2 + 36, 448, 1252 - contentTop - 55.2 - 36]), text: items.join("\n"), ...typeset("sfpro", 34, 400, white, 42 / 34, -.012),
    ...textSlot(`list-${side}-items`), listStyle: "bullet", hangingIndent: true, paragraphSpacing: px(28),
    smartFlow: { after: `list-${side}-heading`, gap: px(36), bottom: px(1252), resize: true },
    smartText: { role: "list", lines: 0, minFontSize: px(26), maxFontSize: px(43), maxHeight: px(1252 - contentTop - 55.2 - 36) + .01, baseHeight: px(1252 - contentTop - 55.2 - 36) + .01, softMinFontSize: px(34), group: "list-items", paragraphSpacing: px(28), maxParagraphSpacing: px(70) },
  });
  // Reaction pages: real posts from X as they look in a phone screenshot of the X app in dark mode,
  // measured on Ivan's examples (1206 px wide) and scaled into a 936 px card: a black box with
  // slightly rounded corners, a thin grey border and black padding inside, so it stands out from
  // the page (Ivan's call), the profile photo, the bold name and its badge, the grey @handle,
  // the X.com mark and the post in SF Pro, and no stats. Each card hugs its post, so a page holds
  // one long post, two medium ones or three short ones. There's no source line (the cards show
  // whose posts they are), so the title and the cards are centred together between the margins.
  // The Text + Media title's box and type, kept to one line.
  const shortTitle = (key: string, title: string): TextElement => ({ type: "text", ...at(`${key}-title`, "Title", [72, 90, 936, titleLine]), text: title, ...typeset("sfpro", 56, 700, green, 1.04, -1.2 / 56), ...textSlot("title"), smartText: fit("heading", 0, 56, 42, titleLine, titleLine), smartCenter: { top: px(90), bottom: px(X_CARD.bottom) } });
  // A grey head-and-shoulders placeholder; the avatar layer's radius makes it round.
  const avatarPlaceholder = (size: number) => {
    const [c, s] = [size / 2, size / 104];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path d="M0 0H${size}V${size}H0Z" fill="${dim}"/><g opacity="0.55"><path d="M${c - 20 * s} ${40 * s}a${20 * s} ${20 * s} 0 1 0 ${40 * s} 0a${20 * s} ${20 * s} 0 1 0 ${-40 * s} 0Z" fill="${grey}"/><path d="M${c - 36 * s} ${size}C${c - 36 * s} ${74 * s} ${c + 36 * s} ${74 * s} ${c + 36 * s} ${size}Z" fill="${grey}"/></g></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const xPath = "M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z";
  // A size in the screenshot, scaled into the card, and a position in it, inside the card's padding.
  const shot = (value: number) => value * X_CARD.scale, inCard = (value: number) => X_CARD.pad + shot(value);
  // SF Pro Display's baseline sits 0.95 em plus half the leading under the top of its line box.
  const baselineAt = (size: number, lineHeight: number) => ((lineHeight - 1.19) / 2 + .95) * size;
  // Type sizes match the screenshot's text widths in SF Pro; positions match its baselines.
  const X = { name: shot(49.7), handle: shot(51.2), text: X_CARD.size, textLine: X_CARD.line, com: shot(61.5), avatar: shot(142), avatarTop: inCard(37), inset: X_CARD.inset, nameX: inCard(194), markX: inCard(969), markTop: inCard(56), mark: shot(44), badge: shot(44), badgeGap: shot(11), markGap: shot(31), foot: X_CARD.foot, between: X_CARD.between };
  const nameTop = inCard(95) - baselineAt(X.name, 1.2), handleTop = inCard(154.5) - baselineAt(X.handle, 1.2), comTop = inCard(99) - baselineAt(X.com, 1.2), textTop = X_CARD.textTop;
  const markWidth = X.mark * 1200 / 1227, nameWidth = X.markX - X.markGap - X.badgeGap - X.badge - X.nameX, mediaWidth = 936 - 2 * X.inset;
  /** A card's height around `lines` lines of post text. */
  const cardHeight = (lines: number) => textTop + lines * X.textLine + X.foot;
  type XPost = { name: string; handle: string; text: string; lines: number };
  /** Post card `n` of a page. Its top follows `after` by `gap`, everything in it follows its
   * top edge, and its bottom hugs the post's photo, or its text while the photo is hidden.
   * The text may reach no lower than `textBottom`. */
  const xPost = (key: string, n: 1 | 2 | 3, top: number, after: string, gap: number, post: XPost, textBottom: number, maxLines: number): CanvasElement[] => {
    const suffix = n === 1 ? "" : `-${n}`, slot = (part: string) => `reaction-${part}${suffix}`, left = 72, nameY = top + nameTop;
    const inside = (offset: number) => ({ after: slot("card"), edge: "top" as const, gap: px(offset), bottom: px(1440) });
    return [
      { type: "shape", ...at(`${key}-card${suffix}`, "Post card", [left, top, 936, cardHeight(post.lines)]), shape: "rectangle", fill: X_POST_COLORS.card, stroke: X_POST_COLORS.border, strokeWidth: px(X_CARD.border), strokeAlign: "inside", radius: px(X_CARD.radius), ...fixed(), slot: slot("card"),
        smartFlow: { after, gap: px(gap), bottom: px(X_CARD.bottom), hug: { after: slot("media"), gap: px(X.foot) } } },
      { type: "image", ...at(`${key}-avatar${suffix}`, "Avatar", [left + X.inset, top + X.avatarTop, X.avatar, X.avatar]), src: avatarPlaceholder(Math.round(X.avatar)), fit: "cover", cropX: 50, cropY: 50, radius: px(X.avatar / 2), intrinsicWidth: Math.round(X.avatar), intrinsicHeight: Math.round(X.avatar),
        directive: "The post author's profile photo from X (pbs.twimg.com)", slot: slot("avatar"), templateRole: "media", layoutRole: "media", protected: ["position", "delete"], smartFlow: inside(X.avatarTop) },
      { type: "text", ...at(`${key}-name${suffix}`, "Author name", [left + X.nameX, nameY, nameWidth, X.name * 1.2]), text: post.name, ...typeset("sfpro", X.name, 700, X_POST_COLORS.text, 1.2, 0), ...textSlot(slot("name")), smartFlow: inside(nameTop), smartText: fit("heading", 0, X.name, X.name * .75, X.name * 1.2, X.name * 1.2) },
      // Sits after the name's last letter. Recreate recolours it per account (blue, gold for organizations, grey) or hides it.
      { type: "shape", ...at(`${key}-badge${suffix}`, "Verified badge", [left + X.nameX + X.name * .55 * post.name.length + X.badgeGap, nameY + (X.name * 1.2 - X.badge) / 2, X.badge, X.badge]), shape: "path", path: X_BADGES.blue.path, viewBox: "0 0 100 100", fillRule: "evenodd", fill: X_BADGES.blue.fill, stroke: "transparent", strokeWidth: 0, radius: 0,
        slot: slot("badge"), templateRole: "brand", layoutRole: "fixed", protected: ["content", "position"], smartFlow: { after: slot("name"), gap: px(X.badgeGap), bottom: px(1440), direction: "right" } },
      { type: "text", ...at(`${key}-handle${suffix}`, "Author handle", [left + X.nameX, top + handleTop, X.markX - X.markGap - X.nameX, X.handle * 1.2]), text: post.handle, ...typeset("sfpro", X.handle, 400, X_POST_COLORS.handle, 1.2, 0), ...textSlot(slot("handle")), smartFlow: inside(handleTop), smartText: fit("body", 0, X.handle, X.handle * .75, X.handle * 1.2, X.handle * 1.2) },
      { type: "shape", ...at(`${key}-x-mark${suffix}`, "X logo", [left + X.markX, top + X.markTop, markWidth, X.mark]), shape: "path", path: xPath, viewBox: "0 0 1200 1227", fill: X_POST_COLORS.text, stroke: "transparent", strokeWidth: 0, radius: 0, ...fixed(), smartFlow: inside(X.markTop) },
      { type: "text", ...at(`${key}-x-com${suffix}`, "X.com", [left + X.markX + markWidth, top + comTop, 120, X.com * 1.2]), text: ".com", ...typeset("sfpro", X.com, 700, X_POST_COLORS.text, 1.2, 0), textMode: "fixed", verticalAlign: "top", ...fixed(), smartFlow: inside(comTop) },
      // The post word for word at the screenshot's size, wrapping like X; only a post too long for its page shrinks.
      { type: "text", ...at(`${key}-text${suffix}`, "Post text", [left + X.inset, top + textTop, 936 - 2 * X.inset, post.lines * X.textLine]), text: post.text, ...typeset("sfpro", X.text, 400, X_POST_COLORS.text, X.textLine / X.text, 0), ...textSlot(slot("text")),
        smartFlow: { after: slot("card"), edge: "top", gap: px(textTop), bottom: px(textBottom) }, smartText: fit("body", 0, X.text, X.text * .8, maxLines * X.textLine, post.lines * X.textLine) },
      // The post's own photo under its text, whole and with X's rounded corners. Hidden until Recreate
      // fills it and sizes it to the photo's proportions; while hidden, the card ends under the text.
      { type: "image", ...at(`${key}-media${suffix}`, "Post photo", [left + X.inset, top + textTop + post.lines * X.textLine + X_CARD.mediaGap, mediaWidth, mediaWidth * 9 / 16]),
        src: placeholder(Math.round(mediaWidth), Math.round(mediaWidth * 9 / 16), mediaWidth / 2, mediaWidth * 9 / 32), fit: "cover", cropX: 50, cropY: 50, radius: px(X_CARD.mediaRadius), hidden: true,
        intrinsicWidth: Math.round(mediaWidth), intrinsicHeight: Math.round(mediaWidth * 9 / 16), directive: "The post's own photo from X (pbs.twimg.com/media), whole", slot: slot("media"), templateRole: "media", layoutRole: "media",
        protected: ["position", "delete"], smartFlow: { after: slot("text"), gap: px(X_CARD.mediaGap), bottom: px(1440) } },
    ];
  };
  /** The cards of a page with `posts.length` posts: the first 64 px under the title, the rest
   * 40 px apart. Each post may grow while the posts after it still fit one line each: 16 lines
   * on its own, 9 beside one more, 3 beside two more (the page holds 16, 10 or 5 in all). */
  const xPosts = (key: string, posts: XPost[]): CanvasElement[] => {
    let top = 216.72;
    const pageLines = Math.floor((X_CARD.room - posts.length * cardHeight(0) - (posts.length - 1) * X.between) / X.textLine);
    return posts.flatMap((post, index) => {
      const n = (index + 1) as 1 | 2 | 3, after = index ? `reaction-card${index === 1 ? "" : `-${index}`}` : "title";
      const elements = xPost(key, n, top, after, index ? X.between : 64, post, X_CARD.bottom - X.foot - (posts.length - n) * (cardHeight(1) + X.between), Math.min(X_CARD.maxLines, pageLines - posts.length + 1));
      top += cardHeight(post.lines) + X.between;
      return elements;
    });
  };
  const samplePost = (name: string, text: string, lines: number): XPost => ({ name, handle: "@handle", text, lines });
  const layout = (sides: number): CanvasLayout => ({ showGuides: true, margins: { enabled: true, top: px(90), right: px(sides || 88), bottom: px(88), left: px(sides || 72) }, snapping: { enabled: true, objects: true, page: true, guides: true, grid: false, spacing: true, tolerance: 6 } });
  const sheet = (key: string, label: string, elements: CanvasElement[], sides = 0): DesignPage => {
    const base = page(`chatgptricks-3x4-${key}`, "folds", { template: "text", heading: "", body: "", bgMode: "color", bgColor: night, textColor: white, font: "sfpro", align: "top", textAlign: "left" });
    const content = elements.filter(element => element.type === "text" || element.templateRole === "media").sort((a, b) => a.y - b.y || a.x - b.x);
    return { ...base, image: { ...base.image, width: 1080, height: 1440 }, label, canvas: { background: night, elements, layout: layout(sides) }, readingOrder: content.map(element => element.id) };
  };
  return {
    id: "chatgptricks-3x4",
    name: "@chatgptricks carousel",
    category: "Carousels",
    format: "portrait",
    customSize: { width: 1080, height: 1440 },
    description: "The @chatgptricks 3:4 carousel: photo cover, text with a photo or chart, a two-column list, a Follow page, and one to three real posts from X drawn like phone screenshots.",
    colorRoles: [
      { id: "cgt-background", name: "Background", color: night }, { id: "cgt-surface", name: "Photo placeholder", color: surface },
      { id: "cgt-text", name: "Text", color: white }, { id: "cgt-accent", name: "Accent green", color: green },
      { id: "cgt-light-grey", name: "Light grey", color: grey }, { id: "cgt-source", name: "Source grey", color: dim },
    ],
    pages: [
      sheet("cover", "Cover", [
        ...hero("cover", "Story photo: ChatGPT on a screen, or people job hunting"),
        hairline("cover-hairline-left", "Left hairline", 41, "#F9FFFE00", white),
        { type: "image", ...at("cover-logo", "ChatGPT Tricks logo", [514, 976.224, 52, 52]), opacity: .9, src: "/template-editor/chatgptricks-logo.png", fit: "contain", cropX: 50, cropY: 50, radius: 0, intrinsicWidth: 831, intrinsicHeight: 832, ...fixed(), smartFlow: { after: "cover-headline", gap: px(38.5), bottom: px(90), direction: "up" } },
        hairline("cover-hairline-right", "Right hairline", 578, white, "#F9FFFE00"),
        // Three balanced lines at 97 px; the box bottom stays 130 px above the page bottom.
        { type: "text", ...at("cover-headline", "Cover headline", [68, 1066.724, 944, 243.276]), text: "SINCE CHATGPT CAME OUT, STOCKS NEARLY DOUBLED WHILE US JOB OPENINGS FELL ALMOST 30%", richText: `SINCE CHATGPT CAME OUT, STOCKS NEARLY DOUBLED WHILE US JOB OPENINGS <span style="color:${green}">FELL ALMOST 30%</span>`, ...typeset("bebas", 97, 400, white, .836, -.02, "center"), ...textSlot("cover-headline"), verticalAlign: "bottom", shadow: glow(), smartText: fit("cover", 3, 97, 54, 4 * 97 * .836, 3 * 97 * .836, 97 * .85, 1310) },
        { type: "text", ...at("cover-swipe", "Swipe for more", [0, 1334, 1080, 32]), text: "SWIPE FOR MORE", ...typeset("sfpro", 32, 700, grey, 1, .01, "center"), textMode: "fixed", verticalAlign: "top", ...fixed() },
      ], 68),
      sheet("media", "Text + Media", [
        ...header("media", "AI vs Jobs", "Since ChatGPT came out, stocks went up\nand job openings went down"),
        // The frame takes its photo's or chart's shape (smartFlow.media): a landscape photo runs edge to
        // edge, a portrait one is centred, and the title, body and media are centred together between
        // 90 and 1252. The placeholder has the text column's shape, so it fills the column under sample copy.
        { ...photo("media-media", "Photo or chart", "media", [72, contentTop, 936, 1252 - contentTop], [468, (1252 - contentTop) / 2], "Chart or photo for this point"), smartFlow: { after: "body", gap: px(64), bottom: px(1252), resize: true, media: { x: 0, width: px(1080) } } },
        source("media", "Source: U.S. BLS job openings (JOLTS) and S&P 500 monthly average, Jan 2003 to Sep 2026. Both set to 100 in Nov 2022, when ChatGPT launched", 2),
      ]),
      sheet("list", "List", [
        ...header("list", "The jobs AI can’t replace", "Anthropic looked at how people use AI at work. Office jobs are most at risk"),
        listHeading("left", 72, "Risk"),
        listItems("left", 72, ["Management", "Business & Finance", "Computer & Math", "Architecture & Engineering", "Life & Social Sciences", "Legal", "Education & Library", "Arts & Media", "Office & Administrative", "Sales", "Social Services"]),
        listHeading("right", 560, "Safe"),
        listItems("right", 560, ["Installation & Repair", "Construction", "Agriculture", "Transportation", "Production", "Protective Service", "Food & Serving", "Grounds Maintenance", "Personal Care", "Healthcare Support", "Healthcare Practitioners"]),
        source("list", "Source: Anthropic, [study name and date]", 1),
      ]),
      sheet("follow", "Follow", [
        ...hero("follow", "Screenshot of the @chatgptricks profile"),
        // "FOLLOW THIS PAGE" sits directly above the call to action, which keeps its bottom 136 px above the page bottom.
        { type: "text", ...at("follow-line", "Follow this page", [68, 1100.016, 944, 101.992]), text: "FOLLOW THIS PAGE", ...typeset("bebas", 122, 400, white, .836, -.02, "center"), textMode: "fixed", verticalAlign: "bottom", shadow: glow(), ...fixed(), smartFlow: { after: "cta", gap: 0, bottom: px(90), direction: "up" } },
        { type: "text", ...at("follow-cta", "Call to action", [68, 1202.008, 944, 101.992]), text: "TO STAY ON THE SAFE SIDE", ...typeset("bebas", 122, 400, green, .836, -.02, "center"), ...textSlot("cta"), verticalAlign: "bottom", shadow: glow(), smartText: fit("cover", 0, 122, 72, 2 * 122 * .836, 122 * .836, 122 * .85, 1304) },
      ], 68),
      // Posts from X: one long post, two medium ones or three short ones. Each card hugs its post
      // (a single post takes up to 16 lines). No source line: the cards show whose posts they are
      // (Ivan's call), so the title and cards are centred between the top and bottom margins.
      sheet("reaction", "Reaction", [
        ...xPosts("reaction", [samplePost("Author name", "Paste a real post from X here, word for word, with the author's spelling, emoji and line breaks\n\nThe card grows with the post, like a screenshot. A post too long for the page is cut at a word boundary with …", 5)]),
        shortTitle("reaction", "How X reacted"),
      ]),
      sheet("reactions", "Two reactions", [
        ...xPosts("reactions", [samplePost("Author name", "A real post from X, word for word. Each card grows with its post", 2), samplePost("Author name 2", "Two medium posts share this page, about ten lines in all", 2)]),
        shortTitle("reactions", "What people are saying"),
      ]),
      sheet("reactions3", "Three reactions", [
        ...xPosts("reactions3", [samplePost("Author name", "Short posts share a page", 1), samplePost("Author name 2", "Up to three of them, about five lines in all", 1), samplePost("Author name 3", "Each card hugs its own text", 1)]),
        shortTitle("reactions3", "What people are saying"),
      ]),
    ],
  };
}
