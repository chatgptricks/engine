import {resolveEngineAccess} from "@/lib/engine/member";
import {MAX_ORIGINAL_BYTES, originalPreview, storeOriginalAsset} from "@/lib/template-editor/media-storage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
function allowedOrigin(request:Request) {
  const origin=request.headers.get("origin");
  if(origin===null) return true;
  return [request.url,process.env.NEXT_PUBLIC_SITE_URL,process.env.RENDER_EXTERNAL_URL].some(value=>{try {return Boolean(value)&&new URL(value!).origin===origin && /^https?:\/\//.test(origin);}catch{return false;}});
}
export async function POST(request:Request) {
  const access=await resolveEngineAccess();
  if(!access) return reply({error:"Sign in to save original images."},401);
  if(!allowedOrigin(request)) return reply({error:"Upload images from the editor."},403);
  if(Number(request.headers.get("content-length")??0)>MAX_ORIGINAL_BYTES) return reply({error:"Choose an image smaller than 15 MB."},413);
  const reader=request.body?.getReader();
  if(!reader) return reply({error:"Choose an image."},400);
  const chunks:Buffer[]=[];let size=0;
  try {
    while(true) {const chunk=await reader.read();if(chunk.done) break;size+=chunk.value.byteLength;if(size>MAX_ORIGINAL_BYTES){await reader.cancel();throw new RangeError("Choose an image smaller than 15 MB.");}chunks.push(Buffer.from(chunk.value));}
    const rawName=request.headers.get("x-image-name")??"Image";
    let name="Image";try{name=decodeURIComponent(rawName);}catch{ /* A malformed optional filename does not affect image bytes. */ }
    const asset=await storeOriginalAsset(access.ownerKey,Buffer.concat(chunks),name);
    const previewSrc=await originalPreview(asset);
    return reply({id:asset.id,src:`/api/template-editor/assets/${asset.id}`,previewSrc,width:asset.width,height:asset.height,bytes:asset.bytes,mimeType:asset.mimeType});
  }catch(error) {
    const message=error instanceof Error?error.message:"Could not save this image.";
    const status=error instanceof RangeError?413:/storage|could not be saved/i.test(message)?503:400;
    return reply({error:status===400?"This image could not be decoded. Choose a still JPG, PNG, or WebP image.":message},status);
  }finally {reader.releaseLock();}
}
