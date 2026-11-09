/** Build step C: the checkpoint's card. */
import type { RoleCard } from "./card";

export const APPROVAL_CARD: RoleCard = {
  stage: "approval", title: "Checkpoint", by: "human",
  job: "A person checks the plan, picks the headline and approves before the designer builds anything. Autopilot takes the plan as written and the first headline that fits the cover.",
  rules: [
    "Reorder, cut or add slides, and change what each one tells the reader",
    "Pick one of the headline options, or write one",
    "Add posts from X by link before approving; nothing reruns",
    "Notes go to the designer",
  ],
  bar: "Nothing gets built that a person wouldn't approve.",
  output: "PlanApprovalSchema: plan {slides[], why}, headline {text, option}, notes",
};
