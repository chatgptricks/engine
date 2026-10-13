import {reserveReview,activateReview,removeReviewReservation,markReviewRevoked,reviewIsActive,listReviewLinks,type ReviewLink} from './review-inventory';
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {developmentDirectory,readDevelopmentRecord} from "./development-storage";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {prepareReviewSnapshot} from "./review-snapshot";
import {embedReviewImages} from "./review-assets";
import {getEditorLibrary} from "./persistence";
import {packAssets, unpackAssets} from "./library-sync";
import {EMPTY_LIBRARY, parseLibrary, type DesignDocument} from "./model";
export interface ReviewComment {id:string;name:string;text:string;createdAt:string;pageId?:string;elementId?:string;parentId?:string;anchor?:{x:number;y:number};resolved?:boolean}
export interface PublicReview {id:string;document:DesignDocument;createdAt:string;expiresAt:string;comments:ReviewComment[];revision?:string}
interface ReviewRecord extends PublicReview {owner: string; revision: string; assets?: Record<string, string>; revokedAt?: string; lastCommentAt?: number;inventoryId?:string}
const directory = developmentDirectory("template-editor-reviews");
const reviewKey = (token: string) => `template-review:${createHash("sha256").update(token).digest("hex")}`;
let queue: Promise<unknown> = Promise.resolve();
function lock<T>(fn: () => Promise<T>): Promise<T> { const next = queue.then(fn, fn); queue = next.catch(() => undefined); return next; }
function devOnly() { if (process.env.NODE_ENV === "production") throw new Error("Review storage is unavailable."); }
function tokenValid(token: string) { return /^[a-f0-9]{64}$/.test(token); }
async function read(token: string): Promise<ReviewRecord | null> {
  if (!tokenValid(token)) return null;
  const db = getAdminSupabase(); let raw: unknown;
  if (db) {
    const {data, error} = await db.from("gf_client_state").select("data").eq("owner", reviewKey(token)).maybeSingle();
    if (error) throw new Error("Review storage is unavailable."); raw = data?.data;
  } else {
    devOnly(); return readDevelopmentRecord("template-editor-reviews", `${reviewKey(token).split(":")[1]}.json`, decodeReviewRecord);
  }
  return decodeReviewRecord(raw);
}
function decodeReviewRecord(raw: unknown): ReviewRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as ReviewRecord;
  const document = unpackAssets(record.document, record.assets ?? {});
  const parsed = parseLibrary({...EMPTY_LIBRARY, designs: [document]});
  if (!parsed || typeof record.owner !== "string" || typeof record.revision !== "string" || !Number.isFinite(Date.parse(record.expiresAt))) throw new Error("Review could not be read.");
  return {...record, document: parsed.designs[0], comments: Array.isArray(record.comments) ? record.comments : []};
}
async function write(token: string, record: ReviewRecord, expectedRevision: string | null) {
  const packed = await packAssets({...record, assets: undefined});
  const data = {...packed.value, assets: packed.assets}, db = getAdminSupabase();
  if (db) {
    const row = {owner: reviewKey(token), data, updated_at: new Date().toISOString()};
    if (expectedRevision === null) { const {error} = await db.from("gf_client_state").insert(row); if (error) throw new Error("Review could not be saved."); }
    else { const {data: changed, error} = await db.from("gf_client_state").update({data, updated_at: row.updated_at}).eq("owner", row.owner).eq("data->>revision", expectedRevision).select("owner").maybeSingle(); if (error) throw new Error("Review could not be saved."); if (!changed) throw new Error("Review changed. Try again."); }
  } else {
    devOnly(); await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const file = path.join(directory, `${reviewKey(token).split(":")[1]}.json`), temp = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(data), {mode: 0o600}); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => undefined); }
  }
}
export async function createReview(owner: string, documentId: string, days = 7, expectedUpdatedAt?: string, operationId:string=randomUUID()): Promise<{token: string; expiresAt: string}> {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Review links can last between 1 and 30 days.");
  const existing=(await listReviewLinks(owner,documentId)).find(link=>link.operationId===operationId&&!link.revokedAt&&Date.parse(link.expiresAt)>Date.now());if(existing)return {token:existing.token,expiresAt:existing.expiresAt};
  const library = await getEditorLibrary(owner), source = library.library.designs.find(item => item.id === documentId && !item.deletedAt);
  if (!source) throw new Error("Save and open a design before sharing it.");

  if (expectedUpdatedAt && source.updatedAt !== expectedUpdatedAt) throw new Error("This design is still saving. Wait for autosave to finish before creating a review link.");
  // Share only artwork and caption. Internal versions, tags, folders and comments
  // stay inside the authenticated workspace.
  const document: DesignDocument = await embedReviewImages(prepareReviewSnapshot(source),owner);
  const packedArtwork = await packAssets(document);
  if (new TextEncoder().encode(JSON.stringify(packedArtwork)).byteLength > 12 * 1024 * 1024) throw new Error("This review is larger than 12 MB. Use smaller images before sharing.");
  const token = randomBytes(32).toString("hex"), expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const legacy:ReviewLink[]=[];
  for(const link of source.reviewLinks??[]){const oldToken=link.url.split('/').at(-1)??'',record=await read(oldToken);if(record?.owner===owner)legacy.push({...link,token:oldToken,documentId,createdAt:record.createdAt,operationId:link.id,pending:false,...(record.revokedAt?{revokedAt:record.revokedAt}:{})});}
  const reservation=await reserveReview(owner,documentId,token,expiresAt,operationId,legacy);
  if(!reservation.pending)return{token:reservation.token,expiresAt:reservation.expiresAt};
  try{await lock(async()=>{const prior=await read(reservation.token);if(!prior){try{await write(reservation.token,{id:randomUUID(),owner,inventoryId:reservation.id,revision:randomUUID(),document,createdAt:reservation.createdAt,expiresAt:reservation.expiresAt,comments:[]},null);}catch(error){const landed=await read(reservation.token);if(!landed||landed.owner!==owner||landed.inventoryId!==reservation.id)throw error;}}else if(prior.owner!==owner||prior.inventoryId!==reservation.id)throw Error('Review reservation mismatch.');});await activateReview(owner,reservation.id);}
  catch(error){const landed=await read(reservation.token).catch(()=>null);if(!landed)await removeReviewReservation(owner,reservation.id).catch(()=>undefined);throw error;}
  return {token:reservation.token,expiresAt:reservation.expiresAt};
}
export async function getPublicReview(token: string): Promise<PublicReview | null> {
  const record = await read(token); if (!record || record.revokedAt || Date.parse(record.expiresAt) <= Date.now() || record.inventoryId&&!await reviewIsActive(record.owner,record.inventoryId)) return null;
  return {id: record.id, revision:record.revision, document: prepareReviewSnapshot(record.document), createdAt: record.createdAt, expiresAt: record.expiresAt, comments: record.comments};
}
export async function addReviewComment(token:string,input:{name:string;text:string;pageId?:string;parentId?:string;elementId?:string;anchor?:{x:number;y:number}}):Promise<ReviewComment>{
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80 || typeof input.text !== "string" || !input.text.trim() || input.text.length > 2000) throw new Error("Enter your name and a comment of at most 2,000 characters.");
  return lock(async () => {
    const record = await read(token);
    if (!record || record.revokedAt || Date.parse(record.expiresAt) <= Date.now() || record.inventoryId&&!await reviewIsActive(record.owner,record.inventoryId)) throw new Error("This review link has expired or been revoked.");
    if (record.comments.length >= 100) throw new Error("This review has reached its 100-comment limit.");
    if (Date.now() - (record.lastCommentAt ?? 0) < 2000) throw new Error("Wait a moment before adding another comment.");
    if (input.pageId && !record.document.pages.some(page => page.id === input.pageId)) throw new Error("Choose an existing page.");
    if(input.parentId&&!record.comments.some(comment=>comment.id===input.parentId))throw Error('Choose an existing comment to reply to.');
    if(input.anchor&&(!input.pageId||![input.anchor.x,input.anchor.y].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)))throw Error('Choose a point inside the page.');
    const targetPage=record.document.pages.find(page=>page.id===input.pageId);
    if(input.elementId&&(!targetPage||![...(targetPage.canvas?.elements??[]),...(record.document.continuousCanvas?.elements??[]),...(record.document.masterScene?.elements??[])].some(element=>element.id===input.elementId)))throw Error('Choose an existing object on the page.');
    const comment:ReviewComment={id:randomUUID(),name:input.name.trim(),text:input.text.trim(),createdAt:new Date().toISOString(),...(input.pageId?{pageId:input.pageId}:{}),...(input.parentId?{parentId:input.parentId}:{}),...(input.elementId?{elementId:input.elementId}:{}),...(input.anchor?{anchor:{x:input.anchor.x,y:input.anchor.y}}:{})};
    await write(token, {...record, comments: [...record.comments, comment], lastCommentAt: Date.now(), revision: randomUUID()}, record.revision);
    return comment;
  });
}
export async function revokeReview(owner: string, token: string): Promise<void> {
  await lock(async () => { const record = await read(token); if (!record || record.owner !== owner) throw new Error("Review link not found."); await markReviewRevoked(owner,token);await write(token, {...record, revokedAt: new Date().toISOString(), revision: randomUUID()}, record.revision); });
}
export async function readOwnerReview(owner: string, token: string): Promise<PublicReview | null> {
  const record = await read(token); if (!record || record.owner !== owner) return null;
  return {id: record.id, document: prepareReviewSnapshot(record.document), createdAt: record.createdAt, expiresAt: record.expiresAt, comments: record.comments};
}

export {listReviewLinks};
export async function getReviewFeedback(token:string,since?:string){const record=await readFeedback(token);if(!record||record.revokedAt||Date.parse(record.expiresAt)<=Date.now()||record.inventoryId&&!await reviewIsActive(record.owner,record.inventoryId))return null;return{revision:record.revision,expiresAt:record.expiresAt,...(since===record.revision?{notModified:true}:{comments:record.comments})};}
export async function resolveReviewComment(owner:string,token:string,commentId:string,resolved:boolean):Promise<void>{await lock(async()=>{const record=await read(token);if(!record||record.owner!==owner)throw Error('Review not found.');if(!record.comments.some(comment=>comment.id===commentId))throw Error('Comment not found.');await write(token,{...record,revision:randomUUID(),comments:resolveThread(record.comments,commentId,resolved)},record.revision);});}

export function resolveThread(comments:ReviewComment[],commentId:string,resolved:boolean):ReviewComment[]{
 const parents=new Map(comments.map(comment=>[comment.id,comment.parentId]));
 const root=(id:string)=>{const visited=new Set<string>();while(parents.get(id)&&!visited.has(id)){visited.add(id);id=parents.get(id)!;}return id;};
 const target=root(commentId);return comments.map(comment=>root(comment.id)===target?{...comment,resolved}:comment);
}

/** Poll only feedback columns: public snapshots/assets are immutable and do
 * not need to cross the database/network boundary for each comment refresh. */
async function readFeedback(token:string):Promise<Pick<ReviewRecord,'owner'|'revision'|'comments'|'expiresAt'|'revokedAt'|'inventoryId'>|null>{
 if(!tokenValid(token))return null;const db=getAdminSupabase();if(!db)return read(token);
 const{data,error}=await db.from('gf_client_state').select('owner:data->>owner,revision:data->>revision,comments:data->comments,expiresAt:data->>expiresAt,revokedAt:data->>revokedAt,inventoryId:data->>inventoryId').eq('owner',reviewKey(token)).maybeSingle();
 if(error)throw Error('Feedback temporarily unavailable.');if(!data)return null;
 const value=(data as unknown as {data?:unknown}).data??data,record=value as ReviewRecord;
 if(typeof record.owner!=='string'||typeof record.revision!=='string'||!Array.isArray(record.comments)||record.comments.length>100||!Number.isFinite(Date.parse(record.expiresAt)))throw Error('Feedback could not be read.');
 return{owner:record.owner,revision:record.revision,comments:record.comments,expiresAt:record.expiresAt,revokedAt:record.revokedAt,inventoryId:record.inventoryId};
}
export async function readOwnerFeedback(owner:string,token:string,since?:string){const record=await readFeedback(token);if(!record||record.owner!==owner)return null;return{revision:record.revision,...(since===record.revision?{notModified:true}:{comments:record.comments})};}
