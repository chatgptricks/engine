import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url),cache=new Map();
function load(relative){const file=path.join(root,relative);if(cache.has(file))return cache.get(file);const unit={exports:{}};cache.set(file,unit.exports);const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:file}).outputText;vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename:file})(name=>name.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),`${name}.ts`))):name.startsWith('@/')?load(`${name.slice(2)}.ts`):require(name),unit,unit.exports);return unit.exports;}
const folders=load('lib/template-editor/project-folders.ts'),model=load('lib/template-editor/model.ts'),work=load('lib/template-editor/library-workflows.ts'),navigation=load('lib/template-editor/use-studio-navigation.ts'),decks=load('lib/template-editor/agent-decks.ts');

const pages=[{id:'chatgptricks',name:'ChatGPT Tricks',handle:'@chatgptricks'},{id:'pagina-es',name:'Página ES',handle:'@tu_pagina'}];
const local=(year,month,day=15,hour=12)=>new Date(year,month-1,day,hour).toISOString();
const design=(id,patch={})=>{const result=model.createBlankDesign(id,'portrait');return {...result,id,name:id,createdAt:local(2026,11),updatedAt:local(2026,11),...patch};};
const now=new Date(2026,10,10,12);

test('A design is filed by its page, else by the page tag Recreate gave it, else Unsorted',()=>{
 assert.equal(folders.designPageId(design('a',{pageId:'pagina-es',tags:['recreated','chatgptricks']}),pages),'pagina-es');
 assert.equal(folders.designPageId(design('b',{tags:['recreated','chatgptricks']}),pages),'chatgptricks');
 assert.equal(folders.designPageId(design('c',{tags:['news']}),pages),folders.UNSORTED_PAGE_ID);
 assert.equal(folders.designPageId(design('d'),pages),folders.UNSORTED_PAGE_ID);
 // Moved to Unsorted on purpose: a page tag doesn't file it again.
 assert.equal(folders.designPageId(design('e',{pageId:'unsorted',tags:['chatgptricks']}),pages),folders.UNSORTED_PAGE_ID);
 // A tag that isn't a page (or isn't known yet) doesn't make a folder.
 assert.equal(folders.designPageId(design('f',{tags:['chatgptricks']}),[]),folders.UNSORTED_PAGE_ID);
});

test('Months come from the creation date in local time and read as "November 2026"',()=>{
 assert.equal(folders.monthKey(new Date(2026,10,30,23,59)),'2026-11');
 assert.equal(folders.monthKey(new Date(2026,11,1,0,1)),'2026-12');
 assert.equal(folders.designMonth({createdAt:local(2026,1,1,0)}),'2026-01');
 assert.equal(folders.monthKey('not a date'),'');
 assert.equal(folders.monthLabel('2026-11','en-US'),'November 2026');
 assert.equal(folders.monthLabel('nope'),'Undated');
 assert.equal(folders.isMonthKey('2026-13'),false);
});

test('Every page has a folder, even empty; unknown pages keep theirs; Unsorted comes last and only with designs',()=>{
 const designs=[design('a',{pageId:'chatgptricks'}),design('b',{tags:['pagina-es'],createdAt:local(2026,10)}),design('c',{pageId:'old-page'}),design('gone',{pageId:'chatgptricks',deletedAt:local(2026,11)})];
 const result=folders.pageFolders(designs,pages,now);
 assert.deepEqual(result.map(folder=>[folder.id,folder.count,folder.currentMonthCount]),[['chatgptricks',1,1],['pagina-es',1,0],['old-page',1,1]]);
 assert.equal(result[2].name,'old-page');
 const withUnsorted=folders.pageFolders([...designs,design('d')],pages,now);
 assert.equal(withUnsorted.at(-1).id,'unsorted');assert.equal(withUnsorted.at(-1).name,'Unsorted');
 assert.deepEqual(folders.pageFolders([],pages,now).map(folder=>folder.count),[0,0]);
});

test('A page\'s months start with the current month, even when empty, then older months newest first',()=>{
 const designs=[design('sep',{pageId:'chatgptricks',createdAt:local(2026,9)}),design('oct1',{pageId:'chatgptricks',createdAt:local(2026,10)}),design('oct2',{pageId:'chatgptricks',createdAt:local(2026,10,2)}),design('jan',{pageId:'chatgptricks',createdAt:local(2025,1)}),design('other',{pageId:'pagina-es',createdAt:local(2026,8)})];
 const months=folders.monthFolders(designs,'chatgptricks',pages,now,'en-US');
 assert.deepEqual(months.map(month=>[month.id,month.count,month.current]),[['2026-11',0,true],['2026-10',2,false],['2026-09',1,false],['2025-01',1,false]]);
 assert.equal(months[0].label,'November 2026');
 // A new month starts its own folder automatically.
 const december=folders.monthFolders(designs,'chatgptricks',pages,new Date(2026,11,1,9),'en-US');
 assert.deepEqual(december.map(month=>month.id),['2026-12','2026-10','2026-09','2025-01']);
});

test('A location narrows Projects to a page, then a month; new designs take the folder\'s page',()=>{
 const item=design('a',{pageId:'chatgptricks',createdAt:local(2026,10)});
 assert.equal(folders.inProjectLocation(item,{page:'',month:''},pages),true);
 assert.equal(folders.inProjectLocation(item,{page:'chatgptricks',month:''},pages),true);
 assert.equal(folders.inProjectLocation(item,{page:'chatgptricks',month:'2026-10'},pages),true);
 assert.equal(folders.inProjectLocation(item,{page:'chatgptricks',month:'2026-11'},pages),false);
 assert.equal(folders.inProjectLocation(item,{page:'pagina-es',month:''},pages),false);
 assert.equal(folders.pageForNewDesign({page:'chatgptricks',month:'2026-10'}),'chatgptricks');
 assert.equal(folders.pageForNewDesign({page:'unsorted',month:''}),undefined);
 assert.equal(folders.pageForNewDesign({page:'',month:''}),undefined);
});

test('Moving changes only the page of live designs; the month stays the creation month',()=>{
 const designs=[design('a',{createdAt:local(2026,9)}),design('b',{pageId:'chatgptricks'}),design('c',{deletedAt:local(2026,11)})];
 const moved=folders.moveDesignsToPage(designs,['a','b','c'],'pagina-es','2026-11-10T00:00:00.000Z');
 assert.equal(moved[0].pageId,'pagina-es');assert.equal(moved[0].createdAt,designs[0].createdAt);assert.equal(moved[0].updatedAt,'2026-11-10T00:00:00.000Z');
 assert.equal(moved[1].pageId,'pagina-es');
 assert.equal(moved[2],designs[2]);
 const unchanged=folders.moveDesignsToPage(moved,['a'],'pagina-es');assert.equal(unchanged[0],moved[0]);
});

test('The saved library keeps a design\'s page; a bad page id is rejected and old libraries still load',()=>{
 const library={...structuredClone(model.EMPTY_LIBRARY),designs:[design('a',{pageId:'chatgptricks'}),design('b')]};
 const parsed=model.parseLibrary(JSON.parse(JSON.stringify(library)));
 assert.ok(parsed);assert.equal(parsed.designs[0].pageId,'chatgptricks');assert.equal('pageId'in parsed.designs[1],false);
 assert.equal(model.parseLibrary({...library,designs:[design('a',{pageId:'not a page!'})]}),null);
 assert.equal(model.cloneDesign(parsed.designs[0]).pageId,'chatgptricks');
});

test('Creating from a page folder files the design under that page; templates and Unsorted get none',()=>{
 const library=structuredClone(model.EMPTY_LIBRARY),options={name:'New',format:'square',pageCount:1,layout:'separate',brandKitId:model.DEFAULT_BRAND_KIT_ID,applyBrand:false};
 assert.equal(work.createLibraryDesign(library,{...options,pageId:'chatgptricks'}).pageId,'chatgptricks');
 assert.equal('pageId'in work.createLibraryDesign(library,{...options,pageId:''}),false);
 assert.equal('pageId'in work.createLibraryDesign(library,{...options,pageId:'chatgptricks',purpose:'template'}),false);
});

test('The Projects URL keeps the page and month folder, and drops a month without a page',()=>{
 const parsed=navigation.parseStudioLocation('?project=chatgptricks&month=2026-11',[],[]);
 assert.equal(parsed.project,'chatgptricks');assert.equal(parsed.month,'2026-11');
 assert.equal(navigation.parseStudioLocation('?month=2026-11',[],[]).month,undefined);
 assert.equal(navigation.parseStudioLocation('?project=chatgptricks&month=2026-13',[],[]).month,undefined);
 assert.equal(navigation.parseStudioLocation('?project=../x',[],[]).project,undefined);
 const link=new URL(navigation.studioLink({view:'designs',designId:null,folder:'',project:'pagina-es',month:'2026-10'},'https://engine.test/admin/engine?project=old&month=2026-01'));
 assert.equal(link.searchParams.get('project'),'pagina-es');assert.equal(link.searchParams.get('month'),'2026-10');
 assert.equal(new URL(navigation.studioLink({view:'designs',designId:null,folder:''},link.href)).search,'');
});

test('An agent\'s deck is filed under the page it names',()=>{
 const deck=decks.createAgentDeck({name:'Agent deck',pageId:'chatgptricks',slides:[{title:'Hello'}]});
 assert.equal(deck.pageId,'chatgptricks');
 assert.equal(decks.agentDeckSummary(deck).pageId,'chatgptricks');
 assert.equal('pageId'in decks.createAgentDeck({name:'Agent deck',slides:[{title:'Hello'}]}),false);
 assert.throws(()=>decks.createAgentDeck({name:'Agent deck',pageId:'bad id',slides:[{title:'Hello'}]}));
});
