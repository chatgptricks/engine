import {resolveEngineAccess} from "@/lib/engine/member";
import {beginVideoUpload, blobConfigured, checkVideoMeta, finishBlobUpload, finishChunkedUpload, VIDEO_QUOTA_BYTES, VideoError, videoSrc, videoUsage} from "@/lib/template-editor/video-storage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
function sameOrigin(request:Request) {
  const origin=request.headers.get("origin");
  if(origin===null) return true;
  return [request.url,process.env.NEXT_PUBLIC_SITE_URL,process.env.RENDER_EXTERNAL_URL,process.env.ENGINE_FRONTEND_URL].some(value=>{try {return Boolean(value)&&new URL(value!).origin===origin && /^https?:\/\//.test(origin);}catch{return false;}});
}
function videoFailure(error:unknown) {
  if(error instanceof VideoError) return reply({error:error.message},error.status);
  return reply({error:"Video storage is temporarily unavailable."},503);
}
/** How uploads go here (Blob or parts) and how much of the quota is used. */
export async function GET() {
  const access=await resolveEngineAccess();
  if(!access) return reply({error:"Sign in to upload videos."},401);
  try {return reply({mode:blobConfigured()?"blob":"chunks",used:await videoUsage(access.ownerKey),quota:VIDEO_QUOTA_BYTES});}
  catch(error) {return videoFailure(error);}
}
/** `{action:"start", meta}` reuses a clip the workspace has or says where to send it;
 * `{action:"finish", meta, url?}` records the clip once its bytes have arrived. */
export async function POST(request:Request) {
  const access=await resolveEngineAccess();
  if(!access) return reply({error:"Sign in to upload videos."},401);
  if(!sameOrigin(request)) return reply({error:"Upload videos from the editor."},403);
  const body=await request.json().catch(()=>null) as {action?:unknown;meta?:unknown;url?:unknown}|null;
  try {
    const meta=checkVideoMeta(body?.meta);
    if(body?.action==="start") return reply(await beginVideoUpload(access.ownerKey,meta));
    if(body?.action==="finish") {
      const record=typeof body.url==="string"?await finishBlobUpload(access.ownerKey,meta,body.url):await finishChunkedUpload(access.ownerKey,meta);
      return reply({src:videoSrc(record.id),record});
    }
    return reply({error:"Unknown video action."},400);
  }catch(error) {return videoFailure(error);}
}
