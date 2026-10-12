"use client";

import { useState } from "react";
import { Modal } from "./controls";
import { DesignPreview } from "./preview";
import { applyTemplateToDesign, templateSlotContent, type TemplateApplicationOptions } from "@/lib/template-editor/advanced";
import { formatDimensions, type DesignTemplate, type DesignDocument, type CanvasScene } from "@/lib/template-editor/model";
import { sliceSceneForPage } from "@/lib/template-editor/continuous-carousel";
import { elementIntersectsCanvas } from "@/lib/template-editor/canvas-geometry";
import "./dialog-tools.css";

type Props = {
  template: DesignTemplate;
  design: DesignDocument;
  scene: CanvasScene;
  pageId: string;
  disabled: boolean;
  onChangeDesign: (design: DesignDocument) => boolean | void;
  onChangeScene: (scene: CanvasScene) => boolean | void;
  onClose: () => void;
};

export function TemplateApplyDialog({ template, design, scene, pageId, disabled, onChangeDesign, onClose }: Props) {
  const dimensions = formatDimensions(design), currentPage = design.pages.find(page => page.id === pageId) ?? design.pages[0];
  const slotElements = design.continuousCanvas ? sliceSceneForPage(design, currentPage).elements.filter(element => elementIntersectsCanvas(element, 360, 360 * dimensions.height / dimensions.width)) : scene.elements;
  const [selectedPage, setSelectedPage] = useState(template.pages[0].id);
  const [mode, setMode] = useState<TemplateApplicationOptions["mode"]>("replace");
  const [preserveSlots, setPreserveSlots] = useState(true);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((template.parameters ?? []).map(parameter => {
    const existing = slotElements.find(element => element.slot === parameter.id || element.slot === parameter.name);
    const value = existing ? templateSlotContent(existing, parameter.type) : undefined;
    return [parameter.id, value ?? parameter.defaultValue ?? ""];
  })));
  const [error, setError] = useState("");
  const preview: DesignDocument = { ...template, id: template.id, templateId: template.id, caption: "", createdAt: "", updatedAt: "" };
  const count = mode === "append-all" ? template.pages.length : mode === "append-page" ? 1 : 0;
  const exceedsPages = design.pages.length + count > 20;

  return <Modal title="Use template" onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      if (disabled || exceedsPages) return;
      try {
        const next = applyTemplateToDesign(design, template, { pageId, templatePageId: selectedPage, mode, values, preserveSlots });
        if (onChangeDesign(next) === false) throw new Error("The template could not be saved. Check the workspace save status.");
        onClose();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply this template."); }
    }}>
      <fieldset disabled={disabled} className="te-pro-panel te-tool-dialog te-template-dialog">
        <p>{template.name}</p>
        <section>
          {template.pages.length>1&&<strong>Choose a page</strong>}
          <div className="te-dialog-preview-grid">
            {template.pages.map((page, index) => <button type="button" key={page.id} className={`te-dialog-page ${selectedPage === page.id ? "is-selected" : ""}`} aria-label={`Select template page ${index + 1}${page.label ? `, ${page.label}` : ""}`} aria-pressed={selectedPage === page.id} onClick={() => { setSelectedPage(page.id); setError(""); }}>
              <DesignPreview design={preview} page={page} />
              <span>{page.label || `Page ${index + 1}`}</span>
            </button>)}
          </div>
        </section>
        <section>
          <label>Where to use it
            <select aria-label="Template application mode" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setError(""); }}>
              <option value="replace">Replace this {design.continuousCanvas ? "slide" : "page"}</option>
              <option value="append-page" disabled={design.pages.length >= 20}>Add as a new page</option>
              <option value="append-all" disabled={design.pages.length + template.pages.length > 20}>Add all {template.pages.length} pages</option>
            </select>
          </label>
          <p>{mode==='replace'?"Updates the current page. You can undo this change.":"Adds pages at the end of your design."}</p>
          <details><summary>Content options</summary><div className="te-dialog-details-body"><label className="te-dialog-check"><input type="checkbox" checked={preserveSlots} onChange={event => {
            const preserve = event.target.checked;
            setPreserveSlots(preserve);
            setValues(Object.fromEntries((template.parameters ?? []).map(parameter => {
              const existing = preserve ? slotElements.find(element => element.slot === parameter.id || element.slot === parameter.name) : undefined;
              const value = existing ? templateSlotContent(existing, parameter.type) : undefined;
              return [parameter.id, value ?? parameter.defaultValue ?? ""];
            })));
          }} />Keep my matching text and photos</label>
          <p>{design.continuousCanvas ? "The template fits your slide and keeps artwork crossing page boundaries." : "The template fits your design size. Your saved styles and shared artwork remain available."}</p></div></details>
          {exceedsPages && <p role="alert">This action would exceed the 20-page limit.</p>}
        </section>
        {!!template.parameters?.length && <section>
          <strong>Your content</strong>
          {(template.parameters ?? []).map(parameter => <label key={parameter.id}>{parameter.name}{parameter.required ? " *" : ""}
            <input aria-label={`Template field ${parameter.name}`} type="text" value={values[parameter.id] ?? ""} required={parameter.required} maxLength={parameter.maxLength ?? 20000} placeholder={parameter.type === "image" ? "https://… or an existing asset URL" : parameter.type === "color" ? "#RRGGBB" : parameter.defaultValue} onChange={event => { setValues(previous => ({ ...previous, [parameter.id]: event.target.value })); setError(""); }} />
          </label>)}
        </section>}
      </fieldset>
      {error && <p role="alert" className="te-dialog-error">{error}</p>}
      <div className="te-dialog-footer">
        <button type="button" className="te-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="te-button te-primary" disabled={disabled || exceedsPages}>{mode === "replace" ? "Use on this page" : mode === "append-page" ? "Add page" : `Add ${template.pages.length} pages`}</button>
      </div>
    </form>
  </Modal>;
}
