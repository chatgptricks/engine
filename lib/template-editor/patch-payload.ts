import type {LibraryPatch} from './library-sync';
/** Merge baselines are optional; keep the save itself within the protocol's
 * request budget. A stale baseline still triggers server409 and client rebase. */
export function serializePatchPayload(payload:{patch:LibraryPatch;assets:Record<string,string>;revision:string|null;operationId:string;expectedScope:string;clientSchema:number},budget=12*1024*1024-4096):string{
 let json=JSON.stringify(payload);
 if(new TextEncoder().encode(json).length>budget){
  const patch={...payload.patch,collections:Object.fromEntries(Object.entries(payload.patch.collections).map(([key,changes])=>[key,changes?.map(change=>{const copy={...change};delete copy.beforeValue;return copy;})]))};
  json=JSON.stringify({...payload,patch});
 }
 if(new TextEncoder().encode(json).length>budget)throw Error('This save exceeds the request budget. Export a backup, then reduce the workspace size.');
 return json;
}
