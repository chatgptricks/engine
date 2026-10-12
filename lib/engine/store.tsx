"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loadStories } from "./stories";
import {
  clearCuration,
  loadActiveChannelId,
  loadAllImageEdits,
  loadAllUploads,
  loadChannels,
  loadCreatedStories,
  loadCuration,
  loadDeletedIds,
  loadUploads,
  removeImageEdits,
  removeUploads,
  saveActiveChannelId,
  saveChannels,
  saveCreatedStories,
  saveCuration,
  saveDeletedIds,
  saveImageEdits,
  saveUploads,
  type ImageEdits,
} from "./storage";
import {
  CHANNEL_COLORS,
  newChannelId,
  normalizeHandle,
  type Channel,
} from "./channels";
import {
  loadProfile,
  saveProfile,
  type Profile,
  type SystemPromptSection,
} from "./profile";
import type {
  Curation,
  ResearchStoryPayload,
  SlideStyle,
  Story,
  StoryImage,
  StoryStatus,
} from "./types";
import { emptyCuration } from "./types";
import { postType } from "./post-types";

/** Flatten the editable system-prompt sections into one prompt string. */
function assemblePrompt(sections: SystemPromptSection[]): string {
  return sections.map((s) => `## ${s.label}\n\n${s.content}`).join("\n\n");
}

/**
 * The single store for the Engine tool.
 *
 * `stories` = locally-created stories (newest first) + the mock feed. Curation
 * is the per-story work product. `profile` holds the Instagram handle and the
 * editable system-prompt sections. Every mutation persists to localStorage
 * immediately so a refresh never loses work.
 */

interface CreateInput {
  prompt: string;
  images: StoryImage[];
  attachments: string[];
  /** Optional: force a Territory post-type (used by the Home per-type buttons). */
  requestedType?: string;
  /** Optional: override the card title (else it's derived from the prompt). */
  title?: string;
}

interface SelectionSignal {
  storyId: string;
  imageId: string;
  action: "select" | "deselect";
  position: number;
}

interface EngineStore {
  ready: boolean;
  stories: Story[];
  curations: Record<string, Curation>;
  profile: Profile;

  getStory: (storyId: string) => Story | undefined;
  getCuration: (storyId: string) => Curation;
  effectiveCaption: (story: Story) => string;
  isPublished: (story: Story) => boolean;

  toggleSelect: (storyId: string, imageId: string) => void;
  reorderSelection: (storyId: string, nextOrder: string[]) => void;
  /** The post layout for one slide (image), defaulting to plain. */
  getSlideStyle: (storyId: string, imageId: string) => SlideStyle;
  setSlideStyle: (
    storyId: string,
    imageId: string,
    patch: Partial<SlideStyle>,
  ) => void;
  setCaption: (storyId: string, text: string) => void;
  resetCaption: (storyId: string) => void;
  markPublished: (storyId: string) => void;
  /** Manual status: mark a story published / back to not-published. */
  setPublished: (storyId: string, on: boolean) => void;
  /** Star/favorite a story. */
  toggleStar: (storyId: string) => void;
  /** Set a story aside (kept, but out of the working views). */
  toggleShelved: (storyId: string) => void;

  /** Create a new "researching" story from the Create flow. Returns its id. */
  createStory: (input: CreateInput) => string;
  /** Kick off interactive research focused on one Territory post-type (the Home
   * per-type buttons). Runs entirely client-side through the research route —
   * no scheduler/Supabase needed. Returns the new story id, or null if the type
   * is unknown. */
  startTypeResearch: (typeId: string) => string | null;
  /** Re-run research for a created story that's "researching" or "failed". */
  retryResearch: (storyId: string) => void;
  /** Delete a story from view (created, scheduled, or seed). Persisted. */
  deleteStory: (storyId: string) => void;
  /** Append more images to a story (Apify enrichment). */
  addImages: (storyId: string, images: StoryImage[]) => void;
  /** Add the curator's own uploaded media to a story (works for ANY story
   * type). Returns false if it couldn't be persisted (e.g. localStorage quota). */
  addUploads: (storyId: string, images: StoryImage[]) => boolean;
  /** Apply chat vision-curation verdicts: remove off-topic gallery images and
   * override descriptions. Persisted per-story overlay; works for ANY story. */
  applyImageEdits: (
    storyId: string,
    removals: string[],
    descriptions: Record<string, string>,
  ) => void;

  setInstagram: (handle: string) => void;
  setPromptSection: (key: string, content: string) => void;

  /** The Instagram channels this curator manages. */
  channels: Channel[];
  /** New research is tagged with this channel. Null = untagged. */
  activeChannelId: string | null;
  addChannel: (name: string, handle: string) => Channel | null;
  updateChannel: (id: string, patch: Partial<Channel>) => void;
  /** Remove a channel. Its stories stay (they show under All channels). */
  removeChannel: (id: string) => void;
  setActiveChannel: (id: string | null) => void;
}

// Research reliability: cap each attempt at the route's own ceiling (maxDuration
// = 300s) and auto-retry once on a transient failure before giving up. A run
// always resolves to queue (done) or failed (retryable) — never stuck spinning.
const RESEARCH_TIMEOUT_MS = 300_000;
const RESEARCH_MAX_ATTEMPTS = 2;

const Ctx = createContext<EngineStore | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mockStories, setMockStories] = useState<Story[]>([]);
  const [createdStories, setCreatedStories] = useState<Story[]>([]);
  const [autoStories, setAutoStories] = useState<Story[]>([]);
  const [uploads, setUploads] = useState<Record<string, StoryImage[]>>({});
  const [imageEdits, setImageEdits] = useState<Record<string, ImageEdits>>({});
  const [curations, setCurations] = useState<Record<string, Curation>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>(() => ({
    instagram: "",
    systemPrompt: [],
  }));
  // True once the server-state merge has run — gates write-through so a load
  // race can never PUT an empty snapshot over the durable server copy.
  const hydratedRef = useRef(false);

  // Load feed + created stories, hydrate curation, load profile — once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadStories();
      if (cancelled) return;
      const rawCreated = loadCreatedStories();
      // Recover interrupted research: a "researching" created story on a fresh
      // load means a prior session's run never finished (its in-flight request
      // is gone). Flip it to "failed" so it's never stuck spinning — the curator
      // can Retry or delete it. (Runs started in THIS session aren't reloaded
      // here, so live runs are untouched.)
      let recovered = false;
      const created = rawCreated.map((s) => {
        if (s.status === "researching") {
          recovered = true;
          return {
            ...s,
            status: "failed" as StoryStatus,
            error: "Research was interrupted — retry to run it again.",
          };
        }
        return s;
      });
      if (recovered) saveCreatedStories(created);

      // Local view first (the working copy in this browser).
      let createdMerged = created;
      const hydrated: Record<string, Curation> = {};
      for (const story of [...created, ...loaded]) {
        hydrated[story.id] =
          loadCuration(story.id) ?? story.curation ?? emptyCuration();
      }
      let deletedMerged = loadDeletedIds();
      let chans = loadChannels();
      let act = loadActiveChannelId();
      const imageEditsMerged = loadAllImageEdits();

      // Merge the durable server mirror. After a browser-storage wipe (Safari
      // ITP eviction, "clear data", a new device) the local copies are empty,
      // so the server restores the curator's DESIGNS, created stories, channels,
      // and deletes. When both have a record, the local one wins (it's the live
      // session); deletes are unioned. The merged result is written back to
      // localStorage so the working copy is repopulated.
      const isEmptyCur = (c?: Curation) =>
        !c ||
        ((c.selectedImageIds?.length ?? 0) === 0 &&
          Object.keys(c.slideStyles ?? {}).length === 0 &&
          !c.captionEdited &&
          !c.starred &&
          !c.shelved &&
          !c.publishedAt);
      try {
        const res = await fetch("/api/engine/state");
        if (!cancelled && res.ok) {
          const { state } = (await res.json()) as {
            state: {
              createdStories?: Story[];
              curations?: Record<string, Curation>;
              channels?: Channel[];
              activeChannelId?: string | null;
              deletedIds?: string[];
              imageEdits?: Record<string, ImageEdits>;
            } | null;
          };
          if (state) {
            const localIds = new Set(createdMerged.map((s) => s.id));
            const serverCreated = (state.createdStories ?? []).filter(
              (s) => s && s.id && !localIds.has(s.id),
            );
            if (serverCreated.length) {
              createdMerged = [...createdMerged, ...serverCreated];
              for (const s of serverCreated)
                hydrated[s.id] ??= s.curation ?? emptyCuration();
            }
            for (const [id, cur] of Object.entries(state.curations ?? {})) {
              // Server design wins only when the local one is absent/blank
              // (i.e. a wipe) — never clobber a live local edit.
              if (isEmptyCur(hydrated[id]) && !isEmptyCur(cur)) hydrated[id] = cur;
            }
            deletedMerged = Array.from(
              new Set([...deletedMerged, ...(state.deletedIds ?? [])]),
            );
            if (chans.length === 0 && (state.channels ?? []).length)
              chans = state.channels as Channel[];
            if (!act && state.activeChannelId) act = state.activeChannelId;
            for (const [id, e] of Object.entries(state.imageEdits ?? {})) {
              imageEditsMerged[id] ??= e;
            }
            // Repopulate the local working copy.
            saveCreatedStories(createdMerged);
            for (const [id, cur] of Object.entries(hydrated)) saveCuration(id, cur);
            saveDeletedIds(deletedMerged);
            saveChannels(chans);
            saveActiveChannelId(act);
            for (const [id, e] of Object.entries(imageEditsMerged))
              saveImageEdits(id, e);
          }
        }
      } catch {
        /* offline / not configured — local-only, as before */
      }
      if (cancelled) return;

      setMockStories(loaded);
      setCreatedStories(createdMerged);
      setDeletedIds(new Set(deletedMerged));
      setUploads(loadAllUploads());
      setImageEdits(imageEditsMerged);
      setCurations(hydrated);
      setChannels(chans);
      setActiveChannelId(
        act && chans.some((c) => c.id === act) ? act : (chans[0]?.id ?? null),
      );
      setProfile(loadProfile());
      hydratedRef.current = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stories from the server store (Supabase in production, the dev file store
  // locally) — where the cron AND the type buttons' research-start runs
  // persist. Polled so a "Researching" placeholder and the finished story
  // appear live without a reload: every 10s while something is researching,
  // else every 30s. `pollAutoRef` lets actions trigger an immediate refresh.
  const pollAutoRef = useRef<() => void>(() => {});
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (ms: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, ms);
    };
    const load = () => {
      fetch("/api/engine/auto-stories")
        .then((r) => (r.ok ? r.json() : { stories: [] }))
        .then((j: { stories?: Story[] }) => {
          if (cancelled) return;
          const list = Array.isArray(j.stories) ? j.stories : [];
          setAutoStories((prev) => {
            // Keep local-only stubs the server doesn't know yet: fresh
            // optimistic "researching" cards (write may not have landed),
            // and recent "failed" cards (a rejected start — keep the error
            // visible and retryable instead of letting the card vanish).
            const serverIds = new Set(list.map((s) => s.id));
            const keep = prev.filter((s) => {
              if (serverIds.has(s.id)) return false;
              const age = Date.now() - new Date(s.researchCompletedAt).getTime();
              if (s.status === "researching") return age < 90_000;
              if (s.status === "failed") return age < 15 * 60_000;
              return false;
            });
            return [...keep, ...list];
          });
          if (list.length) {
            setCurations((prev) => {
              const next = { ...prev };
              for (const s of list) {
                if (!next[s.id])
                  next[s.id] =
                    loadCuration(s.id) ?? s.curation ?? emptyCuration();
              }
              return next;
            });
          }
          schedule(
            list.some((s) => s.status === "researching") ? 10_000 : 30_000,
          );
        })
        .catch(() => {
          schedule(30_000); // offline / not configured
        });
    };
    pollAutoRef.current = load;
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Durable write-through: mirror the studio's localStorage state (DESIGNS,
  // created stories, channels, deletes, image edits) to the server, debounced,
  // so a browser-storage wipe can never lose the curator's work again. Gated on
  // hydration so we never overwrite the server copy with an empty load race.
  useEffect(() => {
    if (!ready || !hydratedRef.current) return;
    const t = setTimeout(() => {
      const state = {
        createdStories,
        curations,
        channels,
        activeChannelId,
        deletedIds: Array.from(deletedIds),
        imageEdits,
      };
      void fetch("/api/engine/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [
    ready,
    createdStories,
    curations,
    channels,
    activeChannelId,
    deletedIds,
    imageEdits,
  ]);

  const stories = useMemo(() => {
    // Created (localStorage) + scheduled (Supabase) + the seed feed, deduped by
    // id so nothing doubles.
    const seen = new Set<string>();
    const out: Story[] = [];
    for (const s of [...createdStories, ...autoStories, ...mockStories]) {
      if (seen.has(s.id) || deletedIds.has(s.id)) continue;
      seen.add(s.id);
      // Overlay the curator's own uploads (works for any story type), newest
      // first so they're visible at the top of the gallery.
      const up = uploads[s.id];
      let images =
        up && up.length ? [...up, ...s.images] : s.images;
      // Apply chat-curation edits: drop judged-off-topic images, swap in the
      // vision-written descriptions.
      const edits = imageEdits[s.id];
      if (edits && (edits.removed.length || Object.keys(edits.desc).length)) {
        const removed = new Set(edits.removed);
        images = images
          .filter((im) => !removed.has(im.id))
          .map((im) =>
            edits.desc[im.id] ? { ...im, description: edits.desc[im.id] } : im,
          );
      }
      out.push(images === s.images ? s : { ...s, images });
    }
    return out;
  }, [createdStories, autoStories, mockStories, uploads, imageEdits, deletedIds]);

  // Latest stories, for the typed-research avoid-list (kept in a ref so the
  // research callbacks stay stable).
  const storiesRef = useRef(stories);
  // eslint-disable-next-line react-hooks/refs -- intentional: latest stories for the stable research callback
  storiesRef.current = stories;

  const getCuration = useCallback(
    (storyId: string): Curation => curations[storyId] ?? emptyCuration(),
    [curations],
  );

  const update = useCallback(
    (storyId: string, mutate: (prev: Curation) => Curation) => {
      setCurations((prev) => {
        const current = prev[storyId] ?? emptyCuration();
        const next = mutate(current);
        saveCuration(storyId, next);
        return { ...prev, [storyId]: next };
      });
    },
    [],
  );

  const toggleSelect = useCallback(
    (storyId: string, imageId: string) => {
      update(storyId, (prev) => {
        const has = prev.selectedImageIds.includes(imageId);
        const selectedImageIds = has
          ? prev.selectedImageIds.filter((id) => id !== imageId)
          : [...prev.selectedImageIds, imageId];
        recordSignal({
          storyId,
          imageId,
          action: has ? "deselect" : "select",
          position: has ? -1 : selectedImageIds.length,
        });
        return { ...prev, selectedImageIds, order: selectedImageIds };
      });
    },
    [update],
  );

  const reorderSelection = useCallback(
    (storyId: string, nextOrder: string[]) => {
      update(storyId, (prev) => ({
        ...prev,
        selectedImageIds: nextOrder,
        order: nextOrder,
      }));
    },
    [update],
  );

  const getSlideStyle = useCallback(
    (storyId: string, imageId: string): SlideStyle =>
      curations[storyId]?.slideStyles?.[imageId] ?? { template: "plain" },
    [curations],
  );

  const setSlideStyle = useCallback(
    (storyId: string, imageId: string, patch: Partial<SlideStyle>) => {
      update(storyId, (prev) => {
        const current = prev.slideStyles?.[imageId] ?? {
          template: "plain" as const,
        };
        return {
          ...prev,
          slideStyles: {
            ...prev.slideStyles,
            [imageId]: { ...current, ...patch },
          },
        };
      });
    },
    [update],
  );

  const setCaption = useCallback(
    (storyId: string, text: string) => {
      update(storyId, (prev) => ({ ...prev, captionEdited: text }));
    },
    [update],
  );

  const resetCaption = useCallback(
    (storyId: string) => {
      update(storyId, (prev) => ({ ...prev, captionEdited: null }));
    },
    [update],
  );

  const markPublished = useCallback(
    (storyId: string) => {
      update(storyId, (prev) => ({
        ...prev,
        publishedAt: prev.publishedAt ?? new Date().toISOString(),
      }));
    },
    [update],
  );

  // Manual status control: the curator says whether it actually went out.
  const setPublished = useCallback(
    (storyId: string, on: boolean) => {
      update(storyId, (prev) => ({
        ...prev,
        publishedAt: on ? (prev.publishedAt ?? new Date().toISOString()) : null,
      }));
    },
    [update],
  );

  const toggleStar = useCallback(
    (storyId: string) => {
      update(storyId, (prev) => ({ ...prev, starred: !prev.starred }));
    },
    [update],
  );

  // Set aside: keep the story but drop it out of the working views.
  const toggleShelved = useCallback(
    (storyId: string) => {
      update(storyId, (prev) => ({ ...prev, shelved: !prev.shelved }));
    },
    [update],
  );

  // Keep latest profile reachable from the (stable) research callback without
  // re-creating it every render.
  const profileRef = useRef(profile);
  // eslint-disable-next-line react-hooks/refs -- intentional: latest profile for the stable research callback
  profileRef.current = profile;

  // Latest active channel, for tagging new research from stable callbacks.
  const activeChannelRef = useRef(activeChannelId);
  // eslint-disable-next-line react-hooks/refs -- intentional: latest channel for the stable research callbacks
  activeChannelRef.current = activeChannelId;

  // Apply a finished research payload onto a created story (researching → queue).
  const applyResearch = useCallback(
    (storyId: string, data: ResearchStoryPayload) => {
      setCreatedStories((prev) => {
        const next = prev.map((s) => {
          if (s.id !== storyId) return s;
          // User's own uploaded images first, then the researched placeholders.
          const images = [...s.images, ...data.images];
          return {
            ...s,
            status: "queue" as StoryStatus,
            error: undefined,
            title: data.title || s.title,
            description: data.description || s.description,
            postType: data.postType ?? s.postType,
            alignment: data.alignment ?? s.alignment,
            alignmentNote: data.alignmentNote ?? s.alignmentNote,
            techOvert: data.techOvert,
            dossier: data.dossier,
            caption: {
              draft: data.caption,
              titleOverImage: data.titleOverImage,
            },
            images,
            leadImageId: images[0]?.id ?? s.leadImageId,
            rubric: data.rubric,
            verdict: data.verdict,
            searchDirectives: data.directives,
          };
        });
        saveCreatedStories(next);
        return next;
      });
    },
    [],
  );
  const applyResearchRef = useRef(applyResearch);
  // eslint-disable-next-line react-hooks/refs -- intentional: latest applyResearch for the stable research callback
  applyResearchRef.current = applyResearch;

  // Append more images to a story (the dock's "More from X", the chat's
  // image tools), deduped by URL. Created stories take them inline; every
  // other story (seed, server-side) takes them through the per-story overlay,
  // which the stories memo merges in — so this works for ANY story.
  const addImages = useCallback(
    (storyId: string, incoming: StoryImage[]) => {
      if (incoming.length === 0) return;
      if (storyId.startsWith("story_created_")) {
        setCreatedStories((prev) => {
          const next = prev.map((s) => {
            if (s.id !== storyId) return s;
            const seen = new Set(s.images.map((i) => i.url));
            const fresh = incoming.filter((i) => i.url && !seen.has(i.url));
            if (fresh.length === 0) return s;
            const images = [...s.images, ...fresh];
            return {
              ...s,
              images,
              leadImageId: s.leadImageId || images[0]?.id || "",
            };
          });
          saveCreatedStories(next);
          return next;
        });
        return;
      }
      const story = storiesRef.current.find((s) => s.id === storyId);
      const seen = new Set((story?.images ?? []).map((i) => i.url));
      const fresh = incoming.filter((i) => i.url && !seen.has(i.url));
      if (fresh.length === 0) return;
      const merged = [...fresh, ...(uploads[storyId] ?? [])];
      saveUploads(storyId, merged);
      setUploads((prev) => ({ ...prev, [storyId]: merged }));
    },
    [uploads],
  );

  // Add the curator's own uploaded media to any story via a per-story overlay
  // (the stories memo merges it in). Persists to localStorage; returns false on
  // failure (e.g. quota) so the UI can warn.
  const addUploads = useCallback(
    (storyId: string, incoming: StoryImage[]): boolean => {
      if (incoming.length === 0) return true;
      const merged = [...incoming, ...(uploads[storyId] ?? [])];
      const ok = saveUploads(storyId, merged);
      setUploads((prev) => ({ ...prev, [storyId]: merged }));
      return ok;
    },
    [uploads],
  );

  // Apply the chat's vision-curation verdicts to a story's gallery: remove
  // judged-off-topic images, override descriptions. Persisted per-story
  // overlay, so it works for ANY story (seed, server, created).
  const applyImageEdits = useCallback(
    (
      storyId: string,
      removals: string[],
      descriptions: Record<string, string>,
    ) => {
      setImageEdits((prev) => {
        const cur = prev[storyId] ?? { removed: [], desc: {} };
        const next: ImageEdits = {
          removed: Array.from(new Set([...cur.removed, ...removals])),
          desc: { ...cur.desc, ...descriptions },
        };
        saveImageEdits(storyId, next);
        return { ...prev, [storyId]: next };
      });
    },
    [],
  );

  // In-flight research ids for this session (so a fresh mount can distinguish a
  // live run from an interrupted one — see the load effect's recovery).
  const researchingRef = useRef<Set<string>>(new Set());

  // Flip a created story to "failed" with a short reason (persisted), so the
  // card offers Retry instead of spinning forever.
  const markStoryFailed = useCallback((storyId: string, error: string) => {
    setCreatedStories((prev) => {
      let hit = false;
      const next = prev.map((s) => {
        if (s.id !== storyId) return s;
        hit = true;
        return { ...s, status: "failed" as StoryStatus, error };
      });
      if (!hit) return prev;
      saveCreatedStories(next);
      return next;
    });
  }, []);
  const markStoryFailedRef = useRef(markStoryFailed);
  // eslint-disable-next-line react-hooks/refs -- intentional: latest markStoryFailed for the stable research callback
  markStoryFailedRef.current = markStoryFailed;

  // Fire the research route for a created story — reliably. Each attempt is
  // bounded by a timeout; a transient failure auto-retries once; a hard failure
  // or exhausted retries flips the story to "failed" (retryable). A run always
  // resolves to queue or failed, never a stuck "researching".
  const runResearch = useCallback(
    async (
      storyId: string,
      prompt: string,
      attachments: string[],
      requestedType?: string,
    ) => {
      researchingRef.current.add(storyId);
      const systemPrompt = assemblePrompt(profileRef.current.systemPrompt);
      let lastError = "Research failed.";
      for (let attempt = 1; attempt <= RESEARCH_MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch("/api/engine/research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, attachments, systemPrompt, requestedType }),
            signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              story?: ResearchStoryPayload;
              error?: string;
            };
            if (json?.story) {
              applyResearchRef.current(storyId, json.story);
              researchingRef.current.delete(storyId);
              return;
            }
            lastError = json?.error || "Research returned no result.";
          } else {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            lastError =
              res.status === 503
                ? j.error || "Research isn’t configured."
                : j.error || `Research failed (${res.status}).`;
            // A 503 (missing key) won't be fixed by retrying — fail fast.
            if (res.status === 503) break;
          }
        } catch (err) {
          lastError =
            err instanceof DOMException && err.name === "TimeoutError"
              ? "Research timed out."
              : "Couldn’t reach the research service.";
        }
        if (attempt < RESEARCH_MAX_ATTEMPTS)
          await new Promise((r) => setTimeout(r, 1500));
      }
      researchingRef.current.delete(storyId);
      markStoryFailedRef.current(storyId, lastError);
    },
    [],
  );

  const createStory = useCallback(
    (input: CreateInput): string => {
      const id = `story_created_${Date.now()}`;
      const firstLine = input.prompt.trim().split("\n")[0] ?? "";
      const title =
        input.title ??
        ((firstLine.length > 64 ? `${firstLine.slice(0, 61)}…` : firstLine) ||
          "Untitled research");
      const now = new Date().toISOString();
      const story: Story = {
        id,
        status: "researching",
        title,
        // For typed research the prompt is internal steering text — keep the
        // card subtitle blank until the real description lands.
        description: input.title ? "" : input.prompt.trim().slice(0, 180),
        postType: input.requestedType,
        channelId: activeChannelRef.current ?? undefined,
        researchCompletedAt: now,
        leadImageId: input.images[0]?.id ?? "",
        techOvert: false,
        dossier: {
          verificationStatus: "partial",
          verifiedFacts: [],
          primarySources: [],
          contestedPoints: [],
        },
        caption: { draft: "", titleOverImage: { use: false, text: "" } },
        images: input.images,
        curation: emptyCuration(),
        brief: {
          prompt: input.prompt.trim(),
          attachments: input.attachments,
          createdAt: now,
          requestedType: input.requestedType,
        },
      };
      setCreatedStories((prev) => {
        const next = [story, ...prev];
        saveCreatedStories(next);
        return next;
      });
      setCurations((prev) => ({ ...prev, [id]: emptyCuration() }));
      // Kick off live research in the background; the card updates when done.
      void runResearch(
        id,
        input.prompt.trim(),
        input.attachments,
        input.requestedType,
      );
      return id;
    },
    [runResearch],
  );

  // The Home Research menu: surface a fresh story in one Territory vein
  // through the SERVER-persisted flow (/research-start). The run writes a
  // stub + its result (queue, or failed-with-reason) to the server store, so
  // it survives reloads and navigation — the browser doesn't have to stay
  // open. The optimistic stub below shows the card instantly; polling takes
  // over from there.
  const startTypeResearch = useCallback((typeId: string): string | null => {
    const t = postType(typeId);
    if (!t) return null;
    const id = `story_auto_${Date.now().toString(36)}_${Math.round(
      Math.random() * 1e6,
    ).toString(36)}`;
    const now = new Date().toISOString();
    const avoid = storiesRef.current
      .map((s) => s.title)
      .filter(Boolean)
      .slice(0, 24);
    const prompt =
      `Surface ONE new story in the ${t.label} vein right now (postType "${t.id}"): ${t.blurb} ` +
      "Follow your territory, research protocol, filter, and alignment layer. Pick a single subject and research it end to end, then submit it." +
      (avoid.length
        ? `\n\nDo not repeat any of these recently surfaced subjects:\n- ${avoid.join(
            "\n- ",
          )}`
        : "");
    const title = `Researching a new ${t.label} story…`;
    const channelId = activeChannelRef.current ?? undefined;
    const stub: Story = {
      id,
      status: "researching",
      title,
      description: "",
      postType: t.id,
      channelId,
      researchCompletedAt: now,
      leadImageId: "",
      techOvert: false,
      dossier: {
        verificationStatus: "partial",
        verifiedFacts: [],
        primarySources: [],
        contestedPoints: [],
      },
      caption: { draft: "", titleOverImage: { use: false, text: "" } },
      images: [],
      curation: emptyCuration(),
      brief: { prompt, attachments: [], createdAt: now, requestedType: t.id },
    };
    setAutoStories((prev) => [stub, ...prev.filter((s) => s.id !== id)]);
    setCurations((prev) => ({ ...prev, [id]: emptyCuration() }));
    void fetch("/api/engine/research-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        prompt,
        systemPrompt: assemblePrompt(profileRef.current.systemPrompt),
        requestedType: t.id,
        title,
        channelId,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          // The start was rejected (auth, store, config). Show WHY on the
          // card instead of letting it silently vanish.
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          const error = j.error || `Couldn’t start research (${res.status}).`;
          setAutoStories((prev) =>
            prev.map((s) =>
              s.id === id
                ? {
                    ...s,
                    status: "failed" as StoryStatus,
                    error,
                    researchCompletedAt: new Date().toISOString(),
                  }
                : s,
            ),
          );
        }
        pollAutoRef.current();
      })
      .catch(() => {
        // Closing the tab mid-run is fine: the server finishes on its own and
        // the next poll (or next visit) picks the result up.
      });
    return id;
  }, []);

  // Re-run research for a "failed" story. Created stories re-run through the
  // local Create-flow path; server stories re-run through /research-start
  // using the brief stored on the row (same id, so the card flips in place).
  const retryResearch = useCallback(
    (storyId: string) => {
      const story = storiesRef.current.find((s) => s.id === storyId);
      const brief = story?.brief;
      if (!story || !brief) return;
      if (storyId.startsWith("story_created_")) {
        setCreatedStories((prev) => {
          const next = prev.map((s) =>
            s.id === storyId
              ? { ...s, status: "researching" as StoryStatus, error: undefined }
              : s,
          );
          saveCreatedStories(next);
          return next;
        });
        void runResearch(
          storyId,
          brief.prompt,
          brief.attachments,
          brief.requestedType,
        );
        return;
      }
      setAutoStories((prev) =>
        prev.map((s) =>
          s.id === storyId
            ? {
                ...s,
                status: "researching" as StoryStatus,
                error: undefined,
                researchCompletedAt: new Date().toISOString(),
              }
            : s,
        ),
      );
      void fetch("/api/engine/research-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: storyId,
          prompt: brief.prompt,
          systemPrompt: assemblePrompt(profileRef.current.systemPrompt),
          requestedType: brief.requestedType,
          title: story.title,
          channelId: story.channelId,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            const error = j.error || `Couldn’t start research (${res.status}).`;
            setAutoStories((prev) =>
              prev.map((s) =>
                s.id === storyId
                  ? {
                      ...s,
                      status: "failed" as StoryStatus,
                      error,
                      researchCompletedAt: new Date().toISOString(),
                    }
                  : s,
              ),
            );
          }
          pollAutoRef.current();
        })
        .catch(() => {});
    },
    [runResearch],
  );

  // Delete a story everywhere it can live: hide it via the persisted deleted-ids
  // overlay (covers seed + Supabase rows), drop it from created stories, and
  // clear its curation + uploads. Plus a best-effort server delete for scheduled
  // rows (no-op locally; the overlay already hides it regardless).
  const deleteStory = useCallback((storyId: string) => {
    setDeletedIds((prev) => {
      if (prev.has(storyId)) return prev;
      const next = new Set(prev);
      next.add(storyId);
      saveDeletedIds([...next]);
      return next;
    });
    setCreatedStories((prev) => {
      if (!prev.some((s) => s.id === storyId)) return prev;
      const next = prev.filter((s) => s.id !== storyId);
      saveCreatedStories(next);
      return next;
    });
    // Cloud cleanup: this story's uploaded files (Blob storage URLs) stop
    // accruing storage. Best-effort — the local delete never waits on it.
    const blobUrls = loadUploads(storyId)
      .map((im) => im.url)
      .filter((u) => /^https:\/\/[^/]*public\.blob\.vercel-storage\.com\//.test(u));
    if (blobUrls.length) {
      void fetch("/api/engine/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: blobUrls }),
      }).catch(() => {});
    }
    clearCuration(storyId);
    removeUploads(storyId);
    removeImageEdits(storyId);
    setUploads((prev) => {
      if (!(storyId in prev)) return prev;
      const next = { ...prev };
      delete next[storyId];
      return next;
    });
    setImageEdits((prev) => {
      if (!(storyId in prev)) return prev;
      const next = { ...prev };
      delete next[storyId];
      return next;
    });
    void fetch(
      `/api/engine/auto-stories?id=${encodeURIComponent(storyId)}`,
      { method: "DELETE" },
    ).catch(() => {});
  }, []);

  // ── Channels ──────────────────────────────────────────────────────────
  const addChannel = useCallback(
    (name: string, handle: string): Channel | null => {
      const cleanName = name.trim().slice(0, 60);
      const cleanHandle = normalizeHandle(handle);
      if (!cleanName && !cleanHandle) return null;
      const channel: Channel = {
        id: newChannelId(),
        name: cleanName || `@${cleanHandle}`,
        handle: cleanHandle,
        color: CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length],
        createdAt: new Date().toISOString(),
      };
      setChannels((prev) => {
        const next = [...prev, channel];
        saveChannels(next);
        return next;
      });
      setActiveChannelId((prev) => {
        const next = prev ?? channel.id;
        saveActiveChannelId(next);
        return next;
      });
      return channel;
    },
    [channels.length],
  );

  const updateChannel = useCallback((id: string, patch: Partial<Channel>) => {
    setChannels((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, ...patch, id } : c));
      saveChannels(next);
      return next;
    });
  }, []);

  const removeChannel = useCallback((id: string) => {
    setChannels((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveChannels(next);
      setActiveChannelId((act) => {
        const nextAct = act === id ? (next[0]?.id ?? null) : act;
        saveActiveChannelId(nextAct);
        return nextAct;
      });
      return next;
    });
  }, []);

  const setActiveChannel = useCallback((id: string | null) => {
    setActiveChannelId(id);
    saveActiveChannelId(id);
  }, []);

  const setInstagram = useCallback((handle: string) => {
    setProfile((prev) => {
      const next = { ...prev, instagram: handle.replace(/^@+/, "") };
      saveProfile(next);
      return next;
    });
  }, []);

  const setPromptSection = useCallback((key: string, content: string) => {
    setProfile((prev) => {
      const next = {
        ...prev,
        systemPrompt: prev.systemPrompt.map((s) =>
          s.key === key ? { ...s, content } : s,
        ),
      };
      saveProfile(next);
      return next;
    });
  }, []);

  const value = useMemo<EngineStore>(() => {
    const byId = new Map(stories.map((s) => [s.id, s]));
    return {
      ready,
      stories,
      curations,
      profile,
      getStory: (storyId) => byId.get(storyId),
      getCuration,
      effectiveCaption: (story) =>
        (curations[story.id]?.captionEdited ?? story.caption.draft) || "",
      isPublished: (story) =>
        story.status === "published" || Boolean(curations[story.id]?.publishedAt),
      toggleSelect,
      reorderSelection,
      getSlideStyle,
      setSlideStyle,
      setCaption,
      resetCaption,
      markPublished,
      setPublished,
      toggleStar,
      toggleShelved,
      createStory,
      startTypeResearch,
      retryResearch,
      deleteStory,
      addImages,
      addUploads,
      applyImageEdits,
      setInstagram,
      setPromptSection,
      channels,
      activeChannelId,
      addChannel,
      updateChannel,
      removeChannel,
      setActiveChannel,
    };
  }, [
    ready,
    stories,
    curations,
    profile,
    channels,
    activeChannelId,
    addChannel,
    updateChannel,
    removeChannel,
    setActiveChannel,
    getCuration,
    toggleSelect,
    reorderSelection,
    getSlideStyle,
    setSlideStyle,
    setCaption,
    resetCaption,
    markPublished,
    setPublished,
    toggleStar,
    toggleShelved,
    createStory,
    startTypeResearch,
    retryResearch,
    deleteStory,
    addImages,
    addUploads,
    applyImageEdits,
    setInstagram,
    setPromptSection,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine(): EngineStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useEngine must be used within an EngineProvider");
  return ctx;
}

function recordSignal(signal: SelectionSignal): void {
  /* forward hook only (spec §9 taste learning) */
  void signal;
}
