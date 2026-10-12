import type { StoryImage } from "./types";

/**
 * Server-only Apify helpers. X/Twitter is the one source we use Apify for:
 * The research engine already covers the open web, and Pinterest skews toward AI
 * images. X is where the real screenshots and memes live.
 *
 * Needs APIFY_TOKEN. Returns [] (best-effort) when unset or on any failure.
 */

let counter = 0;

export async function searchXImages(
  term: string,
  max = 24,
): Promise<StoryImage[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token || !term.trim()) return [];
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?timeout=120&maxItems=${max}&clean=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          searchTerms: [term.trim()],
          maxItems: max,
          onlyImage: true,
          sort: "Top",
          tweetLanguage: "en",
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!res.ok) return [];
    const tweets = (await res.json()) as Record<string, unknown>[];
    if (!Array.isArray(tweets)) return [];

    const out: StoryImage[] = [];
    const seen = new Set<string>();
    for (const t of tweets) {
      const author = (t.author as { userName?: string } | undefined)?.userName;
      const handle = author ? `X · @${author}` : "X";
      const tweetUrl =
        (typeof t.twitterUrl === "string" && t.twitterUrl) ||
        (typeof t.url === "string" && t.url) ||
        undefined;
      const text = String(
        (typeof t.fullText === "string" && t.fullText) ||
          (typeof t.text === "string" && t.text) ||
          "",
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);

      const ext = t.extendedEntities as
        | { media?: Array<{ type?: string; media_url_https?: string }> }
        | undefined;
      let urls: string[] = Array.isArray(ext?.media)
        ? ext!.media
            .filter((m) => m?.type === "photo" && m?.media_url_https)
            .map((m) => String(m.media_url_https))
        : [];
      if (urls.length === 0 && Array.isArray(t.media)) {
        urls = (t.media as unknown[])
          .filter((u): u is string => typeof u === "string")
          .filter((u) => /pbs\.twimg\.com\/media\//.test(u));
      }
      for (const u of urls) {
        const big =
          /pbs\.twimg\.com\/media\//.test(u) && !/[?&]name=/.test(u)
            ? `${u}${u.includes("?") ? "&" : "?"}name=large`
            : u;
        if (seen.has(big)) continue;
        seen.add(big);
        counter += 1;
        out.push({
          id: `ximg_${Date.now().toString(36)}_${counter}`,
          url: big,
          source: "x",
          kind: "real_subject",
          directive: handle,
          width: 0,
          height: 0,
          rightsNote: "From X — confirm rights before posting.",
          cosmosManual: false,
          sourceUrl: tweetUrl || undefined,
          description: text || `Posted on X${author ? ` by @${author}` : ""}.`,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}
