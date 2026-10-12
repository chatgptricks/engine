
/**
 * System prompt for the story chat — the chat that lives beside a story's
 * gallery. Two blocks: the static persona/rules (marked ephemeral so the API
 * caches it across requests), then the per-story context, placed after the
 * cache breakpoint so it never invalidates the cached prefix.
 */

/** Trimmed story context the client sends — everything the chat needs,
 * nothing heavy (no data-URL uploads, no full image records). */
export interface ChatStoryContext {
  id: string;
  title: string;
  description?: string;
  postType?: string;
  alignment?: string;
  alignmentNote?: string;
  techOvert?: boolean;
  channelName?: string;
  captionDraft: string;
  captionEdited?: string | null;
  dossier?: {
    verificationStatus?: string;
    verifiedFacts?: Array<{
      fact: string;
      sources?: Array<{ name: string; url: string }>;
    }>;
    contestedPoints?: Array<{ claim: string; handling: string }>;
    primarySources?: Array<{ name: string; url: string }>;
  };
  images?: Array<{
    id: string;
    source: string;
    description?: string;
    directive?: string;
    /** http(s) URL — lets curate_images LOOK at the image. Omitted for
     * data-URL uploads (heavy, and the curator's own media is never judged). */
    url?: string;
  }>;
  selectedImageIds?: string[];
}

const PERSONA = `You are the story chat assistant inside Engine, the Instagram story studio. You sit beside one story's image gallery and help the curator finish it: answering questions from the dossier, refining the caption, pulling in more images, and spinning up further research.

Voice and editorial rules (the page's DNA — hold them in everything you draft):
- Calm, flat, declarative, unhurried. No hype, no exclamation marks, no em dashes (use commas or periods).
- Captions are 90 to 140 words, paste-ready, every hard fact traceable to a dossier source. Count the words before submitting a caption.
- Never invent facts. If the dossier doesn't support a claim and you haven't verified it with web_search just now, say so plainly.
- The reader does the connecting work. Don't explain the synthesis out loud.

Your tools, and when to reach for them:
- web_search — verify or extend facts, answer questions the dossier can't, check recency. Cite what you find in your reply.
- update_caption — rewrite or edit the caption. Call it with the FULL final caption text (it replaces the whole draft). Use it whenever the curator asks for any caption change; don't just print the caption in chat.
- find_x_images — search X/Twitter for real photos, screenshots, and memes matching a precise query. New images land in this story's gallery automatically.
- harvest_page_images — pull the real images off a specific web page (Wikimedia category, museum gallery, press kit, article). Use when you or the curator identify a promising page, including pages you found via web_search.
- curate_images — review the story's CURRENT image pool with vision: every image gets looked at, off-topic ones are removed, and each kept image gets a truthful ~20-word description. Use when the curator says the gallery has junk, wants it cleaned up, or wants real descriptions.
- start_research — kick off a full autonomous research run for a NEW related story (it appears on the Home grid, separate from this one). Use only when the curator wants a new story, not more depth on this one; depth happens right here with web_search.

Operating style: conversational and brief (2 to 5 sentences unless drafting). Act, then confirm what you did in a short line. When a request is ambiguous between editing THIS story and starting a NEW one, ask one short clarifying question.`;

export function buildChatSystem(
  story: ChatStoryContext,
  today: string,
): string {
  const facts = (story.dossier?.verifiedFacts ?? [])
    .map(
      (f, i) =>
        `${i + 1}. ${f.fact}${
          f.sources?.length
            ? ` [${f.sources.map((s) => `${s.name} — ${s.url}`).join("; ")}]`
            : ""
        }`,
    )
    .join("\n");
  const contested = (story.dossier?.contestedPoints ?? [])
    .map((c) => `- ${c.claim} (handling: ${c.handling})`)
    .join("\n");
  const sources = (story.dossier?.primarySources ?? [])
    .map((s) => `- ${s.name}: ${s.url}`)
    .join("\n");
  const selected = new Set(story.selectedImageIds ?? []);
  const images = (story.images ?? [])
    .slice(0, 80)
    .map(
      (im) =>
        `- ${im.id}${selected.has(im.id) ? " [in carousel]" : ""} (${im.source}) ${(
          im.description ||
          im.directive ||
          ""
        ).slice(0, 90)}`,
    )
    .join("\n");

  const context = `Today is ${today}.

THE STORY YOU ARE WORKING ON
Title: ${story.title}
${story.description ? `Summary: ${story.description}\n` : ""}Type: ${story.postType ?? "untyped"} · Alignment: ${story.alignment ?? "unset"}${story.techOvert ? " · tech-overt" : ""}${story.channelName ? ` · Channel: ${story.channelName}` : ""}

CURRENT CAPTION ${story.captionEdited != null ? "(curator-edited)" : "(draft)"}:
${story.captionEdited ?? story.captionDraft ?? "(none yet)"}

VERIFIED FACTS:
${facts || "(none recorded)"}
${contested ? `\nCONTESTED POINTS:\n${contested}` : ""}
${sources ? `\nPRIMARY SOURCES:\n${sources}` : ""}

IMAGE POOL (${story.images?.length ?? 0} images, ${selected.size} selected for the carousel):
${images || "(empty)"}`;

  return `${PERSONA}\n\n${context}`;
}
