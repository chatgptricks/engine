"use client";

import type { MouseEvent } from "react";
import { EditorIcon, type EditorIconName } from "./editor-icons";
import { TemplateRoleSelect, type InspectorSection } from "./element-inspector";
import type { CanvasElement, CanvasScene, ShapeElement, TextElement } from "@/lib/template-editor/model";
import { commonValue, boldState, booleanState } from "@/lib/template-editor/property-utils";
import { canEditElement, isElementHidden, isElementLocked } from "@/lib/template-editor/commands";
import { applyElementPaint, commonElementPaint } from "@/lib/template-editor/paint";
import { photoContent, updatePhotoContent } from "@/lib/template-editor/photo-frames";
import { textRangeTogglePatch, type TextFormattingPatch } from "@/lib/template-editor/rich-text-editing";
import { TextFormatBar } from "./text-format-bar";
import { PaintPicker } from "./paint-picker";
import { SpanToolbarControls, type SpanControl } from "./span-photo-controls";
import "./element-inspector.css";

type Props = {
  scene: CanvasScene;
  outputScale?: number;
  selectedIds: string[];
  disabled: boolean;
  onChange: (scene: CanvasScene, group?: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMore: (event: MouseEvent<HTMLButtonElement>) => void;
  onAddText: () => void;
  onUpload: () => void;
  onFormatText?: (patch: TextFormattingPatch) => boolean;
  onEdit?: () => void;
  onTextTexture?: () => void;
  onBackground?: () => void;
  onPosition?: () => void;
  onCrop?: () => void;
  cropping?: boolean;
  onGroup?: () => void;
  onMergeShapes?: () => void;
  onInspect?: (section: InspectorSection) => void;
  activeSection?: InspectorSection | null;
  onReplacePhoto?: () => void;
  onUnlock?: () => void;
  /** Template drafts: page height (scene units) for the "In posts" role picker. */
  templateDraftHeight?: number;
  /** Span, or the Spans menu and Seam slider, for one selected photo. */
  span?: SpanControl;
};

export function QuickToolbar({ scene, selectedIds, disabled, onChange, onMore, onAddText, onUpload, onFormatText, onEdit, onTextTexture, onBackground, onPosition, onCrop, cropping = false, onGroup, onMergeShapes, onInspect, activeSection, onReplacePhoto, templateDraftHeight, span, onUnlock, outputScale = 3 }: Props) {
  const selected=scene.elements.filter(element=>selectedIds.includes(element.id)&&!isElementHidden(scene,element));
  const unlocked=selected.filter(element=>!isElementLocked(scene,element));
  const propertySelection=unlocked.length?unlocked:selected;
  const texts=propertySelection.filter((element):element is TextElement=>element.type==="text");
  const shapes=propertySelection.filter((element):element is ShapeElement=>element.type==="shape");
  const allText=propertySelection.length>0&&texts.length===propertySelection.length;
  const allShapes=propertySelection.length>0&&shapes.length===propertySelection.length;
  const allPhotos=propertySelection.length>0&&propertySelection.every(element=>Boolean(photoContent(element)));
  const locked=selected.length>0&&selected.every(element=>isElementLocked(scene,element));
  const inheritedLock=selected.some(element=>isElementLocked(scene,{...element,locked:false}));
  const styleEditable=selected.some(element=>canEditElement(scene,element,"style"));
  const canCrop=selected.length===1&&allPhotos&&canEditElement(scene,selected[0],"content")&&canEditElement(scene,selected[0],"style");
  const label=selected.length>1?`${selected.length} selected`:locked?"Locked":allText?"Text":allPhotos?selected[0].type==="shape"?"Photo frame":"Photo":allShapes?"Shape":"Selection";
  function update(transform:(element:CanvasElement)=>CanvasElement, property:"style"|"content"="style", group="quick-format") {
    if(disabled)return;
    const elements=scene.elements.map(element=>selectedIds.includes(element.id)&&!isElementHidden(scene,element)&&canEditElement(scene,element,property)?transform(element):element);
    if(elements.some((element,index)=>element!==scene.elements[index]))onChange({...scene,elements},group);
  }
  function patchText(patch:Partial<TextElement>) {
    if(disabled||!styleEditable)return;
    if(onFormatText?.(patch))return;
    update(element=>element.type==="text"?{...element,...patch}:element);
  }
  function toggleText(key:"fontWeight"|"italic"|"underline"|"strikethrough") {
    const selection=window.getSelection();
    const range=selection?.rangeCount?selection.getRangeAt(0):null;
    const ancestor=range?.commonAncestorContainer;
    const node=(ancestor instanceof Element?ancestor:ancestor?.parentElement)?.closest<HTMLElement>('.te-canvas-edit-text[contenteditable="true"]');
    const id=node?.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    const base=texts.find(element=>element.id===id);
    if(node&&range&&!range.collapsed&&base){patchText(textRangeTogglePatch(node,range,key,base));return;}
    patchText(key==="fontWeight"?{fontWeight:boldState(texts)===true?400:700}:{[key]:booleanState(texts,key)!==true});
  }
  const photos=propertySelection.flatMap(element=>{const photo=photoContent(element);return photo?[photo]:[];});
  const disabledStyle=disabled||!styleEditable;
  const inspectAction = (section: InspectorSection, text: string, icon: EditorIconName, ariaLabel = text) => onInspect && <button type="button" className="te-context-action" aria-label={ariaLabel} aria-pressed={activeSection === section} aria-controls="te-editor-panel" onMouseDown={event=>event.preventDefault()} onClick={()=>onInspect(section)}><EditorIcon name={icon}/>{text}</button>;
  return <div className={`te-quick-toolbar is-compact${selected.length ? " has-selection" : ""}`} role="toolbar" aria-label="Quick formatting" onKeyDown={event=>{if((event.target as HTMLElement).matches("input, select"))event.stopPropagation();}}>
    {!selected.length?<>
      <span className="te-quick-label">Select an element</span>
      <button type="button" className="te-context-action" disabled={disabled} onClick={onAddText}><EditorIcon name="text"/>Add text</button>
      <button type="button" className="te-context-action" disabled={disabled} onClick={onUpload}><EditorIcon name="photo"/>Upload</button>
      {onBackground&&<button type="button" className="te-context-action" aria-label="Edit page background" onClick={onBackground}><EditorIcon name="fill"/>Background</button>}
    </>:<>
      <span className={`te-quick-label${allText?" te-sr-only":""}`}>{label}</span>
      {templateDraftHeight!==undefined&&<TemplateRoleSelect scene={scene} elements={selected} height={templateDraftHeight} disabled={disabled} onChange={onChange} compact/>}
      {onMergeShapes&&selected.every(element=>element.type==="shape")&&selected.length>1&&<button type="button" className="te-context-action" aria-label="Merge shapes" title="Union: combine the selected shapes into one shape" disabled={disabled||selected.length!==selectedIds.length||!selected.every(element=>canEditElement(scene,element,"position")&&canEditElement(scene,element,"delete"))} onClick={onMergeShapes}><EditorIcon name="merge"/>Merge shapes</button>}
      {allText&&<TextFormatBar scene={scene} selectedIds={selectedIds} texts={texts} disabled={disabled} outputScale={outputScale} onChange={onChange} onFormatText={onFormatText} patchText={patchText} toggleText={toggleText} update={update}/>}
      {allShapes&&<div className="te-quick-basics">
        {!allPhotos&&<><span className="te-quick-control-label">Fill</span><PaintPicker key={`shape-fill:${shapes.map(element=>element.id).join(":")}`} label="Quick shape fill" compact value={commonElementPaint(shapes)} disabled={disabledStyle} onChange={paint=>update(element=>element.type==="shape"?applyElementPaint(element,paint):element)} /></>}
        <span className="te-quick-control-label">Outline</span><PaintPicker key={`border:${shapes.map(element=>element.id).join(":")}`} label="Quick shape border" compact allowGradient={false} value={commonValue(shapes,"stroke")===undefined?undefined:{type:"solid",color:commonValue(shapes,"stroke")!}} disabled={disabledStyle} onChange={paint=>{if(paint.type==="solid")update(element=>element.type==="shape"?{...element,stroke:paint.color,strokeWidth:element.strokeWidth>0?element.strokeWidth:1}:element);}} />
      </div>}
      {allPhotos&&<select aria-label="Quick photo fit" disabled={disabledStyle} value={commonValue(photos,"fit")??""} onChange={event=>update(element=>updatePhotoContent(element,{fit:event.target.value as "cover"|"contain"}))}>
        {commonValue(photos,"fit")===undefined&&<option value="" disabled>Mixed fit</option>}<option value="cover">Fill frame</option><option value="contain">Fit photo</option>
      </select>}
      <span className="te-quick-spacer" />
      <div className="te-quick-actions">
        {allText&&inspectAction("edit","Text","text","Text properties")}
        {allShapes&&inspectAction("edit","Fill","fill","Shape fill and geometry")}
        {shapes.length>0&&inspectAction("outline","Outline","outline","Shape outline")}
        {onTextTexture&&allText&&texts.length===1&&<button type="button" className="te-context-action" aria-label="Text texture" disabled={disabledStyle||!canEditElement(scene,texts[0],"content")} onMouseDown={event=>event.preventDefault()} onClick={onTextTexture}><EditorIcon name="photo"/>Texture</button>}
        {onReplacePhoto&&selected.length===1&&(allPhotos||allShapes)&&<button type="button" className="te-context-action" disabled={disabled||!canEditElement(scene,selected[0],"content")} onClick={onReplacePhoto}><EditorIcon name="photo"/>{allPhotos?"Replace photo":"Add photo"}</button>}
        {allPhotos&&inspectAction("photo","Photo","photo","Photo properties")}
        {onCrop&&selected.length===1&&allPhotos&&<button type="button" className="te-context-action" aria-label={cropping?"Finish crop":"Crop photo"} aria-pressed={cropping} disabled={disabled||!canCrop} onClick={onCrop}><EditorIcon name="crop"/>{cropping?"Done crop":"Crop"}</button>}
        {span&&selected.length===1&&allPhotos&&<SpanToolbarControls control={span} disabled={disabled}/>}
        {!onInspect&&onEdit&&<button type="button" aria-label="Edit selection properties" onClick={onEdit}>{allPhotos?"Edit photo":"Edit"}</button>}
        {onInspect?inspectAction("position","Position","position","Position selection"):onPosition&&<button type="button" aria-label="Position selection" onClick={onPosition}>Position</button>}
        {inspectAction("effects","Effects","effects")}
        {onGroup&&selected.length>1&&<button type="button" className="te-context-action" aria-label="Group selection" disabled={disabled||!selected.every(element=>canEditElement(scene,element,"position"))} onClick={onGroup}><EditorIcon name="group"/>Group</button>}
        {locked&&onUnlock&&<button type="button" className="te-context-action" title={inheritedLock?"Unlock the parent group in Layers":"Unlock selection"} disabled={disabled||inheritedLock} onClick={onUnlock}><EditorIcon name="unlock"/>Unlock</button>}
      </div>
    </>}
    <button type="button" aria-label="More canvas actions" title="More actions" aria-haspopup="menu" onClick={onMore}><EditorIcon name="more"/></button>
  </div>;
}
