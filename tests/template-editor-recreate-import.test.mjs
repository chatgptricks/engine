/* Run: node --test tests/template-editor-recreate-import.test.mjs
 * Instagram import for "Recreate post": URL parsing, Apify normalization, CDN
 * allowlist, size caps and the screenshot fallback. fetch is always injected,
 * so no test touches the network. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
const TOKEN="apify_test_token_do_not_leak";

function load(relative,env) {
  const cache=new Map(),environment={cwd:()=>root,env};
  function requireModule(file) {
    const filename=path.join(root,file);
    if(cache.has(filename))return cache.get(filename).exports;
    const unit={exports:{}};cache.set(filename,unit);
    const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename,
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`,{filename})(name=>{
      const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
      if(local)return requireModule(path.relative(root,[local+".ts",local].find(candidate=>fs.existsSync(candidate))));
      return nativeRequire(name);
    },unit,unit.exports,environment);
    return unit.exports;
  }
  return requireModule(relative);
}
const fresh=(env={NODE_ENV:"test",APIFY_TOKEN:TOKEN})=>({env,...load("lib/engine/instagram-import.ts",env)});

/** Records every call and answers from a handler; never reaches the network. */
function fakeFetch(handler) {
  const calls=[];
  const fn=async(url,init={})=>{calls.push({url:String(url),init});return handler(String(url),init,calls.length);};
  fn.calls=calls;
  return fn;
}
const json=(body,status=201)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const jpeg=(size=64)=>{const bytes=new Uint8Array(size);bytes.set([0xff,0xd8,0xff,0xe0]);return bytes;};
const png=(size=64)=>{const bytes=new Uint8Array(size);bytes.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);return bytes;};
const webp=(size=64)=>{const bytes=new Uint8Array(size);bytes.set([...Buffer.from("RIFF"),0,0,0,0,...Buffer.from("WEBP")]);return bytes;};
const image=(bytes,type="image/jpeg",headers={})=>new Response(bytes,{status:200,headers:{"Content-Type":type,...headers}});
const rejectsWith=async(promise,code)=>{await assert.rejects(promise,error=>{assert.equal(error.name,"InstagramImportError",error.message);assert.equal(error.code,code,error.message);return true;});};
const CDN="https://scontent-mad1-1.cdninstagram.com/v/t51.2885-15/";

test("parseInstagramUrl accepts post, reel and tv links with optional usernames and query strings",()=>{
  const {parseInstagramUrl}=fresh();
  const cases=[
    ["https://www.instagram.com/p/DfUR7MxoA62/?img_index=1","DfUR7MxoA62","p"],
    ["https://instagram.com/p/DfUR7MxoA62","DfUR7MxoA62","p"],
    ["  http://www.instagram.com/p/DfUR7MxoA62/#comments  ","DfUR7MxoA62","p"],
    ["www.instagram.com/reel/C9xYz_12-ab/?utm_source=ig_web_copy_link&igsh=abc","C9xYz_12-ab","reel"],
    ["https://www.instagram.com/reels/C9xYz_12-ab/","C9xYz_12-ab","reel"],
    ["https://www.instagram.com/tv/B1234abcdEF/","B1234abcdEF","tv"],
    ["https://www.instagram.com/chatgptricks/p/DfUR7MxoA62/?img_index=3","DfUR7MxoA62","p"],
    ["https://www.instagram.com/some.user_name/reel/C9xYz_12-ab/","C9xYz_12-ab","reel"],
    ["https://www.instagram.com/p/DfUR7MxoA62/embed/captioned/","DfUR7MxoA62","p"],
    ["https://WWW.Instagram.COM/P/DfUR7MxoA62/","DfUR7MxoA62","p"],
  ];
  for(const [input,shortcode,kind] of cases) {
    assert.deepEqual({...parseInstagramUrl(input)},{shortcode,kind,canonicalUrl:`https://www.instagram.com/${kind}/${shortcode}/`},input);
  }
});

test("parseInstagramUrl rejects other hosts, profiles, credentials, ports and malformed codes with a clear error",()=>{
  const {parseInstagramUrl}=fresh();
  for(const input of [
    "", "   ", 42, null, "not a url",
    "https://evil.example/p/DfUR7MxoA62/",
    "https://www.instagram.com.evil.example/p/DfUR7MxoA62/",
    "https://instagram.com@evil.example/p/DfUR7MxoA62/",
    "https://user:pass@www.instagram.com/p/DfUR7MxoA62/",
    "https://www.instagram.com:8443/p/DfUR7MxoA62/",
    "ftp://www.instagram.com/p/DfUR7MxoA62/",
    "javascript:alert(1)",
    "https://www.instagram.com/chatgptricks/",
    "https://www.instagram.com/chatgptricks/reels/",
    "https://www.instagram.com/p/",
    "https://www.instagram.com/p/ab/",
    "https://www.instagram.com/p/Df%2FUR7Mx/",
    "https://www.instagram.com/explore/tags/ai/",
    "https://www.instagram.com/stories/chatgptricks/3412345678901234567/",
    "https://m.facebook.com/p/DfUR7MxoA62/",
  ]) {
    assert.throws(()=>parseInstagramUrl(input),error=>error.code==="invalid_url"&&error.status===400&&/instagram/i.test(error.message),String(input));
  }
});

test("importInstagramPost fails clearly without APIFY_TOKEN and never calls Apify",async()=>{
  const {importInstagramPost}=fresh({NODE_ENV:"test"}),fetch=fakeFetch(()=>json([]));
  await rejectsWith(importInstagramPost("https://www.instagram.com/p/DfUR7MxoA62/",{fetch}),"missing_token");
  assert.equal(fetch.calls.length,0);
  await rejectsWith(importInstagramPost("https://evil.example/p/DfUR7MxoA62/",{fetch}),"invalid_url");
  assert.equal(fetch.calls.length,0);
});

test("importInstagramPost calls apify/instagram-scraper with a Bearer header and normalizes a Sidecar carousel",async()=>{
  const {importInstagramPost}=fresh();
  const item={
    inputUrl:"https://www.instagram.com/p/DfUR7MxoA62/",id:"3924506097334912938",type:"Sidecar",shortCode:"DfUR7MxoA62",
    caption:"Claude can now use your computer.\n\n#ai",url:"https://www.instagram.com/p/DfUR7MxoA62/",
    displayUrl:CDN+"cover.jpg",images:[CDN+"a.jpg",CDN+"b.jpg"],timestamp:"2026-11-01T15:30:00.000Z",
    ownerUsername:"evolving.ai",dimensionsWidth:1080,dimensionsHeight:1350,
    childPosts:[
      {type:"Image",displayUrl:CDN+"1.jpg",dimensionsWidth:1080,dimensionsHeight:1350},
      {type:"Video",displayUrl:CDN+"2.jpg",videoUrl:CDN+"2.mp4",dimensionsWidth:1080,dimensionsHeight:1920},
      {type:"Image",displayUrl:"not-a-url"},
      {type:"Image",images:[CDN+"4.jpg"],dimensionsWidth:0},
    ],
  };
  const fetch=fakeFetch(()=>json([item]));
  const post=await importInstagramPost("https://www.instagram.com/evolving.ai/p/DfUR7MxoA62/?img_index=1",{fetch});
  assert.equal(fetch.calls.length,1);
  const [{url,init}]=fetch.calls,request=new URL(url);
  assert.equal(request.origin+request.pathname,"https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items");
  assert.equal(url.includes(TOKEN),false,"token must never be in the URL");
  assert.equal(request.searchParams.get("token"),null);
  assert.ok(Number(request.searchParams.get("timeout"))>0);
  assert.equal(init.method,"POST");
  assert.equal(init.headers.Authorization,`Bearer ${TOKEN}`);
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(init.body),{directUrls:["https://www.instagram.com/p/DfUR7MxoA62/"],resultsType:"posts",resultsLimit:1,addParentData:false});
  assert.deepEqual(JSON.parse(JSON.stringify(post)),{
    shortcode:"DfUR7MxoA62",url:"https://www.instagram.com/p/DfUR7MxoA62/",ownerUsername:"evolving.ai",
    caption:"Claude can now use your computer.\n\n#ai",takenAt:"2026-11-01T15:30:00.000Z",type:"Sidecar",source:"instagram",
    slides:[
      {index:0,imageUrl:CDN+"1.jpg",isVideo:false,width:1080,height:1350},
      {index:1,imageUrl:CDN+"2.jpg",isVideo:true,videoUrl:CDN+"2.mp4",width:1080,height:1920},
      {index:2,imageUrl:CDN+"4.jpg",isVideo:false},
    ],
  });
});

test("Sidecar posts without childPosts fall back to the images list, and single posts use displayUrl",async()=>{
  const {normalizeApifyPost}=fresh();
  const carousel=normalizeApifyPost({type:"Sidecar",shortCode:"ABCDE12345",displayUrl:CDN+"0.jpg",images:[CDN+"0.jpg",CDN+"1.jpg",CDN+"2.jpg"],childPosts:[]});
  assert.equal(carousel.type,"Sidecar");
  assert.deepEqual(carousel.slides.map(slide=>[slide.index,slide.imageUrl,slide.isVideo]),[[0,CDN+"0.jpg",false],[1,CDN+"1.jpg",false],[2,CDN+"2.jpg",false]]);
  const mentions=normalizeApifyPost({type:"Sidecar",shortCode:"ABCDE12345",carouselImages:[CDN+"x.jpg",CDN+"y.jpg"]});
  assert.deepEqual(mentions.slides.map(slide=>slide.imageUrl),[CDN+"x.jpg",CDN+"y.jpg"]);

  const single=normalizeApifyPost({type:"Image",shortCode:"ABCDE12345",displayUrl:CDN+"only.jpg",images:[],childPosts:[],dimensionsWidth:1080,dimensionsHeight:1080,caption:null,timestamp:"nope"});
  assert.deepEqual(JSON.parse(JSON.stringify(single)),{shortcode:"ABCDE12345",url:"https://www.instagram.com/p/ABCDE12345/",ownerUsername:"",caption:"",takenAt:null,type:"Image",source:"instagram",slides:[{index:0,imageUrl:CDN+"only.jpg",isVideo:false,width:1080,height:1080}]});
  const reel=normalizeApifyPost({type:"Video",shortCode:"REEL12345",productType:"clips",displayUrl:CDN+"cover.jpg",videoUrl:CDN+"reel.mp4",url:"https://www.instagram.com/reel/REEL12345/"});
  assert.equal(reel.type,"Video");
  assert.deepEqual({...reel.slides[0]},{index:0,imageUrl:CDN+"cover.jpg",isVideo:true,videoUrl:CDN+"reel.mp4"});
  assert.equal(reel.url,"https://www.instagram.com/reel/REEL12345/");

  const many=normalizeApifyPost({type:"Sidecar",images:Array.from({length:25},(_,i)=>`${CDN}${i}.jpg`)});
  assert.equal(many.slides.length,20);
  assert.throws(()=>normalizeApifyPost({type:"Image",shortCode:"ABCDE12345"}),error=>error.code==="no_media");
  assert.throws(()=>normalizeApifyPost(null),error=>error.code==="upstream");
});

test("importInstagramPost reports not found, private, mismatched and upstream failures without leaking the token",async()=>{
  const {importInstagramPost}=fresh(),link="https://www.instagram.com/p/DfUR7MxoA62/";
  const run=(answer)=>importInstagramPost(link,{fetch:fakeFetch(()=>answer())});
  await rejectsWith(run(()=>json([])),"not_found");
  await rejectsWith(run(()=>json([{url:link,error:"not_found",errorDescription:"Post does not exist"}])),"not_found");
  await rejectsWith(run(()=>json([{url:link,error:"restricted_page",errorDescription:"Empty or private data for provided input"}])),"private");
  await rejectsWith(run(()=>json([{type:"Image",shortCode:"SomethingElse1",displayUrl:CDN+"x.jpg"}])),"not_found");
  await rejectsWith(run(()=>json({error:{type:"oops"}})),"upstream");
  await rejectsWith(run(()=>new Response("<html>",{status:201})),"upstream");
  await rejectsWith(run(()=>json({error:{type:"run-timeout-exceeded"}},408)),"timeout");
  for(const status of [400,401,402,429,500]) {
    await assert.rejects(run(()=>json({error:{type:"x",message:`token ${TOKEN}`}},status)),error=>{
      assert.equal(error.message.includes(TOKEN),false);
      assert.ok(["upstream","timeout"].includes(error.code));
      if(status===401)assert.match(error.message,/APIFY_TOKEN/);
      return true;
    });
  }
  await rejectsWith(importInstagramPost(link,{fetch:async()=>{throw new TypeError("fetch failed");}}),"upstream");
  const matched=await run(()=>json([{error:"no_items"},{type:"Image",shortCode:"DfUR7MxoA62",displayUrl:CDN+"ok.jpg"}]));
  assert.equal(matched.slides[0].imageUrl,CDN+"ok.jpg");
});

test("importInstagramPost honours the caller's abort signal",async()=>{
  const {importInstagramPost}=fresh(),controller=new AbortController();
  const fetch=fakeFetch((url,init)=>new Promise((_,reject)=>init.signal.addEventListener("abort",()=>reject(init.signal.reason),{once:true})));
  const pending=importInstagramPost("https://www.instagram.com/p/DfUR7MxoA62/",{fetch,signal:controller.signal});
  setTimeout(()=>controller.abort(),5);
  await rejectsWith(pending,"aborted");
});

test("downloadSlideImages returns vision-ready base64 in slide order with the sniffed media type",async()=>{
  const {downloadSlideImages}=fresh();
  const bodies={[CDN+"0.jpg"]:image(jpeg(),"image/jpeg"),[CDN+"1.png"]:image(png(),"image/png; charset=binary"),[CDN+"2.webp"]:image(webp(),"image/webp"),"https://instagram.fmad3-1.fna.fbcdn.net/3.jpg":image(png(),"image/jpeg")};
  const fetch=fakeFetch(url=>bodies[url]);
  const slides=[{index:0,imageUrl:CDN+"0.jpg"},{index:1,imageUrl:CDN+"1.png"},{index:2,imageUrl:CDN+"2.webp"},{index:3,imageUrl:"https://instagram.fmad3-1.fna.fbcdn.net/3.jpg"}];
  const images=await downloadSlideImages(slides,{fetch});
  assert.deepEqual(images.map(entry=>[entry.index,entry.mediaType]),[[0,"image/jpeg"],[1,"image/png"],[2,"image/webp"],[3,"image/png"]]);
  assert.equal(images[0].base64,Buffer.from(jpeg()).toString("base64"));
  for(const call of fetch.calls) {assert.equal(call.init.redirect,"manual");assert.equal(call.init.headers.Authorization,undefined);}
  assert.deepEqual(await downloadSlideImages([],{fetch}),[]);
});

test("downloadSlideImages only fetches https Instagram/Facebook CDN hosts, including after redirects",async()=>{
  const {downloadSlideImages}=fresh();
  for(const imageUrl of [
    "http://scontent.cdninstagram.com/a.jpg",
    "https://evil.example/a.jpg",
    "https://cdninstagram.com.evil.example/a.jpg",
    "https://evilcdninstagram.com/a.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://127.0.0.1/a.jpg",
    "https://localhost/a.jpg",
    "https://[::1]/a.jpg",
    "https://scontent.cdninstagram.com:8443/a.jpg",
    "https://user:pw@scontent.cdninstagram.com/a.jpg",
    "file:///etc/passwd",
    "upload:0",
    "",
  ]) {
    const fetch=fakeFetch(()=>image(jpeg()));
    await rejectsWith(downloadSlideImages([{index:0,imageUrl:CDN+"fine.jpg"},{index:1,imageUrl}],{fetch}),"blocked_host");
    assert.equal(fetch.calls.length,0,`nothing is fetched when any slide is off-allowlist: ${imageUrl}`);
  }
  const redirectOut=fakeFetch(()=>new Response(null,{status:302,headers:{Location:"http://10.0.0.5/internal.jpg"}}));
  await rejectsWith(downloadSlideImages([{index:0,imageUrl:CDN+"a.jpg"}],{fetch:redirectOut}),"blocked_host");
  assert.equal(redirectOut.calls.length,1);
  const redirectIn=fakeFetch((url,init,count)=>count===1?new Response(null,{status:301,headers:{Location:"https://scontent.xx.fbcdn.net/final.jpg"}}):image(jpeg()));
  const [followed]=await downloadSlideImages([{index:4,imageUrl:CDN+"a.jpg"}],{fetch:redirectIn});
  assert.equal(followed.index,4);
  assert.equal(redirectIn.calls[1].url,"https://scontent.xx.fbcdn.net/final.jpg");
  const loop=fakeFetch(()=>new Response(null,{status:302,headers:{Location:CDN+"again.jpg"}}));
  await rejectsWith(downloadSlideImages([{index:0,imageUrl:CDN+"a.jpg"}],{fetch:loop}),"upstream");
  assert.equal(loop.calls.length,4);
});

test("downloadSlideImages enforces image content types, per-image size caps and the 20-slide limit",async()=>{
  const {downloadSlideImages,DEFAULT_MAX_IMAGE_BYTES}=fresh();
  assert.equal(DEFAULT_MAX_IMAGE_BYTES,10*1024*1024);
  const one=[{index:0,imageUrl:CDN+"a.jpg"}];
  await rejectsWith(downloadSlideImages(one,{fetch:fakeFetch(()=>image(jpeg(),"text/html"))}),"unsupported_media");
  await rejectsWith(downloadSlideImages(one,{fetch:fakeFetch(()=>image(jpeg(),"image/gif"))}),"unsupported_media");
  await rejectsWith(downloadSlideImages(one,{fetch:fakeFetch(()=>new Response(jpeg()))}),"unsupported_media");
  await rejectsWith(downloadSlideImages(one,{fetch:fakeFetch(()=>image(Buffer.from("<svg onload=alert(1)>"),"image/jpeg"))}),"unsupported_media");
  await rejectsWith(downloadSlideImages(one,{fetch:fakeFetch(()=>new Response("gone",{status:403}))}),"upstream");

  // Default cap: a declared 10 MB + 1 byte body is refused before it is read.
  let pulled=0;
  const declared=new ReadableStream({pull(controller){pulled++;controller.enqueue(jpeg(1024));if(pulled>4)controller.close();}});
  await rejectsWith(downloadSlideImages(one,{fetch:fakeFetch(()=>image(declared,"image/jpeg",{"Content-Length":String(10*1024*1024+1)}))}),"too_large");
  assert.ok(pulled<=1,"an oversized declared body is not consumed");
  // Undeclared length: the stream is cut off as soon as it passes the cap.
  let chunks=0;
  const endless=new ReadableStream({pull(controller){chunks++;controller.enqueue(chunks===1?jpeg(1024):new Uint8Array(1024));}});
  await rejectsWith(downloadSlideImages(one,{maxBytes:4096,fetch:fakeFetch(()=>image(endless))}),"too_large");
  assert.ok(chunks<=6,`stopped reading after ${chunks} chunks`);
  const [exact]=await downloadSlideImages(one,{maxBytes:4096,fetch:fakeFetch(()=>image(jpeg(4096)))});
  assert.equal(Buffer.from(exact.base64,"base64").length,4096);

  const tooMany=Array.from({length:21},(_,index)=>({index,imageUrl:`${CDN}${index}.jpg`}));
  const counted=fakeFetch(()=>image(jpeg()));
  await rejectsWith(downloadSlideImages(tooMany,{fetch:counted}),"too_many_slides");
  assert.equal(counted.calls.length,0);
  assert.equal((await downloadSlideImages(tooMany.slice(0,20),{fetch:counted})).length,20);
  for(const maxBytes of [0,-1,1.5,100*1024*1024]) await assert.rejects(downloadSlideImages(one,{maxBytes,fetch:counted}),RangeError);
});

test("normalizeUploadedSlides turns screenshots and a pasted caption into the imported post shape",async()=>{
  const {normalizeUploadedSlides}=fresh();
  const files=[
    new Blob([png()],{type:"image/png"}),
    {data:`data:image/jpeg;base64,${Buffer.from(jpeg()).toString("base64")}`},
    {data:webp(),mediaType:"image/png",name:"third.png"},
    {data:Buffer.from(jpeg()).toString("base64")},
  ];
  const {post,images}=await normalizeUploadedSlides(files,{caption:"  Pasted caption  ",url:"https://www.instagram.com/p/DfUR7MxoA62/?img_index=1",ownerUsername:"@evolving.ai"});
  assert.deepEqual(JSON.parse(JSON.stringify(post)),{
    shortcode:"DfUR7MxoA62",url:"https://www.instagram.com/p/DfUR7MxoA62/",ownerUsername:"evolving.ai",caption:"Pasted caption",takenAt:null,type:"Sidecar",source:"upload",
    slides:[0,1,2,3].map(index=>({index,imageUrl:`upload:${index}`,isVideo:false})),
  });
  assert.deepEqual(images.map(entry=>[entry.index,entry.mediaType]),[[0,"image/png"],[1,"image/jpeg"],[2,"image/webp"],[3,"image/jpeg"]]);
  assert.equal(images[0].base64,Buffer.from(png()).toString("base64"));

  const single=await normalizeUploadedSlides([new Blob([jpeg()])]);
  assert.equal(single.post.type,"Image");
  assert.equal(single.post.shortcode,"");
  assert.equal(single.post.url,"");
  assert.equal(single.post.caption,"");
});

test("normalizeUploadedSlides rejects non-images, oversized files, bad data and too many screenshots",async()=>{
  const {normalizeUploadedSlides}=fresh();
  const code=async(files,expected,options)=>rejectsWith(normalizeUploadedSlides(files,options),expected);
  await code([],"invalid_upload");
  await code("nope","invalid_upload");
  await code([new Blob([Buffer.from("GIF89a-------")],{type:"image/gif"})],"unsupported_media");
  await code([{data:"not base64!!"}],"invalid_upload");
  await code([{nothing:true}],"invalid_upload");
  await code([new Blob([jpeg(5000)])],"too_large",{maxBytes:4096});
  await code([{data:Buffer.from(jpeg(5000)).toString("base64")}],"too_large",{maxBytes:4096});
  await code([{data:jpeg(5000)}],"too_large",{maxBytes:4096});
  await code(Array.from({length:21},()=>new Blob([jpeg()])),"too_many_slides");
  await code([new Blob([jpeg()])],"too_large",{caption:"x".repeat(5001)});
  await code([new Blob([jpeg()])],"invalid_url",{url:"https://evil.example/p/DfUR7MxoA62/"});
});
