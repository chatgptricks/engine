/**
 * Stage 7, review (build step F): code checks (house, guide and HTML checks),
 * then the fact critic against the brief's guardrails and the design critic
 * (in an exact copy, the fidelity critic) with the original side by side.
 * Must-fix issues go back to the designer: at most two rounds, one for an
 * exact copy. Its role cards are ../cards/review.ts.
 */
import { RecreateError } from "../claude";
import type { StageRunner } from "../context";
import type { ReviewReport } from "../schemas";

/** Fix rounds after the first pass, by mode. The orchestrator never sends work back past them. */
export const MAX_FIX_ROUNDS = 2, MAX_EXACT_FIX_ROUNDS = 1;

/** What the designer hears in a fix round: every issue routed to design, and to keep the rest. */
export function fixInstructions(report: ReviewReport, exact = false): string {
  const issues = [...report.checks, ...(report.facts?.issues ?? []), ...(report.design?.issues ?? [])]
    .filter(issue => issue.route === "design" && issue.severity !== "note");
  return [
    `The ${exact ? "fidelity critic and Engine's checks" : "critics and Engine's checks"} found these problems in the finished post. Fix every one in the same deck; keep everything else exactly as it was.`,
    ...issues.map(issue => `- ${issue.slide ? `Slide ${issue.slide}` : "Whole post"} (${issue.severity === "must_fix" ? "must fix" : "should fix"}): ${issue.problem}. Fix: ${issue.fix}`),
  ].join("\n").slice(0, 4000);
}

export const review: StageRunner = async () => {
  throw new RecreateError("Reviewing the slides isn't built yet (build step F).", 501);
};
