"use client";

import type { MouseEvent } from "react";
import type { CanvasElement, CanvasScene, ShapeElement, TextElement } from "@/lib/template-editor/model";
import { FONTS } from "./controls";
import { commonValue, boldState, booleanState } from "@/lib/template-editor/property-utils";
import { canEditElement, isElementHidden, isElementLocked } from "@/lib/template-editor/commands";
import { parseColor, colorWithAlpha } from "@/lib/template-editor/color-utils";
import { photoContent, updatePhotoContent } from "@/lib/template-editor/photo-frames";
import { textRangeTogglePatch, type TextFormattingPatch } from "@/lib/template-editor/rich-text-editing";
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
  onBackground?: () => void;
  onPosition?: () => void;
  onCrop?: () => void;
  cropping?: boolean;
  onGroup?: () => void;
};

function ColorSwatch({ label, value, disabled, onChange }: { label: string; value?: string; disabled: boolean; onChange: (rgb: string) => void }) {
  return <label className="te-quick-color" title={value === undefined ? `Mixed ${label.toLowerCase()}s` : label}>
    <span style={{background:value??"repeating-linear-gradient(135deg,#fff 0 3px,#171719 3px 6px)"}} />
    <input type="color" aria-label={label} value={parseColor(value??"")?.rgb??"#ffffff"} disabled={disabled} onChange={event=>onChange(event.target.value)} />
  </label>;
}

export function QuickToolbar({ scene, selectedIds, disabled, onChange, onMore, onAddText, onUpload, onFormatText, onEdit, onBackground, onPosition, onCrop, cropping = false, onGroup, outputScale = 3 }: Props) {
  const selected=scene.elements.filter(element=>selectedIds.includes(element.id)&&!isElementHidden(scene,element));
  const texts=selected.filter((element):element is TextElement=>element.type==="text");
  const shapes=selected.filter((element):element is ShapeElement=>element.type==="shape");
  const allText=selected.length>0&&texts.length===selected.length;
  const allShapes=selected.length>0&&shapes.length===selected.length;
  const allPhotos=selected.length>0&&selected.every(element=>Boolean(photoContent(element)));
  const locked=selected.length>0&&selected.every(element=>isElementLocked(scene,element));
  const styleEditable=selected.some(element=>canEditElement(scene,element,"style"));
  const canCrop=selected.length===1&&allPhotos&&canEditElement(scene,selected[0],"content")&&canEditElement(scene,selected[0],"style");
  const label=selected.length>1?`${selected.length} selected`:locked?"Locked":allText?"Text":allPhotos?selected[0].type==="shape"?"Photo frame":"Photo":allShapes?"Shape":"Selection";
  function update(transform:(element:CanvasElement)=>CanvasElement, property:"style"|"content"="style") {
    if(disabled)return;
    const elements=scene.elements.map(element=>selectedIds.includes(element.id)&&!isElementHidden(scene,element)&&canEditElement(scene,element,property)?transform(element):element);
    if(elements.some((element,index)=>element!==scene.elements[index]))onChange({...scene,elements},"quick-format");
  }
  function patchText(patch:Partial<TextElement>) {
    if(disabled||!styleEditable)return;
    if(onFormatText?.(patch))return;
    update(element=>element.type==="text"?{...element,...patch}:element);
  }
  function toggleText(key:"fontWeight"|"italic") {
    const selection=window.getSelection();
    const range=selection?.rangeCount?selection.getRangeAt(0):null;
    const ancestor=range?.commonAncestorContainer;
    const node=(ancestor instanceof Element?ancestor:ancestor?.parentElement)?.closest<HTMLElement>('.te-canvas-edit-text[contenteditable="true"]');
    const id=node?.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
    const base=texts.find(element=>element.id===id);
    if(node&&range&&!range.collapsed&&base){patchText(textRangeTogglePatch(node,range,key,base));return;}
    patchText(key==="fontWeight"?{fontWeight:boldState(texts)===true?400:700}:{italic:booleanState(texts,"italic")!==true});
  }
  const photos=selected.flatMap(element=>{const photo=photoContent(element);return photo?[photo]:[];});
  const disabledStyle=disabled||!styleEditable;
  return <div className="te-quick-toolbar is-compact" role="toolbar" aria-label="Quick formatting" onKeyDown={event=>{if((event.target as HTMLElement).matches("input, select"))event.stopPropagation();}}>
    {!selected.length?<>
      <span className="te-quick-label">Select an element</span>
      <button type="button" disabled={disabled} onClick={onAddText}>+ Text</button>
      <button type="button" disabled={disabled} onClick={onUpload}>Upload</button>
      {onBackground&&<button type="button" aria-label="Edit page background" onClick={onBackground}>Background</button>}
    </>:<>
      <span className="te-quick-label">{label}</span>
      {allText&&<div className="te-quick-basics">
        <select aria-label="Quick font" disabled={disabledStyle} value={commonValue(texts,"font")??""} onChange={event=>patchText({font:event.target.value})}>
          {commonValue(texts,"font")===undefined&&<option value="" disabled>Mixed fonts</option>}
          {FONTS.map(([id,name])=><option key={id} value={id}>{name}</option>)}
        </select>
        <input aria-label="Quick font size" title="Font size in export pixels" type="number" min={outputScale} max={500*outputScale} disabled={disabledStyle} placeholder="Mixed" value={commonValue(texts,"fontSize")===undefined?"":Number((commonValue(texts,"fontSize")!*outputScale).toFixed(2))} onChange={event=>{const size=event.target.valueAsNumber;if(Number.isFinite(size)&&size>=outputScale&&size<=500*outputScale)patchText({fontSize:size/outputScale});}} />
        <button type="button" className="te-quick-format-button" aria-label="Quick bold" title="Bold" aria-pressed={boldState(texts)} disabled={disabledStyle} onMouseDown={event=>event.preventDefault()} onClick={()=>toggleText("fontWeight")}><b>B</b></button>
        <button type="button" className="te-quick-format-button" aria-label="Quick italic" title="Italic" aria-pressed={booleanState(texts,"italic")} disabled={disabledStyle} onMouseDown={event=>event.preventDefault()} onClick={()=>toggleText("italic")}><i>I</i></button>
        <ColorSwatch label="Quick text color" value={commonValue(texts,"color")} disabled={disabledStyle} onChange={rgb=>{
          const color=colorWithAlpha(rgb,parseColor(commonValue(texts,"color")??"")?.alpha||1);
          if(!disabled&&onFormatText?.({color,colorRoleId:undefined}))return;
          update(element=>element.type==="text"?{...element,color:colorWithAlpha(rgb,parseColor(element.color)?.alpha||1),colorRoleId:undefined}:element);
        }} />
      </div>}
      {allShapes&&!allPhotos&&<div className="te-quick-basics">
        <span className="te-quick-control-label">Fill</span><ColorSwatch label="Quick shape fill" value={commonValue(shapes,"fill")} disabled={disabledStyle} onChange={rgb=>update(element=>element.type==="shape"?{...element,fill:colorWithAlpha(rgb,parseColor(element.fill)?.alpha||1),colorRoleId:undefined}:element)} />
        <span className="te-quick-control-label">Border</span><ColorSwatch label="Quick shape border" value={commonValue(shapes,"stroke")} disabled={disabledStyle} onChange={rgb=>update(element=>element.type==="shape"?{...element,stroke:colorWithAlpha(rgb,parseColor(element.stroke)?.alpha||1),strokeWidth:element.strokeWidth>0?element.strokeWidth:1}:element)} />
      </div>}
      {allPhotos&&<select aria-label="Quick photo fit" disabled={disabledStyle} value={commonValue(photos,"fit")??""} onChange={event=>update(element=>updatePhotoContent(element,{fit:event.target.value as "cover"|"contain"}))}>
        {commonValue(photos,"fit")===undefined&&<option value="" disabled>Mixed fit</option>}<option value="cover">Fill frame</option><option value="contain">Fit photo</option>
      </select>}
      <span className="te-quick-spacer" />
      <div className="te-quick-actions">
        {onCrop&&selected.length===1&&allPhotos&&<button type="button" aria-label={cropping?"Finish crop":"Crop photo"} aria-pressed={cropping} disabled={disabled||!canCrop} onClick={onCrop}>{cropping?"Done crop":"Crop"}</button>}
        {onEdit&&<button type="button" aria-label="Edit selection properties" onClick={onEdit}>{allPhotos?"Edit photo":"Edit"}</button>}
        {onPosition&&<button type="button" aria-label="Position selection" onClick={onPosition}>Position</button>}
        {onGroup&&selected.length>1&&<button type="button" aria-label="Group selection" disabled={disabled||!selected.every(element=>canEditElement(scene,element,"position"))} onClick={onGroup}>Group</button>}
      </div>
    </>}
    <button type="button" aria-label="More canvas actions" title="More actions" aria-haspopup="menu" onClick={onMore}>•••</button>
  </div>;
}
