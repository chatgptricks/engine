import {handleUpload,type HandleUploadBody} from "@vercel/blob/client";
import {resolveEngineAccess} from "@/lib/engine/member";
import {MAX_VIDEO_BYTES,VIDEO_MIME_TYPES} from "@/lib/template-editor/model";
import {blobConfigured,blobPathPrefix,checkVideoMeta,VIDEO_QUOTA_BYTES,videoUsage} from "@/lib/template-editor/video-storage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
/** Mints a Blob upload token for one clip: the path must be this workspace's
 * `te-video/<workspace>/<sha256>`, the type a video, and the size within limits.
 * The browser then sends the file straight to Blob, never through this server. */
export async function POST(request:Request) {
  if(!blobConfigured()) return Response.json({error:"Video uploads aren't connected. Create a Blob store in Vercel."},{status:503});
  const access=await resolveEngineAccess();
  if(!access) return Response.json({error:"Sign in to upload videos."},{status:401});
  const body=await request.json().catch(()=>null) as HandleUploadBody|null;
  if(!body) return Response.json({error:"Bad request."},{status:400});
  try {
    const json=await handleUpload({
      body,request,
      onBeforeGenerateToken:async(pathname,clientPayload)=>{
        let meta;
        try {meta=checkVideoMeta(JSON.parse(clientPayload??"null"));}catch(error){throw new Error(error instanceof Error?error.message:"This video could not be read.");}
        if(!pathname.startsWith(`${blobPathPrefix(access.ownerKey,meta.id)}.`)) throw new Error("That upload path isn't this workspace's.");
        if(await videoUsage(access.ownerKey)+meta.bytes>VIDEO_QUOTA_BYTES) throw new Error("This workspace has reached its video limit.");
        return {allowedContentTypes:[...VIDEO_MIME_TYPES],maximumSizeInBytes:Math.min(MAX_VIDEO_BYTES,meta.bytes),addRandomSuffix:true};
      },
      onUploadCompleted:async()=>{},
    });
    return Response.json(json);
  }catch(error) {return Response.json({error:error instanceof Error?error.message:"Upload failed."},{status:400});}
}
