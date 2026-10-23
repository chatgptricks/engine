import JSZip from "jszip";
import type {EditorLibrary} from "./model";
import {packAssets, unpackAssets} from "./library-sync";
export async function packPortableLibrary(library:EditorLibrary):Promise<string> {
  const packed=await packAssets(library);
  return JSON.stringify({format:"engine-workspace",version:1,library:packed.value,assets:packed.assets});
}
export function unpackPortableLibrary(value:unknown):unknown {
  if(value&&typeof value==="object"&&"format" in value&&value.format==="engine-workspace") {
    const packed=value as {version?:number;library?:unknown;assets?:Record<string,string>};
    if(packed.version!==1||!packed.library||!packed.assets||typeof packed.assets!=="object"||Array.isArray(packed.assets))throw new Error("The workspace backup is invalid.");
    return unpackAssets(packed.library,packed.assets);
  }
  return value; // Legacy backups remain importable.
}
const MAX_ARCHIVE=200*1024*1024, MAX_ASSET=15*1024*1024, MAX_LIBRARY=40*1024*1024;
const privateSource=/^\/api\/template-editor\/assets\/([a-f0-9]{64})$/;
type MediaEntry={id:string;path:string;mimeType:string;bytes:number};
export function originalAssetIds(value:unknown):string[] {
  const ids=new Set<string>();
  const visit=(item:unknown)=>{if(typeof item==="string"){const match=privateSource.exec(item);if(match)ids.add(match[1]);}else if(Array.isArray(item))item.forEach(visit);else if(item&&typeof item==="object")Object.values(item).forEach(visit);};
  visit(value);return [...ids];
}
const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");
async function boundedEntry(entry:JSZip.JSZipObject,limit:number):Promise<ArrayBuffer> {
  return new Promise((resolve,reject)=>{
    // JSZip implements this streaming API on entries but omits it from its declarations.
    const source=entry as JSZip.JSZipObject & {internalStream(type:"uint8array"):JSZip.JSZipStreamHelper<Uint8Array>};
    const chunks:Uint8Array[]=[],stream=source.internalStream("uint8array");let size=0,failed=false;
    stream.on("data",chunk=>{size+=chunk.byteLength;if(size>limit){failed=true;stream.pause();reject(new Error("An expanded backup entry exceeds its size limit."));return;}chunks.push(chunk);});
    stream.on("error",reject);
    stream.on("end",()=>{if(failed)return;const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}resolve(result.buffer);});
    stream.resume();
  });
}
function download(blob:Blob,name:string) {
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60_000);
}
export async function downloadPortableLibrary(library:EditorLibrary,name:string):Promise<void> {
  const base=name.replace(/(?:\.engine)?\.(?:json|zip)$/i,"")||"Engine backup",ids=originalAssetIds(library),json=await packPortableLibrary(library);
  if(!ids.length){download(new Blob([json],{type:"application/json"}),`${base}.engine.json`);return;}
  const zip=new JSZip(),assets:MediaEntry[]=[];let total=new Blob([json]).size;
  if(total>MAX_LIBRARY)throw new Error("The workspace is too large for one backup. Export selected projects instead.");
  zip.file("library.json",json);
  for(const id of ids) {
    const response=await fetch(`/api/template-editor/assets/${id}`);
    if(!response.ok)throw new Error("An original image is unavailable. Sign in to its workspace and retry the backup.");
    const buffer=await response.arrayBuffer();total+=buffer.byteLength;
    if(buffer.byteLength>MAX_ASSET||total>MAX_ARCHIVE)throw new Error("This backup exceeds 200 MB. Export fewer projects at a time.");
    if(await digest(buffer)!==id)throw new Error("An original image failed verification. Retry the backup.");
    const entry={id,path:`assets/${id}`,mimeType:response.headers.get("content-type")??"application/octet-stream",bytes:buffer.byteLength};
    assets.push(entry);zip.file(entry.path,buffer);
  }
  zip.file("manifest.json",JSON.stringify({version:1,assets}));
  download(await zip.generateAsync({type:"blob",compression:"STORE"}),`${base}.engine.zip`);
}
/** Check ZIP central directory sizes before any entry can be decompressed. */
export function validateArchiveDirectory(buffer:ArrayBuffer):void {
  const view=new DataView(buffer);let end=-1;
  for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw new Error("This is not a supported Engine archive.");
  const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true);let position=offset,total=0;
  if(count>1000||count===65535||offset>=end)throw new Error("The backup has too many entries or an unsupported ZIP format.");
  const names=new Set<string>(),decoder=new TextDecoder();
  for(let i=0;i<count;i++) {
    if(position+46>end||view.getUint32(position,true)!==0x02014b50)throw new Error("The backup directory is damaged.");
    const size=view.getUint32(position+24,true),nameLength=view.getUint16(position+28,true),extra=view.getUint16(position+30,true),comment=view.getUint16(position+32,true);
    const name=decoder.decode(new Uint8Array(buffer,position+46,nameLength));
    if(names.has(name)||!(/^(?:library\.json|manifest\.json|assets\/|assets\/[a-f0-9]{64})$/).test(name)||view.getUint16(position+8,true)&1)throw new Error("The backup contains an unexpected or duplicate entry.");
    names.add(name);total+=size;
    if(size>(name==="library.json"?MAX_LIBRARY:name==="manifest.json"?200_000:MAX_ASSET)||total>MAX_ARCHIVE)throw new Error("The expanded backup exceeds its size limit.");
    position+=46+nameLength+extra+comment;
  }
  if(position!==offset+view.getUint32(end+12,true))throw new Error("The backup directory is damaged.");
}
export async function readLibraryArchive(file:File):Promise<{library:unknown;restoreMedia(selected:EditorLibrary):Promise<void>}> {
  if(file.size>MAX_ARCHIVE)throw new Error("Choose a backup smaller than 200 MB.");
  if(!/\.zip$/i.test(file.name)) {
    if(file.size>MAX_LIBRARY)throw new Error("Choose a JSON backup smaller than 40 MB.");
    return {library:unpackPortableLibrary(JSON.parse(await file.text())),restoreMedia:async(selected)=>{
      for(const id of originalAssetIds(selected)){const response=await fetch(`/api/template-editor/assets/${id}`);if(!response.ok)throw new Error("This JSON references private originals that are missing. Import its portable .engine.zip backup instead.");await response.body?.cancel();}
    }};
  }
  const buffer=await file.arrayBuffer();validateArchiveDirectory(buffer);
  const zip=await JSZip.loadAsync(buffer),libraryFile=zip.file("library.json"),manifestFile=zip.file("manifest.json");
  if(!libraryFile||!manifestFile)throw new Error("The Engine backup is missing its library or manifest.");
  const library:unknown=unpackPortableLibrary(JSON.parse(new TextDecoder().decode(await boundedEntry(libraryFile,MAX_LIBRARY))));
  const manifest=JSON.parse(new TextDecoder().decode(await boundedEntry(manifestFile,200_000))) as {version:number;assets:MediaEntry[]};
  if(manifest.version!==1||!Array.isArray(manifest.assets)||manifest.assets.length>999)throw new Error("The backup manifest is invalid.");
  const entries=new Map<string,MediaEntry>();
  for(const entry of manifest.assets){if(!entry||!/^[a-f0-9]{64}$/.test(entry.id)||entry.path!==`assets/${entry.id}`||entries.has(entry.id)||!Number.isInteger(entry.bytes)||entry.bytes<1||entry.bytes>MAX_ASSET||!["image/jpeg","image/png","image/webp"].includes(entry.mimeType))throw new Error("The backup image manifest is invalid.");entries.set(entry.id,entry);}
  return {library,restoreMedia:async(selected)=>{
    for(const id of originalAssetIds(selected)) {
      const entry=entries.get(id),image=entry&&zip.file(entry.path);
      if(!entry||!image)throw new Error("A selected project's original image is missing from this backup.");
      const data=await boundedEntry(image,MAX_ASSET);
      if(data.byteLength!==entry.bytes||await digest(data)!==id)throw new Error("An original image in the backup is damaged.");
      const response=await fetch("/api/template-editor/assets",{method:"POST",headers:{"Content-Type":entry.mimeType,"X-Image-Name":`Restored-${id.slice(0,8)}`},body:data});
      const result=await response.json();
      if(!response.ok||result.id!==id)throw new Error(result.error??"An original image could not be restored. Your library has not changed.");
    }
  }};
}
