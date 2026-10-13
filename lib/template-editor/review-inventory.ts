import {createHash,randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {getAdminSupabase} from '@/lib/supabase/admin';
import {developmentDirectory,readDevelopmentRecord} from './development-storage';
export interface ReviewLink {id:string;documentId:string;token:string;url:string;createdAt:string;expiresAt:string;operationId:string;pending:boolean;revokedAt?:string}
interface Inventory {revision:string;links:ReviewLink[]}
const key=(owner:string)=>`template-review-index:${createHash('sha256').update(owner).digest('hex')}`;
const file=(owner:string)=>createHash('sha256').update('inventory:'+owner).digest('hex')+'.json';
let queue:Promise<unknown>=Promise.resolve();
class Changed extends Error{}
function inventory(value:unknown):Inventory|null{
 if(value===null||value===undefined)return null;
 if(!value||typeof value!=='object')throw Error('Review inventory is damaged. Saved links were preserved.');
 const state=value as Inventory;
 if(typeof state.revision!=='string'||!Array.isArray(state.links)||state.links.length>10000||state.links.some(link=>!link||typeof link.id!=='string'||typeof link.documentId!=='string'||!/^[a-f0-9]{64}$/.test(link.token)||typeof link.operationId!=='string'||link.url!==`/engine/review/${link.token}`||typeof link.pending!=='boolean'||![link.createdAt,link.expiresAt,...(link.revokedAt?[link.revokedAt]:[])].every(date=>typeof date==='string'&&Number.isFinite(Date.parse(date)))))throw Error('Review inventory is damaged. Saved links were preserved.');
 return state;
}
async function read(owner:string):Promise<Inventory|null>{
 const db=getAdminSupabase();if(db){const{data,error}=await db.from('gf_client_state').select('data').eq('owner',key(owner)).maybeSingle();if(error)throw Error('Review inventory unavailable.');return inventory(data?.data);}
 if(process.env.NODE_ENV==='production')throw Error('Review storage unavailable.');
 return readDevelopmentRecord('template-editor-reviews',file(owner),inventory);
}
async function write(owner:string,next:Inventory,revision:string|null){
 const db=getAdminSupabase();if(db){const row={owner:key(owner),data:next,updated_at:new Date().toISOString()};if(revision===null){const{error}=await db.from('gf_client_state').insert(row);if(error?.code==='23505')throw new Changed();if(error)throw Error('Review inventory unavailable.');}else{const{data,error}=await db.from('gf_client_state').update(row).eq('owner',key(owner)).eq('data->>revision',revision).select('owner').maybeSingle();if(error)throw Error('Review inventory unavailable.');if(!data)throw new Changed();}return;}
 if(process.env.NODE_ENV==='production')throw Error('Review storage unavailable.');const directory=developmentDirectory('template-editor-reviews');await fs.mkdir(directory,{recursive:true,mode:0o700});const destination=path.join(directory,file(owner)),temporary=destination+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,JSON.stringify(next),{mode:0o600});await fs.rename(temporary,destination);}finally{await fs.unlink(temporary).catch(()=>undefined);}
}
async function mutate<T>(owner:string,update:(state:Inventory)=>T):Promise<T>{
 const operation=async()=>{for(let attempt=0;attempt<8;attempt++){const before=await read(owner),next=structuredClone(before??{revision:'',links:[]});const result=update(next);next.revision=randomUUID();try{await write(owner,next,before?.revision??null);return result;}catch(error){if(!(error instanceof Changed)||attempt===7)throw error;}}throw Error('Review inventory changed. Try again.');};
 const run=queue.then(operation,operation);queue=run.catch(()=>undefined);return run;
}
export async function reserveReview(owner:string,documentId:string,token:string,expiresAt:string,operationId:string,legacy:ReviewLink[]=[]):Promise<ReviewLink>{
 return mutate(owner,state=>{
  for(const link of legacy)if(!state.links.some(item=>item.token===link.token))state.links.push({...link,url:`/engine/review/${link.token}`});
  const now=Date.now();state.links=state.links.filter(link=>!(link.pending&&now-Date.parse(link.createdAt)>600000));
  const existing=state.links.find(link=>link.operationId===operationId);if(existing){if(existing.documentId!==documentId||existing.revokedAt||Date.parse(existing.expiresAt)<=now)throw Error('This review creation request expired. Start a new review request.');return existing;}
  if(state.links.filter(link=>link.documentId===documentId&&!link.revokedAt&&Date.parse(link.expiresAt)>now).length>=20)throw Error('This design has reached its 20-review-link limit. Revoke an older link first.');
  if(state.links.length>=10000)throw Error('Review inventory has reached its lifetime limit. Contact the workspace administrator.');
  const link:ReviewLink={id:randomUUID(),documentId,token,url:`/engine/review/${token}`,expiresAt,createdAt:new Date(now).toISOString(),operationId,pending:true};state.links.push(link);return link;
 });
}
export async function activateReview(owner:string,id:string):Promise<void>{await mutate(owner,state=>{const link=state.links.find(item=>item.id===id);if(!link)throw Error('Review reservation expired. Try again.');link.pending=false;});}
export async function removeReviewReservation(owner:string,id:string):Promise<void>{await mutate(owner,state=>{state.links=state.links.filter(link=>link.id!==id||!link.pending);});}
export async function markReviewRevoked(owner:string,token:string):Promise<void>{await mutate(owner,state=>{const link=state.links.find(item=>item.token===token);if(link)link.revokedAt=new Date().toISOString();});}
export async function reviewIsActive(owner:string,id:string):Promise<boolean>{const state=await read(owner),link=state?.links.find(item=>item.id===id);return Boolean(link&&!link.pending&&!link.revokedAt&&Date.parse(link.expiresAt)>Date.now());}
export async function listReviewLinks(owner:string,documentId?:string):Promise<ReviewLink[]>{const state=await read(owner);return(state?.links??[]).filter(link=>!link.pending&&(!documentId||link.documentId===documentId));}
