/**
 * The taxonomy of post TYPES (the Territory veins from the finder prompt) and
 * the ALIGNMENT territories (from the alignment layer). Framework-agnostic so it
 * is shared by the server (prompt + research route) and the client (home
 * research buttons + the type badge on a story).
 *
 * Keep the ids stable: they are written into stories, the prompt, and the
 * submit_story schema. The labels/blurbs are display + prompt copy.
 */

export interface PostType {
  id: string;
  label: string;
  /** One-line description, used in the prompt and as the button tooltip. */
  blurb: string;
  /** Extra type-specific steering appended to the engine's TYPE FOCUS —
   * for veins whose hunting rules differ from the default editorial DNA. */
  focus?: string;
}

/** The six veins of Part 1 (The Territory), as selectable post types. */
export const POST_TYPES: PostType[] = [
  {
    id: "tradition",
    label: "Tradition",
    blurb:
      "A contemplative tradition made specific — a named practice, lineage, temperament, diagnostic system, ritual object, or monastic technology.",
  },
  {
    id: "mind",
    label: "Mind",
    blurb:
      "The hidden architecture of mind and perception — how attention, emotion, memory, or the nervous system works, told through a concrete finding or phenomenon.",
  },
  {
    id: "object",
    label: "Object & Place",
    blurb:
      "An object or place that carries meaning — an artifact, building, painting, garment, or natural formation that encodes a worldview.",
  },
  {
    id: "frontier",
    label: "Frontier",
    blurb:
      "Frontier technology that resurfaces an ancient question — a real technology that, without forcing it, echoes something a tradition already knew or asked.",
  },
  {
    id: "culture",
    label: "Culture",
    blurb:
      "A cultural artifact as psychological architecture — a film, artwork, or piece of music read as a map of inner life.",
  },
  {
    id: "craft",
    label: "Craft",
    blurb:
      "A precise challenge inside the making of a specific product, and exactly how it was solved — features, manufacturing, supply chain, psychology, usability, accessibility, or market, from any era.",
    focus:
      "Hunt for the making-of story: ONE named product or system, ONE nuanced challenge inside its creation — a feature that wouldn't work, a manufacturing or supply-chain wall, a societal-approach or conditioning problem, a psychological, usability, or accessibility puzzle, an innovation or market-trend bind — and the SPECIFIC solution that overcame it. Name the maker who made the call where the record supports it (the designer, engineer, or operator), and capture the insight that unlocked it. Any age of human technology qualifies, ancient workshops to modern operations. Calibration examples of the shape (verify everything fresh, never from memory): how Apple's operations under Tim Cook locked up touchscreen supply by pre-buying component capacity; how Teenage Engineering engineered the tactile tape-reel feel of its recorder; how server and network designs borrowed from beehive and swarm behavior. Both the challenge AND the solution must be verifiable in real sources (interviews, patents, teardowns, engineering retrospectives, biographies, case studies) — if the solution story is folklore that can't be traced, kill it.",
  },
  {
    id: "tech",
    label: "Tech",
    blurb:
      "Recent technology news or a release, earned by a contemplative angle that reopens an old question (most often tech-overt). Verify against current live sources.",
  },
  {
    id: "pulse",
    label: "Pulse",
    blurb:
      "THE technology moment right now — the dominant release, launch, or breakthrough of the last few days, told through the calm lens.",
    focus:
      "For this vein, INVERT the usual hiddenness instinct: do not avoid the dominant story — go find it. Search the live web for what is dominating the technology conversation TODAY (a major model or product release, a landmark scientific result, an industry-shaking event from roughly the last 72 hours — verify the date from primary announcements and current coverage, never from memory). Then satisfy the hiddenness gate INSIDE the big story: surface the under-discussed detail, mechanism, number, design decision, or old question reopened that everyone scrolling past the headline missed. Recency is mandatory: if the best candidate is older than about a week, it is dead — pick the freshest story that clears verification, even if its contemplative angle is thinner than usual.",
  },
];

export const POST_TYPE_IDS = POST_TYPES.map((t) => t.id);

export function postType(id: string | undefined | null): PostType | undefined {
  return id ? POST_TYPES.find((t) => t.id === id) : undefined;
}

export function postTypeLabel(id: string | undefined | null): string | null {
  return postType(id)?.label ?? null;
}

/**
 * Pick the next type to recommend: the Territory vein least represented among
 * the stories surfaced so far (ties broken by the canonical order above), so the
 * feed keeps rotating across all six veins instead of leaning on whichever is
 * easiest. With no stories yet, returns the first vein.
 */
export function recommendNextType(
  recentTypeIds: Array<string | undefined | null>,
): PostType {
  const counts = new Map<string, number>(POST_TYPES.map((t) => [t.id, 0]));
  for (const id of recentTypeIds) {
    if (id && counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best = POST_TYPES[0];
  for (const t of POST_TYPES) {
    if ((counts.get(t.id) ?? 0) < (counts.get(best.id) ?? 0)) best = t;
  }
  return best;
}

/** The three editorial territories from the alignment layer. */
export type AlignmentTerritory = "sponsorable" | "audience-shaping" | "pure";

export interface Alignment {
  id: AlignmentTerritory;
  label: string;
}

export const ALIGNMENTS: Alignment[] = [
  { id: "pure", label: "Pure" },
  { id: "audience-shaping", label: "Audience-shaping" },
  { id: "sponsorable", label: "Sponsorable" },
];

export function alignmentLabel(id: string | undefined | null): string | null {
  return id ? (ALIGNMENTS.find((a) => a.id === id)?.label ?? null) : null;
}
