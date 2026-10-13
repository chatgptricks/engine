export type PreparedRasterAsset={src:string;previewSrc:string;width:number;height:number;bytes:number};
/** Originals are authenticated assets; the document contains only a small preview. */
export async function prepareRasterAsset(file:File):Promise<PreparedRasterAsset> {
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG, or WebP image.");
  if(!file.size || file.size>15*1024*1024) throw new Error("Choose an image between 1 byte and 15 MB.");
  let response:Response;
  try {response=await fetch("/api/template-editor/assets",{method:"POST",headers:{"Content-Type":file.type,"X-Image-Name":encodeURIComponent(file.name.slice(0,200))},body:file});}
  catch {throw new Error("Connect to upload this image and preserve its original quality. Your design has not changed.");}
  const result=await response.json().catch(()=>({error:"The image upload could not be completed."}));
  if(!response.ok) throw new Error(result.error??"The image upload could not be completed.");
  if(!/^\/api\/template-editor\/assets\/[a-f0-9]{64}$/.test(result.src) || !/^data:image\/webp;base64,/.test(result.previewSrc) || !(result.width>0) || !(result.height>0)) throw new Error("The image upload returned invalid data.");
  return result;
}
