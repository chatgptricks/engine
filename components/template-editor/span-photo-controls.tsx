"use client";

import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import type { DesignDocument } from "@/lib/template-editor/model";
import {
  SEAM_MAX, SEAM_MIN, SPAN_COVER_BLOCKER, findSpan, isSpanHalf, seamOf, setSeam, spanBlocker, spanPairs, spanPhoto, unlinkSpan,
  type SpanPlace, type SpanResult,
} from "@/lib/template-editor/spanning-photos";
import type { ContextMenuDefinition } from "./context-menu";
import { EditorIcon } from "./editor-icons";
import "./span-photos.css";

/** The photo toolbar's spanning controls: Span for an ordinary photo, or the
 * pair's menu and Seam slider for a photo that already continues on a neighbor. */
export type SpanControl =
  | { kind: "available"; reason?: string; onSpan: () => void }
  | { kind: "linked"; slides: [number, number]; seam: number; onMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void; onSeam: (seam: number) => void; onSeamEnd: () => void };

/** The Seam slider snaps to the middle while dragging; arrow keys step past it. */
const SNAP = 2;
const percent = (seam: number) => Math.round(seam * 100);

export function SpanToolbarControls({ control, disabled }: { control: SpanControl; disabled: boolean }) {
  const pointer = useRef(false);
  if (control.kind === "available") {
    return <button type="button" className="te-context-action" aria-label="Span onto the next slide" title={control.reason ?? "Span onto the next slide: the whole photo continues across the slide edge"} disabled={disabled || Boolean(control.reason)} onClick={control.onSpan}><EditorIcon name="span" />Span</button>;
  }
  const [first, second] = control.slides, value = percent(control.seam);
  const finish = () => { pointer.current = false; control.onSeamEnd(); };
  return <>
    <button type="button" className="te-context-action" aria-haspopup="menu" aria-label={`Photo across slides ${first} and ${second}. Spanning photo actions`} title="Open the other slide, center the seam or unlink the halves" onClick={control.onMenu}><EditorIcon name="span" />Spans {first}–{second}<span aria-hidden="true"> ⌄</span></button>
    <label className="te-photo-span-seam" title="Move the seam off faces and text. It snaps at 50%">
      <span>Seam</span>
      <input type="range" min={percent(SEAM_MIN)} max={percent(SEAM_MAX)} step={1} value={value} disabled={disabled}
        aria-label="Seam position" aria-valuetext={`${value}% of the photo on slide ${first}`}
        onPointerDown={() => { pointer.current = true; }}
        onPointerUp={finish} onPointerCancel={finish} onBlur={finish} onKeyUp={finish}
        onChange={event => {
          let next = Number(event.target.value);
          if (pointer.current && Math.abs(next - 50) <= SNAP) next = 50;
          if (next !== value) control.onSeam(next / 100);
        }} />
      <output>{value}%</output>
    </label>
  </>;
}

type SpanPhotoOptions = {
  design: DesignDocument;
  pageId: string;
  selectedIds: string[];
  /** False while editing the shared master. */
  enabled: boolean;
  disabled: boolean;
  commit: (change: (design: DesignDocument) => DesignDocument, group?: string) => boolean;
  /** Ends the slider's history group, so the next drag is its own undo step. */
  endGesture: () => void;
  openPage: (pageId: string, selectedIds: string[]) => void;
  notify: (text: string) => void;
  openMenu: (event: ReactMouseEvent, menu: ContextMenuDefinition) => void;
};

/** Everything the editor shows for spanning photos on the current page. */
export function useSpanPhotos({ design, pageId, selectedIds, enabled, disabled, commit, endGesture, openPage, notify, openMenu }: SpanPhotoOptions) {
  const seamBase = useRef<{ key: string; base: { y: number; width: number; height: number } } | null>(null);
  const pairs = useMemo(() => design.continuousCanvas ? [] : spanPairs(design), [design]);
  const pageIndex = design.pages.findIndex(page => page.id === pageId);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const selected = selectedId ? design.pages[pageIndex]?.canvas?.elements.find(element => element.id === selectedId) : undefined;
  const place: SpanPlace | undefined = enabled && selectedId && isSpanHalf(selected) ? findSpan(design, pageId, selectedId) : undefined;

  const layerNotes = useMemo(() => {
    const notes = new Map<string, string>();
    for (const pair of pairs) {
      const note = `across slides ${pair.startPage + 1}–${pair.endPage + 1}`;
      if (pair.startPage === pageIndex) notes.set(pair.start.id, note);
      if (pair.endPage === pageIndex) notes.set(pair.end.id, note);
    }
    return notes;
  }, [pairs, pageIndex]);
  const links = useMemo(() => new Set(pairs.map(pair => pair.startPage)), [pairs]);

  let control: SpanControl | undefined;
  if (enabled && selectedId && selected?.type === "image") {
    if (place) {
      const own = place.side === "start" ? place.start : place.end;
      const partner = place.side === "start" ? { page: design.pages[place.endPage], half: place.end } : { page: design.pages[place.startPage], half: place.start };
      const seam = seamOf(place.start), key = `${pageId}:${own.id}`;
      control = {
        kind: "linked", slides: [place.startPage + 1, place.endPage + 1], seam,
        onSeam: next => {
          if (seamBase.current?.key !== key) seamBase.current = { key, base: { y: place.start.y, width: place.start.width, height: place.start.height } };
          const base = seamBase.current.base;
          commit(current => setSeam(current, pageId, own.id, next, base), `${pageId}:photo-seam`);
        },
        onSeamEnd: () => { seamBase.current = null; endGesture(); },
        onMenu: event => openMenu(event, {
          label: "Spanning photo",
          items: [
            { id: "span-open", label: `Open slide ${design.pages.indexOf(partner.page) + 1}`, onSelect: () => openPage(partner.page.id, [partner.half.id]) },
            { id: "span-center", label: "Center the seam", disabled: disabled || percent(seam) === 50, onSelect: () => { commit(current => setSeam(current, pageId, own.id, .5)); } },
            { id: "span-unlink", label: "Unlink halves", separator: true, disabled, onSelect: () => { commit(current => unlinkSpan(current, pageId, own.id)); } },
          ],
        }),
      };
    } else {
      const reason = spanBlocker(design, pageId, selectedId);
      if (reason !== SPAN_COVER_BLOCKER) control = {
        kind: "available", reason,
        onSpan: () => {
          let result: SpanResult | undefined;
          if (!commit(current => (result = spanPhoto(current, pageId, selectedId)).design) || !result) return;
          const done = result;
          openPage(done.start.pageId, [done.start.elementId]);
          if (done.addedPage) notify(`Added slide ${pageIndex + 2} for the second half of the photo.`);
        },
      };
    }
  }
  return { control, place, layerNotes, links };
}
