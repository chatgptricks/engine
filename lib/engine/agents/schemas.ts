/**
 * What each Recreate stage hands in. Engine's own agents answer in these
 * shapes, and an outside agent that does a stage itself (submit_stage) is
 * checked against the same schema.
 */
import { z } from "zod";
import type { PostMode, PostStage } from "../post-files";

const Link = z.object({ title: z.string(), url: z.string() });

/** A chart as a writer describes it; Engine downloads the real series. */
export const ChartSchema = z.object({
  kind: z.enum(["line", "bar"]).describe("line: series over time; bar: one value per bar, typed (an exact copy of a bar chart)"),
  unit: z.string(),
  labels: z.array(z.string()),
  series: z.array(z.object({ name: z.string(), source: z.enum(["typed", "fred", "sp500_history"]), fred: z.string().nullable(), values: z.array(z.number()), emphasis: z.boolean() })),
  from: z.string().nullable(),
  to: z.string().nullable().describe("The last date to show (YYYY-MM-DD), so a copy ends where the original ends; null for the latest data"),
  markerDate: z.string().nullable(),
  indexToMarker: z.boolean(),
  markerIndex: z.number().int(),
  markerLabel: z.string(),
  markerIcon: z.enum(["none", "openai"]),
  endLabel: z.enum(["value", "change_since_marker", "none"]),
  markers: z.array(z.object({ date: z.string().nullable(), index: z.number().int(), label: z.string(), icon: z.enum(["none", "openai"]) })),
  band: z.object({ fromDate: z.string().nullable(), toDate: z.string().nullable(), fromIndex: z.number().int(), toIndex: z.number().int(), label: z.string() }).nullable(),
  highlight: z.array(z.number().int()).describe("bar: the indexes of the bars the original sets apart in another color; else empty"),
});
/** A chart handed in by an agent or a person may leave out the fields added for bar charts and end dates: it is then a line to the latest data. */
const HandedInChartSchema = ChartSchema.extend({
  kind: ChartSchema.shape.kind.default("line"),
  to: ChartSchema.shape.to.default(null),
  highlight: ChartSchema.shape.highlight.default([]),
});
const RangeSchema = z.object({ min: z.number(), max: z.number() });
/** An exact copy's chart: its lines may read against two scales, and each scale keep its printed range, as the original's do. A full recreation's has one scale (ChartSchema). */
const ExactChartFieldsSchema = ChartSchema.extend({
  series: z.array(ChartSchema.shape.series.element.extend({
    axis: z.enum(["left", "right"]).describe("right only for a line the original reads against its second scale; else left"),
  })),
  range: RangeSchema.nullable().describe("The left (or only) scale's lowest and highest numbers as the original prints them, in the series' units, when every value fits in them; else null to fit the data"),
  right: z.object({ unit: z.string(), range: RangeSchema.nullable() }).nullable()
    .describe("Only when the original prints a second scale: its unit and its printed range (or null), for the lines on axis right. Else null"),
});
const HandedInExactChartSchema = ExactChartFieldsSchema.extend({
  kind: ChartSchema.shape.kind.default("line"),
  to: ChartSchema.shape.to.default(null),
  highlight: ChartSchema.shape.highlight.default([]),
  series: z.array(ExactChartFieldsSchema.shape.series.element.extend({ axis: ExactChartFieldsSchema.shape.series.element.shape.axis.default("left") })),
  range: ExactChartFieldsSchema.shape.range.default(null),
  right: ExactChartFieldsSchema.shape.right.default(null),
});
type BaseChart = z.infer<typeof ChartSchema>;
/** A written chart: a full recreation's, or an exact copy's, whose lines may also read against a second scale. */
export type WrittenChart = Omit<BaseChart, "series"> & {
  series: (BaseChart["series"][number] & { axis?: "left" | "right" })[];
  range?: { min: number; max: number } | null;
  right?: { unit: string; range: { min: number; max: number } | null } | null;
};

export const BriefSchema = z.object({
  topic: z.string().describe("The story in one plain line"),
  story: z.string().describe("The facts in 1-3 plain sentences, as a reporter would brief them"),
  originalHeadline: z.string().describe("The original cover headline, word for word"),
  angle: z.string().describe("Why it matters to our readers, in one sentence"),
  slides: z.array(z.object({
    index: z.number().int().describe("1-based slide number in the original"),
    role: z.enum(["cover", "text", "chart", "list", "photo", "quote", "post", "follow", "other"]),
    says: z.string().describe("What the slide says, close to word for word"),
    shows: z.string().describe("What is on it: chart, photo, screenshot, layout"),
    keep: z.string().describe("What our version keeps from this slide"),
  })),
  chart: z.object({
    what: z.string(), series: z.array(z.string()), scaling: z.string(), start: z.string(), end: z.string(),
    markers: z.array(z.string()), shaded: z.string(),
  }).nullable().describe("The original's main chart in detail, or null"),
  claims: z.array(z.string()).describe("Every factual claim to verify"),
  questions: z.array(z.string()).describe("The first 2-4 questions a reader asks right after the hook"),
  reactionSearch: z.object({
    terms: z.array(z.string()).describe("2-4 short X search terms people would really use about this story"),
    since: z.string().describe("Earliest post date to search, YYYY-MM-DD"),
  }),
  photos: z.array(z.string()).describe("Real photos or screenshots our cover and photo slides need, as X image searches"),
  risks: z.array(z.string()),
});
export type Brief = z.infer<typeof BriefSchema>;

export const FactCheckSchema = z.object({
  claim: z.string(),
  verdict: z.enum(["confirmed", "corrected", "unverified"]),
  detail: z.string().describe("The correct figure or what the source says"),
  sources: z.array(Link),
});
export type FactCheck = z.infer<typeof FactCheckSchema>;
export const FactsSchema = z.object({
  claims: z.array(FactCheckSchema),
  answers: z.array(z.object({ question: z.string(), answer: z.string().describe("1-2 plain sentences"), sources: z.array(Link) })),
  context: z.array(z.string()).describe("Other checked facts worth a slide, each ending with its source in brackets"),
  risks: z.array(z.string()).describe("Anything misleading in the original"),
});
export type Facts = z.infer<typeof FactsSchema>;

const DataChartSchema = z.object({
  id: z.string().describe("Short id, such as main"),
  purpose: z.string(),
  recreates: z.string().describe("Which chart of the original this rebuilds, or new"),
  chart: ChartSchema,
  source: z.string().describe("The slide's source line: the source and the date range shown"),
});
export const DataSchema = z.object({
  charts: z.array(DataChartSchema),
  notes: z.array(z.string()),
});
export type DataOutput = z.infer<typeof DataSchema>;
const HandedInDataSchema = DataSchema.extend({ charts: z.array(DataChartSchema.extend({ chart: HandedInChartSchema })) });

/** An exact copy's charts: each one the copier boxed, redrawn from real data, or the reason it stays cut from the original. */
const ExactChartSchema = z.object({
  slide: z.number().int().describe("The original slide the chart is on, 1-based, as the copier boxed it"),
  chart: ExactChartFieldsSchema,
  source: z.string().describe("Where the numbers come from: the series and the dates shown, or the page the printed values were checked against"),
});
export const ExactDataSchema = z.object({
  charts: z.array(ExactChartSchema),
  missing: z.array(z.object({
    slide: z.number().int(),
    why: z.string().describe("Why the chart can't be redrawn from real data, in one plain sentence"),
  })).describe("Charts that stay cut from the original"),
  notes: z.array(z.string()),
});
export type ExactDataOutput = z.infer<typeof ExactDataSchema>;
const HandedInExactDataSchema = ExactDataSchema.extend({ charts: z.array(ExactChartSchema.extend({ chart: HandedInExactChartSchema })) });

export const ReactionSchema = z.object({
  id: z.string(), url: z.string(),
  author: z.object({
    name: z.string(), handle: z.string(), avatarUrl: z.string().nullable(), verified: z.boolean(),
    badge: z.enum(["blue", "gold", "grey"]).nullable().optional().describe("X's check mark: blue (paid), gold (organization), grey (government), or null"),
    square: z.boolean().optional().describe("True for organizations, whose profile photos are rounded squares"),
  }),
  text: z.string(),
  media: z.object({
    url: z.string(), width: z.number(), height: z.number(),
    kind: z.enum(["video", "gif"]).optional().describe("Set for a video or GIF, whose poster frame url is; left out for a photo"),
    durationMs: z.number().nullable().optional().describe("A video's length in milliseconds"),
  }).nullable().optional().describe("The post's first photo (pbs.twimg.com/media), or its video's or GIF's poster frame, and its size"),
  createdAt: z.string().nullable(),
  likes: z.number(), reposts: z.number(), replies: z.number(), views: z.number(),
  why: z.string(),
});
export type PickedReaction = z.infer<typeof ReactionSchema>;
export const ReactionsSchema = z.object({ reactions: z.array(ReactionSchema), note: z.string() });
export type ReactionsOutput = z.infer<typeof ReactionsSchema>;

export const VisualsSchema = z.object({
  candidates: z.array(z.object({ id: z.string(), url: z.string(), description: z.string(), sourceUrl: z.string(), credit: z.string() })),
  note: z.string(),
});
export type VisualsOutput = z.infer<typeof VisualsSchema>;

export const OUTLINE_KINDS = ["cover", "original", "question", "reaction", "takeaway", "follow"] as const;
export const OutlineSlideSchema = z.object({
  kind: z.enum(OUTLINE_KINDS),
  templatePage: z.number().int().describe("Index of the template page this slide uses"),
  purpose: z.string().describe("What this slide tells the reader, in one line"),
  points: z.array(z.string()).describe("The facts and numbers it uses, each from the research"),
  chartId: z.string().nullable().describe("A chart id from the data stage, or null"),
  reactionIds: z.array(z.string()).describe("Reaction ids for a Reaction page, as many as its cards: one long post, two medium ones or three short ones; else empty"),
  photo: z.string().describe("The photo this slide needs, or empty"),
});
export type OutlineSlide = z.infer<typeof OutlineSlideSchema>;
export const OutlineSchema = z.object({ slides: z.array(OutlineSlideSchema), why: z.string() });
export type Outline = z.infer<typeof OutlineSchema>;

export const HookOptionSchema = z.object({
  text: z.string(),
  framework: z.string(),
  by: z.enum(["headline-model", "copywriter", "agent"]),
  /** For Spanish pages: the headline model's English line this one adapts. */
  english: z.string().nullable(),
});
export type HookOption = z.infer<typeof HookOptionSchema>;
export const HooksSchema = z.object({
  options: z.array(HookOptionSchema),
  source: z.enum(["headline-model", "copywriter", "agent"]),
  /** The checked story and the list exactly as the headline model returned it, for saving the pick. */
  story: z.string(),
  modelOptions: z.array(z.object({ text: z.string(), framework: z.string().optional(), sources: z.array(z.string()).optional() })),
  note: z.string(),
});
export type HooksOutput = z.infer<typeof HooksSchema>;

export const ApprovalSchema = z.object({
  outline: OutlineSchema,
  hook: z.object({ text: z.string(), option: z.number().int().describe("Index into the hook options, or -1 for a hook written by hand") }),
  notes: z.string(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const CopySchema = z.object({
  name: z.string().describe("A short name for the deck"),
  slides: z.array(z.object({
    templatePage: z.number().int(),
    texts: z.array(z.object({ slot: z.string(), text: z.string() })),
  })).describe("One entry per outline slide, in the same order"),
  caption: z.string(),
  notes: z.array(z.string()),
});
export type CopyOutput = z.infer<typeof CopySchema>;

export const ChartsSchema = z.object({
  charts: z.array(z.object({ id: z.string(), ok: z.boolean(), error: z.string(), points: z.number().int(), from: z.string(), to: z.string() })),
});
export type ChartsOutput = z.infer<typeof ChartsSchema>;

export const ImagesSchema = z.object({
  photos: z.array(z.object({
    slide: z.number().int().describe("0-based outline slide"), url: z.string(), alt: z.string(), credit: z.string(), sourceUrl: z.string(),
    seam: z.number().min(0.1).max(0.9).optional().describe("Only on the first slide of a photo pair (one photo across two slides): the share of the photo on that slide, so the split misses faces and text. Default 0.5"),
  })),
  notes: z.array(z.string()),
});
export type ImagesOutput = z.infer<typeof ImagesSchema>;

export const DeckSchema = z.object({
  deckId: z.string(), name: z.string(), slideCount: z.number().int(), savedAt: z.string(), notes: z.array(z.string()),
  /** Each deck page with its template page and its slide in the approved outline. */
  pages: z.array(z.object({ pageId: z.string(), templatePage: z.number().int(), slide: z.number().int() })),
  /** Why a rebuilt version wasn't saved (a person edited the deck), or "". */
  held: z.string(),
});
export type DeckOutput = z.infer<typeof DeckSchema>;

export const IssueSchema = z.object({
  slide: z.number().int().describe("1-based slide number, or 0 for the whole post"),
  problem: z.string(),
  fix: z.string().describe("The exact change to make"),
  severity: z.enum(["must_fix", "should_fix", "note"]),
  route: z.enum(["copy", "data", "images", "none"]).describe("Who fixes it: copy for words, data for charts, images for photos"),
});
export type Issue = z.infer<typeof IssueSchema>;
export const CriticSchema = z.object({ verdict: z.enum(["ship", "fix"]), summary: z.string(), issues: z.array(IssueSchema) });
export type CriticOutput = z.infer<typeof CriticSchema>;
export const ReviewSchema = z.object({
  round: z.number().int(),
  rendered: z.boolean(),
  checks: z.array(IssueSchema),
  facts: CriticSchema.nullable(),
  design: CriticSchema.nullable(),
  /** Who the must-fix issues went back to for another round. */
  sentBack: z.array(z.enum(["copy", "data", "images"])),
});
export type ReviewOutput = z.infer<typeof ReviewSchema>;

/** An exact copy's picture: what it is and where it sits on the original slide, on a 0-1000 grid. */
export const MEDIA_KINDS = ["photo", "chart", "screenshot", "none"] as const;
export const MediaBoxSchema = z.object({
  x: z.number().describe("Left edge, 0-1000 across the original slide"),
  y: z.number().describe("Top edge, 0-1000 down the original slide"),
  width: z.number().describe("Width on the same grid"),
  height: z.number().describe("Height on the same grid"),
});
export type MediaBox = z.infer<typeof MediaBoxSchema>;
/**
 * A graphic made of parts (a meme, a row or grid of logos, a diagram with
 * words), which an exact copy rebuilds in the page's template: its words as
 * text in our styles, its logos found as clean files, its photos cut one by one.
 */
export const GRAPHIC_BLOCKS = ["heading", "text", "photo", "logos", "picture"] as const;
export const GraphicLogoSchema = z.object({
  brand: z.string().describe("The brand whose mark is drawn, by its usual full name (Visual Studio Code, Amazon Web Services, OpenAI). The mark decides: a Codex label under the OpenAI knot is OpenAI. Empty for a plain icon that is no brand's logo, such as a database can or a terminal"),
  label: z.string().describe("The words under or beside the logo, word for word (translated when the slide is), or empty"),
});
export const GraphicBlockSchema = z.object({
  kind: z.enum(GRAPHIC_BLOCKS).describe("heading: a title line; text: other words; photo: a photo of people, places or things; logos: one logo or a row or grid of them; picture: any other small image to keep as it is"),
  box: MediaBoxSchema.describe("Where the block sits on the original slide, tight around it"),
  text: z.string().describe("heading and text: the words, word for word (translated when the slide is); else empty"),
  align: z.enum(["left", "center", "right"]).describe("How the words line up in the original; center for blocks without words"),
  columns: z.number().int().describe("logos: how many logos the original's rows hold; else 0"),
  logos: z.array(GraphicLogoSchema).describe("logos: every logo in reading order, row by row; else empty"),
  alt: z.string().describe("photo and picture: what it shows, in plain words; else empty"),
});
export type GraphicBlock = z.infer<typeof GraphicBlockSchema>;
export const GraphicSchema = z.object({
  panels: z.array(z.object({
    box: MediaBoxSchema.describe("The panel on the original slide: its card or window, or the area its parts share"),
    card: z.boolean().describe("True when the original draws the panel as a card, window or box of its own; false when its parts sit straight on the slide"),
    blocks: z.array(GraphicBlockSchema).describe("The panel's parts in reading order. Leave out window dots, borders, shadows and the original page's own branding"),
  })).describe("The graphic's panels in reading order, one when it has no separate panels"),
});
export type Graphic = z.infer<typeof GraphicSchema>;
/** A post from X shown on an original slide, as an exact copy transcribes it to rebuild it as our post card. */
export const X_BADGES = ["none", "blue", "gold", "grey"] as const;
export const CopiedPostSchema = z.object({
  box: MediaBoxSchema.describe("The whole post on the original slide, tight around it"),
  name: z.string().describe("The display name, word for word"),
  handle: z.string().describe("The @handle, without the @"),
  badge: z.enum(X_BADGES).describe("The check mark next to the name: blue, gold (an organization), grey (a government) or none"),
  square: z.boolean().describe("True when the profile photo is a rounded square, as organizations' are; false when it is round"),
  text: z.string().describe("The post's own words, word for word in the post's own language, with its line breaks. Never translated"),
  language: z.string().describe("The language of the post's words, as a two-letter code such as en"),
  date: z.string().nullable().describe("The date the post shows, as YYYY-MM-DD, or null"),
  link: z.string().nullable().describe("A link to this post (x.com/…/status/…) shown on the slide or in the caption, or null"),
  avatar: MediaBoxSchema.nullable().describe("The profile photo on the original slide, or null"),
  photo: MediaBoxSchema.nullable().describe("The post's own photo or video frame, whole (one box around all its photos when it shows several), or null"),
});
export type CopiedPost = z.infer<typeof CopiedPostSchema>;
/** One original slide on one of our template's pages. */
const TranscriptSlideSchema = z.object({
  original: z.number().int().describe("1-based slide number in the original"),
  templatePage: z.number().int().describe("Index of the template page this slide uses"),
  texts: z.array(z.object({ slot: z.string(), text: z.string() })),
  media: z.object({
    kind: z.enum(MEDIA_KINDS).describe("What to cut from the original slide for the page's photo slot, or none"),
    box: MediaBoxSchema.nullable().describe("Only the picture itself: no text over or around it, no border or background. Null for none"),
    alt: z.string().describe("What the picture shows, in plain words, for screen readers"),
  }),
  graphic: GraphicSchema.nullable().describe("A graphic made of parts to rebuild in our template, which then takes the page's media area (media kind none); null when the page's slots and a cut picture copy the slide"),
  posts: z.array(CopiedPostSchema).describe("Posts from X shown on the slide, in reading order, rebuilt as our post cards on the Reaction page (media kind none, graphic null); else empty"),
});
/** An exact copy: each original slide laid out on one of our template's pages, word for word. */
export const TranscriptSchema = z.object({
  name: z.string().describe("A short name for the deck"),
  originalLanguage: z.string().describe("The original's language as a two-letter code, such as en or es"),
  translated: z.boolean().describe("True when the words were translated into the page's language"),
  slides: z.array(TranscriptSlideSchema).describe("One entry per original slide, in the original's order"),
  caption: z.string(),
  notes: z.array(z.string()),
});
/** A transcript handed in by an agent or a person may leave graphics and posts out, as one written before they were rebuilt does: it then has none. */
const HandedInTranscriptSchema = TranscriptSchema.extend({
  slides: z.array(TranscriptSlideSchema.extend({
    graphic: TranscriptSlideSchema.shape.graphic.default(null),
    posts: TranscriptSlideSchema.shape.posts.default([]),
  })).describe("One entry per original slide, in the original's order"),
});
export type TranscriptOutput = z.infer<typeof TranscriptSchema>;

/** Stages an outside agent may hand in itself. Charts and the deck are built by Engine from the others. */
export const SUBMITTABLE: Partial<Record<PostStage, z.ZodType>> = {
  transcript: HandedInTranscriptSchema,
  brief: BriefSchema, facts: FactsSchema, data: HandedInDataSchema, reactions: ReactionsSchema, visuals: VisualsSchema,
  outline: OutlineSchema, hooks: HooksSchema, approval: ApprovalSchema, copy: CopySchema, images: ImagesSchema, review: ReviewSchema,
};
/** An exact copy's data stage hands in its own shape. */
export const submittableFor = (stage: PostStage, mode: PostMode): z.ZodType | undefined =>
  mode === "exact" && stage === "data" ? HandedInExactDataSchema : SUBMITTABLE[stage];
