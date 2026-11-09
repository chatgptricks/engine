/** Build step A: the source reader's card, the same in both modes. */
import { DATA_RULE, type RoleCard } from "./card";

export const SOURCE_CARD: RoleCard = {
  stage: "source", title: "Source reader", by: "source",
  job: "Read the original post (its slides, its caption and its details) and write the notes everyone after you works from: what the post is and how it did, what it shows and what it claims, how it looks, and every word and part, slide by slide.",
  rules: [
    "The post: its author (the Instagram page that posted it, never the people shown in it), the format, the date and the full caption, word for word. Its traction (likes, comments and views) comes from the post's details and stays null where they hide it or don't have it; never read it off a slide or guess it",
    "Word for word: every word stays as the original has it, in its own language, with its punctuation, casing, line breaks, spelling, numbers and emoji. Never translate, correct or shorten it; the designer translates. Your own descriptions are in English",
    "Shows vs claims: what the pictures and video show, what the slides and the caption claim, and where the two disagree. A video slide shows only its cover frame, so describe only what is visible",
    "Template notes for the designer: the cover's layout (where the headline and the subject sit, the background, the insets); the headline word for word, with its casing, line breaks, weight and highlighted words; the subject, a cutout or a full photo, with its position and size; and each slide's role and layout in reading order",
    "Their branding (name, handle, logo, watermark, swipe prompts, slide numbers) is recorded so ours replaces it. It is never copied and never part of the post's words",
    "Not to copy: the original's errors and its branding. Claims that fail the check are added after research",
    "Transcript: every word on every slide by its role (headline, title, body, list, label, quote, source, tag), word for word, one sentence or phrase per line",
    "Parts: a tight box (on a 0-1000 grid) around each photo, chart, post from X, logo, screenshot and graphic, with what it is and its words. A post from X also carries its name, @handle, check mark, date, link, and boxes around its profile photo and its own photo",
    DATA_RULE,
  ],
  bar: "Someone who never saw the original could rebuild it from these notes, and knows what not to copy.",
  output: "SourceNotesSchema: post {author {handle, name}, format, date, caption, url, traction {likes, comments, views}}, originalLanguage, shows, claims, mismatch, template {cover {layout, headline {text, casing, lines, weight, highlighted}, subject {kind, what, position, size}, background, insets}, branding, slides[] {index, role, layout}, avoid}, slides[] {index, role, texts[] {role, text}, parts[] {kind, box, what, text, post}}, notes[]",
};
