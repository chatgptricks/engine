import sharp from "sharp";
import {resolveEngineAccess} from "@/lib/engine/member";
import {readOriginalAsset} from "@/lib/template-editor/media-storage";
import {fetchOriginalImageBytes} from "@/lib/template-editor/review-assets";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request){
 const access=await resolveEngineAccess();if(!access)return Response.json({error:"Sign in to prepare image exports."},{status:401,headers});
 const origin=request.headers.get("origin");if(origin&&![request.url,process.env.NEXT_PUBLIC_SITE_URL,process.env.RENDER_EXTERNAL_URL].some(value=>{try{return value&&new URL(value).origin===origin;}catch{return false;}}))return Response.json({error:"Prepare images from the editor."},{status:403,headers});
 try{
  const reader=request.body?.getReader();if(!reader)throw Error("Choose an image.");const chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>16384){await reader.cancel();return Response.json({error:"Image address is too long."},{status:413,headers});}chunks.push(part.value);}}finally{reader.releaseLock();}
  const input=JSON.parse(await new Blob(chunks as BlobPart[]).text());if(typeof input.src!=="string")throw Error("Choose an image.");
  const assetId=input.src.match(/^\/api\/template-editor\/assets\/([a-f0-9]{64})$/)?.[1];
  if(assetId){const asset=await readOriginalAsset(access.ownerKey,assetId);if(!asset)return Response.json({error:"Image unavailable in this workspace."},{status:404,headers});return Response.json({width:asset.width,height:asset.height},{headers});}
  const source=input.src.startsWith("/api/engine/img?")?new URL(input.src,"http://engine.local").searchParams.get("u")??"":input.src;
  const metadata=await sharp(await fetchOriginalImageBytes(source),{limitInputPixels:100_000_000}).metadata();
  if(!metadata.width||!metadata.height||metadata.width*metadata.height>100_000_000||(metadata.pages??1)>1)throw Error("Choose a still image for this export.");
  const rotated=(metadata.orientation??1)>=5;return Response.json({width:rotated?metadata.height:metadata.width,height:rotated?metadata.width:metadata.height},{headers});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Image dimensions could not be confirmed."},{status:400,headers});}
}
