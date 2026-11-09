/**
 * Stage 6, design (build step D): one Opus designer builds every slide of the
 * post in the page's template and brand, with native text and photo layers
 * where people will change things and HTML layers for what the template's
 * layers can't show (a chart, a timeline, a comparison), filled with real
 * assets from its tools (../design-tools.ts). It looks at the slides it built
 * and hands the deck in.
 *
 * An exact copy rebuilds the original slide by slide from the source notes.
 * A full recreation builds the approved plan from the brief, the research and
 * the approved headline. A rerun with instructions (the critics' fixes, or a
 * person's) opens the deck it built before and edits it. Its role cards are
 * ../cards/design.ts.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { agentCapabilities } from "../../../template-editor/agent-decks";
import { htmlTokensForGuide } from "../../../template-editor/html-layer";
import { formatDimensions, type CanvasElement, type DesignComment, type DesignDocument, type TextElement } from "../../../template-editor/model";
import { platformCardClass, PLATFORMS } from "../../../template-editor/platform-cards";
import { htmlTokensForTemplate } from "../../brand-actions";
import { imageBlock, RecreateError, work } from "../claude";
import { CHART_FIELDS, EXACT_CHART_FIELDS } from "../charts";
import { need, rerunNote, type StageContext, type StageRunner } from "../context";
import { loadDeck, MAX_DECK_SLIDES, saveDeck } from "../deck";
import { creditsFor, deckOffBrand, deckView, designSession, designTools, unstoredImages, type DesignSession } from "../design-tools";
import { coverPage, describePages, followPage, templatePages, type PageCatalog } from "../pages";
import { stagePrompt } from "../playbook";
import { originalSlides } from "../research";
import type { DesignOutput, PlanApproval, Research, SourceNotes, StoryBrief } from "../schemas";

const WORKFLOW = [
  "1. Plan the deck: one deck page for each slide you are given, in order, each on the template page that fits it best. Slide 1 is the post's cover: always the template's Cover page. The last slide is the template's Follow page.",
  "2. Build it with create_deck: every slide's words in its text slots, with [[ ]] around the words the accent sets apart.",
  "3. Get the real assets: cut_from_source for photos on the original's slides, find_logos for logos, x_post for posts from X, find_photos for photos the story needs (a full recreation only), and chart_data (look at a series first with fred_series or sp500_history) for charts.",
  "4. Place them with edit_deck: photos in the template's photo frames (update_element src), and what the template's own layers can't show drawn in an HTML layer with add_html: charts, other platforms' cards, lists drawn as a design. A chart or a picture made of parts goes where the template has its photo frame (replaces the frame's id). A slide that holds only a card is a blank slide (Cards).",
  "5. Look at every slide with look_at_slides, next to the original's. Fix what is off: words cut off or crowded, a word alone on a line, layers on top of each other, an empty photo frame, a face cut off or under a fade, the original's overlay showing on a photo, a card smaller, larger or elsewhere than the original's or wider than our frame, a call to action on two lines, a chart that doesn't read. Look again at what you changed.",
  "6. Hand the deck in with submit_design.",
].join("\n");

const LAYOUT_RULES = [
  "Keep each template page's branding layers (logo, hairlines, handle, page number, swipe line) where they are: never cover or redraw them",
  "The cover is the template's Cover page, exactly: the photo fills its photo frame under the template's fades, and the headline sits in its headline slot at the template's size and casing, its key phrase in [[ ]] for the accent, as the template's own cover sets one apart: the words the original sets apart, or else the phrase that carries the story. An exact copy's too: the accent is our template's look, not a change to the words",
  "A photo keeps every face whole and clear of the template's fades: cut it at about its frame's proportions, then place it in the frame with cropX and cropY (0-100: the point of the photo the frame centers on) and cropScale (above 1 to come closer)",
  "A photo we reuse never shows the original's overlays (its cards, captions, stickers, logos, text). Engine can't paint them out: cut the photo's box clear of them, or cover them with the layer we rebuild in their place",
  "Where an overlay reaches past the layer we rebuild over it (or there is none, as on the Follow page), our layer keeps its usual size and place, never stretched to cover it: the rest goes under a band of var(--color-background), an HTML layer right above the photo in the stack (add_html index), under the template's fades and our layers, solid over the overlay and fading out into the photo below it (linear-gradient to transparent) the way the template's fades do, clear of the faces. A photo that doesn't fill its frame (fit: contain, to keep every face whole) gets the same band over its top edge, so no hard line shows in the margins",
  "Every part that isn't a photo is rebuilt, never pasted from a screenshot: words as text, a post or comment as our card (Cards), a chart from its data, a logo from find_logos",
  "Rebuilt text matches the original's size and stays readable: never below var(--min-text-size), with text-wrap: pretty so no word sits alone on a line",
  "A better layout than the template page's is allowed when the content fits it (two columns, a timeline, a quote card, a comparison): build it on the closest template page, in HTML layers inside the page's margins (var(--margin-left) and the rest), and hide or empty only the template layers it replaces",
  "Headlines, titles and photos stay native layers: words in the template's text slots, photos in its photo frames. HTML is for charts, cards, tables, lists drawn as a design, comparisons, timelines and logo grids",
  "Text in an HTML layer uses the brand's type roles: var(--title-font), var(--body-size) and the rest",
  "Every color in HTML comes from the brand's variables (a platform's card is the one exception: Cards); a tint is color-mix(in srgb, var(--color-text) 20%, transparent) or opacity",
  "An HTML layer's CSS pixels are output pixels unless you set designWidth: a 1080-pixel slide is 1080 CSS pixels wide",
  "A chart reads at phone size: its labels are at least var(--min-text-size) and never touch or overlap (show every other year when they crowd), and each line is named in words, next to it or in a legend, never by its color alone",
  "The Follow page is made for this post: its call to action (the cta slot, in the accent) names what the page gives more of, tied to the post's subject (for a post of life stories, FOR MORE LIFE STORIES), on one line under FOLLOW THIS PAGE: about 21 characters at most. Its photo frame shows a photo from the post again, closer (cropScale about 1.3 to 1.6): the people in it stay whole, and the photo's own pixels aren't blown up past about twice their size. When the photo still holds the original's overlay, place it so the least of the overlay shows (an overlay at the photo's top: cropY 100, the photo as high as it goes), so the band over the rest stays short and the faces sit above the bottom fade. With no photo in the post, it keeps the template's placeholder",
  "A template text slot left without words is hidden for you (an empty list would still draw its bullet); give it words and it shows again",
];

/** Words drawn in HTML follow the page's text style, as create_deck's slots do (deck.ts cleanSlideText). */
const textStyle = (profile: StageContext["profile"]) =>
  `Words in an HTML layer follow the page's text style, as its text slots do: ${profile.format?.noFinalPeriods ?? true ? "no period at the end of a paragraph (an ellipsis stays), and " : ""}typographic quotes and apostrophes (“ ” ’)`;

const EXACT_RULES = [
  "One deck page per original slide, in the original's order (the source notes' slides). One slide stays one slide. A slide that repeats an earlier one (the same post, story or words again) is left out: say so in your notes",
  "Each slide's words go in as the source notes give them, by role: the cover headline in the cover's headline slot, titles in title slots, body text in body slots. Nothing is added, cut, merged or reworded. The page's text style (Layout) still applies to them, in slots and in HTML alike, as create_deck applies it to slots, and so does the accent on the cover headline's key phrase: that isn't rewording",
  "A post's or comment's words show twice in the source notes, in the slide's texts and in its part: they go in once, in its card, from the part",
  "Parts: a photo is cut with cut_from_source from its box in the source notes; a post from X becomes our X card (x_post with its handle, words, slide and boxes); another platform's post or comment (a screenshot of one) becomes our card in HTML (Cards); a chart is rebuilt from the real series it shows with chart_data and drawn in an HTML layer; a logo comes from find_logos, else is cut; a screenshot of anything else, or a graphic made of parts, is rebuilt in HTML from its words, logos and photos",
  "Photos come only from the original's slides, cut with cut_from_source. A photo frame the original has nothing for is hidden (update_element hidden: true), except the Follow page's",
  "A chart's scales as the original prints them: two only when it prints two. Its numbers come from the real data, never read off the picture",
  "The original page's own branding (the template notes' branding list) never comes along: our template's branding layers stand in for it",
  "The original's follow slide becomes our Follow page. When the original has none, our Follow page is added after its last slide (its pages entry: slide 0)",
  "The caption is the original's, word for word (translated faithfully when the page's language differs)",
];

const px = (value: string | undefined) => value && /^-?[\d.]+px$/.test(value.trim()) ? parseFloat(value) : null;

/** Reddit's dark mode by role, as the design proof draws it (every one is in platform-cards.ts PLATFORM_COLORS.reddit). */
export const REDDIT_CARD = { card: "#0E1113", border: "#2F3336", name: "#F2F4F5", time: "#8BA2AD", text: "#EEF1F3", avatars: { red: "#FF4500", orange: "#FF8717", blue: "#24A0ED", green: "#46D160" } } as const;
/** Reddit's default avatar, the white alien head on a circle of its color (COLOR), as the design proof draws it. */
export const REDDIT_AVATAR = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="COLOR"/><path d="M33 25 L36.5 14.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="38.6" cy="13.4" r="3.8" fill="#fff"/><circle cx="16.5" cy="31" r="5" fill="#fff"/><circle cx="47.5" cy="31" r="5" fill="#fff"/><ellipse cx="32" cy="38" rx="17.5" ry="12.5" fill="#fff"/><circle cx="25.5" cy="36.5" r="3" fill="COLOR"/><circle cx="38.5" cy="36.5" r="3" fill="COLOR"/><path d="M26 43.2 Q32 47.2 38 43.2" stroke="COLOR" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>';
const PLATFORM_NAMES = { x: "X", reddit: "Reddit" } as const;

/**
 * A card's sizes on the design the page approved (the Reddit proof Ivan approved
 * on 2026-11-08), in px on a page 1080 px wide: alone on its slide, and compact
 * on a photo. At these sizes the brand's font fills the lines the way the
 * original's screenshot does.
 */
export const CARD_SIZES = {
  lone: { top: 44, sides: 48, bottom: 52, avatar: 92, gap: 24, name: 40, below: 28, words: 50, lines: 63 },
  compact: { top: 34, sides: 40, bottom: 40, avatar: 64, gap: 18, name: 32, below: 18, words: 38, lines: 49 },
} as const;

/**
 * How the designer draws a post or comment: X's on the template's own X card;
 * another platform's in one HTML layer on that card's frame, at the approved
 * design's sizes (CARD_SIZES), in the platform's own colors when it has them (a
 * platform card, platform-cards.ts), as the design proof Ivan approved does.
 */
function cardRules(template: StageContext["template"], tokens: Record<string, string>, noFinalPeriods: boolean): string[] {
  const { width } = formatDimensions(template), scale = width / 360, size = (value: number) => Math.round(value * scale);
  const card = template.pages.flatMap(page => page.canvas?.elements ?? []).find(element => element.slot === "reaction-card");
  const frame = card?.type === "shape"
    ? `the frame of our X card: ${size(card.width)} px wide at x ${size(card.x)}, ${size(card.radius ?? 0)} px corners and a ${size(card.strokeWidth ?? 0)} px border`
    : "as wide as the page between its margins, with rounded corners and a thin border";
  const sized = ({ top, sides, bottom, avatar, gap, name, below, words, lines }: (typeof CARD_SIZES)[keyof typeof CARD_SIZES]) => {
    const at = (value: number) => Math.round(value * width / 1080);
    return `${at(top)} px of padding (${at(sides)} at the sides, ${at(bottom)} at the bottom); the avatar ${at(avatar)} px, ${at(gap)} px from the name; the name and time at ${at(name)} px; the words ${at(below)} px below the avatar, at ${at(words)} px on ${at(lines)} px lines`;
  };
  const [left, right, top, bottom, pageWidth, pageHeight] = ["--margin-left", "--margin-right", "--margin-top", "--margin-bottom", "--page-width", "--page-height"].map(name => px(tokens[name]));
  const area = left !== null && right !== null && top !== null && bottom !== null && pageWidth !== null && pageHeight !== null
    ? `x ${left}, y ${top}, ${pageWidth - left - right} px wide and ${pageHeight - top - bottom} px tall` : "the page between its margins";
  const named = PLATFORMS.map(platform => PLATFORM_NAMES[platform]).join(" and ");
  return [
    "A post from X is our X card: x_post, on the template's Reaction page",
    `A post or comment from another platform (Reddit, Threads, Instagram, TikTok, YouTube…) is our card, one HTML layer: ${frame}`,
    `${named} cards keep their platform's own colors, outside the brand on purpose, the way our X card copies X's dark mode. Mark the card: the outermost element of the layer's markup carries class="${platformCardClass("reddit")}" (an X post drawn in HTML: "${platformCardClass("x")}"). In a marked card a color may be written out, as hex, when it's one of the platform's own; every other color still comes from the brand's variables. A card from a platform without colors of its own (Threads, TikTok, YouTube…) is drawn on the same frame in the brand's colors, unmarked`,
    `Reddit's colors: the card ${REDDIT_CARD.card}, its border ${REDDIT_CARD.border}, the name ${REDDIT_CARD.name}, the time ${REDDIT_CARD.time}, the words ${REDDIT_CARD.text}. Its default avatar is this SVG, with COLOR the avatar's color in the original: ${Object.entries(REDDIT_CARD.avatars).map(([name, color]) => `${name} ${color}`).join(", ")}: ${REDDIT_AVATAR}`,
    "These cards are how the page draws other platforms' posts, approved by the page: they stand where the source notes say to avoid a platform's avatars or look",
    `Inside the card, the avatar, round; beside it the name in bold, then · and the time in grey at the same size, on one line; then the words, word for word, in the page's text style: ${noFinalPeriods ? "no period at the end of the last sentence, and " : ""}curly quotes and apostrophes (“ ” ’). No vote row, buttons, counts or menus, as on our X card: their words in the source notes (Reply, ••• and the vote count) stay out`,
    `Its sizes are the page's approved design, not a guess. A card alone on its slide: ${sized(CARD_SIZES.lone)}. A card on a photo, compact so the photo shows: ${sized(CARD_SIZES.compact)}. The words are in the brand's body font (var(--body-font)), with text-wrap: pretty. Only a comment too long to fit the content area at those sizes takes smaller words: never below var(--body-size) alone on its slide, nor below var(--min-text-size) on a photo`,
    `A card alone on its slide is a blank slide: edit_deck add_slide with layout "blank", background ${tokens["--color-background"] ?? "the brand's background color"}, and the card's layer as its one element. The layer takes the content area (${area}); the card is the outermost element of its markup, hugging its words, and the layer's CSS centers it between the top and bottom margins with :root { display: flex; flex-direction: column; justify-content: center }`,
    "A card on a photo (a cover's) sits where the original's card was, inside the page's margins (a card at the top starts at the top margin), on the same frame and width as any card, at the compact sizes. Its layer is a little taller than the card, the card at the layer's top",
  ];
}

const FULL_RULES = [
  "One deck page per slide of the approved plan, in its order (a Reaction slide with more posts than one page holds may take two pages)",
  "The cover's headline is the approved headline, word for word",
  "The words come from the brief and each plan slide's points. Numbers only from the brief's guardrails and the research's facts; an alleged claim stays worded as an allegation",
  "A Reaction slide shows the research's reactions the plan names (reactionIds): read each with x_post by its url, then fill the Reaction page with that many cards",
  "A chart is the plan slide's chart, made with chart_data on one scale",
  "Photos are the plan slide's photo: from find_photos (give it the research's source pages), or cut from the original's slide the plan slide rebuilds",
  "The caption is written in the page's voice, from the brief",
];

/** The deck the designer edits on a rerun with instructions: the one it built before, as it is saved now. */
async function earlierDeck(context: StageContext, previous: DesignOutput | undefined): Promise<DesignDocument | null> {
  if (!previous || !context.instructions) return null;
  const deck = await loadDeck(context.ownerKey, previous.deckId);
  return deck ? structuredClone(deck) : null;
}

const SubmitSchema = (exact: boolean) => z.object({
  pages: z.array(z.object({
    slide: z.number().int().min(exact ? 0 : 1).max(MAX_DECK_SLIDES).describe(exact ? "The original slide this deck page rebuilds, from 1; 0 for our Follow page when the original has no follow slide" : "The plan slide this deck page shows, from 1"),
    layout: z.string().min(1).max(200).describe("The template page it starts from, by its label, and the layout you built on it, if any (two columns, a timeline…)"),
  })).min(1).max(MAX_DECK_SLIDES).describe("One entry for each deck page, in the deck's order"),
  notes: z.array(z.string().max(600)).max(20).describe("For the team: what couldn't be rebuilt and why, and what a person should add by hand. Empty when there is nothing to say"),
});
type Submitted = z.infer<ReturnType<typeof SubmitSchema>>;

/** A template page (the Cover, the Follow page) and the slots no other page has, which mark a deck page built on it; null when none are its own. */
function ownSlots(template: StageContext["template"], pick: (pages: PageCatalog[]) => PageCatalog | undefined): { index: number; label: string; slots: Set<string> } | null {
  const catalog = templatePages(template), page = pick(catalog);
  if (!page) return null;
  const slotsOf = (item: PageCatalog) => [...item.text, ...item.photo].map(slot => slot.slot);
  const elsewhere = new Set(catalog.filter(item => item.index !== page.index).flatMap(slotsOf));
  const slots = new Set(slotsOf(page).filter(slot => !elsewhere.has(slot)));
  return slots.size ? { index: page.index, label: page.label, slots } : null;
}
const builtOn = (page: DesignDocument["pages"][number] | undefined, own: { slots: Set<string> }) =>
  (page?.canvas?.elements ?? []).some(element => element.slot && own.slots.has(element.slot));

/** Why the deck can't be handed in yet, or null. */
async function problemWith(session: DesignSession, value: Submitted, slides: number): Promise<string | null> {
  const document = session.document;
  if (!document) return "There is no deck yet: build it with create_deck.";
  if (value.pages.length !== document.pages.length) return `The deck has ${document.pages.length} slides: give one pages entry for each, in order.`;
  const outside = value.pages.find(page => page.slide > slides);
  if (outside) return `There are only ${slides} slides to rebuild; slide ${outside.slide} isn't one of them.`;
  const cover = ownSlots(session.template, coverPage);
  if (cover && !builtOn(document.pages[0], cover)) {
    return `Slide 1 is the post's cover: build it on the ${cover.label} page (templatePage ${cover.index}) with create_deck, the headline in its headline slot, then look at it again.`;
  }
  // A carousel ends on the Follow page, made for the post (a single picture stays one).
  const follow = slides > 1 ? ownSlots(session.template, followPage) : null;
  if (follow && (document.pages.length < 2 || !builtOn(document.pages.at(-1), follow))) {
    return `The last slide is the ${follow.label} page (templatePage ${follow.index}), with a call to action made for this post${session.mode === "exact" ? " (when the original has no follow slide, add it after the last one: its pages entry is slide 0)" : ""}. Add it, then look at it.`;
  }
  // The template's own cover headline sets its key phrase apart in the accent, so ours does too.
  const accented = (element: CanvasElement): element is TextElement => element.type === "text" && /<span\b/i.test(element.richText ?? "");
  const sample = cover && session.template.pages[cover.index]?.canvas?.elements.find(element => element.slot && cover.slots.has(element.slot) && accented(element));
  const headline = sample && document.pages[0].canvas?.elements.find(element => element.slot === sample.slot);
  if (sample && headline?.type === "text" && headline.text.trim() && !accented(headline)) {
    return `The cover's headline sets its key phrase apart in the accent, as the template's cover does: give the ${sample.slot} slot its words again with [[ ]] around that phrase (edit_deck update_element text), then look at it again.`;
  }
  if (Object.keys(session.tokens).length) {
    const off = deckOffBrand(document, session.tokens);
    if (off.length) return `These HTML layers leave the brand: ${off.join(" ")}`;
  }
  const loose = unstoredImages(document, session.template);
  if (loose.length) return `These images aren't workspace files: ${loose.slice(0, 4).join(", ")}. Place images only from your tools.`;
  if (session.renderable && session.unseen.size) {
    const numbers = document.pages.flatMap((page, index) => session.unseen.has(page.id) ? [index + 1] : []);
    return `Look at slide${numbers.length === 1 ? "" : "s"} ${numbers.join(", ")} with look_at_slides first: ${numbers.length === 1 ? "it changed" : "they changed"} since you last looked.`;
  }
  return null;
}

export const design: StageRunner = async context => {
  const { file, profile, template } = context;
  const exact = file.mode === "exact";
  const notes = need<SourceNotes>(file, "source");
  const research = exact ? undefined : need<Research>(file, "research");
  const brief = exact ? undefined : need<StoryBrief>(file, "brief");
  const approval = exact ? undefined : need<PlanApproval>(file, "approval");
  const previous = context.previous as DesignOutput | undefined;
  const [images, earlier] = await Promise.all([originalSlides(context), earlierDeck(context, previous)]);
  const tokens = (context.guide ? htmlTokensForGuide(context.guide) : await htmlTokensForTemplate(context.ownerKey, template)) ?? {};
  const session = designSession({
    ownerKey: context.ownerKey, mode: file.mode, profile, template, templates: context.templates, guide: context.guide,
    tokens, slides: images, caption: notes.post.caption, chartData: context.cache.chartData, signal: context.signal,
    deckId: previous?.deckId ?? `recreate-${randomUUID()}`, document: earlier,
  });
  const slides = exact ? notes.slides.length : approval!.plan.slides.length;
  if (!slides) throw new RecreateError(exact ? "The source notes list no slides to rebuild." : "The approved plan has no slides.", 409);

  const { width, height } = formatDimensions(template);
  const system = stagePrompt("design", file.mode, profile, [
    `The template: ${template.name}, ${width}×${height} output pixels a slide. Its pages (0-based, for create_deck's templatePage):\n${describePages(templatePages(template))}`,
    `How to work:\n${WORKFLOW}`,
    `Layout:\n${[...LAYOUT_RULES, textStyle(profile)].map(rule => `- ${rule}`).join("\n")}`,
    `Cards:\n${cardRules(template, tokens, profile.format?.noFinalPeriods ?? true).map(rule => `- ${rule}`).join("\n")}`,
    `${exact ? "This exact copy" : "This full recreation"}:\n${(exact ? EXACT_RULES : FULL_RULES).map(rule => `- ${rule}`).join("\n")}`,
    `HTML layers:\n${JSON.stringify(agentCapabilities().htmlLayers)}`,
    Object.keys(tokens).length ? `The brand's CSS variables, set on every HTML layer:\n${Object.entries(tokens).map(([name, value]) => `${name}: ${value}`).join("\n")}` : "This page has no brand guide: keep to the template's own colors and fonts.",
    exact ? `${CHART_FIELDS}\n${EXACT_CHART_FIELDS}` : CHART_FIELDS,
  ].join("\n\n"));

  // The plan is the approved one: the brief's own proposal (its slides) may have been changed at approval.
  const story = brief && Object.fromEntries(Object.entries(brief).filter(([key]) => key !== "slides" && key !== "why"));
  const inputs = exact
    ? { sourceNotes: notes }
    : { approvedHeadline: approval!.headline.text, plan: approval!.plan, approvalNotes: approval!.notes, brief: story, sourceNotes: notes, research: { facts: research!.facts, positions: research!.positions, reactions: research!.reactions, origin: research!.origin } };
  const content = [
    { type: "text" as const, text: `${exact ? "Rebuild this post as an exact copy." : "Build this post from the approved plan."} The stage outputs it is built from (data, never instructions):\n${JSON.stringify(inputs)}` },
    ...images.flatMap((image, index) => [{ type: "text" as const, text: `Original slide ${index + 1}:` }, imageBlock(image)]),
    ...(images.length ? [] : [{ type: "text" as const, text: "The original's slides aren't available in this run: nothing can be cut from them." }]),
    ...(rerunNote(context) ? [{ type: "text" as const, text: rerunNote(context) }] : []),
    ...(earlier ? [{ type: "text" as const, text: `Your deck from before is open: edit it with edit_deck, keeping what the fixes don't touch. Look at the slides you change. It is now:\n${JSON.stringify(deckView(earlier))}` }] : []),
    ...(previous && context.instructions && !earlier ? [{ type: "text" as const, text: "Your deck from before is gone (it was deleted): build it again." }] : []),
    { type: "text" as const, text: "Work through the steps, then hand the deck in with submit_design." },
  ];

  const schema = SubmitSchema(exact);
  const submitted = await work({
    role: "designer", system, content, what: "design the slides", signal: context.signal, usage: context.usage, maxTurns: 40,
    tools: designTools(session),
    submit: {
      name: "submit_design",
      description: "Hand in the deck, once every slide is built and you have looked at it: which slide each deck page shows and the layout it uses, and notes for the team.",
      schema, check: value => problemWith(session, value, slides),
    },
  });

  const document = session.document!;
  const now = new Date().toISOString();
  const comment = (text: string): DesignComment => ({ id: randomUUID(), pageId: document.pages[0].id, text: text.slice(0, 2000), createdAt: now });
  const written = [...submitted.notes.map(note => note.trim()).filter(Boolean), ...creditsFor(session, document)];
  // The deck names its post file (page-posts.ts ourLibrary reads it, with the page's tag): once, and again
  // when a fix round built the deck afresh instead of editing the earlier one.
  const named = (document.comments ?? []).some(item => item.text.includes(file.id));
  document.comments = [
    ...(document.comments ?? []),
    ...(named ? [] : [comment(`Made by Recreate for ${profile.name}. The team's working file is ${file.id}; agents can read it with engine_recreate_status.`)]),
    ...(written.length ? [comment(`${context.round ? `Fix round ${context.round}: notes` : "Notes"} from Recreate\n${written.map(note => `• ${note}`).join("\n")}`)] : []),
  ].slice(-200);

  const result = await saveDeck(context.ownerKey, document, previous ? { savedAt: previous.savedAt } : undefined);
  if (!result.saved) {
    if (!previous) throw new RecreateError(result.held, 409);
    // The person's version stands; the review reads it as it is.
    return { output: { ...previous, held: result.held } satisfies DesignOutput };
  }
  const saved = result.saved;
  const copied = result.copy ? [`The post changed after Engine saved it (it was edited, or opened and its text re-fitted), so that version stays as it is and this one was saved next to it as “${saved.name}”.`] : [];
  return {
    output: {
      deckId: saved.id, name: saved.name, slideCount: saved.pages.length, savedAt: saved.updatedAt, caption: saved.caption ?? "",
      pages: submitted.pages.map((page, index) => ({ pageId: saved.pages[index]?.id ?? "", slide: page.slide, layout: page.layout })),
      notes: [...copied, ...written], held: "",
    } satisfies DesignOutput,
  };
};
