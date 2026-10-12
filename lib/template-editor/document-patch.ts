import type { DesignDocument } from "./model";
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keyed=(value:unknown):value is {id:string}[]=>Array.isArray(value)&&value.every(item=>record(item)&&typeof item.id==='string');

function merge(base:unknown,next:unknown,current:unknown):unknown{
  if(same(base,next))return structuredClone(current);
  if(same(base,current))return structuredClone(next);
  if(keyed(base)&&keyed(next)&&keyed(current)){
    const original=new Map(base.map(item=>[item.id,item])),latest=new Map(current.map(item=>[item.id,item]));
    const updated=next.map(item=>merge(original.get(item.id),item,latest.get(item.id)??item));
    return [...updated,...current.filter(item=>!original.has(item.id)&&!next.some(n=>n.id===item.id)).map(item=>structuredClone(item))];
  }
  if(record(base)&&record(next)&&record(current)){
    const result:Record<string,unknown>={};
    for(const key of new Set([...Object.keys(base),...Object.keys(next),...Object.keys(current)])){
      if(['__proto__','constructor','prototype'].includes(key))continue;
      const value=merge(base[key],next[key],current[key]);if(value!==undefined)result[key]=value;
    }
    return result;
  }
  return structuredClone(next);
}

/** Apply only the fields a dialog changed, retaining edits made while its request was running. */
export function applyDesignPatch(base:DesignDocument,next:DesignDocument,current:DesignDocument):DesignDocument{
  return {...merge(base,next,current) as DesignDocument,id:current.id,createdAt:current.createdAt};
}
