import type { ImageSource, Story, StoryImage, VerificationStatus } from "./types";

/** The story's designated lead image, falling back to the first in the pool. */
export function leadImageOf(story: Story): StoryImage | undefined {
  return story.images.find((i) => i.id === story.leadImageId) ?? story.images[0];
}

/**
 * Route a third-party image URL through our same-origin proxy so it loads
 * reliably on the live site (see app/api/engine/img/route.ts). Local
 * paths and data URIs pass through untouched.
 */
export function proxied(url: string): string {
  if (!url || url.startsWith("/") || url.startsWith("data:")) return url;
  return `/api/engine/img?u=${encodeURIComponent(url)}`;
}

/** "Jun 7, 12:40 PM" — the research-completed subheader format. */
export function formatCompletedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function sourceLabel(source: ImageSource): string {
  switch (source) {
    case "google":
      return "Google";
    case "pinterest":
      return "Pinterest";
    case "apify":
      return "Apify";
    case "cosmos_manual":
      return "Cosmos · manual";
    case "web":
      return "Web";
    case "x":
      return "X";
    case "upload":
      return "Upload";
  }
}

export function verificationLabel(v: VerificationStatus): string {
  switch (v) {
    case "fully_verified":
      return "Fully verified";
    case "partial":
      return "Partial";
    case "unverifiable":
      return "Unverifiable";
  }
}
