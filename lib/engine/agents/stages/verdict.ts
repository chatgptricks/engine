/**
 * Stage 3, verdict (build step B): the gate between research and making the
 * post. For now it follows the research's recommendation; build step B adds
 * the page profile's limits (how old is stale, how much coverage is
 * saturated). The orchestrator holds the gate: a stage that reads the verdict
 * runs only once it says proceed, or a person answers it so. Its role card is
 * ../cards/verdict.ts; the run card's panel is
 * components/template-editor/recreate-verdict.tsx.
 */
import { need, type StageRunner } from "../context";
import type { Link, Research, Verdict } from "../schemas";

export const verdict: StageRunner = async context => {
  const found = need<Research>(context.file, "research");
  const evidence: Link[] = [
    ...(found.origin.url ? [{ title: found.origin.who || "The original", url: found.origin.url }] : []),
    ...found.fabrication.flatMap(sign => sign.sources),
    ...found.worth.covered.by,
  ].filter((link, index, all) => all.findIndex(other => other.url === link.url) === index).slice(0, 8);
  return { output: { outcome: found.recommendation.outcome, reason: found.recommendation.reason, evidence, answer: null } satisfies Verdict };
};
