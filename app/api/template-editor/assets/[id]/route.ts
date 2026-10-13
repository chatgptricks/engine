import {resolveEngineAccess} from "@/lib/engine/member";
import {readOriginalAsset} from "@/lib/template-editor/media-storage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}) {
  const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
  const access=await resolveEngineAccess();
  if(!access) return Response.json({error:"Sign in to view this original image."},{status:401,headers});
  const {id}=await context.params;
  try {
    const asset=await readOriginalAsset(access.ownerKey,id);
    if(!asset) return Response.json({error:"Original image not found in this workspace."},{status:404,headers});
    return new Response(new Uint8Array(asset.data),{headers:{...headers,"Content-Type":asset.mimeType,"Content-Length":String(asset.bytes)}});
  }catch{return Response.json({error:"Original image storage is temporarily unavailable."},{status:503,headers});}
}
