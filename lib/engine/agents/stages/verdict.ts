/**
 * Stage 3, verdict (build step B): the gate between research and making the
 * post, in Engine's own code. It goes by research's recommendation and by the
 * rules below, the page profile's limits among them (`check`: how many days
 * make a story stale, how many other pages make it saturated), and takes the
 * stricter of the two: stop over ask over proceed.
 *
 *  stop: debunked, or from a satire account; untraceable (no original, and
 *        another sign it is made up); in a full recreation, stale or saturated.
 *  ask:  the only evidence is a repost page's summary and the search for the
 *        original was inconclusive (no original, no other sign, no independent
 *        surface); in a full recreation, our page already covered the story.
 *
 * Research's stop softens to an ask when the repost-only case is all there is:
 * a person may know the original. An exact copy's quick check has no worth
 * rules. The orchestrator holds the gate: a stage that reads the verdict runs
 * only once it says proceed, or a person answers it so. Its role card is
 * ../cards/verdict.ts; the run card's panel is
 * components/template-editor/recreate-verdict.tsx.
 */
import { checkLimits, DEFAULT_CHECK, type PageProfileCheck } from "../../page-profiles";
import type { PostMode } from "../../post-files";
import { need, type StageRunner } from "../context";
import type { Link, Research, Verdict, VerdictOutcome } from "../schemas";
import { daysSince } from "./research";

/** One reason the check found to stop or ask, with the links that show it. */
export type Finding = { outcome: Exclude<VerdictOutcome, "proceed">; reason: string; links: Link[]; repostOnly?: true };
export type VerdictOptions = { mode: PostMode; limits?: PageProfileCheck; now?: number };

const RANK: Record<VerdictOutcome, number> = { proceed: 0, ask: 1, stop: 2 };
const MAX_EVIDENCE = 8;
/** A reason when neither research nor the findings give one. */
const FALLBACK: Record<VerdictOutcome, string> = { proceed: "Nothing stops it", ask: "Research wants a person to decide", stop: "Research recommends not making it" };
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const trimmed = (value: string) => value.trim().replace(/[.\s]+$/, "");
const SIGN_WORDS: Record<Research["fabrication"][number]["sign"], string> = {
  no_original: "no original could be found", lone_quote: "its quote has no other source", shifting_numbers: "its numbers change between versions",
  satire_account: "it comes from a satire account", debunked: "it has been debunked", other: "something else looks off",
};

/** How many days ago the story first broke: research's count, else from its first-seen date; null for a timeless post. */
export function storyAge(fresh: Research["worth"]["fresh"], now = Date.now()): number | null {
  return typeof fresh.ageDays === "number" && Number.isFinite(fresh.ageDays) ? Math.max(0, Math.round(fresh.ageDays)) : daysSince(fresh.firstSeen, now);
}

/** What the check found besides research's own call, in the order it reports them. */
export function verdictFindings(found: Research, { mode, limits = DEFAULT_CHECK, now = Date.now() }: VerdictOptions): Finding[] {
  const findings: Finding[] = [], signs = found.fabrication;
  const signed = (kind: string) => signs.filter(sign => sign.sign === kind);
  const said = (list: typeof signs) => list.map(sign => trimmed(sign.detail)).filter(Boolean).join("; ");
  for (const [kind, words] of [["debunked", "It has been debunked"], ["satire_account", "It comes from a satire account"]] as const) {
    const list = signed(kind);
    if (list.length) findings.push({ outcome: "stop", reason: said(list) ? `${words}: ${said(list)}` : words, links: list.flatMap(sign => sign.sources) });
  }
  const missing = signed("no_original"), others = signs.filter(sign => sign.sign !== "no_original");
  if (missing.length && others.length) {
    const why = [...new Set(others.map(sign => SIGN_WORDS[sign.sign]))].join(", and ");
    findings.push({ outcome: "stop", reason: `Untraceable: no original could be found, and ${why}`, links: signs.flatMap(sign => sign.sources) });
  } else if (missing.length && !found.surfaces.some(surface => surface.independent)) {
    findings.push({
      outcome: "ask", repostOnly: true, links: missing.flatMap(sign => sign.sources),
      reason: `Only a repost page's summary carries it, and the search for the original was inconclusive${said(missing) ? `: ${said(missing)}` : ""}`,
    });
  }
  if (mode === "exact" || found.quick) return findings;

  const { fresh, saturation, covered } = found.worth, age = storyAge(fresh, now);
  if (age !== null ? age > limits.staleAfterDays : fresh.stale) {
    findings.push({
      outcome: "stop", links: [],
      reason: age !== null
        ? `Old news: it first broke ${plural(age, "day")} ago${fresh.firstSeen ? `, on ${fresh.firstSeen}` : ""}, past this page's limit of ${plural(limits.staleAfterDays, "day")}`
        : `Old news: research found it stale${fresh.firstSeen ? `, first seen on ${fresh.firstSeen}` : ""}`,
    });
  }
  if (saturation.saturated) {
    findings.push({ outcome: "stop", links: [], reason: `Saturated: ${trimmed(saturation.note) || "it is already widely posted"}. This page's limit is ${plural(limits.saturatedAfterPages, "other page")}` });
  }
  if (covered.already) {
    const titles = covered.by.map(link => trimmed(link.title)).filter(Boolean).slice(0, 3);
    findings.push({ outcome: "ask", links: covered.by, reason: `Our page already covered it${titles.length ? `: ${titles.join(", ")}` : ""}${trimmed(covered.note) ? `. ${trimmed(covered.note)}` : ""}` });
  }
  return findings;
}

/**
 * The check: research's recommendation and the findings, the stricter wins.
 * The reason is research's own when they agree; else the findings that decided
 * it, then research's own call. The evidence is the original, then the links of
 * what decided it, the fabrication signs' sources, and what covered it.
 */
export function decideVerdict(found: Research, options: VerdictOptions): Verdict {
  const findings = verdictFindings(found, options), own = found.recommendation;
  const worst = findings.reduce<VerdictOutcome>((top, finding) => RANK[finding.outcome] > RANK[top] ? finding.outcome : top, "proceed");
  const softened = own.outcome === "stop" && findings.length > 0 && findings.every(finding => finding.repostOnly);
  const outcome: VerdictOutcome = softened ? "ask" : RANK[own.outcome] >= RANK[worst] ? own.outcome : worst;
  const deciding = findings.filter(finding => finding.outcome === outcome);
  const reason = outcome === own.outcome && own.reason.trim()
    ? own.reason.trim()
    : [...deciding.map(finding => finding.reason), own.reason.trim() ? `Research's own call was to ${own.outcome}: ${trimmed(own.reason)}` : ""].filter(Boolean).join(". ")
      || FALLBACK[outcome];
  const evidence = [
    ...(found.origin.found && found.origin.url ? [{ title: found.origin.who.trim() || "The original", url: found.origin.url }] : []),
    ...deciding.flatMap(finding => finding.links),
    ...found.fabrication.flatMap(sign => sign.sources),
    ...(options.mode === "exact" || found.quick || !found.worth.covered.already ? [] : found.worth.covered.by),
  ].filter(link => link.url).filter((link, index, all) => all.findIndex(other => other.url === link.url) === index).slice(0, MAX_EVIDENCE);
  return { outcome, reason, evidence, answer: null };
}

export const verdict: StageRunner = async context => {
  const found = need<Research>(context.file, "research");
  return { output: decideVerdict(found, { mode: context.file.mode, limits: checkLimits(context.profile) }) satisfies Verdict };
};
