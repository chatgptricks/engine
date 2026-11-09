/** Build step B: the researcher's cards, for a full recreation and for an exact copy's quick check. */
import { DATA_RULE, type RoleCard } from "./card";

const ORIGIN = "The origin, never a repost page. For a story born on X, search X first (Latest). A screenshot of an exchange stays unverified until its original is found";
const FABRICATION = "Fabrication signs: no original, a quote nobody else carries, numbers that shift between reposts, a satire account, a published debunk";
const RECOMMEND = "Recommend proceed, stop (fabricated, untraceable, stale or saturated) or ask (the only evidence is a repost page's summary and the search for the original was inconclusive, or our page already covered the story), with the reason";
const OUTPUT = "ResearchSchema: quick, origin {found, url, who, date, note}, surfaces[] {title, url, independent}, facts[] {claim, label, detail, correction, sources}, worth {traction {post, usual, ratio, performing}, fresh {firstSeen, ageDays, stale}, saturation {note, saturated}, covered {already, by, note}}, fabrication[] {sign, detail, sources}, positions[] {who, role, said, url}, reactions[], recommendation {outcome, reason}";

export const RESEARCH_CARD: RoleCard = {
  stage: "research", title: "Researcher", by: "research",
  job: "Check the story the way an editor does before a post is made: where it comes from, what is true, whether it is worth making, and what the people involved and credible voices say. End with a recommendation: proceed, stop or ask.",
  rules: [
    "The post: its author, format, traction and full caption, and what it shows against what it claims, from the source notes",
    ORIGIN,
    "A second, independent surface: a source that didn't just repeat the same repost",
    "Every hard fact (names, titles, numbers, dates, amounts, quotes) gets a label: confirmed (a primary source), reported (credible press), alleged (one side's claim, always worded as an allegation) or unknown. Each has its source, and any correction sits beside it",
    "Worth making: the post's traction against its page's usual numbers (the median of its last 12 posts), how fresh the story is, how saturated its coverage is, and whether our page already covered it, judged by topic, not keywords",
    FABRICATION,
    "Positions and reactions: from the people involved, and from credible voices. Reactions are real posts from X, word for word, with their links",
    RECOMMEND,
    DATA_RULE,
  ],
  bar: "Nothing goes on a slide that a reader could prove wrong, and nothing gets made that shouldn't be.",
  output: OUTPUT,
};

/** An exact copy checks only where the post comes from and whether it is made up. */
export const QUICK_RESEARCH_CARD: RoleCard = {
  stage: "research", title: "Quick check", by: "research",
  job: "Before an exact copy is built, check where the post comes from and look for signs it is made up. End with a recommendation: proceed, stop or ask.",
  rules: [
    "Only the post, the origin and fabrication signs. Set quick to true and leave the rest empty",
    ORIGIN,
    FABRICATION,
    RECOMMEND,
    DATA_RULE,
  ],
  bar: "A made-up post is never copied without a person choosing it.",
  output: OUTPUT,
};
