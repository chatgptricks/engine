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
});
