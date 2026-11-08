/**
 * The designer: turns the approved outline, the copy, the charts, the photos
 * and the real X posts into one editable deck in the page's template, and
 * saves it in the workspace. Every layer stays native and editable: text in
 * the template's own styles, charts and photos in photo slots, post cards
 * filled from the real posts word for word.
 */
import { randomUUID } from "node:crypto";
import { AgentDeckValidationError, createAgentDeck } from "../../template-editor/agent-decks";
import { applyGuideToDeck } from "../../template-editor/guide-template";
import { checkLibrarySaveBudget } from "../../template-editor/library-budget";
import { formatDimensions, parseLibrary, X_BADGES, X_CARD, type CanvasElement, type DesignComment, type DesignDocument, type DesignTemplate, type ImageElement } from "../../template-editor/model";
import { getEditorLibrary, LibraryConflictError, saveEditorLibrary } from "../../template-editor/persistence";
import { imageSize } from "../image-size";
import type { PageProfile } from "../page-profiles";
import { chartAltText, chartPngDataUrl } from "../recreate-chart";
import type { ChartData } from "../recreate-data";
import { formatReactionMeta, mediaBadge, packReactions, reactionBadge, reactionPhotoSizes, reactionSlots, type XReaction } from "../x-reactions";
import { RecreateError } from "./claude";
import { chartSources, resolveChart } from "./charts";
import { need, outputOf, type StageRunner } from "./context";
import { pairedPages, templatePages } from "./pages";
import { photoSize } from "./research";
import { spanPairs } from "../../template-editor/spanning-photos";
import type { Approval, ChartsOutput, CopyOutput, DataOutput, DeckOutput, FactCheck, Facts, ImagesOutput, ReactionsOutput, WrittenChart } from "./schemas";

const ACCENT = "#00D98A";
export const MAX_DECK_SLIDES = 20;
const MAX_IMAGE_URL = 2_000_000;

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** House formatting applied in code, so it holds even when a writer slips. */
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
export function editorUrl(id: string) {
  const frontend = process.env.ENGINE_FRONTEND_URL;
  return `${frontend ? frontend.replace(/\/$/, "") + "/" : "/admin/engine"}?design=${encodeURIComponent(id)}`;
}
const usableImage = (url: string) => url.length <= MAX_IMAGE_URL && (/^https:\/\/\S+$/i.test(url) || /^data:image\//.test(url));

export type AssembledSlide = {
  templatePage: number;
  texts: { slot: string; text: string }[];
  chart?: { chart: WrittenChart; source?: string } | null;
  /** On the first slide of a photo pair, `seam` is the share of the photo on that slide. `size` is the photo's own size when it is known (otherwise it is
   * measured), and `fit: "contain"` shows all of it, for a chart or screenshot cut from an original slide. */
  photo?: { url: string; alt: string; credit?: string; sourceUrl?: string; seam?: number; size?: { width: number; height: number }; fit?: "contain" } | null;
  /** The photo a person should add when none was placed. */
  photoBrief?: string;
  /** Real posts for a Reaction page. They go on as many Reaction pages as they need: one long
   * post, two medium ones or three short ones a page, each card as tall as its post. */
  reactions?: XReaction[];
  /** Index in the approved outline, so critics can map deck pages back to it. */
  slide?: number;
};
export type AssembledPage = { pageId: string; templatePage: number; slide: number };
export type AssembleInput = {
  profile: PageProfile;
  template: DesignTemplate;
  templates: DesignTemplate[];
  id?: string;
  name: string;
  caption: string;
  slides: AssembledSlide[];
  factChecks?: FactCheck[];
  notes?: string[];
  chartData?: ChartData;
  signal?: AbortSignal;
  /** A first comment on the deck, such as where its working file is. */
  credit?: string;
};

/** Draws each post card as X shows that account: its check mark (blue, gold for organizations,
 * grey for governments, none when unverified), a round or, for organizations, rounded-square
 * profile photo, and the post's photo under its text at the size the page leaves (whole). */
export function styleCards(elements: CanvasElement[], posts: XReaction[], pixels: number, imagesPlaced = true) {
  const sizes = reactionPhotoSizes(posts);
  posts.forEach((post, n) => {
    const suffix = n ? `-${n + 1}` : "", find = (part: string) => elements.find(element => element.slot === `reaction-${part}${suffix}`);
    const badge = find("badge"), avatar = find("avatar"), media = find("media"), kind = reactionBadge(post), size = sizes[n];
    if (badge?.type === "shape") {
      badge.hidden = !kind;
      if (kind) {
        const look = X_BADGES[kind];
        Object.assign(badge, { path: look.path, fill: look.fill });
        if ("gradient" in look) badge.gradient = look.gradient; else delete badge.gradient;
      }
    }
    if (avatar?.type === "image") avatar.radius = post.author.square ? avatar.width * .113 : avatar.width / 2;
    if (media?.type === "image") {
      const shown = Boolean(imagesPlaced && post.media && size && media.src === post.media.url);
      media.hidden = !shown;
      if (shown) Object.assign(media, { width: size!.width / pixels, height: size!.height / pixels, intrinsicWidth: post.media!.width, intrinsicHeight: post.media!.height, fit: "cover", cropX: 50, cropY: 50, publicAlt: `${post.media!.kind === "video" ? "Video" : post.media!.kind === "gif" ? "GIF" : "Photo"} in @${post.author.handle}'s post` });
      styleMediaBadges(find, shown ? media : null, post, pixels);
    }
  });
}

/** A video's poster frame gets X's play button in its middle and its length in the lower left
 * corner, a GIF gets "GIF" there; both follow the frame's top, so they move with the card. */
function styleMediaBadges(find: (part: string) => CanvasElement | undefined, media: ImageElement | null, post: XReaction, pixels: number) {
  const play = find("play"), length = find("length"), label = find("length-text"), badge = media && mediaBadge(post.media);
  if (play) {
    play.hidden = !media || post.media?.kind !== "video";
    if (media && !play.hidden) Object.assign(play, { x: media.x + (media.width - play.width) / 2, smartFlow: { after: media.slot!, edge: "top", gap: (media.height - play.height) / 2, bottom: play.smartFlow?.bottom ?? 480 } });
  }
  for (const layer of [length, label]) {
    if (!layer) continue;
    layer.hidden = !badge;
    if (!badge || !media) continue;
    const { inset, height } = X_CARD.length;
    Object.assign(layer, { x: media.x + inset / pixels, width: badge.width / pixels, height: height / pixels, smartFlow: { after: media.slot!, edge: "top", gap: media.height - (inset + height) / pixels, bottom: layer.smartFlow?.bottom ?? 480 } });
    if (layer.type === "text") { layer.text = badge.label; delete layer.richText; }
  }
}

export async function assembleDeck(input: AssembleInput): Promise<{ document: DesignDocument; notes: string[]; pages: AssembledPage[] }> {
  const { profile, template } = input;
  const catalog = templatePages(template), counts = new Set(catalog.filter(page => page.cards).map(page => page.cards)), most = Math.max(0, ...counts);
  const noFinalPeriods = profile.format?.noFinalPeriods ?? true, notes = [...(input.notes ?? [])];
  const chosen = input.slides.flatMap((slide, index) => {
    const page = catalog.find(candidate => candidate.index === slide.templatePage);
    if (!page) {
      notes.push(`Skipped a slide that used page ${slide.templatePage}, which this template doesn't have.`);
      return [];
    }
    const at = slide.slide ?? index;
    if (!page.cards) return [{ slide, page, posts: [] as XReaction[], index: at, continued: false }];
    // Posts go on the Reaction page with as many cards as they fill; what doesn't fit continues on another.
    const groups = packReactions(slide.reactions ?? [], most).flatMap(group => counts.has(group.length) ? [group] : group.map(post => [post]));
    const pages = groups.flatMap(group => {
      const target = catalog.find(candidate => candidate.cards === group.length);
      return target ? [{ slide, page: target, posts: group, index: at, continued: false }] : [];
    }).map((item, n) => ({ ...item, continued: n > 0 }));
    if (!pages.length) notes.push(`Skipped a slide on the ${page.label} page: it shows real posts from X, which this run didn't fetch.`);
    else if (pages.length > 1) notes.push(`The posts on slide ${at + 1} didn't fit one page at full size, so they continue on ${pages.length - 1 === 1 ? "the next page" : `the next ${pages.length - 1} pages`}.`);
    return pages;
  });
  // Pages added for posts that didn't fit go first, so the closing slides stay.
  let dropped = 0;
  for (let index = chosen.length - 1; index >= 0 && chosen.length > MAX_DECK_SLIDES; index--) if (chosen[index].continued) { dropped += chosen[index].posts.length; chosen.splice(index, 1); }
  if (dropped) notes.push(`Left out ${dropped} post${dropped === 1 ? "" : "s"} from X: Engine decks hold at most ${MAX_DECK_SLIDES} slides.`);
  if (chosen.length > MAX_DECK_SLIDES) notes.push(`Kept the first ${MAX_DECK_SLIDES} slides; Engine decks hold at most ${MAX_DECK_SLIDES}.`);
  // Pages that share one photo only work as two slides in a row; a lone half becomes a one-slide photo page.
  const kept = chosen.slice(0, MAX_DECK_SLIDES), paired = pairedPages(kept.map(item => ({ page: item.page, chart: Boolean(item.slide.chart) })), catalog);
  const placed = kept.flatMap((item, index) => {
    const page = paired[index];
    if (page === item.page) return [item];
    notes.push(page ? `A slide on the ${item.page.label} page didn't have the page that shares its photo next to it, so it became a ${page.label} slide.` : `Skipped a slide on the ${item.page.label} page: the page that shares its photo isn't next to it.`);
    return page ? [{ ...item, page }] : [];
  });
  if (!placed.length) throw new RecreateError("Claude didn't produce any slides for this template. Try again.", 502);

  const prepared = placed.map(item => {
    const names = new Set(item.page.text.map(slot => slot.slot));
    const texts = item.slide.texts.filter(entry => {
      if (names.has(entry.slot)) return true;
      // An empty slot the page doesn't have, like a source on a Reaction page, needs no note.
      if (entry.text.trim()) notes.push(`Ignored text for unknown slot "${entry.slot}" on a ${item.page.label} slide.`);
      return false;
    }).map(entry => ({ slot: entry.slot, ...emphasis(cleanSlideText(entry.text, noFinalPeriods)) }));
    for (const slot of item.page.text) if (!texts.some(entry => entry.slot === slot.slot)) texts.push({ slot: slot.slot, text: "" });
    const cards: Record<string, string> = Object.assign({}, ...item.posts.map((post, n) => reactionSlots(post, { card: n + 1 })));
    const photoSlot = item.page.photo[0]?.slot;
    const photo = !item.slide.chart && photoSlot && item.slide.photo && usableImage(item.slide.photo.url) ? item.slide.photo : null;
    return { ...item, texts, cards, photoSlot, photo };
  });
  // A photo across two slides keeps its own proportions, so its frame takes the photo's size.
  const sizes = await Promise.all(prepared.map(item => item.page.pair?.part === "start" && item.photo ? item.photo.size ?? photoSize(item.photo.url, input.signal ?? new AbortController().signal) : null));

  const id = input.id ?? `recreate-${randomUUID()}`;
  const build = (withImages: boolean) => createAgentDeck({
    id, name: input.name.trim().slice(0, 200) || "Recreated post", templateId: template.id,
    caption: cleanSlideText(input.caption, false).slice(0, 20_000),
    slides: prepared.map((item, index) => {
      const slots: Record<string, string> = Object.fromEntries(item.texts.map(entry => [entry.slot, entry.text]));
      for (const [slot, value] of Object.entries(item.cards)) if (withImages || !/^reaction-(?:avatar|media)/.test(slot)) slots[slot] = value;
      if (withImages && item.photo && item.photoSlot) slots[item.photoSlot] = item.photo.url;
      const size = sizes[index], seam = item.photo?.seam;
      const across = withImages && item.photo && item.page.pair?.part === "start" ? { ...(size ? { photoSize: size } : {}), ...(seam !== undefined ? { seam } : {}) } : {};
      return { templatePage: item.page.index, slots, ...across };
    }),
  }, input.templates);
  let document: DesignDocument, imagesPlaced = true;
  try {
    document = build(true);
  } catch (error) {
    if (!(error instanceof AgentDeckValidationError)) throw error;
    try {
      // A photo Engine won't take must not cost the whole post.
      document = build(false);
      notes.push(`The photos couldn't be placed (${error.message}); add them by hand.`);
      for (const item of prepared) item.photo = null;
      imagesPlaced = false;
    } catch (again) {
      if (again instanceof AgentDeckValidationError) throw new RecreateError(`The deck couldn't be built: ${again.message}`, 502);
      throw again;
    }
  }

  const { width } = formatDimensions(document), pixels = width / 360, now = new Date().toISOString(), comments: DesignComment[] = [];
  const comment = (text: string, pageId = document.pages[0].id) => comments.push({ id: randomUUID(), pageId, text: text.slice(0, 2000), createdAt: now });
  if (input.credit) comment(input.credit);
  const frameOf = (index: number) => {
    const slot = prepared[index].photoSlot;
    return slot ? document.pages[index].canvas?.elements.find(element => element.slot === slot) : undefined;
  };
  // A frame that takes its photo's shape (smartFlow.media) needs the photo's size; one that
  // can't be measured keeps the frame's own shape and crops the photo into it, as before.
  const photoSizes = await Promise.all(prepared.map((item, index) => {
    const frame = frameOf(index);
    // A photo's known size is used as it is: a data URL (a picture cut from an original slide) can't be measured over the network.
    return item.photo && frame?.type === "image" && frame.smartFlow?.media ? item.photo.size ?? imageSize(item.photo.url, input.signal) : null;
  }));
  for (const [index, item] of prepared.entries()) {
    const page = document.pages[index], elements = page.canvas?.elements ?? [];
    const find = (slot: string) => elements.find(element => element.slot === slot);
    for (const entry of item.texts) {
      if (!entry.richText) continue;
      const element = find(entry.slot);
      if (element?.type === "text") element.richText = entry.richText;
    }
    const frame = frameOf(index);
    let filled = false;
    if (item.slide.chart && frame) {
      try {
        const chart = await resolveChart(item.slide.chart.chart, input.chartData ?? new Map(), input.signal);
        const background = page.canvas?.background;
        // The chart is drawn at the frame's size (a frame that takes its media's shape keeps the chart's).
        const [chartWidth, chartHeight] = [frame.width * pixels, frame.height * pixels].map(value => Math.max(200, Math.round(value)));
        const src = await chartPngDataUrl(chart, chartWidth, chartHeight, background && background.startsWith("#") ? { background } : {});
        const alt = chartAltText(chart, chartSources(item.slide.chart.chart));
        if (frame.type === "image") { frame.src = src; frame.fit = "contain"; frame.publicAlt = alt; frame.intrinsicWidth = 2 * chartWidth; frame.intrinsicHeight = 2 * chartHeight; }
        else if (frame.type === "shape") frame.imageFill = { ...(frame.imageFill ?? { objectFit: "contain", cropX: 50, cropY: 50 }), src, objectFit: "contain" };
        filled = true;
      } catch (error) {
        if (input.signal?.aborted) throw error;
        notes.push(`Slide ${index + 1}: the chart couldn't be drawn (${message(error)}); add it by hand.`);
      }
    } else if (item.photo && frame) {
      const size = photoSizes[index];
      if (frame.type === "image") {
        frame.publicAlt = item.photo.alt.slice(0, 2000);
        if (size) { frame.intrinsicWidth = size.width; frame.intrinsicHeight = size.height; }
        if (item.photo.fit) frame.fit = item.photo.fit;
      }
      const credit = [item.photo.credit, item.photo.sourceUrl].filter(Boolean).join(", ");
      if (credit) comment(`Photo: ${credit}`, page.id);
      filled = true;
    }
    // A frame that fills the space under the copy would only show the grey placeholder: it is
    // hidden, so the copy is centred on the page instead. Showing the layer again brings it back.
    const hidden = Boolean(frame && !filled && frame.smartFlow?.resize);
    if (hidden) frame!.hidden = true;
    const brief = item.slide.photoBrief?.trim();
    if (frame && !filled && (brief || hidden)) comment(`${brief ? `Photo to add: ${brief}` : "No photo or chart for this slide yet"}${hidden ? ". The empty photo frame is hidden; show it in Layers to add one" : ""}`, page.id);
    if (item.posts.length) {
      styleCards(elements, item.posts, pixels, imagesPlaced);
      comment(`Real posts from X, word for word:\n${item.posts.map(post => `@${post.author.handle}${formatReactionMeta(post, profile.language) ? ` (${formatReactionMeta(post, profile.language)})` : ""}: ${post.url}`).join("\n")}`, page.id);
    }
  }
  // The template's fixed lines are English; a page in another language has its own.
  const fixedLines: [string, string][] = [["SWIPE FOR MORE", profile.swipeText], ["FOLLOW THIS PAGE", profile.followCta.line1]];
  for (const page of document.pages) for (const element of page.canvas?.elements ?? []) {
    if (element.type !== "text" || element.templateRole !== "brand") continue;
    const swap = fixedLines.find(([english, own]) => element.text === english && own?.trim() && own !== english);
    if (swap) { element.text = swap[1]; delete element.richText; }
  }
  if (input.factChecks?.length) {
    const lines = input.factChecks.map(check => `${check.verdict.toUpperCase()}: ${check.claim}. ${check.detail}${check.sources[0] ? ` (${check.sources[0].title}: ${check.sources[0].url})` : ""}`);
    comment(`Fact check\n${lines.join("\n")}`);
  }
  if (notes.length) comment(`Notes from Recreate\n${notes.map(note => `• ${note}`).join("\n")}`);
  // A photo across two slides is described the same on both.
  for (const pair of spanPairs(document)) if (pair.start.publicAlt) pair.end.publicAlt = pair.start.publicAlt;
  document.comments = [...(document.comments ?? []), ...comments];
  document.tags = [...new Set([...(document.tags ?? []), "recreated", profile.id])].slice(0, 20);
  return { document, notes, pages: prepared.map((item, index) => ({ pageId: document.pages[index].id, templatePage: item.page.index, slide: item.index })) };
}

type Saved = { saved: DesignDocument; copy?: boolean } | { saved: null; held: string; current?: DesignDocument };
const REBUILT = " (rebuilt)";
const rebuiltName = (name: string) => (name.endsWith(REBUILT) ? name.slice(0, -REBUILT.length) : name).slice(0, 120 - REBUILT.length) + REBUILT;
/**
 * Saves a new deck at the top of the library. With `replace`, it swaps in a
 * rebuilt version of a deck Engine saved before. When that deck changed since
 * `savedAt` (a person edited it, or the editor re-fitted its text when it was
 * opened), their version stays and the rebuild is saved next to it as a new
 * deck (`copy`), named "… (rebuilt)" from then on. A deck in Trash is left
 * alone and the rebuild is held.
 */
export async function saveDeck(ownerKey: string, document: DesignDocument, replace?: { savedAt: string }): Promise<Saved> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const stored = await getEditorLibrary(ownerKey), designs = stored.library.designs;
    const existing = designs.find(item => item.id === document.id);
    let candidate: DesignDocument = document, list: DesignDocument[];
    if (replace && existing) {
      if (existing.deletedAt) return { saved: null, held: "The post is in Trash, so the rebuilt version wasn't saved." };
      if (existing.updatedAt !== replace.savedAt) {
        const copy = await saveDeck(ownerKey, { ...document, id: `recreate-${randomUUID()}`, name: rebuiltName(document.name) });
        return copy.saved ? { saved: copy.saved, copy: true } : copy;
      }
      // A fix round saving over a rebuilt copy keeps it named apart from the person's version.
      candidate = { ...document, ...(existing.name.endsWith(REBUILT) ? { name: rebuiltName(document.name) } : {}), createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
      for (const key of ["folderId", "favorite"] as const) if (existing[key] !== undefined) Object.assign(candidate, { [key]: existing[key] });
      list = designs.map(item => item.id === document.id ? candidate : item);
    } else {
      // A new deck, or one that was deleted for good: it goes back at the top.
      list = [document, ...designs.filter(item => item.id !== document.id)];
    }
    const next = parseLibrary({ ...stored.library, designs: list });
    if (!next) throw new RecreateError("The new post doesn't fit Engine's workspace limits (for example the 150-design limit). Empty Trash or delete old drafts, then retry.", 413);
    const budget = checkLibrarySaveBudget(next);
    if (!budget.ok) throw new RecreateError(budget.error, 413);
    try {
      const saved = await saveEditorLibrary(ownerKey, next, stored.revision, randomUUID());
      const result = saved.library.designs.find(item => item.id === document.id);
      if (!result) throw new RecreateError("Engine saved the workspace but couldn't find the new post. Reload the library.", 500);
      return { saved: result };
    } catch (error) {
      if (!(error instanceof LibraryConflictError) || attempt === 3) throw error;
    }
  }
  throw new RecreateError("The workspace is busy. Retry in a moment.", 409);
}

/** Adds comments to a saved deck (the critics' report). A deck that was deleted is left alone. */
export async function commentOnDeck(ownerKey: string, deckId: string, texts: string[]): Promise<boolean> {
  if (!texts.length) return true;
  for (let attempt = 0; attempt < 4; attempt++) {
    const stored = await getEditorLibrary(ownerKey), designs = stored.library.designs;
    const existing = designs.find(item => item.id === deckId);
    if (!existing || existing.deletedAt || !existing.pages.length) return false;
    const now = new Date().toISOString();
    const added = texts.map((text): DesignComment => ({ id: randomUUID(), pageId: existing.pages[0].id, text: text.slice(0, 2000), createdAt: now }));
    const next = parseLibrary({ ...stored.library, designs: designs.map(item => item.id === deckId ? { ...item, comments: [...(item.comments ?? []), ...added].slice(-200) } : item) });
    if (!next) return false;
    try {
      await saveEditorLibrary(ownerKey, next, stored.revision, randomUUID());
      return true;
    } catch (error) {
      if (!(error instanceof LibraryConflictError) || attempt === 3) throw error;
    }
  }
  return false;
}

export async function loadDeck(ownerKey: string, deckId: string): Promise<DesignDocument | null> {
  const { library } = await getEditorLibrary(ownerKey);
  const found = library.designs.find(item => item.id === deckId);
  return found && !found.deletedAt ? found : null;
}

export const deck: StageRunner = async context => {
  const { file, profile, template, templates } = context;
  const approval = need<Approval>(file, "approval"), written = need<CopyOutput>(file, "copy");
  const facts = outputOf<Facts>(file, "facts"), data = outputOf<DataOutput>(file, "data"), built = outputOf<ChartsOutput>(file, "charts");
  const images = outputOf<ImagesOutput>(file, "images"), posts = outputOf<ReactionsOutput>(file, "reactions")?.reactions ?? [];
  const previous = context.previous as DeckOutput | undefined;
  const notes = [...written.notes, ...(images?.notes ?? [])];
  if (written.slides.length !== approval.outline.slides.length) notes.push(`The copy has ${written.slides.length} slides for an outline of ${approval.outline.slides.length}; they were matched in order.`);
  const slides = approval.outline.slides.map((slide, index): AssembledSlide => {
    const words = written.slides[index];
    const check = slide.chartId ? built?.charts.find(item => item.id === slide.chartId) : undefined;
    const spec = slide.chartId ? data?.charts.find(item => item.id === slide.chartId) : undefined;
    if (check && !check.ok) notes.push(`Slide ${index + 1}: the chart couldn't be drawn (${check.error}); add it by hand.`);
    const photo = images?.photos.find(item => item.slide === index);
    return {
      templatePage: slide.templatePage, slide: index, texts: words?.texts ?? [],
      chart: spec && check?.ok !== false ? { chart: spec.chart, source: spec.source } : null,
      photo: photo ? { url: photo.url, alt: photo.alt, credit: photo.credit, sourceUrl: photo.sourceUrl, ...(photo.seam !== undefined ? { seam: photo.seam } : {}) } : null,
      photoBrief: slide.photo,
      reactions: slide.reactionIds.flatMap(id => posts.filter(post => post.id === id).slice(0, 1)),
    };
  });
  const assembled = await assembleDeck({
    profile, template, templates, id: previous?.deckId, name: written.name, caption: written.caption, slides,
    factChecks: facts?.claims ?? [], notes, chartData: context.cache.chartData, signal: context.signal,
    credit: `Made by Recreate for ${profile.name}. The team's working file is ${file.id}; agents can read it with engine_recreate_status.`,
  });
  // Decks from a guide's template get the guide's cover touches: gradient words, the remark and topic logos.
  if (context.guide) assembled.notes.push(...applyGuideToDeck(assembled.document, context.guide, { swipeText: profile.swipeText }));
  return saveBuiltDeck(context.ownerKey, assembled, previous);
};

/** Saves a built deck (a rebuild replaces the one Engine saved before) and returns the deck stage's output. */
export async function saveBuiltDeck(ownerKey: string, assembled: { document: DesignDocument; notes: string[]; pages: AssembledPage[] }, previous?: DeckOutput): Promise<{ output: DeckOutput }> {
  const result = await saveDeck(ownerKey, assembled.document, previous ? { savedAt: previous.savedAt } : undefined);
  if (!result.saved) {
    if (!previous) throw new RecreateError(result.held, 409);
    // The person's version stands; the review reads it as it is.
    return { output: { ...previous, held: result.held } satisfies DeckOutput };
  }
  const copied = result.copy ? [`The post changed after Engine saved it (it was edited, or opened and its text re-fitted), so that version stays as it is and this one was saved next to it as “${result.saved.name}”.`] : [];
  return {
    output: {
      deckId: result.saved.id, name: result.saved.name, slideCount: result.saved.pages.length, savedAt: result.saved.updatedAt,
      notes: [...copied, ...assembled.notes], pages: assembled.pages, held: "",
    } satisfies DeckOutput,
  };
}
