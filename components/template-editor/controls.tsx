"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "@/components/engine/icons";
import { parseColor, colorWithAlpha } from "@/lib/template-editor/color-utils";

export const FONTS = [
  ["geist", "Geist Sans"],
  ["inter", "Inter"],
  ["space", "Space Grotesk"],
  ["montserrat", "Montserrat"],
  ["libre", "Libre Baskerville"],
  ["playfair", "Playfair Display"],
  ["dmserif", "DM Serif Display"],
  ["lora", "Lora"],
  ["cormorant", "Cormorant"],
  ["crimson", "Crimson Text"],
  ["bebas", "Bebas Neue"],
  ["plexmono", "IBM Plex Mono"],
  ["caveat", "Caveat"],
];

export function FontSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="te-field">
      Typeface
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {value === "" && <option value="" disabled>Mixed typefaces</option>}
        {FONTS.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState(value);
  const [lastRgb, setLastRgb] = useState(parseColor(value)?.rgb ?? "#000000");
  const parsed = parseColor(value);
  const rgb = value.toLowerCase() === "transparent" ? lastRgb : parsed?.rgb ?? "#ffffff";
  return (
    <div className="te-color-control"><div className="te-color-field">
      <span>{label}</span>
      <span>
        <span className="te-color-swatch" data-mixed={!parsed || undefined} style={{ background: "repeating-conic-gradient(#b8b8b8 0% 25%, #fff 0% 50%) 50% / 8px 8px" }}><span style={{ background: parsed ? value : undefined }} />
        <input
          aria-label={label}
          type="color"
          value={rgb}
          onChange={(e) => { setLastRgb(e.target.value); onChange(colorWithAlpha(e.target.value, value.toLowerCase() === "transparent" ? 1 : parsed?.alpha ?? 1)); }}
        />
        </span>
        <input
          className="te-color-hex"
          aria-label={`${label} hex`}
          value={typing ? draft : value.toUpperCase()}
          maxLength={11}
          onFocus={() => {
            setDraft(value.toUpperCase());
            setTyping(true);
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            if (parseColor(e.target.value))
              onChange(e.target.value);
          }}
          onBlur={() => setTyping(false)}
          spellCheck={false}
        />
        <button type="button" className="te-color-none" aria-label={`${label} none`} title="No color" aria-pressed={value.toLowerCase() === "transparent"} onClick={() => { setLastRgb(rgb); onChange("transparent"); }}>None</button>
      </span>
    </div><label className="te-color-alpha"><span>Alpha <output>{parsed ? `${Math.round(parsed.alpha * 100)}%` : "Mixed"}</output></span><input aria-label={`${label} alpha`} type="range" min={0} max={100} step={1} value={parsed ? Math.round(parsed.alpha * 100) : 100} onChange={event => onChange(colorWithAlpha(rgb, Number(event.target.value) / 100))} /></label></div>
  );
}
export function Range({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="te-range">
      <span>
        {label}
        <output>
          {value === undefined ? "Mixed" : `${Number(value.toFixed(2))}${unit}`}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? (min + max) / 2}
        aria-valuetext={value === undefined ? "Mixed values" : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function NumberField({ label, value, min = -30000, max = 30000, step = 1, unit, onChange }: {
  label: string; value: number | undefined; min?: number; max?: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const formatted = value === undefined ? "" : String(Number(value.toFixed(2)));
  return <label className="te-field te-element-number"><span>{label}{unit && <small>{unit}</small>}</span><input type="number" aria-label={label} placeholder="Mixed" value={editing ? draft : formatted} min={min} max={max} step={step}
    onFocus={() => { setDraft(formatted); setEditing(true); }} onBlur={() => setEditing(false)}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); event.stopPropagation(); }}
    onChange={(event) => { setDraft(event.target.value); if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) onChange(Math.min(max, Math.max(min, event.target.valueAsNumber))); }} /></label>;
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      className="te-modal"
      ref={ref}
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="te-modal-head">
        <h2>{title}</h2>
        <button className="te-icon" onClick={onClose} aria-label="Close dialog">
          <CloseIcon />
        </button>
      </div>
      {children}
    </dialog>
  );
}
