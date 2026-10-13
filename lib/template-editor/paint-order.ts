import type {CanvasElement,CanvasGroup,CanvasScene} from "./model";
import {isElementHidden} from "./commands";

export type ScenePaintLayer = {kind:"element";element:CanvasElement}|{kind:"group";group:CanvasGroup;children:ScenePaintLayer[]};

/** Back-to-front paint order, including the atomic containers used for group
 * opacity. Ordinary groups retain their existing flat stacking behavior. */
export function scenePaintTree(scene:CanvasScene):ScenePaintLayer[] {
  const elements=scene.elements.filter(element=>!isElementHidden(scene,element));
  if(!scene.groups?.some(group=>group.opacity!==undefined))return elements.map(element=>({kind:"element",element}));
  const groups=new Map(scene.groups.map(group=>[group.id,group]));
  const ranks=new Map<string,number>(),elementRanks=new Map(scene.elements.map((element,index)=>[element.id,index]));
  scene.elements.forEach((element,index)=>{
    let parent=element.groupId;const seen=new Set<string>();
    while(parent&&!seen.has(parent)){
      seen.add(parent);if(!ranks.has(parent))ranks.set(parent,index);parent=groups.get(parent)?.parentId;
    }
  });
  const visiting=new Set<string>();
  function children(parent?:string):ScenePaintLayer[] {
    const entries=[
      ...elements.filter(element=>element.groupId===parent||!parent&&element.groupId&&!groups.has(element.groupId)).map(element=>({rank:elementRanks.get(element.id)!,element})),
      ...scene.groups!.filter(group=>group.parentId===parent&&!visiting.has(group.id)).map(group=>({rank:ranks.get(group.id)??-1,group})),
    ].sort((a,b)=>a.rank-b.rank);
    return entries.map(entry=>{
      if("element"in entry)return {kind:"element",element:entry.element};
      visiting.add(entry.group.id);const layers=children(entry.group.id);visiting.delete(entry.group.id);
      return {kind:"group",group:entry.group,children:layers};
    });
  }
  return children();
}

/** Resolve pointer targets in exactly the same order as rendered artwork. */
export function scenePaintOrder(scene:CanvasScene):CanvasElement[] {
  const flatten=(layers:ScenePaintLayer[]):CanvasElement[]=>layers.flatMap(layer=>layer.kind==="element"?[layer.element]:flatten(layer.children));
  return flatten(scenePaintTree(scene));
}
