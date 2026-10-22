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
const model=load('lib/template-editor/model.ts'),work=load('lib/template-editor/library-workflows.ts'),advanced=load('lib/template-editor/advanced.ts'),brand=load('lib/template-editor/brand-assets.ts'),research=load('lib/template-editor/research-transfer.ts'),onboarding=load('lib/engine/onboarding-state.ts'),navigation=load('lib/template-editor/use-studio-navigation.ts'),sync=load('lib/template-editor/library-sync.ts');
const library=()=>structuredClone(model.EMPTY_LIBRARY),doc=(name='Project')=>{const result=model.createBlankDesign(name,'portrait');result.pages[0].canvas.elements.push(model.createCanvasElement('text',{text:'Original title'}));return result;};
const photo=(patch={})=>({...model.createCanvasElement('image'),src:'/photo.jpg',intrinsicWidth:6000,intrinsicHeight:4000,...patch});
const options=(patch={})=>({name:'New',format:'square',pageCount:3,layout:'separate',brandKitId:model.DEFAULT_BRAND_KIT_ID,applyBrand:true,...patch});
const story=()=>({id:'story',title:'Headline',description:'Summary',images:[{id:'a',url:'/a.jpg',width:2000,height:1200,directive:'A photo',rightsNote:'Licensed',source:'upload',kind:'editorial',cosmosManual:false},{id:'b',url:'/b.jpg',width:3000,height:1000,directive:'B photo',rightsNote:'Original',source:'upload',kind:'editorial',cosmosManual:false},{id:'video',url:'/movie.mp4',width:1920,height:1080,mediaType:'video',directive:'Clip',rightsNote:'Original',source:'upload',kind:'editorial',cosmosManual:false}],curation:{order:['b','video','a'],selectedImageIds:['a','b'],slideStyles:{},captionEdited:'Edited caption'},caption:{draft:'Original caption',titleOverImage:{text:'Hero title'}}});
function sceneText(design){return (design.continuousCanvas??design.pages[0].canvas).elements.find(element=>element.type==='text');}

test('Brand application preserves geometry/layout and respects inherited lock, style protection and hidden groups',()=>{
 const text=model.createCanvasElement('text'),scene={background:'#fff',layout:{rulers:true,grid:{enabled:true,size:20,columns:3,rows:2,gutter:8}},groups:[{id:'locked',name:'Locked',locked:true},{id:'hidden',name:'Hidden',hidden:true,opacity:.5}],elements:[{...text,id:'locked-text',groupId:'locked'},{...text,id:'hidden-text',groupId:'hidden'},{...text,id:'protected',protected:['style']},{...text,id:'editable',x:80,width:130}]};
 const changed=work.brandScene(scene,{name:'Brand',font:'montserrat',background:'#1234',text:'#abcdef88'});assert.equal(changed.background,'#1234');for(let i=0;i<3;i++)assert.deepEqual(changed.elements[i],scene.elements[i]);assert.equal(changed.elements[3].font,'montserrat');assert.equal(changed.elements[3].color,'#abcdef88');assert.equal(changed.elements[3].x,80);assert.deepEqual(changed.layout,scene.layout);assert.deepEqual(changed.groups,scene.groups);
});

test('creation controls preserve format, page count, custom size, layout and chosen Brand',()=>{
 const lib=library();lib.brandKits.push({...lib.brandKits[0],id:'second-brand',name:'Second',background:'#1234',text:'#abcd',font:'montserrat'});
 const created=work.createLibraryDesign(lib,options({brandKitId:'second-brand',layout:'continuous',size:{width:1920,height:1080}}));assert.equal(created.pages.length,3);assert.deepEqual(model.formatDimensions(created),{width:1920,height:1080});assert.ok(created.continuousCanvas);assert.equal(created.continuousCanvas.background,'#1234');assert.ok(created.continuousCanvas.elements.filter(element=>element.type==='text').every(element=>element.font==='montserrat'));assert.ok(model.parseLibrary({...lib,designs:[created]}));
 assert.throws(()=>work.createLibraryDesign(lib,options({pageCount:1,layout:'continuous'})),/two pages/);
});

test('gallery creation instantiates template fields and enforces required values instead of saving placeholders',()=>{
 const lib=library(),template=model.designAsTemplate(doc(),'Parameterized'),field={id:'headline-field',name:'headline',type:'text',required:true,maxLength:20};template.parameters=[field];template.pages[0].canvas.elements.find(element=>element.type==='text').text='{{headline}}';lib.templates=[template];
 assert.throws(()=>work.createLibraryDesign(lib,options({template,values:{}})),/Provide a value/);
 const result=work.createLibraryDesign(lib,options({template,values:{headline:'Real title'},applyBrand:false,pageCount:1}));assert.equal(sceneText(result).text,'Real title');assert.throws(()=>work.createLibraryDesign(lib,options({template,values:{headline:'x'.repeat(21)}})),/20-character/);
});

test('saving an image into Brand retains original dimensions, rights, provenance, preview and public alt',async()=>{
 const image=photo({width:50,height:50,directive:'Portrait source',rightsNote:'Licensed original',sourceUrl:'https://example.com/source',publicAlt:'Public description',previewSrc:'/preview.jpg',provenance:{source:'upload',imageId:'original-photo',description:'Original photograph',cosmosManual:false}}),asset=await brand.captureBrandImage(image);assert.equal(asset.width,6000);assert.equal(asset.height,4000);assert.equal(asset.src,'/photo.jpg');assert.equal(asset.previewSrc,'/preview.jpg');assert.equal(asset.publicAlt,'Public description');assert.equal(asset.rightsNote,image.rightsNote);assert.deepEqual(asset.provenance,image.provenance);const fill=brand.brandAssetPhoto(asset);assert.equal(fill.intrinsicWidth,6000);assert.equal('id'in fill,false);assert.equal('width'in fill,false);assert.equal(fill.rightsNote,image.rightsNote);
 const lib=library();lib.brandKits[0].assets=[asset];assert.ok(model.parseLibrary(lib));const detached=model.libraryBrandKits(lib);detached[0].assets[0].provenance.source='other';assert.equal(lib.brandKits[0].assets[0].provenance.source,'upload');
});

test('alpha palette and organized asset tags/favorites/light variants survive parsing and moves',()=>{
 const lib=library();lib.brandKits[0].palette=['#abc','#abcd','#abcdef88','transparent'];const asset=brand.imageAsBrandAsset(photo());lib.brandKits[0].assets=[asset];lib.brandKits.push({...structuredClone(lib.brandKits[0]),id:'other-kit',assets:[]});const moved=work.organizeBrandAsset(lib,lib.activeBrandKitId,asset.id,{tags:['logo','launch'],favorite:true,variant:'dark'},'other-kit');assert.equal(moved.brandKits[0].assets.length,0);assert.equal(moved.brandKits[1].assets[0].width,6000);assert.ok(model.parseLibrary(moved));const copied=work.organizeBrandAsset(moved,'other-kit',asset.id,{},model.DEFAULT_BRAND_KIT_ID,true);assert.notEqual(copied.brandKits[0].assets[0].id,asset.id);assert.equal(copied.brandKits[0].assets[0].variant,'dark');assert.equal(copied.activeBrandKitId,lib.activeBrandKitId);
});

test('sanitized SVG logos retain curves, gradient, groups and original vector dimensions',()=>{
 const source='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 200 100"><defs><linearGradient id="grad"><stop offset="0%" stop-color="#123456"/><stop offset="100%" stop-color="#abcdef"/></linearGradient></defs><g opacity="0.5"><path fill="url(#grad)" d="M0 0C0 40 40 40 40 0Z"/><g opacity="0.4"><rect x="15" y="5" width="60" height="50" fill="#ff0000"/></g></g><rect x="80" y="0" width="50" height="50" fill="#000000"/></svg>';
 const asset=brand.prepareVectorBrandAsset(source,'Vector logo');assert.equal(asset.width,1200);assert.equal(asset.height,600);const safe=decodeURIComponent(asset.src.slice(model.BRAND_SVG_PREFIX.length));assert.match(safe,/<g opacity="0.5">/);assert.match(safe,/<g opacity="0.4">/);assert.match(safe,/C0 40 40 40 40 0/);assert.match(safe,/<linearGradient/);assert.ok(model.isSafeBrandSvg(safe));const lib=library();lib.brandKits[0].assets=[asset];assert.ok(model.parseLibrary(lib));assert.ok(model.parseCanvasScene({background:'#fff',elements:[photo({src:asset.src})]}));
});

test('SVG whitelist rejects script, image hrefs, arbitrary CSS, foreignObject, entities and malformed attributes',()=>{
 for(const child of ['<script/>','<foreignObject/>','<image href="https://evil.test/x"/>','<path style="fill:url(https://evil.test)" d="M0 0L1 1Z"/>','<g onclick="x()"/>','<!ENTITY x SYSTEM "file:///etc/passwd">','<path d="M0 0L1 1Z" fill="url(#missing)"/>']){const src=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${child}</svg>`;assert.equal(model.isSafeBrandSvg(src),false,child);assert.equal(model.isSafeBrandSvgUrl(model.BRAND_SVG_PREFIX+encodeURIComponent(src)),false);}
});

test('import previews support selective skip/copy/merge, repeated content dedupe and preserve active Brand',()=>{
 const original=library(),incoming=library();incoming.designs=[doc('Imported')];incoming.brandKits[0]={...incoming.brandKits[0],id:'incoming-kit',name:'Imported Brand',background:'#112233'};incoming.activeBrandKitId='incoming-kit';incoming.brand={name:'Imported Brand',font:'geist',background:'#112233',text:'#263e35'};
 const selection=work.allImportItems(incoming),first=work.importLibrarySelection(original,incoming,selection,'skip');assert.equal(first.designs.length,1);assert.equal(first.activeBrandKitId,original.activeBrandKitId);const second=work.importLibrarySelection(first,incoming,selection,'skip');assert.equal(second.designs.length,1);assert.equal(second.brandKits.length,2);const copies=work.importLibrarySelection(second,incoming,selection,'copies');assert.equal(copies.designs.length,2);assert.notEqual(copies.designs[0].id,copies.designs[1].id);
 const changed=structuredClone(first);changed.designs[0].caption='New caption';const merged=work.importLibrarySelection(first,changed,{...work.allImportItems(changed),brandKits:[]},'merge');assert.equal(merged.designs.length,2);assert.equal(merged.designs.find(item=>item.id===first.designs[0].id).caption,'New caption');assert.ok(merged.designs.some(item=>item.name.includes('before import')&&item.caption===''));assert.ok(model.parseLibrary(merged));
});

test('content dedupe normalizes fresh IDs while retaining group membership and nested relationships',()=>{
 const original=library(),incoming=library(),grouped=doc('Grouped');grouped.pages[0].canvas.groups=[{id:'group-a',name:'A',opacity:.5},{id:'group-b',name:'B',opacity:.8}];grouped.pages[0].canvas.elements[0].groupId='group-a';incoming.designs=[grouped];const selection={...work.allImportItems(incoming),brandKits:[]};const first=work.importLibrarySelection(original,incoming,selection,'skip');const second=work.importLibrarySelection(first,incoming,selection,'skip');assert.equal(second.designs.length,1);incoming.designs[0].pages[0].canvas.elements[0].groupId='group-b';incoming.designs[0].id=crypto.randomUUID();selection.designs=[incoming.designs[0].id];const distinct=work.importLibrarySelection(second,incoming,selection,'skip');assert.equal(distinct.designs.length,2,'different membership changes composition; never dedupe it');
});

test('content search spans canvas text, captions, page labels and names while filters and bulk organization stay independent',()=>{
 const lib=library(),first=doc('Title'),second=doc('Another');first.pages[0].canvas.elements.find(element=>element.type==='text').text='Needle inside canvas';first.pages[0].label='Cover';first.masterScene={background:'transparent',elements:[model.createCanvasElement('text',{text:'Shared needle'})]};first.caption='Caption content';first.tags=['campaign'];first.reviewStatus='approved';lib.designs=[first,second];lib.folders=[{id:'campaign-folder',name:'Campaign'}];assert.ok(work.matchesLibraryItem(first,{folder:'',favorites:false,tag:''},'needle'));assert.ok(work.matchesLibraryItem(first,{folder:'',favorites:false,tag:''},'shared needle'));assert.ok(work.matchesLibraryItem(first,{folder:'',favorites:false,tag:'campaign',review:'approved'},'caption'));assert.equal(work.matchesLibraryItem(second,{folder:'',favorites:false,tag:'campaign'}),false);
 const result=work.bulkLibraryMetadata(lib,lib.designs.map(item=>`design:${item.id}`),{folderId:'campaign-folder',favorite:true,tags:['new']});assert.ok(result.designs.every(item=>item.favorite&&item.folderId==='campaign-folder'&&item.tags.includes('new')));assert.ok(result.designs[0].tags.includes('campaign'));assert.ok(model.parseLibrary(result));assert.equal(work.sortLibraryItems(lib.designs,'name')[0].name,'Another');
});

test('bulk tag edits preserve different folders unless moving or removing folders is explicit',()=>{
 const lib=library(),first=doc('First'),second=doc('Second'),untouched=doc('Unselected');
 lib.folders=[{id:'campaign-a',name:'Campaign A'},{id:'campaign-b',name:'Campaign B'}];
 first.folderId='campaign-a';second.folderId='campaign-b';untouched.folderId='campaign-a';first.tags=['existing'];
 const template={...model.designAsTemplate(doc(),'Reusable'),folderId:'campaign-b',tags:['template']};
 lib.designs=[first,second,untouched];lib.templates=[template];
 const selected=[`design:${first.id}`,`design:${second.id}`,`template:${template.id}`];
 const metadata=work.bulkOrganizationMetadata(null,' launch, ready ');
 assert.equal(Object.hasOwn(metadata,'folderId'),false);
 const tagged=work.bulkLibraryMetadata(lib,selected,metadata);
 assert.deepEqual(tagged.designs.map(item=>item.folderId),['campaign-a','campaign-b','campaign-a']);
 assert.equal(tagged.templates[0].folderId,'campaign-b');
 assert.deepEqual(tagged.designs[0].tags,['existing','launch','ready']);
 assert.deepEqual(tagged.templates[0].tags,['template','launch','ready']);
 assert.deepEqual(tagged.designs[2],untouched);
 const moved=work.bulkLibraryMetadata(tagged,selected,work.bulkOrganizationMetadata('campaign-a',''));
 assert.equal(moved.designs[1].folderId,'campaign-a');assert.equal(moved.templates[0].folderId,'campaign-a');
 const removed=work.bulkLibraryMetadata(moved,selected,work.bulkOrganizationMetadata('',''));
 assert.equal(removed.designs[0].folderId,undefined);assert.equal(removed.designs[1].folderId,undefined);assert.equal(removed.templates[0].folderId,undefined);
 assert.equal(removed.designs[2].folderId,'campaign-a');assert.deepEqual(removed.designs[0].tags,['existing','launch','ready']);
 assert.ok(model.parseLibrary(tagged));assert.ok(model.parseLibrary(removed));
});

test('template browsing ignores project-only filters and preserves the project filter choices',()=>{
 const project={...doc('Approved post'),folderId:'campaign',favorite:true,tags:['launch'],reviewStatus:'approved'};
 const template={...model.designAsTemplate(project,'Reusable'),folderId:'campaign',favorite:true,tags:['launch']};
 const draft={...doc('Template draft'),purpose:'template',folderId:'campaign',favorite:true,tags:['launch']};
 const remembered={folder:'campaign',favorites:true,tag:'launch',format:'portrait',purpose:'post',review:'approved',sort:'name'};
 const original=structuredClone(remembered),forTemplates=work.libraryFiltersForView(remembered,'templates');
 assert.ok(work.matchesLibraryItem(template,forTemplates));assert.ok(work.matchesLibraryItem(draft,forTemplates));
 assert.equal(work.matchesLibraryItem({...template,folderId:'other'},forTemplates),false);
 assert.equal(work.matchesLibraryItem({...template,favorite:false},forTemplates),false);
 assert.equal(work.matchesLibraryItem({...template,tags:[]},forTemplates),false);
 assert.equal(work.matchesLibraryItem({...template,format:'story'},forTemplates),false);
 const forProjects=work.libraryFiltersForView(remembered,'designs');
 assert.ok(work.matchesLibraryItem(project,forProjects));assert.equal(work.matchesLibraryItem(template,forProjects),false);assert.equal(work.matchesLibraryItem(draft,forProjects),false);
 assert.deepEqual(remembered,original);assert.deepEqual(forProjects,original);assert.equal(forTemplates.sort,'name');
});

test('clearing gallery filters retains sort and hidden project choices while removing applicable constraints',()=>{
 const remembered={folder:'campaign',favorites:true,tag:'launch',format:'portrait',purpose:'post',review:'approved',sort:'pages'};
 const templateReset=work.clearLibraryFiltersForView(remembered,'templates');
 assert.deepEqual(templateReset,{folder:'',favorites:false,tag:'',purpose:'post',review:'approved',sort:'pages'});
 const template=model.designAsTemplate(doc(),'Any template');
 assert.ok(work.matchesLibraryItem(template,work.libraryFiltersForView(templateReset,'templates')));
 const project=doc('Draft project');
 assert.equal(work.matchesLibraryItem(project,work.libraryFiltersForView(templateReset,'designs')),false);
 const projectReset=work.clearLibraryFiltersForView(remembered,'designs');
 assert.deepEqual(projectReset,{folder:'',favorites:false,tag:'',sort:'pages'});
 assert.ok(work.matchesLibraryItem(project,projectReset));assert.equal(remembered.folder,'campaign');
});

test('selected export includes only referenced originals/resources instead of unrelated private assets',()=>{
 const lib=library(),first=doc('Selected'),second=doc('Secret');first.pages[0].canvas.elements.push(photo({src:'/used.jpg'}));lib.designs=[first,second];lib.brandKits[0].assets=[{...brand.imageAsBrandAsset(photo({src:'/used.jpg'})),name:'Used'},{...brand.imageAsBrandAsset(photo({src:'/secret.jpg'})),name:'Secret'}];lib.workspaceStyles=[{...advanced.textStyleFromElement(sceneText(first),'Secret style'),id:'secret-style'}];const bundle=work.selectedLibrary(lib,[`design:${first.id}`]);assert.equal(bundle.designs.length,1);assert.equal(bundle.brandKits[0].assets.length,1);assert.equal(bundle.brandKits[0].assets[0].name,'Used');assert.equal(bundle.workspaceStyles.length,0);assert.ok(model.parseLibrary(bundle));
});

test('workspace text styles copy or link across designs and update only linked editable text',()=>{
 const lib=library(),first=doc('Linked'),second=doc('Copy');const source=advanced.textStyleFromElement(sceneText(first),'Global title');source.font='montserrat';source.color='#abcdef';lib.workspaceStyles=[source];const linked=work.insertWorkspaceStyle(first,first.pages[0].canvas,[sceneText(first).id],first.pages[0].id,source,true),copy=work.insertWorkspaceStyle(second,second.pages[0].canvas,[sceneText(second).id],second.pages[0].id,source,false);lib.designs=[linked,copy];const result=work.saveWorkspaceResource(lib,'style',{...source,color:'#112233'});assert.equal(sceneText(result.designs[0]).color,'#112233');assert.equal(sceneText(result.designs[1]).color,'#abcdef');assert.ok(model.parseLibrary(result));const detached=work.removeWorkspaceResource(result,'style',source.id);assert.equal(detached.designs[0].styles[0].workspaceSourceId,undefined);assert.equal(sceneText(detached.designs[0]).color,'#112233');
});

test('workspace components insert as independent or linked instances and propagate linked updates',()=>{
 const lib=library(),first=doc('Linked'),second=doc('Copy'),component=advanced.componentFromSelection(first.pages[0].canvas,[sceneText(first).id],'Title block');lib.workspaceComponents=[component];const linked=work.insertWorkspaceComponent(first,first.pages[0].canvas,first.pages[0].id,component,true),copy=work.insertWorkspaceComponent(second,second.pages[0].canvas,second.pages[0].id,component,false);lib.designs=[linked.design,copy.design];const updated=structuredClone(component);updated.scene.elements[0].text='New shared title';const result=work.saveWorkspaceResource(lib,'component',updated);assert.equal(result.designs[0].pages[0].canvas.elements.find(element=>element.componentId===linked.design.components[0].id).text,'New shared title');assert.notEqual(result.designs[1].pages[0].canvas.elements.find(element=>element.componentId===copy.design.components[0].id).text,'New shared title');assert.ok(model.parseLibrary(result));
});

test('optional workspace resource collections survive patches without old omission deleting them',async()=>{
 const base=library(),style=advanced.textStyleFromElement(sceneText(doc()),'Shared');const next={...base,workspaceStyles:[style]};const patch=await sync.createLibraryPatch(base,next);assert.equal(patch.collections.workspaceStyles.length,1);const result=await sync.applyLibraryPatch(base,patch);assert.equal(result.workspaceStyles[0].name,'Shared');const legacy=structuredClone(result);delete legacy.workspaceStyles;const omission=await sync.createLibraryPatch(result,legacy);assert.equal(omission.collections.workspaceStyles,undefined);assert.equal(model.parseLibrary(base).workspaceStyles,undefined);
});

test('project/folder URLs validate current workspace references and maintain view when linked',()=>{
 const first=doc();const state=navigation.parseStudioLocation(`?view=templates&design=${first.id}&folder=folder`,[first],[{id:'folder'}]);assert.deepEqual(state,{view:'templates',designId:first.id,folder:'folder'});assert.deepEqual(navigation.parseStudioLocation('?view=evil&design=foreign&folder=foreign',[first],[]),{view:'designs',designId:null,folder:''});const url=navigation.studioLink(state,'https://example.com/admin/engine?from=research');assert.match(url,/view=templates/);assert.match(url,/design=/);assert.equal(new URL(url).searchParams.has('from'),false);
});

test('onboarding draft resumes form fields and step while rejecting expired or oversized drafts',()=>{
 const now=Date.now(),draft={step:2,name:'User',email:'user@example.test',channelName:'Brand',handle:'brand',savedAt:now};assert.deepEqual(onboarding.parseOnboardingDraft(draft,now),draft);assert.equal(onboarding.parseOnboardingDraft({...draft,savedAt:now-86_400_001},now),null);assert.equal(onboarding.parseOnboardingDraft({...draft,email:'x'.repeat(201)},now),null);assert.equal(onboarding.parseOnboardingDraft({...draft,step:9},now),null);
});

test('Research preflight preserves explicit photo order and metadata, excludes video and provides text-only output',()=>{
 const source=story(),lib=library(),result=research.createResearchDesign(source,{imageIds:['a','b'],format:'square',brandKitId:lib.activeBrandKitId,applyBrand:true},lib);assert.equal(result.format,'square');assert.equal(result.pages.length,2);assert.equal(result.caption,'Edited caption');assert.equal(result.pages[0].canvas.elements.find(element=>element.type==='image').src,'/a.jpg');assert.equal(result.pages[1].canvas.elements.find(element=>element.type==='image').src,'/b.jpg');assert.equal(result.pages[0].canvas.elements.find(element=>element.type==='image').rightsNote,'Licensed');assert.deepEqual(research.researchImageIds(source),['b','a']);assert.throws(()=>research.createResearchDesign(source,{imageIds:['video'],format:'portrait',brandKitId:lib.activeBrandKitId,applyBrand:false},lib),/no longer available/);assert.equal(research.createResearchDesign(source,{imageIds:[],format:'story',brandKitId:lib.activeBrandKitId,applyBrand:false},lib).pages.length,1);
});

test('Research template preflight repeats chosen layouts and maps photos into editable frames',()=>{
 const lib=library(),template=model.designAsTemplate(doc(),'Frame');template.pages[0].canvas.elements.push(photo());lib.templates=[template];const result=research.createResearchDesign(story(),{imageIds:['b','a'],format:'portrait',brandKitId:lib.activeBrandKitId,applyBrand:false,template,values:{}},lib);assert.equal(result.pages.length,2);assert.equal(result.pages[0].canvas.elements.find(element=>element.type==='image').src,'/b.jpg');assert.equal(sceneText(result).text,'Hero title');template.pages[0].canvas.elements.find(element=>element.type==='image').protected=['content'];assert.throws(()=>research.createResearchDesign(story(),{imageIds:['a'],format:'portrait',brandKitId:lib.activeBrandKitId,applyBrand:false,template},lib),/editable photo/);
});

test('Research transfer remains pending after read/rejection and acknowledges only accepted matching project and owner',()=>{
 const storage=new Map();globalThis.sessionStorage={setItem:(key,value)=>storage.set(key,value),getItem:key=>storage.get(key)??null,removeItem:key=>storage.delete(key)};const document=research.createResearchDesign(story());research.transferResearchDocument(document,'owner-a');assert.equal(research.peekResearchTransfer('owner-b'),null);assert.equal(research.peekResearchTransfer('owner-a').id,document.id);assert.equal(storage.size,1);assert.equal(research.acknowledgeResearchTransfer('wrong-id'),false);assert.equal(storage.size,1);assert.equal(research.consumeResearchTransfer().id,document.id);assert.equal(storage.size,1);assert.equal(research.acknowledgeResearchTransfer(document.id),true);assert.equal(storage.size,0);
});

test('accessibility metadata remaps copied IDs and removes stale reading references without rejecting autosave',()=>{
 const original=doc(),element=sceneText(original);original.pages[0].publicDescription='A public page';original.pages[0].readingOrder=[element.id,'deleted-object'];original.pages[0].canvas.elements.push(photo({publicAlt:'Artwork'}));const parsed=model.parseLibrary({...library(),designs:[original]});assert.ok(parsed);assert.deepEqual(parsed.designs[0].pages[0].readingOrder,[element.id]);const copy=model.cloneDesign(parsed.designs[0]);assert.equal(copy.pages[0].publicDescription,'A public page');assert.notEqual(copy.pages[0].readingOrder[0],element.id);assert.ok(copy.pages[0].canvas.elements.some(item=>item.id===copy.pages[0].readingOrder[0]));const page=model.duplicatePage(parsed.designs[0].pages[0]);assert.notEqual(page.readingOrder[0],element.id);assert.ok(model.parseLibrary({...library(),designs:[copy]}));
});

test('Brand merge updates matching asset metadata and retains assets omitted from the incoming kit',()=>{const current=library(),incoming=library(),asset=brand.imageAsBrandAsset(photo());current.brandKits[0].assets=[asset,{...brand.imageAsBrandAsset(photo({src:'/other.jpg'})),name:'Other'}];incoming.brandKits[0].assets=[{...asset,favorite:true,tags:['imported']}];const result=work.importLibrarySelection(current,incoming,{...work.allImportItems(incoming),designs:[],templates:[]},'merge');assert.equal(result.brandKits[0].assets.length,2);assert.equal(result.brandKits[0].assets[0].id,asset.id);assert.equal(result.brandKits[0].assets[0].favorite,true);assert.deepEqual(result.brandKits[0].assets[0].tags,['imported']);assert.ok(model.parseLibrary(result));});

test('merge keeps current review-link management private and copies never inherit imported review tokens',()=>{const current=library(),project=doc('Managed');project.reviewLinks=[{id:'review-link',url:'/review/existing',expiresAt:'2026-12-01T12:00:00.000Z'}];current.designs=[project];const incoming=structuredClone(current);incoming.designs[0].caption='New artwork';incoming.designs[0].reviewLinks=[{id:'foreign-link',url:'/review/foreign',expiresAt:'2026-12-01T12:00:00.000Z'}];const selection={...work.allImportItems(incoming),brandKits:[]};const merged=work.importLibrarySelection(current,incoming,selection,'merge');assert.deepEqual(merged.designs.find(item=>item.id===project.id).reviewLinks,project.reviewLinks);assert.equal(merged.designs.find(item=>item.id!==project.id).reviewLinks,undefined);const copied=work.importLibrarySelection(current,incoming,selection,'copies');assert.equal(copied.designs.find(item=>item.id!==project.id).reviewLinks,undefined);});

test('workspace components keep literal artwork while detaching document-only style and slot references',()=>{const lib=library(),source=doc(),component=advanced.componentFromSelection(source.pages[0].canvas,[sceneText(source).id],'Independent');component.scene={background:'transparent',elements:[{...model.createCanvasElement('text'),textStyleId:'local-style',colorRoleId:'local-color',slot:'local-field'}]};const result=work.saveWorkspaceResource(lib,'component',component);const text=result.workspaceComponents[0].scene.elements[0];assert.equal(text.textStyleId,undefined);assert.equal(text.colorRoleId,undefined);assert.equal(text.slot,undefined);assert.equal(text.font,component.scene.elements[0].font);assert.ok(model.parseLibrary(result));});

test('workspace style application refuses protected or non-text selection without adding unused resources',()=>{const design=doc(),text=sceneText(design),style=advanced.textStyleFromElement(text,'Style');design.pages[0].canvas.elements[0].protected=['style'];assert.throws(()=>work.insertWorkspaceStyle(design,design.pages[0].canvas,[text.id],design.pages[0].id,style,true),/editable text/);assert.equal(design.styles,undefined);});

test('workspace components insert inside the active continuous slide instead of silently appearing on page one',()=>{const lib=library(),design=work.createLibraryDesign(lib,options({layout:'continuous',applyBrand:false})),source=doc(),component=advanced.componentFromSelection(source.pages[0].canvas,[sceneText(source).id],'Title');const result=work.insertWorkspaceComponent(design,design.continuousCanvas,design.pages[2].id,component,true);const inserted=result.design.continuousCanvas.elements.find(element=>element.id===result.selectedIds[0]);assert.ok(inserted.x>=720);assert.ok(model.parseLibrary({...lib,designs:[result.design]}));});

test('import copies remap workspace links once in live resources and saved versions, and linked updates remain functional',()=>{
 const current=library(),incoming=library(),project=doc('Linked import'),style=advanced.textStyleFromElement(sceneText(project),'Workspace title');incoming.workspaceStyles=[style];
 const component=advanced.componentFromSelection(project.pages[0].canvas,[sceneText(project).id],'Workspace block');incoming.workspaceComponents=[component];
 let linked=work.insertWorkspaceStyle(project,project.pages[0].canvas,[sceneText(project).id],project.pages[0].id,style,true);
 linked=work.insertWorkspaceComponent(linked,linked.pages[0].canvas,linked.pages[0].id,component,true).design;linked=advanced.saveDesignVersion(linked,'Before import');incoming.designs=[linked];
 const copied=work.importLibrarySelection(current,incoming,work.allImportItems(incoming),'copies'),imported=copied.designs[0];
 assert.equal(imported.styles[0].workspaceSourceId,copied.workspaceStyles[0].id);assert.equal(imported.components[0].workspaceSourceId,copied.workspaceComponents[0].id);
 assert.equal(imported.versions[0].styles[0].workspaceSourceId,copied.workspaceStyles[0].id);assert.equal(imported.versions[0].components[0].workspaceSourceId,copied.workspaceComponents[0].id);
 const updated=work.saveWorkspaceResource(copied,'style',{...copied.workspaceStyles[0],color:'#123456'});assert.equal(sceneText(updated.designs[0]).color,'#123456');assert.ok(model.parseLibrary(copied));const repeated=work.importLibrarySelection(copied,incoming,work.allImportItems(incoming),'skip');assert.equal(repeated.designs.length,1);assert.equal(repeated.workspaceStyles.length,1);assert.equal(repeated.workspaceComponents.length,1);
});

test('importing a template draft preserves authoring purpose and maps its source template',()=>{
 const current=library(),incoming=library(),template=model.designAsTemplate(doc('Source'),'Source template');incoming.templates=[template];incoming.designs=[model.editTemplateDesign(template)];
 const copied=work.importLibrarySelection(current,incoming,work.allImportItems(incoming),'copies');assert.equal(copied.designs[0].purpose,'template');assert.equal(copied.designs[0].editingTemplateId,copied.templates[0].id);assert.equal(copied.designs[0].templateId,copied.templates[0].id);assert.ok(model.parseLibrary(copied));
});

test('template import retains custom description, category and organizational metadata',()=>{
 const current=library(),incoming=library(),template=model.designAsTemplate(doc(),'Editorial');template.description='A carefully authored campaign template';template.category='Editorial launch';template.tags=['launch'];template.favorite=true;incoming.templates=[template];
 const copied=work.importLibrarySelection(current,incoming,work.allImportItems(incoming),'copies').templates[0];assert.equal(copied.description,template.description);assert.equal(copied.category,template.category);assert.deepEqual(copied.tags,['launch']);assert.equal(copied.favorite,true);assert.ok(work.librarySearchText(copied).includes('editorial launch'));
});

test('Research template mapping skips hidden photo and title layers, including inherited visibility',()=>{
 const lib=library(),template=model.designAsTemplate(doc(),'Visible frames'),hiddenTitle={...model.createCanvasElement('text',{text:'Hidden title'}),groupId:'hidden-group'},visibleTitle=model.createCanvasElement('text',{text:'Visible placeholder'}),hiddenPhoto=photo({groupId:'hidden-group',src:'/hidden.jpg'}),visiblePhoto=photo({src:'/visible.jpg'});template.pages[0].canvas={background:'#fff',groups:[{id:'hidden-group',name:'Hidden',hidden:true}],elements:[hiddenTitle,visibleTitle,hiddenPhoto,visiblePhoto]};lib.templates=[template];
 const result=research.createResearchDesign(story(),{imageIds:['a'],format:'portrait',brandKitId:lib.activeBrandKitId,applyBrand:false,template},lib),elements=result.pages[0].canvas.elements;
 assert.equal(elements[0].text,'Hidden title');assert.equal(elements[1].text,'Hero title');assert.equal(elements[2].src,'/hidden.jpg');assert.equal(elements[3].src,'/a.jpg');
});

test('template photo fields discard stale previews/dimensions/credits for new sources across images, frames and whole/word textures',()=>{
 const project=doc('Photo fields'),old={src:'/old.jpg',previewSrc:'/old-preview.jpg',objectFit:'cover',cropX:50,cropY:50,intrinsicWidth:6000,intrinsicHeight:4000,publicAlt:'Old subject',rightsNote:'Old license'},wordId=crypto.randomUUID();
 project.pages[0].canvas.elements=[{...photo(old),slot:'photo-field'},{...model.createCanvasElement('shape'),slot:'photo-field',imageFill:old},{...model.createCanvasElement('text',{text:'Whole title'}),slot:'photo-field',textureFill:old},{...model.createCanvasElement('text',{text:'Word title'}),richText:`<span data-texture-id="${wordId}">Word title</span>`,wordTextures:[{...old,id:wordId,src:'https://images.test/{{slug}}.jpg'}]}];
 const template=model.designAsTemplate(project,'Photo fields');template.parameters=[{id:'photo-field',name:'photo',type:'image'},{id:'slug-field',name:'slug',type:'text'}];const result=advanced.instantiateTemplate(template,{photo:'/new.jpg',slug:'new'}),elements=result.pages[0].canvas.elements;
 for(const picture of [elements[0],elements[1].imageFill,elements[2].textureFill,elements[3].wordTextures[0]]){assert.equal(picture.previewSrc,undefined);assert.equal(picture.intrinsicWidth,undefined);assert.equal(picture.publicAlt,undefined);assert.equal(picture.rightsNote,undefined);}
 assert.equal(elements[0].src,'/new.jpg');assert.equal(elements[3].wordTextures[0].src,'https://images.test/new.jpg');assert.equal(load('lib/template-editor/media-preview.ts').elementWithPreviewAsset(elements[0]).src,'/new.jpg');
 const same=advanced.instantiateTemplate(template,{photo:'/old.jpg',slug:'{{slug}}'}).pages[0].canvas.elements;for(const picture of [same[0],same[1].imageFill,same[2].textureFill,same[3].wordTextures[0]]){assert.equal(picture.previewSrc,'/old-preview.jpg');assert.equal(picture.intrinsicWidth,6000);assert.equal(picture.rightsNote,'Old license');}
});

test('linked component updates retain the overridden original, its matching preview and public alt together',()=>{
 const lib=library(),project=doc('Photo override'),image=photo({previewSrc:'/old-preview.jpg',publicAlt:'Old photo'});project.pages[0].canvas.elements=[image];const component=advanced.componentFromSelection(project.pages[0].canvas,[image.id],'Photo block');lib.workspaceComponents=[component];const linked=work.insertWorkspaceComponent(project,project.pages[0].canvas,project.pages[0].id,component,true).design;
 const instance=linked.pages[0].canvas.elements.find(element=>element.componentId===linked.components[0].id);instance.src='/manual.jpg';instance.previewSrc='/manual-preview.jpg';instance.publicAlt='Manual subject';lib.designs=[linked];const replacement=structuredClone(component);replacement.scene.elements[0].opacity=.75;
 const result=work.saveWorkspaceResource(lib,'component',replacement),updated=result.designs[0].pages[0].canvas.elements.find(element=>element.componentId===linked.components[0].id);assert.equal(updated.src,'/manual.jpg');assert.equal(updated.previewSrc,'/manual-preview.jpg');assert.equal(updated.publicAlt,'Manual subject');assert.equal(load('lib/template-editor/media-preview.ts').elementWithPreviewAsset(updated).src,'/manual-preview.jpg');assert.ok(model.parseLibrary(result));
});

test('Research replacement cannot retain the previous template photo preview but keeps it when the source is unchanged',()=>{
 const lib=library(),template=model.designAsTemplate(doc(),'Research photo'),image=photo({src:'/old.jpg',previewSrc:'/old-preview.jpg',publicAlt:'Old photo'});template.pages[0].canvas.elements.push(image);lib.templates=[template];
 const next=research.createResearchDesign(story(),{imageIds:['a'],format:'portrait',brandKitId:lib.activeBrandKitId,applyBrand:false,template},lib).pages[0].canvas.elements.find(element=>element.type==='image');assert.equal(next.src,'/a.jpg');assert.equal(next.previewSrc,undefined);assert.equal(next.publicAlt,undefined);assert.equal(next.intrinsicWidth,2000);
 const source=story();source.images[0].url='/old.jpg';const same=research.createResearchDesign(source,{imageIds:['a'],format:'portrait',brandKitId:lib.activeBrandKitId,applyBrand:false,template},lib).pages[0].canvas.elements.find(element=>element.type==='image');assert.equal(same.previewSrc,'/old-preview.jpg');assert.equal(same.publicAlt,'Old photo');
});

test('one-click template creation keeps custom dimensions, artwork and the original template',()=>{
 const {templateCreationOptions}=load('lib/template-editor/creation-presets.ts');
 const lib=library(),source=doc('Canva portrait');source.customSize={width:1080,height:1440};
 const template=model.designAsTemplate(source,'Canva portrait');lib.templates=[template];
 const before=structuredClone(template),settings=templateCreationOptions(template,lib),copy=work.createLibraryDesign(lib,settings);
 assert.equal(settings.applyBrand,false);assert.deepEqual(copy.customSize,{width:1080,height:1440});
 assert.equal(copy.pages.length,template.pages.length);assert.equal(sceneText(copy).font,sceneText(source).font);
 assert.equal(sceneText(copy).text,'Original title');assert.deepEqual(template,before);
 assert.notEqual(copy.pages[0].id,template.pages[0].id);
});
