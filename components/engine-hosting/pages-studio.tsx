"use client";
import {useEffect,useRef,useState} from "react";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";
import Studio from "@/components/template-editor/studio";
import {saveRecoveryDraft,type RecoveryDraft} from "@/lib/template-editor/recovery-storage";
import {parseLibrary} from "@/lib/template-editor/model";
import {createSessionTokenReader} from "@/lib/engine/session-token";

const backend=process.env.NEXT_PUBLIC_ENGINE_API_URL??"";
const base=process.env.NEXT_PUBLIC_ENGINE_BASE_PATH??"/engine";
export function PagesStudio(){
  const [scope,setScope]=useState<string|null>(null),[ready,setReady]=useState(false),[error,setError]=useState("");
  const auth=useRef<SupabaseClient|null>(null),popup=useRef<Window|null>(null),state=useRef("");
  useEffect(()=>{
    let active=true,stopAuth:(()=>void)|undefined;
    const token=createSessionTokenReader(()=>auth.current);
    const workerMessage=(event:MessageEvent)=>{
      if(event.source!==navigator.serviceWorker.controller||event.data?.type!=="engine-api-token"||!event.ports[0])return;
      void token(event.data.refresh===true).then(value=>event.ports[0].postMessage({token:value})).catch(()=>event.ports[0].postMessage({error:true}));
    };
    const resolveScope=async()=>{
      const value=await token();
      const response=await fetch(`${backend}/api/engine/session`,{headers:value?{Authorization:`Bearer ${value}`}:{},cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(30000)});
      if(response.status===401){if(active)setScope(null);return;}
      const data=await response.json();
      if(!response.ok||!/^[a-f0-9]{64}$/.test(data.scope))throw Error(data.error??"Your workspace could not be opened.");
      if(active){setScope(data.scope);setError("");}
      return data.scope as string;
    };
    const signedIn=async(event:MessageEvent)=>{
      if(event.origin!==backend||event.source!==popup.current||event.data?.type!=="engine-sign-in"||event.data?.state!==state.current||!state.current)return;
      state.current="";setReady(false);
      try {
        const {session,drafts}=event.data;
        if(!auth.current||typeof session?.access_token!=="string"||typeof session?.refresh_token!=="string")throw Error("Sign-in could not be completed.");
        const result=await auth.current.auth.setSession(session);if(result.error)throw result.error;
        const confirmed=await resolveScope();
        if(confirmed&&Array.isArray(drafts))for(const candidate of drafts as RecoveryDraft[]){
          const library=parseLibrary(candidate.library),baseline=candidate.baseline?parseLibrary(candidate.baseline):undefined;
          if(candidate.scope!==confirmed||!library||typeof candidate.key!=="string"||typeof candidate.stamp!=="string"||!Number.isFinite(candidate.updatedAt))continue;
          await saveRecoveryDraft({...candidate,library,...(baseline?{baseline}:{baseline:undefined})});
        }
        // Mount only after recovery records have arrived on the new origin.
        if(active)setReady(true);
      } catch(cause){if(active){setReady(true);setError(cause instanceof Error?cause.message:"Sign-in could not be completed.");}}
    };
    window.addEventListener("message",signedIn);navigator.serviceWorker?.addEventListener("message",workerMessage);
    void (async()=>{
      if(!backend)throw Error("The workspace connection has not been configured.");
      if(!("serviceWorker" in navigator))throw Error("Use a browser with secure workspace support enabled.");
      const response=await fetch(`${backend}/api/engine/config`,{cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(30000)}),config=await response.json();
      if(!response.ok)throw Error(config.error??"The workspace is unavailable.");
      if(config.supabaseUrl&&config.supabaseKey)auth.current=createClient(config.supabaseUrl,config.supabaseKey,{auth:{storageKey:"engine-pages-session",persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
      else if(!config.local||!["localhost","127.0.0.1"].includes(new URL(backend).hostname))throw Error("Sign-in is not configured.");
      await navigator.serviceWorker.register(`${base}/engine-api-worker.js`,{scope:`${base}/`,updateViaCache:"none"});
      await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller)await new Promise<void>((resolve,reject)=>{
        const timeout=setTimeout(()=>{navigator.serviceWorker.removeEventListener("controllerchange",check);reject(Error("Reload Engine to finish connecting."));},15000);
        const check=()=>{if(navigator.serviceWorker.controller){clearTimeout(timeout);navigator.serviceWorker.removeEventListener("controllerchange",check);resolve();}};
        navigator.serviceWorker.addEventListener("controllerchange",check);check();
      });
      await resolveScope();if(active)setReady(true);
      const subscription=auth.current?.auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT"&&active)setScope(null);});
      stopAuth=()=>subscription?.data.subscription.unsubscribe();
    })().catch(cause=>{if(active){setError(cause instanceof Error?cause.message:"Could not connect.");setReady(true);}});
    return()=>{active=false;stopAuth?.();window.removeEventListener("message",signedIn);navigator.serviceWorker?.removeEventListener("message",workerMessage);};
  },[]);
  if(scope&&ready)return <Studio workspaceScope={scope}/>;
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 px-6"><h1 className="text-3xl font-semibold">Engine</h1><p>{ready?"Sign in to open your designs and templates.":"Connecting to your workspace…"}</p>{error&&<p role="alert">{error}</p>}{ready&&<button className="rounded-xl bg-accent px-5 py-3 font-semibold text-accent-fg" onClick={()=>{
    state.current=crypto.randomUUID();setError("");setReady(false);
    popup.current=window.open(`${backend}/admin/pages-connect?origin=${encodeURIComponent(location.origin)}&state=${state.current}`,"engine-sign-in","popup,width=520,height=720");
    if(!popup.current)setError("Allow the sign-in window, then try again.");setReady(true);
  }}>Sign in</button>}<button className="text-sm underline" onClick={()=>location.reload()}>Retry connection</button></main>;
}
