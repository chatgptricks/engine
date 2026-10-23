import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {REQUIRED_FONT_NAMES} from "./prepare-licensed-fonts.mjs";
export async function preparePagesFonts(origin){
  const manifest=JSON.parse(await fs.readFile("assets/pages-fonts.json","utf8"));
  if(manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length!==REQUIRED_FONT_NAMES.length||new Set(manifest.files.map(file=>file.name)).size!==REQUIRED_FONT_NAMES.length)throw Error("Invalid Pages font manifest.");
  await fs.mkdir("public/fonts/licensed",{recursive:true});
  for(const file of manifest.files){
    if(!REQUIRED_FONT_NAMES.includes(file.name)||!/^\w[\w.-]+$/.test(file.name)||!Number.isInteger(file.bytes)||file.bytes>10*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error("Invalid Pages font entry.");
    const destination=path.join("public/fonts/licensed",file.name),valid=bytes=>bytes.length===file.bytes&&createHash("sha256").update(bytes).digest("hex")===file.sha256;
    const existing=await fs.readFile(destination).catch(()=>null);if(existing&&valid(existing))continue;
    // These exact font assets are already served publicly by the deployed
    // backend. Verify repository-pinned hashes before including them in Pages.
    const response=await fetch(new URL(`/fonts/licensed/${encodeURIComponent(file.name)}`,origin),{redirect:"error",signal:AbortSignal.timeout(30000)});
    if(!response.ok||Number(response.headers.get("content-length"))>10*1024*1024)throw Error(`Font unavailable: ${file.name}`);
    const bytes=Buffer.from(await response.arrayBuffer());if(!valid(bytes))throw Error(`Font verification failed: ${file.name}`);
    await fs.writeFile(destination,bytes);
  }
}
