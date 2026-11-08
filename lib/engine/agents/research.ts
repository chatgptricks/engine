/**
 * The research desk. The editor-in-chief reads the original and writes the
 * brief; then four researchers work in parallel: facts (web search), chart
 * data (FRED and the long S&P 500), real reactions from X, and real photos.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { searchXImages } from "../apify";
import { curateImages } from "../image-curator";
import { publicHttpUrl } from "../public-url";
import { imagesFromPage } from "../research-engine";
import type { StoryImage } from "../types";
import { fetchXReactions, X_PAID_PLAN, XReactionsError, xSearchNeedsPaidPlan, type XReaction } from "../x-reactions";
import { ask, imageBlock, ToolError, work, type ClientTool, type SourceImage } from "./claude";
import { CHART_FIELDS, dataTools, resolveChart } from "./charts";
import { need, outputOf, rerunNote, today, type StageContext, type StageRunner } from "./context";
import { rolePrompt } from "./playbook";
import { BriefSchema, DataSchema, FactsSchema, type Brief, type Facts, type ReactionsOutput, type VisualsOutput } from "./schemas";
import { importSource, keepSourceImages, loadSourceImages } from "./source";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The original's slides for this run: from memory, else from the workspace. */
export async function originalSlides(context: StageContext): Promise<SourceImage[]> {
  if (context.cache.images) return context.cache.images;
  if (!context.file.source.imageIds.length) return [];
  return context.cache.images = await loadSourceImages(context.ownerKey, context.file.source.imageIds);
}

export const brief: StageRunner = async context => {
  const { file, profile } = context;
  let images = await originalSlides(context), source: StageContext["file"]["source"] | undefined;
  if (!images.length) {
    const imported = await importSource({ url: file.source.url, uploads: context.cache.uploads, caption: file.source.caption }, context.signal);
    const imageIds = await keepSourceImages(context.ownerKey, imported.images);
    images = context.cache.images = imported.images;
    source = { ...file.source, url: imported.sourceUrl ?? file.source.url, caption: imported.caption, owner: imported.owner, slideCount: images.length, imageIds };
  }
  const { caption, owner, url, notes } = source ?? file.source;
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.flatMap((image, index): Anthropic.Beta.BetaContentBlockParam[] => [{ type: "text", text: `Slide ${index + 1}:` }, imageBlock(image)]),
    { type: "text", text: [
      owner ? `Original creator: @${owner}` : "",
      url ? `Original post: ${url}` : "",
      `Original caption:\n${caption || "(none provided)"}`,
      notes ? `Teammate's notes: ${notes}` : "",
      rerunNote(context),
    ].filter(Boolean).join("\n\n") },
  ];
  const output = await ask({ role: "editor", system: rolePrompt("brief", profile, `Today is ${today()}.`), content, schema: BriefSchema, what: "read the original post", signal: context.signal, usage: context.usage });
  return { output, source };
};

export const facts: StageRunner = async context => {
  const b = need<Brief>(context.file, "brief");
  const output = await work({
    role: "facts", what: "check the facts", signal: context.signal, usage: context.usage,
    system: rolePrompt("facts", context.profile, `Today is ${today()}. Search as much as you need, then hand in everything with submit_facts.`),
    content: [
      `BRIEF\n${JSON.stringify({ topic: b.topic, story: b.story, slides: b.slides, chart: b.chart, claims: b.claims, questions: b.questions, risks: b.risks })}`,
      context.file.source.notes ? `TEAMMATE'S NOTES\n${context.file.source.notes}` : "",
      rerunNote(context),
    ].filter(Boolean).join("\n\n"),
    serverTools: [{ type: "web_search_20260209", name: "web_search", max_uses: 12 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 }],
    submit: { name: "submit_facts", description: "Hand in the checked claims, the answers to the reader's questions, other checked facts and the risks.", schema: FactsSchema },
  });
  return { output };
};

export const data: StageRunner = async context => {
  const b = need<Brief>(context.file, "brief"), charts = context.cache.chartData;
  const output = await work({
    role: "data", what: "rebuild the chart data", signal: context.signal, usage: context.usage, maxTurns: 16,
    system: rolePrompt("data", context.profile, `Today is ${today()}.\n\n${CHART_FIELDS}\n\nIf the original has no chart and no reader question needs one, hand in an empty charts list.`),
    content: [
      `BRIEF\n${JSON.stringify({ topic: b.topic, story: b.story, chart: b.chart, chartSlides: b.slides.filter(slide => slide.role === "chart"), questions: b.questions })}`,
      context.file.source.notes ? `TEAMMATE'S NOTES\n${context.file.source.notes}` : "",
      rerunNote(context),
    ].filter(Boolean).join("\n\n"),
    tools: dataTools(charts, context.signal),
    serverTools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 }],
    submit: {
      name: "submit_charts", description: "Hand in the charts to draw, each with its source line, plus notes.", schema: DataSchema,
      // Every chart must actually draw from real data before it is accepted.
      check: async value => {
        for (const chart of value.charts) {
          try { await resolveChart(chart.chart, charts, context.signal); } catch (error) {
            if (context.signal.aborted) throw error;
            return `Chart "${chart.id}" can't be drawn: ${message(error)}`;
          }
        }
        return null;
      },
    },
  });
  return { output };
};

/** Viral charts and claims keep circulating, so a search may reach back three years. */
const REACTIONS_LOOKBACK_DAYS = 3 * 365;
export const MAX_X_SEARCHES = 4;

/** A search start date: the given one, kept between three years ago and today; 30 days back by default. */
export function reactionsSince(value: string, now = Date.now()): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  const time = Number.isFinite(parsed) ? Math.min(now, Math.max(now - REACTIONS_LOOKBACK_DAYS * 864e5, parsed)) : now - 30 * 864e5;
  return new Date(time).toISOString().slice(0, 10);
}

const describePost = (post: XReaction) =>
  `- id ${post.id} · ${post.author.name} @${post.author.handle}${post.author.verified ? " (verified)" : ""} · ${post.likes} likes, ${post.reposts} reposts · ${post.createdAt?.slice(0, 10) ?? "date unknown"}\n  ${post.text.replace(/\s+/g, " ").slice(0, 400)}`;

const SearchSchema = z.object({
  terms: z.array(z.string().min(1).max(120)).min(1).max(3).describe("1-3 short searches, worded the way people post about it on X. Quotes match an exact phrase"),
  since: z.string().describe("Earliest post date, YYYY-MM-DD: when the story first spread, up to three years back"),
  minLikes: z.number().int().min(20).max(100_000).describe("Like floor. 100 by default; 30-50 for a niche story; 500 or more to cut noise"),
  language: z.string().regex(/^[a-z]{2}$/).describe("Language of the posts, such as en or es"),
});
type Search = z.infer<typeof SearchSchema>;
const PicksSchema = z.object({ picks: z.array(z.object({ id: z.string(), why: z.string() })), note: z.string() });

/**
 * The X reactions agent's search: real posts from X through Apify, most-liked
 * first. Every post it shows is kept in `seen`, so the agent's picks can be
 * checked against what X actually returned. At most MAX_X_SEARCHES per run.
 */
export function xSearchTool(seen: Map<string, XReaction>, options: { signal?: AbortSignal; fetch?: typeof fetch; failures?: string[] } = {}): ClientTool {
  let searches = 0;
  return {
    name: "search_x",
    description: `Search X for the most-liked real posts. Returns each post's id, author, likes, reposts, date and text, most-liked first. At most ${MAX_X_SEARCHES} searches per run, so change the words, the start date or the like floor each time.`,
    schema: SearchSchema,
    run: async input => {
      const { terms, since, minLikes, language } = input as Search;
      if (searches >= MAX_X_SEARCHES) throw new ToolError(`No searches left (${MAX_X_SEARCHES} per run). Pick from the posts you found, or hand in no picks with a note.`);
      searches++;
      const from = reactionsSince(since);
      try {
        const found = await fetchXReactions({ terms, since: from, max: 30, language, minLikes, signal: options.signal, ...(options.fetch ? { fetch: options.fetch } : {}) });
        for (const post of found) if (!seen.has(post.id)) seen.set(post.id, post);
        const left = `${MAX_X_SEARCHES - searches} search${MAX_X_SEARCHES - searches === 1 ? "" : "es"} left.`;
        if (!found.length) return `No posts in ${language} since ${from} with at least ${minLikes} likes. Try other words, an earlier start or a lower floor. ${left}`;
        return `${found.length} posts since ${from} (${left})\n${found.map(describePost).join("\n")}`;
      } catch (error) {
        if (!(error instanceof XReactionsError)) throw error;
        options.failures?.push(error.message);
        throw new ToolError(error.message);
      }
    },
  };
}

/** A problem to send back when a pick isn't one of the posts the searches returned. */
export function unknownPicks(picks: { id: string }[], seen: Map<string, XReaction>): string | null {
  const unknown = picks.filter(pick => !seen.has(pick.id)).map(pick => pick.id);
  return unknown.length ? `These ids weren't in your search results: ${unknown.join(", ")}. Pick only posts you found.` : null;
}

const skipped = (note: string): { status: "skipped"; output: ReactionsOutput } => ({ status: "skipped", output: { reactions: [], note } });

export const reactions: StageRunner = async context => {
  const { profile, signal, usage } = context, b = need<Brief>(context.file, "brief");
  if (!process.env.APIFY_TOKEN?.trim()) return skipped("X reactions need APIFY_TOKEN on the server.");
  const seen = new Map<string, XReaction>(), failures: string[] = [], search = xSearchTool(seen, { signal, failures });
  const terms = b.reactionSearch.terms.map(term => term.trim()).filter(Boolean).slice(0, 3);
  const since = reactionsSince(b.reactionSearch.since);
  // The brief's search runs first, so the agent starts from real results. A page in
  // another language gets the most-liked English posts too when its own are few.
  const first: string[] = [];
  for (const language of terms.length ? [...new Set([profile.language, "en"])] : []) {
    if (language !== profile.language && seen.size >= 4) break;
    const input: Search = { terms, since, minLikes: 100, language };
    try {
      first.push(`search_x ${JSON.stringify(input)}\n${await search.run(input)}`);
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
      // X can't be searched at all (no credit, a rejected token): more searches won't help.
      if (failures.length) return skipped(failures[0]);
      throw error;
    }
  }
  const picked = await work({
    role: "reactions", what: "find reactions on X", effort: "medium", signal, usage,
    system: rolePrompt("reactions", profile),
    content: [
      `STORY\n${b.story}`,
      `ORIGINAL HEADLINE\n${b.originalHeadline}`,
      `TODAY\n${today()}`,
      first.length ? `SEARCHES SO FAR\n${first.join("\n\n")}` : "No search has run yet: the brief had no X search terms.",
      "If these posts aren't worth a slide (spam, copy-paste templates, ads, off-topic), search again with other words, an earlier start date or a lower like floor. Then hand in your picks.",
      rerunNote(context),
    ].filter(Boolean).join("\n\n"),
    tools: [search],
    submit: {
      name: "submit_reactions",
      description: "Hand in the posts worth a slide: ids from your searches, best first, each with one line on why. Hand in none, with a note, when nothing is good enough.",
      schema: PicksSchema,
      check: async value => unknownPicks(value.picks, seen),
    },
    maxTurns: 10,
  });
  // Nothing found because X couldn't be searched at all (for example, the Apify account is out of credit).
  if (!seen.size && failures.length) return skipped(failures.at(-1)!);
  const chosen = picked.picks.flatMap(pick => {
    const post = seen.get(pick.id);
    return post ? [{ ...post, why: pick.why }] : [];
  }).filter((post, index, list) => list.findIndex(item => item.id === post.id) === index).slice(0, 8);
  return { output: { reactions: chosen, note: picked.note || (seen.size ? "" : `No posts about this on X since ${since} passed the like floor.`) } satisfies ReactionsOutput };
};

/** Pages the fact-checker cited, most-cited first: a report's own charts and an announcement's own images are the story's best real visuals. */
export function citedPages(facts: Facts | undefined, max = 8): string[] {
  const counts = new Map<string, number>();
  const sources = [...(facts?.claims ?? []).flatMap(claim => claim.sources), ...(facts?.answers ?? []).flatMap(answer => answer.sources)];
  for (const source of sources) {
    const url = publicHttpUrl(source.url);
    if (!url) continue;
    url.hash = "";
    counts.set(url.toString(), (counts.get(url.toString()) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([url]) => url);
}

const MIN_PHOTO_SIDE = 480, MAX_PHOTO_BYTES = 12 * 1024 * 1024, PHOTOS_PER_PAGE = 4, MAX_PAGE_PHOTOS = 24;

/** The size of a public JPEG, PNG, WebP or GIF at least 480 px on its short side and not a banner, or null. */
export async function photoSize(address: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ width: number; height: number } | null> {
  const url = publicHttpUrl(address);
  if (!url) return null;
  try {
    const response = await fetcher(url, { headers: { "User-Agent": "EngineBot/1.0 (+https://github.com/chatgptricks/engine)", Accept: "image/*" }, redirect: "follow", signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    if (!response.ok || !/^image\/(jpeg|png|webp|gif)\b/i.test(response.headers.get("content-type") ?? "") || Number(response.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES) { await response.body?.cancel().catch(() => undefined); return null; }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) return null;
    const { width = 0, height = 0 } = await sharp(bytes).metadata();
    return Math.min(width, height) >= MIN_PHOTO_SIDE && Math.max(width, height) <= 3 * Math.min(width, height) ? { width, height } : null;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

/** Real images from the cited pages, each checked to be a public, full-size photo or chart. */
export async function photosFromPages(pages: string[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<StoryImage[]> {
  const scraped = await Promise.all(pages.map(page => imagesFromPage(page).then(found => ({ page, ...found }), () => ({ page, images: [], title: "" }))));
  const seen = new Set<string>();
  const wanted = scraped.flatMap(({ page, images, title }) => images.filter(image => !seen.has(image.url) && Boolean(seen.add(image.url))).slice(0, PHOTOS_PER_PAGE).map(image => ({ page, image, title }))).slice(0, MAX_PAGE_PHOTOS);
  const checked = await Promise.all(wanted.map(async ({ page, image, title }): Promise<StoryImage | null> => {
    const size = await photoSize(image.url, signal, fetcher);
    if (!size) return null;
    const host = new URL(page).hostname.replace(/^www\./, "");
    return {
      id: `web_${createHash("sha256").update(image.url).digest("hex").slice(0, 12)}`, url: image.url, source: "web", kind: "real_subject",
      directive: host, width: size.width, height: size.height, rightsNote: `From ${host}: confirm rights before posting.`, cosmosManual: false,
      sourceUrl: page, description: image.caption || image.alt || title || "",
    };
  }));
  return checked.filter((image): image is StoryImage => image !== null);
}

export const visuals: StageRunner = async context => {
  const b = need<Brief>(context.file, "brief"), signal = context.signal;
  const none = (note: string) => ({ status: "skipped" as const, output: { candidates: [], note } satisfies VisualsOutput });
  const searches = [...new Set(b.photos.map(term => term.trim()).filter(Boolean))].slice(0, 2);
  if (!searches.length) return none("The brief asked for no photos.");
  const onX = Boolean(process.env.APIFY_TOKEN?.trim());
  const [fromPages, fromX] = await Promise.all([
    photosFromPages(citedPages(outputOf<Facts>(context.file, "facts")), signal),
    onX ? Promise.all(searches.map(term => searchXImages(term, 16))).then(lists => lists.flat()) : Promise.resolve([]),
  ]);
  // Nothing from X may mean the Apify plan can't search X, not that there are no photos.
  const blocked = onX && !fromX.length && await xSearchNeedsPaidPlan({ signal });
  const xNote = blocked ? X_PAID_PLAN : onX ? "" : "Photo search on X needs APIFY_TOKEN on the server.";
  const found = [...fromPages, ...fromX];
  if (!found.length) return none([xNote, "No usable photos turned up on the sources' pages."].filter(Boolean).join(" "));
  // Vision curation drops the unrelated (ads, memes, other stories); it lets everything through when it can't run.
  const kept = await curateImages(found, { title: b.topic, summary: b.story });
  const candidates = kept.slice(0, 12).map(image => ({ id: image.id, url: image.url, description: image.description ?? "", sourceUrl: image.sourceUrl ?? "", credit: image.directive }));
  return { output: { candidates, note: candidates.length ? xNote : [xNote, "No usable photos turned up."].filter(Boolean).join(" ") } satisfies VisualsOutput };
};
