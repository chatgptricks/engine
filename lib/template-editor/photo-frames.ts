import type { CanvasElement, CanvasScene, ImageElement, ShapeElement, ShapeImageFill } from "./model";
import { canEditElement, isElementHidden } from "./commands";
import { groupMemberIds } from "./layer-tree";
import { shapePath } from "./appearance";
import { flattenVectorPath } from "./vector";

export type PhotoContent = ShapeImageFill & { fit: "cover" | "contain" };
export function photoContent(element: CanvasElement): PhotoContent | null {
  if (element.type === "shape") return element.imageFill ? { ...element.imageFill, fit: element.imageFill.objectFit } : null;
  return element.type === "image" ? {src:element.src,previewSrc:element.previewSrc,publicAlt:element.publicAlt,directive:element.directive,rightsNote:element.rightsNote,sourceUrl:element.sourceUrl,provenance:element.provenance,objectFit:element.fit,fit:element.fit,cropX:element.cropX,cropY:element.cropY,cropScale:element.cropScale,flipX:element.flipX,flipY:element.flipY,intrinsicWidth:element.intrinsicWidth,intrinsicHeight:element.intrinsicHeight} : null;
}
export function updatePhotoContent(element: CanvasElement, patch: Partial<Pick<ImageElement,"cropX"|"cropY"|"cropScale"|"flipX"|"flipY"|"fit">>): CanvasElement {
  if(element.type === "image")return {...element,...patch};
  if(element.type !== "shape" || !element.imageFill)return element;
  const {fit}=patch;
  const crop=Object.fromEntries((["cropX","cropY","cropScale","flipX","flipY"] as const).filter(key=>patch[key]!==undefined).map(key=>[key,patch[key]]));
  return {...element,imageFill:{...element.imageFill,...crop,...(fit?{objectFit:fit}:{})}};
}
export function shapeViewBox(shape: ShapeElement): {x:number;y:number;width:number;height:number} {
  if(shape.shape === "rectangle" || shape.shape === "ellipse")return {x:0,y:0,width:shape.width,height:shape.height};
  const [x,y,width,height]=(shape.viewBox ?? "0 0 100 100").trim().split(/[ ,]+/).map(Number);
  return [x,y,width,height].every(Number.isFinite)&&width>0&&height>0 ? {x,y,width,height} : {x:0,y:0,width:100,height:100};
}
let hitContext: CanvasRenderingContext2D | null | undefined;
const polygons = new Map<string, number[][][]>();
function winding(rings:number[][][],x:number,y:number,rule: "evenodd"|"nonzero") {
  let count=0;
  for(const ring of rings)for(let i=0;i<ring.length;i++){
    const [ax,ay]=ring[i], [bx,by]=ring[(i+1)%ring.length];
    const cross=(bx-ax)*(y-ay)-(by-ay)*(x-ax);
    if(Math.abs(cross)<1e-8 && x>=Math.min(ax,bx)-1e-8&&x<=Math.max(ax,bx)+1e-8&&y>=Math.min(ay,by)-1e-8&&y<=Math.max(ay,by)+1e-8)return true;
    if(ay<=y&&by>y&&cross>0)count++;
    if(ay>y&&by<=y&&cross<0)count--;
  }
  return rule === "evenodd" ? Math.abs(count)%2===1 : count!==0;
}
/** Filled geometry, including holes, in the rotated object's local coordinates. */
export function shapeContainsPoint(shape: ShapeElement, point: {x:number;y:number}): boolean {
  const clip=shape.clipBounds;
  if(clip&&(point.x<clip.x||point.y<clip.y||point.x>clip.x+clip.width||point.y>clip.y+clip.height))return false;
  const angle=-shape.rotation*Math.PI/180, dx=point.x-shape.x-shape.width/2,dy=point.y-shape.y-shape.height/2;
  const x=dx*Math.cos(angle)-dy*Math.sin(angle)+shape.width/2,y=dx*Math.sin(angle)+dy*Math.cos(angle)+shape.height/2;
  if(x<0||y<0||x>shape.width||y>shape.height)return false;
  if(shape.shape === "ellipse")return ((x-shape.width/2)/(shape.width/2))**2+((y-shape.height/2)/(shape.height/2))**2<=1;
  if(shape.shape === "rectangle"){
    const radius=Math.max(0,Math.min(shape.radius,shape.width/2,shape.height/2));
    const cx=Math.max(radius,Math.min(shape.width-radius,x)),cy=Math.max(radius,Math.min(shape.height-radius,y));
    return (x-cx)**2+(y-cy)**2<=radius**2+1e-8;
  }
  const view=shapeViewBox(shape), px=view.x+x/shape.width*view.width,py=view.y+y/shape.height*view.height;
  const path=shapePath(shape),rule=shape.fillRule??"nonzero";
  if(typeof Path2D!=="undefined"&&typeof document!=="undefined"){
    hitContext??=document.createElement("canvas").getContext("2d");
    if(hitContext){try{return hitContext.isPointInPath(new Path2D(path),px,py,rule);}catch{return false;}}
  }
  try{
    let rings=polygons.get(path);
    if(!rings){rings=flattenVectorPath(path,.1);if(polygons.size>100)polygons.clear();polygons.set(path,rings);}
    return winding(rings,px,py,rule);
  }catch{return false;}
}
/** Frontmost visible, content-editable shape under the drop point. */
export function findPhotoFrameAtPoint(scene: CanvasScene, point:{x:number;y:number}, options:{excludedIds?:readonly string[];isolationGroupId?:string|null} = {}): ShapeElement | null {
  const excluded=new Set(options.excludedIds??[]);
  const scoped=options.isolationGroupId?new Set(groupMemberIds(scene,options.isolationGroupId)):null;
  return [...scene.elements].reverse().find((element):element is ShapeElement=>element.type==="shape"&&!excluded.has(element.id)&&(!scoped||scoped.has(element.id))&&!isElementHidden(scene,element)&&element.opacity>0&&canEditElement(scene,element,"content")&&shapeContainsPoint(element,point))??null;
}
