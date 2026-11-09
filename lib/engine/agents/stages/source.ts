/**
 * Stage 1, source (build step A), in both modes: imports the post (or reads
 * the uploaded screenshots), keeps its slides as private workspace images, and
 * makes one vision call over the slides, the caption and the post's details to
 * write the SourceNotes every later stage reads. An exact copy's design
 * rebuilds from its words and parts.
 *
 * The post's own details (author, format, date, caption, link and traction)
 * come from the import and win over the reading; uploads have no traction. A
 * rerun reads the kept slides again, and a retry after a failed reading in the
 * same run doesn't import the post twice. The stage hands back the post file's
 * source record (the slides' image ids, the caption, the slide count, the
 * author and the link), which the orchestrator merges in.
 *
 * Its role card is ../cards/source.ts; its helpers are ../source-notes.ts.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { downloadSlideImages, importInstagramPost, InstagramImportError, normalizeUploadedSlides } from "../../instagram-import";
import type { PostSource } from "../../post-files";
import { imageBlock, RecreateError, work, type SourceImage } from "../claude";
import { rerunNote, today, type RunCache, type StageContext, type StageRunner } from "../context";
import { stagePrompt } from "../playbook";
import { SourceNotesSchema } from "../schemas";
import { fitForClaude, keepSourceImages, loadSourceImages } from "../source";
import {
  describeDetails, importedDetails, keptDetails, missingSlides, normalizeSourceNotes, skippedSlides, slideLabel, sourceRules, SUBMIT_NOTES,
  uploadedDetails, type PostDetails,
} from "../source-notes";

/** The post's details for the slides a run holds in memory, so a retry after a failed reading doesn't import it again. */
const DETAILS = new WeakMap<RunCache, PostDetails>();
/** Room for every slide's words and parts, up to 20 slides, after Claude's thinking. */
const MAX_TOKENS = 64_000;
/** One reading, plus room to fix a hand-in that fails the schema or skips a slide. */
const MAX_TURNS = 4;

function importFailure(error: unknown): never {
  if (error instanceof InstagramImportError) throw new RecreateError(error.message, error.status);
  throw error;
}
const forClaude = (image: SourceImage) => fitForClaude({ mediaType: image.mediaType, base64: image.base64 });

/** The post imported now: the uploaded screenshots when there are any, else its link through Apify. */
async function importOriginal(context: StageContext): Promise<{ images: SourceImage[]; details: PostDetails }> {
  const { file, cache, signal } = context, link = file.source.url?.trim() || undefined;
  if (cache.uploads?.length) {
    // The bytes decide each screenshot's type; the declared data-URL type is never trusted.
    const { images } = await normalizeUploadedSlides(cache.uploads.map(upload => ({ data: upload.dataUrl, name: upload.name }))).catch(importFailure);
    return { images: await Promise.all(images.map(forClaude)), details: uploadedDetails(images.length, { link, caption: file.source.caption }) };
  }
  if (!link) throw new RecreateError("Paste an Instagram post link or upload the post's slides.");
  const post = await importInstagramPost(link, { signal }).catch(importFailure);
  const slides = await downloadSlideImages(post.slides, { signal }).catch(importFailure);
  if (!slides.length) throw new RecreateError("That post has no images Engine can read. Upload screenshots of its slides instead.");
  return { images: await Promise.all(slides.map(forClaude)), details: importedDetails(post, { link, caption: file.source.caption }) };
}

/**
 * The original's slides and details: kept from an earlier reading (a rerun),
 * held from this run's import (a retry), or imported now. Slides not kept yet
 * are saved as private workspace images.
 */
async function readOriginal(context: StageContext): Promise<{ images: SourceImage[]; details: PostDetails; imageIds: string[] }> {
  const { file, cache, ownerKey } = context, held = DETAILS.get(cache);
  if (file.source.imageIds.length) {
    const images = cache.images?.length === file.source.imageIds.length ? cache.images : await loadSourceImages(ownerKey, file.source.imageIds);
    cache.images = images;
    return { images, details: held ?? keptDetails(context.previous, file.source, images.length), imageIds: file.source.imageIds };
  }
  const imported = held && cache.images?.length ? { images: cache.images, details: held } : await importOriginal(context);
  cache.images = imported.images;
  DETAILS.set(cache, imported.details);
  return { ...imported, imageIds: await keepSourceImages(ownerKey, imported.images) };
}

export const source: StageRunner = async context => {
  const { file, profile } = context;
  const { images, details, imageIds } = await readOriginal(context);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.flatMap((image, index): Anthropic.Beta.BetaContentBlockParam[] => [{ type: "text", text: slideLabel(index + 1, details) }, imageBlock(image)]),
    { type: "text", text: [
      describeDetails(details),
      file.source.notes ? `TEAMMATE'S NOTES\n${file.source.notes}` : "",
      rerunNote(context),
    ].filter(Boolean).join("\n\n") },
  ];
  // The notes come in through a tool, not a structured answer: SourceNotesSchema is too big for the API to
  // compile into a grammar ("The compiled grammar is too large"). work() checks the hand-in against it instead.
  let asked = false;
  const read = await work({
    role: "source", what: "read the original post", content, maxTokens: MAX_TOKENS, maxTurns: MAX_TURNS,
    system: stagePrompt("source", file.mode, profile, sourceRules(today())), signal: context.signal, usage: context.usage,
    submit: {
      name: SUBMIT_NOTES, description: "Hand in your notes on the original post, once you have read every slide.", schema: SourceNotesSchema,
      // A skipped slide is asked for once; after that, the clean-up gives it an empty entry and a note.
      check: async notes => {
        const missing = asked ? [] : missingSlides(notes, images.length);
        if (!missing.length) return null;
        asked = true;
        return skippedSlides(missing);
      },
    },
  });
  if (!read.slides.length) throw new RecreateError("Claude read nothing on the original's slides. Try again.", 502);
  const output = normalizeSourceNotes(read, details, today());
  const { url, author, caption } = output.post, link = url ?? file.source.url;
  const record: Partial<PostSource> = { caption, slideCount: images.length, imageIds, ...(link ? { url: link } : {}), ...(author.handle ? { owner: author.handle } : {}) };
  return { output, source: record };
};
