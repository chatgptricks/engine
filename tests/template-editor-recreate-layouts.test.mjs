/* Run: node --test tests/template-editor-recreate-layouts.test.mjs
 * Build step E: templates and Save as layout. A slide saved as a layout becomes
 * a page of its post's template (lib/template-editor/saved-layouts.ts): its HTML
 * layers keep the pattern, its text and photo layers become slots, and the
 * designer's page list (describePages) shows it with its "use when" line. The
 * chat's save_layout saves it to the workspace (lib/engine/agents/layouts.ts),
 * in temporary local storage here. Reaction pages draw their posts as HTML
 * platform cards (htmlReactionCards in deck.ts). Nothing leaves the machine. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-layouts-test-"));
test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
const environment={cwd:()=>directory,env:{NODE_ENV:"test"}};
const overrides={"@/lib/supabase/admin":{getAdminSupabase:()=>null}};
const cache=new Map();
function load(relative) {
  const filename=path.join(root,relative);
  if(cache.has(filename))return cache.get(filename).exports;
  const unit={exports:{}};cache.set(filename,unit);
  const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename,
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`,{filename})(name=>{
    if(Object.hasOwn(overrides,name))return overrides[name];
    const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
    if(local)return load(path.relative(root,[local+".ts",local+".tsx",local].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile())));
    return nativeRequire(name);
  },unit,unit.exports,environment);
  return unit.exports;
}

const model=load("lib/template-editor/model.ts");
const decks=load("lib/template-editor/agent-decks.ts");
const layouts=load("lib/template-editor/saved-layouts.ts");
const catalog=load("lib/template-editor/template-catalog.ts");
const platform=load("lib/template-editor/platform-cards.ts");
const htmlLayer=load("lib/template-editor/html-layer.ts");
const pages=load("lib/engine/agents/pages.ts");
const deck=load("lib/engine/agents/deck.ts");
const x=load("lib/engine/x-reactions.ts");
const persistence=load("lib/template-editor/persistence.ts");
const TEMPLATE_ID="chatgptricks-3x4";
const BUILT_IN=model.BUILT_IN_TEMPLATES.find(template=>template.id===TEMPLATE_ID);
const asset=letter=>`/api/template-editor/assets/${letter.repeat(64)}`;
const emptyLibrary=designs=>({...structuredClone(model.EMPTY_LIBRARY),designs});
const parsed=library=>{const result=model.parseLibrary(library);assert.ok(result,"the library parses");return result;};

/** A post on the Text + Media page, with a chart drawn in HTML, a caption the designer added and a logo. */
function chartDeck(id="deck-chart") {
  const document=decks.createAgentDeck({id,name:"AI vs Jobs",templateId:TEMPLATE_ID,caption:"Caption",slides:[
    {templatePage:0,slots:{"cover-headline":"AI VS JOBS"}},
    {templatePage:1,slots:{title:"Job openings fell",body:"Since ChatGPT came out",source:"Source: BLS JOLTS"}},
  ]},model.BUILT_IN_TEMPLATES);
  const elements=document.pages[1].canvas.elements;
  elements.push(
    {type:"html",id:"chart-layer",name:"Chart",x:24,y:200,width:312,height:200,rotation:0,opacity:1,locked:false,html:'<div class="bars"><span style="height:40%"></span></div>',css:".bars{display:flex}",designWidth:936},
    {type:"text",id:"caption-layer",name:"Chart caption",x:24,y:410,width:312,height:20,rotation:0,opacity:1,locked:false,text:"Openings fell 30% since 2022",font:"sfpro",fontSize:14,fontWeight:400,italic:false,underline:false,color:"#F9FFFE",align:"left",lineHeight:1.2,letterSpacing:0},
    {type:"image",id:"logo-layer",name:"OpenAI logo",x:300,y:20,width:30,height:30,rotation:0,opacity:1,locked:false,src:asset("a"),fit:"contain",cropX:50,cropY:50,radius:0,publicAlt:"OpenAI logo",sourceUrl:"https://openai.com/"},
  );
  // The media slot holds a photo of the post's.
  const media=elements.find(element=>element.slot==="media");
  Object.assign(media,{src:asset("f"),publicAlt:"A chart of job openings",intrinsicWidth:1600,intrinsicHeight:900});
  return document;
}
const REQUEST=document=>({pageId:document.pages[1].id,name:"Big chart",useWhen:"One chart carries the slide, with a caption under it"});
const layoutPage=(library,index)=>catalog.libraryTemplates(library).find(template=>template.id===TEMPLATE_ID).pages[index];

test("a slide saved as a layout is a new page of its template, listed with its slots and its use-when line",()=>{
  const document=chartDeck(), library=emptyLibrary([document]);
  const {library:next,saved}=layouts.withSavedLayout(library,document,REQUEST(document));
  assert.deepEqual(saved,{templateId:TEMPLATE_ID,templateName:BUILT_IN.name,pageIndex:BUILT_IN.pages.length,pageCount:BUILT_IN.pages.length+1,name:"Big chart",replaced:false});
  const result=parsed(next), template=catalog.libraryTemplates(result).find(item=>item.id===TEMPLATE_ID);
  // The workspace's copy takes the built-in's place: its own pages first, then the layout.
  // It remembers the built-in it was copied from, so it keeps following it.
  assert.equal(result.templates.length,1);
  assert.equal(result.templates[0].builtInFingerprint,model.templateFingerprint(BUILT_IN));
  assert.deepEqual(template.pages.slice(0,-1).map(page=>page.id),BUILT_IN.pages.map(page=>page.id));
  const page=template.pages.at(-1);
  assert.equal(page.label,"Big chart");
  assert.equal(layouts.layoutUseWhen(page),"One chart carries the slide, with a caption under it");
  assert.deepEqual(page.savedLayout,{useWhen:"One chart carries the slide, with a caption under it"});
  assert.equal(page.publicDescription,undefined);
  // Fresh ids: nothing is shared with the slide.
  const slide=document.pages[1];
  assert.notEqual(page.id,slide.id);
  assert.ok(page.canvas.elements.every(element=>!slide.canvas.elements.some(source=>source.id===element.id)));

  const listed=pages.templatePages(template).at(-1);
  assert.equal(listed.index,BUILT_IN.pages.length);
  assert.deepEqual(listed.savedLayout,{useWhen:"One chart carries the slide, with a caption under it"});
  assert.deepEqual(listed.text.map(slot=>slot.slot),["title","body","chart-caption","source"]);
  assert.deepEqual(listed.photo.map(slot=>slot.slot).sort(),["media","openai-logo"]);
  assert.deepEqual(listed.html,[{name:"Chart"}]);
  assert.equal(listed.cards,0);
  // The caption the designer added is a slot that fits new copy in its box.
  const caption=page.canvas.elements.find(element=>element.slot==="chart-caption");
  assert.equal(caption.text,"Openings fell 30% since 2022");
  assert.equal(caption.textMode,"auto-fit");
  assert.equal(caption.smartText.maxFontSize,14);
  assert.ok(listed.text.find(slot=>slot.slot==="chart-caption").maxCharacters>8);
  // Photos and logos are grey placeholders: no picture of the post stays in the template.
  for (const slot of ["media","openai-logo"]) {
    const frame=page.canvas.elements.find(element=>element.slot===slot);
    assert.match(frame.src,/^data:image\/svg\+xml/);
    assert.equal(frame.templateRole,"media");
    assert.equal(frame.publicAlt,undefined);
    assert.equal(frame.sourceUrl,undefined);
  }
  assert.ok(!JSON.stringify(page.canvas.elements.filter(element=>element.type!=="html")).includes("/api/template-editor/assets/"));
  // The HTML keeps its pattern.
  assert.equal(page.canvas.elements.find(element=>element.type==="html").html,'<div class="bars"><span style="height:40%"></span></div>');
  // The use-when line is the page's, not a layer: the slide's layers are all there is.
  assert.equal(page.canvas.elements.length,slide.canvas.elements.length);

  const described=pages.describePages(pages.templatePages(template));
  assert.match(described,/  Page 9 · Big chart\n    - a layout saved from a slide; use it when: "One chart carries the slide, with a caption under it"\n/);
  assert.match(described,/    - text "chart-caption" \(body\), at most ~\d+ characters, sample: "Openings fell 30% since 2022"/);
  assert.match(described,/    - photo "openai-logo"/);
  assert.match(described,/    - HTML layer "Chart": a design to keep, filled with this post's own data/);
  // The template's own pages read as they did.
  assert.ok(described.startsWith(pages.describePages(pages.templatePages(BUILT_IN))+"\n"));
});

test("the designer can start a slide from a saved layout",()=>{
  const document=chartDeck(), {library}=layouts.withSavedLayout(emptyLibrary([document]),document,REQUEST(document));
  const templates=catalog.libraryTemplates(parsed(library)), index=BUILT_IN.pages.length;
  const built=decks.createAgentDeck({name:"Next post",templateId:TEMPLATE_ID,caption:"",slides:[{templatePage:index,slots:{title:"Rates went up","chart-caption":"Up 5 points",media:asset("9")}}]},templates);
  const elements=built.pages[0].canvas.elements;
  assert.equal(elements.find(element=>element.slot==="title").text,"Rates went up");
  assert.equal(elements.find(element=>element.slot==="chart-caption").text,"Up 5 points");
  assert.equal(elements.find(element=>element.slot==="media").src,asset("9"));
  assert.ok(elements.some(element=>element.type==="html"&&element.name==="Chart"));
});

test("saving under a layout's name replaces it; a template page's name, a draft and a missing template are refused",()=>{
  const document=chartDeck();
  let {library}=layouts.withSavedLayout(emptyLibrary([document]),document,REQUEST(document));
  const first=layoutPage(library,BUILT_IN.pages.length);
  const again=layouts.withSavedLayout(library,document,{pageId:document.pages[0].id,name:"  big CHART ",useWhen:"A photo cover"});
  assert.equal(again.saved.replaced,true);
  assert.equal(again.saved.pageIndex,BUILT_IN.pages.length);
  assert.equal(again.saved.pageCount,BUILT_IN.pages.length+1);
  const replaced=layoutPage(again.library,BUILT_IN.pages.length);
  assert.equal(replaced.id,first.id);
  assert.equal(layouts.layoutUseWhen(replaced),"A photo cover");
  library=again.library;

  const refused=(request,pattern,status,from=document,on=library)=>assert.throws(()=>layouts.withSavedLayout(on,from,request),error=>error instanceof layouts.SavedLayoutError&&pattern.test(error.message)&&error.status===status);
  refused({...REQUEST(document),name:"Cover"},/already has a page called "Cover"/,409);
  refused({...REQUEST(document),name:" "},/Give the layout a name/,400);
  refused({...REQUEST(document),useWhen:""},/when to use the layout/,400);
  refused({...REQUEST(document),pageId:"gone"},/isn't in this post anymore/,404);
  refused(REQUEST(document),/template draft/,400,{...document,purpose:"template"});
  refused(REQUEST(document),/isn't in the workspace anymore/,404,{...document,templateId:"no-such-template"});
  refused(REQUEST(document),/is in Trash/,409,document,catalog.deleteLibraryTemplate(library,TEMPLATE_ID,"2026-11-08T12:00:00.000Z"));
  refused(REQUEST(document),/can't be pages of that template/,400,{...document,format:"square",customSize:undefined});
  // Half of a photo pair can't leave its partner.
  const pair=decks.createAgentDeck({name:"Pair",templateId:TEMPLATE_ID,caption:"",slides:[{templatePage:7,slots:{title:"A",body:"B","wide-photo":asset("7")},photoSize:{width:2400,height:1000}},{templatePage:8,slots:{title:"C",body:"D",source:"E"}}]},model.BUILT_IN_TEMPLATES);
  refused({pageId:pair.pages[0].id,name:"Wide",useWhen:"Wide photos"},/half of a photo that runs across two slides/,400,pair,emptyLibrary([pair]));
});

test("a saved layout's page field and a copy's fingerprint are parsed, and bad ones are refused",()=>{
  const document=chartDeck(), raw=JSON.parse(JSON.stringify(layouts.withSavedLayout(emptyLibrary([document]),document,REQUEST(document)).library));
  assert.deepEqual(parsed(raw).templates[0].pages.at(-1).savedLayout,{useWhen:"One chart carries the slide, with a caption under it"});
  const changed=change=>{const copy=structuredClone(raw);change(copy.templates[0]);return model.parseLibrary(copy);};
  assert.ok(changed(template=>{template.pages.at(-1).savedLayout={useWhen:"x".repeat(model.MAX_SAVED_LAYOUT_USE_WHEN)};}));
  assert.equal(changed(template=>{template.pages.at(-1).savedLayout={useWhen:"x".repeat(model.MAX_SAVED_LAYOUT_USE_WHEN+1)};}),null);
  assert.equal(changed(template=>{template.pages.at(-1).savedLayout={useWhen:"  "};}),null);
  assert.equal(changed(template=>{template.pages.at(-1).savedLayout="yes";}),null);
  assert.equal(changed(template=>{template.builtInFingerprint="Not a fingerprint!";}),null);
  assert.equal(changed(template=>{delete template.builtInFingerprint;}).templates[0].builtInFingerprint,undefined);
});

test("a template holds 20 pages",()=>{
  const document=chartDeck();
  let library=emptyLibrary([document]);
  for (let n=BUILT_IN.pages.length; n<20; n++) library=layouts.withSavedLayout(library,document,{...REQUEST(document),name:`Layout ${n}`}).library;
  assert.equal(parsed(library).templates[0].pages.length,20);
  assert.throws(()=>layouts.withSavedLayout(library,document,{...REQUEST(document),name:"One more"}),/20 pages, the most a template holds/);
  // Over an earlier one by its name still works when the template is full.
  assert.equal(layouts.withSavedLayout(library,document,{...REQUEST(document),name:"layout 9"}).saved.replaced,true);
});

// ── The workspace's copy of a built-in and the built-in's later changes ──────
/** The built-in as a later version of Engine might ship it: a new cover label and a new first text. */
const NEXT_BUILT_IN=(()=>{
  const next=structuredClone(BUILT_IN);
  next.pages[0].label="New cover";
  next.pages[1].canvas.elements.find(element=>element.type==="text").text="A NEW SAMPLE";
  return next;
})();
/** Runs `run` while the built-in is NEXT_BUILT_IN. */
function withNextBuiltIn(run) {
  const at=model.BUILT_IN_TEMPLATES.indexOf(BUILT_IN);
  model.BUILT_IN_TEMPLATES[at]=NEXT_BUILT_IN;
  try { return run(); } finally { model.BUILT_IN_TEMPLATES[at]=BUILT_IN; }
}
const shown=library=>catalog.libraryTemplates(library).find(item=>item.id===TEMPLATE_ID);
/** A copy made by saving REQUEST's layout, read back as storage keeps it. */
function storedCopy(document) {
  return parsed(JSON.parse(JSON.stringify(layouts.withSavedLayout(emptyLibrary([document]),document,REQUEST(document)).library)));
}

test("an untouched copy of a built-in picks up the built-in's later changes",()=>{
  const document=chartDeck(), stored=storedCopy(document);
  // Filing it (tags, a favourite) isn't a change to the built-in's part.
  Object.assign(stored.templates[0],{tags:["mine"],favorite:true});
  withNextBuiltIn(()=>{
    const view=shown(stored);
    assert.equal(view.pages[0].label,"New cover");
    assert.ok(JSON.stringify(view.pages[1]).includes("A NEW SAMPLE"));
    assert.deepEqual(view.pages.slice(0,-1).map(page=>page.id),NEXT_BUILT_IN.pages.map(page=>page.id));
    assert.equal(view.pages.at(-1).label,"Big chart");
    assert.deepEqual([view.tags,view.favorite,view.custom],[["mine"],true,true]);
    assert.equal(view.builtInFingerprint,model.templateFingerprint(NEXT_BUILT_IN));
    // The designer's page list is the new built-in's, then the layout.
    assert.equal(pages.templatePages(view).at(-1).savedLayout.useWhen,"One chart carries the slide, with a caption under it");
    // The next save keeps what people saw, and the copy goes on following the built-in.
    const next=parsed(layouts.withSavedLayout(stored,document,{...REQUEST(document),name:"Second"}).library), copy=next.templates[0];
    assert.equal(copy.pages[0].label,"New cover");
    assert.deepEqual(copy.pages.slice(-2).map(page=>page.label),["Big chart","Second"]);
    assert.equal(copy.builtInFingerprint,model.templateFingerprint(NEXT_BUILT_IN));
    assert.equal(model.templateFingerprint(copy),copy.builtInFingerprint);
    assert.deepEqual(copy.tags,["mine"]);
  });
});

test("an edited built-in page keeps the edit",()=>{
  const document=chartDeck(), edited=storedCopy(document);
  edited.templates[0].pages[1].canvas.elements.find(element=>element.type==="text").text="MY OWN WORDS";
  withNextBuiltIn(()=>{
    // The copy is the person's now: it shows as saved, and no page of the built-in comes back.
    const view=shown(edited);
    assert.equal(view,edited.templates[0]);
    assert.equal(view.pages[0].label,"Cover");
    assert.ok(JSON.stringify(view.pages[1]).includes("MY OWN WORDS"));
    // A layout saved to it now leaves the rest as it is.
    const copy=layouts.withSavedLayout(edited,document,{...REQUEST(document),name:"Second"}).library.templates[0];
    assert.deepEqual(copy.pages.slice(0,-1),edited.templates[0].pages);
    assert.equal(copy.pages.at(-1).label,"Second");
    assert.equal(shown(parsed(JSON.parse(JSON.stringify({...edited,templates:[copy]})))).pages[0].label,"Cover");
  });
  // So does any other change to the built-in's part: its name, a page it lost, a layout moved among its pages.
  const changes=[
    template=>{template.name="My carousel";},
    template=>{template.pages.splice(2,1);},
    template=>{template.pages.splice(1,0,template.pages.pop());},
  ];
  for (const change of changes) {
    const copy=storedCopy(document);
    change(copy.templates[0]);
    withNextBuiltIn(()=>assert.equal(shown(copy),copy.templates[0]));
  }
  // Editing it in the template editor (Update template) keeps its layouts and makes it the person's own.
  const view=shown(storedCopy(document)), updated=model.designAsTemplate(model.editTemplateDesign(view),view.name);
  assert.deepEqual(updated.pages.filter(page=>page.savedLayout).map(page=>page.label),["Big chart"]);
  assert.equal(updated.builtInFingerprint,undefined);
});

test("an older copy with no fingerprint stays as saved",()=>{
  const document=chartDeck(), older=emptyLibrary([document]);
  // Made before copies remembered their built-in: page for page the same as the built-in.
  older.templates=[{...structuredClone(BUILT_IN),custom:true}];
  const stored=parsed(older);
  withNextBuiltIn(()=>{
    assert.equal(shown(stored),stored.templates[0]);
    assert.equal(shown(stored).pages[0].label,"Cover");
    const copy=layouts.withSavedLayout(stored,document,REQUEST(document)).library.templates[0];
    assert.deepEqual(copy.pages.slice(0,-1),stored.templates[0].pages);
    assert.equal(copy.pages.at(-1).label,"Big chart");
    assert.equal(copy.builtInFingerprint,undefined);
  });
});

test("save_layout saves the live slide to the workspace, and the layout survives a reload",async()=>{
  const document=chartDeck("deck-live"), owner="owner-layouts";
  const before=await persistence.getEditorLibrary(owner);
  await persistence.saveEditorLibrary(owner,parsed({...before.library,designs:[document]}),before.revision,"op-deck");
  // The person changed the slide in the editor since it was saved: the live room has the newer caption.
  const live=structuredClone(document);
  live.pages[1].canvas.elements.find(element=>element.id==="caption-layer").text="Openings fell a third";
  overrides["@/lib/template-editor/persistence"]={...persistence,getCollaborationDocument:async(ownerKey,deckId)=>{assert.equal(deckId,"deck-live");return {document:live,state:"",epoch:"1"};}};
  const tools=load("lib/engine/assistant/tools.ts");
  const tool=tools.CHAT_TOOLS.find(item=>item.name==="save_layout");
  const result=await tool.run({slide:2,name:"Big chart",useWhen:"One chart carries the slide"},{ownerKey:owner,deckId:"deck-live",signal:new AbortController().signal,card:()=>{}});
  assert.match(result.content,/Saved slide 2 as the layout "Big chart": page 10 of 10 in the template "@chatgptricks carousel"/);
  // Read back from storage, as a reload or the next Recreate does.
  const stored=(await persistence.getEditorLibrary(owner)).library;
  const template=catalog.libraryTemplates(stored).find(item=>item.id===TEMPLATE_ID), listed=pages.templatePages(template).at(-1);
  assert.equal(listed.label,"Big chart");
  assert.deepEqual(listed.savedLayout,{useWhen:"One chart carries the slide"});
  // Storage kept the copy as it was made, so it still follows the built-in.
  const copy=stored.templates.find(item=>item.id===TEMPLATE_ID);
  assert.equal(copy.builtInFingerprint,model.templateFingerprint(BUILT_IN));
  assert.equal(model.templateFingerprint(copy),copy.builtInFingerprint);
  assert.deepEqual(template.pages.slice(0,-1).map(page=>page.id),BUILT_IN.pages.map(page=>page.id));
  assert.equal(listed.text.find(slot=>slot.slot==="chart-caption").sample,"Openings fell a third");
  assert.deepEqual(listed.html,[{name:"Chart"}]);
  assert.match(pages.describePages(pages.templatePages(template)),/Page 9 · Big chart\n    - a layout saved from a slide; use it when: "One chart carries the slide"/);
  // The post itself is untouched.
  assert.deepEqual(stored.designs.find(item=>item.id==="deck-live").pages.map(page=>page.id),document.pages.map(page=>page.id));
  // A refusal reaches the chat in plain words.
  await assert.rejects(tool.run({slide:2,name:"Cover",useWhen:"Never"},{ownerKey:owner,deckId:"deck-live",signal:new AbortController().signal,card:()=>{}}),/already has a page called "Cover"/);
  await assert.rejects(tool.run({slide:9,name:"Nine",useWhen:"Never"},{ownerKey:owner,deckId:"deck-live",signal:new AbortController().signal,card:()=>{}}),/there's no slide 9/);
});

// ── Reaction pages as HTML platform cards ────────────────────────────────────
const post=(id,author,text,media=null)=>({id,url:`https://x.com/${author.handle}/status/${id}`,author:{verified:true,...author},text,media,createdAt:null,likes:10,reposts:2,replies:1,views:100});
const POSTS=[
  post("1",{name:"Sam Altman",handle:"sama",avatarUrl:asset("b"),badge:"blue"},"We are launching something new today. It is the best model we have made.",{url:asset("c"),width:1200,height:675}),
  post("2",{name:"OpenAI",handle:"OpenAI",avatarUrl:asset("d"),badge:"gold",square:true},"Watch the demo",{url:asset("e"),width:1280,height:720,kind:"video",durationMs:45000}),
];
const reactionDeck=(posts,templatePage)=>{
  const slots=Object.assign({title:"What people said"},...posts.map((item,index)=>x.reactionSlots(item,{card:index+1})));
  return decks.createAgentDeck({name:"Reactions",templateId:TEMPLATE_ID,caption:"",slides:[{templatePage,slots}]},model.BUILT_IN_TEMPLATES);
};
const colors=text=>[...text.matchAll(/#[0-9a-f]{3,8}(?![\w-])|rgba?\([^)]*\)/gi)].map(match=>match[0]);

test("a Reaction page's posts become HTML X cards in the native cards' place and flow",()=>{
  const document=reactionDeck(POSTS,5), page=document.pages[0];
  const cards=deck.htmlReactionCards(page,POSTS,3);
  assert.equal(cards.length,2);
  const elements=page.canvas.elements;
  // No native card layer is left: name, text, avatar, badge, play button, the X marks.
  assert.deepEqual(elements.filter(element=>element.slot?.startsWith("reaction-")||element.smartFlow?.after.startsWith("reaction-")).map(element=>element.id),cards.map(card=>card.id));
  assert.ok(!elements.some(element=>element.name==="X logo"||element.name==="X.com"));
  assert.deepEqual(cards.map(card=>[card.type,card.slot,card.designWidth,card.width,card.x]),[["html","reaction-card",936,312,24],["html","reaction-card-2",936,312,24]]);
  assert.deepEqual(cards[0].smartFlow,{after:"title",gap:64/3,bottom:1352/3});
  assert.deepEqual(cards[1].smartFlow,{after:"reaction-card",gap:40/3,bottom:1352/3});
  const sizes=x.reactionPhotoSizes(POSTS);
  POSTS.forEach((item,index)=>assert.equal(cards[index].height,x.reactionCardHeight(x.reactionTextLines(item),sizes[index].height)/3));
  assert.ok(Math.abs(cards[1].y-(cards[0].y+cards[0].height+40/3))<1e-9);
  // The reading order names the cards where the native card text was.
  assert.ok(page.readingOrder.includes(cards[0].id)&&page.readingOrder.includes(cards[1].id));
  assert.ok(page.readingOrder.every(id=>elements.some(element=>element.id===id)));
  // Each card carries the platform mark, keeps its images and check marks when cleaned, and writes out only X's colors.
  for (const card of cards) {
    assert.equal(platform.platformOfLayer(card.html),"x");
    const clean=htmlLayer.cleanHtmlLayer({html:card.html,css:card.css});
    assert.equal(platform.platformOfLayer(clean.html),"x");
    for (const color of colors(clean.html+clean.css)) assert.ok(platform.isPlatformColor("x",color),`${color} is one of X's colors`);
  }
  const [first,second]=cards.map(card=>htmlLayer.cleanHtmlLayer({html:card.html,css:card.css}));
  assert.ok(first.html.includes(`src="${asset("b")}"`)&&first.html.includes(`src="${asset("c")}"`));
  assert.ok(first.html.includes("We are launching something new today."));
  assert.ok(first.html.includes("Sam Altman")&&first.html.includes("@sama"));
  assert.ok(first.html.includes(model.X_BADGES.blue.fill));
  assert.match(second.html,/linearGradient/);
  assert.ok(second.html.includes("0:45"));
  assert.match(second.html,/#1D9BF0/i);
  assert.match(second.css,/\.avatar{[^}]*border-radius:11\.81px/);
  // The deck still parses with the cards in it.
  parsed(emptyLibrary([document]));
});

test("an outside photo is left out of an HTML card and an outside avatar becomes the grey one",()=>{
  const outside=[post("3",{name:"Reporter",handle:"reporter",avatarUrl:"https://pbs.twimg.com/profile_images/1/a.jpg",badge:null,verified:false},"Short post",{url:"https://pbs.twimg.com/media/b.jpg",width:1200,height:800})];
  const document=reactionDeck(outside,4), [card]=deck.htmlReactionCards(document.pages[0],outside,3);
  assert.ok(!card.html.includes("pbs.twimg.com"));
  assert.ok(!card.html.includes('class="media"'));
  assert.match(card.html,/<svg class="avatar"/);
  assert.ok(!card.html.includes('class="badge"'));
  assert.equal(card.height,x.reactionCardHeight(x.reactionTextLines(outside[0]),0)/3);
});

test("a slide with HTML X cards saved as a layout is a Reaction page for as many posts",()=>{
  const document=reactionDeck(POSTS,5);
  deck.htmlReactionCards(document.pages[0],POSTS,3);
  const {library}=layouts.withSavedLayout(emptyLibrary([document]),document,{pageId:document.pages[0].id,name:"Two posts, quiet",useWhen:"Two posts that answer each other"});
  const template=catalog.libraryTemplates(parsed(library)).find(item=>item.id===TEMPLATE_ID), listed=pages.templatePages(template).at(-1);
  assert.equal(listed.cards,2);
  assert.deepEqual(listed.text.map(slot=>slot.slot),["title"]);
  assert.equal(listed.html,undefined);
  assert.equal(pages.reactionPageFor(pages.templatePages(template),2).label,"Two reactions");
  // Filling it again swaps its cards for the new posts'.
  const next=decks.createAgentDeck({name:"Again",templateId:TEMPLATE_ID,caption:"",slides:[{templatePage:listed.index,slots:{title:"Again"}}]},catalog.libraryTemplates(parsed(library)));
  const cards=deck.htmlReactionCards(next.pages[0],[...POSTS].reverse(),3);
  assert.equal(next.pages[0].canvas.elements.filter(element=>element.type==="html").length,2);
  assert.ok(cards[0].html.includes("@OpenAI"));
});

test("a Reddit comment card carries the Reddit mark and only Reddit's colors",()=>{
  const chatgptricks=load("lib/template-editor/chatgptricks-template.ts");
  const card=chatgptricks.redditCardHtml({name:"u/someone",when:"5y ago",text:"I said yes <to> the job.",avatar:"orange"});
  assert.equal(platform.platformOfLayer(card.html),"reddit");
  const clean=htmlLayer.cleanHtmlLayer(card);
  for (const color of colors(clean.html+clean.css)) assert.ok(platform.isPlatformColor("reddit",color),`${color} is one of Reddit's colors`);
  assert.ok(clean.html.includes("I said yes &lt;to&gt; the job."));
  const listedCard={...pages.templatePages({...BUILT_IN,pages:[{...BUILT_IN.pages[3],canvas:{...BUILT_IN.pages[3].canvas,elements:[...BUILT_IN.pages[3].canvas.elements,{type:"html",id:"reddit",name:"Comment",x:24,y:30,width:312,height:100,rotation:0,opacity:1,locked:false,designWidth:936,...card}]}}]})[0]};
  assert.deepEqual(listedCard.html,[{name:"Comment",platform:"reddit"}]);
  assert.match(pages.describePages([listedCard]),/HTML layer "Comment": a Reddit comment card/);
});
