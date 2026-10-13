import {createHash,randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {developmentDirectory,readDevelopmentRecord} from "./development-storage";
export const PRESENCE_TTL=75_000;
export type PresenceSession={id:string;documentId:string;seenAt:number;sequence?:number;left?:boolean};
type PresenceRecord={revision:string;sessions:PresenceSession[]};
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const key=(owner:string)=>`template-presence:${hash(owner)}`;
const filename=(owner:string)=>`${hash(key(owner))}.json`;
export function updatePresenceSessions(sessions:PresenceSession[],id:string,documentId:string,leave:boolean,now=Date.now(),sequence=1):PresenceSession[] {
  const active=sessions.filter(session=>session.seenAt>now-PRESENCE_TTL&&session.seenAt<=now),previous=active.find(session=>session.id===id);
  if(previous&&(previous.sequence??0)>=sequence)return active;
  const others=active.filter(session=>session.id!==id);
  if(others.length>=100)throw new Error("Too many editor sessions are open.");
  // Retain short-lived leave tombstones so a delayed heartbeat cannot resurrect
  // a tab after its cleanup request has already arrived.
  return [...others,{id,documentId,seenAt:now,sequence,left:leave}];
}
function decode(value:unknown):PresenceRecord {
  const record=value as PresenceRecord;
  if(!record||typeof record.revision!=="string"||!Array.isArray(record.sessions)||record.sessions.length>100)throw new Error("Presence is temporarily unavailable.");
  return {revision:record.revision,sessions:record.sessions.filter(session=>session&&typeof session.id==="string"&&typeof session.documentId==="string"&&Number.isFinite(session.seenAt))};
}
async function read(owner:string):Promise<PresenceRecord|null> {
  const db=getAdminSupabase();
  if(!db){if(process.env.NODE_ENV==="production")throw new Error("Presence is unavailable.");return readDevelopmentRecord("template-editor-presence",filename(owner),decode);}
  const {data,error}=await db.from("gf_client_state").select("data").eq("owner",key(owner)).maybeSingle();
  if(error)throw new Error("Presence is unavailable.");return data?decode(data.data):null;
}
class ConcurrentPresence extends Error{}
async function write(owner:string,record:PresenceRecord,revision:string|null) {
  const db=getAdminSupabase();
  if(db){
    const row={owner:key(owner),data:record,updated_at:new Date().toISOString()};
    if(revision===null){const {error}=await db.from("gf_client_state").insert(row);if(error?.code==="23505")throw new ConcurrentPresence();if(error)throw new Error("Presence is unavailable.");}
    else {const {data,error}=await db.from("gf_client_state").update(row).eq("owner",row.owner).eq("data->>revision",revision).select("owner").maybeSingle();if(error)throw new Error("Presence is unavailable.");if(!data)throw new ConcurrentPresence();}
    return;
  }
  if(process.env.NODE_ENV==="production")throw new Error("Presence is unavailable.");
  const directory=developmentDirectory("template-editor-presence");await fs.mkdir(directory,{recursive:true,mode:0o700});
  const temporary=path.join(directory,`${randomUUID()}.tmp`);
  try{await fs.writeFile(temporary,JSON.stringify(record),{mode:0o600});await fs.rename(temporary,path.join(directory,filename(owner)));}
  finally{await fs.unlink(temporary).catch(()=>undefined);}
}
let queue:Promise<unknown>=Promise.resolve();
export async function heartbeatPresence(owner:string,id:string,documentId:string,leave=false,sequence=1):Promise<number> {
  const run=async()=>{
    for(let attempt=0;attempt<5;attempt++){
      const before=await read(owner),sessions=updatePresenceSessions(before?.sessions??[],id,documentId,leave,Date.now(),sequence);
      try{await write(owner,{revision:randomUUID(),sessions},before?.revision??null);return sessions.filter(session=>session.id!==id&&!session.left&&session.documentId===documentId).length;}
      catch(error){if(!(error instanceof ConcurrentPresence)||attempt===4)throw error;}
    }
    return 0;
  };
  if(getAdminSupabase())return run();
  const task=queue.then(run,run);queue=task.catch(()=>undefined);return task;
}
