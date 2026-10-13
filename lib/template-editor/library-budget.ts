export const MAX_SAVE_LIBRARY_BYTES=12*1024*1024-64*1024;
export type LibraryBudgetResult={ok:true;bytes:number}|{ok:false;bytes:number|null;error:string};
type Cost={chars:number;bytes:number;assets:Set<string>};
const memo=new WeakMap<object,Cost>(),assetBytes=new Map<string,number>(),encoder=new TextEncoder();
const encoded=(value:string)=>encoder.encode(value).byteLength;
const placeholder=JSON.stringify('engine-asset:'+'0'.repeat(64));
function cost(value:unknown,field=''):Cost{
 if(value===undefined||typeof value==='function'||typeof value==='symbol')return{chars:4,bytes:4,assets:new Set()};
 if(!value||typeof value!=='object'){
  const json=JSON.stringify(value);if(json===undefined)throw Error('Missing value');
  const asset=typeof value==='string'&&['src','url','previewSrc'].includes(field)&&value.startsWith('data:image/');
  return{chars:json.length,bytes:asset?placeholder.length:encoded(json),assets:new Set(asset?[value as string]:[])};
 }
 const cached=Object.isFrozen(value)?memo.get(value):undefined;if(cached)return cached;
 const array=Array.isArray(value),entries=array?value.map((child,index)=>[String(index),child] as const):Object.entries(value).filter(([,child])=>child!==undefined&&typeof child!=='function'&&typeof child!=='symbol');
 const result:Cost={chars:2,bytes:2,assets:new Set()};
 entries.forEach(([key,child],index)=>{const nested=cost(child,array?'':key),prefix=array?'':JSON.stringify(key)+':';result.chars+=prefix.length+nested.chars+(index?1:0);result.bytes+=encoded(prefix)+nested.bytes+(index?1:0);nested.assets.forEach(asset=>result.assets.add(asset));});
 if(Object.isFrozen(value))memo.set(value,result);return result;
}
/** Frozen parser entities retain their exact costs across keystrokes. Images
 * are counted once across the entire workspace, including original previews. */
export function checkLibrarySaveBudget(library:unknown):LibraryBudgetResult{
 try{
  if(library===undefined||typeof library==='function'||typeof library==='symbol')throw Error('Missing serializable workspace');
  const value=cost(library);
  if(value.chars>30*1024*1024)return{ok:false,bytes:null,error:'This workspace exceeds the 30 MB in-memory document limit and was not applied. Remove old items or large images.'};
  let bytes=value.bytes;
  if(value.assets.size){bytes+=encoded(JSON.stringify({library:null,assets:{}}))-4;let index=0;for(const asset of value.assets){let size=assetBytes.get(asset);if(size===undefined){size=encoded(JSON.stringify(asset));if(assetBytes.size>=1000)assetBytes.clear();assetBytes.set(asset,size);}bytes+=66+1+size+(index++?1:0);}}
  return bytes>MAX_SAVE_LIBRARY_BYTES?{ok:false,bytes,error:'This change exceeds the 12 MB library limit and was not applied. Remove unused assets or designs, or use smaller images.'}:{ok:true,bytes};
 }catch{return{ok:false,bytes:null,error:'This change could not be saved and was not applied. Try again or export a backup before reloading.'};}
}
