import {createHash, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import os from "node:os";
import path from "node:path";
type Kind = "template-editor" | "template-editor-reviews";
/** Runtime data lives outside the source tree so Turbopack cannot treat saves
 * as module dependency changes. Each checkout has its own private namespace. */
export function developmentDirectory(kind: Kind): string {
  if (process.env.NODE_ENV === "test") return path.join(process.cwd(), ".engine-dev", kind);
  const project = createHash("sha256").update(process.cwd()).digest("hex").slice(0,24);
  const base = process.env.ENGINE_DEV_STORAGE_DIR || (os.platform() === "darwin" ? path.join(os.homedir(),"Library","Application Support","Engine","development") : os.platform() === "win32" ? path.join(process.env.LOCALAPPDATA || os.homedir(),"Engine","development") : path.join(os.homedir(),".local","share","engine","development"));
  return path.join(base, project, kind);
}
export async function readDevelopmentRecord<T>(kind: Kind, name: string, decode: (value: unknown) => T): Promise<T | null> {
  if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error("Invalid development record.");
  const directory = developmentDirectory(kind), target = path.join(directory,name);
  try {return decode(JSON.parse(await fs.readFile(target,"utf8")));}
  catch(cause) {if((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;}
  const legacy = path.join(process.cwd(),".engine-dev",kind,name);
  if (legacy === target) return null;
  let raw: unknown;
  try {raw = JSON.parse(await fs.readFile(legacy,"utf8"));}
  catch(cause) {if((cause as NodeJS.ErrnoException).code === "ENOENT") return null;throw cause;}
  const value = decode(raw); // Never migrate an unreadable source over saved work.
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const temporary = path.join(directory,`${name}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary,JSON.stringify(raw),{encoding:"utf8",mode:0o600});
    try {await fs.link(temporary,target);} catch(cause) {
      if((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      return decode(JSON.parse(await fs.readFile(target,"utf8")));
    }
  } finally {await fs.unlink(temporary).catch(()=>undefined);}
  // Leave the original file in place as a recovery copy. It is never moved/deleted.
  return value;
}
