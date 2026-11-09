/* Run: node --test tests/template-editor-recreate-review.test.mjs
 * Build step F: the review stage's checks and critics. The decks are built
 * with the agent deck tools on the @chatgptricks template, with HTML layers
 * that get the brand's variables the way the designer's do, and saved for
 * real in temporary local storage. Claude's critics and the render page's
 * measures are stand-ins; one test measures a page in a real Chromium when one
 * starts on this machine (it is skipped otherwise). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import sharp from "sharp";
import ts from "typescript";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-review-test-"));
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

const reviewStage=load("lib/engine/agents/stages/review.ts");
const checks=load("lib/engine/agents/review-checks.ts");
const brand=load("lib/engine/agents/brand.ts");
const claude=load("lib/engine/agents/claude.ts");
const render=load("lib/engine/slide-render.ts");
const renderTokens=load("lib/engine/render-tokens.ts");
const pagesLib=load("lib/engine/agents/pages.ts");
const schemas=load("lib/engine/agents/schemas.ts");
const model=load("lib/template-editor/model.ts");
const decks=load("lib/template-editor/agent-decks.ts");
const htmlLayer=load("lib/template-editor/html-layer.ts");
const platformCards=load("lib/template-editor/platform-cards.ts");
const seed=load("lib/template-editor/brand-guide-seed.ts");
const persistence=load("lib/template-editor/persistence.ts");
const profiles=load("lib/engine/page-profiles.ts");

const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const guide=seed.builtInBrandGuide("chatgptricks");
const tokens=htmlLayer.htmlTokensForGuide(guide);
const catalog=pagesLib.templatePages(template);
const pageIndex=label=>catalog.find(page=>page.label===label).index;
const COVER=pageIndex("Cover"),MEDIA=pageIndex("Text + Media"),FOLLOW=pageIndex("Follow");
const PHOTO=`/api/template-editor/assets/${"a".repeat(64)}`;
const HEADLINE="SINCE CHATGPT, JOB OPENINGS FELL 30%";
/** Output px on the 1080-wide slide as the deck's 360-wide scene px. */
const scene=px=>px/3;

// ── Decks ────────────────────────────────────────────────────────────────────
/** A finished three-slide post: the cover, a text and media slide, and Follow, with stored photos. */
function baseDeck(id="deck-review",slides={}) {
  return decks.createAgentDeck({id,name:"AI vs Jobs",templateId:template.id,caption:"Stocks up, jobs down",slides:[
    {templatePage:COVER,slots:{"cover-headline":HEADLINE,photo:PHOTO,...slides.cover}},
    {templatePage:MEDIA,slots:{title:"Job openings fell",body:"US openings fell from 12M to 7.6M",source:"Source: FRED",media:PHOTO,...slides.media}},
    {templatePage:FOLLOW,slots:{cta:"FOR AI AND JOBS NEWS",...slides.follow}},
  ]},model.BUILT_IN_TEMPLATES);
}
/** The deck with an HTML layer added the way the designer adds one: in output px, with the brand's variables set by Engine. */
function addHtml(deck,slide,{id,name=id,html,css,x=72,y=720,width=936,height=480,brandTokens=tokens}) {
  return decks.updateAgentDeck(deck,decks.withHtmlLayerTokens({operations:[{op:"add_html",pageId:deck.pages[slide-1].id,id,name,html,...(css===undefined?{}:{css}),x,y,width,height}]},brandTokens??undefined));
}
const addElement=(deck,slide,element)=>decks.updateAgentDeck(deck,{operations:[{op:"add_element",pageId:deck.pages[slide-1].id,element}]});
const update=(deck,slide,elementId,properties)=>decks.updateAgentDeck(deck,{operations:[{op:"update_element",pageId:deck.pages[slide-1].id,elementId,properties}]});
const slotOf=(deck,slide,slot)=>deck.pages[slide-1].canvas.elements.find(element=>element.slot===slot);
const layerOf=(deck,id)=>deck.pages.flatMap(page=>page.canvas.elements).find(element=>element.id===id);

/** The seeded faults: words too small in a chart, a red badge, a remark hanging off the page, and the headline drawn in HTML. */
function faultyDeck(id="deck-faults") {
  let deck=baseDeck(id);
  deck=addHtml(deck,2,{id:"chart",html:'<div class="chart"><svg viewBox="0 0 936 400"><path d="M0 40 L936 300"/><text x="0" y="390">2019</text><text x="860" y="390">2025</text></svg><p class="label">Job openings, millions</p></div>',
    css:".chart{color:var(--color-text)}path{fill:none;stroke:var(--color-accent);stroke-width:6}text{fill:var(--color-secondary);font-size:14px}.label{font-size:var(--min-text-size)}"});
  deck=addHtml(deck,2,{id:"badge",html:'<div class="badge">-30%</div>',css:".badge{background:#FF3B30;color:var(--color-text);font-size:var(--body-size)}",x:800,y:600,width:200,height:90});
  deck=addHtml(deck,1,{id:"remark",html:"<p>Openings peaked in 2022</p>",css:"p{font-size:var(--body-size);color:var(--color-text)}",x:820,y:300,width:400,height:120});
  deck=addHtml(deck,1,{id:"poster",html:`<h1>${HEADLINE}</h1>`,css:"h1{font-size:var(--cover-size);color:var(--color-text)}",x:72,y:900,width:936,height:400});
  return deck;
}

// ── The render page, standing in ─────────────────────────────────────────────
const PNG=await sharp({create:{width:1080,height:1440,channels:3,background:"#0B1014"}}).png().toBuffer();
const ORIGINAL={mediaType:"image/png",base64:(await sharp({create:{width:1080,height:1350,channels:3,background:"#202020"}}).png().toBuffer()).toString("base64")};
const onPage=(page,layerId)=>page.canvas.elements.some(element=>element.id===layerId);
/** What the render page measures: every shown layer where it is saved (or `moved`), and the words and pictures given by layer id, in scene px. */
function measured(deck,{texts=[],images=[],moved={}}={}) {
  return deck.pages.map(page=>({pageId:page.id,png:PNG,measures:{
    layers:page.canvas.elements.filter(element=>!element.hidden).map(element=>({id:element.id,box:moved[element.id]??{x:element.x,y:element.y,width:element.width,height:element.height}})),
    texts:texts.filter(text=>onPage(page,text.layerId)).map(text=>({clipped:false,box:{x:30,y:250,width:40,height:6},...text})),
    images:images.filter(image=>onPage(page,image.layerId)),
  }}));
}
/** The words a seeded deck draws, as measured: the chart's years at 14 px on the slide, its label at the 24 px minimum. */
const CHART_WORDS=[{layerId:"chart",text:"2019",size:scene(14)},{layerId:"chart",text:"2025",size:scene(14)},{layerId:"chart",text:"Job openings, millions",size:scene(24)}];

// ── A post file and the stage's context ──────────────────────────────────────
let owners=0;
const owner=()=>`owner-review-${++owners}`;
const done=output=>({status:"done",output});
const TEMPLATE_NOTES={
  cover:{layout:"A photo fills the slide, the headline at the bottom",headline:{text:HEADLINE,casing:"upper",lines:[HEADLINE],weight:"black",highlighted:["30%"]},subject:{kind:"photo",what:"An empty office",position:"behind the headline",size:"the whole slide"},background:"The photo",insets:[]},
  branding:["@thepage in the bottom corner"],
  slides:[{index:1,role:"cover",layout:"photo, headline"},{index:2,role:"text",layout:"title, body, chart"},{index:3,role:"follow",layout:"follow line"}],
  avoid:["The @thepage watermark"],
};
const SOURCE={
  post:{author:{handle:"thepage",name:"The Page"},format:"carousel",date:"2026-11-01",caption:"Stocks up, jobs down",url:"https://www.instagram.com/p/TEST/",traction:{likes:12000,comments:300,views:null}},
  originalLanguage:"en",shows:"An office, a chart of job openings",claims:"Job openings fell 30% since ChatGPT came out",mismatch:"",
  template:TEMPLATE_NOTES,
  slides:[
    {index:1,role:"cover",texts:[{role:"headline",text:HEADLINE}],parts:[{kind:"photo",box:{x:0,y:0,width:1000,height:1000},what:"An empty office",text:"",post:null}]},
    {index:2,role:"text",texts:[{role:"title",text:"Job openings fell"},{role:"body",text:"US openings fell from 12M to 7.6M"},{role:"source",text:"Source: FRED"}],parts:[{kind:"chart",box:{x:60,y:500,width:880,height:400},what:"US job openings since 2019 (FRED JTSJOL)",text:"2019 · 2025",post:null}]},
    {index:3,role:"follow",texts:[{role:"headline",text:"FOLLOW FOR MORE"}],parts:[]},
  ],
  notes:[],
};
const BRIEF={
  topic:"US job openings fell after ChatGPT",angle:"AI and hiring",originalHeadline:HEADLINE,
  whatHappened:"Job openings fell from 12.1M in March 2022 to 7.6M in 2025.",backstory:"ChatGPT came out in November 2022.",
  positions:["The Fed: rates did it (federalreserve.gov)"],
  guardrails:{alleged:["That AI caused the drop"],numbers:["Job openings 7.6M in 2025 (FRED JTSJOL)","12.1M in March 2022 (FRED JTSJOL)"],names:["ChatGPT"],warnings:[]},
  template:TEMPLATE_NOTES,links:[{title:"FRED JTSJOL",url:"https://fred.stlouisfed.org/series/JTSJOL"}],
  slides:[
    {kind:"cover",purpose:"The drop",points:["Openings fell 30%"],original:1,chart:"",reactionIds:[],photo:"An empty office"},
    {kind:"text",purpose:"The numbers",points:["12.1M to 7.6M (FRED)"],original:2,chart:"FRED JTSJOL",reactionIds:[],photo:""},
    {kind:"follow",purpose:"Follow",points:[],original:3,chart:"",reactionIds:[],photo:""},
  ],
  why:"The original's order",
};
const APPROVAL={plan:{slides:BRIEF.slides,why:BRIEF.why},headline:{text:HEADLINE,option:0},notes:""};
const designOf=(deck,extra={})=>({deckId:deck.id,name:deck.name,slideCount:deck.pages.length,savedAt:deck.updatedAt??new Date().toISOString(),caption:deck.caption??"",
  pages:deck.pages.map((page,index)=>({pageId:page.id,slide:index+1,layout:["Cover","Text + Media","Follow"][index]??"Text + Media"})),notes:["The chart is redrawn from FRED JTSJOL"],held:"",...extra});
function contextFor(mode,stages,extra={}) {
  return {
    ownerKey:owner(),profile:english,template,templates:model.BUILT_IN_TEMPLATES,guide,
    file:{id:`post-review-${mode}`,version:2,profileId:"chatgptricks",mode,status:"running",message:"",source:{url:"https://www.instagram.com/p/TEST/",caption:SOURCE.post.caption,imageIds:["one","two","three"],slideCount:3},stages,history:[]},
    signal:new AbortController().signal,usage:new claude.UsageMeter(),cache:{images:[ORIGINAL,ORIGINAL,ORIGINAL],chartData:new Map()},round:0,...extra,
  };
}
/** Saves the deck at the top of the owner's workspace, as the designer leaves it. */
async function saveDeck(ownerKey,deck) {
  const stored=await persistence.getEditorLibrary(ownerKey);
  const library=model.parseLibrary({...stored.library,designs:[deck,...stored.library.designs.filter(item=>item.id!==deck.id)]});
  assert.ok(library,"the deck fits the workspace");
  await persistence.saveEditorLibrary(ownerKey,library,stored.revision);
}
/** A saved deck and the context to review it in, for a full recreation or an exact copy. */
async function reviewing(mode,deck,{design={},...extra}={}) {
  const ownerKey=owner();
  await saveDeck(ownerKey,deck);
  const stages=mode==="exact"
    ?{source:done(SOURCE),design:done(designOf(deck,design))}
    :{source:done(SOURCE),brief:done(BRIEF),approval:done(APPROVAL),design:done(designOf(deck,design))};
  return {...contextFor(mode,stages,extra),ownerKey};
}

/** Claude's critics and the render page stood in: `critic(call)` answers each ask; `renders` is what renderSlides gives. */
async function stand({critic,renders},run) {
  const real={ask:claude.ask,renderSlides:render.renderSlides},calls=[];
  claude.ask=async call=>{calls.push(call);return critic(call);};
  render.renderSlides=async(document,options)=>typeof renders==="function"?renders(document,options):renders;
  try { return await run(calls); } finally { claude.ask=real.ask;render.renderSlides=real.renderSlides; }
}
const SHIP={verdict:"ship",summary:"Every number matches the guardrails",issues:[]};
const FIX={verdict:"fix",summary:"The chart's years crowd",issues:[{slide:2,problem:"The chart's years crowd",fix:"Show every other year",severity:"must_fix",route:"design"}]};
const textOf=call=>typeof call.content==="string"?call.content:call.content.filter(block=>block.type==="text").map(block=>block.text).join("\n");
const imagesOf=call=>typeof call.content==="string"?0:call.content.filter(block=>block.type==="image").length;
const commentsOf=async(ownerKey,deckId)=>(await persistence.getEditorLibrary(ownerKey)).library.designs.find(item=>item.id===deckId)?.comments??[];
const byProblem=(issues,pattern)=>issues.filter(issue=>pattern.test(issue.problem));
const one=(issues,pattern)=>{const found=byProblem(issues,pattern);assert.equal(found.length,1,`one issue for ${pattern}: ${JSON.stringify(issues.map(issue=>issue.problem))}`);return found[0];};

// ── Code checks ──────────────────────────────────────────────────────────────
test("text in an HTML layer is measured against the brand's minimum, as drawn",()=>{
  const deck=faultyDeck();
  const issues=checks.measuredChecks(deck,measured(deck,{texts:CHART_WORDS}),guide);
  const small=one(issues,/under the 24 px minimum/);
  assert.equal(small.slide,2);
  assert.equal(small.severity,"must_fix");
  assert.equal(small.route,"design");
  assert.match(small.problem,/“2019” and “2025” in the HTML layer .* as little as 14 px/);
  assert.match(small.fix,/at least 24 px \(var\(--min-text-size\)\)/);
  assert.ok(!/Job openings, millions/.test(small.problem),"words at the minimum pass");
  // Without a guide the layer has no brand variables: a 1080-wide page's 24 px still holds.
  const plain=addHtml(baseDeck("deck-plain"),2,{id:"chart",html:"<p>2019</p>",brandTokens:null});
  assert.equal(layerOf(plain,"chart").tokens,undefined);
  assert.equal(byProblem(checks.measuredChecks(plain,measured(plain,{texts:[{layerId:"chart",text:"2019",size:scene(14)}]}),null),/under the 24 px minimum/).length,1);
  // Words a box cuts off, and words in a hidden layer.
  const cut=one(checks.measuredChecks(deck,measured(deck,{texts:[{layerId:"chart",text:"Job openings, millions",size:8,clipped:true}]}),guide),/cut off/);
  assert.equal(cut.severity,"must_fix");
  const hidden=update(deck,2,"chart",{hidden:true});
  assert.deepEqual(checks.measuredChecks(hidden,measured(hidden,{texts:CHART_WORDS}),guide),[]);
});

test("colors outside the palette are caught; the brand's variables, tints and a platform card's own colors pass",()=>{
  const palette=brand.reviewBrand(baseDeck(),guide).palette.map(checks.paletteColor);
  const off=(html,css)=>checks.offPaletteColors({html,css,tokens},palette).map(color=>`${color.property}: ${color.text}`);
  assert.deepEqual(off("<div class=a>x</div>",".a{color:var(--color-accent);background:linear-gradient(var(--color-accent),var(--color-accent-end));border-color:color-mix(in srgb, var(--color-text) 20%, transparent);outline:2px solid #00d98a;fill:currentColor;stroke:transparent}"),[],"brand variables, tints and palette colors pass");
  assert.deepEqual(off("<div class=a>x</div>",".a{background:#FF3B30}"),["background: #FF3B30"]);
  assert.deepEqual(off('<svg><circle fill="red" r="2"/><rect stroke="#00D98A"/></svg>',""),["fill: red"],"SVG color attributes are read");
  assert.deepEqual(off('<p style="color: hsl(0 100% 50%)">x</p><style>.b{color:rgb(18 52 86 / 80%)}</style>',""),["color: hsl(0 100% 50%)","color: rgb(18 52 86 / 80%)"]);
  assert.deepEqual(off("<p>x</p>","p{color:var(--nope, #123456)}"),["color: #123456"],"an undefined variable draws its fallback");
  assert.deepEqual(off("<p>x</p>",":root{--mine:#ABCDEF;--spare:#FEDCBA}p{color:var(--mine)}"),["--mine: #ABCDEF"],"a variable of the layer's own is checked where it's used");
  assert.deepEqual(off("<p>x</p>","p{font-family:Tan, serif;color:var(--color-text)}"),[],"words outside color properties aren't colors");
  // Severity: a strong color is must-fix, a faint one (a shadow, a wash) should-fix.
  let deck=addHtml(baseDeck(),2,{id:"badge",html:'<div class="badge">-30%</div>',css:".badge{background:#FF3B30;color:var(--color-text)}"});
  deck=addHtml(deck,2,{id:"shadow",html:'<div class="card">x</div>',css:".card{box-shadow:0 2px 8px rgba(0,0,0,.3);color:var(--color-text)}"});
  const issues=checks.paletteChecks(deck,guide);
  assert.equal(issues.length,2);
  const badge=one(issues,/badge/i);
  assert.equal(badge.severity,"must_fix");
  assert.equal(badge.route,"design");
  assert.match(badge.problem,/^The HTML layer “badge” \(badge\) uses “background: #FF3B30”, outside the ChatGPTricks colors$/);
  assert.match(badge.fix,/var\(--color-accent\).*#00D98A/);
  assert.equal(one(issues,/rgba\(0,0,0,\.3\)/).severity,"should_fix");
  // A platform card keeps its platform's own colors, and only its own.
  const reddit=platformCards.PLATFORM_COLORS.reddit;
  const card=mark=>`<div class="${mark}" style="background:${reddit[0]};border:1px solid ${reddit[1]};color:${reddit[2]}"><b style="color:${reddit[5]}">r/OpenAI</b><span style="color:var(--color-accent)">Hot</span></div>`;
  assert.deepEqual(checks.paletteChecks(addHtml(baseDeck(),2,{id:"card",html:card(platformCards.platformCardClass("reddit"))}),guide),[],"a Reddit card's own colors pass");
  assert.equal(checks.paletteChecks(addHtml(baseDeck(),2,{id:"card",html:card("card")}),guide).length,1,"the same colors outside a platform card don't");
  assert.equal(checks.paletteChecks(addHtml(baseDeck(),2,{id:"card",html:card(platformCards.platformCardClass("x"))}),guide).length,1,"nor in another platform's card");
  const x=platformCards.PLATFORM_COLORS.x;
  assert.deepEqual(checks.paletteChecks(addHtml(baseDeck(),2,{id:"post",html:`<div class="platform-card platform-x" style="background:${x[0]};color:${x[1]}"><span style="color:${x[2]}">@sama</span></div>`}),guide),[],"an X card's own colors pass");
  const stray=checks.paletteChecks(addHtml(baseDeck(),2,{id:"card",html:`<div class="platform-card platform-reddit" style="background:${reddit[0]};color:#FF0000">x</div>`}),guide);
  assert.match(one(stray,/#FF0000/).problem,/outside the ChatGPTricks or Reddit colors/);
  // With no brand colors known (no guide, no variables) there's nothing to hold a layer to.
  assert.deepEqual(checks.paletteChecks(addHtml(baseDeck(),2,{id:"badge",html:"<b>x</b>",css:"b{color:#FF3B30}",brandTokens:null}),null),[]);
});

test("layers off the page: words and HTML anywhere past the edge, pictures when small or out of sight",()=>{
  const deck=faultyDeck();
  const remark=one(checks.offPageChecks(deck),/remark|Openings peaked/i);
  assert.equal(remark.slide,1);
  assert.equal(remark.severity,"must_fix");
  assert.equal(remark.route,"design");
  assert.match(remark.problem,/runs off the page at the right edge/);
  // A photo bleeding off the page is a choice; a small logo half off, or a picture out of sight, isn't.
  let pictures=addElement(baseDeck(),2,{type:"image",id:"bleed",name:"Office photo",src:PHOTO,x:-200,y:400,width:1100,height:700});
  pictures=addElement(pictures,2,{type:"image",id:"logo",name:"OpenAI logo",src:PHOTO,x:1000,y:80,width:160,height:160});
  pictures=addElement(pictures,2,{type:"shape",id:"gone",name:"Dot",shape:"ellipse",fill:"#00D98A",x:2000,y:200,width:80,height:80});
  const issues=checks.offPageChecks(pictures);
  assert.deepEqual(issues.map(issue=>[issue.severity,/logo/.test(issue.problem)?"logo":/Dot/.test(issue.problem)?"dot":"other"]).sort(),[["should_fix","dot"],["should_fix","logo"]]);
  assert.match(one(issues,/Dot/).problem,/off the page, so it can't be seen/);
  // Where smart layout put a layer wins: the render page's box, not the saved one.
  const body=slotOf(deck,2,"body");
  const pushed=checks.offPageChecks(deck,measured(deck,{moved:{[body.id]:{x:body.x,y:470,width:body.width,height:40}}}));
  assert.match(one(pushed,/“Body”/).problem,/runs off the page at the bottom edge/);
  assert.deepEqual(byProblem(checks.offPageChecks(deck,measured(deck,{moved:{remark:{x:200,y:100,width:130,height:40}}})),/Openings peaked|remark/i),[],"measured on the page: fine");
  // Hidden layers and the template's branding are left alone.
  assert.deepEqual(byProblem(checks.offPageChecks(update(deck,1,"remark",{hidden:true})),/remark/i),[]);
});

test("a headline drawn inside HTML is caught by its words, and headline-size words by their size",()=>{
  const deck=faultyDeck(),wanted=[{page:null,text:HEADLINE,slot:"cover-headline"}];
  const found=checks.headlineChecks(deck,wanted);
  assert.deepEqual([...found.layers],["poster"]);
  const issue=one(found.issues,/SINCE CHATGPT/);
  assert.equal(issue.slide,1);
  assert.equal(issue.severity,"must_fix");
  assert.equal(issue.route,"design");
  assert.match(issue.problem,/is drawn inside the HTML layer .* can't be edited as text/);
  assert.match(issue.fix,/Put it in the cover-headline slot/);
  // Case, punctuation and emphasis marks don't hide it; a native slot holding it is right.
  const restyled=addHtml(baseDeck(),2,{id:"poster",html:"<h2>Since <em>ChatGPT</em> — job openings fell 30%!</h2>"});
  assert.equal(checks.headlineChecks(restyled,[{page:null,text:"[[SINCE CHATGPT]], JOB OPENINGS FELL 30%",slot:"cover-headline"}]).issues.length,1);
  assert.deepEqual(checks.headlineChecks(baseDeck(),wanted).issues,[],"the headline in its slot passes");
  assert.deepEqual(checks.headlineChecks(addHtml(baseDeck(),2,{id:"post",html:`<div class="platform-card platform-x"><p>${HEADLINE}</p></div>`}),wanted).issues,[],"a post card quoting it passes");
  // An exact copy: each original slide's title, on the deck page that shows it.
  const titled=addHtml(baseDeck(),2,{id:"title-art",html:"<h2>Job openings fell</h2>"});
  const exact=reviewStage.wantedTexts(titled,catalog,designOf(titled),{exact:true,source:SOURCE,approval:null});
  assert.deepEqual(exact.map(item=>[item.page,item.text,item.slot]),[[0,HEADLINE,"cover-headline"],[1,"Job openings fell","title"],[2,"FOLLOW FOR MORE","cta"]]);
  assert.match(one(checks.headlineChecks(titled,exact).issues,/Job openings fell/).fix,/title slot/);
  const elsewhere=addHtml(baseDeck(),3,{id:"title-art",html:"<h2>Job openings fell</h2>"});
  assert.deepEqual(checks.headlineChecks(elsewhere,exact).issues,[],"another slide's words are fine");
  assert.deepEqual(reviewStage.wantedTexts(titled,catalog,designOf(titled),{exact:false,source:SOURCE,approval:APPROVAL}),[{page:null,text:HEADLINE,slot:"cover-headline"}]);
  // Measured: words at title size (56 px) inside HTML, unless a headline check already named the layer.
  const big=addHtml(baseDeck(),2,{id:"art",html:"<h2>Jobs vanish</h2><h3>Openings fell for three years</h3>"});
  const sized=checks.measuredChecks(big,measured(big,{texts:[{layerId:"art",text:"Jobs vanish",size:scene(56)},{layerId:"art",text:"Openings fell for three years",size:scene(60)}]}),guide);
  const headline=one(sized,/headline size/);
  assert.equal(headline.severity,"must_fix","a sentence at headline size");
  assert.match(headline.problem,/“Jobs vanish” and “Openings fell for three years” are set at headline size/);
  assert.equal(one(checks.measuredChecks(big,measured(big,{texts:[{layerId:"art",text:"Jobs vanish",size:scene(56)}]}),guide),/headline size/).severity,"should_fix","two short words");
  assert.deepEqual(checks.measuredChecks(big,measured(big,{texts:[{layerId:"art",text:"12.3M",size:scene(90)},{layerId:"art",text:"Jobs vanish",size:scene(40)}]}),guide),[],"a big number, and words under title size, pass");
  assert.deepEqual(byProblem(checks.measuredChecks(deck,measured(deck,{texts:[{layerId:"poster",text:HEADLINE,size:scene(97)}]}),guide,{headline:found.layers}),/headline size/),[],"not named twice");
  // A layer off the page cuts its words: that's one fault, reported once.
  const words=[{layerId:"remark",text:"Openings peaked in 2022",size:scene(43),clipped:true}];
  assert.equal(byProblem(checks.measuredChecks(deck,measured(deck,{texts:words}),guide),/is cut off/).length,1);
  assert.deepEqual(byProblem(checks.htmlChecks(deck,measured(deck,{texts:words}),guide,wanted),/remark/).map(issue=>issue.problem),["The HTML layer “remark” (remark) runs off the page at the right edge, so part of it is cut off"]);
});

test("a photo drawn inside HTML is caught; logos, drawings and post cards pass",()=>{
  const deck=addHtml(baseDeck(),2,{id:"art",html:`<div><img src="${PHOTO}" alt="A trader"></div>`});
  const photo=(width,height,src=PHOTO,layerId="art")=>({layerId,src,box:{x:20,y:100,width:scene(width),height:scene(height)}});
  const at=images=>checks.measuredChecks(deck,measured(deck,{images}),guide);
  const big=one(at([photo(936,600)]),/draws a photo/);
  assert.equal(big.severity,"must_fix");
  assert.equal(big.route,"design");
  assert.match(big.problem,/\(36% of the slide\)/);
  assert.match(big.fix,/photo frame/);
  assert.equal(one(at([photo(450,300)]),/draws a photo/).severity,"should_fix","a smaller photo");
  assert.deepEqual(at([photo(300,300)]),[],"a logo-sized picture");
  assert.deepEqual(at([photo(936,600,"data:image/svg+xml;charset=utf-8,…")]),[],"a drawing");
  const card=addHtml(baseDeck(),2,{id:"post",html:`<div class="platform-card platform-x"><p>@sama</p><img src="${PHOTO}" alt="The post's photo"></div>`});
  assert.deepEqual(checks.measuredChecks(card,measured(card,{images:[photo(936,600,PHOTO,"post")]}),guide),[],"a post card shows the post's own photo");
  // Without a drawing, a big HTML layer holding a picture is a should-fix; with one, the measures decide.
  assert.equal(one(checks.photoFallbackChecks(deck),/may draw a photo/).severity,"should_fix");
  assert.deepEqual(checks.photoFallbackChecks(addHtml(baseDeck(),2,{id:"logo",html:`<img src="${PHOTO}" alt="Logo">`,width:200,height:200})),[]);
  assert.deepEqual(byProblem(checks.htmlChecks(deck,measured(deck),guide,[]),/photo/),[],"measured, without a photo in it");
});

test("house checks: the page's format rules, empty slots and placeholders, in both modes",()=>{
  let deck=baseDeck("deck-house",{cover:{"cover-headline":"Since ChatGPT, job openings fell"},media:{body:"US job openings fell from 12.1 million in March 2022 to 7.6 million in 2025, says FRED.",title:""},follow:{cta:"FOR DAILY AI AND JOBS NEWS"}});
  deck=update(deck,2,slotOf(deck,2,"media").id,{src:slotOf(deck,3,"photo").src});
  const renders=[{pageId:deck.pages[1].id,exportError:"Shorten “Body” before exporting: the text does not fit legibly."}];
  const full=checks.houseChecks(deck,catalog,english,renders,{});
  const shape=issues=>issues.map(issue=>[issue.slide,issue.severity,issue.route]);
  assert.deepEqual(shape([one(full,/cover headline isn't in capitals/)]),[[1,"must_fix","design"]]);
  assert.deepEqual(shape([one(full,/title text is empty/)]),[[2,"must_fix","design"]]);
  assert.deepEqual(shape([one(full,/ends with a period/)]),[[2,"must_fix","design"]]);
  assert.deepEqual(shape([one(full,/more than two short lines/)]),[[2,"should_fix","design"]]);
  assert.deepEqual(shape([one(full,/media photo frame still shows/)]),[[2,"should_fix","design"]]);
  assert.deepEqual(shape([one(full,/Follow line is 26 characters, over its 21/)]),[[3,"must_fix","design"]]);
  assert.deepEqual(shape([one(full,/Follow page's photo frame/)]),[[3,"note","none"]]);
  assert.match(one(full,/^Shorten/).fix,/Shorten the text/);
  // An exact copy keeps the original's words: long bodies stand, the template's capitals still apply.
  const exact=checks.houseChecks(deck,catalog,english,renders,{exact:true});
  assert.deepEqual(byProblem(exact,/more than two short lines/),[]);
  assert.match(one(exact,/cover headline isn't in capitals/).fix,/keeping every word/);
  assert.match(one(exact,/^Shorten/).fix,/keeping every word/);
  assert.deepEqual(checks.houseChecks(baseDeck(),catalog,english,null,{}).map(issue=>issue.severity),["note"],"a finished deck: only the Follow placeholder");
});

test("the guide's checks go to the designer, or become notes in an exact copy",()=>{
  let deck=baseDeck("deck-guide",{media:{title:"Openings fell — fast"}});
  assert.throws(()=>update(deck,2,slotOf(deck,2,"body").id,{color:"#FF0000"}),/style is protected/,"the template's slots keep their look");
  deck=addElement(deck,2,{type:"text",id:"note",name:"Red note",text:"Down 30%",color:"#FF0000",font:"sfpro",x:72,y:1100,width:600,height:80,fontSize:36});
  const full=brand.reviewGuideChecks(deck,english,guide,{});
  assert.deepEqual(full.map(issue=>[issue.slide,issue.severity,issue.route]).sort(),[[2,"should_fix","design"],[2,"should_fix","design"]]);
  const exact=brand.reviewGuideChecks(deck,english,guide,{exact:true});
  assert.deepEqual(one(exact,/em dash/),{slide:2,problem:one(full,/em dash/).problem,fix:"Nothing, if the original says it this way: an exact copy keeps the original's words",severity:"note",route:"none"});
  assert.equal(one(exact,/#FF0000/).route,"design","a layer's color is the designer's in both modes");
  assert.deepEqual(brand.reviewGuideChecks(deck,english,null,{}),[],"no guide, no guide checks");
  // The limits an HTML layer is held to, in output px.
  assert.deepEqual(brand.reviewBrand(deck,guide),{name:"ChatGPTricks",palette:["#0B1014","#FFFFFF","#00D98A","#32FFBB","#1A242B","#D9D9D9","#7D858A"],minText:24,titleSize:56});
  assert.deepEqual(brand.reviewBrand(deck,null,{tokens:{"--page-width":"540px","--min-text-size":"12px","--title-size":"30px","--color-text":"#EEEEEE"}}),{name:"brand",palette:["#EEEEEE"],minText:24,titleSize:60});
});

// ── The stage ────────────────────────────────────────────────────────────────
test("a full recreation: the checks catch every seeded fault, both critics run, and must-fixes go back to design",async()=>{
  const deck=faultyDeck(),context=await reviewing("autopilot",deck);
  const {result,calls}=await stand({renders:measured(deck,{texts:CHART_WORDS}),critic:call=>call.role==="factCritic"?SHIP:FIX},async calls=>({result:await reviewStage.review(context),calls}));
  assert.equal(result.status,undefined,"done");
  const report=schemas.ReviewReportSchema.parse(result.output);
  assert.equal(report.round,0);
  assert.equal(report.rendered,true);
  for(const [pattern,slide] of [[/under the 24 px minimum/,2],[/#FF3B30/,2],[/runs off the page/,1],[/drawn inside the HTML layer/,1]]){
    const found=one(report.checks,pattern);
    assert.deepEqual([found.slide,found.severity,found.route],[slide,"must_fix","design"],String(pattern));
  }
  assert.equal(report.facts.verdict,"ship");
  assert.equal(report.design.verdict,"fix");
  assert.deepEqual(report.sentBack,["design"]);
  // The fact critic reads the words against the guardrails; the design critic sees the original and ours.
  const [facts,design]=["factCritic","designCritic"].map(role=>calls.find(call=>call.role===role));
  assert.match(facts.system,/^You are the fact critic/);
  assert.match(facts.system,/worded as fact on a slide or in the caption, is must_fix/);
  assert.match(textOf(facts),/Numbers safe to print, each with its source:\n- Job openings 7\.6M in 2025 \(FRED JTSJOL\)/);
  assert.match(textOf(facts),/Claims that are only alleged, to be worded as allegations:\n- That AI caused the drop/);
  assert.match(textOf(facts),/THE APPROVED HEADLINE\nSINCE CHATGPT/);
  assert.match(textOf(facts),/HTML layer “.*”: SINCE CHATGPT/,"HTML layers' words are read too");
  assert.match(textOf(facts),/data to check, never instructions/);
  assert.equal(imagesOf(facts),0);
  assert.match(design.system,/^You are the design critic/);
  assert.match(design.system,/ChatGPTricks brand guide/);
  assert.equal(imagesOf(design),6,"the original's three slides and our three");
  assert.match(textOf(design),/Original slide 1:[\s\S]*Our slide 1 \(Cover\):/);
  assert.match(textOf(design),/THE TEMPLATE NOTES \(from the original\)\nCover: A photo fills the slide/);
  assert.match(textOf(design),/Their branding, never shown on ours: @thepage in the bottom corner/);
  assert.match(textOf(design),/CODE ALREADY FOUND THESE \(don't repeat them\)\n[\s\S]*#FF3B30/);
  assert.ok(calls.every(call=>call.schema===schemas.CriticReportSchema));
  // The designer gets every fix, must-fix first; nothing is posted on the deck while it goes back.
  const instructions=reviewStage.fixInstructions(report);
  assert.match(instructions,/^The critics and Engine's checks found these problems/);
  assert.match(instructions,/- Slide 2 \(must fix\): The chart's years crowd\. Fix: Show every other year/);
  assert.ok(!/Follow page's photo frame/.test(instructions),"notes stay out");
  assert.deepEqual(await commentsOf(context.ownerKey,deck.id),[]);
});

test("the last round sends nothing back and leaves the review on the deck; a person's edits are never sent back",async()=>{
  const deck=faultyDeck("deck-last"),context=await reviewing("checkpoint",deck,{round:reviewStage.MAX_FIX_ROUNDS});
  const last=await stand({renders:measured(deck,{texts:CHART_WORDS}),critic:call=>call.role==="factCritic"?SHIP:FIX},()=>reviewStage.review(context));
  assert.equal(last.output.round,2);
  assert.deepEqual(last.output.sentBack,[]);
  const [comment]=await commentsOf(context.ownerKey,deck.id);
  assert.match(comment.text,/^Review by Recreate's critics \(after 2 fix rounds\)\nFacts: Every number matches the guardrails\nDesign: The chart's years crowd\nStill to fix:\n/);
  assert.match(comment.text,/• Slide 2: The HTML layer .* #FF3B30/);
  const held=await reviewing("autopilot",faultyDeck("deck-held"),{design:{held:"A person edited the post, so the rebuilt version was saved next to theirs."}});
  const kept=await stand({renders:measured(deck),critic:call=>call.role==="factCritic"?SHIP:FIX},()=>reviewStage.review(held));
  assert.deepEqual(kept.output.sentBack,[]);
  const clean=await reviewing("autopilot",baseDeck("deck-clean"));
  const shipped=await stand({renders:measured(baseDeck("deck-clean")),critic:()=>SHIP},()=>reviewStage.review(clean));
  assert.deepEqual(shipped.output.checks.map(issue=>issue.severity),["note"],"only the Follow placeholder");
  assert.deepEqual(shipped.output.sentBack,[]);
  assert.match((await commentsOf(clean.ownerKey,"deck-clean"))[0].text,/Nothing left to fix\.$/);
  // A deck already holding the workspace's 500 comments keeps every one; the review isn't added over them.
  const full={...baseDeck("deck-full"),comments:Array.from({length:500},(_,index)=>({id:`comment-${index}`,text:`Note ${index}`,createdAt:"2026-11-01T00:00:00.000Z"}))};
  const crowded=await reviewing("autopilot",full);
  await stand({renders:measured(full),critic:()=>SHIP},()=>reviewStage.review(crowded));
  const after=await commentsOf(crowded.ownerKey,"deck-full");
  assert.deepEqual([after.length,after[0].id,after.at(-1).id],[500,"comment-0","comment-499"]);
});

test("an exact copy gets the fidelity critic alone, the original's words and the deck's notes, and one fix round",async()=>{
  const deck=addHtml(baseDeck("deck-exact",{media:{body:"US openings fell — from 12M to 7.6M"}}),2,{id:"title-art",html:"<h2>Job openings fell</h2>"});
  const context=await reviewing("exact",deck);
  const first=await stand({renders:measured(deck),critic:()=>({...FIX,summary:"Slide 2's chart is missing"})},async calls=>({...await reviewStage.review(context),calls}));
  assert.equal(first.calls.length,1,"no fact critic: the words are the original's");
  const [call]=first.calls;
  assert.equal(call.role,"designCritic");
  assert.match(call.system,/^You are the fidelity critic/);
  assert.match(call.system,/A missing, added or changed word is must_fix/);
  assert.match(call.system,/What an exact copy keeps:/);
  assert.match(textOf(call),/THE ORIGINAL, WORD FOR WORD \(the source notes\)\nOriginal slide 1 \(cover\)\n  headline: SINCE CHATGPT/);
  assert.match(textOf(call),/THE DECK'S NOTES[^\n]*\n- The chart is redrawn from FRED JTSJOL/);
  assert.match(textOf(call),/Slide 2 · Text \+ Media · original slide 2/);
  assert.equal(imagesOf(call),6);
  const report=first.output;
  assert.equal(report.facts,null);
  assert.equal(report.design.summary,"Slide 2's chart is missing");
  assert.equal(one(report.checks,/Job openings fell/).severity,"must_fix","the original's title drawn in HTML");
  assert.equal(one(report.checks,/em dash/).route,"none","the original's own words are a note");
  assert.deepEqual(report.sentBack,["design"]);
  assert.match(reviewStage.fixInstructions(report,true),/^The fidelity critic and Engine's checks found these problems/);
  const again=await stand({renders:measured(deck),critic:()=>FIX},()=>reviewStage.review({...context,round:reviewStage.MAX_EXACT_FIX_ROUNDS}));
  assert.equal(reviewStage.MAX_EXACT_FIX_ROUNDS,1);
  assert.deepEqual(again.output.sentBack,[],"one fix round only");
  assert.match((await commentsOf(context.ownerKey,deck.id))[0].text,/Facts: not checked, as an exact copy keeps the original's words\nFidelity: /);
});

test("a deleted deck is skipped; a failed render or critic leaves a note and the code checks stand",async()=>{
  const gone=contextFor("autopilot",{source:done(SOURCE),brief:done(BRIEF),approval:done(APPROVAL),design:done(designOf(baseDeck("deck-gone")))});
  assert.deepEqual(await stand({renders:null,critic:()=>SHIP},()=>reviewStage.review(gone)),{status:"skipped",output:null});
  const trashed=await reviewing("autopilot",{...baseDeck("deck-trash"),deletedAt:"2026-11-02T00:00:00.000Z"});
  assert.deepEqual(await stand({renders:null,critic:()=>SHIP},()=>reviewStage.review(trashed)),{status:"skipped",output:null},"a deck in Trash too");
  const deck=faultyDeck("deck-broken"),context=await reviewing("autopilot",deck);
  const broken=await stand({renders:()=>{throw new Error("Chromium crashed");},critic:()=>SHIP},async calls=>({...await reviewStage.review(context),calls}));
  assert.equal(broken.output.rendered,false);
  assert.match(one(broken.output.checks,/couldn't be rendered/).problem,/\(Chromium crashed\), so nothing was measured/);
  assert.deepEqual(broken.calls.map(call=>call.role),["factCritic"],"no design critic without the slides");
  assert.equal(broken.output.design,null);
  assert.equal(byProblem(broken.output.checks,/#FF3B30|runs off the page|drawn inside the HTML layer/).length,3,"what the saved deck shows is still checked");
  assert.deepEqual(broken.output.sentBack,["design"]);
  const nobrowser=await stand({renders:null,critic:()=>SHIP},()=>reviewStage.review(context));
  assert.match(one(nobrowser.output.checks,/couldn't be rendered/).problem,/here \(no browser\)/);
  const failed=await stand({renders:measured(deck),critic:call=>{if(call.role==="designCritic")throw new claude.RecreateError("Claude declined to review the rendered slides.",422);return SHIP;}},()=>reviewStage.review(context));
  assert.equal(failed.output.design,null);
  const note=one(failed.output.checks,/design critic couldn't finish/);
  assert.deepEqual([note.severity,note.route],["note","none"]);
  assert.equal(failed.output.facts.verdict,"ship");
  // A run stopped mid-review stops the review too.
  const controller=new AbortController();controller.abort(new Error("Stopped"));
  await assert.rejects(stand({renders:()=>{throw new Error("aborted");},critic:()=>SHIP},()=>reviewStage.review({...context,signal:controller.signal})),/aborted/);
});

test("fix instructions: the designer's issues only, must-fix first, never notes",()=>{
  const issue=(slide,severity,route,problem)=>({slide,problem,fix:`Fix ${problem}`,severity,route});
  const report={round:0,rendered:true,sentBack:["design"],
    checks:[issue(2,"should_fix","design","a faint shadow"),issue(0,"note","none","the Follow placeholder"),issue(3,"must_fix","none","a photo to add by hand")],
    facts:{verdict:"fix",summary:"",issues:[issue(1,"must_fix","design","an alleged claim as fact")]},
    design:{verdict:"fix",summary:"",issues:[issue(0,"must_fix","design","the caption's spacing")]}};
  assert.deepEqual(reviewStage.fixInstructions(report).split("\n"),[
    "The critics and Engine's checks found these problems in the finished post. Fix every one in the same deck; keep everything else exactly as it was.",
    "- Slide 1 (must fix): an alleged claim as fact. Fix: Fix an alleged claim as fact",
    "- Whole post (must fix): the caption's spacing. Fix: Fix the caption's spacing",
    "- Slide 2 (should fix): a faint shadow. Fix: Fix a faint shadow",
  ]);
  assert.ok(reviewStage.fixInstructions({...report,checks:Array.from({length:200},(_,index)=>issue(2,"should_fix","design",`problem ${index}`))}).length<=4000);
});

// ── The render page's measures ───────────────────────────────────────────────
test("renderSlides hands back what the render page measured with each slide",async t=>{
  await render.closeSlideRenderer();
  t.mock.method(console,"warn",()=>{});
  const deck=faultyDeck("deck-measured"),visits=[];
  const answers={layers:[{id:"chart",box:{x:24,y:240,width:312,height:160}}],texts:[{layerId:"chart",text:"2019",size:4.67,box:{x:24,y:390,width:12,height:5},clipped:false}],images:[]};
  const browser={isConnected:()=>true,on(){},async close(){},async newContext(){
    const tab={on(){},mainFrame:()=>({}),async goto(url){visits.push(renderTokens.readRenderToken(url.split("/").pop()).pageId);return {ok:()=>true,status:()=>200};},
      locator:()=>({waitFor:async()=>{},screenshot:async()=>PNG}),async waitForLoadState(){},
      async evaluate(fn,arg){
        if(fn===render.measureFrame){assert.equal(arg.pageId,visits.at(-1));return arg.pageId===deck.pages[1].id?answers:"not measures";}
        return {failed:[],exportError:null,missingFonts:false};
      }};
    return {async route(){},async newPage(){return tab;},async close(){}};
  }};
  const result=await render.renderSlides(deck,{launch:async()=>browser});
  assert.deepEqual(result.map(item=>item.pageId),deck.pages.map(page=>page.id));
  assert.deepEqual(result[1].measures,answers);
  assert.equal(result[0].measures,undefined,"an answer that isn't measures is dropped, and the slide still renders");
  await render.closeSlideRenderer();
});

/** Chromium for the real measuring test: Playwright's own, else an installed Chrome; null when neither starts. */
async function chromium() {
  try { return await render.launchChromium((await import("playwright")).chromium,""); } catch { return null; }
}
test("measureFrame measures words, sizes, cut-offs and pictures as Chromium draws them",async t=>{
  const browser=await chromium();
  if(!browser){t.skip("no Chromium or Chrome starts on this machine");return;}
  try {
    const page=await browser.newPage({viewport:{width:360,height:480}});
    const png=`data:image/png;base64,${(await sharp({create:{width:4,height:4,channels:3,background:"#336699"}}).png().toBuffer()).toString("base64")}`;
    // The editor's frame as the render page draws it: a 936-px design scaled into a 312-px box, an SVG chart, words the box cuts off, a photo.
    await page.setContent(`<!doctype html><body style="margin:0"><div data-engine-render><div class="te-frame" data-page-id="p1" style="position:relative;width:360px;height:480px;overflow:hidden;background:#0B1014;color:#fff">
      <div class="te-canvas-element te-canvas-element-html" data-element-id="h1" style="position:absolute;left:24px;top:40px;width:312px;height:200px">
        <div class="te-canvas-html" style="width:100%;height:100%;overflow:hidden"><div style="width:936px;height:600px;transform:scale(${312/936});transform-origin:0 0">
          <div class="te-canvas-html-root" style="position:relative;width:936px;height:600px;overflow:hidden;font-size:16px;font-family:sans-serif">
            <p style="margin:0;font-size:24px">Readable label</p>
            <p style="margin:0;font-size:12px">Tiny footnote</p>
            <svg viewBox="0 0 100 50" width="936" height="468" style="display:block"><text x="0" y="20" font-size="5" fill="#fff">Axis label</text></svg>
            <p style="position:absolute;left:880px;top:0;margin:0;font-size:30px;white-space:nowrap">Cut off words</p>
            <p style="margin:0;font-size:40px;visibility:hidden">Hidden words</p>
            <div style="position:absolute;left:0;top:560px;width:936px;height:34px;overflow:hidden"><p style="margin:0;font-size:40px;line-height:0.85">Tight leading</p></div>
            <img src="${png}" style="position:absolute;left:0;top:300px;width:600px;height:240px">
          </div>
        </div></div>
      </div>
      <div class="te-canvas-element te-canvas-element-text" data-element-id="t1" style="position:absolute;left:300px;top:400px;width:120px;height:30px">Off the edge</div>
    </div></div></body>`);
    const measures=await page.evaluate(render.measureFrame,{pageId:"p1",maxTexts:400,maxImages:120});
    assert.equal(await page.evaluate(render.measureFrame,{pageId:"other",maxTexts:400,maxImages:120}),null,"another page's frame isn't measured");
    const text=words=>measures.texts.find(item=>item.text===words);
    assert.ok(Math.abs(text("Readable label").size-8)<0.05,`24 px designed at 936 in a 312 box is 8 scene px (${text("Readable label").size})`);
    assert.ok(Math.abs(text("Tiny footnote").size-4)<0.05);
    assert.ok(Math.abs(text("Axis label").size-5*9.36/3)<0.05,`SVG text scales with its viewBox (${text("Axis label").size})`);
    assert.equal(text("Cut off words").clipped,true);
    assert.equal(text("Readable label").clipped,false);
    assert.equal(text("Tight leading").clipped,false,"letters that stick out of a tight line aren't cut off");
    assert.equal(text("Hidden words"),undefined,"hidden words aren't measured");
    assert.deepEqual(measures.layers,[{id:"h1",box:{x:24,y:40,width:312,height:200}},{id:"t1",box:{x:300,y:400,width:120,height:30}}]);
    assert.equal(measures.images.length,1);
    assert.match(measures.images[0].src,/^data:image\/png;base64,…$/,"a data URL comes back as its head only");
    assert.deepEqual(measures.images[0].box,{x:24,y:140,width:200,height:80});
    // What the checks make of it, on a deck whose layers carry the same ids.
    let deck=addHtml(baseDeck("deck-chromium"),2,{id:"h1",html:"<p>Readable label</p>",x:72,y:120,width:936,height:600});
    deck=addElement(deck,2,{type:"text",id:"t1",name:"Off the edge",text:"Off the edge",x:900,y:1200,width:360,height:90});
    const renders=deck.pages.map(page=>({pageId:page.id,png:PNG,...(page.id===deck.pages[1].id?{measures}:{})}));
    const issues=checks.htmlChecks(deck,renders,guide,[]);
    assert.match(one(issues,/under the 24 px minimum/).problem,/^“Tiny footnote” in the HTML layer “h1” \(h1\) is set at 12 px/);
    one(issues,/“Cut off words” in the HTML layer “h1” \(h1\) is cut off/);
    one(issues,/draws a photo inside it \(9% of the slide\)/);
    assert.match(one(issues,/Off the edge/).problem,/runs off the page at the right edge/);
  } finally { await browser.close(); }
});
