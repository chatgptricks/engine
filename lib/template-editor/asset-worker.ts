import {packAssets,createLibraryPatch} from './library-sync';
import {serializePatchPayload} from './patch-payload';
import type {EditorLibrary} from './model';
type Request={operation:'pack';value:unknown;known:string[]}|{operation:'save';base:EditorLibrary;next:EditorLibrary;known:string[];metadata:{revision:string|null;operationId:string;expectedScope:string;clientSchema:number}};
self.onmessage=async(event:MessageEvent<Request>)=>{
 try{
  const request=event.data;
  if(request.operation==='save'){const packed=await packAssets(await createLibraryPatch(request.base,request.next),new Set(request.known));self.postMessage({result:{...packed,body:serializePatchPayload({...request.metadata,patch:packed.value,assets:packed.assets})}});}
  else self.postMessage({result:await packAssets(request.value,new Set(request.known))});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:'Asset processing failed.'});}
};
export {};
