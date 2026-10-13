type Result={value:unknown;conflicts:string[]};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
export function mergeOrder(base:string[],local:string[],remote:string[],kept:Set<string>):{ids:string[];conflict:boolean}{
 const originals=new Map(base.map((id,index)=>[id,index])),left=new Map(local.map((id,index)=>[id,index])),right=new Map(remote.map((id,index)=>[id,index]));
 const ids=[...new Set([...remote,...local])].filter(id=>kept.has(id)),edges=new Map(ids.map(id=>[id,new Set<string>()]));
 const edge=(a:string,b:string)=>{if(a!==b&&kept.has(a)&&kept.has(b))edges.get(a)!.add(b);};
 const old=base.filter(id=>kept.has(id));
 for(let i=0;i<old.length;i++)for(let j=i+1;j<old.length;j++){
  const a=old[i],b=old[j],localReverse=left.has(a)&&left.has(b)&&left.get(a)!>left.get(b)!,remoteReverse=right.has(a)&&right.has(b)&&right.get(a)!>right.get(b)!;
  if(localReverse||remoteReverse)edge(b,a);else edge(a,b);
 }
 // New runs keep their nearest surviving predecessor/successor anchors. Old
 // pairwise changes above take precedence over an unchanged side's ordering.
 for(const values of [local,remote]){const order=values.filter(id=>kept.has(id));for(let i=1;i<order.length;i++)if(!originals.has(order[i-1])||!originals.has(order[i]))edge(order[i-1],order[i]);}
 const indegree=new Map(ids.map(id=>[id,0]));edges.forEach(values=>values.forEach(id=>indegree.set(id,indegree.get(id)!+1)));
 const output:string[]=[];while(output.length<ids.length){const available=ids.filter(id=>!output.includes(id)&&indegree.get(id)===0).sort((a,b)=>(originals.get(a)??Infinity)-(originals.get(b)??Infinity)||a.localeCompare(b));if(!available.length)return{ids,conflict:true};const id=available[0];output.push(id);edges.get(id)!.forEach(next=>indegree.set(next,indegree.get(next)!-1));}
 return{ids:output,conflict:false};
}
/** Rebase immutable fields and ID-addressed pages/layers. Competing artwork
 * stays an explicit conflict rather than silently choosing the last writer. */
export function mergeEntity(base:unknown,local:unknown,remote:unknown,path=''):Result{
 if(equal(local,base)||equal(local,remote))return{value:remote,conflicts:[]};
 if(equal(remote,base))return{value:local,conflicts:[]};
 if(path.endsWith('.updatedAt')&&typeof local==='string'&&typeof remote==='string')return{value:Date.parse(local)>Date.parse(remote)?local:remote,conflicts:[]};
 if(record(base)&&record(local)&&record(remote)){
  const value:Record<string,unknown>={},conflicts:string[]=[];
  for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
   const merged=mergeEntity(base[key],local[key],remote[key],`${path}.${key}`);if(merged.value!==undefined)value[key]=merged.value;conflicts.push(...merged.conflicts);
  }return{value,conflicts};
 }
 if(Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)&&[...base,...local,...remote].every(item=>record(item)&&typeof item.id==='string')){
  const maps=[base,local,remote].map(items=>new Map(items.map(item=>[item.id,item]))),values=new Map<string,unknown>(),conflicts:string[]=[];
  for(const id of new Set([...maps[0].keys(),...maps[1].keys(),...maps[2].keys()])){const merged=mergeEntity(maps[0].get(id),maps[1].get(id),maps[2].get(id),`${path}[${id}]`);if(merged.value!==undefined)values.set(id,merged.value);conflicts.push(...merged.conflicts);}
  const order=mergeOrder(base.map(item=>item.id),local.map(item=>item.id),remote.map(item=>item.id),new Set(values.keys()));if(order.conflict)conflicts.push(`${path}.$order`);
  return{value:order.ids.map(id=>values.get(id)),conflicts};
 }
 return{value:remote,conflicts:[path||'$']};
}
