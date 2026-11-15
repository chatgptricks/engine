"use client";

import { useId } from "react";
import { MEDIA_ADJUSTMENTS, MEDIA_FILTERS, type CanvasElement, type MediaFilter, type MediaLook } from "@/lib/template-editor/model";
import { DUOTONE_DEFAULTS, MEDIA_ADJUSTMENT_LABELS, MEDIA_FILTER_LABELS, lookMatrix, mediaLook, setMediaLook } from "@/lib/template-editor/media-looks";
import { photoContent } from "@/lib/template-editor/photo-frames";
import { proxied } from "@/lib/engine/util";
import { ColorField } from "./controls";
import { LookFilter } from "./look-filter";
import { RangeRow } from "./text-format-bar";

type Update = (group: string, transform: (element: CanvasElement) => CanvasElement) => void;

const same = <T,>(values: T[]) => values.length > 0 && values.every(value => JSON.stringify(value) === JSON.stringify(values[0])) ? values[0] : undefined;

/** A tile: the selected picture itself through the filter, as Canva shows them. */
function Tile({ src, look, label, pressed, onClick }: { src?: string; look: MediaLook; label: string; pressed: boolean; onClick: () => void }) {
  const id = `look-tile-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`, matrix = lookMatrix(look);
  return <button type="button" aria-label={`${label} filter`} aria-pressed={pressed} onClick={onClick}>
    {matrix && <LookFilter id={id} matrix={matrix} />}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <span className="te-look-tile">{src ? <img src={src} alt="" draggable={false} referrerPolicy="no-referrer" style={{ filter: matrix ? `url(#${id})` : undefined }} /> : null}</span>
    {label}
  </button>;
}

/** Filters and Adjust on photos and videos (a photo layer or a shape's photo fill), after
 * Canva's photo editor. Each change is one undo step; agents set the same `look`. */
export function MediaLooksPanel({ photos, disabled, update, part = "all" }: { photos: CanvasElement[]; disabled: boolean; update: Update; part?: "filters" | "adjust" | "all" }) {
  const looks = photos.map(element => mediaLook(element) ?? {});
  const filter = same(looks.map(look => look.filter ?? "original"));
  const first = looks[0] ?? {}, current = filter && filter !== "original" ? first : undefined;
  const src = photos[0] && photoContent(photos[0])?.src;
  const thumb = src ? proxied(src) : undefined;
  const set = (group: string, next: (look: MediaLook) => MediaLook | null) => update(group, element => setMediaLook(element, next(mediaLook(element) ?? {})));
  const pick = (choice: MediaFilter | "original") => set("media-filter", look => {
    const next: MediaLook = { ...look };
    delete next.intensity; delete next.shadow; delete next.highlight;
    if (choice === "original") delete next.filter; else next.filter = choice;
    return next;
  });
  const adjust = (key: (typeof MEDIA_ADJUSTMENTS)[number], value: number) => set(`media-adjust-${key}`, look => ({ ...look, [key]: Math.round(value) }));
  const adjusted = looks.some(look => MEDIA_ADJUSTMENTS.some(key => look[key]));
  return <fieldset className="te-media-looks" disabled={disabled}>
    {part !== "adjust" && <>
      <div className="te-effect-presets te-look-presets" role="group" aria-label="Filters">
        <Tile src={thumb} look={{}} label="Original" pressed={filter === "original"} onClick={() => pick("original")} />
        {MEDIA_FILTERS.map(kind => <Tile key={kind} src={thumb} look={{ filter: kind }} label={MEDIA_FILTER_LABELS[kind]} pressed={filter === kind} onClick={() => pick(kind)} />)}
      </div>
      {current?.filter && <div className="te-text-effect-controls">
        <RangeRow label="Intensity" min={0} max={100} step={1} value={current.intensity ?? 100} onChange={value => set("media-filter-intensity", look => ({ ...look, intensity: Math.round(value) }))} />
        {current.filter === "duotone" && <>
          <ColorField label="Darks" value={current.shadow ?? DUOTONE_DEFAULTS.shadow} onChange={value => set("media-duotone-shadow", look => ({ ...look, shadow: value }))} />
          <ColorField label="Lights" value={current.highlight ?? DUOTONE_DEFAULTS.highlight} onChange={value => set("media-duotone-highlight", look => ({ ...look, highlight: value }))} />
        </>}
      </div>}
    </>}
    {part !== "filters" && <div className="te-text-effect-controls te-look-adjust" role="group" aria-label="Adjust">
      {MEDIA_ADJUSTMENTS.map(key => <RangeRow key={key} label={MEDIA_ADJUSTMENT_LABELS[key]} min={-100} max={100} step={1} value={same(looks.map(look => look[key] ?? 0))} onChange={value => adjust(key, value)} />)}
      <button type="button" className="te-look-reset" disabled={!adjusted} onClick={() => set("media-adjust-reset", look => { const next = { ...look }; for (const key of MEDIA_ADJUSTMENTS) delete next[key]; return next; })}>Reset adjustments</button>
    </div>}
  </fieldset>;
}
