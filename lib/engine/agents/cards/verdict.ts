/** Build step B: the check's card. Engine's own code applies it (../stages/verdict.ts). */
import type { RoleCard } from "./card";

export const VERDICT_CARD: RoleCard = {
  stage: "verdict", title: "The check", by: "code",
  job: "Decide from the research's recommendation and the page's limits whether the post gets made: proceed, stop or ask. A stop or an ask waits for a person.",
  rules: [
    "proceed: the run goes on to the brief, or in an exact copy to the design",
    "stop: the story is debunked or comes from a satire account, or is untraceable (no original, and another sign it is made up); in a full recreation, also when it is stale (it first broke more days ago than the page's limit) or saturated (at least the page's limit of other Instagram pages already posted it). The run stops with the reason and the evidence links, and no deck. A person can build it anyway (the warnings go into the brief's guardrails) or rerun research",
    "ask: the only evidence is a repost page's summary and the search for the original was inconclusive (no original, no other sign, no independent surface), or, in a full recreation, our page already covered the story. The run waits for a person: proceed, stop, or add the original's link, which reruns research with it",
    "The stricter of research's recommendation and these rules wins: stop over ask over proceed. Research's stop on a story whose only problem is the repost-only case becomes an ask, since a person may know the original",
    "An exact copy's quick check goes by the origin and the fabrication signs only",
    "Autopilot doesn't skip the check: a stop still stops, and an ask still pauses",
    "Only a person answers it. An agent answers only on a person's own words",
  ],
  bar: "No fabricated, stale or repeated story becomes a post without a person choosing it.",
  output: "VerdictSchema: outcome, reason, evidence[] {title, url}, answer {choice, by, at, note} or null",
};
