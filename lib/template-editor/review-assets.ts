import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
import http from "node:http";
import https from "node:https";
import sharp from "sharp";
function privateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (isIP(value) === 4) {
    const [a,b] = value.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  return !value.startsWith("2") && !value.startsWith("3"); // IPv6 global unicast only, excludes mapped/private/loopback.
}
export async function fetchReviewImage(value: string, redirects = 0, maxDimension=1800): Promise<Buffer> {
  const url = new URL(value);
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password || (url.port && url.port !== "80" && url.port !== "443") || redirects > 3) throw new Error("A review image URL is not supported.");
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {all:true});
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error("A review image uses a private or unavailable host.");
  const address = addresses[0];
  const response = await new Promise<http.IncomingMessage>((resolve,reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method:"GET", agent:false, headers:{Accept:"image/png,image/jpeg,image/webp,image/avif,image/gif", "User-Agent":"Engine-Design-Review/1.0"},
      lookup: (_hostname, options, callback) => { if (typeof options === "object" && options.all) callback(null,[address]); else callback(null,address.address,address.family); },
    },resolve);
    const timer=setTimeout(()=>request.destroy(new Error("A review image timed out.")),12_000);
    request.once("close",()=>clearTimeout(timer));request.once("error",reject);request.end();
  });
  if ([301,302,303,307,308].includes(response.statusCode ?? 0) && response.headers.location) {response.resume();return fetchReviewImage(new URL(response.headers.location,url).href,redirects+1,maxDimension);}
  if (response.statusCode !== 200 || !/^image\/(png|jpeg|webp|avif|gif)(;|$)/i.test(response.headers["content-type"] ?? "")) {response.destroy();throw new Error("A review image is unavailable. Replace it with an uploaded image before sharing.");}
  const chunks: Buffer[] = [];let size=0;
  for await (const chunk of response) {const buffer=Buffer.from(chunk);size+=buffer.length;if(size>8*1024*1024){response.destroy();throw new Error("A review image is larger than 8 MB.");}chunks.push(buffer);}
  const input=sharp(Buffer.concat(chunks),{limitInputPixels:40_000_000}).rotate();if(maxDimension)input.resize({width:maxDimension,height:maxDimension,fit:"inside",withoutEnlargement:true});return input.webp({quality:90}).toBuffer();
}
/** Freeze remote pictures inside an explicitly-created review snapshot. */
export async function embedReviewImages<T>(value:T,owner?:string):Promise<T>{
  const cache=new Map<string,Promise<string>>();let bytes=0;
  async function visit(input:unknown,field=""):Promise<unknown>{
    if ((field==="src"||field==="url")&&typeof input==="string"){
      let target=input;
      const privateAsset=target.match(/^\/api\/template-editor\/assets\/([a-f0-9]{64})$/);
      if(privateAsset){if(!owner)throw Error('Sign in to share original media.');let task=cache.get(target);if(!task){task=(async()=>{const {readOriginalAsset}=await import('./media-storage');const asset=await readOriginalAsset(owner,privateAsset[1]);if(!asset)throw Error('An original image is missing.');const buffer=await sharp(asset.data,{limitInputPixels:100_000_000,sequentialRead:true}).rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer();bytes+=buffer.length;if(bytes>9*1024*1024)throw Error('Review artwork is larger than 9 MB.');return `data:image/webp;base64,${buffer.toString('base64')}`;})();cache.set(target,task);}return task;}

      if (target.startsWith("/api/engine/img?")) {
        target=new URL(target,"http://engine.local").searchParams.get("u")??"";
        if (!/^https?:\/\//i.test(target)) throw new Error("A review image proxy source is unavailable. Upload the image before sharing.");
      }
      if (/^https?:\/\//i.test(target)){
        let task=cache.get(target);if(!task){task=fetchReviewImage(target).then(buffer=>{bytes+=buffer.length;if(bytes>9*1024*1024)throw new Error("Review artwork is larger than 9 MB. Use smaller images before sharing.");return `data:image/webp;base64,${buffer.toString("base64")}`;});cache.set(target,task);}return task;
      }
      if(target.startsWith("/api/"))throw new Error("This design uses a private image endpoint. Upload the image before sharing a review.");
    }
    if(Array.isArray(input))return Promise.all(input.map(child=>visit(child)));
    if(input&&typeof input==="object")return Object.fromEntries(await Promise.all(Object.entries(input).map(async([key,child])=>[key,await visit(child,key)])));
    return input;
  }
  return await visit(value) as T;
}
