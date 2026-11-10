import {resolveEngineAccess} from "@/lib/engine/member";
import {originalRendition,readOriginalAsset} from "@/lib/template-editor/media-storage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
  const access=await resolveEngineAccess();
  if(!access) return Response.json({error:"Sign in to view this original image."},{status:401,headers});
  const requestedSize=new URL(request.url).searchParams.get("maxDimension");
  const size=requestedSize===null?null:Number(requestedSize);
  if(size!==null&&(!/^\d+$/.test(requestedSize!)||!Number.isInteger(size)||size<1||size>8192)) return Response.json({error:"Image size must be between 1 and 8192 pixels."},{status:400,headers});
  const {id}=await context.params;
  try {
    const asset=await readOriginalAsset(access.ownerKey,id);
    if(!asset) return Response.json({error:"Original image not found in this workspace."},{status:404,headers});
    const output=size===null?asset:await originalRendition(asset,size);
    // A stored vector is passive (isSafeBrandSvg); opened on its own, it still can't run or load anything.
    const vector:Record<string,string>=output.mimeType==="image/svg+xml"?{"Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; sandbox"}:{};
    return new Response(new Uint8Array(output.data),{headers:{...headers,...vector,"Content-Type":output.mimeType,"Content-Length":String(output.bytes)}});
  }catch{return Response.json({error:"Original image storage is temporarily unavailable."},{status:503,headers});}
}
