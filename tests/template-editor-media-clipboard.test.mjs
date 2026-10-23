import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import sharp from 'sharp';
import JSZip from 'jszip';
const require=createRequire(import.meta.url), cache=new Map();
function load(relative,overrides={}) {
  const filename=path.resolve(relative),unit={exports:{}};
  const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(name=>Object.hasOwn(overrides,name)?overrides[name]:name.startsWith('.')?loadCached(path.resolve(path.dirname(filename),name+'.ts')):require(name),unit,unit.exports);
  return unit.exports;
}
function loadCached(file){if(!cache.has(file))cache.set(file,load(file));return cache.get(file);}
const model=loadCached('lib/template-editor/model.ts'),commands=loadCached('lib/template-editor/commands.ts'),clipboard=loadCached('lib/template-editor/clipboard.ts');

test('system clipboard round trip preserves nested groups, origin, texture IDs and visual appearance across projects',()=>{
  const shape={...model.createCanvasElement('shape'),groupId:'inner',x:450};
  const text={...model.createCanvasElement('text'),groupId:'inner',textStyleId:'source-style',text:'Café'};
  const scene={background:'#fff',elements:[shape,text],groups:[{id:'outer',name:'Outer',locked:false,hidden:false},{id:'inner',name:'Inner',parentId:'outer',locked:false,hidden:false}]};
  const snapshot=commands.copySelection(scene,[shape.id,text.id],undefined,{x:360,y:0});
  const wire=clipboard.encodeElementClipboard(snapshot,'source');
  const decoded=clipboard.decodeElementClipboard(wire,'destination');
  assert.equal(decoded.groups.length,2);assert.deepEqual(decoded.origin,{x:360,y:0});assert.equal(decoded[1].text,'Café');assert.equal(decoded[1].textStyleId,undefined);
  assert.equal(clipboard.decodeElementClipboard(wire,'source')[1].textStyleId,'source-style');
  const pasted=commands.pasteSelection({background:'#fff',elements:[]},decoded,undefined,{x:0,y:0});
  assert.equal(pasted.scene.groups.length,2);assert.equal(pasted.scene.elements[0].x,102);assert.notEqual(pasted.scene.elements[0].id,shape.id);
  assert.equal(clipboard.decodeElementClipboard('A newly copied external text','source'),null);
});
test('invalid clipboard payloads reject instead of binding arbitrary element or group data',()=>{
  assert.throws(()=>clipboard.decodeElementClipboard('ENGINE_ELEMENTS_V1\n{}','x'),/not supported/);
  const wire=clipboard.encodeElementClipboard([model.createCanvasElement('image',{src:'https://example.com/image.png'})],'a');
  assert.throws(()=>clipboard.decodeElementClipboard(wire.replace('https://example.com/image.png','javascript:alert(1)'),'b'),/valid Engine objects/);
  assert.throws(()=>clipboard.decodeElementClipboard(wire.replace('"version":1','"origin":{"x":999999,"y":0},"version":1'),'b'),/position/);
  assert.equal(clipboard.plainClipboardText('A\r\nB\u0000'),'A\nB');
});
test('original uploads preserve exact bytes and dimensions with smaller previews and owner isolation',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'engine-media-test-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const storage=load('lib/template-editor/media-storage.ts',{'@/lib/supabase/admin':{getAdminSupabase:()=>null},'./development-storage':{developmentDirectory:()=>directory,readDevelopmentRecord:async(_kind,name,decode)=>{try{return decode(JSON.parse(await fs.promises.readFile(path.join(directory,name),'utf8')));}catch(error){if(error.code==='ENOENT')return null;throw error;}}}});
  const original=await sharp({create:{width:6000,height:4000,channels:4,background:{r:21,g:60,b:80,alpha:.6}}}).png().toBuffer();
  const asset=await storage.storeOriginalAsset('owner-a',original,'Original.png');
  assert.equal(asset.width,6000);assert.equal(asset.height,4000);
  const restored=await storage.readOriginalAsset('owner-a',asset.id);assert.deepEqual(restored.data,original);
  assert.equal(await storage.readOriginalAsset('owner-b',asset.id),null);
  assert.equal(await storage.readOriginalAsset('owner-a','../bad'),null);
  const preview=await storage.originalPreview(asset),meta=await sharp(Buffer.from(preview.split(',')[1],'base64')).metadata();
  assert.ok(meta.width<=1440);assert.ok(meta.hasAlpha);assert.ok(preview.length<480100);
  const rendition=await storage.originalRendition(asset,1200),renditionMeta=await sharp(rendition.data).metadata();
  assert.equal(renditionMeta.width,1200);assert.equal(renditionMeta.height,800);assert.equal(renditionMeta.hasAlpha,true);
  assert.deepEqual((await storage.readOriginalAsset('owner-a',asset.id)).data,original);
  await assert.rejects(storage.originalRendition(asset,8193),/8192/);
  await assert.rejects(storage.inspectOriginalAsset(Buffer.from('<svg/>'),'spoof.png'));
  await assert.rejects(storage.inspectOriginalAsset(Buffer.alloc(15*1024*1024+1),'large.png'),/15 MB/);
  const fill={src:`/api/template-editor/assets/${asset.id}`,previewSrc:preview,objectFit:'cover',cropX:50,cropY:50,intrinsicWidth:asset.width,intrinsicHeight:asset.height};
  assert.equal(model.parseShapeImageFill(fill).previewSrc,preview);
});
test('client upload never silently downsamples a full-resolution original',async t=>{
  const client=load('lib/template-editor/client-media.ts'),previous=globalThis.fetch;
  t.after(()=>{globalThis.fetch=previous;});
  const file=new File(['original-data'],'source.png',{type:'image/png'});
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/template-editor/assets');assert.equal(options.body,file);return Response.json({src:'/api/template-editor/assets/'+'a'.repeat(64),previewSrc:'data:image/webp;base64,UklGRgAAAABXRUJQ',width:6000,height:4000,bytes:file.size});};
  assert.equal((await client.prepareRasterAsset(file)).width,6000);
  globalThis.fetch=async()=>{throw new Error('offline');};
  await assert.rejects(client.prepareRasterAsset(file),/preserve its original quality/);
});
test('portable archive validates the original hash and restores only assets in selected projects',async t=>{
  const archive=load('lib/template-editor/media-archive.ts'),previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  const bytes=new Uint8Array([1,2,3,4]),id=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const zip=new JSZip();zip.file('library.json',JSON.stringify({version:2}));zip.file('manifest.json',JSON.stringify({version:1,assets:[{id,path:`assets/${id}`,mimeType:'image/png',bytes:4}]}));zip.file(`assets/${id}`,bytes);
  const file=new File([await zip.generateAsync({type:'uint8array'})],'test.engine.zip');
  const result=await archive.readLibraryArchive(file);let calls=0;
  globalThis.fetch=async(_url,options)=>{calls++;assert.deepEqual(new Uint8Array(options.body),bytes);return Response.json({id});};
  await result.restoreMedia({designs:[]});assert.equal(calls,0);
  await result.restoreMedia({designs:[{src:`/api/template-editor/assets/${id}`} ]});assert.equal(calls,1);
  zip.file(`assets/${id}`,new Uint8Array([9,9,9,9]));
  const damaged=await archive.readLibraryArchive(new File([await zip.generateAsync({type:'uint8array'})],'bad.zip'));
  await assert.rejects(damaged.restoreMedia({src:`/api/template-editor/assets/${id}`}),/damaged/);assert.equal(calls,1);
  zip.file('../../outside','no');
  await assert.rejects(archive.readLibraryArchive(new File([await zip.generateAsync({type:'uint8array'})],'bad.zip')),/unexpected/);
});
test('original-image HTTP endpoints authenticate, enforce origin and streamed byte limits',async()=>{
  let owner=null,stored=0;
  const media={MAX_ORIGINAL_BYTES:4,storeOriginalAsset:async(actual,bytes)=>{assert.equal(actual,'a');stored++;return {id:'a'.repeat(64),bytes:bytes.length,width:4,height:2,mimeType:'image/png'};},originalPreview:async()=> 'data:image/webp;base64,UklGRgAAAABXRUJQ'};
  const route=load('app/api/template-editor/assets/route.ts',{'@/lib/engine/member':{resolveEngineAccess:async()=>owner},'@/lib/template-editor/media-storage':media});
  const request=(headers={},body='abc')=>new Request('https://engine.test/api/template-editor/assets',{method:'POST',headers,body});
  assert.equal((await route.POST(request())).status,401);
  owner={ownerKey:'a'};
  assert.equal((await route.POST(request({origin:'https://other.test'}))).status,403);
  assert.equal((await route.POST(request({},'12345'))).status,413);
  assert.equal(stored,0);
  const response=await route.POST(request({origin:'https://engine.test'}));assert.equal(response.status,200);assert.equal(stored,1);assert.match(response.headers.get('cache-control'),/private.*no-store/);
  const read=load('app/api/template-editor/assets/[id]/route.ts',{'@/lib/engine/member':{resolveEngineAccess:async()=>owner},'@/lib/template-editor/media-storage':{readOriginalAsset:async(actual)=>actual==='a'?{data:Buffer.from('abc'),mimeType:'image/png',bytes:3}:null}});
  const context={params:Promise.resolve({id:'a'.repeat(64)})};
  owner=null;assert.equal((await read.GET(request(),context)).status,401);
  owner={ownerKey:'b'};assert.equal((await read.GET(request(),context)).status,404);
  owner={ownerKey:'a'};const original=await read.GET(request(),context);assert.equal(await original.text(),'abc');assert.equal(original.headers.get('x-content-type-options'),'nosniff');
  assert.equal((await read.GET(new Request('https://engine.test/api/template-editor/assets/a?maxDimension=8193'),context)).status,400);
  assert.equal((await read.GET(new Request('https://engine.test/api/template-editor/assets/a?maxDimension='),context)).status,400);
});
test('public reading follows authored order and excludes hidden, transparent, off-page and private image notes',()=>{
  const make=(type,patch)=>({...model.createCanvasElement(type,patch),id:patch.id});
  const accessibility=loadCached('lib/template-editor/public-accessibility.ts');
  const design=model.createBlankDesign('Public reading','portrait'),page=design.pages[0];
  const text=(id,x,y,patch={})=>make('text',{id,name:'Internal '+id,text:id,x,y,width:60,height:25,...patch});
  const image=make('image',{id:'photo',src:'https://example.com/photo.png',name:'Private filename',directive:'Private directive',rightsNote:'Private contract',publicAlt:'A blue mountain at dawn',x:0,y:80,width:60,height:60});
  design.masterScene={background:'transparent',elements:[text('master-heading',0,0)]};
  page.publicDescription='A poster about exploring outdoors';page.readingOrder=['photo','master-heading','heading'];
  page.canvas={background:'#fff',groups:[{id:'hidden-group',name:'Secret',locked:false,hidden:true},{id:'invisible-group',name:'Invisible',locked:false,opacity:0}],elements:[text('heading',0,35),text('hidden',0,0,{groupId:'hidden-group'}),text('invisible',0,0,{groupId:'invisible-group'}),text('outside',700,0),text('zero',0,0,{opacity:0}),image,make('image',{id:'decorative',src:'https://example.com/photo.png',name:'Private decorative',x:90,y:80,width:40,height:40})]};
  assert.deepEqual(accessibility.publicReadingSequence(design,page),[{id:'photo',text:'A blue mountain at dawn'},{id:'master-heading',text:'master-heading'},{id:'heading',text:'heading'}]);
  assert.equal(accessibility.pageReadingItems(design,page).filter(item=>item.missingAlt).length,1);
  const serialized=JSON.stringify(accessibility.publicReadingSequence(design,page));assert.doesNotMatch(serialized,/Private|outside|hidden|invisible/);
  const fill=commands.fillShapeWithImage({background:'#fff',elements:[make('shape',{id:'frame'})]},'frame',image).scene.elements[0].imageFill;
  assert.equal(fill.publicAlt,'A blue mountain at dawn');assert.equal(fill.directive,'Private directive');
});
test('explicit public descriptions survive the library parser with bounded text and unique reading order',()=>{
  const design=model.createBlankDesign('Accessibility','square'),page=design.pages[0];
  page.publicDescription='A public description';page.readingOrder=['photo'];page.canvas.elements=[{...model.createCanvasElement('image',{src:'https://example.com/photo.png',publicAlt:'A smiling dog'}),id:'photo'}];
  const library={...model.EMPTY_LIBRARY,designs:[design]};
  const parsed=model.parseLibrary(library);assert.equal(parsed.designs[0].pages[0].publicDescription,'A public description');assert.equal(parsed.designs[0].pages[0].canvas.elements[0].publicAlt,'A smiling dog');
  page.readingOrder=['photo','photo'];assert.equal(model.parseLibrary(library),null);
  page.readingOrder=['photo'];page.publicDescription='x'.repeat(5001);assert.equal(model.parseLibrary(library),null);
});
test('presence expires inactive sessions and a delayed heartbeat cannot resurrect a closed tab',()=>{
  const presence=load('lib/template-editor/presence.ts',{'@/lib/supabase/admin':{getAdminSupabase:()=>null},'./development-storage':{}});
  const now=100_000;
  const active=presence.updatePresenceSessions([{id:'expired',documentId:'design',seenAt:1},{id:'other',documentId:'design',seenAt:99_000,sequence:1}],'tab','design',false,now,1);
  assert.deepEqual(active.map(item=>item.id),['other','tab']);
  const closed=presence.updatePresenceSessions(active,'tab','design',true,now+1,3);
  assert.equal(closed.find(item=>item.id==='tab').left,true);
  const delayed=presence.updatePresenceSessions(closed,'tab','design',false,now+2,2);
  assert.equal(delayed.find(item=>item.id==='tab').left,true);
  assert.equal(presence.updatePresenceSessions(delayed,'new','design',false,now+presence.PRESENCE_TTL+3,1).length,1);
});
test('presence tracks active editors independently per owner and document, including concurrent tabs',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'engine-presence-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const presence=load('lib/template-editor/presence.ts',{'@/lib/supabase/admin':{getAdminSupabase:()=>null},'./development-storage':{developmentDirectory:()=>directory,readDevelopmentRecord:async(_kind,name,decode)=>{try{return decode(JSON.parse(await fs.promises.readFile(path.join(directory,name),'utf8')));}catch(error){if(error.code==='ENOENT')return null;throw error;}}}});
  assert.deepEqual(await Promise.all([presence.heartbeatPresence('owner','a','design'),presence.heartbeatPresence('owner','b','design')]),[0,1]);
  assert.equal(await presence.heartbeatPresence('owner','a','design',false,2),1);
  assert.equal(await presence.heartbeatPresence('someone-else','c','design'),0);
  assert.equal(await presence.heartbeatPresence('owner','d','another-design'),0);
  await presence.heartbeatPresence('owner','b','design',true,2);
  assert.equal(await presence.heartbeatPresence('owner','a','design',false,3),0);
});
test('presence API checks authentication and workspace identity before recording a session',async()=>{
  let access=null,calls=0;
  const route=load('app/api/template-editor/presence/route.ts',{'@/lib/engine/member':{resolveEngineAccess:async()=>access},'@/lib/template-editor/persistence':{editorOwnerScope:()=> 'scope-a'},'@/lib/template-editor/presence':{heartbeatPresence:async(owner,id,documentId,leave,sequence)=>{calls++;assert.equal(owner,'owner');assert.equal(sequence,1);return 2;}}});
  const input={sessionId:crypto.randomUUID(),documentId:'design',expectedScope:'scope-a',sequence:1};
  const request=(body=input,origin='https://engine.test')=>new Request('https://engine.test/api/template-editor/presence',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await route.POST(request())).status,401);access={ownerKey:'owner'};
  assert.equal((await route.POST(request({...input,expectedScope:'scope-b'}))).status,403);
  assert.equal((await route.POST(request(input,'https://other.test'))).status,403);
  assert.equal((await route.POST(request({...input,padding:'x'.repeat(5000)}))).status,413);
  assert.equal(calls,0);const result=await route.POST(request());assert.equal((await result.json()).others,2);assert.equal(calls,1);
});

test('export preparation resolves only visible URL photos, deduplicates requests and preserves the saved artwork',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 const {prepareExportDimensions}=loadCached('lib/template-editor/export-dimensions.ts');
 const design=model.createBlankDesign('Legacy URL','square'),page=design.pages[0],src='https://example.com/new-photo.png';
 const first=model.createCanvasElement('image',{src,x:20,y:20,width:100,height:100});
 page.canvas={background:'#fff',elements:[first,{...first,id:'copy',x:150},{...first,id:'hidden',src:'https://example.com/hidden.png',hidden:true},{...first,id:'offscreen',src:'https://example.com/offscreen.png',x:900}]};
 let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/template-editor/assets/metadata');assert.equal(JSON.parse(options.body).src,src);return Response.json({width:6000,height:4000});};
 const prepared=await prepareExportDimensions(design,[page.id]);assert.equal(calls,1);assert.equal(prepared.pages[0].canvas.elements[0].intrinsicWidth,6000);assert.equal(prepared.pages[0].canvas.elements[1].intrinsicHeight,4000);assert.equal(first.intrinsicWidth,undefined);assert.equal(prepared.pages[0].canvas.elements[0].src,src);
 const controller=new AbortController();controller.abort();await assert.rejects(prepareExportDimensions(design,[page.id],{},controller.signal),{name:'AbortError'});assert.equal(calls,1);
 globalThis.fetch=async()=>Response.json({width:50000,height:50000});await assert.rejects(prepareExportDimensions(design,[page.id]),/100-megapixel/);
});
test('private metadata endpoint authenticates and bounds requests while preserving original orientation',async()=>{
 let access=null,fetches=0;
 const bytes=await sharp({create:{width:40,height:20,channels:3,background:'#abc'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const route=load('app/api/template-editor/assets/metadata/route.ts',{'@/lib/engine/member':{resolveEngineAccess:async()=>access},'@/lib/template-editor/media-storage':{readOriginalAsset:async(owner)=>owner==='a'?{width:6000,height:4000}:null},'@/lib/template-editor/review-assets':{fetchOriginalImageBytes:async(src)=>{fetches++;assert.equal(src,'https://example.com/photo.jpg');return bytes;}}});
 const request=(body={src:'https://example.com/photo.jpg'},origin='https://engine.test')=>new Request('https://engine.test/api/template-editor/assets/metadata',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await route.POST(request())).status,401);access={ownerKey:'a'};
 assert.equal((await route.POST(request(undefined,'https://other.test'))).status,403);
 assert.equal((await route.POST(request({src:'x'.repeat(20000)}))).status,413);assert.equal(fetches,0);
 const response=await route.POST(request());assert.deepEqual(await response.json(),{width:20,height:40});assert.match(response.headers.get('cache-control'),/private.*no-store/);
 assert.deepEqual(await(await route.POST(request({src:'/api/template-editor/assets/'+'a'.repeat(64)}))).json(),{width:6000,height:4000});access={ownerKey:'b'};assert.equal((await route.POST(request({src:'/api/template-editor/assets/'+'a'.repeat(64)}))).status,404);
});
test('metadata fetch rejects private hosts before making an image request',async()=>{
 const {fetchOriginalImageBytes}=loadCached('lib/template-editor/review-assets.ts');
 await assert.rejects(fetchOriginalImageBytes('http://127.0.0.1/photo.png'),/private/);
 await assert.rejects(fetchOriginalImageBytes('https://name:password@example.com/photo.png'),/not supported/);
});


test('portable backups store repeated embedded images once and retain legacy compatibility',async()=>{
  const media=loadCached('lib/template-editor/media-archive.ts');
  const design=model.createBlankDesign('Image copies','portrait');
  const src="data:image/png;base64," + Buffer.from("\x89PNG\r\n\x1a\n"+"0".repeat(1_300_000),"binary").toString("base64");
  design.pages[0].canvas.elements=Array.from({length:20},()=>model.createCanvasElement('image',{src}));
  const library={...structuredClone(model.EMPTY_LIBRARY),designs:[design]};
  const encoded=await media.packPortableLibrary(library);
  assert.ok(encoded.length<1_750_000);
  const restored=media.unpackPortableLibrary(JSON.parse(encoded));
  assert.ok(model.parseLibrary(restored));
  assert.deepEqual(restored,library);
  assert.equal(media.unpackPortableLibrary(library),library);
  const broken=JSON.parse(encoded);broken.assets={};
  assert.throws(()=>media.unpackPortableLibrary(broken),/missing/);
});
