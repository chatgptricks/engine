"use client";

import { useEffect, useMemo, useState } from "react";
import type { CanvasScene, DesignDocument } from "@/lib/template-editor/model";
import { isSpanHalf, mirrorHalf, type SpanPlace } from "@/lib/template-editor/spanning-photos";
import { DesignFrame, FRAME_WIDTH } from "./preview";
import "./span-photos.css";

type PeekProps = {
  design: DesignDocument;
  place: SpanPlace;
  scale: number;
  /** Where the current page sits on the pasteboard, in scene units. */
  left: number;
  top: number;
  height: number;
  subscribe: (listener: (scene: CanvasScene | null) => void) => () => void;
  onOpen: () => void;
};

/** The other slide of a spanning photo, beside the page being edited, so the
 * whole photo shows while one half is selected. It follows the half live
 * during a drag; clicking it opens that slide. */
export function SpanPeek({ design, place, scale, left, top, height, subscribe, onOpen }: PeekProps) {
  const [preview, setPreview] = useState<CanvasScene | null>(null);
  useEffect(() => subscribe(setPreview), [subscribe]);
  const after = place.side === "start";
  const own = after ? place.start : place.end, partnerHalf = after ? place.end : place.start;
  const partnerIndex = after ? place.endPage : place.startPage, partner = design.pages[partnerIndex];
  const live = preview?.elements.find(element => element.id === own.id);
  const twin = isSpanHalf(live) ? mirrorHalf(live, partnerHalf) : partnerHalf;
  const page = useMemo(() => twin === partnerHalf || !partner?.canvas ? partner : { ...partner, canvas: { ...partner.canvas, elements: partner.canvas.elements.map(element => element.id === partnerHalf.id ? twin : element) } }, [partner, partnerHalf, twin]);
  if (!partner?.canvas) return null;
  return <div className={`te-photo-span-peek ${after ? "is-after" : "is-before"}`} style={{ left: (left + (after ? FRAME_WIDTH : -FRAME_WIDTH)) * scale, top: top * scale, width: FRAME_WIDTH * scale, height: height * scale }}>
    <button type="button" className="te-photo-span-peek-page" aria-label={`Open slide ${partnerIndex + 1}, with the other half of this photo`} title={`Slide ${partnerIndex + 1}: click to edit it. The photo stays linked`}
      onPointerDown={event => event.stopPropagation()} onClick={onOpen}>
      <span className="te-photo-span-peek-frame" style={{ width: FRAME_WIDTH, height, transform: `scale(${scale})` }}><DesignFrame design={design} page={page} preview /></span>
    </button>
    <span className="te-photo-span-peek-label" aria-hidden="true">Slide {partnerIndex + 1} · click to edit</span>
  </div>;
}
