import {composeScene} from './advanced';
import {formatDimensions,type CanvasScene,type DesignDocument,type ShapeImageFill} from './model';
import {frameScene} from './export-scene';
import {pdfGeometry,photoRasterDimension,type PdfOptions} from './pdf-options';
export const MAX_DECODED_EXPORT_PIXELS=64_000_000;
type Photo=Pick<ShapeImageFill,'src'|'intrinsicWidth'|'intrinsicHeight'|'cropScale'> & {fit:string;width:number;height:number};
/** Read raster headers without decoding their pixels. Old embedded imports
 * need the same memory bound as owner-scoped originals. */
function embeddedDimensions(src:string):{width:number;height:number}|null{
 if(!src.startsWith('data:')||!src.includes(';base64,'))return null;
 try{
  const encoded=src.slice(src.indexOf(',')+1,src.indexOf(',')+1+87380),binary=atob(encoded.slice(0,encoded.length-encoded.length%4)),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0)),view=new DataView(bytes.buffer);
  if(src.startsWith('data:image/png')&&bytes.length>=24)return{width:view.getUint32(16),height:view.getUint32(20)};
  if(src.startsWith('data:image/gif')&&bytes.length>=10)return{width:view.getUint16(6,true),height:view.getUint16(8,true)};
  if(src.startsWith('data:image/webp')&&bytes.length>=30){const kind=binary.slice(12,16);if(kind==='VP8X')return{width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)};if(kind==='VP8L'){const bits=view.getUint32(21,true);return{width:1+(bits&16383),height:1+((bits>>>14)&16383)};}if(kind==='VP8 ')return{width:view.getUint16(26,true)&16383,height:view.getUint16(28,true)&16383};}
  if(src.startsWith('data:image/jpeg')){for(let offset=2;offset+9<bytes.length;){if(bytes[offset]!==255){offset++;continue;}const marker=bytes[offset+1],length=view.getUint16(offset+2);if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return{width:view.getUint16(offset+7),height:view.getUint16(offset+5)};if(length<2)break;offset+=2+length;}}
  if(src.startsWith('data:image/avif')){const offset=binary.indexOf('ispe');if(offset>=0&&offset+16<=bytes.length)return{width:view.getUint32(offset+8),height:view.getUint32(offset+12)};}
 }catch{/* Invalid bytes are reported by the image-loading preflight. */}
 return null;
}
export function prepareExportScene(scene:CanvasScene,scale:number,extraPhotos:Photo[]=[]):{scene:CanvasScene;sources:Map<string,string>;pixels:number}{
 const photos:Photo[]=[...extraPhotos];
 for(const element of scene.elements){
  if(element.type==='image')photos.push({...element,fit:element.fit});
  if(element.type==='shape'&&element.imageFill)photos.push({...element.imageFill,width:element.width,height:element.height,fit:element.imageFill.objectFit});
  if(element.type==='text'){
   const used=new Set([...(element.richText??'').matchAll(/data-texture-id="([^"]+)"/g)].map(match=>match[1]));
   for(const photo of [...(element.textureFill?[element.textureFill]:[]),...(element.wordTextures??[]).filter(photo=>used.has(photo.id))])photos.push({...photo,width:element.width,height:element.height,fit:photo.objectFit});
  }
 }
 const selected=new Map<string,{target:number;width:number;height:number;private:boolean}>();
 for(const photo of photos){
  if(photo.src.startsWith('/template-editor/')||photo.src.startsWith('data:image/svg+xml'))continue;
  const measured=embeddedDimensions(photo.src),width=measured?.width??photo.intrinsicWidth,height=measured?.height??photo.intrinsicHeight;
  if(!width||!height)throw Error('An image has no confirmed dimensions. Reload or replace it before downloading.');
  const privateAsset=/^\/api\/template-editor\/assets\/[a-f0-9]{64}$/.test(photo.src),target=privateAsset?Math.min(8192,photoRasterDimension(photo.width,photo.height,width,height,photo.fit,photo.cropScale??1,scale)):Math.max(width,height),current=selected.get(photo.src);
  if(!current||target>current.target)selected.set(photo.src,{target,width,height,private:privateAsset});
 }
 let pixels=0;const sources=new Map<string,string>();
 for(const [src,item]of selected){const maximum=Math.max(item.width,item.height);pixels+=Math.min(item.width,Math.ceil(item.width*item.target/maximum))*Math.min(item.height,Math.ceil(item.height*item.target/maximum));if(item.private)sources.set(src,`${src}?maxDimension=${item.target}`);}
 if(pixels>MAX_DECODED_EXPORT_PIXELS)throw Error('This page exceeds the 64-megapixel image memory budget. Choose a lower download resolution or PDF DPI, or replace large embedded images.');
 const replace=(photo:ShapeImageFill)=>({...photo,src:sources.get(photo.src)??photo.src});
 return{pixels,sources,scene:{...scene,elements:scene.elements.map(element=>element.type==='image'?{...element,src:sources.get(element.src)??element.src}:element.type==='shape'&&element.imageFill?{...element,imageFill:replace(element.imageFill)}:element.type==='text'?{...element,...(element.textureFill?{textureFill:replace(element.textureFill)}:{}),...(element.wordTextures?{wordTextures:element.wordTextures.map(photo=>({...replace(photo),id:photo.id}))}:{})}:element)}};
}
export function assertDesignExportBudget(design:DesignDocument,options:PdfOptions&{format?:string;scale?:number},pageIds:string[]):void{
 const size=formatDimensions(design),geometry=options.format==='pdf'?pdfGeometry(size.width,size.height,options):null,scale=geometry?.rasterScale??options.scale??size.width/360,bleed=geometry?geometry.bleed/geometry.scale:0,height=360*size.height/size.width;
 for(const page of design.pages.filter(page=>pageIds.includes(page.id))){
  const scene=composeScene(design,page),shifted={...scene,elements:scene.elements.map(element=>({...element,x:element.x+bleed,y:element.y+bleed,...(element.clipBounds?{clipBounds:{...element.clipBounds,x:element.clipBounds.x+bleed,y:element.clipBounds.y+bleed}}:{})}))},painted=frameScene(shifted,360+2*bleed,height+2*bleed);
  const gallery=!page.canvas&&page.style.template==='masonry'?design.pages.map(item=>({src:item.image.url,intrinsicWidth:item.image.width,intrinsicHeight:item.image.height,width:360,height,fit:'cover'})):[];
  prepareExportScene(painted,scale,gallery);
 }
}
