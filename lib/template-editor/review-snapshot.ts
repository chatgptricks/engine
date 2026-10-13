import {formatDimensions, sceneForPage, type CanvasScene, type CanvasElement, type DesignDocument} from "./model";
import {elementIntersectsCanvas} from "./canvas-geometry";
const EMPTY_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xV4AAAAASUVORK5CYII=";
function hidden(scene: CanvasScene, element: CanvasElement): boolean {
  if (element.hidden || element.opacity === 0) return true;
  let id = element.groupId; const seen = new Set<string>();
  while (id && !seen.has(id)) {seen.add(id); const group = scene.groups?.find(item => item.id === id) as {hidden?:boolean;opacity?:number;parentId?:string}|undefined; if (group?.hidden||group?.opacity===0) return true; id = group?.parentId;}
  return false;
}
function painted(element: CanvasElement, width: number, height: number): boolean {
  const clip = (element as CanvasElement & {clipBounds?: {x:number;y:number;width:number;height:number}}).clipBounds;
  if (!clip) return elementIntersectsCanvas(element,width,height);
  const x = Math.max(0,clip.x), y = Math.max(0,clip.y);
  const right = Math.min(width,clip.x+clip.width), bottom = Math.min(height,clip.y+clip.height);
  return elementIntersectsCanvas({...element,x:element.x-x,y:element.y-y},right-x,bottom-y);
}
function publicPhoto(value: unknown, includeId = false): Record<string,unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const photo = value as Record<string,unknown>;
  const fields = [...(includeId ? ["id"] : []),"src","publicAlt","objectFit","cropX","cropY","cropScale","flipX","flipY","intrinsicWidth","intrinsicHeight"];
  return Object.fromEntries(fields.filter(key => photo[key] !== undefined).map(key => [key,structuredClone(photo[key])]));
}
function publicScene(scene: CanvasScene, width: number, height: number): CanvasScene {
  const paint = ["gradient","shadow","blur","blendMode","strokeDash"];
  const text = ["text","font","fontSize","fontWeight","italic","underline","color","align","lineHeight","letterSpacing","richText","textMode","autoFitFontSize","autoFitMinFontSize","autoFitMaxFontSize","verticalAlign","padding","paragraphSpacing","strikethrough","listStyle"];
  const image = ["publicAlt","src","fit","cropX","cropY","radius","cropScale","flipX","flipY","mask"];
  const shape = ["shape","fill","stroke","strokeWidth","strokeAlign","radius","sides","starPoints","innerRadius","path","viewBox","fillRule"];
  const allowedGroups=new Set<string>();
  for(const element of scene.elements.filter(element=>!hidden(scene,element)&&painted(element,width,height))){let id=element.groupId;while(id&&!allowedGroups.has(id)){allowedGroups.add(id);id=scene.groups?.find(group=>group.id===id)?.parentId;}}
  const groups=scene.groups?.filter(group=>allowedGroups.has(group.id)).map((group,index)=>({id:group.id,name:`Group ${index+1}`,parentId:group.parentId,opacity:(group as typeof group&{opacity?:number}).opacity,locked:false}));
  return {background: scene.background,...(groups?.length?{groups}:{}), elements: scene.elements.filter(element => !hidden(scene,element) && painted(element,width,height)).map((element,index) => {
    const data = element as unknown as Record<string, unknown>;
    const fields = ["id","type","x","y","width","height","rotation","opacity","groupId","clipBounds",...paint,...(element.type === "text" ? text : element.type === "image" ? image : shape)];
    const imageFill = element.type === "shape" ? publicPhoto(data.imageFill) : undefined;
    const textureFill = element.type === "text" ? publicPhoto(data.textureFill) : undefined;
    const textureIds = element.type === "text" ? new Set([...((element.richText ?? "").matchAll(/data-texture-id="([^"]+)"/g))].map(match => match[1])) : new Set<string>();
    const wordTextures = element.type === "text" && Array.isArray(data.wordTextures) ? data.wordTextures.filter(photo => photo && typeof photo === "object" && textureIds.has(String(photo.id))).map(photo => publicPhoto(photo,true)) : [];
    return {...Object.fromEntries(fields.filter(key => data[key] !== undefined).map(key => [key,structuredClone(data[key])])), name: `${element.type} ${index + 1}`, locked: false, ...(imageFill ? {imageFill} : {}), ...(textureFill ? {textureFill} : {}), ...(wordTextures.length ? {wordTextures} : {})} as CanvasElement;
  })};
}
/** Publish only painted artwork, never editor notes, provenance or hidden assets. */
export function prepareReviewSnapshot(source: DesignDocument): DesignDocument {
  const dimensions = formatDimensions(source), width = 360, height = width * dimensions.height / dimensions.width, now = new Date().toISOString();
  const pages = source.pages.map(page => {
    const originalImage = {id:page.image.id,url:page.image.url,width:page.image.width,height:page.image.height,source:"upload" as const,kind:"atmospheric" as const,directive:"",rightsNote:"",cosmosManual:false,mediaType:"image" as const};
    // Legacy pages are baked into editable artwork before metadata is removed.
    // Existing scene text, including intentionally-visible credits, stays intact.
    const canvas = source.continuousCanvas ? undefined : publicScene(page.canvas ?? sceneForPage({...page,image:originalImage},source.format),width,height);
    return {id:page.id,...((page as typeof page&{publicDescription?:string}).publicDescription?{publicDescription:(page as typeof page&{publicDescription?:string}).publicDescription}:{}),...((page as typeof page&{readingOrder?:string[]}).readingOrder?{readingOrder:(page as typeof page&{readingOrder?:string[]}).readingOrder}:{}),image:{...originalImage,url:EMPTY_IMAGE,width:1,height:1},style:{template:"plain" as const},...(page.useMaster === false ? {useMaster:false} : {}),...(canvas ? {canvas} : {})};
  });
  return {id:source.id,name:source.name,templateId:"review-snapshot",format:source.format,pages,caption:source.caption,createdAt:now,updatedAt:now,
    ...(source.customSize ? {customSize:{...source.customSize}} : {}),
    ...(source.continuousCanvas ? {continuousCanvas:publicScene(source.continuousCanvas,width*source.pages.length,height)} : {}),
    ...(source.masterScene && source.pages.some(page => page.useMaster !== false) ? {masterScene:publicScene(source.masterScene,width,height)} : {})};
}
