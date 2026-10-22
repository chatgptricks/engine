"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { gradientCss } from "@/lib/template-editor/appearance";
import { GRADIENT_PRESETS, RECENT_PAINTS_KEY, addRecentPaint, paintKey, recentPaintsFromStorage, updatePaintStop, type Paint } from "@/lib/template-editor/paint";
import { ColorField, NumberInput } from "./controls";
import "./paint-picker.css";

type Props = {
  label: string;
  value?: Paint;
  onChange: (paint: Paint) => void;
  disabled?: boolean;
  compact?: boolean;
  allowGradient?: boolean;
};

const DEFAULT_PAINT: Paint = { type: "solid", color: "#ffffff" };
const COLORS = ["#ffffff", "#000000", "#64748b", "#ef4444", "#f97316", "#facc15", "#22c55e", "#00d98a", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];
const RECENT_EVENT = "engine:recent-paints-change";
const serverSnapshot = () => "[]";
function recentSnapshot() { try { return localStorage.getItem(RECENT_PAINTS_KEY) ?? "[]"; } catch { return "[]"; } }
function subscribeRecent(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === RECENT_PAINTS_KEY || event.key === null) listener(); };
  window.addEventListener("storage", storage); window.addEventListener(RECENT_EVENT, listener);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(RECENT_EVENT, listener); };
}
function rememberPaint(paint: Paint) {
  try {
    localStorage.setItem(RECENT_PAINTS_KEY, JSON.stringify(addRecentPaint(recentPaintsFromStorage(recentSnapshot()), paint)));
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch { /* Editing still works when browser storage is unavailable. */ }
}
function paintBackground(paint?: Paint) {
  return !paint ? "repeating-linear-gradient(135deg,#fff 0 4px,#575761 4px 8px)" : paint.type === "solid" ? paint.color : gradientCss({ ...paint.gradient, stops: [...paint.gradient.stops].sort((a, b) => a.position - b.position) });
}
function paintLabel(paint: Paint) { return paint.type === "solid" ? paint.color.toUpperCase() : `${paint.gradient.type === "radial" ? "Radial" : "Linear"} gradient`; }
function PaintSwatch({ paint, name, selected, onClick }: { paint: Paint; name: string; selected: boolean; onClick: () => void }) {
  return <button type="button" className="te-paint-swatch" aria-label={name} title={name} aria-pressed={selected} onClick={onClick}><span style={{ background: paintBackground(paint) }} /></button>;
}

/** Shared by the canvas toolbar and inspector; popovers escape scrolling toolbars. */
export function PaintPicker({ label, value, onChange, disabled = false, compact = false, allowGradient = true }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Paint>(value ?? DEFAULT_PAINT);
  const [activeStop, setActiveStop] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const changed = useRef<Paint | null>(null);
  const id = useId();
  const recent = recentPaintsFromStorage(useSyncExternalStore(subscribeRecent, recentSnapshot, serverSnapshot)).filter(paint => allowGradient || paint.type === "solid");
  const gradient = draft.type === "gradient" ? draft.gradient : undefined;
  const stopIndex = gradient ? Math.min(activeStop, gradient.stops.length - 1) : 0;
  const stop = gradient?.stops[stopIndex];

  function close(restoreFocus = false) {
    if (changed.current) { rememberPaint(changed.current); changed.current = null; }
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function choose(paint: Paint, remember = false) {
    setDraft(paint); changed.current = paint; onChange(paint);
    if (remember) rememberPaint(paint);
  }
  function chooseGradient(paint: Paint) { setActiveStop(0); choose(paint, true); }
  function patchGradient(patch: Partial<NonNullable<typeof gradient>>) {
    if (gradient) choose({ type: "gradient", gradient: { ...gradient, ...patch } });
  }

  useEffect(() => () => { if (changed.current) rememberPaint(changed.current); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      if (changed.current) { rememberPaint(changed.current); changed.current = null; }
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const button = trigger.current, popup = panel.current;
      if (!button || !popup) return;
      const bounds = button.getBoundingClientRect();
      const margin = 12;
      popup.style.maxHeight = `${window.innerHeight - margin * 2}px`;
      const width = popup.offsetWidth, height = popup.offsetHeight;
      const below = bounds.bottom + 8;
      const top = below + height <= window.innerHeight - margin ? below : Math.max(margin, bounds.top - height - 8);
      popup.style.left = `${Math.max(margin, Math.min(bounds.left, window.innerWidth - width - margin))}px`;
      popup.style.top = `${top}px`;
      popup.style.visibility = "visible";
    };
    position();
    const observer = new ResizeObserver(position);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);

  return <div className={`te-paint-field${compact ? " is-compact" : ""}`}>
    {!compact && <span className="te-paint-label">{label}</span>}
    <button ref={trigger} type="button" className="te-paint-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} title={`${label}: ${value ? paintLabel(value) : "Mixed"}`} onMouseDown={event => event.preventDefault()} onClick={() => {
      if (open) close();
      else { setDraft(value ?? DEFAULT_PAINT); setActiveStop(0); setOpen(true); }
    }}>
      <span className="te-paint-chip"><span style={{ background: paintBackground(value) }} /></span>
      {!compact && <span className="te-paint-value">{value ? paintLabel(value) : "Mixed"}</span>}
      {!compact && <span aria-hidden="true" className="te-paint-chevron">⌄</span>}
    </button>
    {open && !disabled && createPortal(<div ref={panel} id={id} className="te-paint-popover" role="dialog" aria-label={`${label} picker`} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(true); } }} onMouseDown={event => { if ((event.target as Element).closest("button")) event.preventDefault(); }}>
      <div className="te-paint-heading"><strong>{label.replace(/^Quick /, "")}</strong><button type="button" aria-label="Close color picker" title="Close" onClick={() => close(true)}>×</button></div>
      {allowGradient && <div className="te-paint-tabs" role="group" aria-label="Fill type">
        <button type="button" aria-pressed={draft.type === "solid"} onClick={() => choose({ type: "solid", color: draft.type === "solid" ? draft.color : draft.gradient.stops[stopIndex]?.color ?? "#ffffff" })}>Solid</button>
        <button type="button" aria-pressed={draft.type === "gradient"} onClick={() => { if (draft.type !== "gradient") chooseGradient(GRADIENT_PRESETS[0].paint); }}>Gradient</button>
      </div>}
      {draft.type === "solid" ? <>
        <ColorField label="Color" value={draft.color} onChange={color => choose({ type: "solid", color })} />
        <div className="te-paint-swatches" aria-label="Solid colors">{COLORS.map(color => <PaintSwatch key={color} paint={{ type: "solid", color }} name={`Use ${color.toUpperCase()}`} selected={paintKey({ type: "solid", color }) === paintKey(draft)} onClick={() => choose({ type: "solid", color }, true)} />)}</div>
      </> : gradient && stop && <>
        <div className="te-paint-gradient-preview" style={{ background: paintBackground(draft) }} aria-label="Gradient preview" />
        <div className="te-paint-subheading"><span>Color stops</span><button type="button" className="te-paint-text-button" disabled={gradient.stops.length >= 20} onClick={() => {
          const next = { color: stop.color, position: 50 };
          patchGradient({ stops: [...gradient.stops, next] }); setActiveStop(gradient.stops.length);
        }}>+ Add stop</button></div>
        <div className="te-paint-stops">{gradient.stops.map((item, index) => <button key={index} type="button" className={`te-paint-stop${index === stopIndex ? " is-selected" : ""}`} aria-label={`Gradient stop ${index + 1}`} aria-pressed={index === stopIndex} title={`Stop ${index + 1}: ${item.position}%`} onClick={() => setActiveStop(index)}><span className="te-paint-chip"><span style={{ background: item.color }} /></span><small>{Math.round(item.position)}%</small></button>)}</div>
        <ColorField key={stopIndex} label={`Stop ${stopIndex + 1} color`} value={stop.color} onChange={color => choose(updatePaintStop(draft, stopIndex, { color }))} />
        <div className="te-paint-stop-position"><label>Position <NumberInput aria-label="Gradient stop position" min={0} max={100} value={stop.position} onChange={event => choose(updatePaintStop(draft, stopIndex, { position: event.target.valueAsNumber }))} /><span>%</span></label><button type="button" className="te-paint-text-button" disabled={gradient.stops.length <= 2} onClick={() => { patchGradient({ stops: gradient.stops.filter((_, index) => index !== stopIndex) }); setActiveStop(Math.max(0, stopIndex - 1)); }}>Remove stop</button></div>
        <div className="te-paint-direction"><label>Style<select aria-label="Gradient style" value={gradient.type} onChange={event => patchGradient({ type: event.target.value as "linear" | "radial" })}><option value="linear">Linear</option><option value="radial">Radial</option></select></label>{gradient.type === "linear" && <label>Angle <span><NumberInput aria-label="Gradient angle" min={0} max={360} value={gradient.angle} onChange={event => { const angle = event.target.valueAsNumber; if (Number.isFinite(angle) && angle >= 0 && angle <= 360) patchGradient({ angle }); }} />°</span></label>}</div>
        <div className="te-paint-subheading">Presets</div><div className="te-paint-swatches is-presets">{GRADIENT_PRESETS.map(({ name, paint }) => <PaintSwatch key={name} paint={paint} name={`${name} gradient`} selected={paintKey(paint) === paintKey(draft)} onClick={() => chooseGradient(paint)} />)}</div>
      </>}
      {!!recent.length && <div className="te-paint-recents"><div className="te-paint-subheading">Recently used</div><div className="te-paint-swatches">{recent.map((paint, index) => <PaintSwatch key={paintKey(paint)} paint={paint} name={`Recent ${index + 1}: ${paintLabel(paint)}`} selected={paintKey(paint) === paintKey(draft)} onClick={() => { setActiveStop(0); choose(paint, true); }} />)}</div></div>}
    </div>, document.body)}
  </div>;
}
