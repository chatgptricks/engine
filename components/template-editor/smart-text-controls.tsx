"use client";

import { useLayoutEffect, useState } from "react";
import type { CanvasScene } from "@/lib/template-editor/model";
import { canEditElement } from "@/lib/template-editor/commands";
import { clearSmartTextMeasurements, layoutSmartScene, type SmartSceneLayout } from "@/lib/template-editor/smart-text";
import "./smart-text.css";

export function useSmartScene(scene: CanvasScene): SmartSceneLayout {
  const [measured, setMeasured] = useState<{ source: CanvasScene; result: SmartSceneLayout } | null>(null);
  useLayoutEffect(() => {
    if (!scene.elements.some(element => element.type === "text" && element.smartText)) return;
    let active = true;
    const measure = () => { if (active) { clearSmartTextMeasurements(); setMeasured({ source: scene, result: layoutSmartScene(scene) }); } };
    measure();
    document.fonts?.addEventListener("loadingdone", measure);
    return () => { active = false; document.fonts?.removeEventListener("loadingdone", measure); };
  }, [scene]);
  return measured?.source === scene ? measured.result : { scene, texts: new Map() };
}

export function SmartTextControls({ scene, selectedIds, disabled = false, compact = false, outputScale = 3, onChange }: {
  scene: CanvasScene; selectedIds: string[]; disabled?: boolean; compact?: boolean; outputScale?: number;
  onChange: (scene: CanvasScene, group?: string) => void;
}) {
  const measured = useSmartScene(scene);
  // Lists fit their column by themselves; a line count means nothing for them.
  const texts = scene.elements.filter(element => selectedIds.includes(element.id) && element.type === "text" && element.smartText && element.smartText.role !== "list");
  if (!texts.length) return null;
  const warnings = [...new Set(texts.flatMap(element => measured.texts.get(element.id)?.warning ?? []))];
  const editable = !disabled && texts.every(element => canEditElement(scene, element, "content"));
  return <div className={`te-smart-text${compact ? " is-compact" : ""}`}>
    <div className="te-smart-line-control" role="group" aria-label={compact ? "Quick fit text to lines" : "Fit text to lines"}>
      <span>Fit text</span>
      {([0, 2, 3, 4] as const).map(lines => <button key={lines} type="button" disabled={!editable} aria-label={`${compact ? "Quick " : ""}${lines ? `Fit to ${lines} lines` : "Automatic text fit"}`} aria-pressed={texts.every(element => element.type === "text" && element.smartText?.lines === lines)} onMouseDown={event => event.preventDefault()} onClick={() => {
        if (!editable) return;
        onChange({ ...scene, elements: scene.elements.map(element => selectedIds.includes(element.id) && element.type === "text" && element.smartText && canEditElement(scene, element, "content") ? { ...element, smartText: { ...element.smartText, lines } } : element) }, "smart-text-lines");
      }}>{lines ? `${lines} lines` : "Auto"}</button>)}
    </div>
    {!compact && <SmartSizeControl scene={scene} texts={texts} fitted={texts.map(element => measured.texts.get(element.id)?.fontSize)} editable={editable} outputScale={outputScale} onChange={onChange} />}
    {!compact && <p className="te-element-hint">{texts.every(element => element.type === "text" && element.smartText?.role === "cover") ? "Centered, balanced lines. Single-word lines are avoided." : "Left aligned, with automatic sizing and spacing."} Your wording stays unchanged.{texts.length === 1 && measured.texts.get(texts[0].id) && texts[0].type === "text" && texts[0].smartText?.fontSize === undefined ? ` Fitted size: ${Math.round(measured.texts.get(texts[0].id)!.fontSize * outputScale)} px.` : ""}</p>}
    {warnings.map(warning => <p key={warning} className="te-smart-warning" role="status">{warning}</p>)}
  </div>;
}

/** Size steps in export pixels; the field shows the size the slide exports at. */
const SIZE_STEP = 2, MIN_SIZE = 8, MAX_SIZE = 400;

/** A headline's own size, in export pixels: − / + and the field set it, and
 * the text keeps it (only its line breaks follow); Auto size hands it back to the fit. */
export function SmartSizeStepper({ label = "Text", value, manual, disabled, onSet }: {
  label?: string; value: number | undefined; manual: boolean; disabled: boolean;
  onSet: (size: number | undefined, current: number | undefined) => void;
}) {
  const clamp = (size: number) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size)));
  return <div className="te-smart-size-control" role="group" aria-label={`${label} size`}>
    <span>Size</span>
    <button type="button" disabled={disabled || value === undefined} aria-label={`${label}: smaller`} onMouseDown={event => event.preventDefault()} onClick={() => value !== undefined && onSet(clamp(value - SIZE_STEP), value)}>−</button>
    <input type="number" aria-label={`${label} size in pixels`} min={MIN_SIZE} max={MAX_SIZE} step={1} disabled={disabled} key={value ?? "mixed"} defaultValue={value} placeholder="Mixed"
      onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
      onBlur={event => { const size = Number(event.currentTarget.value); if (event.currentTarget.value !== "" && Number.isFinite(size) && clamp(size) !== value) onSet(clamp(size), value); }} />
    <span className="te-smart-size-unit">px</span>
    <button type="button" disabled={disabled || value === undefined} aria-label={`${label}: bigger`} onMouseDown={event => event.preventDefault()} onClick={() => value !== undefined && onSet(clamp(value + SIZE_STEP), value)}>+</button>
    <button type="button" className="te-smart-size-auto" disabled={disabled || !manual} aria-pressed={!manual} onMouseDown={event => event.preventDefault()} onClick={() => onSet(undefined, value)}>Auto size</button>
  </div>;
}

function SmartSizeControl({ scene, texts, fitted, editable, outputScale, onChange }: {
  scene: CanvasScene; texts: CanvasScene["elements"]; fitted: (number | undefined)[]; editable: boolean; outputScale: number;
  onChange: (scene: CanvasScene, group?: string) => void;
}) {
  const sizes = texts.map((element, index) => element.type === "text" ? element.smartText?.fontSize ?? fitted[index] ?? element.fontSize : undefined);
  const value = sizes.every(size => size !== undefined && Math.abs(size - sizes[0]!) < .01) && sizes[0] !== undefined ? Math.round(sizes[0] * outputScale) : undefined;
  const manual = texts.some(element => element.type === "text" && element.smartText?.fontSize !== undefined);
  const ids = new Set(texts.map(element => element.id));
  return <SmartSizeStepper value={value} manual={manual} disabled={!editable} onSet={size => {
    if (!editable) return;
    onChange({ ...scene, elements: scene.elements.map(element => {
      if (!ids.has(element.id) || element.type !== "text" || !element.smartText || !canEditElement(scene, element, "content")) return element;
      const smartText = { ...element.smartText };
      if (size === undefined) delete smartText.fontSize; else smartText.fontSize = Math.round(size / outputScale * 100) / 100;
      return { ...element, smartText };
    }) }, "smart-text-size");
  }} />;
}
