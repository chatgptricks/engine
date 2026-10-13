import {parseLibrary,type EditorLibrary} from './model';
const frozen=new WeakSet<object>();
export function freezeValidated<T>(value:T):T{if(value&&typeof value==='object'&&!frozen.has(value)){Object.values(value).forEach(freezeValidated);Object.freeze(value);frozen.add(value);}return value;}
/** Unchanged frozen entities are trusted parser output. Validate only changed
 * entities while checking workspace counts, unique IDs and active-kit globally. */
export function validateLibraryMutation(previous:EditorLibrary,next:EditorLibrary):EditorLibrary|null{
 freezeValidated(previous);
 if(!next||typeof next!=='object')return null;
 const fields=['designs','templates','brandKits','folders'] as const,limits={designs:150,templates:80,brandKits:20,folders:80};
 const slim={...next};
 const unchanged=new Map<string,Map<string,unknown>>();
 for(const field of fields){const values=next[field]??[],old=new Map((previous[field]??[]).map(value=>[value.id,value]));if(!Array.isArray(values)||values.length>limits[field]||new Set(values.map(value=>value?.id)).size!==values.length)return null;unchanged.set(field,old);(slim as unknown as Record<string,unknown>)[field]=values.filter(value=>old.get(value.id)!==value);}
 const active=next.brandKits.find(kit=>kit.id===next.activeBrandKitId)??next.brandKits[0];if(!active)return null;
 if(!slim.brandKits.some(kit=>kit.id===active.id))slim.brandKits=[active,...slim.brandKits];
 const parsed=parseLibrary(slim);if(!parsed)return null;
 const result={...parsed};
 for(const field of fields){const parsedById=new Map((parsed[field]??[]).map(value=>[value.id,value])),old=unchanged.get(field)!;(result as unknown as Record<string,unknown>)[field]=(next[field]??[]).map(value=>old.get(value.id)===value?value:parsedById.get(value.id));}
 if(next.folders===undefined)delete result.folders;
 return freezeValidated(result);
}
