import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),filename=new URL('../lib/template-editor/use-studio-navigation.ts',import.meta.url);
const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function load(react=require('react')){const compiledModule={exports:{}};vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(name=>name==='react'?react:require(name),compiledModule,compiledModule.exports);return compiledModule.exports;}
const navigation=load();
const design=(id='project-a')=>({id,name:id,pages:[1,2,3].map(index=>({id:`${id}-page-${index}`}))});
function memory(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
function browser(t,href){
 const previous=globalThis.window,listeners=new Set(),entries=[href],calls=[],cleanups=[];let index=0;
 const location={href,search:new URL(href).search};
 const change=url=>{location.href=url;location.search=new URL(url).search;};
 const value={location,localStorage:memory(),history:{pushState(data,title,url){assert.equal(data,null);assert.equal(title,'');entries.splice(index+1);entries.push(String(url));index++;calls.push('push');change(String(url));},replaceState(data,title,url){assert.equal(data,null);assert.equal(title,'');entries[index]=String(url);calls.push('replace');change(String(url));}},addEventListener(type,callback){assert.equal(type,'popstate');listeners.add(callback);},removeEventListener(type,callback){assert.equal(type,'popstate');listeners.delete(callback);}};
 globalThis.window=value;t.after(()=>{for(const cleanup of cleanups)cleanup();if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});
 return {window:value,calls,entries,change,cleanup(callback){cleanups.push(callback);},back(){if(index>0){change(entries[--index]);for(const listener of listeners)listener();}},forward(){if(index<entries.length-1){change(entries[++index]);for(const listener of listeners)listener();}}};
}
/** Run the actual navigation hook against deterministic React scheduling and browser history. */
function hook(props){
 const slots=[];let cursor=0,pending=true,result,effects=[],disposed=false;
 const equal=(left,right)=>left&&right&&left.length===right.length&&left.every((value,index)=>Object.is(value,right[index]));
 const react={useState(initial){const index=cursor++;slots[index]??={value:typeof initial==='function'?initial():initial};return [slots[index].value,value=>{const next=typeof value==='function'?value(slots[index].value):value;if(!Object.is(next,slots[index].value)){slots[index].value=next;pending=true;}}];},useRef(initial){const index=cursor++;slots[index]??={current:initial};return slots[index];},useCallback(callback,dependencies){const index=cursor++;if(!equal(slots[index]?.dependencies,dependencies))slots[index]={dependencies,callback};return slots[index].callback;},useEffect(callback,dependencies){const index=cursor++;if(equal(slots[index]?.dependencies,dependencies))return;const previous=slots[index];slots[index]={dependencies,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=callback();});}};
 const {useStudioNavigation}=load(react);
 const NavigationTestComponent=()=>{cursor=0;effects=[];pending=false;result=useStudioNavigation(props.scope,props.ready,props.documents,props.folders);for(const effect of effects)effect();};
 return {get value(){return result;},update(next){props={...props,...next};pending=true;},async flush(){for(let turn=0;turn<20;turn++){if(disposed)return;if(pending)NavigationTestComponent();await Promise.resolve();if(!pending)return;}assert.fail('navigation did not settle');},dispose(){disposed=true;for(const slot of slots)slot?.cleanup?.();}};
}

test('specific page URL survives reload and overrides the remembered page for this project',()=>{
 const project=design(),storage=memory();navigation.rememberProjectPage('owner-a',project.id,project.pages[1].id,storage);
 const state=navigation.parseStudioLocation(`?design=${project.id}&page=${project.pages[2].id}`,[project],[],{scope:'owner-a',storage});assert.equal(state.pageId,project.pages[2].id);
 const href=navigation.studioLink(state,'https://engine.test/admin/engine?from=research');assert.equal(new URL(href).searchParams.get('page'),project.pages[2].id);assert.equal(new URL(href).searchParams.has('from'),false);assert.equal(navigation.parseStudioLocation(new URL(href).search,[project],[],{scope:'owner-a',storage}).pageId,project.pages[2].id);
});

test('last-page memory is isolated by owner and project, and only available documents can restore it',()=>{
 const one=design(),two=design('project-b'),storage=memory();navigation.rememberProjectPage('owner-a',one.id,one.pages[2].id,storage);navigation.rememberProjectPage('owner-a',two.id,two.pages[1].id,storage);navigation.rememberProjectPage('owner-b',one.id,one.pages[0].id,storage);
 assert.equal(navigation.readProjectPage('owner-a',one.id,storage),one.pages[2].id);assert.equal(navigation.readProjectPage('owner-a',two.id,storage),two.pages[1].id);assert.equal(navigation.readProjectPage('owner-b',one.id,storage),one.pages[0].id);assert.equal(navigation.readProjectPage('owner-c',one.id,storage),undefined);
 assert.equal(navigation.parseStudioLocation(`?design=${one.id}`,[one,two],[],{scope:'owner-a',storage}).pageId,one.pages[2].id);assert.equal(navigation.parseStudioLocation(`?design=${one.id}`,[],[],{scope:'owner-a',storage}).designId,null);assert.equal(navigation.parseStudioLocation(`?design=${one.id}`,[{...one,deletedAt:'now'}],[],{scope:'owner-a',storage}).pageId,undefined);
});

test('missing, blocked or exhausted localStorage keeps explicit URLs usable and safely falls back to page one',t=>{
 const project=design(),unavailable={getItem(){throw new Error('Blocked');},setItem(){throw new Error('Quota');}};navigation.rememberProjectPage('owner-a',project.id,project.pages[2].id,unavailable);assert.equal(navigation.readProjectPage('owner-a',project.id,unavailable),undefined);
 const without=navigation.parseStudioLocation(`?design=${project.id}`,[project],[],{scope:'owner-a',storage:unavailable});assert.equal(navigation.resolveDesignPageId(project,without.pageId),project.pages[0].id);
 const explicit=navigation.parseStudioLocation(`?design=${project.id}&page=${project.pages[2].id}`,[project],[],{scope:'owner-a',storage:unavailable});assert.equal(explicit.pageId,project.pages[2].id);
 const previous=globalThis.window;globalThis.window={get localStorage(){throw new Error('Disabled');}};t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;});assert.equal(navigation.browserNavigationStorage(),undefined);
});

test('deleted page IDs fall back deterministically while reordering and continuous layouts retain identity',()=>{
 const project=design(),state={view:'designs',designId:project.id,folder:'',pageId:project.pages[2].id},removed={...project,pages:project.pages.slice(0,2)};
 const normalized=navigation.normalizeStudioPage(state,[removed]);assert.equal(normalized.pageId,project.pages[0].id);assert.equal(navigation.normalizeStudioPage(normalized,[removed]),normalized,'valid fallback produces no navigation loop');assert.equal(navigation.normalizeStudioPage(state,[{...project,pages:project.pages.toReversed()}]),state);
 assert.equal(navigation.parseStudioLocation(`?design=${project.id}&page=deleted`,[removed],[]).pageId,project.pages[0].id);assert.equal(navigation.parseStudioLocation(`?design=${project.id}&page=${project.pages[2].id}`,[{...project,continuousCanvas:{background:'#fff',elements:[]}}],[]).pageId,project.pages[2].id);
});

test('page switches push browser history while structural correction and undo restore replace only the current entry',t=>{
 const project=design(),base={view:'designs',designId:project.id,folder:''},environment=browser(t,navigation.studioLink({...base,pageId:project.pages[0].id},'https://engine.test/admin/engine'));
 navigation.writeStudioLocation({...base,pageId:project.pages[2].id},environment.window.location.href,environment.window.history);assert.equal(environment.entries.length,2);assert.equal(environment.calls.at(-1),'push');
 navigation.writeStudioLocation({...base,pageId:project.pages[0].id},environment.window.location.href,environment.window.history,'replace');assert.equal(environment.entries.length,2);assert.equal(environment.calls.at(-1),'replace');
 const restored=navigation.resolveDesignPageId(project,project.pages[2].id);navigation.writeStudioLocation({...base,pageId:restored},environment.window.location.href,environment.window.history,'replace');assert.equal(environment.entries.length,2);assert.equal(new URL(environment.window.location.href).searchParams.get('page'),project.pages[2].id);
 const callCount=environment.calls.length;navigation.writeStudioLocation({...base,pageId:restored},environment.window.location.href,environment.window.history,'replace');assert.equal(environment.calls.length,callCount);
 const gallery=navigation.studioLink({...base,designId:null},environment.window.location.href);assert.equal(new URL(gallery).searchParams.has('page'),false);
});

test('actual hook restores Back/Forward pages and reopening from gallery without mutating a design',async t=>{
 const project=design(),before=structuredClone(project),environment=browser(t,`https://engine.test/admin/engine?design=${project.id}&page=${project.pages[2].id}`),controller=hook({scope:'owner-a',ready:true,documents:[project],folders:[]});environment.cleanup(()=>controller.dispose());await controller.flush();assert.equal(controller.value.pageId,project.pages[2].id);
 controller.value.setPageId(project.pages[1].id);await controller.flush();assert.equal(controller.value.pageId,project.pages[1].id);environment.back();await controller.flush();assert.equal(controller.value.pageId,project.pages[2].id);environment.forward();await controller.flush();assert.equal(controller.value.pageId,project.pages[1].id);
 controller.value.setView('designs');await controller.flush();assert.equal(controller.value.activeId,null);assert.equal(new URL(environment.window.location.href).searchParams.has('page'),false);controller.value.setActiveId(project.id);await controller.flush();assert.equal(controller.value.pageId,project.pages[1].id);assert.equal(new URL(environment.window.location.href).searchParams.get('page'),project.pages[1].id);assert.deepEqual(project,before);
});

test('actual hook repairs a deleted page with replace and lets undo restore that page in the same entry',async t=>{
 const project=design(),environment=browser(t,`https://engine.test/admin/engine?design=${project.id}&page=${project.pages[2].id}`),controller=hook({scope:'owner-a',ready:true,documents:[project],folders:[]});environment.cleanup(()=>controller.dispose());await controller.flush();const entryCount=environment.entries.length;
 controller.update({documents:[{...project,pages:project.pages.slice(0,2)}]});await controller.flush();assert.equal(controller.value.pageId,project.pages[0].id);assert.equal(environment.entries.length,entryCount);assert.equal(environment.calls.at(-1),'replace');
 controller.update({documents:[project]});controller.value.setPageId(project.pages[2].id,'replace');await controller.flush();assert.equal(controller.value.pageId,project.pages[2].id);assert.equal(environment.entries.length,entryCount);assert.equal(new URL(environment.window.location.href).searchParams.get('page'),project.pages[2].id);
});

test('new-page navigation is not overwritten by stale document data and a continuous reload keeps its current slide',async t=>{
 const project=design(),environment=browser(t,`https://engine.test/admin/engine?design=${project.id}&page=${project.pages[0].id}`),controller=hook({scope:'owner-a',ready:true,documents:[project],folders:[]});environment.cleanup(()=>controller.dispose());await controller.flush();const added={...project,pages:[...project.pages,{id:'new-page'}],continuousCanvas:{background:'#fff',elements:[]}};
 controller.value.setPageId('new-page');controller.update({documents:[added]});await controller.flush();assert.equal(controller.value.pageId,'new-page');const reloaded=hook({scope:'owner-a',ready:true,documents:[added],folders:[]});environment.cleanup(()=>reloaded.dispose());await reloaded.flush();assert.equal(reloaded.value.pageId,'new-page');assert.equal(new URL(environment.window.location.href).searchParams.get('page'),'new-page');
});
