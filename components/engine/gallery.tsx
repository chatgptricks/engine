"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEngine } from "@/lib/engine/store";
import { proxied, sourceLabel } from "@/lib/engine/util";
import type { Story, StoryImage } from "@/lib/engine/types";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, PlusIcon } from "./icons";

/**
 * Screen 2 — the canvas gallery. Tap an image to expand it (Cosmos-style): a
 * large view with a source + description panel on the right and an X to
 * collapse; the rest of the pool reflows into the grid below to scroll and
 * expand. The small corner badge selects/orders images for the carousel
 * (clicking it doesn't expand). Selected tiles drag to reorder.
 */
function hostOf(img: StoryImage): string {
  if (img.sourceUrl) {
    try {
      return new URL(img.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      /* fall through */
    }
  }
  return img.directive || "source";
}

export function Gallery({ story }: { story: Story }) {
  const { getCuration, toggleSelect, reorderSelection } = useEngine();
  const selected = getCuration(story.id).selectedImageIds;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const expandedIndex = expandedId
    ? story.images.findIndex((i) => i.id === expandedId)
    : -1;
  const expanded = expandedIndex >= 0 ? story.images[expandedIndex] : null;

  const stepExpand = useCallback(
    (dir: -1 | 1) => {
      setExpandedId((cur) => {
        const idx = story.images.findIndex((i) => i.id === cur);
        const next = idx + dir;
        if (idx < 0 || next < 0 || next >= story.images.length) return cur;
        return story.images[next].id;
      });
    },
    [story.images],
  );

  // Lightbox keyboard: Esc closes, arrows browse — only while it's open.
  useEffect(() => {
    if (!expandedId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setExpandedId(null);
        return;
      }
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return; // typing — leave the caret keys alone
      if (e.key === "ArrowLeft") stepExpand(-1);
      else if (e.key === "ArrowRight") stepExpand(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId, stepExpand]);

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = selected.indexOf(String(active.id));
    const to = selected.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    reorderSelection(story.id, arrayMove(selected, from, to));
  }

  const activeImg = activeId
    ? story.images.find((i) => i.id === activeId)
    : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {expanded && (
        <div
          className="gf-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpandedId(null)}
        >
          {expandedIndex > 0 && (
            <button
              className="gf-lightbox-nav gf-lightbox-prev"
              aria-label="Previous image"
              onClick={(e) => {
                e.stopPropagation();
                stepExpand(-1);
              }}
            >
              <ArrowLeftIcon />
            </button>
          )}
          <div className="gf-expand" onClick={(e) => e.stopPropagation()}>
            <div className="gf-expand-media">
              {expanded.mediaType === "video" ? (
                // Sound lives here: tiles stay muted (autoplay rules), but the
                // lightbox plays with audio + native controls. The click that
                // opened it is the user gesture browsers want.
                <video
                  key={expanded.id}
                  src={expanded.url}
                  controls
                  autoPlay
                  playsInline
                  loop
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={proxied(expanded.url)}
                  alt={expanded.description || expanded.directive}
                  referrerPolicy="no-referrer"
                />
              )}
            </div>
            <div className="gf-expand-details">
              <button
                className="gf-expand-close"
                onClick={() => setExpandedId(null)}
                aria-label="Close"
              >
                <CloseIcon />
              </button>
              <span className="gf-expand-sourcetype">
                {sourceLabel(expanded.source)}
              </span>
              <p className="gf-expand-desc">
                {expanded.description || `Pulled from ${hostOf(expanded)}.`}
              </p>
              {expanded.sourceUrl ? (
                <a
                  className="gf-expand-link"
                  href={expanded.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View source ↗ <span>{hostOf(expanded)}</span>
                </a>
              ) : (
                <span className="gf-expand-srcname">{expanded.directive}</span>
              )}
              {expanded.rightsNote && (
                <p className="gf-expand-rights">{expanded.rightsNote}</p>
              )}
              <button
                className={`gf-expand-select${
                  selected.includes(expanded.id) ? " is-selected" : ""
                }`}
                onClick={() => toggleSelect(story.id, expanded.id)}
              >
                {selected.includes(expanded.id)
                  ? `Selected · #${selected.indexOf(expanded.id) + 1}`
                  : "Select for carousel"}
              </button>
            </div>
          </div>
          {expandedIndex < story.images.length - 1 && (
            <button
              className="gf-lightbox-nav gf-lightbox-next"
              aria-label="Next image"
              onClick={(e) => {
                e.stopPropagation();
                stepExpand(1);
              }}
            >
              <ArrowRightIcon />
            </button>
          )}
        </div>
      )}

      <SortableContext items={selected} strategy={rectSortingStrategy}>
        <div className="gf-gallery">
          {story.images.map((img) => {
            const order = selected.indexOf(img.id);
            return order >= 0 ? (
              <SortableTile
                key={img.id}
                img={img}
                number={order + 1}
                onToggle={() => toggleSelect(story.id, img.id)}
                onExpand={() => setExpandedId(img.id)}
              />
            ) : (
              <PlainTile
                key={img.id}
                img={img}
                onToggle={() => toggleSelect(story.id, img.id)}
                onExpand={() => setExpandedId(img.id)}
              />
            );
          })}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeImg ? (
          <div className="gf-drag-overlay" style={{ width: 230 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proxied(activeImg.url)} alt="" referrerPolicy="no-referrer" />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function TileMeta({ img }: { img: StoryImage }) {
  return (
    <span className="gf-tile-source">
      {img.cosmosManual && <i className="gf-tile-flag" aria-hidden />}
      {sourceLabel(img.source)}
    </span>
  );
}

function TileImg({ img }: { img: StoryImage }) {
  // Graceful loading: the tile is a solid black box (its reserved aspect, so the
  // masonry never reflows) until the image is fully decoded, then it fades in.
  // No broken-image placeholder ever shows (alt is empty, opacity 0 until load).
  // Plus the existing defenses: (1) stagger the initial request a little so a
  // 50-tile gallery doesn't burst; (2) retry a failure a couple times.
  // Videos skip the proxy (it serves images only) — uploads are data URLs or
  // our own Blob store, both fine to load direct.
  const base = img.mediaType === "video" ? img.url : proxied(img.url);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState<string | undefined>(undefined);
  const url = attempt === 0 ? base : `${base}&r=${attempt}`;
  const aspect =
    img.width > 0 && img.height > 0 ? `${img.width} / ${img.height}` : "4 / 5";

  useEffect(() => {
    const t = window.setTimeout(() => setSrc(url), Math.random() * 600);
    return () => window.clearTimeout(t);
  }, [url]);

  if (img.mediaType === "video") {
    return (
      <video
        src={src}
        // CORS-clean load so the same URL is cached drawable for the canvas
        // video export (avoids a tainted-cache hit later).
        crossOrigin="anonymous"
        className={loaded ? "is-loaded" : ""}
        style={{ aspectRatio: aspect }}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        onLoadedData={() => setLoaded(true)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={loaded ? "is-loaded" : ""}
      style={{ aspectRatio: aspect }}
      loading="lazy"
      draggable={false}
      referrerPolicy="no-referrer"
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (attempt >= 2) return;
        const delay = 700 + attempt * 1200 + Math.random() * 700;
        window.setTimeout(() => setAttempt((a) => a + 1), delay);
      }}
    />
  );
}

function SortableTile({
  img,
  number,
  onToggle,
  onExpand,
}: {
  img: StoryImage;
  number: number;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: img.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`gf-tile is-selected${isDragging ? " is-dragging" : ""}`}
      onClick={onExpand}
      {...attributes}
      {...listeners}
    >
      <TileImg img={img} />
      <button
        className="gf-badge"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Deselect"
      >
        {number}
      </button>
      <TileMeta img={img} />
    </div>
  );
}

function PlainTile({
  img,
  onToggle,
  onExpand,
}: {
  img: StoryImage;
  onToggle: () => void;
  onExpand: () => void;
}) {
  return (
    <div
      className="gf-tile"
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onExpand();
        }
      }}
    >
      <TileImg img={img} />
      <button
        className="gf-badge-add"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Select for carousel"
      >
        <PlusIcon size={15} />
      </button>
      <TileMeta img={img} />
    </div>
  );
}
