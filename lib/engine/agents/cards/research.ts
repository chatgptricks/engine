/** Build step B: the researcher's cards, for a full recreation and for an exact copy's quick check. */
import { DATA_RULE, type RoleCard } from "./card";

const POST = "The post: its author, format, traction and full caption, and what it shows against what it claims, from the source notes";
const ORIGIN = "The origin: the first post or article, never a repost page. For a story born on X, search X first: search_x sorted by Latest, with X's operators (from:handle, \"an exact phrase\", until:YYYY-MM-DD) and a low like floor, then read the post itself with x_post. A screenshot of an exchange (posts, replies, messages, emails) stays unverified until you have read its original";
const FABRICATION = "Fabrication signs, each with its detail and sources: no_original (the story makes a claim and its original can't be found), lone_quote (words put in a named person's mouth that no other source carries), shifting_numbers (numbers that change between versions), satire_account, debunked (a published debunk), other. Count a missing original once: when all that's wrong is that the original can't be found, no_original is the only sign. A meme or a tip makes no claim, so it needs no original. Once the origin is found, no_original is not a sign";
const recommend = (stops: string, asks: string) =>
  `Recommend proceed, stop or ask, with the reason. Stop: ${stops}. Ask: ${asks}. Else proceed`;
const OUTPUT = "ResearchSchema: quick, origin {found, url, who, date, note}, surfaces[] {title, url, independent}, facts[] {claim, label, detail, correction, sources}, worth {traction {post, usual, ratio, performing}, fresh {firstSeen, ageDays, stale}, saturation {note, saturated}, covered {already, by, note}}, fabrication[] {sign, detail, sources}, positions[] {who, role, said, url}, reactions[], recommendation {outcome, reason}";

export const RESEARCH_CARD: RoleCard = {
  stage: "research", title: "Researcher", by: "research",
  job: "Check the story the way an editor does before a post is made: where it comes from, what is true, whether it is worth making, and what the people involved and credible voices say. End with a recommendation: proceed, stop or ask.",
  rules: [
    POST,
    ORIGIN,
    "A second, independent surface: a source that didn't just repeat the same repost",
    "Every hard fact (names, titles, numbers, dates, amounts, quotes) gets a label: confirmed (a primary source), reported (credible press), alleged (one side's claim, always worded as an allegation) or unknown. Each has its source, and any correction sits beside it",
    "Worth making: Engine works out the post's traction against its page's usual numbers (the median of its last 12 posts) and applies the page's limits for age and saturation. You give the day the news first broke (none for a timeless post such as a meme or a tip) and how many other Instagram pages already posted it",
    "Whether our page already covered it, from our page's last posts and our library, judged by topic, not keywords: the same story in other words is covered; another story on the same subject isn't. Link what covered it",
    FABRICATION,
    "Positions: from the people involved, and from credible voices, close to their own words, with links",
    "Reactions: real posts from X, found with search_x (sorted by Top, in the page's language and in English) or x_post. Pick them by id with why each is worth a slide; never retype a post",
    recommend(
      "fabricated (debunked, or a satire account), untraceable (no original and another sign), stale or saturated",
      "nothing but a repost page's summary carries the story and the search for the original was inconclusive, or our page already covered it",
    ),
    DATA_RULE,
  ],
  bar: "Nothing goes on a slide that a reader could prove wrong, and nothing gets made that shouldn't be.",
  output: OUTPUT,
};

/** An exact copy checks only where the post comes from and whether it is made up. */
export const QUICK_RESEARCH_CARD: RoleCard = {
  stage: "research", title: "Quick check", by: "research",
  job: "Before an exact copy is built, check where the post comes from and look for signs it is made up. End with a recommendation: proceed, stop or ask. Nothing else: freshness, coverage and reactions don't matter for an exact copy.",
  rules: [
    POST,
    ORIGIN,
    FABRICATION,
    recommend(
      "fabricated (debunked, or a satire account) or untraceable (no original and another sign)",
      "nothing but a repost page's summary carries the post and the search for the original was inconclusive",
    ),
    DATA_RULE,
  ],
  bar: "A made-up post is never copied without a person choosing it.",
  output: OUTPUT,
};
