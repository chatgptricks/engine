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

// Exercise the hook's asynchronous load path with real parsing and reconciliation.
// Browser storage and timers stay controlled so no autosave can touch a server.
async function recoveredWorkspace(t,{remote,drafts,cleanupError=false}){
 const slots=[],effects=[],scheduled=new Map(),requests=[],cached=[],removed=[],persisted=[],stored=new Map(drafts.map(draft=>[draft.key,structuredClone(draft)]));let cursor=0;
 const changed=(slot,deps)=>!slot||!deps||deps.some((value,index)=>!Object.is(value,slot.deps?.[index]));
 const react={
  useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},
  useState(initial){const index=cursor++;slots[index]??={value:typeof initial==='function'?initial():initial};return [slots[index].value,value=>{slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},
  useCallback(callback,deps){const index=cursor++;if(changed(slots[index],deps))slots[index]={value:callback,deps};return slots[index].value;},
  useEffect(work,deps){const index=cursor++;if(changed(slots[index],deps)){const previous=slots[index];slots[index]={deps};effects.push(()=>{previous?.cleanup?.();slots[index].cleanup=work();});}},
 };
 const previousWindow=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};
 t.after(()=>{slots.forEach(slot=>slot?.cleanup?.());if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;});
 t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,...options});return Response.json(remote);});
 t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const handle={};scheduled.set(handle,{callback,delay});return handle;});
 t.mock.method(globalThis,'clearTimeout',handle=>scheduled.delete(handle));
 const {useEditorLibrary:loadWorkspaceHook}=load('lib/template-editor/use-library.ts',{
  react,'./model':model,'./library-sync':sync,'./library-budget':budget,'./incremental-validation':incremental,
  './asset-processing':{prepareSaveOffThread(){assert.fail('A clean recovery must not prepare a server save.');}},
  './recovery-storage':{
   RecoveryMigrationError:class extends Error{},cacheWorkspace:async value=>{cached.push(value);},clearCachedWorkspaceSelection(){},getCachedWorkspace:async()=>null,
   getRecoveryDrafts:async scope=>[...stored.values()].filter(draft=>draft.scope===scope),
   saveRecoveryDraft:async draft=>{persisted.push(draft);stored.set(draft.key,structuredClone(draft));},
   removeExactDraft:async draft=>{removed.push({key:draft.key,stamp:draft.stamp});if(cleanupError)throw Error('Recovery cleanup unavailable');if(stored.get(draft.key)?.stamp===draft.stamp)stored.delete(draft.key);},
  },
 });
 const render=()=>{cursor=0;const state=loadWorkspaceHook(remote.scope);effects.splice(0).forEach(work=>work());return state;};
 render();await new Promise(resolve=>setImmediate(resolve));
 return {state:render(),scheduled,requests,cached,removed,persisted,stored};
}

test('workspace load opts into packed GET and restores assets before parsing or caching',async t=>{
 const image='data:image/png;base64,iVBORw0KGgo=',library=model.parseLibrary({...structuredClone(model.EMPTY_LIBRARY),designs:[doc()]});
 library.designs[0].pages[0].image.url=image;
 library.designs[0].pages[0].canvas.elements=[model.createCanvasElement('image',{src:image,previewSrc:image})];
 const packed=await sync.packAssets(library),scope='d'.repeat(64),assetKeys=Object.keys(packed.assets);
 const run=await recoveredWorkspace(t,{remote:{library:packed.value,assets:packed.assets,assetKeys,revision:'saved-revision',storage:'cloud',scope},drafts:[]});
 assert.equal(run.requests[0].url,'/api/template-editor?packed=1');assert.equal(run.state.status,'saved');assert.equal(run.state.canEdit,true);
 assert.deepEqual(run.state.library,model.parseLibrary(library));
 assert.deepEqual(run.cached,[{library:model.parseLibrary(library),assetKeys,revision:'saved-revision',storage:'cloud',scope}]);
 assert.equal(run.scheduled.size,0);
});

test('missing or malformed packed assets fail load without caching partial artwork',async t=>{
 for(const assets of [{},null,[]])await t.test(JSON.stringify(assets),async t=>{
  const library=model.parseLibrary({...structuredClone(model.EMPTY_LIBRARY),designs:[doc()]});library.designs[0].pages[0].image.url=`engine-asset:${'a'.repeat(64)}`;
  const run=await recoveredWorkspace(t,{remote:{library,assets,revision:'saved-revision',storage:'cloud',scope:'e'.repeat(64)},drafts:[]});
  assert.equal(run.state.ready,true);assert.equal(run.state.canEdit,false);assert.equal(run.state.status,'error');assert.match(run.state.error,/unreadable library/);
  assert.equal(run.cached.length,0);assert.deepEqual(run.state.library,model.EMPTY_LIBRARY);
 });
});

test('a recovered draft already included after reconciliation settles as saved and removes only its exact snapshot',async t=>{
 for(const storage of ['cloud','local'])await t.test(storage,async t=>{
  const base=model.parseLibrary({...structuredClone(model.EMPTY_LIBRARY),folders:[],designs:[doc()]}),local=structuredClone(base);local.designs[0].name='Already saved edit';
  const remoteLibrary=model.parseLibrary({...structuredClone(local),designs:[...local.designs,doc()]});
  const scope='a'.repeat(64),adopted={key:`${scope}:closed-tab`,scope,stamp:'adopted-edit',revision:'old',updatedAt:20,baseline:base,library:local},independent={...adopted,key:`${scope}:other-tab`,stamp:'independent-edit',updatedAt:10,library:base};
  assert.equal(sync.sameContent(local,remoteLibrary),false,'The initial equality shortcut must not handle this fixture');
  const run=await recoveredWorkspace(t,{remote:{library:remoteLibrary,revision:'new',storage,scope},drafts:[adopted,independent]});
  assert.equal(run.state.ready,true);assert.equal(run.state.canEdit,true);assert.equal(run.state.status,storage==='cloud'?'saved':'local');assert.equal(run.state.error,null);
  assert.ok(sync.sameContent(run.state.library,remoteLibrary));assert.equal(run.scheduled.size,0);assert.equal(run.persisted.length,0);
  assert.deepEqual([...run.stored.values()],[independent]);assert.ok(run.removed.some(item=>item.key===adopted.key&&item.stamp===adopted.stamp));
  run.state.retrySave();await new Promise(resolve=>setImmediate(resolve));assert.equal(run.requests.length,1,'No PUT is needed for recovered changes already on the server');
 });
});

test('unmerged recovered changes remain protected and schedule their save',async t=>{
 const base=model.parseLibrary({...structuredClone(model.EMPTY_LIBRARY),folders:[],designs:[doc()]}),local=structuredClone(base),remoteLibrary=model.parseLibrary({...structuredClone(base),designs:[...base.designs,doc()]});local.designs[0].name='Still pending';
 const scope='b'.repeat(64),draft={key:`${scope}:closed-tab`,scope,stamp:'pending',revision:'old',updatedAt:20,baseline:base,library:local};
 const run=await recoveredWorkspace(t,{remote:{library:remoteLibrary,revision:'new',storage:'cloud',scope},drafts:[draft]});
 assert.equal(run.state.status,'saving');assert.equal(run.state.canEdit,true);assert.equal(run.state.library.designs[0].name,'Still pending');assert.equal(run.state.library.designs.length,2);
 assert.equal(run.removed.length,0);assert.deepEqual(run.stored.get(draft.key),draft);assert.equal(run.persisted.length,1);assert.equal(run.scheduled.size,1);
});

test('recovery cleanup failure leaves its safe copy without blocking a confirmed saved workspace',async t=>{
 const base=model.parseLibrary({...structuredClone(model.EMPTY_LIBRARY),folders:[],designs:[doc()]}),local=structuredClone(base);local.designs[0].name='Landed';const remoteLibrary=model.parseLibrary({...structuredClone(local),designs:[...local.designs,doc()]});
 const scope='c'.repeat(64),draft={key:`${scope}:closed-tab`,scope,stamp:'landed',revision:'old',updatedAt:20,baseline:base,library:local};
 const run=await recoveredWorkspace(t,{remote:{library:remoteLibrary,revision:'new',storage:'cloud',scope},drafts:[draft],cleanupError:true});
 assert.equal(run.state.status,'saved');assert.equal(run.state.error,null);assert.deepEqual(run.stored.get(draft.key),draft);assert.equal(run.scheduled.size,0);
});

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

test('private originals use output-aware renditions and remain unchanged in saved artwork',()=>{
 const {prepareExportScene}=load('lib/template-editor/export-renditions.ts'),original='/api/template-editor/assets/'+'a'.repeat(64),image={...model.createCanvasElement('image'),src:original,previewSrc:'EDITOR_PREVIEW',width:360,height:450,intrinsicWidth:6000,intrinsicHeight:4000},scene={background:'#fff',elements:[image]},prepared=prepareExportScene(scene,3);
 assert.equal(prepared.scene.elements[0].src,original+'?maxDimension=2025');assert.equal(prepared.scene.elements[0].previewSrc,'EDITOR_PREVIEW');assert.equal(scene.elements[0].src,original);assert.equal(prepared.pixels,2025*1350);
});
test('source image aggregate is checked before mounting export frames and counts a shared source once',()=>{
 const {prepareExportScene}=load('lib/template-editor/export-renditions.ts'),image={...model.createCanvasElement('image'),width:360,height:450,intrinsicWidth:6000,intrinsicHeight:4000},elements=Array.from({length:30},(_,index)=>({...image,id:'image'+index,src:'/api/template-editor/assets/'+index.toString(16).padStart(64,'0')}));
 assert.throws(()=>prepareExportScene({background:'#fff',elements},6),/64-megapixel/);assert.ok(prepareExportScene({background:'#fff',elements},1).pixels<64_000_000);
 assert.equal(prepareExportScene({background:'#fff',elements:elements.map(image=>({...image,src:elements[0].src}))},6).pixels,4050*2700);
});
test('inactive texture resources and parked images do not block the source memory preflight',()=>{
 const {assertDesignExportBudget}=load('lib/template-editor/export-renditions.ts'),design=doc(),text={...model.createCanvasElement('text'),wordTextures:[{id:'unused',src:'https://example.com/unknown.png',objectFit:'cover',cropX:50,cropY:50}]},parked={...model.createCanvasElement('image'),x:1000,src:'https://example.com/unknown.png'};
 design.pages[0].canvas.elements=[text,parked];assert.doesNotThrow(()=>assertDesignExportBudget(design,{format:'png',scale:3},[design.pages[0].id]));
});
test('live owner feedback polling sends revisions, pauses hidden tabs and aborts after panel close',async()=>{
 const {watchReviewFeedback}=load('lib/template-editor/review-feedback-poller.ts'),calls=[],updates=[];let visible=false;
 const stop=watchReviewFeedback([{id:'review',token:'token'}],(id,comments)=>updates.push([id,comments]),message=>assert.fail(message),{interval:10,visible:()=>visible,fetcher:async url=>{calls.push(url);return Response.json(calls.length===1?{revision:'R1',comments:[{id:'C',text:'New comment'}]}:{revision:'R1',notModified:true});}});
 await new Promise(resolve=>setTimeout(resolve,15));assert.equal(calls.length,0);visible=true;await new Promise(resolve=>setTimeout(resolve,25));stop();const count=calls.length;assert.equal(updates.length,1);assert.ok(calls.at(-1).includes('since=R1'));await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls.length,count);
});
test('closing an owner feedback panel discards its in-flight response',async()=>{
 const {watchReviewFeedback}=load('lib/template-editor/review-feedback-poller.ts');let resolve,changed=0;
 const stop=watchReviewFeedback([{id:'review',token:'token'}],()=>changed++,()=>{}, {visible:()=>true,fetcher:()=>new Promise(done=>{resolve=done;})});await new Promise(done=>setTimeout(done,5));stop();resolve(Response.json({revision:'R1',comments:[]}));await new Promise(done=>setTimeout(done,5));assert.equal(changed,0);
});
