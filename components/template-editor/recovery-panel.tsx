"use client";
import {useEffect,useState} from "react";
import {getRecoveryDrafts,type RecoveryDraft} from "@/lib/template-editor/recovery-storage";
import type {EditorLibrary} from "@/lib/template-editor/model";
import {saveBlob} from "@/lib/template-editor/export";
import {Modal} from "./controls";
export function RecoveryPanel({scope,canEdit,onClose,onRestore}:{scope:string;canEdit:boolean;onClose:()=>void;onRestore:(library:EditorLibrary)=>boolean}){
 const [drafts,setDrafts]=useState<RecoveryDraft[]>([]),[message,setMessage]=useState("Loading browser recoveries…");
 useEffect(()=>{let active=true;getRecoveryDrafts(scope).then(values=>{if(active){setDrafts(values);setMessage(values.length?"Each pending tab or migrated snapshot remains independent. Download any backup, or restore its changes as independent copies.":"No pending browser recoveries for this workspace.");}}).catch(cause=>{if(active)setMessage(cause instanceof Error?cause.message:"Browser recoveries are unavailable.");});return()=>{active=false;};},[scope]);
 return <Modal title="Browser recoveries" onClose={onClose}><p role="status">{message}</p><div className="te-version-list">{drafts.map(draft=><article key={draft.key}><div><strong>{new Date(draft.updatedAt).toLocaleString()}</strong><p>{draft.library.designs.length} designs · {draft.library.templates.length} templates · {draft.library.brandKits.length} brand kits</p></div><button className="te-button" onClick={()=>saveBlob(new Blob([JSON.stringify(draft.library)],{type:"application/json"}),`engine-recovery-${draft.updatedAt}.json`)}>Download</button><button className="te-button te-primary" disabled={!canEdit} onClick={()=>{if(canEdit&&onRestore(draft.library))onClose();}}>Restore copies</button></article>)}</div></Modal>;
}
