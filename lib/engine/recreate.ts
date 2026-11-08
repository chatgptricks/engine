/**
 * Recreate post: an Instagram post (link or screenshots) becomes an editable
 * Engine carousel in one of our pages' templates and languages.
 *
 *   import → research (Claude + web search, fact-check) → write (Claude,
 *   structured output against the template's slots) → build (agent deck
 *   composer, charts rendered into photo slots, notes as deck comments).
 *
 * The same function backs the in-app dialog and the agent HTTP/MCP API.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { agentTemplateSlots, createAgentDeck, type AgentTemplateSlot } from "../template-editor/agent-decks";
import { checkLibrarySaveBudget } from "../template-editor/library-budget";
import { formatDimensions, parseLibrary, type CanvasElement, type DesignComment, type DesignDocument, type DesignTemplate } from "../template-editor/model";
import { getEditorLibrary, LibraryConflictError, saveEditorLibrary } from "../template-editor/persistence";
import { libraryTemplates } from "../template-editor/template-catalog";
import { chartAltText, chartPngDataUrl, validateChart } from "./recreate-chart";
import { ChartDataError, describeSeries, fetchFredSeries, fetchSp500History, resolveChartData, SP500_HISTORY_ID, type ChartData, type FredChartSpec, type FredFrequency, type FredSeries } from "./recreate-data";
import { downloadSlideImages, importInstagramPost, InstagramImportError, normalizeUploadedSlides } from "./instagram-import";
import { getPageProfile, PageProfileError, type PageProfile } from "./page-profiles";

const MODEL = process.env.ANTHROPIC_RECREATE_MODEL?.trim() || "claude-opus-5-5";
// Server-side refusal fallback, routed by refusal category.
const BETAS = ["server-side-fallback-2026-07-01"];
const ACCENT = "#00D98A";
const MAX_SLIDES = 20;

export type RecreateStage = "queued" | "importing" | "researching" | "writing" | "building" | "done" | "error";
export type RecreateInput = { url?: string; uploads?: { name: string; dataUrl: string }[]; caption?: string; profileId: string; notes?: string };
export type FactCheck = { claim: string; verdict: "confirmed" | "corrected" | "unverified"; detail: string; sources: { title: string; url: string }[] };
export type RecreateResult = { deckId: string; editorUrl: string; name: string; slideCount: number; factChecks: FactCheck[]; notes: string[] };
type Report = (stage: RecreateStage, message: string) => void;
type SourceImage = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

export function isRecreateConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}
export class RecreateError extends Error { constructor(message: string, public status = 400) { super(message); } }

// ── Structured output the writer returns ────────────────────────────────────
const ChartSchema = z.object({
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
type WrittenChart = z.infer<typeof ChartSchema>;

/** The writer's chart → the data layer's spec. Tolerates older or partial charts (missing source, markers, band). */
export function chartSpecFrom(chart: WrittenChart): FredChartSpec {
  const sourceOf = (item: WrittenChart["series"][number]) => item.source ?? (item.fred ? "fred" : "typed");
  const downloaded = chart.series.some(item => sourceOf(item) !== "typed");
  return {
    unit: chart.unit, labels: chart.labels ?? [], from: chart.from ?? null, markerDate: chart.markerDate ?? null, indexToMarker: Boolean(chart.indexToMarker),
    markerIndex: chart.markerIndex, markerLabel: chart.markerLabel ?? "", markerIcon: chart.markerIcon ?? "none", endLabel: chart.endLabel ?? "value",
    series: chart.series.map(item => {
      const source = sourceOf(item);
      return {
        name: item.name, values: item.values ?? [], emphasis: item.emphasis,
        fred: source === "fred" ? item.fred : null,
        source: source === "sp500_history" ? { kind: "sp500_history" as const, id: SP500_HISTORY_ID } : source === "fred" && item.fred ? { kind: "fred" as const, id: item.fred } : null,
      };
    }),
    markers: (chart.markers ?? []).map(marker => downloaded ? { date: marker.date, label: marker.label, icon: marker.icon } : { index: marker.index, label: marker.label, icon: marker.icon }),
    band: chart.band ? downloaded
      ? { from: chart.band.fromDate ?? "", to: chart.band.toDate ?? "", label: chart.band.label }
      : { from: chart.band.fromIndex, to: chart.band.toIndex, label: chart.band.label } : null,
  };
}
const CarouselSchema = z.object({
  name: z.string(),
  caption: z.string(),
  slides: z.array(z.object({
    templatePage: z.number().int(),
    purpose: z.string(),
    texts: z.array(z.object({ slot: z.string(), text: z.string() })),
    media: z.object({ kind: z.enum(["none", "chart", "photo"]), photoBrief: z.string(), chart: ChartSchema.nullable() }),
  })),
  factChecks: z.array(z.object({
    claim: z.string(),
    verdict: z.enum(["confirmed", "corrected", "unverified"]),
    detail: z.string(),
    sources: z.array(z.object({ title: z.string(), url: z.string() })),
  })),
  notes: z.array(z.string()),
});
export type WrittenCarousel = z.infer<typeof CarouselSchema>;

// ── Inputs ──────────────────────────────────────────────────────────────────
// Claude reads images up to 5 MB and gains nothing past ~1568 px on the long
// edge, so big screenshots are shrunk to JPEG before they're sent.
const CLAUDE_LONG_EDGE = 1568, CLAUDE_MAX_BASE64 = 4_800_000;
async function fitForClaude(image: SourceImage): Promise<SourceImage> {
  const sharp = (await import("sharp")).default;
  const bytes = Buffer.from(image.base64, "base64");
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (!meta) throw new RecreateError("One of the slides isn't a readable image.");
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longEdge <= CLAUDE_LONG_EDGE && image.base64.length <= CLAUDE_MAX_BASE64) return image;
  const out = await sharp(bytes).rotate().resize({ width: CLAUDE_LONG_EDGE, height: CLAUDE_LONG_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
  return { mediaType: "image/jpeg", base64: out.toString("base64") };
}
function importFailure(error: unknown): never {
  if (error instanceof InstagramImportError) throw new RecreateError(error.message, error.status);
  throw error;
}
async function loadSource(input: RecreateInput, signal?: AbortSignal): Promise<{ images: SourceImage[]; caption: string; sourceUrl?: string; owner?: string }> {
  if (input.uploads?.length) {
    // Byte-level type check: the declared data-URL type is never trusted.
    const { images } = await normalizeUploadedSlides(input.uploads.map(upload => ({ data: upload.dataUrl, name: upload.name })), { caption: input.caption }).catch(importFailure);
    return { images: await Promise.all(images.map(image => fitForClaude(image))), caption: input.caption?.trim() ?? "", sourceUrl: input.url?.trim() || undefined };
  }
  if (!input.url?.trim()) throw new RecreateError("Paste an Instagram post link or upload the post's slides.");
  const post = await importInstagramPost(input.url.trim(), { signal }).catch(importFailure);
  const images = await downloadSlideImages(post.slides, { signal }).catch(importFailure);
  if (!images.length) throw new RecreateError("That post has no images Engine can read. Upload screenshots of its slides instead.");
  return {
    images: await Promise.all(images.map(image => fitForClaude({ mediaType: image.mediaType, base64: image.base64 }))),
    caption: [input.caption?.trim(), post.caption?.trim()].filter(Boolean).join("\n\n"),
    sourceUrl: post.url, owner: post.ownerUsername,
  };
}

// ── Template catalog for the writer ─────────────────────────────────────────
type PageCatalog = { index: number; label: string; text: AgentTemplateSlot[]; photo: AgentTemplateSlot[] };
function catalogFor(template: DesignTemplate): PageCatalog[] {
  const slots = agentTemplateSlots(template);
  return template.pages.map((page, index) => ({
    index, label: page.label ?? `Page ${index + 1}`,
    text: slots.filter(slot => slot.pageIndex === index && slot.type === "text"),
    photo: slots.filter(slot => slot.pageIndex === index && slot.type === "photo"),
  }));
}
function describeCatalog(pages: PageCatalog[]): string {
  return pages.map(page => {
    const text = page.text.map(slot => `    - text "${slot.slot}"${slot.role ? ` (${slot.role})` : ""}${slot.maxCharacters ? `, at most ~${slot.maxCharacters} characters` : ""}${slot.sample ? `, sample: ${JSON.stringify(slot.sample.slice(0, 120))}` : ""}`);
    const photo = page.photo.map(slot => `    - photo "${slot.slot}"`);
    return [`  Page ${page.index} · ${page.label}`, ...(text.length || photo.length ? [...text, ...photo] : ["    (no editable slots)"])].join("\n");
  }).join("\n");
}

// ── Claude ──────────────────────────────────────────────────────────────────
function client() {
  if (!isRecreateConfigured()) throw new RecreateError("Recreate is not configured: add ANTHROPIC_API_KEY to the server environment.", 503);
  return new Anthropic();
}
const languageName = (profile: PageProfile) => profile.language === "es" ? "Spanish" : "English";

async function research(profile: PageProfile, source: Awaited<ReturnType<typeof loadSource>>, notes: string, data: ChartData, signal?: AbortSignal): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const system = `You are the research desk for ${profile.name} (${profile.handle}), an Instagram page. ${profile.voice}
A teammate wants to recreate a post another creator published, rebuilt for our page in our own words, with every fact checked. Today is ${today}.

Work in this order:
1. Read every slide image and the caption. Note exactly what each slide claims and shows.
2. Verify every factual claim (numbers, dates, names, quotes) with web_search and web_fetch. Prefer primary sources: official statistics, company announcements, papers, filings. Treat aggregators and other creators' posts as leads, not sources.
3. If the original has a chart, write down exactly what it shows: each series, how it's scaled (absolute values, indexed to an event, percent change), its start and end dates, every marked event with its label, and any shaded period. We recreate that chart with real data: same series, same scaling, same start date, same markers. Get the real series: for official economic and market series (jobs, unemployment, wages, prices, rates, GDP, housing, the S&P 500's last 10 years) use fred_series; look up the series id first if you don't know it. For the S&P 500 before 2016 use sp500_history (FRED only has its last 10 years). Otherwise collect the actual data points (date and value) from one primary source, with its URL. Never estimate or invent data points; if you cannot get real series data, say so.
4. Recreate, don't reinvent: keep the original's story, slide order and chart. Fix only what's wrong or out of date. Then list the first 2–4 questions a reader would ask after this post, with short sourced answers. Note anything misleading in the original under RISKS.

Finish with research notes in plain text under these headings:
SOURCE POST (slide by slide)
CLAIMS (each: the claim, verdict CONFIRMED / CORRECTED / UNVERIFIED, the correct figure, source title and URL)
DATA FOR CHARTS (each chart: what the original shows (series, scaling, start and end, markers and their labels, shaded periods) and how we rebuild it; for a FRED series give its id, for the long S&P 500 say sp500_history, with the start date and the events to mark, not the values; for other series give name, unit, dates and values and the source URL; or "none")
RECOMMENDED STORY (the original's slides in order with what we keep and fix, then the reader's first questions with short answers)
RISKS`;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...source.images.map((image, index): Anthropic.Beta.BetaContentBlockParam[] => [
      { type: "text", text: `Slide ${index + 1}:` },
      { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
    ]).flat(),
    { type: "text", text: [
      source.owner ? `Original creator: @${source.owner}` : "",
      source.sourceUrl ? `Original post: ${source.sourceUrl}` : "",
      `Original caption:\n${source.caption || "(none provided)"}`,
      notes ? `Teammate's notes: ${notes}` : "",
    ].filter(Boolean).join("\n\n") },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: 12 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 },
    {
      name: "sp500_history",
      description: "Download the S&P 500's monthly history since 1871 (average of daily closes; Robert Shiller's data). Use it for any S&P 500 chart that starts before 2016, since FRED's SP500 only covers the last 10 years. Returns the range, high and low, and sampled points. Engine keeps the full series, so a chart can use it by setting a series' source to sp500_history.",
      input_schema: {
        type: "object",
        properties: { start: { type: "string", description: "First date to describe, YYYY-MM-DD. Omit for the full history." } },
        additionalProperties: false,
      },
    },
    {
      name: "fred_series",
      description: "Download a full official time series from FRED (Federal Reserve Bank of St. Louis): US job openings, unemployment, payrolls, wages, CPI, interest rates, GDP, housing, the S&P 500 (last 10 years only) and thousands more. Returns the series' range, high and low, and its points (sampled when long). Engine keeps the full series, so a chart can use it by id. Use it for any chart of an official series instead of copying numbers from articles.",
      input_schema: {
        type: "object",
        properties: {
          series_id: { type: "string", description: "FRED series id, for example JTSJOL (job openings), UNRATE, PAYEMS, CPIAUCSL, FEDFUNDS, SP500." },
          start: { type: "string", description: "First date to include, YYYY-MM-DD. Omit for the full history." },
          frequency: { type: "string", enum: ["monthly", "quarterly", "annual", "native"], description: "Averaged to this frequency. Default monthly." },
        },
        required: ["series_id"],
        additionalProperties: false,
      },
    },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
  const anthropic = client();
  for (let turn = 0; turn < 16; turn++) {
    const response = await anthropic.beta.messages.stream({
      model: MODEL, max_tokens: 64000, betas: BETAS, fallbacks: "default",
      thinking: { type: "adaptive" }, output_config: { effort: "high" },
      system, tools, messages,
    }, { signal }).finalMessage();
    if (response.stop_reason === "refusal") throw new RecreateError("Claude declined to research this post.", 422);
    if (response.stop_reason === "max_tokens") throw new RecreateError("Research ran too long. Try again with a simpler post.", 502);
    if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); continue; }
    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results = await Promise.all(response.content.flatMap(block => block.type === "tool_use" ? [block] : []).map(async (block): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          const input = (block.input ?? {}) as Record<string, unknown>;
          if (input.start !== undefined && (typeof input.start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.start))) throw new ChartDataError("start must be a date like 2000-01-01.");
          const start = input.start as string | undefined;
          // Engine keeps the full history so a chart can start earlier than research looked.
          const windowed = (series: FredSeries) => start ? { ...series, observations: series.observations.filter(row => row.date >= start) } : series;
          if (block.name === "sp500_history") {
            const series = await fetchSp500History({ signal });
            data.set(`${SP500_HISTORY_ID}:monthly`, series);
            return { type: "tool_result", tool_use_id: block.id, content: describeSeries(windowed(series)) };
          }
          if (block.name !== "fred_series") throw new ChartDataError(`Unknown tool ${block.name}.`);
          const frequency = (["monthly", "quarterly", "annual", "native"] as const).find(value => value === input.frequency) ?? "monthly";
          const series = await fetchFredSeries(input.series_id, { frequency: frequency as FredFrequency, signal });
          data.set(`${series.id}:${series.frequency}`, series);
          const view = windowed(series);
          if (view.observations.filter(row => Number.isFinite(row.value)).length < 2) throw new ChartDataError(`FRED series ${series.id} has no data from ${start}.`);
          return { type: "tool_result", tool_use_id: block.id, content: describeSeries(view) };
        } catch (error) {
          if (signal?.aborted) throw error;
          return { type: "tool_result", tool_use_id: block.id, is_error: true, content: error instanceof ChartDataError ? error.message : "The download failed." };
        }
      }));
      messages.push({ role: "user", content: results });
      continue;
    }
    const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n").trim();
    if (!text) throw new RecreateError("Research finished without notes. Try again.", 502);
    return text;
  }
  throw new RecreateError("Research took too many steps. Try again with a simpler post.", 504);
}

async function write(profile: PageProfile, template: DesignTemplate, pages: PageCatalog[], notes: string, researchNotes: string, caption: string, signal?: AbortSignal): Promise<WrittenCarousel> {
  const language = languageName(profile);
  const format = profile.format ?? { noFinalPeriods: true, bodyMaxLines: 2 };
  const followPage = pages.find(page => /follow/i.test(page.label));
  const system = `You write Instagram carousels for ${profile.name} (${profile.handle}). ${profile.voice}
Write every word on the slides and in the caption in ${language}.${profile.language === "es" ? " Adapt, don't translate word for word: natural Spanish, swap US-only examples for ones Spanish-speaking audiences know when the facts allow, and keep proper accents (á é í ó ú ñ ¿ ¡)." : ""}

House rules, all required:
${profile.rules.map(rule => `- ${rule}`).join("\n")}
${format.noFinalPeriods ? "- No text box ends with a period.\n" : ""}- Body text under a title is at most ${format.bodyMaxLines} lines. Stay within each slot's character guide; shorter reads better.
- Write fresh copy in our voice. Never copy the original creator's wording.
- Every number comes from the research notes (CLAIMS or DATA FOR CHARTS). Use corrected figures, never the original's wrong ones. When a page has a source slot, name the source there.
- Cover headline: all caps. Wrap its key phrase in [[double brackets]] so it is set in the accent color. Use [[ ]] nowhere else.${followPage ? `
- Follow page (page ${followPage.index}): its first line "${profile.followCta.line1}" is fixed. Write only the call-to-action slot: a short line tied to this post's topic, at most ${profile.followCta.maxChars} characters, plain words, no fear-bait.` : ""}

TEMPLATE "${template.name}". Build the carousel from these page types. Reuse a page type as often as the story needs (1–${MAX_SLIDES} slides). Start with the cover page and end with the follow page when the template has them.
${describeCatalog(pages)}

For each slide:
- templatePage: the page index above.
- texts: one entry per text slot on that page, using the exact slot names listed. Fill every text slot; use "" only for a source slot when there is no source.
- Line breaks: only between two complete sentences or phrases, as in "Stocks rose 96%\nJob openings fell 29%". Never split one sentence across lines; the template wraps long lines itself.
- A chart's source line names the source and the date range the chart actually shows.
- List slots (names ending in "-items"): 3–5 short items, one per line, separated by line breaks. No bullet characters or numbering; the template draws the bullets.
- media.kind "chart" only when DATA FOR CHARTS has a real series for this slide, with at least 12 points. A handful of points makes a misleading chart: put that number in the text instead.
  - When the original post has a chart, ours recreates it with the real data: the same series, the same scaling, the same start date, and the same marked events and labels (DATA FOR CHARTS describes it). Don't shorten its time span.
  - Downloaded series: source "fred" with fred set to the FRED id, or source "sp500_history" (fred null) for the S&P 500 before 2016. Leave values and labels empty; Engine fills the real data. from: the first date to show (YYYY-MM-DD). markerDate: the main event (YYYY-MM-DD) or null. markers: up to 2 more events as {date, label, icon "none", index -1}. band: a shaded period as {fromDate, toDate, fromIndex -1, toIndex -1, label}, or null. One chart may combine fred and sp500_history series, but not typed values.
  - Typed series (other sources): source "typed", fred null; copy the values exactly (you may downsample evenly to at most 300 points); labels has one x-axis label per point ("" for unlabeled points); markerIndex marks the main event (or -1); markers use index (date null); band uses fromIndex and toIndex (dates null); from and markerDate null.
  - Series in different units (for example job openings and a stock index): set indexToMarker true so every series is 100 at the marker and they share one honest scale; otherwise false.
  - unit: a short suffix such as %, $, K, M or pts, or "" (or "index" when indexToMarker). Use endLabel "change_since_marker" to show each series' change since the marker. markerIcon "openai" only when the event is an OpenAI/ChatGPT release. Series names: short, 2–3 words.
- media.kind "photo" for a photo slot that needs a real image: describe the exact photo or screenshot in photoBrief (what to show and where to get it).
- media.kind "none" when the page has no photo slot. Set chart to null unless kind is "chart".
caption: our voice and language. A hook line, 2–4 short lines of context, a source line, then up to 5 relevant hashtags.
factChecks: every claim from the original you checked, with verdict and sources.
notes: anything the editor should know (weak sources, photos to find, judgment calls).`;
  const user = [
    `RESEARCH NOTES\n${researchNotes}`,
    `ORIGINAL CAPTION\n${caption || "(none)"}`,
    notes ? `TEAMMATE'S NOTES\n${notes}` : "",
  ].filter(Boolean).join("\n\n");
  const response = await client().beta.messages.stream({
    model: MODEL, max_tokens: 32000, betas: BETAS, fallbacks: "default",
    thinking: { type: "adaptive" }, output_config: { effort: "high", format: betaZodOutputFormat(CarouselSchema) },
    system, messages: [{ role: "user", content: user }],
  }, { signal }).finalMessage();
  if (response.stop_reason === "refusal") throw new RecreateError("Claude declined to write this post.", 422);
  if (response.stop_reason === "max_tokens") throw new RecreateError("The carousel was too long to write in one pass. Try again.", 502);
  if (!response.parsed_output) throw new RecreateError("Claude returned a carousel Engine could not read. Try again.", 502);
  return response.parsed_output;
}

// ── Build the editable deck ─────────────────────────────────────────────────
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** House formatting applied in code, so it holds even when the model slips. */
export function cleanSlideText(text: string, noFinalPeriods: boolean): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(line => line.trim());
  const cleaned = noFinalPeriods ? lines.map(line => line.replace(/(?<!\.)\.(\]\])?$/, "$1")) : lines;
  return cleaned.join("\n").trim();
}
/** "[[key phrase]]" → plain text plus Engine rich text with the phrase in the accent color. */
export function emphasis(text: string, accent = ACCENT): { text: string; richText?: string } {
  if (!/\[\[[^\]]+\]\]/.test(text)) return { text: text.replace(/\[\[|\]\]/g, "") };
  const plain = text.replace(/\[\[([^\]]+)\]\]/g, "$1");
  const html = text.split(/(\[\[[^\]]+\]\])/g).map(part => {
    const match = /^\[\[([^\]]+)\]\]$/.exec(part);
    return match ? `<span style="color: ${accent}">${escapeHtml(match[1])}</span>` : escapeHtml(part);
  }).join("").replace(/\n/g, "<br>");
  return { text: plain, richText: html };
}
function findSlotElement(document: DesignDocument, pageIndex: number, slot: string): CanvasElement | undefined {
  return document.pages[pageIndex]?.canvas?.elements.find(element => element.slot === slot || element.id === slot);
}
function editorUrl(id: string) {
  const frontend = process.env.ENGINE_FRONTEND_URL;
  return `${frontend ? frontend.replace(/\/$/, "") + "/" : "/admin/engine"}?design=${encodeURIComponent(id)}`;
}

export async function buildRecreatedDeck(profile: PageProfile, template: DesignTemplate, templates: DesignTemplate[], carousel: WrittenCarousel, data: ChartData = new Map(), signal?: AbortSignal): Promise<{ document: DesignDocument; notes: string[] }> {
  const pages = catalogFor(template);
  const noFinalPeriods = profile.format?.noFinalPeriods ?? true;
  const notes = [...carousel.notes];
  const slides = carousel.slides.filter(slide => {
    const ok = Number.isInteger(slide.templatePage) && slide.templatePage >= 0 && slide.templatePage < pages.length;
    if (!ok) notes.push(`Skipped a slide that used page ${slide.templatePage}, which this template doesn't have.`);
    return ok;
  }).slice(0, MAX_SLIDES);
  if (!slides.length) throw new RecreateError("Claude didn't produce any slides for this template. Try again.", 502);
  const prepared = slides.map(slide => {
    const page = pages[slide.templatePage], names = new Set(page.text.map(slot => slot.slot));
    const texts = slide.texts.filter(entry => {
      if (names.has(entry.slot)) return true;
      notes.push(`Ignored text for unknown slot "${entry.slot}" on a ${page.label} slide.`);
      return false;
    }).map(entry => ({ slot: entry.slot, ...emphasis(cleanSlideText(entry.text, noFinalPeriods)) }));
    for (const slot of page.text) if (!texts.some(entry => entry.slot === slot.slot)) texts.push({ slot: slot.slot, text: "" });
    return { slide, page, texts };
  });
  const id = `recreate-${randomUUID()}`;
  const document = createAgentDeck({
    id, name: carousel.name.trim().slice(0, 200) || "Recreated post", templateId: template.id,
    caption: cleanSlideText(carousel.caption, false).slice(0, 20_000),
    slides: prepared.map(({ slide, texts }) => ({ templatePage: slide.templatePage, slots: Object.fromEntries(texts.map(entry => [entry.slot, entry.text])) })),
  }, templates);
  const { width: outputWidth } = formatDimensions(document), pixels = outputWidth / 360;
  const comments: DesignComment[] = [];
  const now = new Date().toISOString();
  for (const [index, { slide, page, texts }] of prepared.entries()) {
    const pageId = document.pages[index].id;
    for (const entry of texts) {
      if (!entry.richText) continue;
      const element = findSlotElement(document, index, entry.slot);
      if (element?.type === "text") element.richText = entry.richText;
    }
    const photo = page.photo[0];
    if (slide.media.kind === "chart" && slide.media.chart && photo) {
      const element = findSlotElement(document, index, photo.slot);
      try {
        const spec = chartSpecFrom(slide.media.chart);
        const chart = validateChart(await resolveChartData(spec, data, { signal }));
        if (!element) throw new Error("photo slot not found");
        const background = document.pages[index].canvas?.background;
        const src = await chartPngDataUrl(chart, element.width * pixels, element.height * pixels, background && background.startsWith("#") ? { background } : {});
        const fred = spec.series.flatMap(series => series.source?.kind === "fred" ? [series.source.id.toUpperCase()] : []);
        const sources = [...(fred.length ? [`FRED ${fred.join(", ")}`] : []), ...(spec.series.some(series => series.source?.kind === "sp500_history") ? ["S&P 500 history, Shiller data"] : [])];
        const alt = chartAltText(chart, sources);
        if (element.type === "image") { element.src = src; element.fit = "contain"; element.publicAlt = alt; }
        else if (element.type === "shape") element.imageFill = { ...(element.imageFill ?? { objectFit: "contain", cropX: 50, cropY: 50 }), src, objectFit: "contain" };
      } catch (error) {
        notes.push(`Slide ${index + 1}: the chart couldn't be drawn (${error instanceof Error ? error.message : "invalid data"}); add it by hand.`);
      }
    } else if (slide.media.kind === "photo" && slide.media.photoBrief.trim()) {
      comments.push({ id: randomUUID(), pageId, text: `Photo to add: ${slide.media.photoBrief.trim()}`.slice(0, 2000), createdAt: now });
    }
  }
  if (carousel.factChecks.length) {
    const lines = carousel.factChecks.map(check => `${check.verdict.toUpperCase()}: ${check.claim}. ${check.detail}${check.sources[0] ? ` (${check.sources[0].title}: ${check.sources[0].url})` : ""}`);
    comments.push({ id: randomUUID(), pageId: document.pages[0].id, text: `Fact check\n${lines.join("\n")}`.slice(0, 2000), createdAt: now });
  }
  if (notes.length) comments.push({ id: randomUUID(), pageId: document.pages[0].id, text: `Notes from Recreate\n${notes.map(note => `• ${note}`).join("\n")}`.slice(0, 2000), createdAt: now });
  document.comments = [...(document.comments ?? []), ...comments];
  document.tags = [...new Set([...(document.tags ?? []), "recreated", profile.id])].slice(0, 20);
  return { document, notes };
}

async function saveDeck(ownerKey: string, document: DesignDocument): Promise<DesignDocument> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const stored = await getEditorLibrary(ownerKey);
    const next = parseLibrary({ ...stored.library, designs: [document, ...stored.library.designs] });
    if (!next) throw new RecreateError("The new post doesn't fit Engine's workspace limits (for example the 150-design limit). Empty Trash or delete old drafts, then retry.", 413);
    const budget = checkLibrarySaveBudget(next);
    if (!budget.ok) throw new RecreateError(budget.error, 413);
    try {
      const saved = await saveEditorLibrary(ownerKey, next, stored.revision, randomUUID());
      const result = saved.library.designs.find(item => item.id === document.id);
      if (!result) throw new RecreateError("Engine saved the workspace but couldn't find the new post. Reload the library.", 500);
      return result;
    } catch (error) {
      if (!(error instanceof LibraryConflictError) || attempt === 3) throw error;
    }
  }
  throw new RecreateError("The workspace is busy. Retry in a moment.", 409);
}

export async function runRecreate(ownerKey: string, input: RecreateInput, report: Report, signal?: AbortSignal): Promise<RecreateResult> {
  const profile = await getPageProfile(ownerKey, input.profileId).catch(error => {
    if (error instanceof PageProfileError) throw new RecreateError(error.message, error.status);
    throw error;
  });
  if (!profile) throw new RecreateError("That page profile doesn't exist.", 404);
  const { library } = await getEditorLibrary(ownerKey);
  const templates = libraryTemplates(library);
  const template = templates.find(candidate => candidate.id === profile.templateId);
  if (!template) throw new RecreateError(`${profile.name} has no template yet. Pick one in its page profile.`, 409);
  client();
  report("importing", input.uploads?.length ? "Reading your screenshots" : "Importing the post from Instagram");
  const source = await loadSource(input, signal);
  report("researching", `Researching and fact-checking ${source.images.length} slide${source.images.length === 1 ? "" : "s"}`);
  const notes = input.notes?.trim().slice(0, 2000) ?? "";
  const data: ChartData = new Map();
  const researchNotes = await research(profile, source, notes, data, signal);
  report("writing", `Writing slides for ${profile.name} in ${languageName(profile)}`);
  const carousel = await write(profile, template, catalogFor(template), notes, researchNotes, source.caption, signal);
  report("building", "Building the editable post");
  const { document, notes: buildNotes } = await buildRecreatedDeck(profile, template, templates, carousel, data, signal);
  const saved = await saveDeck(ownerKey, document);
  return { deckId: saved.id, editorUrl: editorUrl(saved.id), name: saved.name, slideCount: saved.pages.length, factChecks: carousel.factChecks, notes: buildNotes };
}
