"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {DesignDocument} from "./model";
export type StudioView="designs"|"templates"|"brand"|"trash"|"resources";
export type StudioNavigation={view:StudioView;designId:string|null;folder:string;pageId?:string};
export type NavigationHistoryMode="push"|"replace";
export type NavigationStorage=Pick<Storage,"getItem"|"setItem">;
const initial:StudioNavigation={view:"designs",designId:null,folder:""};

export function resolveDesignPageId(design:Pick<DesignDocument,"pages">,requested?:string|null):string {
  return design.pages.find(page=>page.id===requested)?.id??design.pages[0]?.id??"";
}
export function projectPageStorageKey(scope:string,designId:string):string {
  return `engine:recent-page:${scope}:${designId}`;
}
export function browserNavigationStorage():NavigationStorage|undefined {
  try{return typeof window==="undefined"?undefined:window.localStorage;}catch{return undefined;}
}
export function readProjectPage(scope:string|undefined,designId:string,storage?:NavigationStorage):string|undefined {
  if(!scope||!storage)return undefined;
  try{const id=storage.getItem(projectPageStorageKey(scope,designId));return id&&id.length<=200?id:undefined;}catch{return undefined;}
}
export function rememberProjectPage(scope:string|undefined,designId:string,pageId:string|undefined,storage?:NavigationStorage):void {
  if(!scope||!storage||!pageId)return;
  try{storage.setItem(projectPageStorageKey(scope,designId),pageId);}catch{/* The page URL still works if browser storage is unavailable. */}
}
export function parseStudioLocation(search:string,documents:readonly DesignDocument[],folders:readonly{id:string}[],memory?:{scope?:string;storage?:NavigationStorage}):StudioNavigation {
  const params=new URLSearchParams(search),view=params.get("view"),designId=params.get("design"),folder=params.get("folder")??"";
  const design=documents.find(item=>item.id===designId&&!item.deletedAt);
  const requested=design?(params.has("page")?params.get("page"):readProjectPage(memory?.scope,design.id,memory?.storage)):undefined;
  return {view:["designs","templates","brand","trash","resources"].includes(view??"")?view as StudioView:"designs",designId:design?.id??null,folder:folders.some(item=>item.id===folder)?folder:"",...(design&&requested!==undefined?{pageId:resolveDesignPageId(design,requested)}:{})};
}
/** Structural document edits repair the current history entry, without adding page navigation or a save. */
export function normalizeStudioPage(value:StudioNavigation,documents:readonly DesignDocument[]):StudioNavigation {
  const design=documents.find(item=>item.id===value.designId&&!item.deletedAt);
  if(!design||value.pageId===undefined)return value;
  const pageId=resolveDesignPageId(design,value.pageId);
  return pageId===value.pageId?value:{...value,pageId};
}
export function studioLink(value:StudioNavigation,href:string):string {
  const url=new URL(href);
  for(const key of ["from","view","design","folder","page"])url.searchParams.delete(key);
  if(value.view!=="designs")url.searchParams.set("view",value.view);
  if(value.designId){url.searchParams.set("design",value.designId);if(value.pageId)url.searchParams.set("page",value.pageId);}
  if(value.folder)url.searchParams.set("folder",value.folder);
  return url.href;
}
export function writeStudioLocation(value:StudioNavigation,href:string,history:Pick<History,"pushState"|"replaceState">,mode:NavigationHistoryMode="push"):void {
  const next=studioLink(value,href);
  if(next!==href)history[mode==="replace"?"replaceState":"pushState"](null,"",next);
}
export function useStudioNavigation(scope:string|undefined,ready:boolean,documents:readonly DesignDocument[],folders:readonly{id:string}[]=[]) {
  const [navigation,setNavigation]=useState<StudioNavigation>(initial),[recent,setRecent]=useState<string|null>(null),[notice,setNotice]=useState("");
  const current=useRef(initial),data=useRef({documents,folders});
  useEffect(()=>{
    data.current={documents,folders};
    if(!ready)return;
    const previous=current.current,next=normalizeStudioPage(previous,documents);
    if(next===previous)return;
    let active=true;
    queueMicrotask(()=>{
      if(!active||current.current!==previous)return;
      current.current=next;setNavigation(next);
      if(typeof window!=="undefined")writeStudioLocation(next,window.location.href,window.history,"replace");
      if(next.designId)rememberProjectPage(scope,next.designId,next.pageId,browserNavigationStorage());
    });
    return()=>{active=false;};
  },[documents,folders,ready,scope]);
  useEffect(()=>{
    if(!ready||!scope)return;
    let active=true;
    const read=()=>{
      if(!active)return;
      const storage=browserNavigationStorage(),next=parseStudioLocation(window.location.search,data.current.documents,data.current.folders,{scope,storage});
      current.current=next;setNavigation(next);
      if(next.designId)rememberProjectPage(scope,next.designId,next.pageId,storage);
      const desired=new URLSearchParams(window.location.search).get("design");
      setNotice(desired&&!next.designId?"This project is unavailable in your workspace.":"");
    };
    queueMicrotask(()=>{if(!active)return;read();try{setRecent(browserNavigationStorage()?.getItem(`engine:recent-project:${scope}`)??null);}catch{/* Navigation still works without browser storage. */}});
    window.addEventListener("popstate",read);
    return()=>{active=false;window.removeEventListener("popstate",read);};
  },[ready,scope]);
  const navigate=useCallback((patch:Partial<StudioNavigation>,mode:NavigationHistoryMode="push")=>{
    const next={...current.current,...patch};current.current=next;setNavigation(next);
    if(typeof window!=="undefined")writeStudioLocation(next,window.location.href,window.history,mode);
    if(next.designId&&scope){const storage=browserNavigationStorage();rememberProjectPage(scope,next.designId,next.pageId,storage);try{storage?.setItem(`engine:recent-project:${scope}`,next.designId);setRecent(next.designId);}catch{/* URL navigation remains available. */}}
  },[scope]);
  const setView=useCallback((view:StudioView)=>navigate({view,designId:null,pageId:undefined}),[navigate]);
  const setActiveId=useCallback((id:string|null)=>{
    const design=data.current.documents.find(item=>item.id===id&&!item.deletedAt),remembered=design?readProjectPage(scope,design.id,browserNavigationStorage()):undefined;
    navigate({designId:id,pageId:design?resolveDesignPageId(design,remembered):undefined});
  },[navigate,scope]);
  const setPageId=useCallback((id:string,mode:NavigationHistoryMode="push")=>{if(current.current.designId)navigate({pageId:id},mode);},[navigate]);
  const setFolder=useCallback((folder:string)=>navigate({folder}),[navigate]);
  return {view:navigation.view,activeId:navigation.designId,pageId:navigation.pageId,folder:navigation.folder,notice,setNotice,setView,setActiveId,setPageId,setFolder,recent:documents.find(item=>item.id===recent&&!item.deletedAt)};
}
