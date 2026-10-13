"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {DesignDocument} from "./model";
export type StudioView="designs"|"templates"|"brand"|"trash"|"resources";
type Navigation={view:StudioView;designId:string|null;folder:string};
const initial:Navigation={view:"designs",designId:null,folder:""};
export function parseStudioLocation(search:string,documents:readonly DesignDocument[],folders:readonly{id:string}[]):Navigation {
  const params=new URLSearchParams(search),view=params.get("view"),design=params.get("design"),folder=params.get("folder")??"";
  return {view:["designs","templates","brand","trash","resources"].includes(view??"")?view as StudioView:"designs",designId:documents.some(item=>item.id===design&&!item.deletedAt)?design:null,folder:folders.some(item=>item.id===folder)?folder:""};
}
export function studioLink(value:Navigation,href:string):string {const url=new URL(href);for(const key of ["from","view","design","folder"])url.searchParams.delete(key);if(value.view!=="designs")url.searchParams.set("view",value.view);if(value.designId)url.searchParams.set("design",value.designId);if(value.folder)url.searchParams.set("folder",value.folder);return url.href;}
export function useStudioNavigation(scope:string|undefined,ready:boolean,documents:readonly DesignDocument[],folders:readonly{id:string}[]=[]) {
  const [navigation,setNavigation]=useState<Navigation>(initial),[recent,setRecent]=useState<string|null>(null),[notice,setNotice]=useState("");
  const current=useRef(initial),data=useRef({documents,folders});
  useEffect(()=>{data.current={documents,folders};},[documents,folders]);
  useEffect(()=>{
    if(!ready||!scope)return;
    const read=()=>{const next=parseStudioLocation(window.location.search,data.current.documents,data.current.folders);current.current=next;setNavigation(next);const desired=new URLSearchParams(window.location.search).get("design");if(desired&&!next.designId)setNotice("This project is unavailable in your workspace.");};
    queueMicrotask(()=>{read();try{setRecent(localStorage.getItem(`engine:recent-project:${scope}`));}catch{/* Navigation still works without browser storage. */}});
    window.addEventListener("popstate",read);return()=>window.removeEventListener("popstate",read);
  },[ready,scope]);
  const navigate=useCallback((patch:Partial<Navigation>)=>{
    const next={...current.current,...patch};current.current=next;setNavigation(next);
    if(typeof window!=="undefined"){const href=studioLink(next,window.location.href);if(href!==window.location.href)window.history.pushState(window.history.state,"",href);}
    if(next.designId&&scope)try{localStorage.setItem(`engine:recent-project:${scope}`,next.designId);setRecent(next.designId);}catch{/* URL navigation remains available. */}
  },[scope]);
  const setView=useCallback((view:StudioView)=>navigate({view,designId:null}),[navigate]);
  const setActiveId=useCallback((id:string|null)=>navigate({designId:id}),[navigate]);
  const setFolder=useCallback((folder:string)=>navigate({folder}),[navigate]);
  return {view:navigation.view,activeId:navigation.designId,folder:navigation.folder,notice,setNotice,setView,setActiveId,setFolder,recent:documents.find(item=>item.id===recent&&!item.deletedAt)};
}
