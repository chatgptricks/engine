/**
 * Build step F: the critics' cards, for a full recreation and for an exact
 * copy, and each critic's own rules (critics.ts hands them to stagePrompt).
 */
import type { RoleCard } from "./card";

const CHECKS = "Code checks first: the house and guide checks, and the HTML checks (text under the brand's minimum size, colors outside the palette, layers off the page, a headline or photo drawn inside HTML)";
const ISSUES = "Each issue names the slide, the problem and the exact fix. Fixes go to design; what nobody can fix, such as text the template fixes, goes to none";
const OUTPUT = "ReviewReportSchema: round, rendered, checks[], facts, design, sentBack[]";

export const REVIEW_CARD: RoleCard = {
  stage: "review", title: "Critics", by: "factCritic",
  job: "Check the finished post: code checks, then the fact critic against the brief's guardrails, and the design critic against the template notes, the guide and its examples, with the original side by side. Send the must-fix issues back to the designer.",
  rules: [
    CHECKS,
    "Fact critic: every claim against the brief's guardrails. An alleged claim worded as fact is must_fix",
    "Design critic: against the template notes, the guide and its examples, with the original side by side",
    ISSUES,
    "At most two fix rounds",
  ],
  bar: "Nothing a reader could catch is left for them to catch.",
  output: OUTPUT,
};

export const EXACT_REVIEW_CARD: RoleCard = {
  stage: "review", title: "Fidelity critic", by: "designCritic",
  job: "Check the exact copy against the original, side by side: the same slides, words and parts, in our style. Send the must-fix issues back to the designer.",
  rules: [
    CHECKS,
    "Anything changed, missing or added is must_fix",
    ISSUES,
    "At most one fix round",
  ],
  bar: "Side by side with the original, nothing differs but the look.",
  output: OUTPUT,
};

/** Every critic: who fixes what, and when the post ships. */
const ROUTES = "Every fix is one the designer can make in the deck or the caption: name the slide, the layer and the change, with route design. Route none is for what only a person can settle (a photo to add by hand, a source to check by hand), and such an issue is a note";
const SHIP = "Verdict ship when nothing is must_fix. Slide numbers are ours, as listed; 0 means the caption or the whole post";

/** The fact critic (a full recreation only): our words against the brief's guardrails. */
export const FACT_CRITIC_RULES = [
  "You read our slides' words and the caption, as Export prints them, with the brief's accuracy guardrails, the story it tells, the approved plan's points and what the original claimed",
  "A claim the guardrails list as alleged, worded as fact on a slide or in the caption, is must_fix: give the wording as an allegation (who says so)",
  "A number, date, amount or ranking that isn't among the guardrails' safe numbers or the plan's points, or differs from them, is must_fix: give the safe number and its source, or say to cut it",
  "A name spelled differently from the guardrails' names is must_fix: give the right spelling",
  "Something the original got wrong (where its media and claims disagree, and the template notes' avoid list) coming back on our slides is must_fix",
  "A claim stated more strongly than the brief supports (reported as done, a rumor as confirmed, one person's view as everyone's) is must_fix. When the brief carries warnings, a person chose to build the post anyway: the slides must not present those claims as settled",
  "Post cards are real posts quoted word for word, in the slide's language or their own: don't fact-check their words; check what we wrote around them",
  ROUTES,
  SHIP,
];

/** The design critic (a full recreation): the slides as drawn, next to the original, against the template notes and the guide. */
export const DESIGN_CRITIC_RULES = [
  "You see the original post's slides, then ours, rendered exactly as Export draws them, shown smaller",
  "Check each of our slides as a reader on a phone would: every word readable, nothing cut off, overflowing or on top of other words, every chart clear (labels readable, ticks not crowded, each line named in words, not by its color alone), even spacing, nothing crowded against the edges",
  "Hold the post to the template notes: the cover keeps the original's composition (its subject, how the headline sits on it, what is highlighted), and the slides keep the original's story and parts, in our template",
  "The original page's own branding (the template notes' branding list: its logo, handle, watermark or page name) never shows on our slides; one that does is must_fix",
  "A photo frame that shows a chart, a table, a diagram, a logo grid or a screenshot of words is must_fix: charts are drawn in HTML from real data and posts from X are our cards, so a picture of either never stands in for them",
  "A grey template placeholder in the Follow page's photo frame is right: a person adds the profile screenshot. Report it, if at all, as a note with route none",
  "Post cards are real posts: never ask to change their words",
  ROUTES,
  SHIP,
];
/** Added when the page follows a brand guide; {name} is the guide's. */
export const DESIGN_CRITIC_GUIDE_RULE = "Hold every slide to the {name} brand guide in your instructions{examples}: colors, type, margins, spacing, the cover and how media sits on the page. Anything that breaks the guide is an issue: name the guide rule it breaks";
/** Added when a photo runs across two slides. */
export const DESIGN_CRITIC_SPAN_RULE = "Slides shown side by side share one photo, split where the slides meet. Check that the halves read as one photo and that the split misses faces and words. A split through a face or words is must_fix: give the share of the photo the first slide should show (0.1 to 0.9)";

/** The fidelity critic (an exact copy): the same post as the original, in our style. */
export const FIDELITY_CRITIC_RULES = [
  "You see the original post's slides, then ours, rendered exactly as Export draws them, shown smaller, with the source notes' transcript of the original and the deck's notes",
  "Every word on each original slide is on our matching slide, in the same order (translated faithfully when the page's language differs; brand and product names stay as they are). A missing, added or changed word is must_fix, naming the exact words. Our Follow page is the one exception: its fixed first line and its limited second line are right as they are",
  "Nothing is cut off, overflowing or unreadable. Text that doesn't fit is must_fix: a page or layout with more room, never fewer words",
  "Each photo (a person, a place, a product, a product's own screen such as an app or a website, a video frame) is a clean cut of the original's: no stray text from the original slide, no border, bar or background around it, and nothing that matters cut off. A bad cut is must_fix, saying which part of the original slide to keep",
  "Everything else is rebuilt in our style, never pasted: a chart, a graphic of words and logos, a screenshot of an article, a headline or a chat, or a post shown as one picture cut from the original is must_fix, saying what to rebuild. The exception is a part the deck's notes say couldn't be rebuilt (a chart whose real numbers weren't found, a graphic too big for a slide): that cut is right, so leave it",
  "A graphic made of parts (a meme of words and photos, a row or grid of logos, a comparison, a diagram with words, an article or a chat) is rebuilt from its parts: its words as text, its logos as clean files, its photos cut one by one, its panels as our cards. Check it against the original: the same words, the same logos in the same order (the right brand for each mark), the same photos, and the same arrangement of panels, rows and grid. A missing or wrong logo is must_fix, naming the brand and its place",
  "A redrawn chart is the original's chart in our chart style: the same kind (line or bar), series, scaling, start and end, marked events, shaded period, labels and printed values. A difference in what it shows is must_fix, naming what differs and what the original shows (for example: it starts in 2022; the original starts in 2020). Our style is right, not a difference: our colors, fonts, background and gridlines, and where the labels sit",
  "A post card shows the original's post: the same name, @handle, check mark, words and photo. A difference is must_fix, naming it. Our card is right, not a difference: the platform's buttons, counts and menus left out, our card's look and size, a post's own words in its own language when the slide's words are translated. A real post found online (the deck's notes give its link) may show its whole text or its photo where the screenshot cut them off: that is right too",
  "In a rebuilt graphic our look is right, not a difference: our fonts, colors and cards, sizes fitted to our page, labels at our smallest text size, and the original's window dots, borders, shadows and cursors left out. A logo that is blurry, tiny or hard to see on our background is should_fix, naming it",
  "Never ask to change, shorten or improve the original's words, and don't judge the story. The template's look is not an issue: its fonts, colors and layout, the cover in capitals, no final periods, and the original page's own branding left out",
  "A grey placeholder in the Follow page's photo frame is fine: a person adds the profile screenshot. Report it, if at all, as a note with route none",
  ROUTES,
  SHIP,
];
