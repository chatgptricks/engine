"use client";
import {useState} from "react";
import {FORMATS,formatDimensions,libraryBrandKits,type EditorLibrary,type DesignTemplate,type DesignFormat} from "@/lib/template-editor/model";
import {type CreationOptions} from "@/lib/template-editor/library-workflows";
import {Modal} from "./controls";
import {DesignPreview} from "./preview";
import "./dialog-tools.css";

export function CreateDesignDialog({library,kind,template,disabled,onCreate,onClose}:{library:EditorLibrary;kind:"post"|"carousel"|"template";template?:DesignTemplate;disabled:boolean;onCreate:(options:CreationOptions)=>boolean|void;onClose:()=>void}) {
  const [name,setName]=useState(template?.name??(kind==="carousel"?"Untitled carousel":kind==="template"?"Untitled template":"Untitled design"));
  const [format,setFormat]=useState<DesignFormat>(template?.format??"portrait"),[custom,setCustom]=useState(Boolean(template?.customSize));
  const dimensions=template?formatDimensions(template):FORMATS.portrait;
  const [width,setWidth]=useState(dimensions.width),[height,setHeight]=useState(dimensions.height);
  const [pageCount,setPageCount]=useState(template?.pages.length??(kind==="carousel"?3:1));
  const [layout,setLayout]=useState<"separate"|"continuous">(template?.continuousCanvas?"continuous":"separate");
  const [brandId,setBrandId]=useState(library.activeBrandKitId),[applyBrand,setApplyBrand]=useState(!template);
  const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries((template?.parameters??[]).map(parameter=>[parameter.id,parameter.defaultValue??""])));
  const [error,setError]=useState("");
  const preview=template?{...template,templateId:template.id,caption:"",createdAt:"",updatedAt:""}:null;
  return <Modal title={template?"Create from template":kind==="template"?"Create a reusable template":"Create a design"} onClose={onClose}><form onSubmit={event=>{event.preventDefault();if(disabled)return;try{if(custom&&(!Number.isInteger(width)||!Number.isInteger(height)||width<120||height<120||width>8192||height>8192))throw new Error("Choose whole-pixel dimensions between 120 and 8192.");if(onCreate({name,format,pageCount,layout,brandKitId:brandId,applyBrand,...(custom?{size:{width,height}}:{}),template,values,...(kind==="template"?{purpose:"template" as const}:{})})===false)throw new Error("This design could not be saved. Check the workspace status.");onClose();}catch(cause){setError(cause instanceof Error?cause.message:"Could not create this design.");}}}>
    <fieldset disabled={disabled} className="te-pro-panel te-tool-dialog">
      <label>Name<input autoFocus required maxLength={100} value={name} onChange={event=>setName(event.target.value)}/></label>
      {preview&&<details><summary>Preview all {template!.pages.length} pages</summary><div className="te-dialog-details-body te-dialog-preview-grid">{template!.pages.map((page,index)=><div key={page.id}><DesignPreview design={preview} page={page}/><span>{page.label||`Page ${index+1}`}</span></div>)}</div></details>}
      <label>Format<select value={custom?"custom":format} onChange={event=>{if(event.target.value==="custom"){setCustom(true);return;}const next=event.target.value as DesignFormat;setCustom(false);setFormat(next);setWidth(FORMATS[next].width);setHeight(FORMATS[next].height);}}>{Object.entries(FORMATS).map(([id,size])=><option key={id} value={id}>{size.label} · {size.width}×{size.height}</option>)}<option value="custom">Custom size</option></select></label>
      {custom&&<div className="te-dialog-grid"><label>Width (px)<input type="number" min="120" max="8192" step="1" value={width} onChange={event=>setWidth(Number(event.target.value))}/></label><label>Height (px)<input type="number" min="120" max="8192" step="1" value={height} onChange={event=>setHeight(Number(event.target.value))}/></label></div>}
      <div className="te-dialog-grid"><label>Pages<input type="number" min="1" max="20" step="1" value={pageCount} disabled={Boolean(template)} onChange={event=>{const count=Number(event.target.value);setPageCount(count);if(count<2)setLayout("separate");}}/></label><label>Layout<select value={layout} onChange={event=>setLayout(event.target.value as typeof layout)}><option value="separate">Separate pages</option><option value="continuous" disabled={pageCount<2}>Continuous carousel</option></select></label></div>
      <label>Brand<select value={brandId} onChange={event=>setBrandId(event.target.value)}>{libraryBrandKits(library).map(kit=><option key={kit.id} value={kit.id}>{kit.name}</option>)}</select></label>
      <label className="te-dialog-check"><input type="checkbox" checked={applyBrand} onChange={event=>setApplyBrand(event.target.checked)}/>Use this brand’s background, font and text color</label>
      {!!template?.parameters?.length&&<section><strong>Your content</strong>{template.parameters.map(parameter=><label key={parameter.id}>{parameter.name}{parameter.required?" *":""}<input aria-label={`Template field ${parameter.name}`} value={values[parameter.id]??""} maxLength={parameter.maxLength??20000} required={parameter.required} placeholder={parameter.type==="image"?"https://…":parameter.type==="color"?"#RRGGBB":parameter.defaultValue} onChange={event=>setValues(previous=>({...previous,[parameter.id]:event.target.value}))}/></label>)}</section>}
      {template&&<p>A new independent design is created. Your template stays available.</p>}
    </fieldset>
    {error&&<p className="te-dialog-error" role="alert">{error}</p>}
    <div className="te-dialog-footer"><button type="button" className="te-button" onClick={onClose}>Cancel</button><button className="te-button te-primary" disabled={disabled}>Create {kind==="template"?"template":"design"}</button></div>
  </form></Modal>;
}
