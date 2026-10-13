"use client";
import type {DesignDocument,DesignPage} from "@/lib/template-editor/model";
import {pageReadingItems} from "@/lib/template-editor/public-accessibility";
type Patch=Partial<Pick<DesignPage,"publicDescription"|"readingOrder">>;
export function PageAccessibilitySection({design,page,disabled,onChange,onEditImage}:{design:DesignDocument;page:DesignPage;disabled:boolean;onChange:(patch:Patch)=>void;onEditImage:(id:string,master:boolean)=>void}) {
  const items=pageReadingItems(design,page),missing=items.filter(item=>item.missingAlt).length;
  function move(index:number,delta:number){const order=items.map(item=>item.id);[order[index],order[index+delta]]=[order[index+delta],order[index]];onChange({readingOrder:order});}
  return <details className="te-element-section te-advanced-section te-page-accessibility"><summary>Accessibility{missing>0?` · ${missing} image${missing===1?"":"s"} without descriptions`:""}</summary><div>
    <label className="te-field">Public page description<textarea aria-label="Public page description" rows={3} maxLength={5000} disabled={disabled} value={page.publicDescription??""} onChange={event=>onChange({publicDescription:event.target.value})} placeholder="Describe the purpose of this page for people using a screen reader."/></label>
    <p className="te-help">Descriptions are shared in review links. Image descriptions can be edited below; leave decorative images blank.</p>
    <div className="te-panel-heading"><h3>Reading order</h3><button className="te-text-button" type="button" disabled={disabled||!page.readingOrder?.length} onClick={()=>onChange({readingOrder:undefined})}>Use visual order</button></div>
    {items.length?<ol className="te-reading-order">{items.map((item,index)=><li key={item.id}><span>{item.kind==="image"?item.text||item.name||"Image":item.text}<small>{item.kind==="image"?(item.missingAlt?"Decorative / no description":"Image description"):"Text"}{item.master?" · Master":""}</small></span><div>{item.kind==="image"&&<button type="button" className="te-text-button" disabled={disabled} onClick={()=>onEditImage(item.id,item.master)}>Describe</button>}<button type="button" disabled={disabled||index===0} aria-label={`Read ${item.name||item.kind} earlier`} onClick={()=>move(index,-1)}>↑</button><button type="button" disabled={disabled||index===items.length-1} aria-label={`Read ${item.name||item.kind} later`} onClick={()=>move(index,1)}>↓</button></div></li>)}</ol>:<p className="te-help">Add text or images to set their reading order.</p>}
  </div></details>;
}
