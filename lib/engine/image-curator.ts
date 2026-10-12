import sharp from "sharp";
import { getOpenAI, VISION_MODEL } from "@/lib/openai";
import type { StoryImage } from "./types";

/**
 * Vision curation of the gathered image pool. A fast vision model LOOKS at
 * every candidate image alongside the story context and either:
 *  - keeps it, writing a truthful ~20-word description of what the image
 *    actually shows and how it relates to the research, or
 *  - drops it as unrelated (the X firehose especially returns ads, sports,
 *    charts, anime — anything the search term loosely co-occurred with).
 *
 * This runs server-side wherever images enter a story: the research engine's
 * pool build, "More from X", and the chat's image tools. Fail-open by design:
 * any failure (no API key, timeout, fetch errors) returns the images
 * untouched rather than blocking research.
 */

/** High-volume, low-difficulty vision task — Haiku is built for this. */

/** Images per vision request. */
const BATCH_SIZE = 10;
/** Concurrent thumbnail fetches / vision requests. */
const FETCH_CONCURRENCY = 8;
const BATCH_CONCURRENCY = 3;
/** Hard wall for the whole curation pass — past it, return what we have. */
const CURATION_BUDGET_MS = 110_000;

export interface CurationContext {
  title: string;
  /** 1–2 line story summary (description or caption opening). */
  summary?: string;
  /** A few verified facts, newline-joined — anchors relevance judgments. */
  facts?: string;
}

interface Review {
  index: number;
  keep: boolean;
  description?: string;
}

const REVIEW_TOOL = {
  type: "function" as const,
  name: "submit_image_reviews",
  description: "Submit your review of every numbered image.",
  strict: false,
  parameters: {
    type: "object" as const,
    properties: {
      reviews: {
        type: "array" as const,
        description: "One entry per numbered image, in order.",
        items: {
          type: "object" as const,
          properties: {
            index: {
              type: "integer" as const,
              description: "The image's number as given.",
            },
            keep: {
              type: "boolean" as const,
              description: "true if the image belongs in this story's pool.",
            },
            description: {
              type: "string" as const,
              description:
                "Kept images only: ~20 words. What the image concretely shows, then its tie to the story.",
            },
          },
          required: ["index", "keep"],
        },
      },
    },
    required: ["reviews"],
  },
};

function curatorSystem(ctx: CurationContext): string {
  return `You curate the image pool for one Instagram story. Judge each numbered image by LOOKING at it.

THE STORY
Title: ${ctx.title}
${ctx.summary ? `Summary: ${ctx.summary}\n` : ""}${ctx.facts ? `Key facts:\n${ctx.facts}\n` : ""}
KEEP an image only if what it visibly shows relates to this story: the subject itself, its maker or place, the era or artifacts, faithful diagrams or reconstructions, relevant screenshots or posts ABOUT the subject. Atmospheric images are fine if clearly of the right subject matter.

DROP everything else without mercy: unrelated people, sports, ads, product shots, charts of other things, anime, memes about something else, logos, icons, blank or decorative frames. A loose keyword echo is not relevance. When unsure, drop.

For every KEPT image write a description of roughly 20 words: first what the image concretely shows (be specific and truthful — only what you can see), then how it connects to the story. Flat declarative tone, no hype, no em dashes.

Some images arrive with a published caption from their source page (shown in the hint). Treat it as ground truth: keep its names, dates, and specifics in your description instead of guessing — compress it, don't discard it. If what you SEE clearly contradicts the caption, trust your eyes.

Call submit_image_reviews exactly once with one entry per image.`;
}

/** Run an async mapper over items with bounded concurrency. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** Fetch an image and shrink it to a small JPEG the model can look at.
 * Returns null when the image can't be fetched or decoded. */
async function fetchThumb(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        Accept: "image/*,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 30 * 1024 * 1024) return null;
    const jpeg = await sharp(buf, { animated: false })
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    return jpeg.toString("base64");
  } catch {
    return null;
  }
}

/** Is this image one the curator should look at? Uploads are the curator's
 * own (never judged), videos can't go in image blocks, data URLs are local,
 * and placeholder tiles aren't real candidates. */
function reviewable(img: StoryImage): boolean {
  if (img.mediaType === "video") return false;
  if (img.cosmosManual || img.source === "upload") return false;
  if (!/^https?:\/\//.test(img.url)) return false;
  if (/picsum\.photos/.test(img.url)) return false;
  return true;
}

/**
 * Review every gathered image with vision: drop the unrelated, describe the
 * kept (~20 words, what it shows + tie to the story). Order is preserved;
 * images that can't be fetched or reviewed pass through unchanged.
 */
export async function curateImages(
  images: StoryImage[],
  ctx: CurationContext,
): Promise<StoryImage[]> {
  const client = getOpenAI();
  if (!client || images.length === 0) return images;

  const started = Date.now();
  const budgetLeft = () => CURATION_BUDGET_MS - (Date.now() - started);

  const candidates = images.filter(reviewable).slice(0, 96);
  if (candidates.length === 0) return images;

  try {
    // 1) Thumbnails (the model must SEE the images; tiny JPEGs keep it cheap).
    const thumbs = await mapLimit(candidates, FETCH_CONCURRENCY, (img) =>
      budgetLeft() > 15_000 ? fetchThumb(img.url) : Promise.resolve(null),
    );
    const viewable = candidates
      .map((img, i) => ({ img, thumb: thumbs[i] }))
      .filter((c): c is { img: StoryImage; thumb: string } => c.thumb !== null);
    if (viewable.length === 0) return images;

    // 2) Vision review in batches.
    const system = curatorSystem(ctx);
    const batches: Array<typeof viewable> = [];
    for (let i = 0; i < viewable.length; i += BATCH_SIZE)
      batches.push(viewable.slice(i, i + BATCH_SIZE));

    const verdicts = new Map<string, Review>(); // image id → review
    await mapLimit(batches, BATCH_CONCURRENCY, async (batch, bi) => {
      const remaining = budgetLeft();
      if (remaining < 12_000) return;
      try {
        const content: Array<
          | { type: "input_text"; text: string }
          | { type: "input_image"; image_url: string; detail: "low" }
        > = [];
        batch.forEach(({ img, thumb }, i) => {
          const hint = [
            img.source === "x" ? "from X" : `from ${img.directive || "the web"}`,
            img.description
              ? `published caption/alt: ${img.description.slice(0, 220)}`
              : "",
          ].filter(Boolean).join(" · ");
          content.push({ type: "input_text", text: `IMAGE ${i + 1} (${hint})` });
          content.push({
            type: "input_image",
            image_url: `data:image/jpeg;base64,${thumb}`,
            detail: "low",
          });
        });
        content.push({ type: "input_text", text: `Review all ${batch.length} images now.` });

        const response = await client.responses.create(
          {
            model: VISION_MODEL,
            instructions: system,
            input: [{ role: "user", content }],
            tools: [REVIEW_TOOL],
            tool_choice: { type: "function", name: "submit_image_reviews" },
            max_output_tokens: 2_000,
            store: false,
          },
          { signal: AbortSignal.timeout(Math.min(remaining - 2_000, 60_000)) },
        );
        const call = response.output.find(
          (item) => item.type === "function_call" && item.name === "submit_image_reviews",
        );
        const reviews = call?.type === "function_call"
          ? (JSON.parse(call.arguments) as { reviews?: Review[] }).reviews
          : undefined;
        if (!Array.isArray(reviews)) return;
        for (const r of reviews) {
          const item = batch[Number(r.index) - 1];
          if (!item) continue;
          verdicts.set(item.img.id, {
            index: r.index,
            keep: Boolean(r.keep),
            description:
              typeof r.description === "string" ? r.description.trim() : "",
          });
        }
      } catch (err) {
        console.error(
          `[gf-curate] batch ${bi} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    });

    // 3) Apply: drop the judged-irrelevant, rewrite kept descriptions.
    let dropped = 0;
    const out: StoryImage[] = [];
    for (const img of images) {
      const v = verdicts.get(img.id);
      if (!v) {
        out.push(img); // unreviewed (unfetchable / over budget / not a candidate)
        continue;
      }
      if (!v.keep) {
        dropped++;
        continue;
      }
      out.push(v.description ? { ...img, description: v.description } : img);
    }

    // Never curate a story into an empty gallery — if the verdicts wiped
    // everything, fall back to the first few originals (web-first order).
    if (out.length === 0) {
      console.error("[gf-curate] all images dropped — keeping first 6 originals");
      return images.slice(0, 6);
    }
    console.error(
      `[gf-curate] reviewed ${verdicts.size}/${images.length}, dropped ${dropped}, ${(
        (Date.now() - started) / 1000
      ).toFixed(1)}s`,
    );
    return out;
  } catch (err) {
    console.error(
      "[gf-curate] pass failed, returning originals:",
      err instanceof Error ? err.message : err,
    );
    return images;
  }
}
