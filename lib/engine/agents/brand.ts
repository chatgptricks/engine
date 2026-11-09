/**
 * The page's brand guide, for Recreate's team: the brief every role reads, the
 * checks code runs on the finished deck, the limits the review holds HTML
 * layers to, and the approved example posts the design critic compares our
 * slides with.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { GUIDE_CHECKS, guideBrief, guidePalette, guideTextStyle, runGuideChecks, type BrandGuide, type GuideCheckKind } from "../../template-editor/brand-guide";
import { formatDimensions, type DesignDocument, type HtmlElement } from "../../template-editor/model";
import { hexColor, PLATFORM_COLORS, type Platform } from "../../template-editor/platform-cards";
import { getBrandGuide, guideExampleImages } from "../brand-guides";
import type { PageProfile } from "../page-profiles";
import { imageBlock } from "./claude";
import type { CheckIssue, Issue } from "./schemas";

/** The guide a page follows, or null when it names none (or it can't be read: a run never fails over its guide). */
export async function loadGuide(ownerKey: string, profile: PageProfile): Promise<BrandGuide | null> {
  if (!profile.brandId) return null;
  try {
    return await getBrandGuide(ownerKey, profile.brandId);
  } catch (error) {
    console.warn(`[recreate] brand guide ${profile.brandId} unavailable:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Every role's instructions open with the page's voice (rolePrompt), so the
 * guide's brief goes right after it and reaches the whole team: writers,
 * art director, editor and critics alike.
 */
export function withGuideBrief(profile: PageProfile, guide: BrandGuide | null | undefined): PageProfile {
  if (!guide) return profile;
  return { ...profile, voice: `${profile.voice}\n\nThis page follows the ${guide.name} brand guide below. Everything you make must fit it.\n\n${guideBrief(guide)}` };
}

/**
 * The guide's code checks on a finished deck, as review issues. Checks the
 * house checks already make (final periods, two-line bodies, capitals on the
 * cover) are left to them.
 */
export function guideDeckChecks(document: DesignDocument, profile: PageProfile, guide: BrandGuide | null | undefined): Issue[] {
  if (!guide) return [];
  const skip: GuideCheckKind[] = ["body-length", "upper-cover", ...(profile.format?.noFinalPeriods ?? true ? ["no-final-period" as const] : [])];
  return runGuideChecks(document, guide, { scope: "deck", language: profile.language, skip })
    .map(({ slide, problem, fix, severity, route }) => ({ slide, problem, fix, severity, route }));
}

/**
 * The guide's code checks on a finished deck, for the simpler Recreate's
 * review. The designer built every layer and wrote every word, so every issue
 * goes back to design. In an exact copy the words are the original's: the
 * guide's copy checks become notes nobody acts on. The house checks
 * (review-checks.ts) already cover final periods, two-line bodies and the
 * cover's capitals.
 */
export function reviewGuideChecks(document: DesignDocument, profile: PageProfile, guide: BrandGuide | null | undefined, options: { exact?: boolean } = {}): CheckIssue[] {
  if (!guide) return [];
  const skip: GuideCheckKind[] = ["body-length", "upper-cover", ...(profile.format?.noFinalPeriods ?? true ? ["no-final-period" as const] : [])];
  return runGuideChecks(document, guide, { scope: "deck", language: profile.language, skip }).map(({ slide, problem, fix, severity, check }): CheckIssue =>
    options.exact && GUIDE_CHECKS[check].scope === "copy"
      ? { slide, problem, fix: "Nothing, if the original says it this way: an exact copy keeps the original's words", severity: "note", route: "none" }
      : { slide, problem, fix, severity, route: "design" });
}

/**
 * What the review holds an HTML layer to, in the deck's output pixels: the
 * colors it may draw with, its smallest text and the size of a title. The
 * colors are the guide's and those in the layer's brand variables (Engine
 * sets them from the guide the deck was made with); `withPlatform` adds a
 * platform's own for its card (platform-cards.ts). Without a guide, sizes come
 * from the layer's variables, else a 1080-wide page's 24 px and 56 px; with no
 * colors known, there's no palette to check.
 */
export type ReviewBrand = { name: string; palette: string[]; minText: number; titleSize: number };
const DEFAULT_LIMITS = { width: 1080, minText: 24, title: 56 };
const HEX_IN_VALUE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const COLOR_TOKEN = /^--(?:color-[\w-]+|gradient-[\w-]+|[\w-]+-(?:color|fill))$/;
const hexes = (colors: Iterable<string>) => [...new Set([...colors].map(color => hexColor(color)).filter((color): color is string => Boolean(color)))];

export function reviewBrand(document: Pick<DesignDocument, "format" | "customSize">, guide: BrandGuide | null | undefined, element?: Pick<HtmlElement, "tokens"> | null): ReviewBrand {
  const width = formatDimensions(document).width, tokens = element?.tokens ?? {};
  const number = (name: string) => { const value = parseFloat(tokens[name] ?? ""); return Number.isFinite(value) && value > 0 ? value : undefined; };
  const tokenColors = Object.entries(tokens).flatMap(([name, value]) => COLOR_TOKEN.test(name) ? value.match(HEX_IN_VALUE) ?? [] : []);
  const palette = hexes([...(guide ? guidePalette(guide) : []), ...tokenColors]);
  if (guide) {
    const scale = width / guide.layout.width;
    return { name: guide.name, palette, minText: guide.layout.minTextSize * scale, titleSize: (guideTextStyle(guide, "title")?.size ?? DEFAULT_LIMITS.title) * scale };
  }
  const scale = width / (number("--page-width") ?? DEFAULT_LIMITS.width);
  return { name: "brand", palette, minText: (number("--min-text-size") ?? DEFAULT_LIMITS.minText) * scale, titleSize: (number("--title-size") ?? DEFAULT_LIMITS.title) * scale };
}
/** The brand's colors and a platform's own, for that platform's card. */
export const withPlatform = (brand: ReviewBrand, platform: Platform | null): ReviewBrand =>
  platform ? { ...brand, name: `${brand.name} or ${platform === "x" ? "X" : "Reddit"}`, palette: hexes([...brand.palette, ...PLATFORM_COLORS[platform]]) } : brand;

/** The guide's approved posts as images with their notes, ahead of the critic's own slides. */
export async function guideExampleBlocks(ownerKey: string, guide: BrandGuide | null | undefined): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  if (!guide?.examples.length) return [];
  const images = await guideExampleImages(ownerKey, guide, 3).catch(() => []);
  if (!images.length) return [];
  return [
    { type: "text", text: `Approved ${guide.name} posts from the brand guide. Our slides should look like they belong next to these:` },
    ...images.flatMap((image): Anthropic.Beta.BetaContentBlockParam[] => [
      { type: "text", text: `Example: ${image.name}${image.note ? `. ${image.note}` : ""}` },
      imageBlock({ mediaType: image.mediaType, base64: image.data }),
    ]),
  ];
}
