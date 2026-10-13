import {packAssets,createLibraryPatch,type LibraryPatch} from './library-sync';
import type {EditorLibrary} from './model';
import {serializePatchPayload} from './patch-payload';
type SaveMetadata={revision:string|null;operationId:string;expectedScope:string;clientSchema:number};
async function workerTask<T>(input:unknown):Promise<T>{
 const worker=new Worker(new URL('./asset-worker.ts',import.meta.url),{type:'module'});
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{worker.terminate();reject(Error('Image processing timed out. Retry with fewer or smaller images.'));},30000);const finish=()=>{clearTimeout(timer);worker.terminate();};worker.onmessage=event=>{finish();if(event.data.error)reject(Error(event.data.error));else resolve(event.data.result);};worker.onerror=()=>{finish();reject(Error('Image processing could not start. Retry or export a backup.'));};try{worker.postMessage(input);}catch(error){finish();reject(error);}});
}
/** Hash and serialize media off the input thread; workers have a bounded lifetime. */
export async function packAssetsOffThread<T>(value:T,known=new Set<string>()):Promise<{value:T;assets:Record<string,string>}>{
 if(typeof Worker==='undefined')return packAssets(value,known);
 return workerTask({operation:'pack',value,known:[...known]});
}
export async function prepareSaveOffThread(base:EditorLibrary,next:EditorLibrary,known:Set<string>,metadata:SaveMetadata):Promise<{value:LibraryPatch;assets:Record<string,string>;body:string}>{
 if(typeof Worker!=='undefined')return workerTask({operation:'save',base,next,known:[...known],metadata});
 const packed=await packAssets(await createLibraryPatch(base,next),known);return{...packed,body:serializePatchPayload({...metadata,patch:packed.value,assets:packed.assets})};
}
