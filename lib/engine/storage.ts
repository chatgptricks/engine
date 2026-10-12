import type { Curation, SlideStyle, Story, StoryImage } from "./types";
import type { Channel } from "./channels";

/**
 * localStorage adapter for the Engine tool. Curation lives under
 * the `gf-` namespace, keyed by story id, so it's easy to grep and never
 * collides with the `creator-` content-system keys or any future tool.
 *
 * This is the ONLY module that touches the browser store. If we ever move
 * curation to a backend, this is the single file that swaps — the
 * in-memory `Curation` shape (lib/engine/types.ts) stays identical.
 */

const KEY = (storyId: string) => `gf-curation-${storyId}`;

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / privacy mode — fail silent */
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

/** Read a story's saved curation, or null when nothing's been persisted. */
export function loadCuration(storyId: string): Curation | null {
  const raw = safeGet(KEY(storyId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Curation>;
    const selectedImageIds = Array.isArray(parsed.selectedImageIds)
      ? parsed.selectedImageIds.filter((x): x is string => typeof x === "string")
      : [];
    return {
      selectedImageIds,
      // `order` is kept equal to selectedImageIds; fall back to it if an
      // older payload omitted the mirror.
      order: Array.isArray(parsed.order)
        ? parsed.order.filter((x): x is string => typeof x === "string")
        : selectedImageIds,
      captionEdited:
        typeof parsed.captionEdited === "string" ? parsed.captionEdited : null,
      publishedAt:
        typeof parsed.publishedAt === "string" ? parsed.publishedAt : null,
      slideStyles:
        parsed.slideStyles && typeof parsed.slideStyles === "object"
          ? (parsed.slideStyles as Record<string, SlideStyle>)
          : {},
    };
  } catch {
    /* corrupted entry — ignore, defaults win */
    return null;
  }
}

export function saveCuration(storyId: string, curation: Curation): void {
  safeSet(KEY(storyId), JSON.stringify(curation));
}

export function clearCuration(storyId: string): void {
  safeRemove(KEY(storyId));
}

/**
 * Stories created locally via the Create flow live here (the mock feed is
 * read-only). When a real research backend lands, these become rows it
 * fulfills. Attached images are stored inline as data URLs, so this can be
 * large — the write fails silently if it ever exceeds quota (the story still
 * lives in memory for the session).
 */
const CREATED_KEY = "gf-created-stories";

export function loadCreatedStories(): Story[] {
  const raw = safeGet(CREATED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Story[]) : [];
  } catch {
    return [];
  }
}

export function saveCreatedStories(stories: Story[]): void {
  safeSet(CREATED_KEY, JSON.stringify(stories));
}

/**
 * Ids the curator has deleted. The store filters these out of the merged feed,
 * so delete works for ANY story — created, scheduled (Supabase), or seed —
 * without needing to mutate the seed file. Created stories are also dropped
 * from CREATED_KEY; this set is the universal "hidden" overlay.
 */
const DELETED_KEY = "gf-deleted-ids";

export function loadDeletedIds(): string[] {
  const raw = safeGet(DELETED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveDeletedIds(ids: string[]): void {
  safeSet(DELETED_KEY, JSON.stringify(ids));
}

/**
 * Per-story image edits from the chat's vision curation (curate_images):
 * gallery images judged off-topic get removed, kept ones get rewritten
 * descriptions. An overlay (like uploads/deleted-ids) so it works for ANY
 * story without mutating seed or server rows.
 */
const IMG_EDITS_PREFIX = "gf-imgedits-";

export interface ImageEdits {
  removed: string[];
  desc: Record<string, string>;
}

export function loadAllImageEdits(): Record<string, ImageEdits> {
  if (typeof window === "undefined") return {};
  const out: Record<string, ImageEdits> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(IMG_EDITS_PREFIX)) continue;
      const raw = safeGet(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as ImageEdits;
        if (parsed && Array.isArray(parsed.removed) && parsed.desc)
          out[key.slice(IMG_EDITS_PREFIX.length)] = parsed;
      } catch {
        /* skip corrupt entry */
      }
    }
  } catch {
    /* noop */
  }
  return out;
}

export function saveImageEdits(storyId: string, edits: ImageEdits): void {
  safeSet(`${IMG_EDITS_PREFIX}${storyId}`, JSON.stringify(edits));
}

/** Drop a story's image edits (used when the story is deleted). */
export function removeImageEdits(storyId: string): void {
  safeRemove(`${IMG_EDITS_PREFIX}${storyId}`);
}

/**
 * The curator's own uploaded media, kept per-story under `gf-uploads-<id>` so
 * uploads work for ANY story (seed, scheduled, or created). The store overlays
 * them onto each story's image pool. Stored inline as data URLs today; swaps to
 * cloud-storage URLs once the storage layer lands (Instagram-publish-ready).
 */
const UPLOAD_PREFIX = "gf-uploads-";

export function loadAllUploads(): Record<string, StoryImage[]> {
  if (typeof window === "undefined") return {};
  const out: Record<string, StoryImage[]> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(UPLOAD_PREFIX)) continue;
      const raw = safeGet(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
          out[key.slice(UPLOAD_PREFIX.length)] = parsed as StoryImage[];
      } catch {
        /* skip corrupt entry */
      }
    }
  } catch {
    /* noop */
  }
  return out;
}

/** One story's uploads (used at delete time to clean up cloud files). */
export function loadUploads(storyId: string): StoryImage[] {
  const raw = safeGet(`${UPLOAD_PREFIX}${storyId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoryImage[]) : [];
  } catch {
    return [];
  }
}

/** Persist a story's uploads. Returns false if it failed (e.g. quota), so the
 * caller can tell the curator. */
export function saveUploads(storyId: string, images: StoryImage[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      `${UPLOAD_PREFIX}${storyId}`,
      JSON.stringify(images),
    );
    return true;
  } catch {
    return false;
  }
}

/** Drop a story's uploads (used when the story is deleted). */
export function removeUploads(storyId: string): void {
  safeRemove(`${UPLOAD_PREFIX}${storyId}`);
}

/**
 * Channels — the Instagram accounts this curator manages, plus which one is
 * currently active (new research is tagged with the active channel).
 */
const CHANNELS_KEY = "gf-channels";
const ACTIVE_CHANNEL_KEY = "gf-active-channel";

export function loadChannels(): Channel[] {
  const raw = safeGet(CHANNELS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Channel[]) : [];
  } catch {
    return [];
  }
}

export function saveChannels(channels: Channel[]): void {
  safeSet(CHANNELS_KEY, JSON.stringify(channels));
}

export function loadActiveChannelId(): string | null {
  return safeGet(ACTIVE_CHANNEL_KEY);
}

export function saveActiveChannelId(id: string | null): void {
  if (id) safeSet(ACTIVE_CHANNEL_KEY, id);
  else safeRemove(ACTIVE_CHANNEL_KEY);
}
