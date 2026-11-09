/** Build step C: the headline card. */
import type { RoleCard } from "./card";

export const HEADLINE_CARD: RoleCard = {
  stage: "headline", title: "Headlines", by: "headline",
  job: "Gather the cover's headline options from the team's headline model, in the order that sells the post best.",
  rules: [
    "Ask the headline model for five options from the checked story and the original headline; it returns ORIGINAL and EDIT options",
    "When the post performs (about 1.5 times its page's usual numbers) and its headline passed the check, the original's headline leads, word for word; a Spanish page gets a faithful translation. The headline model's options follow",
    "A headline that failed the check never leads: the model's light edit goes first, and the correction goes in the brief",
    "Autopilot takes the first option that fits the cover",
    "Only a person's pick goes back to the headline model",
  ],
  bar: "The first option is the one we'd put on the cover.",
  output: "HeadlinesSchema: options[] {text, framework, by, english}, source, lead, performing, story, modelOptions[], note",
};
