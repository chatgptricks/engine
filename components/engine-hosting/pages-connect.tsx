"use client";
import {useEffect,useState} from "react";
import {AdminLoginForm} from "@/app/admin/login/login-form";
import {getRecoveryDrafts} from "@/lib/template-editor/recovery-storage";
export function PagesConnect({origin,state}:{origin:string;state:string}) {
  const [message,setMessage]=useState("Sign in to continue to your workspace."),[signedIn,setSignedIn]=useState(false);
  useEffect(()=>{
    let stopped=false,busy=false,finished=false;
    const check=async()=>{
      if(busy||finished)return;busy=true;
      try {
        const response=await fetch("/api/engine/pages-session",{cache:"no-store",signal:AbortSignal.timeout(15000)});
        if(!response.ok||stopped)return;
        const session=await response.json();
        if(!window.opener){setSignedIn(true);setMessage("Signed in. Return to Engine and choose Sign in once more.");return;}
        // Carry pending edits over the origin change; the normal recovery
        // reconciliation still decides how they merge with cloud data.
        const drafts=await getRecoveryDrafts(session.scope);
        if(stopped)return;
        window.opener.postMessage({type:"engine-sign-in",state,session,drafts},origin);
        finished=true;setSignedIn(true);setMessage("Signed in. You can return to Engine.");window.close();
      } catch {if(!stopped)setMessage("Waiting for sign-in. Keep this window open after following the email link.");}
      finally {busy=false;}
    };
    void check();const timer=setInterval(()=>void check(),2000);
    return()=>{stopped=true;clearInterval(timer);};
  },[origin,state]);
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6"><h1 className="text-2xl font-semibold">Sign in to Engine</h1><p role="status">{message}</p>{!signedIn&&<AdminLoginForm initialError={null}/>}<p className="text-sm text-muted">If the email opens another tab, keep this window open. It will connect automatically.</p></main>;
}
