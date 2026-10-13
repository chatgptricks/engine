import {resolveEngineAccess} from "@/lib/engine/member";
import {editorOwnerScope} from "@/lib/template-editor/persistence";
import {heartbeatPresence} from "@/lib/template-editor/presence";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function POST(request:Request) {
  const access=await resolveEngineAccess();if(!access)return reply({error:"Sign in to check editor presence."},401);
  const origin=request.headers.get("origin");
  if(origin!==null&&![request.url,process.env.NEXT_PUBLIC_SITE_URL,process.env.RENDER_EXTERNAL_URL].some(value=>{try{return Boolean(value)&&new URL(value!).origin===origin;}catch{return false;}}))return reply({error:"Open presence from the editor."},403);
  const reader=request.body?.getReader();if(!reader)return reply({error:"Invalid presence request."},400);
  let input:Record<string,unknown>;
  try {
    let text="",size=0;const decoder=new TextDecoder();
    while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>4096){await reader.cancel();return reply({error:"Presence request exceeds its size limit."},413);}text+=decoder.decode(item.value,{stream:true});}
    input=JSON.parse(text+decoder.decode());
  }catch{return reply({error:"Invalid presence request."},400);}finally{reader.releaseLock();}
  if(!input||typeof input!=="object"||typeof input.sessionId!=="string"||!/^[a-f0-9-]{36}$/i.test(input.sessionId)||typeof input.documentId!=="string"||!/^[A-Za-z0-9._:-]{1,160}$/.test(input.documentId)||typeof input.expectedScope!=="string"||!Number.isSafeInteger(input.sequence)||Number(input.sequence)<1||Number(input.sequence)>1_000_000||(input.leave!==undefined&&typeof input.leave!=="boolean"))return reply({error:"Invalid editor session."},400);
  if(input.expectedScope!==editorOwnerScope(access.ownerKey))return reply({error:"The signed-in workspace changed."},403);
  try{return reply({others:await heartbeatPresence(access.ownerKey,input.sessionId,input.documentId,input.leave===true,Number(input.sequence)),checkedAt:Date.now()});}
  catch{return reply({error:"Editor presence is temporarily unavailable."},503);}
}
