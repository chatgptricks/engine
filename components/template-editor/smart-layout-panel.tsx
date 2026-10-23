"use client";

import {useMemo, type ReactNode} from "react";
import type {DesignDocument, DesignTemplate, TextElement} from "@/lib/template-editor/model";
import {canEditElement} from "@/lib/template-editor/commands";
import {smartTemplatePage, smartTemplateTextIds, type SmartTemplateTextPatch} from "@/lib/template-editor/smart-template-editing";
import {useSmartScene} from "./smart-text-controls";
import "./smart-text.css";

export function SmartLayoutPanel({design, pageId, selectedIds, templates, disabled, outputScale, onUpdate, children}: {
  design: DesignDocument; pageId: string; templates: DesignTemplate[]; disabled: boolean; outputScale: number;
  selectedIds: string[]; children: ReactNode;
  onUpdate: (id: string, patch: SmartTemplateTextPatch) => void;
}) {
  const scene = useMemo(() => smartTemplatePage(design, pageId, templates), [design, pageId, templates]);
  const measured = useSmartScene(scene ?? {background: "transparent", elements: []});
  const textIds = smartTemplateTextIds(design, pageId, selectedIds, templates);
  const texts = scene?.elements.filter((element): element is TextElement => element.type === "text" && textIds.includes(element.id)) ?? [];
  const source = design.pages.find(page => page.id === pageId)?.canvas;
  const otherSelection = source?.elements.some(element => selectedIds.includes(element.id) && element.type !== "text");
  const isActive = (id: string) => source?.elements.some(element => element.id === id && element.type === "text" && element.smartText);
  const active = texts.every(element => isActive(element.id));
  return <div className="te-smart-layout-panel">
    {!selectedIds.length && <div className="te-smart-layout-empty"><strong>Select an element</strong><p>Text: Auto / 2 / 3 / 4 lines.<br/>Photo: frame fit and crop.<br/>Elements or groups: alignment and spacing.</p><p>Click an element on the canvas or choose it in Layers.</p></div>}
    {texts.length > 0 && <p className="te-help">Choose the line count for the selected text. Size and spacing adjust automatically.</p>}
    {!active && texts.length > 0 && <p className="te-smart-layout-note">Choose a line count or edit the text to apply smart layout to this slide.</p>}
    {texts.map((element, index) => {
      const label = element.smartText?.role === "body" ? `Content${texts.length > 1 ? ` ${index + 1}` : ""}` : `Title${texts.length > 1 ? ` ${index + 1}` : ""}`;
      const fit = measured.texts.get(element.id);
      const active = isActive(element.id);
      const editable = !disabled && Boolean(scene && canEditElement(scene, element, "content"));
      return <section className="te-smart-layout-card" key={element.id} aria-label={`${label} smart layout`}>
        <h3>{label}</h3>
        <div className="te-smart-line-control" role="group" aria-label={`${label} lines`}>
          <span>Lines</span>
          {([0, 2, 3, 4] as const).map(lines => <button key={lines} type="button" disabled={!editable} aria-label={`${label}: ${lines ? `${lines} lines` : "Auto"}`} aria-pressed={Boolean(active && element.smartText?.lines === lines)} onClick={() => onUpdate(element.id, {lines})}>{lines ? `${lines} lines` : "Auto"}</button>)}
        </div>
        <label className="te-field">{label} text
          <textarea aria-label={`${label} text`} rows={index === 0 ? 4 : 3} maxLength={20000} disabled={!editable} value={element.text} onChange={event => onUpdate(element.id, {text: event.target.value})}/>
        </label>
        <p className="te-element-hint">{element.smartText?.role === "cover" ? "Centered title · balanced lines" : "Left aligned · automatic spacing"}{active && fit ? ` · ${Math.round(fit.fontSize * outputScale)} px` : ""}</p>
        {active && fit?.warning && <p className="te-smart-warning" role="status">{fit.warning}</p>}
      </section>;
    })}
    {selectedIds.length > 0 && (!texts.length || otherSelection) && children}
  </div>;
}
