/**
 * The page's brand guide, for Recreate's team: the brief every role reads, the
 * checks code runs on the finished deck, and the approved example posts the
 * design critic compares our slides with.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { guideBrief, runGuideChecks, type BrandGuide, type GuideCheckKind } from "../../template-editor/brand-guide";
import type { DesignDocument } from "../../template-editor/model";
import { getBrandGuide, guideExampleImages } from "../brand-guides";
import type { PageProfile } from "../page-profiles";
import { imageBlock } from "./claude";
import type { Issue } from "./schemas";

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
