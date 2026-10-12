import { RESEARCH_MODEL, getOpenAI } from "@/lib/openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { searchXImages } from "./apify";
import { curateImages } from "./image-curator";
import { POST_TYPE_IDS, postType } from "./post-types";
import { emptyCuration } from "./types";
import type {
  Dossier,
  ImageSource,
  ResearchStoryPayload,
  Story,
  StoryImage,
  VerificationStatus,
} from "./types";

/**
 * Engine — the research engine, as a plain server-side function.
 *
 * Runs the finder system prompt against OpenAI with live web search, forces a
 * structured result via the `submit_story` tool, scrapes a real-image pool from
 * the verified pages, and returns the mapped payload. Both API routes call this
 * directly (the interactive `research`/`research-start` routes and the cron),
 * so there is exactly one research code path.
 *
 * Throws an Error with a human-readable message on failure — callers decide
 * whether that becomes an HTTP status or a "failed" story row.
 */

const gate = {
  type: "object" as const,
  properties: {
    pass: { type: "boolean" as const },
    note: { type: "string" as const, description: "One line." },
  },
  required: ["pass", "note"],
};

const sourceLink = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const },
    url: { type: "string" as const },
  },
  required: ["name", "url"],
};

const SUBMIT_TOOL = {
  type: "function" as const,
  name: "submit_story",
  description:
    "Return the finished research result as structured data. Call this exactly once, at the very end, AFTER doing the live web research. Every hard fact in the caption must trace to a source in the dossier.",
  strict: false,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "One-line working title." },
      description: {
        type: "string",
        description: "A 1–2 line summary, distinct from the caption.",
      },
      postType: {
        type: "string",
        enum: POST_TYPE_IDS,
        description: "The one Territory vein this story belongs to.",
      },
      alignment: {
        type: "string",
        enum: ["sponsorable", "audience-shaping", "pure"],
        description:
          "Editorial territory from the alignment layer (mostly pure / audience-shaping, a minority sponsorable).",
      },
      alignmentNote: {
        type: "string",
        description:
          "One line: which territory and, if sponsorable, which brand-world it naturally orbits.",
      },
      verdict: { type: "string", enum: ["SURFACE", "REJECT"] },
      rubric: {
        type: "object",
        properties: {
          verification: gate,
          specificity: gate,
          hiddenness: gate,
          synthesis: gate,
          visual: gate,
          voice: gate,
        },
        required: [
          "verification",
          "specificity",
          "hiddenness",
          "synthesis",
          "visual",
          "voice",
        ],
      },
      dossier: {
        type: "object",
        properties: {
          verificationStatus: {
            type: "string",
            enum: ["fully_verified", "partial", "unverifiable"],
          },
          verifiedFacts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fact: { type: "string" },
                sources: { type: "array", items: sourceLink },
                confirmedByTwo: { type: "boolean" },
              },
              required: ["fact", "sources"],
            },
          },
          primarySources: { type: "array", items: sourceLink },
          contestedPoints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim: { type: "string" },
                handling: { type: "string" },
              },
              required: ["claim", "handling"],
            },
          },
        },
        required: [
          "verificationStatus",
          "verifiedFacts",
          "primarySources",
          "contestedPoints",
        ],
      },
      caption: {
        type: "string",
        description:
          "Paste-ready caption in voice, 90 to 140 words (count them — this is a hard constraint, not a target). No em dashes, no exclamation marks, no hype.",
      },
      titleOverImage: {
        type: "object",
        properties: {
          use: { type: "boolean" },
          text: { type: "string" },
        },
        required: ["use", "text"],
      },
      imageDirectives: {
        type: "array",
        description: "6–10 directives that together target 40+ real images.",
        items: {
          type: "object",
          properties: {
            directive: { type: "string", description: "The precise query." },
            source: {
              type: "string",
              enum: ["google", "apify_pinterest", "cosmos_manual"],
            },
            kind: { type: "string", enum: ["real_subject", "atmospheric"] },
            surfaces: { type: "string" },
            why: { type: "string" },
            notes: { type: "string" },
            slideOneCandidate: { type: "boolean" },
          },
          required: ["directive", "source", "kind"],
        },
      },
      imageSourceUrls: {
        type: "array",
        description:
          "6–14 URLs of image-rich pages we can harvest real photos of the subject from: Wikimedia Commons categories, museum/collection galleries, Flickr albums, official press/media kits, news photo galleries. Prefer pages with many real photographs of the actual subject. These are scraped server-side for the carousel pool, so favor pages with real <img> content over JS-only apps.",
        items: { type: "string" },
      },
      xSearchQuery: {
        type: "string",
        description:
          "A short X/Twitter search phrase, 2–5 words: the story's concrete subject as people would name it in a post (proper nouns — product, person, place). Used verbatim to pull real photos and screenshots from X, so make it the term most likely to appear in on-topic posts, NOT a descriptive sentence.",
      },
      techOvert: { type: "boolean" },
      techOvertReason: { type: "string" },
    },
    required: [
      "title",
      "description",
      "postType",
      "alignment",
      "verdict",
      "dossier",
      "caption",
      "imageDirectives",
      "techOvert",
    ],
  },
};

const WEB_SEARCH = { type: "web_search" as const };

const FALLBACK_SYSTEM =
  "You are the editorial engine behind Engine. Research the requested story by browsing the live web, verify every fact against real sources you actually read, then draft a calm declarative caption and a pool of real-image search directives.";

// Generous output budget: with adaptive thinking at high effort, the final turn
// has to fit the model's thinking PLUS the full submit_story payload. 8K proved
// occasionally too tight (truncated tool calls read as "research failed").
const MAX_TOKENS = 16000;
// Web-search rounds arrive as pause_turn/tool_use continuations; give the loop
// room so a thorough run is never cut off by the turn cap.
const MAX_TURNS = 12;
// Hard wall for the whole engine run. A news-heavy run once exceeded the
// SDK's 10-minute request timeout and died ambiguously; we bail with a clear,
// retryable error first. (Vercel's maxDuration kills the function earlier in
// prod; the stale-stub conversion turns that into a failed card too.)
const ENGINE_DEADLINE_MS = 8 * 60_000;

interface DirectiveInput {
  directive: string;
  source?: string;
  kind?: string;
  notes?: string;
}

const ASPECTS: Array<[number, number]> = [
  [1080, 1350],
  [1080, 1080],
  [1440, 1080],
  [1080, 1620],
  [1620, 1080],
  [1080, 1440],
];

function seedOf(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function mapSource(s: string | undefined): ImageSource {
  if (s === "cosmos_manual") return "cosmos_manual";
  if (s === "apify_pinterest") return "apify";
  if (s === "google") return "google";
  return "pinterest";
}

/**
 * Google Programmable Search (Custom Search JSON API), image mode. Returns
 * real image hits for a query, or [] if the keys are missing or the call
 * fails. Needs GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_ENGINE_ID.
 */
async function googleImageSearch(
  query: string,
  want: number,
): Promise<Array<{ url: string; width: number; height: number }>> {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
  if (!key || !cx) return [];
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(Math.min(Math.max(want, 1), 10)));
  url.searchParams.set("safe", "active");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{ link?: string; image?: { width?: number; height?: number } }>;
    };
    return (data.items ?? [])
      .map((it) => ({
        url: String(it.link ?? ""),
        width: Number(it.image?.width) || 1080,
        height: Number(it.image?.height) || 1080,
      }))
      .filter((i) => i.url.startsWith("http"));
  } catch {
    return [];
  }
}

function placeholderTile(d: DirectiveInput, di: number, i: number): StoryImage {
  const [w, h] = ASPECTS[(di + i) % ASPECTS.length];
  return {
    id: `gimg_${di}_${i}_${Math.round(Math.random() * 1e6).toString(36)}`,
    url: `https://picsum.photos/seed/${seedOf(d.directive)}-${di}-${i}/${w}/${h}`,
    source: mapSource(d.source),
    kind: d.kind === "atmospheric" ? "atmospheric" : "real_subject",
    directive: d.directive,
    width: w,
    height: h,
    rightsNote: d.notes ?? "",
    cosmosManual: d.source === "cosmos_manual",
  };
}

const SCRAPE_UA = "EngineBot/1.0 (+https://github.com/chatgptricks/engine)";

function pickLargestSrcset(srcset: string): string | null {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(",")) {
    const seg = part.trim();
    const sp = seg.lastIndexOf(" ");
    const url = (sp === -1 ? seg : seg.slice(0, sp)).trim();
    const w = sp === -1 ? 1 : Number(seg.slice(sp + 1).replace(/[^\d]/g, "")) || 1;
    if (url && (!best || w > best.w)) best = { url, w };
  }
  return best?.url ?? null;
}

function isJunkImage(u: string): boolean {
  const s = u.toLowerCase();
  if (s.startsWith("data:")) return true;
  if (/\.svg(\?|$)/.test(s)) return true;
  if (/(logo|sprite|favicon|icon|avatar|placeholder|spacer|pixel|tracking|blank|loading|1x1)/.test(s))
    return true;
  // Wikimedia/MediaWiki page chrome: map tiles, category 250x250 cards, static.
  if (/maps\.wikimedia\.org|osm-intl|250x250|\/static\/|special:/.test(s))
    return true;
  const px = s.match(/\/(\d{1,3})px-/); // tiny wikimedia/cdn thumbs
  if (px && Number(px[1]) < 200) return true;
  return false;
}

/** Decode the handful of HTML entities that show up inside scraped URLs
 * (mainly &amp;), so query strings aren't mangled. */
function decodeUrlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&#x0*26;/gi, "&");
}

/** Collapse a Wikimedia thumbnail URL to its full-res original (also dedupes
 * the same image served at several sizes). */
function normalizeWikimedia(u: string): string {
  const m = u.match(
    /^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/thumb\/(.+?\.(?:jpe?g|png|gif|webp))\/[^/]+$/i,
  );
  return m ? `${m[1]}/${m[2]}` : u;
}

type ScrapedImage = {
  url: string;
  width: number;
  height: number;
  alt: string;
  /** The visible published caption under the image (figcaption / caption-class
   * element) — usually far richer than alt text, and the preferred description. */
  caption: string;
};

/** Inner text of an HTML fragment: tags stripped, entities decoded, collapsed. */
function innerText(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Server-side: extract real image URLs (+ alt text + the published caption
 * under each image) and the page title. Exported for the chat's harvest tool. */
export async function imagesFromPage(
  pageUrl: string,
): Promise<{ images: ScrapedImage[]; title: string }> {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return { images: [], title: "" };
  }
  if (!/^https?:$/.test(base.protocol)) return { images: [], title: "" };
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": SCRAPE_UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { images: [], title: "" };
    if (!(res.headers.get("content-type") ?? "").includes("text/html"))
      return { images: [], title: "" };
    const html = (await res.text()).slice(0, 800_000);

    const ogTitle = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    )?.[1];
    const docTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const title = (ogTitle || docTitle || "").replace(/\s+/g, " ").trim().slice(0, 160);

    const found = new Map<string, ScrapedImage>();
    const add = (raw: string, w = 0, h = 0, alt = "", caption = "") => {
      try {
        const u = normalizeWikimedia(
          new URL(decodeUrlEntities(raw), base).toString(),
        );
        if (!/^https?:/.test(u) || isJunkImage(u) || found.has(u)) return;
        found.set(u, {
          url: u,
          width: w,
          height: h,
          alt: alt.replace(/\s+/g, " ").trim().slice(0, 200),
          caption: caption.slice(0, 280),
        });
      } catch {
        /* skip bad url */
      }
    };

    // Published captions: map every <figure> range to its <figcaption> text so
    // the imgs inside inherit it (the caption under an image is usually far
    // richer than alt text — names, dates, what the picture actually is).
    const figures: Array<{ start: number; end: number; caption: string }> = [];
    for (const f of html.matchAll(/<figure\b[^>]*>([\s\S]*?)<\/figure>/gi)) {
      const cap = f[1].match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1];
      if (cap && f.index !== undefined) {
        const text = innerText(cap);
        if (text)
          figures.push({ start: f.index, end: f.index + f[0].length, caption: text });
      }
    }
    const captionAt = (pos: number, tail: string): string => {
      const fig = figures.find((f) => pos >= f.start && pos < f.end);
      if (fig) return fig.caption;
      // Fallback for caption-class siblings right after the img (Wikipedia's
      // thumbcaption, CMS "caption"/"credit" divs).
      const near = tail
        .slice(0, 700)
        .match(
          /<(div|p|span|small)\b[^>]*class=["'][^"']*caption[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
        )?.[2];
      return near ? innerText(near) : "";
    };
    for (const m of html.matchAll(
      /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/gi,
    ))
      add(m[1]);
    for (const m of html.matchAll(
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/gi,
    ))
      add(m[1]);
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const pos = m.index ?? 0;
      const w = Number(tag.match(/\bwidth=["']?(\d+)/i)?.[1]) || 0;
      const h = Number(tag.match(/\bheight=["']?(\d+)/i)?.[1]) || 0;
      const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "";
      const caption = captionAt(pos, html.slice(pos + tag.length));
      const srcset = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1];
      if (srcset) {
        const largest = pickLargestSrcset(srcset);
        if (largest) add(largest, w, h, alt, caption);
      }
      const src =
        tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ??
        tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1];
      if (src) add(src, w, h, alt, caption);
    }
    return { images: [...found.values()], title };
  } catch {
    return { images: [], title: "" };
  }
}

/**
 * Build the image pool. Primary path (no extra keys): harvest real images from
 * the pages OpenAI verified/recommended. Then Google CSE for `google`
 * directives if those keys exist, then placeholder tiles so the gallery is
 * never empty.
 */
async function buildImagePool(opts: {
  directives: DirectiveInput[];
  pageUrls: string[];
}): Promise<StoryImage[]> {
  const { directives, pageUrls } = opts;
  const out: StoryImage[] = [];
  const seen = new Set<string>();

  // 1) Scrape the model's image-source pages + verified-source pages.
  const pages = pageUrls.slice(0, 14);
  const scraped = await Promise.all(
    pages.map((p) =>
      imagesFromPage(p).catch(() => ({ images: [], title: "" })),
    ),
  );
  scraped.forEach((res, pi) => {
    let host = "web";
    try {
      host = new URL(pages[pi]).hostname.replace(/^www\./, "");
    } catch {
      /* keep default */
    }
    res.images.slice(0, 8).forEach((img, i) => {
      if (seen.has(img.url)) return;
      seen.add(img.url);
      out.push({
        id: `wimg_${pi}_${i}_${Math.round(Math.random() * 1e6).toString(36)}`,
        url: img.url,
        source: "web",
        kind: "real_subject",
        directive: host,
        width: img.width,
        height: img.height,
        rightsNote: `From ${host} — confirm rights before posting.`,
        cosmosManual: false,
        sourceUrl: pages[pi],
        // The published caption beats alt text beats the page title.
        description: img.caption || img.alt || res.title || "",
      });
    });
  });

  // 2) Optional Google CSE for `google` directives, if configured.
  if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
    for (let di = 0; di < directives.length && out.length < 48; di++) {
      const d = directives[di];
      if (!d?.directive || d.source !== "google") continue;
      const hits = await googleImageSearch(d.directive, 6);
      hits.forEach((h, i) => {
        if (seen.has(h.url)) return;
        seen.add(h.url);
        out.push({
          id: `gimg_${di}_${i}_${Math.round(Math.random() * 1e6).toString(36)}`,
          url: h.url,
          source: "google",
          kind: d.kind === "atmospheric" ? "atmospheric" : "real_subject",
          directive: d.directive,
          width: h.width,
          height: h.height,
          rightsNote: d.notes ?? "",
          cosmosManual: false,
        });
      });
    }
  }

  // 3) Top up with placeholder tiles so there is range to curate.
  if (out.length < 12) {
    directives.forEach((d, di) => {
      if (!d?.directive) return;
      for (let i = 0; i < 3; i++) out.push(placeholderTile(d, di, i));
    });
  }

  return out.slice(0, 60);
}

function asVerification(v: unknown): VerificationStatus {
  return v === "fully_verified" || v === "partial" || v === "unverifiable"
    ? v
    : "partial";
}

export interface ResearchEngineInput {
  prompt: string;
  attachments?: string[];
  systemPrompt?: string;
  requestedType?: string;
  /** Hard wall for the whole run (default ENGINE_DEADLINE_MS). Callers on a
   * bounded platform (Vercel maxDuration) size this to leave room for the
   * failure write, so a too-long run records its own outcome. */
  deadlineMs?: number;
}

/** Run one full research: OpenAI + web search → submit_story → image pool. */
export async function runResearchEngine(
  input: ResearchEngineInput,
): Promise<ResearchStoryPayload> {
  const client = getOpenAI();
  if (!client) {
    throw new Error("Research is not configured (OPENAI_API_KEY missing).");
  }
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("No prompt.");

  const reqType = postType(input.requestedType);

  const today = new Date().toISOString().slice(0, 10);
  const system =
    (input.systemPrompt?.trim() ? input.systemPrompt.trim() : FALLBACK_SYSTEM) +
    `\n\n---\nOPERATING MODE: Today is ${today}. Research exactly one story for the request below. Do the live web research first (use web_search; reach primary sources; verify every fact). Budget the run: commit to a subject quickly, prefer a handful of decisive searches over exhaustive sweeps, and aim to finish the whole job within a few minutes. Then call the submit_story tool exactly once with the structured result. Do not print the text block; the tool call IS your output. In submit_story, set postType (the Territory vein) and alignment (sponsorable / audience-shaping / pure). Populate imageSourceUrls with image-rich pages we can scrape real photos from (Wikimedia Commons categories, museum/collection galleries, Flickr, official press kits, news photo galleries), in addition to the imageDirectives. The caption must be 90 to 140 words — count the words and revise until it lands inside that band.` +
    (reqType
      ? `\n\nTYPE FOCUS: This run must surface a **${reqType.label}** story (postType "${reqType.id}"): ${reqType.blurb} Hunt only inside this vein and tag postType "${reqType.id}".${
          reqType.focus ? ` ${reqType.focus}` : ""
        }`
      : "");

  const attachments = input.attachments ?? [];
  const userText =
    `Research request:\n${prompt}` +
    (attachments.length
      ? `\n\nReference files the curator attached (names only): ${attachments.join(", ")}`
      : "");

  let result: Record<string, unknown> | null = null;
  let previousResponseId: string | undefined;
  let nextInput: string | Array<{ type: "function_call_output"; call_id: string; output: string }> = userText;
  const trace: string[] = [];
  const startedAt = Date.now();
  const deadlineMs = input.deadlineMs ?? ENGINE_DEADLINE_MS;
  const tooLong = () =>
    new Error("Research ran too long — retry (it usually lands well under the limit).");

  for (let turn = 0; turn < MAX_TURNS && !result; turn++) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    if (remaining < 15_000) throw tooLong();
    const response: OpenAIResponse = await client.responses.create(
      {
        model: RESEARCH_MODEL,
        instructions: system,
        input: nextInput,
        previous_response_id: previousResponseId,
        tools: [WEB_SEARCH, SUBMIT_TOOL],
        max_output_tokens: MAX_TOKENS,
        store: true,
      },
      { signal: AbortSignal.timeout(remaining) },
    );
    previousResponseId = response.id;
    trace.push(response.status ?? "unknown");
    const submit = response.output.find(
      (item) => item.type === "function_call" && item.name === "submit_story",
    );
    if (submit?.type === "function_call") {
      try {
        const candidate = JSON.parse(submit.arguments) as Record<string, unknown>;
        if (
          typeof candidate.title === "string" && candidate.title.trim() &&
          typeof candidate.caption === "string" && candidate.caption.trim() &&
          candidate.dossier && Array.isArray(candidate.imageDirectives)
        ) {
          result = candidate;
          break;
        }
      } catch { /* ask the model to repair malformed arguments */ }
      nextInput = [{
        type: "function_call_output",
        call_id: submit.call_id,
        output: "Incomplete story. Call submit_story again with a title, caption, dossier, imageDirectives, and all required fields.",
      }];
      continue;
    }
    nextInput = response.status === "incomplete"
      ? "You hit the output limit. Call submit_story now with a concise complete result."
      : "Call submit_story now with the completed, source-verified story. Do not answer in plain text.";
  }

  if (!result) {
    console.error("[gf-research] no result; stop_reason trace:", trace.join(" → "));
    throw new Error(
      `Research did not return a structured result (turns: ${trace.join(" → ") || "none"}).`,
    );
  }
  console.error(
    "[gf-research] ok after",
    trace.length,
    "turn(s):",
    trace.join(" → "),
  );

  const r = result;
  const d = (r.dossier ?? {}) as Record<string, unknown>;
  const dossier: Dossier = {
    verificationStatus: asVerification(d.verificationStatus),
    verifiedFacts: Array.isArray(d.verifiedFacts)
      ? (d.verifiedFacts as Record<string, unknown>[]).map((f) => ({
          fact: String(f.fact ?? ""),
          sources: Array.isArray(f.sources)
            ? (f.sources as Record<string, unknown>[]).map((s) => ({
                name: String(s.name ?? ""),
                url: String(s.url ?? ""),
              }))
            : [],
          confirmedByTwo: Boolean(f.confirmedByTwo),
        }))
      : [],
    primarySources: Array.isArray(d.primarySources)
      ? (d.primarySources as Record<string, unknown>[]).map((s) => ({
          name: String(s.name ?? ""),
          url: String(s.url ?? ""),
        }))
      : [],
    contestedPoints: Array.isArray(d.contestedPoints)
      ? (d.contestedPoints as Record<string, unknown>[]).map((c) => ({
          claim: String(c.claim ?? ""),
          handling: String(c.handling ?? ""),
        }))
      : [],
  };

  const titleOver = (r.titleOverImage ?? {}) as Record<string, unknown>;
  // Pages to harvest real images from: the model's recommended image-rich pages
  // plus every verified-source URL in the dossier.
  const dossierUrls = [
    ...dossier.primarySources.map((s) => s.url),
    ...dossier.verifiedFacts.flatMap((f) => f.sources.map((s) => s.url)),
  ].filter(Boolean);
  const claudePages = Array.isArray(r.imageSourceUrls)
    ? (r.imageSourceUrls as unknown[]).map(String)
    : [];
  const pageUrls = Array.from(new Set([...claudePages, ...dossierUrls]));
  const directiveList = (r.imageDirectives as DirectiveInput[]) ?? [];
  const webImages = await buildImagePool({ directives: directiveList, pageUrls });

  // Auto-run X on every research: X is where the real screenshots and memes
  // live. The researcher names the subject phrase (xSearchQuery) — quoted, so
  // X search matches the actual subject instead of loosely co-occurring slop.
  // Fall back to the sharpest real-subject directive for older payloads.
  const xSubject =
    typeof r.xSearchQuery === "string" && r.xSearchQuery.trim()
      ? r.xSearchQuery.trim()
      : directiveList.find((d2) => d2?.directive && d2.kind !== "atmospheric")
          ?.directive ||
        directiveList[0]?.directive ||
        String(r.title ?? "") ||
        prompt;
  const xTerm =
    xSubject.includes('"') || xSubject.split(/\s+/).length === 1
      ? xSubject
      : `"${xSubject}"`;
  const xImages = await searchXImages(xTerm, 24);
  const seenUrls = new Set(webImages.map((i) => i.url));
  const merged = [
    ...webImages,
    ...xImages.filter((i) => !seenUrls.has(i.url)),
  ].slice(0, 80);

  // Vision pass: look at every gathered image, drop the unrelated, give each
  // kept image a truthful ~20-word description tied to the story. Fail-open.
  const images = await curateImages(merged, {
    title: String(r.title ?? ""),
    summary: String(r.description ?? "") || String(r.caption ?? "").slice(0, 200),
    facts: dossier.verifiedFacts
      .slice(0, 6)
      .map((f) => `- ${f.fact}`)
      .join("\n"),
  });
  const validAlignment = ["sponsorable", "audience-shaping", "pure"];
  const resolvedType =
    typeof r.postType === "string" && POST_TYPE_IDS.includes(r.postType)
      ? r.postType
      : reqType?.id;
  return {
    title: String(r.title ?? "Untitled"),
    description: String(r.description ?? ""),
    postType: resolvedType,
    alignment:
      typeof r.alignment === "string" && validAlignment.includes(r.alignment)
        ? r.alignment
        : undefined,
    alignmentNote: r.alignmentNote ? String(r.alignmentNote) : undefined,
    verdict: r.verdict === "REJECT" ? "REJECT" : "SURFACE",
    rubric: (r.rubric as ResearchStoryPayload["rubric"]) ?? undefined,
    techOvert: Boolean(r.techOvert),
    caption: String(r.caption ?? ""),
    titleOverImage: {
      use: Boolean(titleOver.use),
      text: String(titleOver.text ?? ""),
    },
    dossier,
    images,
    directives: Array.isArray(r.imageDirectives)
      ? (r.imageDirectives as Record<string, unknown>[])
          .map((d2) => ({
            directive: String(d2.directive ?? ""),
            source: String(d2.source ?? "google"),
            kind: String(d2.kind ?? "real_subject"),
          }))
          .filter((d2) => d2.directive)
      : [],
  };
}

/** Map a finished payload onto a stored Story row (server-side flows). */
export function payloadToStory(
  id: string,
  p: ResearchStoryPayload,
  base?: Partial<Story>,
): Story {
  return {
    id,
    status: "queue",
    title: p.title,
    description: p.description,
    postType: p.postType ?? base?.postType,
    channelId: base?.channelId,
    alignment: p.alignment,
    alignmentNote: p.alignmentNote,
    researchCompletedAt: new Date().toISOString(),
    leadImageId: p.images?.[0]?.id ?? "",
    techOvert: Boolean(p.techOvert),
    dossier: p.dossier,
    caption: {
      draft: p.caption,
      titleOverImage: p.titleOverImage ?? { use: false, text: "" },
    },
    images: p.images ?? [],
    curation: emptyCuration(),
    rubric: p.rubric,
    verdict: p.verdict,
    searchDirectives: p.directives,
    brief: base?.brief,
  };
}
