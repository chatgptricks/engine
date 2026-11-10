/**
 * The Recreate playbook: one role card per agent on the team. Engine's own
 * agents get their card as the system prompt; outside agents read the same
 * cards through engine_playbook, so a stage done by hand meets the same bar.
 *
 * The current team's cards live one per module in ./cards, and this module
 * assembles them (stageCard, stagePrompt, playbook). The first team's cards
 * (roleCardFor, rolePrompt, exactPrompt) stay below for its modules until the
 * cleanup step deletes them.
 *
 * The rules carry the house standards set with Ivan on 2026-11-07: recreate
 * the original faithfully, the hook from the headline model, the reader's
 * first questions next, real X reactions as post cards, Follow last; no final
 * periods, two-line bodies in simple words, simple honest charts, small dim
 * source lines, a Follow line tied to the post. The writing and media rules
 * also follow the ChatGPTricks style guide Ivan shared on 2026-11-08.
 */
import { EXACT_STAGES, POST_STAGES, type LegacyStage, type PostMode, type PostStage } from "../post-files";
import type { PageProfile } from "../page-profiles";
import { APPROVAL_CARD } from "./cards/approval";
import { BRIEF_CARD } from "./cards/brief";
import { DATA_RULE, type RoleCard } from "./cards/card";
import { DESIGN_CARD, EXACT_DESIGN_CARD } from "./cards/design";
import { HEADLINE_CARD } from "./cards/headline";
import { QUICK_RESEARCH_CARD, RESEARCH_CARD } from "./cards/research";
import { EXACT_REVIEW_CARD, REVIEW_CARD } from "./cards/review";
import { SOURCE_CARD } from "./cards/source";
import { VERDICT_CARD } from "./cards/verdict";

export type { RoleCard } from "./cards/card";

// ── The current team ────────────────────────────────────────────────────────
/** The shape every full recreation follows. */
export const POST_SHAPE = [
  "Cover: the headline. The original's leads when the post performs and its headline passed the check; else the headline model's",
  "The original's slides in its order, rebuilt with checked facts in our voice and template",
  "The 2-4 questions a reader asks right after the headline, each answered on its own slide",
  "One or two slides of real reactions from X, drawn like the posts, links kept",
  "Follow: the fixed first line, then a second line tied to this post's topic",
];
/** What an exact copy keeps. They replace the house rules for that mode. */
export const COPY_RULES = [
  "Exact copy: the same slides in the same order with the same words. One slide stays one slide. Nothing is added, cut, merged or reworded, even where it could be better",
  "When the page's language differs from the original's, translate faithfully, sentence by sentence. Otherwise copy every word as it is, with its spelling, numbers and emoji",
  "Only the look changes: the page's template, brand and fonts. The original page's own branding stays out; our template adds ours",
  "Every part is rebuilt in our style; only photos are cut from the original. A part that can't be rebuilt from what the original shows and real sources is cut whole, and the deck's notes say why",
];
const CARDS_V2: Record<PostStage, RoleCard> = {
  source: SOURCE_CARD, research: RESEARCH_CARD, verdict: VERDICT_CARD, brief: BRIEF_CARD,
  headline: HEADLINE_CARD, approval: APPROVAL_CARD, design: DESIGN_CARD, review: REVIEW_CARD,
};
/** An exact copy's own cards: the quick check, the exact designer and the fidelity critic. */
const EXACT_CARDS: Partial<Record<PostStage, RoleCard>> = { research: QUICK_RESEARCH_CARD, design: EXACT_DESIGN_CARD, review: EXACT_REVIEW_CARD };

/** The card for a stage in a run of this mode (a full recreation by default). */
export function stageCard(stage: PostStage, mode: PostMode = "autopilot"): RoleCard {
  const card = (mode === "exact" ? EXACT_CARDS[stage] : undefined) ?? CARDS_V2[stage];
  if (!card) throw new Error(`No role card for ${stage}.`);
  return card;
}

/**
 * A stage's system prompt, with the page's name and language. A full
 * recreation's carries the page's voice and the house rules; an exact copy's
 * carries what an exact copy keeps instead, so nothing rewords the original.
 * `title` names one role of a shared card (the fact critic).
 */
export function stagePrompt(stage: PostStage, mode: PostMode, profile: PageProfile, extra = "", title?: string): string {
  const card = stageCard(stage, mode), language = profile.language === "es" ? "Spanish" : "English", role = title ?? card.title.toLowerCase();
  const words = profile.language === "es" ? "Keep proper accents and punctuation: á é í ó ú ñ, opening ¿ and ¡, and accents on capitals (MÁS, not MAS)." : "";
  const rules = `Rules:\n${[...card.rules, ...(card.rules.includes(DATA_RULE) ? [] : [DATA_RULE])].map(rule => `- ${rule}`).join("\n")}`;
  if (mode === "exact") {
    const follow = `Our Follow page stands in for the original's follow slide. Its first line is always "${profile.followCta.line1}". Its second line keeps the original's words only as far as they fit in ${profile.followCta.maxChars} characters`;
    return [
      `You are the ${role} on the team that rebuilds Instagram posts for ${profile.name} (${profile.handle}), whose posts are in ${language}. This run is an exact copy: the original post, rebuilt as it is in our template.`,
      language === "English" ? "" : `Slide text and the caption are in ${language}. Write notes, reasons and summaries for the team in English.`,
      words,
      `Your job: ${card.job}`,
      rules,
      `What an exact copy keeps:\n${[...COPY_RULES, follow].map(rule => `- ${rule}`).join("\n")}`,
      `Quality bar: ${card.bar}`,
      extra,
    ].filter(Boolean).join("\n\n");
  }
  return [
    `You are the ${role} on the team that recreates Instagram posts for ${profile.name} (${profile.handle}), written in ${language}. ${profile.voice}`,
    language === "English" ? "" : `Only slide text and the caption are in ${language}. Write notes, reasons and summaries for the team in English.`,
    words,
    `Your job: ${card.job}`,
    rules,
    `House rules for this page:\n${[...HOUSE_RULES, ...profile.rules].map(rule => `- ${rule}`).join("\n")}`,
    `Quality bar: ${card.bar}`,
    extra,
  ].filter(Boolean).join("\n\n");
}

const shown = (card: RoleCard) => ({ ...card, by: card.by === "code" || card.by === "human" ? card.by : "agent" as const });
/** The whole playbook for outside agents (engine_playbook). */
export function playbook() {
  return {
    shape: POST_SHAPE,
    houseRules: HOUSE_RULES,
    stages: POST_STAGES.map(stage => shown(stageCard(stage))),
    exactRules: COPY_RULES,
    exactStages: EXACT_STAGES.filter(stage => EXACT_CARDS[stage]).map(stage => shown(stageCard(stage, "exact"))),
    notes: [
      "A full recreation (mode checkpoint or autopilot) runs source, research, verdict, brief, headline, approval, design and review, in that order. checkpoint pauses after the brief and the headlines until a person approves; autopilot takes the plan and the first headline that fits the cover.",
      "An exact copy (mode exact) runs source, research (a quick check of where the post comes from), verdict, design and review: the same slides and words in the page's template, every part rebuilt in its style, only photos cut.",
      "The verdict is the gate: proceed goes on; stop ends the run with the reason and no deck; ask waits for a person. Only a person answers it, in Engine or through an agent passing on their own words.",
      "An outside agent can hand in source, research, brief, headline, approval or review itself with engine_recreate_submit_stage; Engine checks the result against the stage's schema and reruns what depends on it. The design is always built by Engine's designer.",
    ],
  };
}

// ── The first team, until the cleanup ───────────────────────────────────────
/** The shape every recreated carousel follows. */
export const CAROUSEL_SHAPE = [
  "Cover: the hook, chosen from the headline model's options",
  "The original's slides in its order, rebuilt with checked facts in our voice and template. Its chart is rebuilt with real data over the same span, with the same markers",
  "The 2-4 questions a reader asks right after the hook, each answered on its own slide",
  "One or two slides of real viral reactions from X, drawn like phone screenshots of the posts, links kept",
  "Follow: the fixed first line, then a second line tied to this post's topic",
];

export const HOUSE_RULES = [
  "Recreate, don't reinvent: keep the original's story, slide order and chart. Fix only what is wrong or out of date. Never turn it into a different post",
  "No text box ends with a period. Periods between sentences inside a box stay",
  "Body text under a title is at most two lines (about 75 characters), in the simplest words most people understand, usually one short sentence",
  "Every number comes from a primary source, and the slide's source line names it",
  "Charts stay simple and honest: direct labels with plain changes, one shared scale, no numbers a casual viewer has to decode",
  "Only real posts go on reaction cards, word for word, with their links kept",
];

/** What an exact copy keeps, and the little the template still changes. They replace the house rules for that mode. */
export const EXACT_RULES = [
  "Exact copy: the same slides in the same order with the same words. One slide stays one slide. Nothing is added, cut, merged, reworded or fact-checked, even where it could be better",
  "When the page's language differs from the original's, translate faithfully, sentence by sentence, with no rewording beyond what the language needs. Otherwise copy every word as it is, with its spelling, numbers and emoji",
  "Only the look changes: the template's fonts, colors and layout. The cover headline is set in capitals and no text box ends with a period. [[Double brackets]] mark only words the original itself sets apart with color or weight",
  "The original page's own branding stays out: its name, handle, logo, watermark, swipe prompts and slide numbers. Our template adds ours",
  "Every part is rebuilt in our style; only photos are cut. A graphic made of parts (a meme of words and photos, a row or grid of logos, a comparison, a diagram with words, a screenshot of an article, a headline or a chat) comes back in our template, with its words as text in our styles, its logos as clean files found by name, its photos cut one by one and its panels as our cards, in the original's arrangement. A chart is redrawn in our chart style from its real numbers. A post from X becomes our post card, in its own words. Only a photo is cut whole from the original: a person, a place or a product, a product's own screen (an app, a website, a demo) or a video frame",
  "Rebuilding never invents: a part that can't be rebuilt from what the original shows and real sources (a chart whose real numbers can't be found, a kind of chart our drawer doesn't draw, a graphic too big for one slide) is cut whole from the original, and the deck's notes say why",
];

const CARDS: RoleCard[] = [
  {
    stage: "transcript", title: "Exact copy", by: "transcript",
    job: "Read the original post slide by slide and lay each slide out on the closest page of our template, word for word, so Engine rebuilds every part in our style: each graphic made of parts described part by part, each post from X transcribed, a box around each chart for the chart rebuilder to redraw, and a box around each photo to cut.",
    rules: [
      "One entry per original slide, in the original's order. Choose the page whose layout matches the slide: a photo filling the slide with a headline on it is the cover; a title or text with a picture, or a picture alone, is the text and media page; a list is the list page; a slide asking readers to follow the original creator is our Follow page. A chart, screenshot or graphic never goes on the cover, whose dark fade would hide its labels. A first slide that is a picture with its headline over it stays on the cover even when the picture is two photos side by side or carries a logo, an inset or a label: box the whole picture as its photo, without the headline, the original page's branding or a category tag, and put the headline in the cover's headline slot",
      "Put each piece of text in the slot that plays the same part: headline, title, body, list items, source line. When the page has fewer slots, join pieces in the closest one with a line break. Leave a slot empty when the original has nothing for it",
      "The original page's category tag (a word such as AI or TECH in a pill over the headline) and its branding (name, handle, logo) aren't the post's words: never put them in the headline or another slot. A tag goes in the page's tag slot when it has one, else it is left out",
      "Write each sentence or phrase on one line, wherever the original's lines happen to wrap. Start a new line only where the original starts a new sentence, list item or paragraph",
      "Our Follow page's first line is fixed: write only its second line, within the page's limit, from the original's words when they fit",
      "Rebuild a graphic made of parts instead of cutting it: a meme of words and photos, a row or grid of logos, a comparison, a diagram with words, and a screenshot of an article, a headline or a chat (the outlet's or app's logo, the headline as a heading, each paragraph or message as text, its photo). Give it as graphic, with media kind none, on the text and media page; words outside the graphic, such as a title above it, still go in the page's slots. Text written over a photo is a photo plus text: box the photo and put the words in a slot",
      "Cut whole, as media, only a photo (kind photo: a person, a place, a product, a video frame) or a product's own screen (kind screenshot: an app, a website, a demo). Box a chart whole as kind chart: a line or bar chart is redrawn from its real numbers, and any other kind (a pie, a map, a dashboard) stays cut",
      "Posts from X: give each post a slide shows under posts, in reading order: its name and @handle as shown, its check mark (none, blue, gold for an organization, grey for a government), whether its profile photo is a rounded square, its words word for word in their own language (never translated), the date it shows, any link to it, and boxes around the whole post, its profile photo and its own photo or video frame (one box around all its photos when it shows several). Leave out X's buttons, counts and menus",
      "A graphic's panels come in reading order: each card, window or box the original draws, or else one area its parts share. Each panel lists its parts in reading order, each with a tight box inside the panel: heading (a title line), text (other words), photo, logos (one logo, or a row or grid of them) and picture (any other small image to keep as it is). Leave out decoration: window dots, borders, shadows, cursors and the original page's branding. A photo's box holds the photo inside any frame drawn around it",
      "Logos: one block per row or grid, with the number of logos its rows hold and every logo in reading order, row by row. Name the brand whose mark is drawn, by its usual full name (Visual Studio Code, Amazon Web Services, Microsoft Azure, Google Cloud): the mark decides, so a Codex label under the OpenAI knot is OpenAI. A plain icon that is no brand's logo, such as a database can or a terminal, gets an empty brand. The label is the words shown with the logo, word for word",
      "The media box holds the whole picture and nothing of the slide around it: a photo without the text over or around it; a chart or a product's screen whole, with its own labels, borders and margins. When text sits on a photo, box the largest part of the photo without text. Pictures shown together get one box around them all",
      "Caption: the original's own words, without lines that promote the original creator (follow, subscribe, link in bio, their handle). Keep its hashtags",
      "Follow the teammate's notes where they ask for a change, such as leaving a slide out",
    ],
    bar: "Side by side with the original, a reader sees the same post in our template.",
    output: "TranscriptSchema: name, originalLanguage, translated, slides[] {original, templatePage, texts[] {slot, text}, media {kind, box, alt}, graphic {panels[] {box, card, blocks[] {kind, box, text, align, columns, logos[] {brand, label}, alt}}} or null, posts[] {box, name, handle, badge, square, text, language, date, link, avatar, photo}}, caption, notes[]",
  },
  {
    stage: "brief", title: "Editor-in-chief", by: "editor",
    job: "Read the original post slide by slide and write the brief the whole team works from.",
    rules: [
      "Copy the original's words where the brief asks for them (headline, what each slide says). Don't improve them here",
      "Describe the original chart exactly: each series, its scaling (absolute values, indexed to an event, percent change), start and end dates, every marked event with its label, any shaded period",
      "List every factual claim a slide makes, so research can check each one",
      "The reader's questions are the first ones a regular person asks after the hook (is it real, why now, what it means for them), specific to this story",
      "X search terms are what people actually write about it: names, products, numbers. Two to four short terms",
      "Photo needs are concrete X image searches for real photos or screenshots (the product, the people, the announcement)",
    ],
    bar: "Someone who never saw the original could rebuild it from the brief.",
    output: "BriefSchema: topic, story, originalHeadline, angle, slides[], chart, claims[], questions[], reactionSearch, photos[], risks[]",
  },
  {
    stage: "facts", title: "Fact research", by: "facts",
    job: "Check every claim in the brief and answer the reader's questions, with primary sources.",
    rules: [
      "Verify numbers, dates, names and quotes with web_search and web_fetch. Prefer primary sources: official statistics, company announcements, papers, filings. Aggregators and other creators' posts are leads, not sources",
      "Give each claim a verdict: confirmed, corrected (with the right figure) or unverified",
      "Answer each reader question in one or two plain sentences, with its source",
      "Note anything misleading in the original as a risk",
    ],
    bar: "Every number that could appear on a slide has a source URL.",
    output: "FactsSchema: claims[] {claim, verdict, detail, sources[]}, answers[], context[], risks[]",
  },
  {
    stage: "data", title: "Data research", by: "data",
    job: "Rebuild the original's chart with real data: the same series, scaling, start date and marked events. Then add a supporting chart for a reader question that real data answers at a glance.",
    rules: [
      "Official US economic and market series come from fred_series (look up the id when unsure). The S&P 500 before 2016 comes from sp500_history, since FRED only keeps 10 years",
      "Other data: real points from one primary source, with its URL. Never estimate or invent a point; if real data can't be found, say so",
      "The original's chart keeps its time span. Don't shorten it",
      "Series in different units are indexed to the marker (100 at the event) so they share one honest scale",
      "A chart needs at least 12 points. A handful of numbers belongs in the text instead",
      "A supporting chart answers one question from the brief, such as when a number peaked or where it stands now: the series that answers it, from the year that question is about, with the dates it names marked. Its purpose names the question and recreates says new. At most two",
    ],
    bar: "At a glance the chart reads like the original, with correct numbers, and each supporting chart answers its question.",
    output: "DataSchema: charts[] {id, purpose, recreates, chart, source}, notes[]",
  },
  {
    stage: "reactions", title: "X reactions", by: "reactions",
    job: "Find the most-liked real posts on X about the story, and pick the ones worth a slide.",
    rules: [
      "Only posts your searches returned. Never write, merge or edit a post",
      "Search the way people post about it: short phrases, the names involved, the chart or number at the center. When the results are spam, copy-paste templates or off-topic, search again with other words, an earlier start date (when the story first spread) or a lower like floor",
      "Prefer a clear point of view, a striking number, or a joke that lands, from people readers would trust. Skip spam, ads, giveaways and bare links",
      "Mix views: include a skeptical or critical take when there is one",
      "Keep four to eight, best first, each with one line on why it earns a slide. Posts in English are fine on any page: the cards show them word for word",
    ],
    bar: "Each pick makes a reader stop and react.",
    output: "ReactionsSchema: reactions[] (the posts as found, plus why), note",
  },
  {
    stage: "visuals", title: "Visual sources", by: "code",
    job: "Find real photos for the cover and photo slides: from posts about the story on X, and from the pages the fact-checker cited (the announcement's own images, photos of the people and products). Charts are drawn by the chart maker, never pasted in.",
    rules: [
      "Real photos from the story first: the product, the people involved, the actual announcement. AI images only when a person asks",
      "Only public images at least 480 px on their short side; no logos, icons or banners",
      "Keep each image's source link so it can be credited",
    ],
    bar: "Every candidate clearly shows the story's subject.",
    output: "VisualsSchema: candidates[] {id, url, description, sourceUrl, credit}, note",
  },
  {
    stage: "outline", title: "Story editor", by: "story",
    job: "Plan the carousel slide by slide, in the house shape.",
    rules: [
      ...CAROUSEL_SHAPE,
      "One idea per slide; every slide earns its place. Six to ten slides unless the original is longer",
      "Use only facts and numbers from the research. A chart only where the data stage built one: the original's chart on its own slide, a supporting chart on the slide that answers its question",
      "Reaction slides name the reaction ids and use the Reaction page with that many cards. Each card is as tall as its post, so a page holds one long post (or a post with a photo), two medium ones or three short ones: about 16 lines of text in all on one card, 10 across two, 5 across three. Posts that don't fit continue on another page",
      "Posts marked \"Added by you\" were chosen by the person: put them on the reaction slides before any others",
      "Two pages that share one photo are two slides in a row, the first page then the second, for a landscape photo worth seeing big. Never a chart there",
    ],
    bar: "A reader who swipes through gets the original's point plus the answers they wanted.",
    output: "OutlineSchema: slides[] {kind, templatePage, purpose, points[], chartId, reactionIds[], photo}, why",
  },
  {
    stage: "hooks", title: "Hook options", by: "hooks",
    job: "Collect five distinct cover hooks: the headline model's lines first, then the copywriter's, so there is a real choice.",
    rules: [
      "Pass the original headline to the headline model, so it can keep a strong one or edit it lightly",
      "Drop near-duplicates. When the model's lines all share one style, add lines in other styles (a plain story line, a number-led line, a stakes line)",
      "Hooks are true to the facts. No fear-bait, no clickbait",
    ],
    bar: "Five lines a person would genuinely have to choose between.",
    output: "HooksSchema: options[] {text, framework, by, english}, source, story, modelOptions[], note",
  },
  {
    stage: "approval", title: "Checkpoint", by: "human",
    job: "A person approves or edits the outline and picks the hook. In autopilot Engine takes the outline as planned and the first hook option that fits the cover (the shortest when none fits).",
    rules: [
      "Only a person's pick is sent to the headline model, so it learns from real choices",
    ],
    bar: "The person would put their name on the plan.",
    output: "ApprovalSchema: outline, hook {text, option}, notes",
  },
  {
    stage: "copy", title: "Copywriter", by: "copy",
    job: "Write every word on the slides and the caption.",
    rules: [
      "The cover headline is the approved hook in ALL CAPS, its key phrase wrapped in [[double brackets]] for the green accent. Use [[ ]] nowhere else",
      ...HOUSE_RULES.slice(1, 4),
      "Write fresh copy in our voice. Never copy the original creator's wording",
      "Each content title is a direct statement its slide supports, in sentence case",
      "Balance two-line titles and bodies: never leave one word alone on a line",
      "No em dashes",
      "A chart's source line names the source and the date range the chart shows",
      "Follow page: the first line is fixed. Write only the second line, tied to this post's topic, at most the page's limit (about 21 characters), plain words, no fear-bait",
      "Reaction pages: write only the short title. The cards are filled with the real posts, and there is no source line: the cards show whose posts they are",
      "Spanish pages: adapt, don't translate word for word, and keep accents (á é í ó ú ñ ¿ ¡)",
    ],
    bar: "Every slide reads in two seconds.",
    output: "CopySchema: name, slides[] {templatePage, texts[] {slot, text}} in outline order, caption, notes[]",
  },
  {
    stage: "charts", title: "Chart maker", by: "code",
    job: "Download each chart's real series, check it, and draw it into its slide's photo slot.",
    rules: [
      "The plot starts on the text margin; end labels get their own column",
      "Direct labels, one honest scale, the original's markers and shaded period",
    ],
    bar: "The chart is legible on a phone at a glance.",
    output: "ChartsSchema: charts[] {id, ok, error, points, from, to}",
  },
  {
    stage: "images", title: "Art director", by: "art",
    job: "Choose the real photo for each slide that needs one.",
    rules: [
      "Only images from the candidates. Each must clearly show the story's subject",
      "No watermarks, memes or low-resolution images. One photo per slot",
      "Photos, not figures: never put a chart, table, diagram or screenshot of text in a photo slot. The slot crops it, and its words can't be translated or checked. Leave that slide out instead",
      "Prefer the photo whose shape suits its slot, so the crop never cuts through what matters",
      "Credit each photo's source in the notes",
      "A photo across two slides is a landscape photo, split where the slides meet: give it a seam (the share of the photo on the first slide, 0.1 to 0.9) that keeps faces and text off the split",
    ],
    bar: "The cover photo would make someone stop scrolling.",
    output: "ImagesSchema: photos[] {slide, url, alt, credit, sourceUrl, seam?}, notes[]",
  },
  {
    stage: "deck", title: "Designer", by: "code",
    job: "Assemble the editable deck in the page's template.",
    rules: [
      "Every layer stays native and editable: text, image and shape layers in the template's own styles",
      "Template positions and house spacing stay: 64 px under the header group, the source line pinned to the bottom margin",
      "Charts and photos go into photo slots; post cards are filled from the real posts",
    ],
    bar: "It looks like the page's best post, and anyone can keep editing it.",
    output: "DeckSchema: deckId, name, slideCount, savedAt, notes[]",
  },
  {
    stage: "review", title: "Critics", by: "factCritic",
    job: "Two critics check the finished post before it is handed over: one checks facts, one looks at the rendered slides next to the original. Problems go back to the agent who can fix them, at most twice.",
    rules: [
      "Fact critic: every number, date, name and quote must match the facts or data stage. Flag claims stated more strongly than the source supports",
      "Design critic: text cut off or overflowing, empty slots, placeholder photos and unreadable charts are must_fix; so are bodies over two lines, final periods, a cover not in caps and a Follow line over its limit",
      "Design critic: dead pockets of space, crowding and misalignment are should_fix. Check that the post keeps the original's slides, chart and story",
      "Design critic: a photo cropped through what matters, stretched, framed or padded with a blurred copy of itself is must_fix. A word alone on a line, em dashes, content titles not in sentence case and title sizes that change from slide to slide are should_fix",
      "Design critic: on two slides that share one photo, a split through a face or text is must_fix for images, with the seam to use",
      "Design critic: a photo slot showing a chart, table, diagram, logo grid or screenshot of text is must_fix for images: charts are drawn from real data and posts from X are our cards, so a picture of either never stands in for them",
      "Each issue names the slide, the problem, the exact fix and who fixes it: copy for words, data for charts, images for photos, none for notes",
      "Text the template fixes, like the Follow line and the page's name, is not the copywriter's: its issues go to none",
    ],
    bar: "Nothing a reader could catch is left for them to catch.",
    output: "ReviewSchema: round, rendered, checks[], facts, design, sentBack[]",
  },
];

export function roleCardFor(stage: LegacyStage): RoleCard {
  const card = CARDS.find(item => item.stage === stage);
  if (!card) throw new Error(`No role card for ${stage}.`);
  return card;
}
/** The card for a stage in a run of this mode: an exact copy's data stage is the chart rebuilder. */
export const roleCardIn = (stage: LegacyStage, mode: PostMode): RoleCard => mode === "exact" && stage === "data" ? EXACT_DATA_CARD : roleCardFor(stage);

/** An exact copy's data stage: the charts the copier boxed, redrawn from real data (exact-data.ts). */
export const EXACT_DATA_CARD: RoleCard = {
  stage: "data", title: "Chart rebuilder", by: "data",
  job: "Rebuild each chart the copier boxed on the original post from real data, so Engine draws it in our chart style: the same chart, with the same numbers.",
  rules: [
    "One chart for each boxed slide, the same chart as the original: a line chart for series over time, a bar chart for one value per bar. Never add a chart or change what one shows",
    "The same series and scaling (absolute values, indexed to an event, percent change), the same start and end dates (from and to), the same marked events and shaded period",
    "The chart's words (series names, bar labels, marker and band labels) word for word from the original, translated faithfully when the page's language differs. Brand and product names stay as they are",
    "Values the original prints (on its bars, at its points, in its labels) are copied exactly as printed, as a typed series",
    "A series over time comes from its real source: FRED or the S&P 500 history through your tools, or a table on a page the original or its caption cites, typed exactly. Search for the source the chart names",
    "Never read values off the picture, estimate them or fill gaps. When you can't find the real numbers, put the slide under missing with the reason: it stays cut from the original",
    "A chart we can't draw goes under missing too: a pie, a map, a scatter plot, a table, a dashboard, or bars in two or more series",
    "Bar charts: the bars in the original's order; highlight the ones it sets apart in another color. unit: the suffix or prefix the original prints (%, $, K, M, B, pts)",
    "Each chart's source says where the numbers come from and the dates shown",
  ],
  bar: "Side by side with the original, each chart shows the same thing with the same numbers, in our style.",
  output: "ExactDataSchema: charts[] {slide, chart, source}, missing[] {slide, why}, notes[]",
};


/**
 * A system prompt for an exact copy: the page's name and language and what an
 * exact copy keeps, but not the page's voice or house rules, which would
 * reword the original. `card` is the transcript card by default; the critic
 * passes its own job and rules.
 */
export function exactPrompt(profile: PageProfile, extra = "", card: Pick<RoleCard, "title" | "job" | "rules" | "bar"> = roleCardFor("transcript")): string {
  const language = profile.language === "es" ? "Spanish" : "English";
  // The copier and the critic both need the page's own Follow line and its limit.
  const follow = `Our Follow page stands in for the original's follow slide. Its first line is always "${profile.followCta.line1}". Its second line keeps the original's words only as far as they fit in ${profile.followCta.maxChars} characters, so a shorter second line there is right, not a missing word`;
  return [
    `You are the ${card.title.toLowerCase()} on the team that rebuilds Instagram posts for ${profile.name} (${profile.handle}), whose posts are in ${language}. This run is an exact copy: the original post, rebuilt as it is in our template.`,
    language === "English" ? "" : `Slide text and the caption are in ${language}. Write notes, reasons and summaries for the team in English.`,
    profile.language === "es" ? "Keep proper accents and punctuation: á é í ó ú ñ, opening ¿ and ¡, and accents on capitals (MÁS, not MAS)." : "",
    `Your job: ${card.job}`,
    `Rules:\n${card.rules.map(rule => `- ${rule}`).join("\n")}`,
    `What an exact copy keeps:\n${[...EXACT_RULES, follow].map(rule => `- ${rule}`).join("\n")}`,
    `Quality bar: ${card.bar}`,
    extra,
  ].filter(Boolean).join("\n\n");
}

/** The card as a system prompt, with the page's own voice and rules. `title` names one role of a shared card (the fact critic). */
export function rolePrompt(stage: LegacyStage, profile: PageProfile, extra = "", title?: string): string {
  if (stage === "transcript") return exactPrompt(profile, extra);
  const card = roleCardFor(stage);
  const language = profile.language === "es" ? "Spanish" : "English";
  return [
    `You are the ${title ?? card.title.toLowerCase()} on the team that recreates Instagram posts for ${profile.name} (${profile.handle}), written in ${language}. ${profile.voice}`,
    language === "English" ? "" : `Only slide text and the caption are in ${language}. Write notes, reasons and summaries for the team in English.`,
    `Your job: ${card.job}`,
    `Rules:\n${card.rules.map(rule => `- ${rule}`).join("\n")}`,
    `House rules for this page:\n${[...HOUSE_RULES, ...profile.rules].map(rule => `- ${rule}`).join("\n")}`,
    `Quality bar: ${card.bar}`,
    extra,
  ].filter(Boolean).join("\n\n");
}

