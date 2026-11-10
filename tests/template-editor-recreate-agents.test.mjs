/* Run: node --test tests/template-editor-recreate-agents.test.mjs
 * The first Recreate team's modules, which the current team still builds on
 * until the cleanup: outline clean-up, distinct hooks, the designer, the
 * critics' instructions, X reactions, photos, house checks and their role
 * cards. The current team's flow (the check, the checkpoint, autopilot, fix
 * rounds, reruns, hand-ins, resume) is in template-editor-recreate-flow.
 * Claude, X and the headline model are never called. Local development storage only. */
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
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-agents-test-"));
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

const posts=load("lib/engine/post-files.ts");
const story=load("lib/engine/agents/story.ts");
const deckLib=load("lib/engine/agents/deck.ts");
const review=load("lib/engine/agents/review.ts");
const pagesLib=load("lib/engine/agents/pages.ts");
const playbookLib=load("lib/engine/agents/playbook.ts");
const claude=load("lib/engine/agents/claude.ts");
const model=load("lib/template-editor/model.ts");
const spans=load("lib/template-editor/spanning-photos.ts");
const profiles=load("lib/engine/page-profiles.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const spanish=profiles.builtInPageProfiles().find(item=>item.id==="pagina-es");
const catalog=pagesLib.templatePages(template);
const pageIndex=label=>catalog.find(page=>page.label===label).index;
const COVER=pageIndex("Cover"),MEDIA=pageIndex("Text + Media"),FOLLOW=pageIndex("Follow"),REACTION=pageIndex("Reaction"),REACTIONS=pageIndex("Two reactions"),THREE=pageIndex("Three reactions");
const WIDE=catalog.find(page=>page.pair?.part==="start").index,WIDE_END=catalog.find(page=>page.pair?.part==="end").index;
let owners=0;
const owner=()=>`owner-agents-${++owners}`;

const post=(id,handle,text,likes)=>({id,url:`https://x.com/${handle}/status/${id}`,author:{name:handle.toUpperCase(),handle,avatarUrl:null,verified:false},text,createdAt:"2026-11-03T12:00:00.000Z",likes,reposts:10,replies:5,views:1000,why:"Clear take"});
const BRIEF={topic:"AI and jobs",story:"Stocks rose while US job openings fell after ChatGPT came out.",originalHeadline:"STOCKS UP, JOBS DOWN",angle:"Your job search got harder",
    slides:[{index:1,role:"cover",says:"STOCKS UP, JOBS DOWN",shows:"Photo",keep:"The claim"},{index:2,role:"chart",says:"Chart",shows:"Two lines",keep:"The chart"}],
    chart:null,claims:["Job openings fell 29%"],questions:["Is AI the reason?"],reactionSearch:{terms:["chatgpt jobs"],since:"2026-10-01"},photos:[],risks:[]};

test("normalizeOutline keeps the plan to real pages, built charts and real posts",()=>{
  const slide=(extra)=>({kind:"original",templatePage:MEDIA,purpose:"x",points:[],chartId:null,reactionIds:[],photo:"",...extra});
  const result=story.normalizeOutline({why:"",slides:[
    slide({templatePage:99}),
    slide({chartId:"invented"}),
    slide({chartId:"main"}),
    slide({kind:"reaction",templatePage:REACTIONS,reactionIds:["101","999"]}),
    slide({kind:"reaction",templatePage:REACTION,reactionIds:["101","102"]}),
    slide({kind:"reaction",templatePage:REACTION,reactionIds:[]}),
    slide({kind:"reaction",templatePage:REACTION,reactionIds:["101","102","103","104"]}),
  ]},catalog,{charts:["main"],reactions:["101","102","103","104"]});
  assert.equal(result.slides.length,5,"the unknown page and the empty reaction slide are dropped");
  assert.equal(result.slides[0].chartId,null,"a chart the data stage didn't build is dropped");
  assert.equal(result.slides[1].chartId,"main");
  assert.deepEqual([result.slides[2].templatePage,result.slides[2].reactionIds],[REACTION,["101"]],"one real post left moves to the one-post page");
  assert.deepEqual([result.slides[3].templatePage,result.slides[3].reactionIds],[REACTIONS,["101","102"]],"two posts use the two-post page");
  assert.deepEqual([result.slides[4].templatePage,result.slides[4].reactionIds],[THREE,["101","102","103"]],"three is the most a page holds");
  assert.deepEqual(catalog.filter(page=>page.cards).map(page=>[page.label,page.cards]),[["Reaction",1],["Two reactions",2],["Three reactions",3]]);
  assert.equal(pagesLib.reactionPageFor(catalog,5).index,THREE); assert.equal(pagesLib.reactionPageFor(catalog,0).index,REACTION);
});

test("a photo pair stays two slides in a row, and a lone half becomes a Text + Media slide",()=>{
  assert.deepEqual([catalog[WIDE].pair,catalog[WIDE_END].pair],[{part:"start",with:WIDE_END},{part:"end",with:WIDE}]);
  assert.equal(pagesLib.singlePhotoPage(catalog).index,MEDIA);
  const described=pagesLib.describePages(catalog);
  assert.ok(described.includes(`one landscape photo runs across this page and page ${WIDE_END}`)&&described.includes(`Page ${WIDE_END} always comes right after it`),"the planner reads how the pair works");
  const slide=(extra)=>({kind:"original",templatePage:MEDIA,purpose:"x",points:[],chartId:null,reactionIds:[],photo:"",...extra});
  const result=story.normalizeOutline({why:"",slides:[
    slide({templatePage:WIDE}),slide({templatePage:WIDE_END,photo:"The data center at dusk"}),
    slide({templatePage:WIDE,purpose:"lone first half"}),
    slide({purpose:"between"}),
    slide({templatePage:WIDE_END,purpose:"lone second half"}),
    slide({templatePage:WIDE,chartId:"main"}),slide({templatePage:WIDE_END,purpose:"after the chart"}),
  ]},catalog,{charts:["main"],reactions:[]});
  assert.deepEqual(result.slides.map(item=>item.templatePage),[WIDE,WIDE_END,MEDIA,MEDIA,MEDIA,MEDIA,MEDIA]);
  assert.deepEqual([result.slides[0].photo,result.slides[1].photo],["The data center at dusk",""],"the pair's photo is planned on its first slide");
  assert.equal(result.slides[5].chartId,"main","a chart never runs across two slides: it keeps a slide of its own");
  const cut=story.normalizeOutline({why:"",slides:[...Array.from({length:19},()=>slide()),slide({templatePage:WIDE}),slide({templatePage:WIDE_END})]},catalog,{charts:[],reactions:[]});
  assert.equal(cut.slides.length,20);
  assert.equal(cut.slides[19].templatePage,MEDIA,"a pair cut off at the 20-slide limit keeps its first half as a Text + Media slide");
});

test("distinctHooks drops near-duplicates, even behind a JUST IN: label",()=>{
  const kept=story.distinctHooks([
    {text:"STOCKS NEARLY DOUBLED WHILE JOB OPENINGS FELL 30%"},
    {text:"JUST IN: STOCKS NEARLY DOUBLED WHILE JOB OPENINGS FELL 30%"},
    {text:"Stocks nearly doubled while job openings fell 30%!"},
    {text:"THE JOB MARKET AI CAN'T EXPLAIN"},
    {text:"  "},
  ]);
  assert.deepEqual(kept.map(item=>item.text),["STOCKS NEARLY DOUBLED WHILE JOB OPENINGS FELL 30%","THE JOB MARKET AI CAN'T EXPLAIN"]);
});

test("hook options drop the credit, source and link lines the headline model sometimes sends",()=>{
  const kept=story.distinctHooks([
    {text:'CREDIT: A STUDY BY ANTHROPIC RELEASED IN MARCH 2026, TITLED "LABOR MARKET IMPACTS OF AI: A NEW MEASURE AND EARLY EVIDENCE.'},
    {text:"Source: BLS JOLTS, September 2026"},
    {text:"Photo credit — Reuters"},
    {text:"READ THE STUDY AT https://www.anthropic.com/research"},
    {text:"JUST IN: STOCKS NEARLY DOUBLED WHILE JOB OPENINGS FELL 30%"},
    {text:"SOURCES SAY: OPENAI IS HIRING AGAIN"},
    {text:"THE SOURCE OF THE JOB SLUMP ISN'T AI"},
  ]);
  assert.deepEqual(kept.map(item=>item.text),["JUST IN: STOCKS NEARLY DOUBLED WHILE JOB OPENINGS FELL 30%","SOURCES SAY: OPENAI IS HIRING AGAIN","THE SOURCE OF THE JOB SLUMP ISN'T AI"]);
});

test("the designer fills post cards word for word, keeps links, places photos and speaks the page's language",async()=>{
  const alice=post("101","alice","AI didn't take the jobs, rates did 📉",5000),bob=post("102","bob","Openings are back to 2019 levels",3000);
  const {document,notes,pages}=await deckLib.assembleDeck({
    profile:spanish,template,templates:model.BUILT_IN_TEMPLATES,name:"IA y empleo",caption:"Pie de foto.",
    slides:[
      {templatePage:COVER,texts:[{slot:"cover-headline",text:"LA BOLSA SUBE, [[LOS EMPLEOS BAJAN]]."}],photo:{url:"https://pbs.twimg.com/media/abc.jpg?format=jpg&name=large",alt:"ChatGPT en un teléfono",credit:"@openai on X",sourceUrl:"https://x.com/openai/status/1"},slide:0},
      {templatePage:REACTIONS,texts:[{slot:"title",text:"Lo que dijo X"},{slot:"source",text:"Fuente: X, nov 2026"}],reactions:[alice,bob],slide:1},
      {templatePage:REACTIONS,texts:[{slot:"title",text:"Una reacción"}],reactions:[bob],slide:2},
      {templatePage:REACTION,texts:[{slot:"title",text:"Nadie"}],reactions:[],slide:3},
      {templatePage:FOLLOW,texts:[{slot:"cta",text:"PARA SABER MÁS"}],photoBrief:"Captura del perfil",slide:4},
    ],
  });
  assert.equal(document.pages.length,4,"the reaction slide with no posts is skipped");
  assert.ok(notes.some(note=>/Reaction page: it shows real posts from X/.test(note)));
  assert.deepEqual(pages.map(page=>page.slide),[0,1,2,4]);
  assert.equal(pages[2].templatePage,REACTION,"one post on a two-post page moves to the one-post page");
  const elements=index=>document.pages[index].canvas.elements;
  const slot=(index,name)=>elements(index).find(element=>element.slot===name);
  assert.equal(slot(0,"cover-headline").text,"LA BOLSA SUBE, LOS EMPLEOS BAJAN","no final period, emphasis kept as rich text");
  assert.match(slot(0,"cover-headline").richText,/<span style="color: #00D98A">LOS EMPLEOS BAJAN<\/span>/);
  assert.equal(slot(0,"photo").src,"https://pbs.twimg.com/media/abc.jpg?format=jpg&name=large");
  assert.equal(slot(0,"photo").publicAlt,"ChatGPT en un teléfono");
  assert.equal(slot(1,"reaction-text").text,"AI didn't take the jobs, rates did 📉","the post's words are kept exactly");
  assert.equal(slot(1,"reaction-handle-2").text,"@bob");
  assert.equal(slot(2,"reaction-text").text,"Openings are back to 2019 levels");
  const texts=document.pages.flatMap(page=>page.canvas.elements.filter(element=>element.type==="text").map(element=>element.text));
  assert.ok(texts.includes("DESLIZA PARA VER MÁS")&&texts.includes("SIGUE ESTA PÁGINA"),"the fixed lines are in Spanish");
  assert.ok(!texts.includes("SWIPE FOR MORE")&&!texts.includes("FOLLOW THIS PAGE"));
  const comments=document.comments.map(comment=>comment.text);
  assert.ok(comments.some(text=>text.includes("https://x.com/alice/status/101")&&text.includes("https://x.com/bob/status/102")),"the posts' links are kept");
  assert.ok(comments.some(text=>text==="Photo: @openai on X, https://x.com/openai/status/1"));
  assert.ok(comments.some(text=>text==="Photo to add: Captura del perfil"));
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY,designs:[document]}),"the deck passes Engine's library validation");
  // Unverified accounts show no check mark and a round photo.
  assert.equal(slot(1,"reaction-badge").hidden,true); assert.equal(slot(1,"reaction-avatar").radius,slot(1,"reaction-avatar").width/2);

  const checks=review.houseChecks(document,pages,catalog,spanish,[{pageId:document.pages[1].id,exportError:"Shorten “Post text” before exporting"}]);
  assert.ok(checks.some(issue=>issue.slide===2&&issue.severity==="must_fix"&&/Shorten/.test(issue.problem)),"a slide Export refuses is a must-fix");
  assert.ok(checks.some(issue=>issue.slide===4&&issue.route==="none"&&/placeholder/.test(issue.problem)),"the Follow photo a person adds is noted, not sent back");
  assert.ok(!checks.some(issue=>issue.route==="copy"&&issue.slide===1),"the cover passes");
  slot(0,"cover-headline").text="La bolsa sube.";
  slot(3,"cta").text="PARA SABER MUCHO MÁS SOBRE LA IA";
  const broken=review.houseChecks(document,pages,catalog,spanish);
  assert.ok(broken.some(issue=>issue.slide===1&&/capitals/.test(issue.problem)));
  assert.ok(broken.some(issue=>issue.slide===1&&/ends with a period/.test(issue.problem)));
  assert.ok(broken.some(issue=>issue.slide===4&&/Follow line/.test(issue.problem)));
});

test("the designer places one photo across the pair, at the art director's seam, and the critics see the pair",async()=>{
  const url="https://pbs.twimg.com/media/wide.jpg?format=jpg&name=large";
  const {document,notes,pages}=await deckLib.assembleDeck({
    profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Data centers",caption:"Caption",
    slides:[
      {templatePage:COVER,texts:[{slot:"cover-headline",text:"AI NEEDS [[POWER]]"}],slide:0},
      {templatePage:WIDE,texts:[{slot:"title",text:"Where AI gets built"},{slot:"body",text:"One site uses as much power as a city"}],photo:{url,alt:"A data center at dusk",credit:"@dc on X",sourceUrl:"https://x.com/dc/status/1",seam:.4,size:{width:2000,height:1000}},slide:1},
      {templatePage:WIDE_END,texts:[{slot:"title",text:"It never sleeps"},{slot:"body",text:"Cooling runs day and night"},{slot:"source",text:"Source: IEA, 2026"}],slide:2},
      {templatePage:WIDE_END,texts:[{slot:"title",text:"On its own"},{slot:"body",text:"No first half before it"}],slide:3},
    ],
  });
  const [pair,...others]=spans.spanPairs(document);
  assert.equal(others.length,0);
  assert.deepEqual([pair.startPage,pair.endPage],[1,2]);
  assert.equal(pair.start.src,url);
  assert.equal(pair.end.src,url,"both halves show the same photo");
  assert.equal(Math.round(spans.seamOf(pair.start)*100),40,"the art director's seam");
  assert.ok(Math.abs(pair.start.width/pair.start.height-2)<.01,"the frame takes the photo's own 2:1 shape");
  assert.ok(pair.start.x>=-1e-6&&pair.end.x+pair.end.width<=360+1e-6,"the photo is whole: neither outer edge is cut");
  assert.deepEqual([pair.start.publicAlt,pair.end.publicAlt],["A data center at dusk","A data center at dusk"],"both halves are described");
  assert.ok(document.comments.some(comment=>comment.pageId===document.pages[1].id&&comment.text==="Photo: @dc on X, https://x.com/dc/status/1"));
  assert.equal(pages[3].templatePage,MEDIA,"a lone second half becomes a Text + Media slide");
  assert.ok(notes.some(note=>/Wide photo · end page didn't have the page that shares its photo next to it, so it became a Text \+ Media slide/.test(note)));
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY,designs:[document]}),"the deck passes Engine's library validation");
  assert.deepEqual(review.photoPairs(document).map(item=>[item.first,item.second,item.seam]),[[2,3,40]],"the critics are told which slides share the photo");
  assert.ok(playbookLib.roleCardFor("review").rules.some(rule=>/split through a face or text is must_fix for images/.test(rule)));
});

test("the art director gives the photo pair a seam, kept to the editor's range, and only the pair",async()=>{
  const makers=load("lib/engine/agents/makers.ts");
  const outline={why:"",slides:[
    {kind:"cover",templatePage:COVER,purpose:"Hook",points:[],chartId:null,reactionIds:[],photo:"A chip"},
    {kind:"original",templatePage:WIDE,purpose:"The campus",points:[],chartId:null,reactionIds:[],photo:"The data center"},
    {kind:"original",templatePage:WIDE_END,purpose:"The rest",points:[],chartId:null,reactionIds:[],photo:""},
  ]};
  const candidates=["wide","chip"].map(id=>({id,url:`https://example.com/${id}.jpg`,description:id,sourceUrl:"https://example.com",credit:"example.com"}));
  const file={id:"post-test",source:{caption:"",notes:""},stages:{approval:{status:"done",output:{outline,hook:{text:"AI NEEDS POWER",option:0},notes:""}},visuals:{status:"done",output:{candidates,note:""}}}};
  const asked=[],real=claude.ask;
  claude.ask=async call=>{asked.push(call);return {picks:[{slide:1,candidate:"chip",alt:"A chip",seam:.3},{slide:2,candidate:"wide",alt:"A data center at dusk",seam:38},{slide:3,candidate:"wide",alt:"Again",seam:null}],notes:[]};};
  try {
    const {output}=await makers.images({ownerKey:owner(),file,profile:english,template,templates:model.BUILT_IN_TEMPLATES,signal:new AbortController().signal,usage:new claude.UsageMeter(),cache:{chartData:new Map()},round:0});
    assert.deepEqual(output.photos.map(photo=>[photo.slide,photo.url,photo.seam]),[[0,"https://example.com/chip.jpg",undefined],[1,"https://example.com/wide.jpg",.38]],"a seam only on the pair's first slide, read as a share");
    const text=asked[0].content.filter(block=>block.type==="text").map(block=>block.text).join("\n");
    assert.match(text,/slide 2 \(Wide photo · start\): The campus; wanted: The data center\. One photo across slides 2 and 3/);
    assert.ok(!/slide 3 \(/.test(text),"the second half needs no photo of its own");
    assert.match(asked[0].system,/Choose a landscape photo \(wider than tall\) and give its seam/);
  } finally {
    claude.ask=real;
  }
});

test("the designer puts one to three posts on a page by size and draws each account as X does",async()=>{
  const short=(id,handle,author={})=>({...post(id,handle,`Short take ${id}`,100),author:{...post(id,handle,"",0).author,...author}});
  const photo={url:"https://pbs.twimg.com/media/HWYj89XW8AABX1T.png?name=large",width:758,height:372};
  const org=short("201","kobeissi",{verified:true,badge:"gold",square:true}),paid=short("202","bark",{verified:true,badge:"blue"}),old=short("203","legacy",{verified:true});
  const pictured={...post("204","baude","Yesterday while I was at lunch, Claude deleted a year of con law lecture notes and my current syllabus.",7291),media:photo};
  const medium=post("205","essay","word ".repeat(70).trim(),900),long=post("207","novel","word ".repeat(300).trim(),800);
  const {document,notes,pages}=await deckLib.assembleDeck({
    profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Reactions",caption:"",
    slides:[
      {templatePage:REACTION,texts:[{slot:"title",text:"How X reacted"}],reactions:[org,paid,old],slide:0},
      {templatePage:THREE,texts:[{slot:"title",text:"More reactions"}],reactions:[pictured,medium,short("206","sam")],slide:1},
      {templatePage:REACTION,texts:[{slot:"title",text:"The long one"}],reactions:[long],slide:2},
    ],
  });
  // Three short posts share the three-card page. A photo post takes a page; an 8-line post and a short one share the next.
  assert.deepEqual(pages.map(page=>[page.templatePage,page.slide]),[[THREE,0],[REACTION,1],[REACTIONS,1],[REACTION,2]]);
  assert.ok(notes.some(note=>/slide 2 didn't fit one page at full size, so they continue on the next page/.test(note)),notes.join(" | "));
  const elements=index=>document.pages[index].canvas.elements, slot=(index,name)=>elements(index).find(element=>element.slot===name);
  // The continued page keeps the slide's title.
  assert.equal(slot(2,"title").text,"More reactions");
  // Check marks: gold with its gradient for organizations, blue for paid accounts, blue for posts saved with only "verified".
  const gold=slot(0,"reaction-badge"),blue=slot(0,"reaction-badge-2"),legacy=slot(0,"reaction-badge-3");
  assert.equal(gold.hidden,false); assert.equal(gold.path,model.X_BADGES.gold.path); assert.equal(gold.fill,model.X_BADGES.gold.fill); assert.deepEqual(gold.gradient,model.X_BADGES.gold.gradient);
  assert.equal(blue.path,model.X_BADGES.blue.path); assert.equal(blue.fill,"#1D9BF0"); assert.equal(blue.gradient,undefined); assert.equal(legacy.fill,"#1D9BF0");
  // Organizations' profile photos are rounded squares; everyone else's are round.
  const square=slot(0,"reaction-avatar"),round=slot(0,"reaction-avatar-2");
  assert.ok(Math.abs(square.radius-square.width*.113)<1e-9); assert.equal(round.radius,round.width/2);
  // The post's photo shows under its text at full width, keeping its proportions; cards without one keep it hidden.
  const shown=slot(1,"reaction-media"),text=slot(1,"reaction-text");
  assert.equal(shown.hidden,false); assert.equal(shown.src,photo.url); assert.ok(Math.abs(shown.width-text.width)<1e-6);
  assert.ok(Math.abs(shown.height/shown.width-372/758)<1e-9); assert.equal(shown.intrinsicWidth,758); assert.equal(shown.publicAlt,"Photo in @baude's post");
  assert.equal(slot(0,"reaction-media").hidden,true); assert.equal(slot(2,"reaction-media").hidden,true);
  assert.deepEqual(["reaction-play","reaction-length","reaction-length-text"].map(name=>slot(1,name).hidden),[true,true,true],"a photo has no play button or badge");
  // A post longer than its card is cut at a word with "…", like X's "Show more".
  assert.ok(slot(3,"reaction-text").text.endsWith("…")); assert.equal(slot(2,"reaction-text").text,medium.text);
  // The deck's notes keep every post's link and stats.
  assert.ok(document.comments.some(comment=>comment.text.includes("@baude (7.3K likes · 10 reposts · Nov 3, 2026): https://x.com/baude/status/204")));
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY,designs:[document]}));
});

test("a video post shows its poster frame with X's play button and its length, and a GIF says GIF",async()=>{
  const smart=load("lib/template-editor/smart-text.ts"),xPosts=load("lib/engine/x-reactions.ts");
  const measure=(element,words=smart.smartWords(element))=>({size:element.fontSize,widths:words.map(word=>word.text.length*element.fontSize*.45),space:element.fontSize*.25});
  const video={url:"https://pbs.twimg.com/amplify_video_thumb/3/img/c.jpg",width:1280,height:720,kind:"video",durationMs:45000};
  const gif={url:"https://pbs.twimg.com/tweet_video_thumb/a.jpg",width:480,height:270,kind:"gif"};
  const clip={...post("301","clips","Watch this",900),media:video},loop={...post("302","loops","This one loops",500),media:gif};
  const {document,pages}=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Videos",caption:"",
    slides:[{templatePage:REACTION,texts:[{slot:"title",text:"How X reacted"}],reactions:[clip],slide:0},{templatePage:REACTION,texts:[{slot:"title",text:"And a GIF"}],reactions:[loop],slide:1}]});
  assert.deepEqual(pages.map(page=>page.templatePage),[REACTION,REACTION]);
  const laid=index=>smart.layoutSmartScene(document.pages[index].canvas,measure).scene,slot=(scene,name)=>scene.elements.find(element=>element.slot===name);
  const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-6,`${message}: ${a} vs ${b}`);
  const first=laid(0),frame=slot(first,"reaction-media"),play=slot(first,"reaction-play"),length=slot(first,"reaction-length"),label=slot(first,"reaction-length-text");
  assert.equal(frame.hidden,false); assert.equal(frame.src,video.url); assert.equal(frame.publicAlt,"Video in @clips's post");
  assert.deepEqual([play.hidden,length.hidden,label.hidden,label.text],[false,false,false,"0:45"]);
  near(play.x+play.width/2,frame.x+frame.width/2,"the play button is centred across the frame");
  near(play.y+play.height/2,frame.y+frame.height/2,"and down it");
  const {inset,height}=model.X_CARD.length;
  near(length.x,frame.x+inset/3,"the length sits inside the frame's left edge"); near(length.y+length.height,frame.y+frame.height-inset/3,"and above its bottom");
  near(length.height,height/3,"at X's size"); near(length.width,xPosts.mediaBadge(video).width/3,"as wide as 0:45 needs");
  near(label.x,length.x,"its words sit on the badge"); near(label.y,length.y,"its words sit on the badge"); near(label.width,length.width,"centred across it");
  const card=slot(first,"reaction-card"); near(card.y+card.height,frame.y+frame.height+model.X_CARD.foot/3,"the card still ends under the frame");
  // A GIF has no play button, just "GIF" in the corner.
  const second=laid(1);
  assert.deepEqual([slot(second,"reaction-play").hidden,slot(second,"reaction-length").hidden,slot(second,"reaction-length-text").text],[true,false,"GIF"]);
  assert.equal(slot(second,"reaction-media").publicAlt,"GIF in @loops's post");
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY,designs:[document]}),"the deck stays a valid document");
});

test("the critics' instructions and report name each slide and fix",()=>{
  const output={round:1,rendered:true,checks:[{slide:2,problem:"Body too long",fix:"Cut it",severity:"should_fix",route:"copy"}],
    facts:{verdict:"fix",summary:"One number is off",issues:[{slide:3,problem:"29% should be 28%",fix:"Use 28%",severity:"must_fix",route:"copy"},{slide:2,problem:"Chart starts in 2016",fix:"Start in 2003",severity:"must_fix",route:"data"}]},
    design:{verdict:"ship",summary:"Clean",issues:[{slide:0,problem:"Nice",fix:"",severity:"note",route:"none"}]},sentBack:["copy","data"]};
  const copy=review.fixInstructions(output,"copy");
  assert.match(copy,/Slide 3 \(must fix\): 29% should be 28%\. Fix: Use 28%/);
  assert.match(copy,/Slide 2 \(should fix\): Body too long/);
  assert.ok(!/2016/.test(copy),"each route gets only its own issues");
  assert.match(review.fixInstructions(output,"data"),/Keep every chart's id/);
  const report=review.reviewComment(output);
  assert.match(report,/after 1 fix round/);
  assert.match(report,/Facts: One number is off/);
  assert.ok(!/Nice/.test(report),"notes stay out of the to-do list");
});

test("every first-team stage keeps its role card, and its prompt carries the page's voice and the house rules",()=>{
  // The first team's modules still write with these until the cleanup; the current team's cards are tested in the flow tests.
  for(const stage of posts.LEGACY_STAGES)assert.ok(playbookLib.roleCardFor(stage).rules.length,`${stage} has rules`);
  const prompt=playbookLib.rolePrompt("copy",spanish);
  assert.match(prompt,/written in Spanish/);
  assert.ok(prompt.includes(spanish.voice));
  assert.ok(playbookLib.HOUSE_RULES.every(rule=>prompt.includes(rule)));
  assert.match(playbookLib.rolePrompt("review",english,"","fact critic"),/^You are the fact critic/);
  const book=playbookLib.playbook();
  assert.equal(book.stages.length,posts.POST_STAGES.length);
  assert.ok(book.stages.every(stage=>["agent","code","human"].includes(stage.by)));
});

test("each role can run on its own model",()=>{
  assert.equal(claude.modelFor("copy"),"claude-opus-5-5");
  assert.equal(claude.modelFor("reactions"),"claude-sonnet-5-5");
  environment.env.ENGINE_MODEL_COPY="claude-sonnet-5-5";
  environment.env.ANTHROPIC_RECREATE_MODEL="claude-opus-5";
  try {
    assert.equal(claude.modelFor("copy"),"claude-sonnet-5-5");
    assert.equal(claude.modelFor("editor"),"claude-opus-5","the older setting still moves the Opus roles");
    assert.equal(claude.modelFor("hooks"),"claude-sonnet-5-5","but not the Sonnet ones");
  } finally {
    delete environment.env.ENGINE_MODEL_COPY;delete environment.env.ANTHROPIC_RECREATE_MODEL;
  }
});

test("the X reactions agent searches X itself, a few times at most, and may only pick posts it found",async()=>{
  const research=load("lib/engine/agents/research.ts");
  const now=Date.parse("2026-11-07T12:00:00Z");
  assert.equal(research.reactionsSince("2022-11-30",now),"2023-11-08","a search reaches back three years at most");
  assert.equal(research.reactionsSince("2025-06-01",now),"2025-06-01");
  assert.equal(research.reactionsSince("2030-01-01",now),"2026-11-07","never after today");
  assert.equal(research.reactionsSince("soon",now),"2026-10-08","30 days back without a date");

  const tweet=(id,likes,text)=>({type:"tweet",id,url:`https://x.com/person${id}/status/${id}`,text,fullText:text,retweetCount:5,replyCount:2,likeCount:likes,quoteCount:0,viewCount:1000,createdAt:"Wed Oct 14 14:19:33 +0000 2026",lang:"en",isReply:false,isRetweet:false,isQuote:false,author:{type:"user",userName:`person${id}`,name:`Person ${id}`,isVerified:false,isBlueVerified:false,profilePicture:""},entities:{hashtags:[],symbols:[],urls:[],user_mentions:[]}});
  const clip={...tweet("202",300,"Openings fell before ChatGPT"),extendedEntities:{media:[{type:"video",media_url_https:"https://pbs.twimg.com/amplify_video_thumb/9/img/v.jpg",original_info:{width:1280,height:720},video_info:{duration_millis:83000}}]}};
  const bodies=[],replies=[[tweet("201",900,"This chart is the whole job market"),clip],[],"credit"];
  const fetch=async(url,init)=>{
    bodies.push(JSON.parse(init.body));
    const reply=replies.shift();
    if(reply==="credit")return new Response(JSON.stringify({error:{message:"Not enough credit"}}),{status:402,headers:{"Content-Type":"application/json"}});
    return new Response(JSON.stringify(reply??[]),{status:200,headers:{"Content-Type":"application/json"}});
  };
  environment.env.APIFY_TOKEN="apify_api_TEST_TOKEN";
  try {
    const seen=new Map(),failures=[],tool=research.xSearchTool(seen,{fetch,failures});
    assert.equal(tool.name,"search_x");
    const first=await tool.run({terms:["chatgpt job openings"],since:"2024-01-01",minLikes:50,language:"en"});
    assert.match(first,/^2 posts since 2024-01-01 \(3 searches left\.\)/);
    assert.match(first,/id 201 · Person 201 @person201 · 900 likes/);
    assert.match(first,/id 202 .* · with a video \(1:23\)\n/,"the agent knows which posts have a video, a GIF or a photo");
    assert.doesNotMatch(first,/id 201 [^\n]*with a/);
    assert.deepEqual([...seen.keys()],["201","202"],"every post shown is remembered");
    assert.deepEqual(bodies[0],{searchTerms:["chatgpt job openings"],maxItems:30,sort:"Top",tweetLanguage:"en",minimumFavorites:50,start:"2024-01-01"});
    assert.match(await tool.run({terms:["jolts stocks"],since:"2025-01-01",minLikes:30,language:"es"}),/^No posts in es since 2025-01-01 with at least 30 likes\./);
    await assert.rejects(tool.run({terms:["ai jobs"],since:"2025-01-01",minLikes:100,language:"en"}),error=>error instanceof claude.ToolError&&/out of credit/.test(error.message),"Apify's problems reach the agent in plain words");
    assert.equal(failures.length,1);
    await tool.run({terms:["ai jobs"],since:"2025-01-01",minLikes:100,language:"en"});
    await assert.rejects(tool.run({terms:["one more"],since:"2025-01-01",minLikes:100,language:"en"}),/No searches left \(4 per run\)/);
    assert.equal(bodies.length,4,"the fifth search never reaches Apify");
    assert.equal(research.unknownPicks([{id:"201"},{id:"202"}],seen),null);
    assert.match(research.unknownPicks([{id:"201"},{id:"999"}],seen),/These ids weren't in your search results: 999\./);
  } finally {
    delete environment.env.APIFY_TOKEN;
  }
  assert.ok(playbookLib.roleCardFor("reactions").rules.some(rule=>/search again/.test(rule)));
});

test("posts added by link lead the reactions and need no Apify plan",async()=>{
  const research=load("lib/engine/agents/research.ts");
  const embed=id=>({__typename:"Tweet",id_str:id,text:`Post ${id} about the job market`,created_at:"2026-11-05T19:08:45.000Z",favorite_count:7291,user:{name:`Person ${id}`,screen_name:`person${id}`,is_blue_verified:true}});
  const original=globalThis.fetch,hosts=[];
  globalThis.fetch=async url=>{
    const address=new URL(url),id=address.searchParams.get("id");hosts.push(address.hostname);
    return id==="404"?new Response("",{status:404}):new Response(JSON.stringify(embed(id)),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try {
    const file={source:{caption:"",notes:"",slideCount:0,imageIds:[],xPosts:["https://x.com/i/status/301","https://x.com/i/status/404","https://x.com/i/status/302"]},stages:{brief:{status:"done",output:BRIEF}}};
    const result=await research.reactions({file,profile:english,signal:undefined,usage:[]});
    assert.equal(result.status,undefined,"the stage succeeds with the added posts although X can't be searched");
    assert.deepEqual(result.output.reactions.map(post=>[post.id,post.url,post.why]),[["301","https://x.com/person301/status/301","Added by you"],["302","https://x.com/person302/status/302","Added by you"]]);
    assert.match(result.output.note,/won't show post 404/); assert.match(result.output.note,/APIFY_TOKEN/);
    assert.deepEqual([...new Set(hosts)],["cdn.syndication.twimg.com"],"only X's embed data is asked, never Apify");
    // Without added posts the stage is skipped as before.
    const none=await research.reactions({file:{...file,source:{...file.source,xPosts:[]}},profile:english,signal:undefined,usage:[]});
    assert.equal(none.status,"skipped");
  } finally {
    globalThis.fetch=original;
  }
  assert.ok(playbookLib.roleCardFor("outline").rules.some(rule=>/Added by you/.test(rule)),"the story editor puts them first");
});

test("photos also come from the pages the facts cite: public, full-size images only",async()=>{
  const research=load("lib/engine/agents/research.ts"),sharp=nativeRequire("sharp");
  const png=(width,height)=>sharp({create:{width,height,channels:3,background:"#336699"}}).png().toBuffer();
  const facts={claims:[
    {claim:"a",verdict:"confirmed",detail:"",sources:[{title:"Report",url:"https://www.anthropic.com/research/report#jobs"},{title:"Admin",url:"http://127.0.0.1/admin"}]},
    {claim:"b",verdict:"confirmed",detail:"",sources:[{title:"Report",url:"https://www.anthropic.com/research/report"},{title:"Blog",url:"https://openai.com/index/chatgpt/"}]},
  ],answers:[{question:"q",answer:"a",sources:[{title:"File",url:"ftp://example.com/file"}]}],context:[],risks:[]};
  assert.deepEqual(research.citedPages(facts),["https://www.anthropic.com/research/report","https://openai.com/index/chatgpt/"],"most-cited first, one page per address, public http(s) only");
  assert.deepEqual(research.citedPages(undefined),[]);

  const big=await png(1200,800),small=await png(300,200),banner=await png(2400,600);
  const report=`<html><head><title>The report</title><meta property="og:image" content="https://cdn.example.com/hero.png"></head><body>
    <img src="http://169.254.169.254/latest/meta.png" alt="metadata">
    <figure><img src="/charts/jobs.png" alt="Chart"><figcaption>Claude usage by occupation, January 2026</figcaption></figure>
    <img src="https://cdn.example.com/banner.png" alt="banner"></body></html>`;
  const blog=`<html><head><title>Introducing ChatGPT</title></head><body><img src="https://cdn.example.com/thumb.png" alt="thumb"><img src="https://cdn.example.com/page.html" alt="page"></body></html>`;
  const files={"https://cdn.example.com/hero.png":big,"https://www.anthropic.com/charts/jobs.png":big,"https://cdn.example.com/thumb.png":small,"https://cdn.example.com/banner.png":banner};
  const requested=[];
  const fetch=async url=>{
    const address=String(url);requested.push(address);
    if(address==="https://www.anthropic.com/research/report")return new Response(report,{headers:{"content-type":"text/html; charset=utf-8"}});
    if(address==="https://openai.com/index/chatgpt/")return new Response(blog,{headers:{"content-type":"text/html"}});
    if(files[address])return new Response(files[address],{headers:{"content-type":"image/png"}});
    if(address.endsWith(".html"))return new Response("<html></html>",{headers:{"content-type":"text/html"}});
    return new Response("missing",{status:404});
  };
  // The page scraper reads pages with the global fetch.
  const original=globalThis.fetch;globalThis.fetch=fetch;
  try {
    const found=await research.photosFromPages(research.citedPages(facts),new AbortController().signal,fetch);
    assert.deepEqual(found.map(image=>image.url).sort(),["https://cdn.example.com/hero.png","https://www.anthropic.com/charts/jobs.png"],"no thumbnail, banner, non-image or private address");
    const chart=found.find(image=>image.url.endsWith("jobs.png"));
    assert.equal(chart.description,"Claude usage by occupation, January 2026","the published caption describes the image");
    assert.equal(chart.sourceUrl,"https://www.anthropic.com/research/report");
    assert.equal(chart.directive,"anthropic.com","credited to the page's site");
    assert.deepEqual([chart.width,chart.height],[1200,800]);
    assert.ok(!requested.some(address=>address.includes("169.254.169.254")),"a private address is never fetched");
    assert.equal(await research.photoSize("http://localhost:3000/a.png",new AbortController().signal,fetch),null);
  } finally { globalThis.fetch=original; }
});

test("Engine fetches only public http(s) addresses for photos and the image proxy",()=>{
  const {publicHttpUrl,isBlockedHost}=load("lib/engine/public-url.ts");
  for(const address of ["https://www.anthropic.com/research","http://cdn.example.com/a.png","https://8.8.8.8/x.png"])assert.ok(publicHttpUrl(address),address);
  for(const address of ["http://localhost:3000/a.png","http://app.localhost/a.png","http://127.0.0.1/","http://10.0.0.5/","http://172.20.1.1/","http://192.168.1.1/","http://169.254.169.254/latest/","http://100.64.0.1/","http://[::1]/","http://[fd12:3456::1]/","http://[fe80::1]/","http://[::ffff:127.0.0.1]/","http://printer.local/","http://db.internal/","ftp://example.com/a.png","https://user:pass@example.com/a.png","not a url"])assert.equal(publicHttpUrl(address),null,address);
  assert.equal(isBlockedHost("example.com"),false);
});

test("autopilot takes the first hook that fits the cover, or the shortest",()=>{
  const {autopilotHook}=load("lib/engine/agents/makers.ts");
  const options=["A HOOK FAR TOO LONG FOR THE COVER, WITH A CLAIM THE FACTS DON'T SUPPORT AND A YEAR THAT IS OUT OF DATE","STOCKS UP, JOBS DOWN SINCE CHATGPT","JOBS DOWN"].map(text=>({text,framework:null,by:"headline-model",english:null}));
  assert.equal(autopilotHook(options,79),1,"the model's order wins among the hooks that fit");
  assert.equal(autopilotHook(options),0,"without a known limit, the first");
  assert.equal(autopilotHook([options[0],options[2]],5),1,"none fits: the shortest");
  assert.equal(autopilotHook([options[0],options[0]],20),0,"a tie keeps the model's order");
  assert.equal(autopilotHook([],79),-1);
});

test("a rebuild never replaces a deck that changed after Engine saved it: it is saved next to it",async()=>{
  const ownerKey=owner(),pause=()=>new Promise(resolve=>setTimeout(resolve,5));
  const build=async(id,name="AI vs Jobs")=>({...(await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name,caption:"",slides:[{templatePage:COVER,texts:[{slot:"cover-headline",text:"STOCKS UP, JOBS DOWN"}],slide:0}]})).document,...(id?{id}:{})});
  const first=await deckLib.saveDeck(ownerKey,await build());
  const id=first.saved.id;
  await pause();
  const rebuilt=await deckLib.saveDeck(ownerKey,await build(id),{savedAt:first.saved.updatedAt});
  assert.equal(rebuilt.saved.id,id,"unchanged since: replaced in place");
  assert.ok(!rebuilt.copy);
  // A person opens it and the editor re-fits a text box, which saves it.
  await pause();
  await deckLib.saveDeck(ownerKey,{...rebuilt.saved,name:"AI vs Jobs, Ivan's version"},{savedAt:rebuilt.saved.updatedAt});
  const again=await deckLib.saveDeck(ownerKey,await build(id),{savedAt:rebuilt.saved.updatedAt});
  assert.equal(again.copy,true);
  assert.notEqual(again.saved.id,id);
  assert.equal(again.saved.name,"AI vs Jobs (rebuilt)");
  assert.equal((await deckLib.loadDeck(ownerKey,id)).name,"AI vs Jobs, Ivan's version","the person's version is untouched");
  // The critics' fix round saves over the copy in place, under the post's plain title.
  await pause();
  const fixed=await deckLib.saveDeck(ownerKey,await build(again.saved.id),{savedAt:again.saved.updatedAt});
  assert.equal(fixed.saved.id,again.saved.id);
  assert.ok(!fixed.copy);
  assert.equal(fixed.saved.name,"AI vs Jobs (rebuilt)","the copy stays named apart from the person's version");
  await pause();
  await deckLib.saveDeck(ownerKey,{...fixed.saved,name:"Edited copy"},{savedAt:fixed.saved.updatedAt});
  const third=await deckLib.saveDeck(ownerKey,await build(fixed.saved.id,"AI vs Jobs (rebuilt)"),{savedAt:fixed.saved.updatedAt});
  assert.equal(third.saved.name,"AI vs Jobs (rebuilt)","the name doesn't grow with each copy");
});

test("a Text + Media slide with nothing to show hides its empty frame and says so",async()=>{
  const texts=[{slot:"title",text:"The real warning sign is for young workers"},{slot:"body",text:"Hiring of 22 to 25 year olds is down about 14%"}];
  const {document,pages}=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Young workers",caption:"",slides:[
    {templatePage:MEDIA,texts,slide:0},
    {templatePage:MEDIA,texts,photoBrief:"Photo of an empty office",slide:1},
    {templatePage:FOLLOW,texts:[{slot:"cta",text:"TO STAY AHEAD"}],slide:2},
  ]});
  const frame=index=>document.pages[index].canvas.elements.find(element=>element.slot==="media");
  assert.equal(frame(0).hidden,true); assert.equal(frame(1).hidden,true,"a brief alone doesn't fill the frame");
  const on=index=>document.comments.filter(comment=>comment.pageId===document.pages[index].id).map(comment=>comment.text);
  assert.ok(on(0).includes("No photo or chart for this slide yet. The empty photo frame is hidden; show it in Layers to add one"));
  assert.ok(on(1).includes("Photo to add: Photo of an empty office. The empty photo frame is hidden; show it in Layers to add one"));
  // The Follow photo is the page's backdrop, not a frame under copy: it stays for a person to fill.
  assert.notEqual(document.pages[2].canvas.elements.find(element=>element.slot==="photo").hidden,true);
  const checks=review.houseChecks(document,pages,catalog,english);
  assert.ok(!checks.some(issue=>issue.slide<=2&&/placeholder/.test(issue.problem)),"a hidden frame isn't a placeholder on the slide");
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY,designs:[document]}),"the deck passes Engine's library validation");
});

test("the designer gives the photo frame its photo's or chart's shape",async()=>{
  const sharp=nativeRequire("sharp"),wide=await sharp({create:{width:1600,height:900,channels:3,background:"#336699"}}).jpeg().toBuffer();
  const texts=[{slot:"title",text:"Claude can now use your computer"},{slot:"body",text:"It clicks and types to finish a task for you"}];
  const typed={unit:"%",labels:["2022","2023","2024","2025"],series:[{name:"Openings",source:"typed",fred:null,values:[10,8,7,6],emphasis:true}],from:null,markerDate:null,indexToMarker:false,markerIndex:-1,markerLabel:"",markerIcon:"none",endLabel:"value",markers:[],band:null};
  const requested=[],original=globalThis.fetch;
  globalThis.fetch=async url=>{requested.push(String(url));return String(url).endsWith("wide.jpg")?new Response(wide,{headers:{"content-type":"image/jpeg"}}):new Response("missing",{status:404});};
  try {
    const {document}=await deckLib.assembleDeck({profile:english,template,templates:model.BUILT_IN_TEMPLATES,name:"Shapes",caption:"",slides:[
      {templatePage:COVER,texts:[{slot:"cover-headline",text:"CLAUDE USES YOUR COMPUTER"}],photo:{url:"https://cdn.example.com/cover.jpg",alt:"A laptop"},slide:0},
      {templatePage:MEDIA,texts,photo:{url:"https://cdn.example.com/wide.jpg",alt:"A screen recording"},slide:1},
      {templatePage:MEDIA,texts,photo:{url:"https://cdn.example.com/gone.jpg",alt:"A photo that can't be read"},slide:2},
      {templatePage:MEDIA,texts,chart:{chart:typed},slide:3},
    ]});
    const frame=(index,slot="media")=>document.pages[index].canvas.elements.find(element=>element.slot===slot);
    assert.deepEqual([frame(1).intrinsicWidth,frame(1).intrinsicHeight],[1600,900],"the photo's own size, so the frame takes its shape");
    assert.ok(Math.abs(frame(2).intrinsicWidth/frame(2).intrinsicHeight-frame(2).width/frame(2).height)<.01,"a photo that can't be measured keeps the frame's shape");
    assert.equal(frame(3).fit,"contain"); assert.deepEqual([frame(3).intrinsicWidth,frame(3).intrinsicHeight],[2*Math.round(frame(3).width*3),2*Math.round(frame(3).height*3)],"a chart is drawn at twice the frame's size and says so");
    assert.ok(!requested.includes("https://cdn.example.com/cover.jpg"),"the cover photo is cropped to its fixed box, so it isn't measured");
    assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY,designs:[document]}),"the deck passes Engine's library validation");
  } finally { globalThis.fetch=original; }
});
