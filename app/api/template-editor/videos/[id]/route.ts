import {createReadStream,promises as fs} from "node:fs";
import {Readable} from "node:stream";
import {resolveEngineAccess} from "@/lib/engine/member";
import {appendVideoChunk,readVideoRecord,VideoError,videoFile} from "@/lib/template-editor/video-storage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(value:unknown,status:number)=>Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
function sameOrigin(request:Request) {
  const origin=request.headers.get("origin");
  if(origin===null) return true;
  return [request.url,process.env.NEXT_PUBLIC_SITE_URL,process.env.RENDER_EXTERNAL_URL,process.env.ENGINE_FRONTEND_URL].some(value=>{try {return Boolean(value)&&new URL(value!).origin===origin && /^https?:\/\//.test(origin);}catch{return false;}});
}
/** Plays a clip. In production it redirects to the clip's Blob file; in development
 * it serves the file with Range, which the player needs to seek. Ids are content
 * hashes, so a response never changes. */
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
  const access=await resolveEngineAccess();
  if(!access) return json({error:"Sign in to play this video."},401);
  const {id}=await context.params;
  try {
    const record=await readVideoRecord(access.ownerKey,id);
    if(!record) return json({error:"Video not found in this workspace."},404);
    if(record.blobUrl) return new Response(null,{status:302,headers:{Location:record.blobUrl,"Cache-Control":"private, max-age=3600"}});
    const file=await videoFile(access.ownerKey,id);
    if(!file) return json({error:"Video not found in this workspace."},404);
    const {size}=await fs.stat(file);
    const base={"Content-Type":record.mimeType,"Accept-Ranges":"bytes","Cache-Control":"private, max-age=31536000, immutable","X-Content-Type-Options":"nosniff"};
    const range=request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
    if(range&&(range[1]||range[2])) {
      const start=range[1]?Number(range[1]):Math.max(0,size-Number(range[2]));
      let end=range[1]&&range[2]?Number(range[2]):size-1;
      end=Math.min(end,size-1);
      if(start>end||start>=size) return new Response(null,{status:416,headers:{...base,"Content-Range":`bytes */${size}`}});
      return new Response(Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream,{status:206,headers:{...base,"Content-Range":`bytes ${start}-${end}/${size}`,"Content-Length":String(end-start+1)}});
    }
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream,{headers:{...base,"Content-Length":String(size)}});
  }catch(error) {
    if(error instanceof VideoError) return json({error:error.message},error.status);
    return json({error:"Video storage is temporarily unavailable."},503);
  }
}
/** Development uploads: one part of at most 4 MB at `?offset=` of `?total=` bytes. */
export async function PUT(request:Request,context:{params:Promise<{id:string}>}) {
  const access=await resolveEngineAccess();
  if(!access) return json({error:"Sign in to upload videos."},401);
  if(!sameOrigin(request)) return json({error:"Upload videos from the editor."},403);
  const {id}=await context.params;
  const query=new URL(request.url).searchParams;
  try {
    const data=Buffer.from(await request.arrayBuffer());
    const received=await appendVideoChunk(access.ownerKey,id,Number(query.get("offset")),data,Number(query.get("total")));
    return json({received},200);
  }catch(error) {
    if(error instanceof VideoError) return json({error:error.message},error.status);
    return json({error:"Video storage is temporarily unavailable."},503);
  }
}
