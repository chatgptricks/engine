/**
 * Domain types for the Engine curation tool.
 *
 * This shape maps one-to-one onto the output of the story-finder system
 * that will feed this app later (see the build spec, section 7). It is
 * also the exact shape persisted to localStorage today and the shape a
 * future "save" would write back to a backend. Keep them aligned so the
 * storage layer stays a thin adapter and swapping mock → live feed is a
 * single change in `loadStories()`.
 */

export type StoryStatus =
  | "researching"
  | "queue"
  | "for_you"
  | "published"
  // research errored or was interrupted — recoverable via Retry
  | "failed";
export type VerificationStatus = "fully_verified" | "partial" | "unverifiable";
export type ImageSource =
  | "google"
  | "pinterest"
  | "apify"
  | "cosmos_manual"
  | "web"
  | "x"
  | "upload";

/** A search directive from the finder, kept on the story so the "Find more
 * images" (Apify) action can reuse precise queries per source. */
export interface SearchDirective {
  directive: string;
  source: string;
  kind: string;
}
export type ImageKind = "real_subject" | "atmospheric";

export interface SourceLink {
  name: string;
  url: string;
}

export interface VerifiedFact {
  fact: string;
  sources: SourceLink[];
  /** True when two independent sources confirm the fact. Shown as a small marker. */
  confirmedByTwo: boolean;
}

export interface ContestedPoint {
  /** The disputed or uncertain claim. */
  claim: string;
  /** How the drafted caption handles the uncertainty. */
  handling: string;
}

export interface Dossier {
  verificationStatus: VerificationStatus;
  verifiedFacts: VerifiedFact[];
  primarySources: SourceLink[];
  /** May be empty — the Contested section is omitted when so. */
  contestedPoints: ContestedPoint[];
}

export interface CaptionData {
  draft: string;
  /** Optional title burned over the lead image. `use:false` hides it. */
  titleOverImage: { use: boolean; text: string };
}

export interface StoryImage {
  id: string;
  url: string;
  source: ImageSource;
  kind: ImageKind;
  /** The search directive that surfaced this image. Shown subtly on hover. */
  directive: string;
  width: number;
  height: number;
  rightsNote: string;
  /** A source added by hand (Cosmos-manual). Flagged subtly in the gallery. */
  cosmosManual: boolean;
  /** The page/tweet the image was pulled from (shown + linked in the expand view). */
  sourceUrl?: string;
  /** What the image is — alt text, page title, or tweet text — for the expand view. */
  description?: string;
  /** "video" for uploaded clips (rendered with <video>); absent/"image" otherwise. */
  mediaType?: "image" | "video";
  /**
   * Forward hook (spec §9, taste learning): a per-image rank a future
   * ranking service could set to reorder the gallery. Unused in v1.
   */
  tasteRank?: number;
}

/**
 * Everything the user produces. `selectedImageIds` is the ordered
 * selection (index 0 = slide 1). `order` mirrors it for data-contract
 * fidelity. `captionEdited` overrides `caption.draft` when present.
 * This is what persists to localStorage and what a future save writes back.
 */
/**
 * Per-slide post layout. The chosen template restyles how that image renders
 * on the Instagram-preview card (overlay, gradient, quote, etc.); the text /
 * font / placement override the defaults. Stored per image id in the curation.
 */
export type SlideTemplate =
  | "text"
  | "plain"
  | "overlay"
  | "fullbleed"
  | "quote"
  // implemented later (multi-image / blur):
  | "stacked"
  | "blur"
  | "split"
  | "masonry";

export interface SlideStyle {
  template: SlideTemplate;
  /** Header / quote text. Falls back to the title-over-image or story title. */
  heading?: string;
  /** Sub / description / citation line. */
  body?: string;
  /** Rich version of `heading` — sanitized inline HTML (b/i/u/s + font/weight
   * spans) from on-canvas word styling. When set it wins; `heading` stays in
   * sync as the plain-text mirror. Cleared by panel Content edits. */
  headingHtml?: string;
  /** Rich version of `body` (same contract as headingHtml). */
  bodyHtml?: string;
  /** Font id from the editor's palette (legacy "serif"/"sans" still map). */
  font?: string;
  /** Vertical placement of the text block. */
  align?: "top" | "center" | "bottom";
  /** Free offset of the text block (drag it on the slide; % of its own box). */
  textX?: number;
  textY?: number;
  /** Text size multiplier (0.5–2.5; scales heading + body together). */
  textScale?: number;
  /** Horizontal text alignment inside the block. */
  textAlign?: "left" | "center" | "right";
  /** Text color override (any CSS color; default per template). */
  textColor?: string;
  /** Text block opacity (0–1). */
  textOpacity?: number;
  /** Line-height multiplier on the template's defaults (0.7–2). */
  lineHeight?: number;
  /** Letter spacing in em (overrides the template's default). */
  letterSpacing?: number;
  /** Heading weight (400 or 700; templates default to 600/700). */
  fontWeight?: number;
  /** Media box opacity (0–1). */
  mediaOpacity?: number;
  /** Media box corner radius in px (preview scale; exports scale with it). */
  mediaRadius?: number;
  /** Legacy uniform size multiplier for the media card. Falls back for cardW/cardH. */
  cardScale?: number;
  /** Independent width / height multipliers for the media card (stacked / blur). */
  cardW?: number;
  cardH?: number;
  /** Media reposition (offset %, of the frame) + manual size (% of the frame). */
  mediaX?: number;
  mediaY?: number;
  mediaW?: number;
  mediaH?: number;
  /** Pan of the image INSIDE its box (object-position offset, % from center).
   * Dragged via the bottom-left pan handle. */
  mediaInX?: number;
  mediaInY?: number;
  /** Zoom of the image INSIDE its box (1 = cover fit; <1 reveals background,
   * >1 magnifies the crop). Dragged via the top-left zoom handle. */
  mediaScale?: number;
  /** Trim window for video media, in seconds. Playback and export loop within
   * [mediaStart, mediaEnd]; absent = the full clip. */
  mediaStart?: number;
  mediaEnd?: number;
  /** Background treatment behind the media. Absent = the template's own default. */
  bgMode?: "color" | "blur";
  bgColor?: string;
  /** Show the image's details (description + source citation) under the picture. */
  credit?: boolean;
  /** Curator overrides for the details text. Absent = derived from the image. */
  creditText?: string;
  creditSource?: string;
}

export interface Curation {
  selectedImageIds: string[];
  order: string[];
  captionEdited: string | null;
  publishedAt: string | null;
  /** Starred/favorited by the curator. */
  starred?: boolean;
  /** Set aside: keep it, but out of the working views (not deleted). */
  shelved?: boolean;
  /** Per-image post layout (keyed by image id). Absent = plain. */
  slideStyles: Record<string, SlideStyle>;
}

/**
 * The research brief captured by the Create flow. Present on user-created
 * stories (status "researching"); the future research engine consumes this
 * to know what to go find.
 */
export interface ResearchBrief {
  prompt: string;
  /** Names of non-image files attached as reference material. */
  attachments: string[];
  createdAt: string;
  /** Territory vein this run was steered to (Home per-type buttons), for Retry. */
  requestedType?: string;
}

/** One gate of the five-gate rubric (Part 3 of the finder prompt). */
export interface RubricGate {
  pass: boolean;
  note: string;
}

/** The finder's pass/fail verdict across the gates. */
export interface Rubric {
  verification: RubricGate;
  specificity: RubricGate;
  hiddenness: RubricGate;
  synthesis: RubricGate;
  visual: RubricGate;
  voice: RubricGate;
}

export interface Story {
  id: string;
  status: StoryStatus;
  title: string;
  /** Short 1–2 line summary, distinct from the full caption. */
  description: string;
  /** Which Territory vein this post is (see lib/post-types.ts). */
  postType?: string;
  /** The channel (Instagram account) this story is being curated for. */
  channelId?: string;
  /** Editorial territory from the alignment layer: sponsorable / audience-shaping / pure. */
  alignment?: string;
  /** One-line note on the alignment (e.g. which brand-world a sponsorable story orbits). */
  alignmentNote?: string;
  /** ISO timestamp of when research completed. */
  researchCompletedAt: string;
  leadImageId: string;
  techOvert: boolean;
  dossier: Dossier;
  caption: CaptionData;
  images: StoryImage[];
  curation: Curation;
  /** Only on stories created locally via the Create flow. */
  brief?: ResearchBrief;
  /** Set when status is "failed" — a short reason, shown on the card. */
  error?: string;
  /** The finder's rubric verdict, when the story came through research. */
  rubric?: Rubric;
  verdict?: "SURFACE" | "REJECT";
  /** The finder's image search directives, kept for Apify enrichment. */
  searchDirectives?: SearchDirective[];
}

/**
 * Shape the research route returns and the store applies onto a created story.
 * Mirrors the finder's OUTPUT FORMAT, mapped to our domain types.
 */
export interface ResearchStoryPayload {
  title: string;
  description: string;
  postType?: string;
  alignment?: string;
  alignmentNote?: string;
  verdict: "SURFACE" | "REJECT";
  rubric?: Rubric;
  techOvert: boolean;
  caption: string;
  titleOverImage: { use: boolean; text: string };
  dossier: Dossier;
  images: StoryImage[];
  directives?: SearchDirective[];
}

export function emptyCuration(): Curation {
  return {
    selectedImageIds: [],
    order: [],
    captionEdited: null,
    publishedAt: null,
    starred: false,
    shelved: false,
    slideStyles: {},
  };
}
