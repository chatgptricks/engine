import {createHash, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {developmentDirectory, readDevelopmentRecord} from "./development-storage";

export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
const MAX_PIXELS = 100_000_000;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export type OriginalAsset = {id:string; data:Buffer; mimeType:string; width:number; height:number; bytes:number; name:string};
type AssetRecord = Omit<OriginalAsset,"data"> & {version:1; base64:string};
const key = (owner:string,id:string) => `template-editor-media:${hash(`template-editor:${owner}`)}:${id}`;
const formats:Record<string,string> = {jpeg:"image/jpeg",png:"image/png",webp:"image/webp"};
export async function inspectOriginalAsset(data:Buffer,name:string):Promise<OriginalAsset> {
  if (!data.length || data.length > MAX_ORIGINAL_BYTES) throw new RangeError("Choose an image between 1 byte and 15 MB.");
  const metadata = await sharp(data,{limitInputPixels:MAX_PIXELS,failOn:"error"}).metadata();
  const mimeType = formats[metadata.format ?? ""];
  if (!mimeType || !metadata.width || !metadata.height || (metadata.pages ?? 1)>1) throw new TypeError("Choose a still JPG, PNG, or WebP image.");
  // Decode the pixels as well: metadata alone accepts truncated/corrupt files.
  await sharp(data,{limitInputPixels:MAX_PIXELS,failOn:"error"}).resize(1,1).raw().toBuffer();
  const rotated = (metadata.orientation ?? 1)>=5;
  return {id:hash(data),data,mimeType,width:rotated?metadata.height:metadata.width,height:rotated?metadata.width:metadata.height,bytes:data.length,name:name.slice(0,200)};
}
function decode(value:unknown):OriginalAsset {
  const record = value as AssetRecord;
  if (!record || record.version!==1 || !/^[a-f0-9]{64}$/.test(record.id) || typeof record.base64!=="string" || record.base64.length>MAX_ORIGINAL_BYTES*4/3+4) throw new Error("The original image could not be read.");
  const data=Buffer.from(record.base64,"base64");
  if (data.length!==record.bytes || hash(data)!==record.id || !Object.values(formats).includes(record.mimeType) || !Number.isInteger(record.width) || !Number.isInteger(record.height) || record.width<1 || record.height<1) throw new Error("The original image is damaged.");
  return {id:record.id,data,mimeType:record.mimeType,width:record.width,height:record.height,bytes:data.length,name:record.name};
}
export async function readOriginalAsset(owner:string,id:string):Promise<OriginalAsset|null> {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const db=getAdminSupabase(), storageKey=key(owner,id);
  if (!db) {
    if(process.env.NODE_ENV==="production") throw new Error("Original image storage is unavailable.");
    return readDevelopmentRecord("template-editor-media",`${hash(storageKey)}.json`,decode);
  }
  const {data,error}=await db.from("gf_client_state").select("data").eq("owner",storageKey).maybeSingle();
  if(error) throw new Error("Original image storage is unavailable.");
  return data?decode(data.data):null;
}
export async function storeOriginalAsset(owner:string,data:Buffer,name:string):Promise<OriginalAsset> {
  const asset=await inspectOriginalAsset(data,name);
  const {data:bytes,...properties}=asset;
  const record:AssetRecord={...properties,version:1,base64:bytes.toString("base64")};
  const db=getAdminSupabase(), storageKey=key(owner,asset.id);
  if(db) {
    const {error}=await db.from("gf_client_state").upsert({owner:storageKey,data:record,updated_at:new Date().toISOString()},{onConflict:"owner"});
    if(error) throw new Error("The original image could not be saved. Retry when connected.");
  } else {
    if(process.env.NODE_ENV==="production") throw new Error("Original image storage is unavailable.");
    const directory=developmentDirectory("template-editor-media");
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const temporary=path.join(directory,`${randomUUID()}.tmp`);
    try {await fs.writeFile(temporary,JSON.stringify(record),{mode:0o600});await fs.rename(temporary,path.join(directory,`${hash(storageKey)}.json`));}
    finally {await fs.unlink(temporary).catch(()=>undefined);}
  }
  return asset;
}
export async function originalPreview(asset:OriginalAsset):Promise<string> {
  for(const size of [1440,1080,720]) {
    const preview=await sharp(asset.data,{limitInputPixels:MAX_PIXELS}).rotate().resize(size,size,{fit:"inside",withoutEnlargement:true}).webp({quality:78}).toBuffer();
    if(preview.length<=360_000) return `data:image/webp;base64,${preview.toString("base64")}`;
  }
  throw new Error("Could not create a lightweight image preview.");
}

/** A lossless, orientation-correct export rendition; the stored original stays intact. */
let renditionQueue:Promise<void>=Promise.resolve();
export async function originalRendition(asset:OriginalAsset,maxDimension:number):Promise<{data:Buffer;mimeType:string;bytes:number}> {
  if(!Number.isInteger(maxDimension)||maxDimension<1||maxDimension>8192) throw new RangeError("Image size must be between 1 and 8192 pixels.");
  // Browser image loads arrive together; serialize their decoders per process.
  const previous=renditionQueue;let release!:()=>void;
  renditionQueue=new Promise<void>(resolve=>{release=resolve;});
  await previous;
  try {
    const data=await sharp(asset.data,{limitInputPixels:MAX_PIXELS,failOn:"error",sequentialRead:true}).rotate()
      .resize(maxDimension,maxDimension,{fit:"inside",withoutEnlargement:true})
      .webp({lossless:true}).toBuffer();
    return {data,mimeType:"image/webp",bytes:data.length};
  }finally{release();}
}
