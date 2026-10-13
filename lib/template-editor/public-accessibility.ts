import {formatDimensions,richTextToPlain,type DesignDocument,type DesignPage,type CanvasScene,type CanvasElement} from "./model";
import {composeScene} from "./advanced";
import {isElementHidden} from "./commands";
import {elementIntersectsCanvas} from "./canvas-geometry";
export type PageReadingItem={id:string;name:string;text:string;kind:"text"|"image";master:boolean;missingAlt:boolean};
function hasVisibleOpacity(scene:CanvasScene,element:CanvasElement) {
  if(element.opacity<=0||isElementHidden(scene,element))return false;
  const seen=new Set<string>();let groupId=element.groupId;
  while(groupId&&!seen.has(groupId)){seen.add(groupId);const group=scene.groups?.find(item=>item.id===groupId);if(!group)break;if((group as {opacity?:number}).opacity===0)return false;groupId=group.parentId;}
  return true;
}
/** Shared visual order for authoring and public assistive reading. Private names
 * help the author identify objects but publicReadingSequence never exposes them. */
export function pageReadingItems(design:DesignDocument,page:DesignPage):PageReadingItem[] {
  const scene=composeScene(design,page),size=formatDimensions(design),height=360*size.height/size.width,preferred=page.readingOrder??[];
  const sourceId=(element:CanvasElement)=>element.master&&element.id.startsWith("master-")?element.id.slice(7):element.id;
  return scene.elements.filter(element=>hasVisibleOpacity(scene,element)&&elementIntersectsCanvas(element,360,height)&&(element.type==="text"||element.type==="image"||Boolean(element.imageFill))).sort((a,b)=>{
    const aa=preferred.indexOf(sourceId(a)),bb=preferred.indexOf(sourceId(b));
    if(aa>=0||bb>=0)return (aa<0?Infinity:aa)-(bb<0?Infinity:bb);
    return a.y-b.y||a.x-b.x;
  }).flatMap(element=>{
    const text=element.type==="text"?(element.richText?richTextToPlain(element.richText):element.text):element.type==="image"?element.publicAlt??"":element.imageFill?.publicAlt??"";
    if(element.type==="text"&&!text.trim())return [];
    return [{id:sourceId(element),name:element.name,text,kind:element.type==="text"?"text" as const:"image" as const,master:Boolean(element.master),missingAlt:element.type!=="text"&&!text.trim()}];
  });
}
export function publicReadingSequence(design:DesignDocument,page:DesignPage):{id:string;text:string}[] {
  return pageReadingItems(design,page).filter(item=>item.text.trim()).map(({id,text})=>({id,text}));
}
