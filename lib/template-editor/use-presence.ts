"use client";
import {useEffect,useState} from "react";
export function useDocumentPresence(documentId:string,scope:string|undefined,enabled:boolean):number {
  const [presence,setPresence]=useState<{documentId:string;scope:string;others:number}|null>(null);
  useEffect(()=>{
    if(!scope||!enabled)return;
    const sessionId=crypto.randomUUID();let stopped=false,inFlight=false;let failures=0,sequence=0;
    async function heartbeat(leave=false) {
      if(stopped&&!leave||inFlight&&!leave)return;
      if(!leave&&document.visibilityState==="hidden")return;
      if(!leave)inFlight=true;
      try {
        const response=await fetch("/api/template-editor/presence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId,documentId,expectedScope:scope,leave,sequence:++sequence}),keepalive:leave});
        if(response.status===401||response.status===403){if(!stopped)setPresence(null);stopped=true;return;}
        if(!response.ok)throw new Error("Presence unavailable");
        const result=await response.json();
        failures=0;
        if(!stopped&&!leave&&Number.isInteger(result.others))setPresence({documentId,scope:scope!,others:Math.max(0,result.others)});
      }catch{if(++failures>=2&&!stopped)setPresence(null);}
      finally{if(!leave)inFlight=false;}
    }
    void heartbeat();
    const interval=setInterval(()=>{void heartbeat();},25_000);
    const visibility=()=>{void heartbeat(document.visibilityState==="hidden");};
    const pagehide=()=>{void heartbeat(true);};
    document.addEventListener("visibilitychange",visibility);window.addEventListener("pagehide",pagehide);
    return()=>{stopped=true;clearInterval(interval);document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",pagehide);void heartbeat(true);};
  },[documentId,scope,enabled]);
  return enabled&&presence?.documentId===documentId&&presence.scope===scope?presence.others:0;
}
