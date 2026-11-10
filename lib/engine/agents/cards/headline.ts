/** Build step C: the headline card, shared by the copywriter and the translator. The stage is ../stages/headline.ts. */
import { DATA_RULE, type RoleCard } from "./card";

export const HEADLINE_CARD: RoleCard = {
  stage: "headline", title: "Headlines", by: "headline",
  job: "Write the cover's headline options, the team's headline model first and the copywriter's lines beside them, and put them in the order decision 1 sets.",
  rules: [
    "The headline model writes five options from the checked story and the original's headline; its list includes the original (ORIGINAL) and a light edit of it (EDIT). The copywriter adds at least two lines of its own with the headline engine, and writes them all when the model isn't set up or doesn't answer",
    "Decision 1: when the post performs (about 1.5 times its page's usual numbers) and its headline passed the check, the original's headline leads, word for word; a page in another language gets a faithful translation. The writers' options follow",
    "A headline that failed the check is never offered. When the post performs, its light edit goes first, once it no longer carries what failed; the correction is in the brief",
    "Otherwise the headline model's options lead, in its order",
    "Every line is true to the brief's guardrails: an alleged claim worded as an allegation, only numbers safe to print, names as they are spelled",
    "A Spanish page gets the model's English lines in natural Spanish, never word for word, with accents on capitals",
    "Autopilot takes the first option that fits the cover. Only a person's pick goes back to the headline model, and Engine sends it",
    DATA_RULE,
  ],
  bar: "The first option is the one we'd put on the cover, and every option would survive a fact-checker.",
  output: "HeadlinesSchema: options[] {text, framework, by (original, headline-model, copywriter or agent), english}, source, lead (original or model), performing, story, modelOptions[], note",
};
