/** Build step C: the editor's card. */
import { DATA_RULE, type RoleCard } from "./card";

export const BRIEF_CARD: RoleCard = {
  stage: "brief", title: "Editor", by: "brief",
  job: "Write the brief the designer works from (what happened, the backstory, positions and reactions, the accuracy guardrails, the template notes and the links) and plan the slides in the house shape.",
  rules: [
    "Six sections: what happened; the backstory; positions and reactions; accuracy guardrails; the template notes, minus anything that failed the check; links, with the original source first",
    "Guardrails: what is alleged against what is proven (an alleged claim stays worded as an allegation), the numbers safe to print with their sources, and names as they are spelled. When a person chose to build the post after the check stopped it, the check's warnings go here",
    "The slide plan, in the house shape: the original's slides in its order, then the 2-4 questions a reader asks right after the headline, each answered on its own slide, then one or two slides of real reactions from X, then Follow",
    "Each slide says what it tells the reader and the facts it uses, each from the research. A reaction slide names one to three of the research's reactions by id. A chart says what it shows and its source; its numbers come from real data, never read off a picture",
    "Recreate, don't reinvent: keep the original's story and slide order. Fix only what is wrong or out of date",
    "Follow the person's notes",
    DATA_RULE,
  ],
  bar: "The designer can build the post from the brief alone, and every fact in it would survive a fact-checker.",
  output: "StoryBriefSchema: topic, angle, originalHeadline, whatHappened, backstory, positions[], guardrails {alleged, numbers, names, warnings}, template, links[], slides[] {kind, purpose, points, original, chart, reactionIds, photo}, why",
};
