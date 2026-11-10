/**
 * Finding the source of a kept image: the original a screenshot in the post
 * was taken from (an announcement's own picture, a product page's hero), at
 * better quality and without the post's overlays.
 *
 * Candidates are the images on the pages the research and the source notes
 * point to. One counts as the original only when it is the same picture as the
 * cut from the post (its shape within 12%, and a close match in colour at a small size,
 * so a different picture of the same shape never stands in) and has more
 * pixels than the cut. Otherwise the cut from the post is used, and the reason
 * is said.
 */
import sharp from "sharp";

/** A candidate's shape may differ from the cut's by this much (the post's crop trims a little). */
export const MAX_SHAPE_DIFFERENCE = .12;
/**
 * How alike two pictures must be at 32 × 32 in colour (Pearson's r, -1 to 1).
 * Tuned on made-up pages (tests): the same page cropped 3% scores about .96 and
 * with a sticker over 6% of it about .87; another page of the same layout and
 * colours about .80.
 */
export const MIN_LIKENESS = .85;
/** The original must have at least this many times the cut's pixels to be worth swapping in. */
export const MIN_GAIN = 1.3;
const SIDE = 32;

export type Picture = { bytes: Buffer; width: number; height: number };
export type Candidate = Picture & { url: string; page: string };
export type OriginalMatch = { candidate: Candidate; likeness: number; gain: number };

/** A picture as SIDE × SIDE colours (red, green and blue in turn), stretched to the square so two shapes compare point by point. */
async function colours(bytes: Buffer): Promise<Float64Array> {
  const data = await sharp(bytes, { limitInputPixels: 100_000_000 }).rotate().flatten({ background: "#ffffff" }).resize(SIDE, SIDE, { fit: "fill" }).removeAlpha().raw().toBuffer();
  return Float64Array.from(data);
}

/** How alike two pictures look (Pearson's r of their colours at 32 × 32): about 1 for the same picture at any size. */
export async function likeness(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([colours(a), colours(b)]);
  const mean = (values: Float64Array) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const mx = mean(x), my = mean(y);
  let top = 0, vx = 0, vy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    top += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  // A flat picture (one colour) is like nothing.
  return vx && vy ? top / Math.sqrt(vx * vy) : 0;
}

const shapeDifference = (a: Pick<Picture, "width" | "height">, b: Pick<Picture, "width" | "height">) =>
  Math.abs(Math.log((a.width / a.height) / (b.width / b.height)));

/**
 * The best candidate that is the cut's own picture at better quality, or null
 * with why none is. Candidates are compared in order; the most alike wins.
 */
export async function pickOriginal(cut: Picture, candidates: Candidate[]): Promise<{ match: OriginalMatch | null; why: string }> {
  if (!candidates.length) return { match: null, why: "no images turned up on the pages it may come from" };
  let best: OriginalMatch | null = null, shaped = 0, alike = 0;
  for (const candidate of candidates) {
    if (!(candidate.width > 0 && candidate.height > 0) || shapeDifference(cut, candidate) > Math.log(1 + MAX_SHAPE_DIFFERENCE)) continue;
    shaped++;
    const score = await likeness(cut.bytes, candidate.bytes).catch(() => 0);
    if (score < MIN_LIKENESS) continue;
    alike++;
    const gain = candidate.width * candidate.height / (cut.width * cut.height);
    if (gain < MIN_GAIN) continue;
    if (!best || score > best.likeness) best = { candidate, likeness: score, gain };
  }
  if (best) return { match: best, why: "" };
  return {
    match: null,
    why: !shaped ? `none of the ${candidates.length} images on its pages has the screenshot's shape`
      : !alike ? `none of the images on its pages is the picture the screenshot shows`
      : "the original online is no sharper than the screenshot",
  };
}

/** A page or site the source notes name, as a link to read: "openai.com/index/x" → https://openai.com/index/x. Null when it isn't one. */
export function pageLink(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/[)\].,;]+$/, "");
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text) ? `https://${text}` : null;
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}
