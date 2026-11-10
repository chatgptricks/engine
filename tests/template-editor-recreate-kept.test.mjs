/* Run: node --test tests/template-editor-recreate-kept.test.mjs
 * Each image in the original gets a decision (Ivan, 2026-11-10): rebuild it in
 * our style, keep it as it is (an official screenshot, a photo), or find its
 * source (the original online at better quality, else the cut from the post).
 * Covers the decision's rules and defaults, the run view's line, finding the
 * original by likeness, cutting and placing kept pictures whole on the margins,
 * Engine's check on them, and what the critics and the role cards say. Claude
 * and the web are never called: the page finder and fetch are stand-ins. Local
 * development storage only. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import sharp from "sharp";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-kept-test-"));
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

const notesLib=load("lib/engine/agents/source-notes.ts");
const originals=load("lib/engine/agents/originals.ts");
const kept=load("lib/engine/agents/kept.ts");
const tools=load("lib/engine/agents/design-tools.ts");
const designStage=load("lib/engine/agents/stages/design.ts");
const schemas=load("lib/engine/agents/schemas.ts");
const reviewCards=load("lib/engine/agents/cards/review.ts");
const playbookLib=load("lib/engine/agents/playbook.ts");
const model=load("lib/template-editor/model.ts");
const profiles=load("lib/engine/page-profiles.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");

// ── Pictures ────────────────────────────────────────────────────────────────
/** A made-up "announcement page": a light page with a dark header, a coloured hero and lines of text, drawn at any size. */
async function page(width,height,{hue=40,seed=0}={}) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="#f4f4f2"/><rect width="400" height="40" fill="#111"/>
    <rect x="${30+seed*40}" y="60" width="200" height="110" fill="hsl(${hue},70%,45%)"/>
    ${[0,1,2,3].map(i=>`<rect x="30" y="${190+i*22}" width="${300-i*50-seed*30}" height="10" fill="#333"/>`).join("")}
    <circle cx="${330-seed*200}" cy="110" r="40" fill="#0a7"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const meta=async bytes=>{const {width,height}=await sharp(bytes).metadata();return {bytes,width,height};};

// ── 1. The decision ─────────────────────────────────────────────────────────
test("each part's decision: posts, charts and logos are always rebuilt, photos never, a comment is never kept, and parts without one are rebuilt as before", () => {
  const box={x:100,y:100,width:500,height:400};
  const decide=part=>notesLib.decisionOf({box,what:"",text:"",post:null,...part});
  assert.equal(decide({kind:"x_post",treatment:"keep"}).treatment,"rebuild");
  assert.equal(decide({kind:"chart",treatment:"source"}).treatment,"rebuild");
  assert.equal(decide({kind:"logo",treatment:"keep"}).treatment,"rebuild");
  assert.equal(decide({kind:"photo",treatment:"rebuild"}).treatment,"keep");
  assert.equal(decide({kind:"photo",treatment:"source",why:"Soft, under the post's caption"}).treatment,"source");
  const kept=decide({kind:"screenshot",treatment:"keep",why:"OpenAI's own announcement page\nwith its hero",origin:"openai.com/index/gpt-6"});
  assert.deepEqual(kept,{treatment:"keep",why:"OpenAI's own announcement page with its hero",origin:"openai.com/index/gpt-6"});
  // The reader called a Reddit comment's screenshot one to keep: our cards draw comments.
  const comment=decide({kind:"screenshot",treatment:"keep",what:"A Reddit comment by u/throwaway about quitting",why:"Kept"});
  assert.equal(comment.treatment,"rebuild");
  assert.match(comment.why,/rebuilt in our style/);
  assert.equal(comment.origin,null);
  // An older file, or a hand-in without decisions: as before, everything but photos is rebuilt.
  assert.equal(decide({kind:"screenshot"}).treatment,"rebuild");
  assert.equal(decide({kind:"graphic"}).treatment,"rebuild");
  assert.equal(decide({kind:"photo"}).treatment,"keep");
  assert.match(decide({kind:"photo"}).why,/real photo/i);
  // A reason written for a decision code overrode gives way to the kind's own.
  assert.match(decide({kind:"chart",treatment:"keep",why:"Keep it"}).why,/redrawn/);
});

test("the source notes carry each decision; the run view counts and lists them; a handed-in reading may leave them out", () => {
  const box={x:100,y:100,width:500,height:400};
  const notes={slides:[
    {index:1,role:"cover",texts:[],parts:[{kind:"photo",box,what:"Sam Altman",text:"",post:null}]},
    {index:2,role:"other",texts:[],parts:[
      {kind:"screenshot",box,what:"OpenAI's pricing page",text:"",post:null,treatment:"keep",why:"OpenAI's own pricing page",origin:null},
      {kind:"screenshot",box,what:"OpenAI's blog post",text:"",post:null,treatment:"source",why:"Soft and under the post's sticker",origin:"openai.com/index/x"},
      {kind:"chart",box,what:"Revenue",text:"",post:null,treatment:"rebuild",why:"A chart",origin:null},
    ]},
  ]};
  const decisions=notesLib.imageDecisions(notes);
  assert.deepEqual(decisions.map(item=>[item.slide,item.part,item.treatment]),[[1,1,"keep"],[2,1,"keep"],[2,2,"source"],[2,3,"rebuild"]]);
  assert.equal(notesLib.decisionsSummary(decisions),"images: 2 kept, 1 from its source, 1 rebuilt");
  assert.equal(notesLib.decisionsSummary([]),"");
  assert.equal(notesLib.decisionLine(decisions[1]),"Slide 2 · screenshot · kept: OpenAI's own pricing page");
  const handedIn=schemas.HANDED_IN.source.safeParse({
    post:{author:{handle:"a",name:"A"},format:"carousel",date:null,caption:"",url:null,traction:{likes:null,comments:null,views:null}},
    originalLanguage:"en",shows:"",claims:"",mismatch:"",
    template:{cover:{layout:"",headline:{text:"",casing:"upper",lines:[],weight:"",highlighted:[]},subject:{kind:"none",what:"",position:"",size:""},background:"",insets:[]},branding:[],slides:[],avoid:[]},
    slides:notes.slides.slice(0,1),notes:[],
  });
  assert.ok(handedIn.success,"a part without a decision is accepted");
  assert.equal(notesLib.withDecisions(handedIn.data).slides[0].parts[0].treatment,"keep");
});

// ── 2. Finding the source ───────────────────────────────────────────────────
test("the original replaces the cut only when it is the same picture, its shape, and sharper", async () => {
  const cut=await meta(await page(400,300));
  const same=await meta(await page(1600,1200)), smaller=await meta(await page(360,270));
  const other=await meta(await page(1600,1200,{hue:200,seed:1})), wide=await meta(await page(1600,600));
  assert.ok(await originals.likeness(cut.bytes,same.bytes)>originals.MIN_LIKENESS);
  assert.ok(await originals.likeness(cut.bytes,other.bytes)<originals.MIN_LIKENESS);
  // Another page of the same layout and colours isn't it; the post's cut with a sticker on it, or cropped a little, still is.
  assert.ok(await originals.likeness(cut.bytes,await page(1600,1200,{seed:1}))<originals.MIN_LIKENESS);
  const sticker=await sharp(cut.bytes).composite([{input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="red"/></svg>'),left:250,top:220}]).png().toBuffer();
  assert.ok(await originals.likeness(sticker,same.bytes)>originals.MIN_LIKENESS);
  const cropped=await sharp(same.bytes).extract({left:24,top:18,width:1552,height:1164}).png().toBuffer();
  assert.ok(await originals.likeness(cut.bytes,cropped)>originals.MIN_LIKENESS);
  const candidate=(picture,url)=>({...picture,url,page:"https://openai.com/index/x"});
  const found=await originals.pickOriginal(cut,[candidate(other,"other"),candidate(wide,"wide"),candidate(same,"same")]);
  assert.equal(found.match?.candidate.url,"same");
  assert.equal(found.match.gain,16);
  assert.match((await originals.pickOriginal(cut,[candidate(other,"other")])).why,/none of the images on its pages is the picture/);
  // A wider original the post cropped to its slide is matched by its middle, and that part is what's used.
  const framed=await originals.pickOriginal(cut,[candidate(await meta(await sharp(await page(1600,1200)).extend({left:400,right:400,background:"#f4f4f2"}).png().toBuffer()),"framed")]);
  assert.equal(framed.match?.candidate.cropped,true);
  assert.deepEqual([framed.match.candidate.width,framed.match.candidate.height],[1600,1200]);
  assert.match((await originals.pickOriginal(cut,[candidate(await meta(await page(300,100)),"tiny")])).why,/big enough/);
  assert.match((await originals.pickOriginal(cut,[candidate(smaller,"smaller")])).why,/no sharper/);
  assert.match((await originals.pickOriginal(cut,[])).why,/no images/);
  assert.equal(originals.pageLink("openai.com/index/gpt-6"),"https://openai.com/index/gpt-6");
  assert.equal(originals.pageLink("https://www.apple.com/iphone/."),"https://www.apple.com/iphone/");
  assert.equal(originals.pageLink("OpenAI's site"),null);
  assert.equal(originals.pageLink("javascript:alert(1)"),null);
});

/** An original slide 1080 × 1350 with a screenshot of `picture` at a box, on a dark plain background. */
async function slideWith(picture,box) {
  const grid=value=>Math.round(value/1000);
  const left=grid(box.x*1080),top=grid(box.y*1350),width=grid(box.width*1080),height=grid(box.height*1350);
  const inner=await sharp(picture).resize(width,height,{fit:"fill"}).png().toBuffer();
  const png=await sharp({create:{width:1080,height:1350,channels:3,background:"#101010"}}).composite([{input:inner,left,top}]).png().toBuffer();
  return {mediaType:"image/png",base64:png.toString("base64")};
}
const owner=(()=>{let count=0;return ()=>`owner-kept-${++count}`;})();
const sessionWith=(slides,fetch)=>tools.designSession({ownerKey:owner(),mode:"exact",profile:english,template,templates:model.BUILT_IN_TEMPLATES,tokens:{},slides,chartData:new Map(),signal:new AbortController().signal,deckId:"recreate-kept-test",fetch});

test("kept pictures are cut from the post; a sourced one is swapped for its original when one matches, else the cut stays with the reason", async () => {
  const box={x:80,y:300,width:840,height:504};
  const slide=await slideWith(await page(400,300),box), big=await page(2000,1500), other=await page(2000,1500,{hue:200,seed:1});
  const decisions=[
    {slide:1,part:1,kind:"screenshot",what:"OpenAI's announcement",box,treatment:"source",why:"Soft, with the post's sticker on it",origin:"openai.com/index/x"},
    {slide:2,part:1,kind:"screenshot",what:"The pricing page",box,treatment:"source",why:"Official pricing page",origin:null},
    {slide:3,part:1,kind:"screenshot",what:"The app's screen",box,treatment:"keep",why:"The app's own screen",origin:null},
    {slide:3,part:2,kind:"chart",what:"A chart",box,treatment:"rebuild",why:"A chart",origin:null},
    {slide:3,part:3,kind:"photo",what:"A person",box,treatment:"keep",why:"A real photo",origin:null},
  ];
  const asked=[];
  const finder={pages:async pages=>{asked.push(pages);return pages.some(url=>url.includes("openai.com/index/x"))?[
    {url:"https://cdn.example.com/other.png",sourceUrl:"https://openai.com/index/x"},{url:"https://cdn.example.com/hero.png",sourceUrl:"https://openai.com/index/x"},
  ]:[{url:"https://cdn.example.com/other.png",sourceUrl:"https://openai.com/pricing"}];}};
  const fetch=async url=>new Response(String(url).includes("hero")?big:other,{status:200,headers:{"content-type":"image/png"}});
  const session=sessionWith([slide,slide,slide],fetch);
  const ready=await tools.prepareKept(session,decisions,{originals:[{slide:2,part:1,page:"https://openai.com/pricing"}],originUrl:null,finder});
  assert.deepEqual(ready.map(item=>[item.slide,item.part,item.treatment,item.from]),[[1,1,"source","source"],[2,1,"source","post"],[3,1,"keep","post"]],"the chart and the kept photo are left to the designer");
  assert.deepEqual(asked.map(pages=>pages.join()).sort(),["https://openai.com/index/x","https://openai.com/pricing"],"each looks on its own page: the research's, or the one the screenshot names");
  assert.equal(ready[0].width,2000);
  assert.equal(ready[0].page,"https://openai.com/index/x");
  assert.match(ready[0].note,/^Slide 1: found the original on openai\.com \(2000×1500; the post's cut was \d+×\d+\) and kept it whole/);
  assert.match(ready[1].note,/^Slide 2: the original wasn't found \(none of the images on its pages is the picture the screenshot shows\), so the screenshot is cut from the post and kept whole/);
  assert.match(ready[2].note,/^Slide 3: kept the screenshot as it is: The app's own screen$/);
  assert.ok(Math.abs(ready[2].width/ready[2].height-840*1080/(504*1350))<.02,"the cut keeps the screenshot's own shape");
  for(const item of ready)assert.ok(session.kept.has(item.src)&&session.assets.has(item.src));
  // The deck's notes: one line per decision.
  const notes=designStage.decisionNotes(decisions,ready);
  assert.equal(notes.length,5);
  assert.match(notes[3],/^Slide 3: rebuilt the chart in our style/);
  assert.match(notes[4],/^Slide 3: kept the photo, cut from the post/);
  assert.match(designStage.keptPrompt(ready),/^KEPT PICTURES[\s\S]*Original slide 1, part 1 \(screenshot, source: the original from https:\/\/openai\.com\/index\/x\): src \/api\/template-editor\/assets\//);
});

test("a kept cut's snapped edges never grow into another part, such as the post's sticker beside it", () => {
  const first={x:46,y:311,width:907,height:381}, snapped={x:46,y:290,width:907,height:405}, sticker={x:685,y:289,width:231,height:67};
  assert.deepEqual(tools.keepClear(first,snapped,[sticker]),{x:46,y:311,width:907,height:384},"the top stays; the bottom, clear of the sticker, keeps its snap");
  assert.deepEqual(tools.keepClear(first,snapped,[]),snapped);
});

// ── 3. Placing it ───────────────────────────────────────────────────────────
const deckWith=elements=>({format:"portrait",customSize:{width:1080,height:1440},pages:[{id:"p1",canvas:{elements}}]});
const frame=(src,extra={})=>({id:"photo",type:"image",slot:"photo",templateRole:"media",src,x:0,y:150,width:360,height:280,fit:"cover",cropX:30,cropY:80,cropScale:1.4,radius:8,rotation:0,opacity:1,...extra});
const margins={left:24,right:24,top:30,bottom:30};

test("a kept picture sits whole on the margins at its own shape; a tall one is height-limited and centred; others are left alone", () => {
  const wide=frame("/kept/wide.png"), tall=frame("/kept/tall.png",{id:"tall",y:100,height:200}), photo=frame("/photo.jpg",{id:"photo2"});
  const document=deckWith([wide,tall,photo]);
  const sizes=new Map([["/kept/wide.png",{width:1600,height:900}],["/kept/tall.png",{width:900,height:1600}]]);
  assert.deepEqual(kept.placeKept(document,sizes,margins),[1]);
  assert.equal(wide.x,24);
  assert.equal(wide.width,312);
  assert.ok(Math.abs(wide.height-312*900/1600)<1e-9);
  assert.ok(Math.abs(wide.y-(150+(280-wide.height)/2))<1e-9,"centred in the frame's room");
  assert.deepEqual([wide.fit,wide.cropX,wide.cropY,wide.cropScale,wide.intrinsicWidth],["contain",50,50,1,1600]);
  assert.ok(Math.abs(tall.height-200)<1e-9);
  assert.ok(Math.abs(tall.width-200*900/1600)<1e-9);
  assert.ok(Math.abs(tall.x+tall.width/2-180)<1e-9,"centred between the margins");
  assert.deepEqual([photo.fit,photo.cropScale,photo.x],["cover",1.4,0],"a photo the designer placed stays as it was");
  assert.deepEqual(kept.keptChecks(document,sizes,margins),[]);
});

test("Engine's check: a kept picture cropped or stretched is must-fix, one past the margins should-fix", () => {
  const sizes=new Map([["/kept/a.png",{width:1600,height:900}]]);
  const issues=document=>kept.keptChecks(document,sizes,margins).map(issue=>[issue.severity,issue.problem]);
  assert.deepEqual(issues(deckWith([frame("/kept/a.png",{x:24,width:312,height:175.5,y:150,cropScale:1})])),[],"filling a frame of its own shape crops nothing");
  assert.deepEqual(issues(deckWith([frame("/kept/a.png",{x:24,width:312,height:280,y:150,cropScale:1})])),[["must_fix","A kept picture (an official screenshot) is cropped by its frame"]]);
  assert.deepEqual(issues(deckWith([frame("/kept/a.png",{x:24,width:312,height:175.5,y:150,fit:"contain",cropScale:1.3,intrinsicWidth:1600,intrinsicHeight:900})])),[["must_fix","A kept picture (an official screenshot) is cropped by its frame"]]);
  assert.deepEqual(issues(deckWith([frame("/kept/a.png",{x:24,width:312,height:175.5,fit:"contain",cropScale:1,intrinsicWidth:900,intrinsicHeight:900})])),[["must_fix","A kept picture is drawn out of its own shape"]]);
  assert.deepEqual(issues(deckWith([frame("/kept/a.png",{x:0,width:360,height:202.5,fit:"contain",cropScale:1,intrinsicWidth:1600,intrinsicHeight:900})])),[["should_fix","A kept picture runs past the page's margins"]]);
  assert.deepEqual(issues(deckWith([frame("/kept/a.png",{hidden:true})])),[],"a hidden picture isn't checked");
});

test("the page's margins come from the guide, else the brand's variables, in canvas units", () => {
  assert.deepEqual(kept.pageMargins({layout:{width:1080,marginLeft:72,marginRight:108,marginTop:90,marginBottom:88}}),{left:24,right:36,top:30,bottom:88/3});
  assert.deepEqual(kept.pageMargins(null,{"--page-width":"1080px","--margin-left":"54px","--margin-right":"54px","--margin-top":"60px","--margin-bottom":"60px"}),{left:18,right:18,top:20,bottom:20});
});

// ── 4. The team's cards ─────────────────────────────────────────────────────
test("the cards: the reader decides each image, the designer keeps it whole, and the critics don't call a kept picture pasted", () => {
  const book=playbookLib.playbook();
  const text=JSON.stringify(book);
  assert.match(text,/rebuild: posts and comments from any platform/);
  assert.match(text,/keep: a company's or product's own official screen/);
  assert.match(text,/source: the same kinds as keep/);
  assert.match(reviewCards.KEPT_PICTURE_RULE,/A picture shown whole where its decision is keep or source is right, not pasted/);
  assert.match(reviewCards.KEPT_PICTURE_RULE,/marked rebuild|decision is rebuild, shown as one picture cut from the original, is still must_fix/);
  assert.ok(reviewCards.FIDELITY_CRITIC_RULES.some(rule=>/^Everything else marked rebuild is rebuilt/.test(rule)));
});
