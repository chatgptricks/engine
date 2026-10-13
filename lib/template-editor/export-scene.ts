import type {CanvasElement,CanvasScene} from './model';
import {elementVisualBounds,elementIntersectsCanvas} from './canvas-geometry';
import {isElementHidden} from './commands';
export function contributesToFrame(scene:CanvasScene,element:CanvasElement,width:number,height:number):boolean{
 if(isElementHidden(scene,element)||element.opacity===0)return false;
 let groupId=element.groupId;const seen=new Set<string>();while(groupId&&!seen.has(groupId)){seen.add(groupId);const group=scene.groups?.find(item=>item.id===groupId) as {parentId?:string;opacity?:number}|undefined;if(group?.opacity===0)return false;groupId=group?.parentId;}
 if(!element.shadow&&!element.blur)return elementIntersectsCanvas(element,width,height);
 const box=elementVisualBounds({...element,clipBounds:undefined}),shadow=element.shadow,padding=Math.abs(shadow?.spread??0)+(shadow?.blur??0)*3+(element.blur??0)*3;
 let left=box.x-padding+Math.min(0,shadow?.offsetX??0),top=box.y-padding+Math.min(0,shadow?.offsetY??0),right=box.x+box.width+padding+Math.max(0,shadow?.offsetX??0),bottom=box.y+box.height+padding+Math.max(0,shadow?.offsetY??0);
 if(element.clipBounds){const clip=element.clipBounds;left=Math.max(left,clip.x);top=Math.max(top,clip.y);right=Math.min(right,clip.x+clip.width);bottom=Math.min(bottom,clip.y+clip.height);}
 return right>Math.max(0,left)&&bottom>Math.max(0,top)&&left<width&&top<height;
}
export function frameScene(scene:CanvasScene,width:number,height:number):CanvasScene{return{...scene,elements:scene.elements.filter(element=>contributesToFrame(scene,element,width,height)).map(element=>element.type==='shape'&&element.imageFill&&!elementIntersectsCanvas({...element,strokeWidth:0},width,height)?{...element,imageFill:undefined}:element)};}
