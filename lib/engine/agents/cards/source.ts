/** Build step A: the source reader's card, the same in both modes. */
import { DATA_RULE, type RoleCard } from "./card";

/**
 * The judgment on each part (Ivan, 2026-11-10): not everything needs a full
 * recreation. An official screenshot is usually best kept as it is, or
 * replaced with the original image, and laid out well.
 */
export const IMAGE_RULES = [
  "Decide for each part what our post does with it (treatment), with one line on why (who made it and what it shows), so the team can see the call",
  "rebuild: posts and comments from any platform (X, Reddit, Threads…), charts, memes, chats, graphics made of parts (a comparison, a grid of logos, a diagram with words), a news outlet's article or headline card, and logos (found by name). Code always rebuilds a post from X, a chart and a logo",
  "keep: a company's or product's own official screen, shown as the evidence: its website, announcement or blog page, product or pricing page, docs, an app or store screen, a demo frame; and real photos (people, places, products). It is placed whole, as it is, never redrawn",
  "source: the same kinds as keep, when the cut from the post is small, soft or carries the post's own overlays (its caption, sticker, arrow or logo over it) and the original is likely online (the screenshot shows its address or site, the caption links it, or it's a well-known announcement). We look for the original at better quality and fall back to the cut",
  "origin: for keep and source, the address or site the picture shows or the caption links (a URL bar, a domain, a product page's name), as written; else null",
];

export const SOURCE_CARD: RoleCard = {
  stage: "source", title: "Source reader", by: "source",
  job: "Read the original post (its slides, its caption and its details) and write the notes everyone after you works from: what the post is and how it did, what it shows and what it claims, how it looks, and every word and part, slide by slide.",
  rules: [
    "The post: its author (the Instagram page that posted it, never the people shown in it), the format, the date and the full caption, word for word. Its traction (likes, comments and views) comes from the post's details and stays null where they hide it or don't have it; never read it off a slide or guess it",
    "Word for word: every word stays as the original has it, in its own language, with its punctuation, casing, line breaks, spelling, numbers and emoji. Never translate, correct or shorten it; the designer translates. Your own descriptions are in English",
    "Shows vs claims: what the pictures and video show, what the slides and the caption claim, and where the two disagree. A video slide shows only its cover frame, so describe only what is visible",
    "Template notes for the designer: the cover's layout (where the headline and the subject sit, the background, the insets); the headline word for word, with its casing, line breaks, weight and highlighted words; the subject, a cutout or a full photo, with its position and size; and each slide's role and layout in reading order",
    "Their branding (name, handle, logo, watermark, swipe prompts, slide numbers) is recorded so ours replaces it. It is never copied and never part of the post's words",
    "Not to copy: the original's errors and its own branding. A post or comment it shows from another platform (Reddit, X…) isn't branding: we redraw it as our card, in that platform's own colors and default avatar, so it never goes on this list. Claims that fail the check are added after research",
    "Transcript: every word on every slide by its role (headline, title, body, list, label, quote, source, tag), word for word, one sentence or phrase per line",
    "Parts: a tight box (on a 0-1000 grid) around each photo, chart, post from X, logo, screenshot and graphic, with what it is and its words. A post from X also carries its name, @handle, check mark, date, link, and boxes around its profile photo and its own photo. A Reddit comment's what names its user, its time and its default avatar's color: red, orange, blue or green",
    ...IMAGE_RULES,
    DATA_RULE,
  ],
  bar: "Someone who never saw the original could rebuild it from these notes, and knows what not to copy.",
  output: "SourceNotesSchema: post {author {handle, name}, format, date, caption, url, traction {likes, comments, views}}, originalLanguage, shows, claims, mismatch, template {cover {layout, headline {text, casing, lines, weight, highlighted}, subject {kind, what, position, size}, background, insets}, branding, slides[] {index, role, layout}, avoid}, slides[] {index, role, texts[] {role, text}, parts[] {kind, box, what, text, post, treatment, why, origin}}, notes[]",
};
