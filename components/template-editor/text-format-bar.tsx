"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EditorIcon } from "./editor-icons";
import { FONTS, NumberInput } from "./controls";
import { PaintPicker } from "./paint-picker";
import { SmartQuickControls } from "./smart-text-controls";
import { changeTextCase } from "./element-inspector";
import type { CanvasElement, CanvasScene, TextElement } from "@/lib/template-editor/model";
import { commonValue, boldState, booleanState } from "@/lib/template-editor/property-utils";
import { canEditElement } from "@/lib/template-editor/commands";
import { applyElementPaint, commonElementPaint, paintTextFormattingPatch } from "@/lib/template-editor/paint";
import type { TextFormattingPatch } from "@/lib/template-editor/rich-text-editing";
import "./text-format-bar.css";

type Props = {
  scene: CanvasScene;
  selectedIds: string[];
  texts: TextElement[];
  disabled: boolean;
  outputScale: number;
  onChange: (scene: CanvasScene, group?: string) => void;
  onFormatText?: (patch: TextFormattingPatch) => boolean;
  /** Apply a style patch to the selected text (selected words while typing). */
  patchText: (patch: Partial<TextElement>) => void;
  toggleText: (key: "fontWeight" | "italic" | "underline" | "strikethrough") => void;
  update: (transform: (element: CanvasElement) => CanvasElement, property?: "style" | "content", group?: string) => void;
};

const ALIGN_NEXT = { left: "center", center: "right", right: "left" } as const;
const LIST_NEXT = { none: "bullet", bullet: "number", number: "none" } as const;

/** Canva's text bar: font, − size +, color, B I U S, aA, alignment, list,
 * spacing and transparency, in that order. Controls the template fixes stay
 * visible but disabled, with a reason on hover. */
export function TextFormatBar({ scene, selectedIds, texts, disabled, outputScale, onChange, onFormatText, patchText, toggleText, update }: Props) {
  const smart = texts.every(element => element.smartText);
  const styleEditable = texts.some(element => canEditElement(scene, element, "style"));
  const contentEditable = texts.some(element => canEditElement(scene, element, "content"));
  const styleOff = disabled || !styleEditable;
  const fixed = styleOff && !disabled ? "Set by the template" : undefined;
  const align = commonValue(texts, "align");
  const list = commonValue(texts, "listStyle") ?? (texts.every(element => !element.listStyle) ? "none" : undefined);
  const upper = texts.length > 0 && texts.every(element => /\p{L}/u.test(element.text) && element.text === element.text.toLocaleUpperCase());
  const size = commonValue(texts, "fontSize");
  const opacity = commonValue(texts, "opacity");
  const lineHeight = commonValue(texts, "lineHeight");
  const tracking = texts.length && texts.every(element => Math.abs(element.letterSpacing / element.fontSize - texts[0].letterSpacing / texts[0].fontSize) < 1e-4) ? Math.round(texts[0].letterSpacing / texts[0].fontSize * 1000) : undefined;
  const hold = (event: { preventDefault: () => void }) => event.preventDefault();
  const pressed = (state: boolean | "mixed") => state === "mixed" ? "mixed" : state;
  return <div className="te-format-bar" role="group" aria-label="Text formatting">
    <select className="te-format-font" aria-label="Quick font" title={fixed ?? "Font"} disabled={styleOff} value={commonValue(texts, "font") ?? ""} onChange={event => patchText({ font: event.target.value })}>
      {commonValue(texts, "font") === undefined && <option value="" disabled>Mixed fonts</option>}
      {FONTS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
    {smart
      ? <SmartQuickControls scene={scene} selectedIds={selectedIds} disabled={disabled} outputScale={outputScale} onChange={onChange} />
      : <div className="te-smart-size-control is-compact" role="group" aria-label="Font size">
        <button type="button" aria-label="Font: smaller" title={fixed ?? "Smaller"} disabled={styleOff || size === undefined} onMouseDown={hold} onClick={() => size !== undefined && patchText({ fontSize: Math.max(1, Math.round(size * outputScale) - 1) / outputScale })}>−</button>
        <NumberInput key={`text-size:${texts.map(element => element.id).join(":")}`} aria-label="Quick font size" title="Font size in export pixels" min={outputScale} max={500 * outputScale} disabled={styleOff} placeholder="Mixed" value={size === undefined ? "" : Number((size * outputScale).toFixed(2))} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next) && next >= outputScale && next <= 500 * outputScale) patchText({ fontSize: next / outputScale }); }} />
        <button type="button" aria-label="Font: bigger" title={fixed ?? "Bigger"} disabled={styleOff || size === undefined} onMouseDown={hold} onClick={() => size !== undefined && patchText({ fontSize: Math.min(500 * outputScale, Math.round(size * outputScale) + 1) / outputScale })}>+</button>
      </div>}
    <span className="te-format-sep" aria-hidden="true" />
    <span className="te-format-color" title={fixed ?? "Text color"}>
      <PaintPicker key={`text-paint:${texts.map(element => element.id).join(":")}`} label="Quick text color" compact value={commonElementPaint(texts)} disabled={styleOff} onChange={paint => {
        const patch = paintTextFormattingPatch(paint);
        if (!disabled && patch && onFormatText?.(patch)) return;
        update(element => element.type === "text" ? applyElementPaint(element, paint) : element);
      }} />
    </span>
    <button type="button" className="te-format-button" aria-label="Quick bold" title={fixed ?? "Bold · ⌘/Ctrl B"} aria-pressed={pressed(boldState(texts))} disabled={styleOff} onMouseDown={hold} onClick={() => toggleText("fontWeight")}><b>B</b></button>
    <button type="button" className="te-format-button" aria-label="Quick italic" title={fixed ?? "Italic · ⌘/Ctrl I"} aria-pressed={pressed(booleanState(texts, "italic"))} disabled={styleOff} onMouseDown={hold} onClick={() => toggleText("italic")}><i>I</i></button>
    <button type="button" className="te-format-button" aria-label="Underline" title={fixed ?? "Underline · ⌘/Ctrl U"} aria-pressed={pressed(booleanState(texts, "underline"))} disabled={styleOff} onMouseDown={hold} onClick={() => toggleText("underline")}><u>U</u></button>
    <button type="button" className="te-format-button" aria-label="Strikethrough" title={fixed ?? "Strikethrough"} aria-pressed={pressed(booleanState(texts, "strikethrough"))} disabled={styleOff} onMouseDown={hold} onClick={() => toggleText("strikethrough")}><s>S</s></button>
    <button type="button" className="te-format-button te-format-case" aria-label="Uppercase" title="Uppercase" aria-pressed={upper} disabled={disabled || !contentEditable} onMouseDown={hold} onClick={() => update(element => element.type === "text" ? changeTextCase(element, !upper) : element, "content", upper ? "lowercase" : "uppercase")}>aA</button>
    <span className="te-format-sep" aria-hidden="true" />
    <button type="button" className="te-format-button" aria-label={`Text alignment: ${align ?? "mixed"}`} title={fixed ?? "Alignment"} disabled={styleOff} onMouseDown={hold} onClick={() => patchText({ align: ALIGN_NEXT[align ?? "right"] })}><EditorIcon name={`align-${align ?? "left"}`} /></button>
    <button type="button" className="te-format-button" aria-label={`List: ${list ?? "mixed"}`} title={fixed ?? "List"} aria-pressed={list !== undefined && list !== "none"} disabled={styleOff} onMouseDown={hold} onClick={() => patchText({ listStyle: LIST_NEXT[list ?? "number"] })}><EditorIcon name={list === "number" ? "list-number" : "list"} /></button>
    <ToolbarPopover label="Spacing" icon="spacing" disabled={styleOff} title={fixed}>
      <RangeRow label="Letter spacing" min={-200} max={800} step={10} value={tracking} onChange={value => update(element => element.type === "text" ? { ...element, letterSpacing: value / 1000 * element.fontSize } : element, "style", "letter-spacing")} />
      <RangeRow label="Line spacing" min={.5} max={2.5} step={.01} value={lineHeight} onChange={value => patchText({ lineHeight: value })} />
      <div className="te-format-anchor" role="group" aria-label="Anchor text">
        <span>Anchor</span>
        {(["top", "middle", "bottom"] as const).map(anchor => <button key={anchor} type="button" aria-pressed={texts.every(element => (element.verticalAlign ?? "top") === anchor)} onClick={() => update(element => element.type === "text" ? { ...element, verticalAlign: anchor } : element, "style", "text-anchor")}>{anchor[0].toUpperCase() + anchor.slice(1)}</button>)}
      </div>
    </ToolbarPopover>
    <ToolbarPopover label="Transparency" icon="transparency" disabled={styleOff} title={fixed}>
      <RangeRow label="Transparency" min={0} max={100} step={1} value={opacity === undefined ? undefined : Math.round(opacity * 100)} onChange={value => update(element => ({ ...element, opacity: value / 100 }), "style", "opacity")} />
    </ToolbarPopover>
  </div>;
}

function RangeRow({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number | undefined; onChange: (value: number) => void }) {
  const clamp = (input: number) => Math.max(min, Math.min(max, input));
  return <label className="te-format-range">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value ?? min} aria-label={label} onChange={event => onChange(clamp(event.target.valueAsNumber))} />
    <input type="number" min={min} max={max} step={step} key={value ?? "mixed"} defaultValue={value} placeholder="–" aria-label={`${label} value`}
      onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
      onBlur={event => { const next = Number(event.currentTarget.value); if (event.currentTarget.value !== "" && Number.isFinite(next) && clamp(next) !== value) onChange(clamp(next)); }} />
  </label>;
}

/** A toolbar button with a small panel under it, drawn outside the toolbar so a scrolling bar doesn't clip it. */
export function ToolbarPopover({ label, icon, disabled, title, children }: { label: string; icon: "spacing" | "transparency"; disabled: boolean; title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { const target = event.target as Node; if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", escape); };
  }, [open]);
  const shown = open && !disabled;
  return <>
    <button ref={trigger} type="button" className="te-format-button" aria-label={label} title={title ?? label} aria-haspopup="dialog" aria-expanded={shown} aria-pressed={shown} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { const box = trigger.current?.getBoundingClientRect(); if (box) setPlace({ left: Math.max(8, Math.min(window.innerWidth - 288, box.left + box.width / 2 - 140)), top: box.bottom + 8 }); setOpen(value => !value); }}><EditorIcon name={icon} /></button>
    {shown && place && createPortal(<div ref={panel} className="te-root te-format-popover" role="dialog" aria-label={label} style={place} onKeyDown={event => event.stopPropagation()}>{children}</div>, document.body)}
  </>;
}
