import {composeScene} from './advanced';
import {formatDimensions,type DesignDocument,type CanvasElement} from './model';
import {frameScene} from './export-scene';
import {pdfGeometry,type PdfOptions} from './pdf-options';
/** Resolve older URL-based artwork without decoding unbounded images in the browser. */
export async function prepareExportDimensions(design:DesignDocument,pageIds:string[],options:PdfOptions&{format?:string}={},signal?:AbortSignal):Promise<DesignDocument>{
 const size=formatDimensions(design),height=360*size.height/size.width,geometry=options.format==='pdf'?pdfGeometry(size.width,size.height,options):null,bleed=geometry?geometry.bleed/geometry.scale:0;
 const missing=new Set<string>();
 const inspect=(photo:{src:string;intrinsicWidth?:number;intrinsicHeight?:number})=>{if((!photo.intrinsicWidth||!photo.intrinsicHeight)&&!photo.src.startsWith('data:')&&!photo.src.startsWith('/template-editor/'))missing.add(photo.src);};
 const elementPhotos=(element:CanvasElement)=>{
  if(element.type==='image')inspect(element);
  else if(element.type==='shape'&&element.imageFill)inspect(element.imageFill);
  else if(element.type==='text'){
   if(element.textureFill)inspect(element.textureFill);
   const used=new Set([...(element.richText??'').matchAll(/data-texture-id="([^"]+)"/g)].map(match=>match[1]));
   for(const photo of element.wordTextures??[])if(used.has(photo.id))inspect(photo);
  }
 };
 for(const page of design.pages.filter(page=>pageIds.includes(page.id))){
  const scene=composeScene(design,page),shifted={...scene,elements:scene.elements.map(element=>({...element,x:element.x+bleed,y:element.y+bleed,...(element.clipBounds?{clipBounds:{...element.clipBounds,x:element.clipBounds.x+bleed,y:element.clipBounds.y+bleed}}:{})}))};
  frameScene(shifted,360+2*bleed,height+2*bleed).elements.forEach(elementPhotos);
 }
 if(!missing.size)return design;
 const dimensions=new Map<string,{width:number;height:number}>();
 for(const src of missing){
  signal?.throwIfAborted();const response=await fetch('/api/template-editor/assets/metadata',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({src}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)}),value=await response.json();
  if(!response.ok)throw Error(value.error??'Image dimensions could not be confirmed. Retry or replace the image.');
  if(!Number.isInteger(value.width)||!Number.isInteger(value.height)||value.width<1||value.height<1||value.width*value.height>100_000_000)throw Error('This image exceeds the 100-megapixel source limit.');
  dimensions.set(src,value);
 }
 function visit(value:unknown):unknown{
  if(Array.isArray(value))return value.map(visit);
  if(value&&typeof value==='object'){
   const original=value as Record<string,unknown>,copy=Object.fromEntries(Object.entries(original).map(([key,child])=>[key,visit(child)]));
   const measured=typeof original.src==='string'?dimensions.get(original.src):undefined;
   if(measured){copy.intrinsicWidth=measured.width;copy.intrinsicHeight=measured.height;}
   return copy;
  }
  return value;
 }
 return visit(design) as DesignDocument;
}
