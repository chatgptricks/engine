/** Build step C: the checkpoint's card. Its helpers are at the bottom of ../stages/headline.ts. */
import type { RoleCard } from "./card";

export const APPROVAL_CARD: RoleCard = {
  stage: "approval", title: "Checkpoint", by: "human",
  job: "A person checks the plan, picks the headline and approves before the designer builds anything. Autopilot takes the plan as written and the first headline that fits the cover.",
  rules: [
    "Reorder, cut or add slides, and change what each one tells the reader. The plan keeps real posts from the research (at most three a slide) and at most 20 slides",
    "Pick one of the headline options, or write one under 200 characters. The original's headline is marked, and says when it leads because the post is performing",
    "Add posts from X by link before approving; nothing reruns",
    "Notes go to the designer",
    "Only a person's pick goes back to the headline model: which of its options they chose, or the line they wrote",
  ],
  bar: "Nothing gets built that a person wouldn't approve.",
  output: "PlanApprovalSchema: plan {slides[], why}, headline {text, option (-1 for one written by hand)}, notes",
};
