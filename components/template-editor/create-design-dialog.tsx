"use client";
import {useState} from "react";
import {FORMATS,formatDimensions,libraryBrandKits,type EditorLibrary,type DesignTemplate,type DesignFormat} from "@/lib/template-editor/model";
import {type CreationOptions} from "@/lib/template-editor/library-workflows";
import {DESIGN_PRESETS} from "@/lib/template-editor/creation-presets";
import {Modal,NumberInput} from "./controls";
import {DesignPreview} from "./preview";
import "./dialog-tools.css";

export function CreateDesignDialog({library,kind,template,preset,disabled,onCreate,onClose}:{library:EditorLibrary;kind:"post"|"carousel"|"template";template?:DesignTemplate;preset?:string;disabled:boolean;onCreate:(options:CreationOptions)=>boolean|void;onClose:()=>void}) {
  const initialPreset=DESIGN_PRESETS.find(item=>item.id===preset)??DESIGN_PRESETS[0];
  const dimensions=template?formatDimensions(template):initialPreset;
  const [name,setName]=useState(template?.name??(kind==="carousel"?"Untitled carousel":kind==="template"?"Untitled template":"Untitled design"));
  const [format,setFormat]=useState<DesignFormat>(template?.format??initialPreset.format);
  const [custom,setCustom]=useState(Boolean(template?.customSize)||preset==="custom"||preset==="tall");
  const [customOpen,setCustomOpen]=useState(preset==="custom");
  const [width,setWidth]=useState(dimensions.width),[height,setHeight]=useState(dimensions.height);
  const [pageCount,setPageCount]=useState(template?.pages.length??(kind==="carousel"?3:1));
  const [layout,setLayout]=useState<"separate"|"continuous">(template?.continuousCanvas?"continuous":"separate");
  const [brandId,setBrandId]=useState(library.activeBrandKitId),[applyBrand,setApplyBrand]=useState(!template);
  const [values,setValues]=useState<Record<string,string>>(()=>Object.fromEntries((template?.parameters??[]).map(parameter=>[parameter.id,parameter.defaultValue??""])));
  const [error,setError]=useState("");
  const preview=template?{...template,templateId:template.id,caption:"",createdAt:"",updatedAt:""}:null;
  const activePreset=DESIGN_PRESETS.find(item=>item.width===width&&item.height===height);
  const pickPreset=(item:typeof DESIGN_PRESETS[number])=>{setFormat(item.format);setWidth(item.width);setHeight(item.height);setCustom(FORMATS[item.format].width!==item.width||FORMATS[item.format].height!==item.height);setCustomOpen(false);};
  return <Modal title={template?"Use this template":kind==="template"?"Create a template":"Create a design"} onClose={onClose}><form onSubmit={event=>{
    event.preventDefault();if(disabled)return;
    try{
      if(custom&&(!Number.isInteger(width)||!Number.isInteger(height)||width<120||height<120||width>8192||height>8192))throw new Error("Choose whole-pixel dimensions between 120 and 8192.");
      if(onCreate({name,format,pageCount,layout,brandKitId:brandId,applyBrand,...(custom?{size:{width,height}}:{}),template,values,...(kind==="template"?{purpose:"template" as const}:{})})===false)throw new Error("This design could not be saved. Check the workspace status.");
      onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not create this design.");}
  }}>
    <fieldset disabled={disabled} className="te-pro-panel te-tool-dialog te-create-flow">
      {!template&&<div className="te-create-presets" aria-label="Design formats">{DESIGN_PRESETS.map(item=><button type="button" key={item.id} aria-pressed={!customOpen&&activePreset?.id===item.id} onClick={()=>pickPreset(item)}><span className="te-format-icon" style={{aspectRatio:`${item.width}/${item.height}`}}/><strong>{item.name}</strong><small>{item.width} × {item.height}</small></button>)}</div>}
      {!template&&<button type="button" className="te-text-button te-custom-size-toggle" aria-expanded={customOpen} onClick={()=>{setCustom(true);setCustomOpen(!customOpen);}}>Custom size</button>}
      {customOpen&&<div className="te-dialog-grid"><label>Width (px)<NumberInput min={120} max={8192} step={1} value={width} onChange={event=>setWidth(Number(event.target.value))}/></label><label>Height (px)<NumberInput min={120} max={8192} step={1} value={height} onChange={event=>setHeight(Number(event.target.value))}/></label></div>}
      {preview&&<div className="te-template-choice"><DesignPreview design={preview} page={preview.pages[0]}/><div><strong>{template!.name}</strong><span>{template!.pages.length} pages · {width} × {height} px</span></div></div>}
      <label>Design name<input autoFocus required maxLength={100} value={name} onChange={event=>setName(event.target.value)}/></label>
      {!!template?.parameters?.length&&<section><strong>Your content</strong>{template.parameters.map(parameter=><label key={parameter.id}>{parameter.name}{parameter.required?" *":""}<input aria-label={`Template field ${parameter.name}`} value={values[parameter.id]??""} maxLength={parameter.maxLength??20000} required={parameter.required} placeholder={parameter.type==="image"?"https://…":parameter.type==="color"?"#RRGGBB":parameter.defaultValue} onChange={event=>setValues(previous=>({...previous,[parameter.id]:event.target.value}))}/></label>)}</section>}
      <details open={kind==="carousel"?true:undefined} className="te-create-more"><summary>More options</summary><div className="te-dialog-details-body">
        {template&&<details><summary>Preview every page</summary><div className="te-dialog-details-body te-dialog-preview-grid">{template.pages.map((page,index)=><div key={page.id}><DesignPreview design={preview!} page={page}/><span>{page.label||`Page ${index+1}`}</span></div>)}</div></details>}
        <div className="te-dialog-grid"><label>Pages<NumberInput min={1} max={20} step={1} value={pageCount} disabled={Boolean(template)} onChange={event=>{const count=Number(event.target.value);setPageCount(count);if(count<2)setLayout("separate");}}/></label><label>Layout<select value={layout} onChange={event=>setLayout(event.target.value as typeof layout)}><option value="separate">Separate pages</option><option value="continuous" disabled={pageCount<2}>Continuous carousel</option></select></label></div>
        <label>Brand<select value={brandId} onChange={event=>setBrandId(event.target.value)}>{libraryBrandKits(library).map(kit=><option key={kit.id} value={kit.id}>{kit.name}</option>)}</select></label>
        <label className="te-dialog-check"><input type="checkbox" checked={applyBrand} onChange={event=>setApplyBrand(event.target.checked)}/>Apply brand colors and fonts</label>
      </div></details>
    </fieldset>
    {error&&<p className="te-dialog-error" role="alert">{error}</p>}
    <div className="te-dialog-footer"><span className="te-create-dimensions">{width} × {height} px</span><button type="button" className="te-button" onClick={onClose}>Cancel</button><button className="te-button te-primary" disabled={disabled}>{template?"Open in editor":kind==="template"?"Create template":"Create design"}</button></div>
  </form></Modal>;
}
