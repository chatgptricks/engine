import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=fileURLToPath(new URL('..',import.meta.url)),native=createRequire(import.meta.url),cache=new Map();
function load(file,dependencies={}){
 const key=file+Object.keys(dependencies).join();if(!Object.keys(dependencies).length&&cache.has(key))return cache.get(key);
 const filename=path.join(root,file),source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,unit={exports:{}};
 if(!Object.keys(dependencies).length)cache.set(key,unit.exports);
 vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(name=>Object.hasOwn(dependencies,name)?dependencies[name]:name.startsWith('./')?load(path.relative(root,path.resolve(path.dirname(filename),name+'.ts')),dependencies):native(name),unit,unit.exports);return unit.exports;
}
const model=load('lib/template-editor/model.ts'),sync=load('lib/template-editor/library-sync.ts'),merge=load('lib/template-editor/three-way-merge.ts'),budget=load('lib/template-editor/library-budget.ts'),incremental=load('lib/template-editor/incremental-validation.ts');
const doc=()=>model.createBlankDesign('Draft','portrait');
test('recovery baseline merges remote edits without resurrecting a locally deleted document',()=>{
 const base={...structuredClone(model.EMPTY_LIBRARY),designs:[doc(),doc()]},local=structuredClone(base),remote=structuredClone(base);
 local.designs.splice(0,1);remote.designs[1].name='Remote title';
 const restored=sync.reconcileLibraries(base,local,remote);assert.equal(restored.copies,0);assert.equal(restored.library.designs.length,1);assert.equal(restored.library.designs[0].name,'Remote title');
});
test('different fields in the same canvas object merge without a conflict copy',()=>{
 const base={id:'page',elements:[{id:'title',text:'Title',x:10,color:'red'}]},local=structuredClone(base),remote=structuredClone(base);local.elements[0].x=40;remote.elements[0].text='Remote title';
 const result=merge.mergeEntity(base,local,remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.value.elements[0].x,40);assert.equal(result.value.elements[0].text,'Remote title');
});
test('simultaneous inserted layers keep their predecessor and successor anchors',()=>{
 const item=id=>({id}),base=['A','B'].map(item),local=['A','X','B'].map(item),remote=['A','B','Y'].map(item),result=merge.mergeEntity(base,local,remote);
 assert.deepEqual(result.conflicts,[]);assert.deepEqual(result.value.map(item=>item.id),['A','X','B','Y']);
});
test('reorder and insert merge when their ordering constraints agree',()=>{
 const order=merge.mergeOrder(['A','B','C'],['B','A','C'],['A','B','X','C'],new Set(['A','B','C','X']));assert.equal(order.conflict,false);assert.deepEqual(order.ids,['B','A','X','C']);
});
test('contradictory layer insertion anchors remain an explicit conflict',()=>{
 const order=merge.mergeOrder(['A','B'],['B','A'],['A','X','B'],new Set(['A','B','X']));assert.equal(order.conflict,true);
});
test('concurrent delete and edit of the same layer remain a conflict',()=>{
 const result=merge.mergeEntity([{id:'A',text:'old'}],[],[{id:'A',text:'new'}]);assert.ok(result.conflicts.length);
});
test('server patches rebase verified object baselines but reject unverified ones',async()=>{
 const base={...structuredClone(model.EMPTY_LIBRARY),designs:[doc()]};base.designs[0].pages[0].canvas={background:'#fff',elements:[{...model.createCanvasElement('text'),text:'Old'}]};
 const local=structuredClone(base),remote=structuredClone(base);local.designs[0].pages[0].canvas.elements[0].x=60;remote.designs[0].pages[0].canvas.elements[0].text='New';
 const patch=await sync.createLibraryPatch(base,local),result=await sync.applyLibraryPatch(remote,patch);assert.equal(result.designs[0].pages[0].canvas.elements[0].x,60);assert.equal(result.designs[0].pages[0].canvas.elements[0].text,'New');
 patch.collections.designs[0].beforeValue.name='Forged';await assert.rejects(sync.applyLibraryPatch(remote,patch),/another tab/);
});
test('global checkpoint budget prioritizes the newest document regardless of object ordering',()=>{
 const {retainDocumentHistory}=load('lib/template-editor/history-retention.ts'),now=Date.now(),old={id:'old',createdAt:new Date(now-60000).toISOString(),document:{name:'x'.repeat(120)}},fresh={id:'fresh',createdAt:new Date(now).toISOString(),document:{name:'Fresh'}};
 const kept=retainDocumentHistory({old:[old],fresh:[fresh]},new Set(['old','fresh']),now,80);assert.deepEqual(Object.keys(kept),['fresh']);
});
test('purged document checkpoints expire after seven days; active document checkpoints remain',()=>{
 const {retainDocumentHistory}=load('lib/template-editor/history-retention.ts'),now=Date.now(),entry={id:'e',createdAt:new Date(now-8*86400000).toISOString(),document:{name:'Old'}};
 const kept=retainDocumentHistory({purged:[entry],active:[entry]},new Set(['active']),now);assert.equal(kept.purged,undefined);assert.equal(kept.active.length,1);
});
test('automatic retries stop after five, jitter stays bounded and Retry-After is capped',()=>{
 const {saveRetryDelay}=load('lib/template-editor/save-retry.ts');assert.equal(saveRetryDelay(0,0),750);assert.equal(saveRetryDelay(0,1),1250);assert.equal(saveRetryDelay(4,.5),16000);assert.equal(saveRetryDelay(5,.5),null);assert.equal(saveRetryDelay(0,1,999),60000);assert.equal(saveRetryDelay(-1),null);
});
test('incremental parsing retains immutable unrelated document references',()=>{
 const previous=model.parseLibrary({...structuredClone(model.EMPTY_LIBRARY),designs:[doc(),doc()]}),next={...previous,designs:[{...previous.designs[0],name:'Edited'},previous.designs[1]]},parsed=incremental.validateLibraryMutation(previous,next);
 assert.ok(parsed);assert.equal(parsed.designs[1],previous.designs[1]);assert.notEqual(parsed.designs[0],previous.designs[0]);assert.ok(Object.isFrozen(parsed.designs[0]));assert.ok(model.parseLibrary(parsed));
});
test('incremental parsing rejects invalid changed entities before accepting them',()=>{
 const previous=model.parseLibrary({...structuredClone(model.EMPTY_LIBRARY),designs:[doc()]}),changed=structuredClone(previous.designs[0]);changed.pages[0].canvas.layout={grid:{enabled:true,size:10,columns:1.5,rows:1,gutter:0}};
 assert.equal(incremental.validateLibraryMutation(previous,{...previous,designs:[changed]}),null);
 assert.equal(incremental.validateLibraryMutation(previous,{...previous,designs:[previous.designs[0],previous.designs[0]]}),null);
});
test('memoized budget matches actual UTF-8 packed wire size and deduplicates previews',async()=>{
 const image='data:image/png;base64,'+'a'.repeat(12000),value=incremental.freezeValidated({text:'café 🎨',a:{src:image},b:{previewSrc:image},c:{url:image}}),packed=await sync.packAssets(value);
 const measured=budget.checkLibrarySaveBudget(value),expected=new TextEncoder().encode(JSON.stringify({library:packed.value,assets:packed.assets})).length;assert.equal(measured.ok,true);assert.equal(measured.bytes,expected);assert.equal(budget.checkLibrarySaveBudget(value).bytes,expected);
});
test('large metadata saves omit optional merge baselines without modifying the retry patch',()=>{
 const {serializePatchPayload}=load('lib/template-editor/patch-payload.ts'),value={id:'document',metadata:'a'.repeat(7*1024*1024)},patch={version:1,collections:{designs:[{id:'document',beforeHash:'0'.repeat(64),beforeValue:value,value}]},settings:[]},payload={patch,assets:{},revision:null,operationId:'op',expectedScope:'scope',clientSchema:3};
 const text=serializePatchPayload(payload);assert.ok(new TextEncoder().encode(text).length<12*1024*1024);assert.equal(JSON.parse(text).patch.collections.designs[0].beforeValue,undefined);assert.equal(patch.collections.designs[0].beforeValue,value);
});
test('an oversized final save is rejected instead of sent for endless retry',()=>{
 const {serializePatchPayload}=load('lib/template-editor/patch-payload.ts');assert.throws(()=>serializePatchPayload({patch:{version:1,collections:{designs:[{id:'D',beforeHash:'0'.repeat(64),value:{id:'D',text:'x'.repeat(1000)}}]},settings:[]},assets:{},revision:null,operationId:'op',expectedScope:'scope',clientSchema:3},100),/request budget/);
});
test('export scenes discard hidden, transparent and parked pictures while preserving visible shadow contributions',()=>{
 const {frameScene}=load('lib/template-editor/export-scene.ts'),image={...model.createCanvasElement('image'),width:50,height:50,x:500},visible={...image,id:'visible',x:20},shadow={...image,id:'shadow',x:370,shadow:{color:'#000',blur:20,spread:0,offsetX:-30,offsetY:0}},hidden={...visible,id:'hidden',hidden:true},transparent={...visible,id:'transparent',groupId:'invisible'};
 assert.deepEqual(frameScene({background:'#fff',groups:[{id:'invisible',name:'Invisible',opacity:0}],elements:[image,visible,hidden,transparent,shadow]},360,450).elements.map(item=>item.id),['visible','shadow']);
});
test('PDF mode preserves vector basics and requests exact snapshots for unrepresented effects',()=>{
 const {needsPdfRaster,pdfGeometry}=load('lib/template-editor/pdf-options.ts'),text={...model.createCanvasElement('text'),letterSpacing:0},shape={...model.createCanvasElement('shape'),opacity:1};
 assert.equal(needsPdfRaster([text,shape]),false);assert.equal(needsPdfRaster([{...text,gradient:{type:'linear'}}]),true);assert.equal(needsPdfRaster([{...shape,opacity:.5}]),true);assert.equal(needsPdfRaster([text],[{opacity:.5}]),true);assert.equal(needsPdfRaster([{...shape,shape:'path',strokeWidth:2}]),true);
 assert.ok(pdfGeometry(1080,1350,{widthMm:10,dpi:72}).rasterScale<.25);assert.throws(()=>pdfGeometry(1080,1350,{dpi:601}),/DPI/);
});

test('PDF cover downsampling retains the pixels needed by the cropped visible region',()=>{
 const {photoRasterDimension}=load('lib/template-editor/pdf-options.ts');assert.equal(photoRasterDimension(360,450,8000,1000,'cover',2,1),7200);assert.equal(photoRasterDimension(360,450,8000,1000,'contain',2,1),720);
});

test('save worker hashes only the changed entities and serializes the retry body off thread',async()=>{
 const previousSelf=globalThis.self;let response;globalThis.self={postMessage:value=>{response=value;}};
 try{
  load('lib/template-editor/asset-worker.ts');const base={...structuredClone(model.EMPTY_LIBRARY),designs:[doc(),doc()]},next=structuredClone(base);next.designs[0].name='Changed';
  await globalThis.self.onmessage({data:{operation:'save',base,next,known:[],metadata:{revision:null,operationId:'op',expectedScope:'scope',clientSchema:3}}});assert.equal(response.error,undefined);assert.equal(response.result.value.collections.designs.length,1);const payload=JSON.parse(response.result.body);assert.equal(payload.clientSchema,3);assert.equal(payload.patch.collections.designs[0].value.name,'Changed');
 }finally{globalThis.self=previousSelf;}
});

test('typing preserves Retry-After backoff and does not restart an exhausted retry loop',()=>{const {autosaveDelay}=load('lib/template-editor/save-retry.ts');assert.equal(autosaveDelay(60000,false,1000),59000);assert.equal(autosaveDelay(0,false,1000),600);assert.equal(autosaveDelay(60000,true,1000),null);});
