import {resolveEngineAccess} from '@/lib/engine/member';
import {EMPTY_LIBRARY,parseLibrary} from '@/lib/template-editor/model';
import {unpackAssets} from '@/lib/template-editor/library-sync';
import {renderDocumentPdf} from '@/lib/template-editor/pdf-document';
import type {PdfOptions} from '@/lib/template-editor/pdf-options';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function POST(request:Request){
 const access=await resolveEngineAccess();if(!access)return Response.json({error:'Sign in to export a document.'},{status:401,headers});
 const origin=request.headers.get('origin');if(origin&&! [request.url,process.env.NEXT_PUBLIC_SITE_URL,process.env.RENDER_EXTERNAL_URL,process.env.ENGINE_FRONTEND_URL].some(value=>{try{return value&&new URL(value).origin===origin;}catch{return false;}}))return Response.json({error:'Export from the editor.'},{status:403,headers});
 try{
  if(Number(request.headers.get('content-length'))>24*1024*1024)throw Error('PDF request exceeds 24 MB. Export fewer pages.');
  const reader=request.body?.getReader();if(!reader)throw Error('Choose a document.');const chunks:Uint8Array[]=[];let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>24*1024*1024){await reader.cancel();throw Error('PDF request exceeds 24 MB. Use a smaller raster DPI.');}chunks.push(part.value);}}finally{reader.releaseLock();}
  const input=JSON.parse(await new Blob(chunks as BlobPart[]).text());
  const document=unpackAssets(input.document,input.assets??{}),library=parseLibrary({...EMPTY_LIBRARY,designs:[document]});if(!library||!(typeof input.pageId==='string'||Array.isArray(input.pageIds)&&input.pageIds.every((id:unknown)=>typeof id==='string')))throw Error('Invalid design document.');
  if(input.options?.pdfMode!==undefined&&!['document','raster'].includes(input.options.pdfMode))throw Error('Choose a PDF mode.');
  const buffer=await renderDocumentPdf(library.designs[0],input.pageIds??input.pageId,(input.options??{}) as PdfOptions,access.ownerKey,input.raster,request.signal);
  return new Response(new Uint8Array(buffer),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="engine-page.pdf"'}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Document export failed.'},{status:400,headers});}
}
