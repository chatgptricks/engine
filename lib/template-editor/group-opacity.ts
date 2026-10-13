import type {CanvasScene,CanvasElement} from "./model";
export function elementEffectiveOpacity(scene:CanvasScene,element:CanvasElement):number {
  const groups=new Map(scene.groups?.map(group=>[group.id,group])??[]),seen=new Set<string>();
  let result=element.opacity,parent=element.groupId;
  while(parent&&!seen.has(parent)){seen.add(parent);const group=groups.get(parent);if(!group)break;result*=group.opacity??1;parent=group.parentId;}
  return result;
}
