/**
 * What each Recreate stage hands in. Engine's own agents answer in these
 * shapes, and an outside agent that does a stage itself (submit_stage) is
 * checked against the same schema.
 *
 * The current team's schemas come first (post files of version 2). The first
 * team's follow, for its modules and its read-only files, until the cleanup.
 */
import { z } from "zod";
import type { LegacyStage, PostMode, PostStage } from "../post-files";

const Link = z.object({ title: z.string(), url: z.string() });
export const LinkSchema = Link;
export type Link = z.infer<typeof Link>;

/** Where a part sits on an original slide, on a 0-1000 grid. */
export const MediaBoxSchema = z.object({
  x: z.number().describe("Left edge, 0-1000 across the original slide"),
  y: z.number().describe("Top edge, 0-1000 down the original slide"),
  width: z.number().describe("Width on the same grid"),
  height: z.number().describe("Height on the same grid"),
});
export type MediaBox = z.infer<typeof MediaBoxSchema>;

// ── 1. source: the original post, read from its slides, caption and details ──
const TractionSchema = z.object({
  likes: z.number().nullable(), comments: z.number().nullable(),
  views: z.number().nullable().describe("A video's or reel's views; null for photos"),
});
export type Traction = z.infer<typeof TractionSchema>;
/** How the original looks, so our designer keeps what works and replaces what is theirs. */
export const TemplateNotesSchema = z.object({
  cover: z.object({
    layout: z.string().describe("Where the headline and the subject sit, the background and any insets"),
    headline: z.object({
      text: z.string().describe("The cover headline, word for word"),
      casing: z.enum(["upper", "title", "sentence", "lower", "mixed"]),
      lines: z.array(z.string()).describe("The headline as the original breaks it into lines"),
      weight: z.string().describe("How heavy the type is, such as bold or black"),
      highlighted: z.array(z.string()).describe("Words the original sets apart in color or weight"),
    }),
    subject: z.object({
      kind: z.enum(["cutout", "photo", "none"]).describe("cutout: a person or thing cut out of its background; photo: a full photo"),
      what: z.string().describe("Who or what it is"),
      position: z.string(),
      size: z.string().describe("How much of the slide it takes"),
    }),
    background: z.string(),
    insets: z.array(z.string()).describe("Smaller pictures over the main one: what each shows and where"),
  }),
  branding: z.array(z.string()).describe("The original page's own branding (name, handle, logo, watermark, swipe prompts, slide numbers), recorded so ours replaces it; never copied"),
  slides: z.array(z.object({
    index: z.number().int().describe("1-based slide number in the original"),
    role: z.string().describe("What the slide does in the post"),
    layout: z.string().describe("How it is laid out, in reading order"),
  })),
  avoid: z.array(z.string()).describe("Not to copy: the original's errors and branding. Claims that fail the check are added after research"),
});
export type TemplateNotes = z.infer<typeof TemplateNotesSchema>;
export const SOURCE_PARTS = ["photo", "chart", "x_post", "logo", "screenshot", "graphic"] as const;
/** A part of an original slide that isn't plain words: what it is and where it sits. */
export const SourcePartSchema = z.object({
  kind: z.enum(SOURCE_PARTS),
  box: MediaBoxSchema.describe("Tight around the part"),
  what: z.string().describe("What it is: who is in the photo, what the chart shows, whose post, which brand"),
  text: z.string().describe("Words inside the part, word for word: a post's words, a logo's label, a chart's title and labels; else empty"),
  post: z.object({
    name: z.string(), handle: z.string().describe("Without the @"),
    badge: z.enum(["none", "blue", "gold", "grey"]),
    square: z.boolean().describe("True when the profile photo is a rounded square, as organizations' are"),
    date: z.string().nullable().describe("YYYY-MM-DD, or null"),
    link: z.string().nullable().describe("A link to the post shown on the slide or in the caption, or null"),
    avatar: MediaBoxSchema.nullable(), photo: MediaBoxSchema.nullable(),
  }).nullable().describe("x_post: the post's details; else null"),
});
export type SourcePart = z.infer<typeof SourcePartSchema>;
export const TEXT_ROLES = ["headline", "title", "body", "list", "label", "quote", "source", "tag", "other"] as const;
export const SourceSlideSchema = z.object({
  index: z.number().int().describe("1-based slide number in the original"),
  role: z.enum(["cover", "text", "chart", "list", "photo", "quote", "post", "follow", "other"]),
  texts: z.array(z.object({ role: z.enum(TEXT_ROLES), text: z.string().describe("Word for word, one sentence or phrase per line") })),
  parts: z.array(SourcePartSchema),
});
export type SourceSlide = z.infer<typeof SourceSlideSchema>;
export const SourceNotesSchema = z.object({
  post: z.object({
    author: z.object({ handle: z.string(), name: z.string() }),
    format: z.enum(["carousel", "photo", "video", "reel"]),
    date: z.string().nullable().describe("When it was posted, YYYY-MM-DD, or null"),
    caption: z.string().describe("The full caption"),
    url: z.string().nullable(),
    traction: TractionSchema,
  }),
  originalLanguage: z.string().describe("A two-letter code such as en or es"),
  shows: z.string().describe("What the slides' pictures and video show"),
  claims: z.string().describe("What the slides and the caption claim"),
  mismatch: z.string().describe("Where what the media shows and what is claimed disagree, or empty"),
  template: TemplateNotesSchema,
  slides: z.array(SourceSlideSchema).describe("Every original slide in order: every word by its role, and each part that isn't plain words"),
  notes: z.array(z.string()),
});
export type SourceNotes = z.infer<typeof SourceNotesSchema>;

// ── 2. research: where the story comes from, what is true, and whether it is worth making ──
export const FACT_LABELS = ["confirmed", "reported", "alleged", "unknown"] as const;
export const ResearchFactSchema = z.object({
  claim: z.string().describe("A hard fact: a name, title, number, date, amount or quote"),
  label: z.enum(FACT_LABELS).describe("confirmed: a primary source; reported: credible press; alleged: one side's claim, always worded as an allegation; unknown"),
  detail: z.string().describe("What the source says"),
  correction: z.string().describe("The correct version when the original gets it wrong, else empty"),
  sources: z.array(Link),
});
export type ResearchFact = z.infer<typeof ResearchFactSchema>;
/** A post from X the reaction slides can show, word for word, with its link. */
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
export const VERDICT_OUTCOMES = ["proceed", "stop", "ask"] as const;
export type VerdictOutcome = typeof VERDICT_OUTCOMES[number];
export const FABRICATION_SIGNS = ["no_original", "lone_quote", "shifting_numbers", "satire_account", "debunked", "other"] as const;
export const ResearchSchema = z.object({
  quick: z.boolean().describe("True for an exact copy's quick check: only the post, the origin and fabrication signs; the rest stays empty"),
  origin: z.object({
    found: z.boolean().describe("True when the first post or article is found, never a repost page"),
    url: z.string().nullable(),
    who: z.string().describe("Who first posted or published it"),
    date: z.string().nullable().describe("YYYY-MM-DD, or null"),
    note: z.string().describe("How it was found, or why it wasn't. A screenshot of an exchange stays unverified until its original is found"),
  }),
  surfaces: z.array(Link.extend({ independent: z.boolean().describe("True when it didn't just repeat the same repost") })).describe("Where else the story appears, with at least one independent source when there is one"),
  facts: z.array(ResearchFactSchema),
  worth: z.object({
    traction: z.object({
      post: TractionSchema,
      usual: TractionSchema.nullable().describe("The median of the source page's last 12 posts, or null when unknown"),
      ratio: z.number().nullable().describe("The post's likes plus comments (views for a reel) over the usual, or null"),
      performing: z.boolean().describe("True when the post beats its page's usual numbers, about 1.5 times the median"),
    }),
    fresh: z.object({
      firstSeen: z.string().nullable().describe("When the story first appeared, YYYY-MM-DD, or null"),
      ageDays: z.number().nullable(),
      stale: z.boolean(),
    }),
    saturation: z.object({ note: z.string().describe("How widely it is already covered"), saturated: z.boolean() }),
    covered: z.object({
      already: z.boolean().describe("True when our page already covered the story, judged by topic, not keywords"),
      by: z.array(Link).describe("Our own posts or decks that covered it"),
      note: z.string(),
    }),
  }),
  fabrication: z.array(z.object({ sign: z.enum(FABRICATION_SIGNS), detail: z.string(), sources: z.array(Link) })),
  positions: z.array(z.object({
    who: z.string(), role: z.string().describe("Who they are in the story"),
    said: z.string().describe("Their position, close to their own words"),
    url: z.string(),
  })).describe("From the people involved, and from credible voices"),
  reactions: z.array(ReactionSchema).describe("Real posts from X the reaction slides can show"),
  recommendation: z.object({ outcome: z.enum(VERDICT_OUTCOMES), reason: z.string() }),
});
export type Research = z.infer<typeof ResearchSchema>;

// ── 3. verdict: the gate between research and making the post ──
export const VerdictAnswerSchema = z.object({
  choice: z.enum(["proceed", "stop"]),
  by: z.enum(["engine", "agent", "human"]),
  at: z.string(),
  note: z.string().describe("Why, in their words: Build it anyway, or what they said"),
});
export type VerdictAnswer = z.infer<typeof VerdictAnswerSchema>;
export const VerdictSchema = z.object({
  outcome: z.enum(VERDICT_OUTCOMES).describe("proceed: make the post; stop: fabricated, untraceable, stale or saturated; ask: a person decides"),
  reason: z.string(),
  evidence: z.array(Link),
  /** A person's answer to an ask, or their Build it anyway on a stop. The run goes by it over the outcome. */
  answer: VerdictAnswerSchema.nullable(),
});
export type Verdict = z.infer<typeof VerdictSchema>;
/** What the run goes by: a person's answer, else the check's own outcome. */
export const verdictChoice = (verdict: Verdict): VerdictOutcome => verdict.answer?.choice ?? verdict.outcome;

// ── 4. brief: the story, the guardrails and the slide plan ──
export const OUTLINE_KINDS = ["cover", "original", "question", "reaction", "takeaway", "follow"] as const;
export const PlanSlideSchema = z.object({
  kind: z.enum(OUTLINE_KINDS),
  purpose: z.string().describe("What this slide tells the reader, in one line"),
  points: z.array(z.string()).describe("The facts and numbers it uses, each from the research"),
  original: z.number().int().nullable().describe("The original slide it rebuilds, 1-based, or null"),
  chart: z.string().describe("The chart it shows: what, and from which source; else empty"),
  reactionIds: z.array(z.string()).describe("Ids of the research's reactions it shows, one to three; else empty"),
  photo: z.string().describe("The photo it needs, or empty"),
});
export type PlanSlide = z.infer<typeof PlanSlideSchema>;
export const PlanSchema = z.object({ slides: z.array(PlanSlideSchema), why: z.string() });
export type Plan = z.infer<typeof PlanSchema>;
export const StoryBriefSchema = z.object({
  topic: z.string().describe("The story in one plain line"),
  angle: z.string().describe("Why it matters to our readers, in one sentence"),
  originalHeadline: z.string().describe("The original cover headline, word for word"),
  whatHappened: z.string(),
  backstory: z.string(),
  positions: z.array(z.string()).describe("Positions and reactions, each with who and their link"),
  guardrails: z.object({
    alleged: z.array(z.string()).describe("Claims that are only alleged, worded as allegations"),
    numbers: z.array(z.string()).describe("Numbers safe to print, each with its source"),
    names: z.array(z.string()).describe("Names as they are spelled"),
    warnings: z.array(z.string()).describe("What the check warned about, when a person chose to build it anyway"),
  }),
  template: TemplateNotesSchema.describe("The source's template notes, minus anything that failed the check"),
  links: z.array(Link).describe("The original source first"),
  slides: z.array(PlanSlideSchema).describe("The original's slides in its order, the reader's questions, the reactions, then Follow"),
  why: z.string().describe("Why the plan is shaped this way, in one line"),
});
export type StoryBrief = z.infer<typeof StoryBriefSchema>;

// ── 5. headline: the cover's options, in the order decision 1 sets ──
export const HEADLINE_SOURCES = ["original", "headline-model", "copywriter", "agent"] as const;
export const HeadlineCandidateSchema = z.object({
  text: z.string(),
  framework: z.string(),
  by: z.enum(HEADLINE_SOURCES).describe("original: the original's own headline (or its faithful translation)"),
  /** For Spanish pages: the headline model's English line this one adapts. */
  english: z.string().nullable(),
});
export type HeadlineCandidate = z.infer<typeof HeadlineCandidateSchema>;
export const HeadlinesSchema = z.object({
  options: z.array(HeadlineCandidateSchema),
  source: z.enum(["headline-model", "copywriter", "agent"]).describe("Who wrote the options after the original's"),
  lead: z.enum(["original", "model"]).describe("original: the original's headline leads because the post performs and its headline passed the check; model: the headline model's options lead"),
  performing: z.boolean().describe("The post beats its page's usual numbers"),
  /** The checked story and the list exactly as the headline model returned it, for saving a person's pick. */
  story: z.string(),
  modelOptions: z.array(z.object({ text: z.string(), framework: z.string().optional(), sources: z.array(z.string()).optional() })),
  note: z.string(),
});
export type Headlines = z.infer<typeof HeadlinesSchema>;

// ── approval: the checkpoint ──
export const PlanApprovalSchema = z.object({
  plan: PlanSchema,
  headline: z.object({ text: z.string(), option: z.number().int().describe("Index into the headline options, or -1 for one written by hand") }),
  notes: z.string(),
});
export type PlanApproval = z.infer<typeof PlanApprovalSchema>;

// ── 6. design: one designer builds every slide in HTML layers ──
export const DesignSchema = z.object({
  deckId: z.string(), name: z.string(), slideCount: z.number().int(), savedAt: z.string(),
  caption: z.string(),
  /** Each deck page, with the plan slide (or original slide, in an exact copy) it shows and the template page or layout it starts from. */
  pages: z.array(z.object({ pageId: z.string(), slide: z.number().int(), layout: z.string() })),
  notes: z.array(z.string()),
  /** Why a rebuilt version wasn't saved (a person edited the deck), or "". */
  held: z.string(),
});
export type DesignOutput = z.infer<typeof DesignSchema>;

// ── 7. review: code checks and the critics; fixes go to the designer ──
export const CheckIssueSchema = z.object({
  slide: z.number().int().describe("1-based slide number, or 0 for the whole post"),
  problem: z.string(),
  fix: z.string().describe("The exact change to make"),
  severity: z.enum(["must_fix", "should_fix", "note"]),
  route: z.enum(["design", "none"]).describe("design: the designer fixes it; none: nobody can (text the template fixes, a fact to check by hand)"),
});
export type CheckIssue = z.infer<typeof CheckIssueSchema>;
export const CriticReportSchema = z.object({ verdict: z.enum(["ship", "fix"]), summary: z.string(), issues: z.array(CheckIssueSchema) });
export type CriticReport = z.infer<typeof CriticReportSchema>;
export const ReviewReportSchema = z.object({
  round: z.number().int(),
  rendered: z.boolean(),
  checks: z.array(CheckIssueSchema),
  facts: CriticReportSchema.nullable(),
  design: CriticReportSchema.nullable().describe("The design critic, or in an exact copy the fidelity critic"),
  /** Who the must-fix issues went back to for another round. */
  sentBack: z.array(z.enum(["design"])),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

/**
 * Stages an outside agent may hand in itself. The verdict is answered (a
 * person's call), never handed in, and Engine's designer builds the deck.
 */
export const HANDED_IN: Partial<Record<PostStage, z.ZodType>> = {
  source: SourceNotesSchema, research: ResearchSchema, brief: StoryBriefSchema, headline: HeadlinesSchema, approval: PlanApprovalSchema, review: ReviewReportSchema,
};

// ── The first team's schemas: its modules and version-1 files, until the cleanup ──

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

export const ReactionsSchema = z.object({ reactions: z.array(ReactionSchema), note: z.string() });
export type ReactionsOutput = z.infer<typeof ReactionsSchema>;

export const VisualsSchema = z.object({
  candidates: z.array(z.object({ id: z.string(), url: z.string(), description: z.string(), sourceUrl: z.string(), credit: z.string() })),
  note: z.string(),
});
export type VisualsOutput = z.infer<typeof VisualsSchema>;

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

/** Stages an outside agent could hand in to the first team. Charts and the deck were built by Engine from the others. */
export const SUBMITTABLE: Partial<Record<LegacyStage, z.ZodType>> = {
  transcript: HandedInTranscriptSchema,
  brief: BriefSchema, facts: FactsSchema, data: HandedInDataSchema, reactions: ReactionsSchema, visuals: VisualsSchema,
  outline: OutlineSchema, hooks: HooksSchema, approval: ApprovalSchema, copy: CopySchema, images: ImagesSchema, review: ReviewSchema,
};
/** An exact copy's data stage hands in its own shape. */
export const submittableFor = (stage: LegacyStage, mode: PostMode): z.ZodType | undefined =>
  mode === "exact" && stage === "data" ? HandedInExactDataSchema : SUBMITTABLE[stage];
