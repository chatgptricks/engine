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
  const texts = scene.elements.filter(element => selectedIds.includes(element.id) && element.type === "text" && element.smartText);
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
    {!compact && <p className="te-element-hint">{texts.every(element => element.type === "text" && element.smartText?.role === "cover") ? "Centered, balanced lines. Single-word lines are avoided." : "Left aligned, with automatic sizing and spacing."} Your wording stays unchanged.{texts.length === 1 && measured.texts.get(texts[0].id) ? ` Fitted size: ${Math.round(measured.texts.get(texts[0].id)!.fontSize * outputScale)} px.` : ""}</p>}
    {warnings.map(warning => <p key={warning} className="te-smart-warning" role="status">{warning}</p>)}
  </div>;
}
