"use client";
import {useState} from "react";
import {type EditorLibrary} from "@/lib/template-editor/model";
import {allImportItems,importLibrarySelection,type ImportMode,type ImportCollection,type ImportSelection} from "@/lib/template-editor/library-workflows";
import {Modal} from "./controls";
import "./dialog-tools.css";
const collections:[ImportCollection,string][]=[["designs","Projects"],["templates","Templates"],["brandKits","Brand kits"],["folders","Folders"],["workspaceStyles","Workspace text styles"],["workspaceComponents","Workspace components"]];
export function LibraryImportDialog({current,incoming,restoreMedia,disabled,onImport,onComplete,onClose}:{current:EditorLibrary;incoming:EditorLibrary;restoreMedia:(selected:EditorLibrary)=>Promise<void>;disabled:boolean;onImport:(recipe:(library:EditorLibrary)=>EditorLibrary)=>boolean|void;onComplete?:(message:string)=>void;onClose:()=>void}) {
  const [selection,setSelection]=useState<ImportSelection>(()=>{const selected=allImportItems(incoming);selected.designs=incoming.designs.filter(item=>!item.deletedAt).map(item=>item.id);selected.templates=incoming.templates.filter(item=>!item.deletedAt).map(item=>item.id);return selected;});
  const [mode,setMode]=useState<ImportMode>("skip"),[activateBrand,setActivateBrand]=useState(false),[catalog,setCatalog]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const count=Object.values(selection).reduce((total,ids)=>total+ids.length,0);
  return <Modal title="Review workspace import" onClose={()=>{if(!busy)onClose();}}><form onSubmit={async event=>{event.preventDefault();if(disabled||busy||!count)return;setBusy(true);setError("");try{
    const source={...incoming,...(!catalog?{builtInTemplateStates:undefined}:{})};
    const planned=importLibrarySelection(current,source,selection,mode,activateBrand);
    const newCount=collections.reduce((count,[key])=>count+(planned[key]??[]).filter(item=>!(current[key]??[]).some(existing=>existing.id===item.id)).length,0);
    const selected={...source,...Object.fromEntries(collections.map(([key])=>[key,(source[key]??[]).filter(item=>selection[key].includes(item.id))]))} as EditorLibrary;
    await restoreMedia(selected);
    if(onImport(live=>importLibrarySelection(live,source,selection,mode,activateBrand))===false)throw new Error("The selected items could not be saved. Your workspace has not changed.");onComplete?.(mode==='skip'&&newCount===0?"Existing or identical items were skipped. Import completed.":`Import completed${newCount?` · ${newCount} new ${newCount===1?'item':'items'}`:' · matching items updated'}.`);onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not import these items.");}finally{setBusy(false);}}}>
    <fieldset disabled={disabled||busy} className="te-pro-panel te-tool-dialog">
      <p>Choose what to bring into this workspace. Existing projects stay available.</p>
      <label>Matching items<select value={mode} onChange={event=>setMode(event.target.value as ImportMode)}><option value="skip">Skip existing IDs or identical content</option><option value="copies">Create independent copies</option><option value="merge">Merge/update matching IDs</option></select></label>
      <p>{mode==="merge"?"Changed projects and templates get a ‘before import’ copy. Brand kits merge their assets.":mode==="copies"?"Every selected item gets its own identity.":"Repeated imports do not create duplicate projects or assets."}</p>
      {collections.map(([key,label])=>{const records=incoming[key]??[];if(!records.length)return null;return <details key={key} open={key==="designs"||key==="templates"}><summary>{label} · {selection[key].length}/{records.length}</summary><div className="te-dialog-details-body"><div className="te-pro-actions"><button type="button" className="te-text-button" onClick={()=>setSelection(previous=>({...previous,[key]:records.map(item=>item.id)}))}>Select all</button><button type="button" className="te-text-button" onClick={()=>setSelection(previous=>({...previous,[key]:[]}))}>Clear</button></div>{records.map(item=><label key={item.id} className="te-dialog-check"><input type="checkbox" checked={selection[key].includes(item.id)} onChange={event=>setSelection(previous=>({...previous,[key]:event.target.checked?[...previous[key],item.id]:previous[key].filter(id=>id!==item.id)}))}/><span>{item.name}{"deletedAt"in item&&item.deletedAt?" · deleted, imports as active copy":""}{(current[key]??[]).some(existing=>existing.id===item.id)?" · matching ID exists":""}</span></label>)}</div></details>;})}
      <label className="te-dialog-check"><input type="checkbox" checked={activateBrand} onChange={event=>setActivateBrand(event.target.checked)}/>Activate the imported brand kit</label>
      {!!incoming.builtInTemplateStates?.length&&<label className="te-dialog-check"><input type="checkbox" checked={catalog} onChange={event=>setCatalog(event.target.checked)}/>Import starter template decisions where this workspace has none</label>}
      <div className="te-dialog-summary"><strong>{count} selected items</strong><span>{activateBrand?"Brand may change":"Current Brand stays active"}</span></div>
    </fieldset>
    {error&&<p className="te-dialog-error" role="alert">{error}</p>}
    <div className="te-dialog-footer"><button type="button" className="te-button" disabled={busy} onClick={onClose}>Cancel</button><button className="te-button te-primary" disabled={disabled||busy||!count}>{busy?"Restoring original media…":"Import selected"}</button></div>
  </form></Modal>;
}
