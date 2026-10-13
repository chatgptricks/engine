/* Original uploads are preserved by the real raster client. Only fetch is mocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url),loaded=new Map();
function load(relative){const filename=path.join(root,relative);if(loaded.has(filename))return loaded.get(filename);const unit={exports:{}};loaded.set(filename,unit.exports);const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:filename}).outputText;vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(name=>{if(name.endsWith('.css'))return {};if(name.startsWith('.')||name.startsWith('@/')){const base=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(filename),name);return load(path.relative(root,fs.existsSync(`${base}.ts`)?`${base}.ts`:`${base}.tsx`));}return require(name);},unit,unit.exports);return unit.exports;}
const {prepareBrandAsset}=load('components/template-editor/brand-workspace.tsx');
const file=(patch={})=>({type:'image/png',size:200000,name:'Logo.png',...patch});
function upload(t,result={},status=200){const previous=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({src:`/api/template-editor/assets/${'a'.repeat(64)}`,previewSrc:'data:image/webp;base64,UklGRgAAAABXRUJQ',width:6000,height:4000,bytes:200000,...result}),{status,headers:{'Content-Type':'application/json'}});};t.after(()=>{globalThis.fetch=previous;});return calls;}

test('Brand upload sends the original bytes and retains full dimensions plus a lightweight preview',async t=>{const calls=upload(t),original=file(),asset=await prepareBrandAsset(original,'logo');assert.equal(asset.width,6000);assert.equal(asset.height,4000);assert.equal(asset.src,`/api/template-editor/assets/${'a'.repeat(64)}`);assert.match(asset.previewSrc,/^data:image\/webp;base64,/);assert.equal(calls.length,1);assert.equal(calls[0].options.body,original);assert.equal(calls[0].url,'/api/template-editor/assets');assert.equal(calls[0].options.headers['Content-Type'],'image/png');assert.equal(asset.kind,'logo');assert.match(asset.id,/^[a-f\d-]{36}$/i);});

test('transparent small images retain original size and every reusable asset has a fresh ID',async t=>{upload(t,{width:200,height:100});const first=await prepareBrandAsset(file(),'logo'),second=await prepareBrandAsset(file({name:'x'.repeat(250)}),'image');assert.equal(first.width,200);assert.equal(first.height,100);assert.notEqual(first.id,second.id);assert.equal(second.name.length,200);assert.equal(second.kind,'image');});

test('unsupported raster formats, empty files and oversized uploads do not reach the server',async t=>{const calls=upload(t);for(const type of ['image/gif','text/html',''])await assert.rejects(prepareBrandAsset(file({type}),'logo'),/JPG, PNG, or WebP/);await assert.rejects(prepareBrandAsset(file({size:15*1024*1024+1}),'image'),/15 MB/);await assert.rejects(prepareBrandAsset(file({size:0}),'image'),/1 byte/);assert.equal(calls.length,0);});

test('server rejection and invalid upload metadata fail without creating an unsaveable Brand asset',async t=>{upload(t,{error:'Storage full'},413);await assert.rejects(prepareBrandAsset(file(),'image'),/Storage full/);globalThis.fetch=async()=>new Response(JSON.stringify({src:'https://evil.test/photo',previewSrc:'data:image/webp;base64,UklGRg==',width:300,height:200}),{status:200});await assert.rejects(prepareBrandAsset(file(),'image'),/invalid data/);});

test('offline uploads provide recovery guidance and never silently rasterize an original',async t=>{upload(t);globalThis.fetch=async()=>{throw new TypeError('Offline');};await assert.rejects(prepareBrandAsset(file(),'image'),/Connect to upload.*original quality/);});

test('supported SVG logos stay vectors while executable SVG and oversized vectors are rejected',async t=>{const calls=upload(t),svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path fill="#123456" d="M0 0L100 0L100 100Z"/></svg>';const asset=await prepareBrandAsset(file({name:'Logo.svg',type:'image/svg+xml',size:svg.length,text:async()=>svg}),'logo');assert.match(asset.src,/^data:image\/svg\+xml/);assert.equal(asset.width,200);assert.equal(asset.height,100);assert.equal(calls.length,0);await assert.rejects(prepareBrandAsset(file({name:'X.svg',type:'image/svg+xml',text:async()=>'<svg><script>alert(1)</script></svg>'}),'logo'),/scripts|active|unsupported|Unsafe|unsafe/i);await assert.rejects(prepareBrandAsset(file({name:'X.svg',type:'image/svg+xml',size:1000001}),'logo'),/1 MB/);});
