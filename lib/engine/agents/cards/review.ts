/** Build step F: the critics' cards, for a full recreation and for an exact copy. */
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
