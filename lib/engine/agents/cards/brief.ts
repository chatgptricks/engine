/** Build step C: the editor's card. The stage is ../stages/brief.ts. */
import { DATA_RULE, type RoleCard } from "./card";

export const BRIEF_CARD: RoleCard = {
  stage: "brief", title: "Editor", by: "brief",
  job: "Write the brief everyone after you works from (what happened, the backstory, positions and reactions, the accuracy guardrails, the template notes and the links) and plan the slides in the house shape.",
  rules: [
    "Six sections: what happened; the backstory; positions and reactions; accuracy guardrails; the source's template notes, minus anything that failed the check; links, with the original source first",
    "What happened and the backstory: plain sentences from the research, as a reporter would brief them. A claim research couldn't confirm stays worded as unconfirmed; an unknown one stays out",
    "Guardrails: what is only alleged (worded as an allegation, with who alleges it) against what is proven; the numbers safe to print, each with its source; every name as its owner spells it. When a person chose to build the post after the check stopped it or asked about it, the check's warnings go here too",
    "Check the original against the research. Its cover headline fails when a fact in it is corrected, an allegation in it is stated as fact, or a number in it is one we can't print. A headline that fails is left out of the template notes' cover headline, and their not-to-copy list says why, with the correction, as it does for every other claim that fails",
    "Positions and reactions: who said what, close to their own words, each with their link. Links: the first post or article first (never a repost page), then independent sources",
    "The slide plan, in the house shape: the cover; the original's slides in its order (our Follow stands in for its follow slide); the 2-4 questions a reader asks right after the headline (is it real, why now, what it means for them), each answered on its own slide; one or two slides of real reactions from X; then Follow",
    "One idea per slide. Each slide says what it tells the reader and the facts it uses, each from the research. A reaction slide names its posts by id: one long post or one with a photo, two medium ones, or three short ones; posts marked Added by you come first. A chart says what it shows and its source; its numbers come from real data, never read off a picture",
    "Recreate, don't reinvent: keep the original's story and slide order. Fix only what is wrong or out of date",
    "Follow the teammate's notes",
    DATA_RULE,
  ],
  bar: "The designer can build the post from the brief alone, and every fact in it would survive a fact-checker.",
  output: "StoryBriefSchema: topic, angle, originalHeadline, whatHappened, backstory, positions[], guardrails {alleged, numbers, names, warnings}, template (the source's template notes; a cover headline that failed the check is left out, with why on avoid), links[] (the original source first), slides[] {kind, purpose, points, original, chart, reactionIds, photo}, why",
};
