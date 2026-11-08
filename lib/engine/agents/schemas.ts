/**
 * What each Recreate stage hands in. Engine's own agents answer in these
 * shapes, and an outside agent that does a stage itself (submit_stage) is
 * checked against the same schema.
 */
import { z } from "zod";
import type { PostStage } from "../post-files";

const Link = z.object({ title: z.string(), url: z.string() });

/** A chart as a writer describes it; Engine downloads the real series. */
export const ChartSchema = z.object({
  unit: z.string(),
  labels: z.array(z.string()),
  series: z.array(z.object({ name: z.string(), source: z.enum(["typed", "fred", "sp500_history"]), fred: z.string().nullable(), values: z.array(z.number()), emphasis: z.boolean() })),
  from: z.string().nullable(),
  markerDate: z.string().nullable(),
  indexToMarker: z.boolean(),
  markerIndex: z.number().int(),
  markerLabel: z.string(),
  markerIcon: z.enum(["none", "openai"]),
  endLabel: z.enum(["value", "change_since_marker", "none"]),
  markers: z.array(z.object({ date: z.string().nullable(), index: z.number().int(), label: z.string(), icon: z.enum(["none", "openai"]) })),
  band: z.object({ fromDate: z.string().nullable(), toDate: z.string().nullable(), fromIndex: z.number().int(), toIndex: z.number().int(), label: z.string() }).nullable(),
});
export type WrittenChart = z.infer<typeof ChartSchema>;

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

export const DataSchema = z.object({
  charts: z.array(z.object({
    id: z.string().describe("Short id, such as main"),
    purpose: z.string(),
    recreates: z.string().describe("Which chart of the original this rebuilds, or new"),
    chart: ChartSchema,
    source: z.string().describe("The slide's source line: the source and the date range shown"),
  })),
  notes: z.array(z.string()),
});
export type DataOutput = z.infer<typeof DataSchema>;

export const ReactionSchema = z.object({
  id: z.string(), url: z.string(),
  author: z.object({
    name: z.string(), handle: z.string(), avatarUrl: z.string().nullable(), verified: z.boolean(),
    badge: z.enum(["blue", "gold", "grey"]).nullable().optional().describe("X's check mark: blue (paid), gold (organization), grey (government), or null"),
    square: z.boolean().optional().describe("True for organizations, whose profile photos are rounded squares"),
  }),
  text: z.string(),
  media: z.object({ url: z.string(), width: z.number(), height: z.number() }).nullable().optional().describe("The post's first photo (pbs.twimg.com/media) and its size"),
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

/** Stages an outside agent may hand in itself. Charts and the deck are built by Engine from the others. */
export const SUBMITTABLE: Partial<Record<PostStage, z.ZodType>> = {
  brief: BriefSchema, facts: FactsSchema, data: DataSchema, reactions: ReactionsSchema, visuals: VisualsSchema,
  outline: OutlineSchema, hooks: HooksSchema, approval: ApprovalSchema, copy: CopySchema, images: ImagesSchema, review: ReviewSchema,
};
