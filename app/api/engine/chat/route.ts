import { after } from "next/server";
import { CHAT_MODEL, getOpenAI } from "@/lib/openai";
import { resolveEngineAccess } from "@/lib/engine/member";
import {
  buildChatSystem,
  type ChatStoryContext,
} from "@/lib/engine/chat-prompt";
import { searchXImages } from "@/lib/engine/apify";
import {
  curateImages,
  type CurationContext,
} from "@/lib/engine/image-curator";
import {
  imagesFromPage,
  payloadToStory,
  runResearchEngine,
} from "@/lib/engine/research-engine";
import { finishStory, upsertResearchingStub } from "@/lib/engine/db";
import { emptyCuration } from "@/lib/engine/types";
import type { Story, StoryImage } from "@/lib/engine/types";
import { POST_TYPE_IDS, postType } from "@/lib/engine/post-types";

export const runtime = "nodejs";
// Chat turns are quick, but a turn may spawn a research run via after().
export const maxDuration = 800;

/**
 * Engine — the story chat endpoint (SSE).
 *
 * Same agentic-loop shape as the consultations assistant: stream text deltas,
 * execute custom tools server-side, loop until end_turn. The twist: the
 * story's mutable state (caption, gallery) lives in the curator's browser, so
 * mutations are emitted as `action` events the client applies through the
 * store, and the model receives a tool_result confirming the application.
 *
 * Events: {type:"text",delta} · {type:"search",query} ·
 * {type:"action",action:"set_caption"|"add_images"|"research_started",...} ·
 * {type:"done"} · {type:"error",error}
 */

interface ChatRequest {
  story?: ChatStoryContext;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  /** The curator's (possibly edited) finder prompt, for start_research. */
  researchSystemPrompt?: string;
}

const CHAT_TOOLS = [
  {
    type: "web_search" as const,
  },
  {
    name: "update_caption",
    description:
      "Replace the story's caption with new text. Pass the COMPLETE final caption (90–140 words, flat declarative voice, no em dashes, no exclamation marks). The curator sees it land in their caption editor immediately.",
    input_schema: {
      type: "object",
      properties: {
        caption: { type: "string", description: "The full new caption text." },
      },
      required: ["caption"],
    },
  },
  {
    name: "find_x_images",
    description:
      "Search X/Twitter for real photos, screenshots, and memes matching a precise query. Found images are added to this story's gallery automatically. Use specific, visual queries (subject + context), not abstract phrases.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Precise visual search query." },
        count: {
          type: "number",
          description: "How many images to fetch (default 18, max 24).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "harvest_page_images",
    description:
      "Scrape the real images off one web page (Wikimedia Commons category, museum gallery, press kit, photo-rich article) and add them to this story's gallery. Prefer pages with many real photographs of the subject.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The page URL to harvest." },
      },
      required: ["url"],
    },
  },
  {
    name: "curate_images",
    description:
      "Review the story's CURRENT image pool with vision. Every image is looked at: off-topic ones (ads, sports, unrelated memes, charts of other things) are removed from the gallery, and each kept image gets a truthful ~20-word description of what it shows and how it ties to the story. Use when the curator wants the gallery cleaned up or real descriptions written. Takes no input.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "start_research",
    description:
      "Start a full autonomous research run for a NEW story (it appears on the Home grid as a researching card and fills in within a few minutes — separate from the story you are discussing). Use only when the curator wants a new story researched.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The research brief: the subject and angle to research end to end.",
        },
        postType: {
          type: "string",
          enum: POST_TYPE_IDS,
          description: "Optional Territory vein to file it under.",
        },
      },
      required: ["prompt"],
    },
  },
];

function xImageToStory(im: StoryImage): StoryImage {
  return im; // searchXImages already returns StoryImage
}

/** Story context for the vision curation pass. */
function curationCtx(story: ChatStoryContext): CurationContext {
  return {
    title: story.title,
    summary:
      story.description ||
      (story.captionEdited ?? story.captionDraft ?? "").slice(0, 200),
    facts: (story.dossier?.verifiedFacts ?? [])
      .slice(0, 6)
      .map((f) => `- ${f.fact}`)
      .join("\n"),
  };
}

export async function POST(request: Request) {
  const access = await resolveEngineAccess();
  if (!access) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const owner = access.ownerKey;

  const client = getOpenAI();
  if (!client) {
    return Response.json(
      { error: "The chat needs OPENAI_API_KEY." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as ChatRequest;
  const { story, messages = [] } = body;
  if (!story?.id || messages.length === 0) {
    return Response.json({ error: "Missing story or messages." }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = buildChatSystem(story, today);
  const conversation = messages.map((m) => ({
    role: m.role,
    content: m.content || " ",
  }));
  const tools = CHAT_TOOLS.map((tool) => tool.type === "web_search"
    ? { type: "web_search" as const }
    : {
        type: "function" as const,
        name: tool.name!,
        description: tool.description!,
        parameters: tool.input_schema!,
        strict: false,
      });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        let previousResponseId: string | undefined;
        let nextInput: typeof conversation | Array<{
          type: "function_call_output";
          call_id: string;
          output: string;
        }> = conversation;
        for (let turn = 0; turn < 6; turn++) {
          const responseStream = await client.responses.create({
            model: CHAT_MODEL,
            instructions: system,
            input: nextInput,
            previous_response_id: previousResponseId,
            tools,
            stream: true,
            store: true,
            max_output_tokens: 3_000,
          });
          let responseId: string | undefined;
          let calls: Array<{ type: "function_call"; name: string; arguments: string; call_id: string }> = [];
          for await (const event of responseStream) {
            if (event.type === "response.output_text.delta") {
              send({ type: "text", delta: event.delta.replace(/\s*[—–]\s*/g, ", ") });
            }
            if (event.type === "response.completed") {
              responseId = event.response.id;
              calls = event.response.output.filter(
                (item): item is typeof calls[number] => item.type === "function_call",
              );
            }
          }
          if (!responseId) throw new Error("Chat response ended before completion.");
          previousResponseId = responseId;
          if (calls.length === 0) {
            send({ type: "done" });
            break;
          }
          const outputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];
          for (const call of calls) {
            const output = await runChatTool(call, story, owner, body, send);
            outputs.push({ type: "function_call_output", call_id: call.call_id, output });
          }
          nextInput = outputs;
          if (turn === 5) send({ type: "done" });
        }
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Chat failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function runChatTool(
  call: { name: string; arguments: string },
  story: ChatStoryContext,
  owner: string,
  body: ChatRequest,
  send: (data: Record<string, unknown>) => void,
): Promise<string> {
  const input = JSON.parse(call.arguments || "{}") as Record<string, unknown>;

  if (call.name === "update_caption") {
    const caption = String(input.caption ?? "").trim();
    if (!caption) return "No caption text provided — nothing changed.";
    send({ type: "action", action: "set_caption", caption });
    const words = caption.split(/\s+/).length;
    return `Applied — the caption editor now shows your text (${words} words).`;
  }

  if (call.name === "find_x_images") {
    const query = String(input.query ?? "").trim();
    if (!query) return "No query provided.";
    const count = Math.min(Math.max(Number(input.count) || 18, 4), 24);
    if (!process.env.APIFY_TOKEN) {
      return "X image search isn't configured here (APIFY_TOKEN missing) — suggest the curator use 'More from X' on production, or harvest a specific page instead.";
    }
    const found = (await searchXImages(query, count)).map(xImageToStory);
    if (found.length === 0)
      return `No usable images found on X for "${query}". Try a more specific or differently-worded query.`;
    // Vision pass before they reach the gallery: off-topic results are
    // dropped, kept ones get a real ~20-word description.
    const images = await curateImages(found, curationCtx(story));
    if (images.length === 0)
      return `X returned ${found.length} results for "${query}" but none survived the vision relevance check — they were off-topic. Try a sharper query.`;
    send({ type: "action", action: "add_images", images });
    return `Added ${images.length} on-topic images from X (query: "${query}"${
      found.length > images.length
        ? `; ${found.length - images.length} off-topic results were dropped by the vision check`
        : ""
    }). They're visible to the curator now; duplicates are dropped automatically.`;
  }

  if (call.name === "harvest_page_images") {
    const url = String(input.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) return "Provide a full http(s) URL.";
    const { images: scraped, title } = await imagesFromPage(url);
    let host = "web";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* keep default */
    }
    const harvested: StoryImage[] = scraped.slice(0, 16).map((img, i) => ({
      id: `chat_${Date.now().toString(36)}_${i}`,
      url: img.url,
      source: "web",
      kind: "real_subject",
      directive: host,
      width: img.width,
      height: img.height,
      rightsNote: `From ${host} — confirm rights before posting.`,
      cosmosManual: false,
      sourceUrl: url,
      description: img.caption || img.alt || title || "",
    }));
    if (harvested.length === 0)
      return `Couldn't pull usable images from ${url} (JS-only page, no real <img> content, or unreachable). Try a different page.`;
    const images = await curateImages(harvested, curationCtx(story));
    if (images.length === 0)
      return `Pulled ${harvested.length} images from ${host} but none survived the vision relevance check — the page's images are off-topic for this story.`;
    send({ type: "action", action: "add_images", images });
    return `Harvested ${images.length} on-topic images from ${host} into the gallery${
      harvested.length > images.length
        ? ` (${harvested.length - images.length} off-topic ones dropped)`
        : ""
    }.`;
  }

  if (call.name === "curate_images") {
    const pool = (story.images ?? []).filter(
      (im) => im.url && /^https?:\/\//.test(im.url),
    );
    if (pool.length === 0)
      return "This story's pool has no reviewable web images (only uploads, or the client didn't send image URLs — ask the curator to reload).";
    // Rebuild minimal StoryImage records the curator can judge.
    const candidates: StoryImage[] = pool.map((im) => ({
      id: im.id,
      url: im.url as string,
      source: (im.source as StoryImage["source"]) ?? "web",
      kind: "real_subject",
      directive: im.directive ?? "",
      width: 0,
      height: 0,
      rightsNote: "",
      cosmosManual: false,
      description: im.description ?? "",
    }));
    const kept = await curateImages(candidates, curationCtx(story));
    const keptById = new Map(kept.map((im) => [im.id, im]));
    const removals = candidates
      .filter((im) => !keptById.has(im.id))
      .map((im) => im.id);
    const descriptions: Record<string, string> = {};
    for (const im of kept) {
      const before = candidates.find((c) => c.id === im.id);
      if (im.description && im.description !== before?.description)
        descriptions[im.id] = im.description;
    }
    if (removals.length === 0 && Object.keys(descriptions).length === 0)
      return `Reviewed ${pool.length} images — nothing to change (the pool may already be curated, or the images couldn't be fetched for review).`;
    send({ type: "action", action: "image_reviews", removals, descriptions });
    return `Reviewed ${pool.length} images with vision: removed ${removals.length} off-topic, wrote fresh ~20-word descriptions for ${Object.keys(descriptions).length}. The gallery updated for the curator. Summarize what was removed in one line if they ask.`;
  }

  if (call.name === "start_research") {
    const prompt = String(input.prompt ?? "").trim();
    if (!prompt) return "No research prompt provided.";
    const reqType = postType(
      typeof input.postType === "string" ? input.postType : undefined,
    );
    const id = `story_auto_${Date.now().toString(36)}_${Math.round(
      Math.random() * 1e6,
    ).toString(36)}`;
    const startedAt = new Date().toISOString();
    const title = reqType
      ? `Researching a new ${reqType.label} story…`
      : "Researching a new story…";
    const stub: Story = {
      id,
      status: "researching",
      title,
      description: "",
      postType: reqType?.id,
      researchCompletedAt: startedAt,
      leadImageId: "",
      techOvert: false,
      dossier: {
        verificationStatus: "partial",
        verifiedFacts: [],
        primarySources: [],
        contestedPoints: [],
      },
      caption: { draft: "", titleOverImage: { use: false, text: "" } },
      images: [],
      curation: emptyCuration(),
      brief: {
        prompt,
        attachments: [],
        createdAt: startedAt,
        requestedType: reqType?.id,
      },
    };
    const stored = await upsertResearchingStub(stub, owner);
    if (!stored) return "The story store rejected the stub — research not started.";
    const systemPrompt = body.researchSystemPrompt;
    after(async () => {
      try {
        const payload = await runResearchEngine({
          prompt,
          systemPrompt,
          requestedType: reqType?.id,
          deadlineMs: (maxDuration - 120) * 1000,
        });
        await finishStory(id, payloadToStory(id, payload, stub), owner);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Research failed.";
        await finishStory(id, { ...stub, status: "failed", error: message }, owner);
      }
    });
    send({ type: "action", action: "research_started", id, title });
    return `Research started (${reqType ? reqType.label + " vein" : "untyped"}). A researching card is appearing on the Home grid and will fill in within a few minutes. Tell the curator.`;
  }

  return `Unknown tool ${call.name}.`;
}
