import type { Story } from "./types";
import { emptyCuration } from "./types";
import seed from "./seed-stories.json";

/**
 * Live seed for the Engine tool.
 *
 * `loadStories()` is the ONE data seam (spec §9). It resolves the two real
 * research outputs the tool itself produced — Sagano and the Antikythera
 * "bronze lump" — baked to `seed-stories.json` so they show on the published
 * site, where the browser's localStorage starts empty. Stories created later
 * via the Create flow are layered on top from localStorage by the store.
 *
 * To go fully dynamic, swap the body for a live story-finder fetch — the UI
 * never changes, because the seed matches the real contract shape exactly
 * (lib/engine/types.ts).
 */
const STORIES = seed as unknown as Story[];

export async function loadStories(): Promise<Story[]> {
  // Fresh copies; per-story curation is owned by localStorage (reset to empty
  // here so the in-memory seed is never mutated by the store).
  return STORIES.map((s) => ({ ...s, curation: emptyCuration() }));
}
