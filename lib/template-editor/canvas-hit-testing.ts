import {elementEffectiveOpacity} from "./group-opacity";
import type {CanvasElement,CanvasScene,ShapeElement} from "./model";
import {isElementHidden} from "./commands";
import {groupMemberIds} from "./layer-tree";
import {shapeContainsPoint,shapeViewBox} from "./photo-frames";
import {shapePath} from "./appearance";
import {flattenVectorPath} from "./vector";
import {parseColor} from "./color-utils";
import {scenePaintOrder} from "./paint-order";

type Point={x:number;y:number};
export function elementLocalPoint(element:CanvasElement,point:Point):Point {
  const angle=-element.rotation*Math.PI/180,dx=point.x-element.x-element.width/2,dy=point.y-element.y-element.height/2;
  return {x:dx*Math.cos(angle)-dy*Math.sin(angle)+element.width/2,y:dx*Math.sin(angle)+dy*Math.cos(angle)+element.height/2};
}
const painted=(color:string)=>Boolean(parseColor(color)?.alpha);
const segmentDistance=(point:Point,a:number[],b:number[])=>{const dx=b[0]-a[0],dy=b[1]-a[1],ratio=Math.max(0,Math.min(1,((point.x-a[0])*dx+(point.y-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(point.x-a[0]-ratio*dx,point.y-a[1]-ratio*dy);};
function shapeRings(shape:ShapeElement):number[][][] {
  if(shape.shape==="rectangle"){
    const radius=Math.max(0,Math.min(shape.radius,shape.width/2,shape.height/2));
    if(!radius)return [[[0,0],[shape.width,0],[shape.width,shape.height],[0,shape.height],[0,0]]];
    const points:number[][]=[];
    for(const [cx,cy,start] of [[shape.width-radius,radius,-90],[shape.width-radius,shape.height-radius,0],[radius,shape.height-radius,90],[radius,radius,180]])for(let step=0;step<=16;step++){const angle=(start+step*90/16)*Math.PI/180;points.push([cx+radius*Math.cos(angle),cy+radius*Math.sin(angle)]);}
    points.push(points[0]);return [points];
  }
  if(shape.shape==="ellipse")return [Array.from({length:129},(_,index)=>{const angle=index/128*Math.PI*2;return [shape.width/2+shape.width/2*Math.cos(angle),shape.height/2+shape.height/2*Math.sin(angle)];})];
  const view=shapeViewBox(shape);
  return flattenVectorPath(shapePath(shape),.05).map(ring=>ring.map(([x,y])=>[(x-view.x)/view.width*shape.width,(y-view.y)/view.height*shape.height]));
}
/** Precise filled geometry and physical strokes; transparent corners pass through. */
export function elementContainsPoint(element:CanvasElement,point:Point,padding=0):boolean {
  if(element.opacity<=0)return false;
  const clip=element.clipBounds;
  if(clip&&(point.x<clip.x||point.y<clip.y||point.x>clip.x+clip.width||point.y>clip.y+clip.height))return false;
  const local=elementLocalPoint(element,point);
  if(element.type==="text")return local.x>=0&&local.y>=0&&local.x<=element.width&&local.y<=element.height;
  if(element.type==="image"){
    const mask=element.mask??"none";
    const shape={...element,type:"shape",shape:mask==="none"?"rectangle":mask==="ellipse"?"ellipse":mask,fill:"#000",stroke:"transparent",strokeWidth:0} as ShapeElement;
    return shapeContainsPoint(shape,point);
  }
  const gradientPainted=element.gradient?.stops.some(stop=>painted(stop.color));
  if((painted(element.fill)||gradientPainted||element.imageFill)&&shapeContainsPoint(element,point))return true;
  const thin=element.width<8||element.height<8;
  if(thin&&(painted(element.fill)||gradientPainted||element.imageFill||element.strokeWidth>0&&painted(element.stroke))&&padding&&local.x>=-padding&&local.y>=-padding&&local.x<=element.width+padding&&local.y<=element.height+padding)return true;
  if(element.strokeWidth<=0||!painted(element.stroke))return false;
  const inside=shapeContainsPoint(element,point),alignment=element.strokeAlign??"center";
  if(alignment==="inside"&&!inside||alignment==="outside"&&inside)return false;
  const distance=element.strokeWidth*(alignment==="center"?.5:1)+padding;
  try{return shapeRings(element).some(ring=>ring.some((_,index)=>index>0&&segmentDistance(local,ring[index-1],ring[index])<=distance));}catch{return false;}
}
export function layersAtPoint(scene:CanvasScene,point:Point,options:{isolationGroupId?:string|null;padding?:number}={}):CanvasElement[] {
  const scope=options.isolationGroupId?new Set(groupMemberIds(scene,options.isolationGroupId)):null;
  return scenePaintOrder(scene).reverse().filter(element=>(!scope||scope.has(element.id))&&!isElementHidden(scene,element)&&elementEffectiveOpacity(scene,element)>0&&elementContainsPoint(element,point,options.padding));
}
export function cycleLayerAtPoint(layers:readonly CanvasElement[],selectedIds:readonly string[]):CanvasElement|undefined {
  const current=layers.findLastIndex(element=>selectedIds.includes(element.id));return layers[(current+1)%layers.length];
}
