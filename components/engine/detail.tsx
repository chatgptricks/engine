"use client";

import {useRouter} from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {ResearchTransferDialog} from "@/components/template-editor/research-transfer-dialog";
import { useEngine } from "@/lib/engine/store";
import type { Story, StoryImage } from "@/lib/engine/types";
import { alignmentLabel, postTypeLabel } from "@/lib/engine/post-types";
import { ResearchPanel } from "./research-panel";
import { Gallery } from "./gallery";
import { StoryChat } from "./story-chat";
import { CaptionBar } from "./caption-bar";
import { InstagramPreview, ShareActions } from "./instagram-preview";
import { Dock, DockDivider } from "./dock";
import {
  CommentIcon,
  ImageIcon,
  SearchIcon,
  TextIcon,
  StarIcon,
  ArchiveIcon,
} from "./icons";

const SIZE_KEY = "gf-gallery-size";
const SIZE_MIN = 150;
const SIZE_MAX = 360;
const SIZE_DEFAULT = 230;
const CAPTION_KEY = "gf-caption-open";
const CHAT_KEY = "gf-chat-open";

function readSize(): number {
  if (typeof window === "undefined") return SIZE_DEFAULT;
  try {
    const v = Number(window.localStorage.getItem(SIZE_KEY));
    return Number.isFinite(v) && v >= SIZE_MIN && v <= SIZE_MAX ? v : SIZE_DEFAULT;
  } catch {
    return SIZE_DEFAULT;
  }
}

/** Caption bar open/closed, persisted. Default open; "0" means collapsed.
 * (Safe as a lazy initializer: Detail only ever renders client-side.) */
function readCaptionOpen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(CAPTION_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Chat pane open/closed, persisted. Default closed. */
function readChatOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHAT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Is Vercel Blob connected? Cached probe — decides whether uploads go to
 * cloud storage (big videos, light localStorage) or fall back to data URLs. */
let blobProbe: Promise<boolean> | null = null;
function blobConfigured(): Promise<boolean> {
  blobProbe ??= fetch("/api/engine/upload")
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((j: { configured?: boolean }) => Boolean(j.configured))
    .catch(() => false);
  return blobProbe;
}

/** A video file's dimensions, read from metadata without loading the body. */
function videoMeta(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: v.videoWidth || 1080, height: v.videoHeight || 1350 });
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    v.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read failed"));
    fr.onload = () => resolve(fr.result as string);
    fr.readAsDataURL(blob);
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return blobToDataUrl(file);
}

/** Downscale an uploaded image to a JPEG blob (≤maxDim on the long side) —
 * uploaded to cloud storage when connected, else inlined as a data URL. */
function downscaleImage(
  file: File,
  maxDim: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas context"));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) =>
            blob ? resolve({ blob, width, height }) : reject(new Error("encode failed")),
          "image/jpeg",
          quality,
        );
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Screen 2 shell. The centered title + subtitle sit near the top with breathing
 * room (Cosmos-style header band). Back lives in the top-left corner; the rest
 * of the controls (Gallery/Instagram · grid size · More from X) live in the
 * contextual bottom dock. The size slider writes a CSS variable directly (no
 * React state), so the grid resizes instantly and smoothly as you drag.
 */
export function Detail({ story }: { story: Story }) {
  const router = useRouter();
  const {
    addImages,
    addUploads,
    getCuration,
    effectiveCaption,
    markPublished,
    isPublished,
    setPublished,
    toggleStar,
    toggleShelved,
  } = useEngine();
  const published = isPublished(story);
  const starred = Boolean(getCuration(story.id).starred);
  const shelved = Boolean(getCuration(story.id).shelved);
  const [view, setView] = useState<"gallery" | "instagram">("gallery");
  const [findingMore, setFindingMore] = useState(false);
  const [transferOpen,setTransferOpen]=useState(false);
  const [moreNote, setMoreNote] = useState<string | null>(null);
  const [captionOpen, setCaptionOpen] = useState(readCaptionOpen);
  const [chatOpen, setChatOpen] = useState(readChatOpen);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [focalId, setFocalId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sizeRef = useRef<number>(SIZE_DEFAULT);

  const applyCaptionOpen = useCallback((next: boolean) => {
    setCaptionOpen(next);
    try {
      window.localStorage.setItem(CAPTION_KEY, next ? "1" : "0");
    } catch {
      /* noop */
    }
  }, []);

  const applyChatOpen = useCallback((next: boolean) => {
    setChatOpen(next);
    try {
      window.localStorage.setItem(CHAT_KEY, next ? "1" : "0");
    } catch {
      /* noop */
    }
  }, []);

  async function findMore() {
    setFindingMore(true);
    setMoreNote(null);
    try {
      const res = await fetch("/api/engine/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The pre-colon segment of the title is the subject phrase ("Imhotep:
          // the first…" → "Imhotep") — the server quotes it for X search.
          subject: (story.title.split(/[:—–]/)[0] || story.title).trim(),
          directives: story.searchDirectives ?? [],
          summary: story.description || story.caption?.draft?.slice(0, 300) || "",
        }),
      });
      if (!res.ok) {
        setMoreNote(res.status === 503 ? "Apify not set up" : "Couldn’t fetch");
        return;
      }
      const json = (await res.json()) as { images?: StoryImage[] };
      const imgs = json.images ?? [];
      addImages(story.id, imgs);
      setMoreNote(imgs.length ? `+${imgs.length} from X` : "No new images");
      setTimeout(() => setMoreNote(null), 3500);
    } catch {
      setMoreNote("Couldn’t fetch");
    } finally {
      setFindingMore(false);
    }
  }

  async function onUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadNote(null);
    const made: StoryImage[] = [];
    let skipped = 0;
    const useBlob = await blobConfigured();
    const up = useBlob
      ? (await import("@vercel/blob/client")).upload
      : null;
    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith("video/");
      if (!file.type.startsWith("image/") && !isVideo) {
        skipped++;
        continue;
      }
      // Without cloud storage, clips live in localStorage — short ones only.
      if (isVideo && !useBlob && file.size > 8 * 1024 * 1024) {
        skipped++;
        continue;
      }
      if (isVideo && file.size > 512 * 1024 * 1024) {
        skipped++;
        continue;
      }
      try {
        let url: string;
        let width: number;
        let height: number;
        if (isVideo) {
          ({ width, height } = await videoMeta(file));
          url = up
            ? (
                await up(`gf/${file.name || "clip.mp4"}`, file, {
                  access: "public",
                  handleUploadUrl: "/api/engine/upload",
                  // Chunked upload with retries — keeps 100MB+ videos reliable.
                  multipart: true,
                })
              ).url
            : await fileToDataUrl(file);
        } else {
          const m = await downscaleImage(file, 1600, 0.85);
          width = m.width;
          height = m.height;
          url = up
            ? (
                await up(
                  `gf/${(file.name || "image").replace(/\.[a-z0-9]+$/i, "")}.jpg`,
                  m.blob,
                  {
                    access: "public",
                    handleUploadUrl: "/api/engine/upload",
                    contentType: "image/jpeg",
                  },
                )
              ).url
            : await blobToDataUrl(m.blob);
        }
        made.push({
          id: `upload_${Date.now().toString(36)}_${Math.round(
            Math.random() * 1e6,
          ).toString(36)}`,
          url,
          source: "upload",
          kind: "real_subject",
          directive: "Your upload",
          width,
          height,
          rightsNote: "",
          cosmosManual: true,
          mediaType: isVideo ? "video" : "image",
          description: file.name,
        });
      } catch {
        skipped++;
      }
    }
    if (made.length) {
      const ok = addUploads(story.id, made);
      setUploadNote(
        ok
          ? `Added ${made.length}${skipped ? ` · ${skipped} skipped` : ""}`
          : "Storage full — couldn’t save",
      );
    } else {
      setUploadNote(
        skipped ? "Skipped — connect cloud storage for big videos" : "Nothing added",
      );
    }
    setTimeout(() => setUploadNote(null), 3500);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Apply the saved/current size to the wrap as soon as it mounts (client-only,
  // so reading localStorage here avoids any hydration mismatch).
  const setWrap = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el;
    if (!el) return;
    const v = readSize();
    sizeRef.current = v;
    el.style.setProperty("--gf-col", `${v}px`);
    if (inputRef.current) inputRef.current.value = String(v);
  }, []);

  function onSlide(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    sizeRef.current = v;
    wrapRef.current?.style.setProperty("--gf-col", `${v}px`);
    try {
      window.localStorage.setItem(SIZE_KEY, String(v));
    } catch {
      /* noop */
    }
  }

  // Selected carousel images (in order) + caption, for the Instagram-view dock
  // share actions.
  const igImages = getCuration(story.id)
    .selectedImageIds.map((id) => story.images.find((i) => i.id === id))
    .filter((i): i is StoryImage => Boolean(i));
  const igCaption = effectiveCaption(story);
  const typeLabel = postTypeLabel(story.postType);
  const alignLabel = alignmentLabel(story.alignment);

  const toggle = (
    <div className="gf-seg gf-detail-toggle" role="tablist" aria-label="View">
      <button
        role="tab"
        aria-selected={view === "gallery"}
        className={view === "gallery" ? "is-active" : ""}
        onClick={() => setView("gallery")}
      >
        Gallery
      </button>
      <button
        role="tab"
        aria-selected={view === "instagram"}
        className={view === "instagram" ? "is-active" : ""}
        onClick={() => setView("instagram")}
      >
        Instagram
      </button>
    </div>
  );

  return (
    <div className="gf-detail">
      <div className="gf-detail-header">
        <div className="gf-detail-titleblock">
          {(typeLabel || alignLabel || story.techOvert) && (
            <div className="gf-detail-tags">
              {typeLabel && <span className="gf-type-badge">{typeLabel}</span>}
              {alignLabel && (
                <span
                  className="gf-align-badge"
                  data-align={story.alignment}
                  title={story.alignmentNote || undefined}
                >
                  {alignLabel}
                </span>
              )}
              {story.techOvert && (
                <span className="gf-align-badge gf-tech-badge">Tech-overt</span>
              )}
            </div>
          )}
          <h1 className="gf-detail-title">{story.title}</h1>
          {story.description && (
            <p className="gf-detail-subtitle">{story.description}</p>
          )}
          <div className="gf-detail-actions">
            <div className="gf-seg gf-status-seg" aria-label="Story status">
              <button
                className={!published ? "is-active" : ""}
                onClick={() => setPublished(story.id, false)}
              >
                Queue
              </button>
              <button
                className={published ? "is-active" : ""}
                onClick={() => setPublished(story.id, true)}
              >
                Published
              </button>
            </div>
            <button
              type="button"
              className={`gf-chipbtn${starred ? " is-on" : ""}`}
              aria-pressed={starred}
              title={starred ? "Unstar" : "Star this story"}
              onClick={() => toggleStar(story.id)}
            >
              <StarIcon size={13} filled={starred} />
              {starred ? "Starred" : "Star"}
            </button>
            <button
              type="button"
              className={`gf-chipbtn${shelved ? " is-on" : ""}`}
              aria-pressed={shelved}
              title={
                shelved
                  ? "Bring back into the working views"
                  : "Keep it, but out of the working views"
              }
              onClick={() => toggleShelved(story.id)}
            >
              <ArchiveIcon size={13} />
              {shelved ? "Set aside" : "Set aside"}
            </button>
          </div>
        </div>
      </div>

      {view === "gallery" ? (
        <div className="gf-detail-body">
          <ResearchPanel story={story} />
          <div className="gf-canvas-wrap" ref={setWrap}>
            <div className="gf-canvas">
              <Gallery story={story} />
            </div>
          </div>
          {(captionOpen || chatOpen) && (
            <div className="gf-bottom-stack">
              {captionOpen && (
                <CaptionBar
                  story={story}
                  onCollapse={() => applyCaptionOpen(false)}
                />
              )}
              {chatOpen && (
                <StoryChat story={story} onClose={() => applyChatOpen(false)} />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="gf-detail-body">
          <InstagramPreview story={story} onFocalChange={setFocalId} />
        </div>
      )}

      {transferOpen&&<ResearchTransferDialog story={story} onClose={()=>setTransferOpen(false)} onTransferred={()=>{setTransferOpen(false);router.push("/admin/engine?from=research");}}/>}
      <Dock>
        {toggle}
        <DockDivider />
        <button className="gf-btn gf-btn-icon" onClick={()=>setTransferOpen(true)}>Open in post editor</button>
        {view === "gallery" && (
          <>
            <DockDivider />
            <button
              className={`gf-btn gf-btn-icon${chatOpen ? " is-on" : ""}`}
              onClick={() => applyChatOpen(!chatOpen)}
              aria-pressed={chatOpen}
              title="Story chat — ask, edit the caption, find images, start research"
            >
              <CommentIcon size={14} />
              Chat
            </button>
            <button
              className={`gf-btn gf-btn-icon${captionOpen ? " is-on" : ""}`}
              onClick={() => applyCaptionOpen(!captionOpen)}
              aria-pressed={captionOpen}
            >
              <TextIcon size={14} />
              Caption
            </button>
            <label className="gf-size-slider" title="Grid size">
              <input
                ref={inputRef}
                type="range"
                min={SIZE_MIN}
                max={SIZE_MAX}
                defaultValue={SIZE_DEFAULT}
                onChange={onSlide}
                aria-label="Image grid size"
              />
            </label>
            <button
              className="gf-btn gf-btn-icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Upload your own images"
            >
              <ImageIcon size={14} />
              {uploading ? "Uploading…" : (uploadNote ?? "Upload")}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,video/webm,video/quicktime"
              multiple
              hidden
              onChange={(e) => onUploadFiles(e.target.files)}
            />
            <button
              className="gf-btn gf-btn-icon"
              onClick={findMore}
              disabled={findingMore}
            >
              <SearchIcon size={14} />
              {findingMore ? "Searching X…" : (moreNote ?? "More from X")}
            </button>
          </>
        )}
        {view === "instagram" && (
          <>
            <DockDivider />
            <ShareActions
              caption={igCaption}
              images={igImages}
              storyId={story.id}
              focalId={focalId}
              onHandoff={() => markPublished(story.id)}
            />
          </>
        )}
      </Dock>
    </div>
  );
}
