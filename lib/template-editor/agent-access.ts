import {createHash, randomBytes, randomUUID, timingSafeEqual} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {getAdminSupabase} from "@/lib/supabase/admin";
import {developmentDirectory} from "./development-storage";

export type AgentCredential = {id: string; name: string; createdAt: string; expiresAt: string; revokedAt?: string};
type CredentialRecord = AgentCredential & {ownerKey: string; tokenHash: string};
const PREFIX = "template-editor-agent:";
const directory = () => path.join(developmentDirectory("template-editor"), "agent-access");
const validId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
function publicCredential(record: CredentialRecord): AgentCredential {
  const {id, name, createdAt, expiresAt, revokedAt} = record;
  return {id, name, createdAt, expiresAt, ...(revokedAt ? {revokedAt} : {})};
}
function decode(value: unknown): CredentialRecord {
  if (!value || typeof value !== "object") throw new Error("Agent access storage is unreadable.");
  const record = value as CredentialRecord;
  if (!validId(record.id) || typeof record.ownerKey !== "string" || !record.ownerKey || typeof record.name !== "string" || !/^[a-f0-9]{64}$/.test(record.tokenHash) || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.expiresAt)) || (record.revokedAt !== undefined && !Number.isFinite(Date.parse(record.revokedAt)))) throw new Error("Agent access storage is unreadable.");
  return record;
}
function localOnly() {
  if (process.env.NODE_ENV === "production") throw new Error("Cloud storage is required for agent access.");
}
async function read(id: string): Promise<CredentialRecord | null> {
  const db = getAdminSupabase();
  if (db) {
    const {data, error} = await db.from("gf_client_state").select("data").eq("owner", PREFIX + id).maybeSingle();
    if (error) throw new Error("Agent access storage is unavailable.");
    return data ? decode(data.data) : null;
  }
  localOnly();
  try {return decode(JSON.parse(await fs.readFile(path.join(directory(), `${id}.json`), "utf8")));}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error;}
}
export async function listAgentCredentials(ownerKey: string, offset = 0): Promise<AgentCredential[]> {
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error("Use a credential offset from 0–10000.");
  const db = getAdminSupabase();
  let records: CredentialRecord[];
  if (db) {
    const {data, error} = await db.from("gf_client_state").select("data").like("owner", `${PREFIX}%`).eq("data->>ownerKey", ownerKey).order("updated_at", {ascending: false}).order("owner", {ascending: true}).range(offset, offset + 99);
    if (error) throw new Error("Agent access storage is unavailable.");
    records = (data ?? []).map(row => decode(row.data));
    return records.filter(record => record.ownerKey === ownerKey).map(publicCredential);
  } else {
    localOnly();
    let files: string[];
    try {files = await fs.readdir(directory());} catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error;}
    records = await Promise.all(files.filter(file => validId(file.replace(/\.json$/, "")) && file.endsWith(".json")).map(async file => decode(JSON.parse(await fs.readFile(path.join(directory(), file), "utf8")))));
  }
  return records.filter(record => record.ownerKey === ownerKey).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(offset, offset + 100).map(publicCredential);
}
export async function createAgentCredential(ownerKey: string, name: string): Promise<{token: string; credential: AgentCredential}> {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new Error("Choose an agent name of 1–80 characters.");
  const id = randomUUID(), token = `eng1.${id}.${randomBytes(32).toString("base64url")}`;
  const record: CredentialRecord = {id, ownerKey, name: name.trim(), tokenHash: digest(token), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()};
  const db = getAdminSupabase();
  if (db) {
    const {error} = await db.from("gf_client_state").insert({owner: PREFIX + id, data: record, updated_at: record.createdAt});
    if (error) throw new Error("Agent access could not be created.");
  } else {
    localOnly(); await fs.mkdir(directory(), {recursive: true, mode: 0o700});
    await fs.writeFile(path.join(directory(), `${id}.json`), JSON.stringify(record), {encoding: "utf8", mode: 0o600, flag: "wx"});
  }
  return {token, credential: publicCredential(record)};
}
export async function revokeAgentCredential(ownerKey: string, id: string): Promise<boolean> {
  if (!validId(id)) return false;
  const record = await read(id);
  if (!record || record.ownerKey !== ownerKey) return false;
  if (record.revokedAt) return true;
  const next = {...record, revokedAt: new Date().toISOString()}, db = getAdminSupabase();
  if (db) {
    const {data, error} = await db.from("gf_client_state").update({data: next, updated_at: next.revokedAt}).eq("owner", PREFIX + id).eq("data->>ownerKey", ownerKey).select("owner").maybeSingle();
    if (error) throw new Error("Agent access could not be revoked.");
    return Boolean(data);
  }
  localOnly();
  const temporary = path.join(directory(), `${id}.${randomUUID()}.tmp`);
  try {await fs.writeFile(temporary, JSON.stringify(next), {encoding: "utf8", mode: 0o600}); await fs.rename(temporary, path.join(directory(), `${id}.json`));}
  finally {await fs.unlink(temporary).catch(() => undefined);}
  return true;
}
export async function resolveAgentToken(token: string): Promise<{ownerKey: string; credentialId: string} | null> {
  if (typeof token !== "string" || token.length > 150) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "eng1" || !validId(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
  const record = await read(parts[1]);
  if (!record || record.id !== parts[1] || record.revokedAt || Date.parse(record.expiresAt) <= Date.now()) return null;
  if (!timingSafeEqual(Buffer.from(record.tokenHash, "hex"), Buffer.from(digest(token), "hex"))) return null;
  return {ownerKey: record.ownerKey, credentialId: record.id};
}
