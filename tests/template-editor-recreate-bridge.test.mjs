/* Run: node --test tests/template-editor-recreate-bridge.test.mjs
 * The early test path (lib/engine/agents/stages/bridge.ts): Engine's own stages
 * run an exact copy end to end, step A's source reader first, then the first
 * team's copier, chart rebuilder, exact deck and fidelity critic. Uploaded
 * slides go in, the check proceeds unchecked, the deck is built and reviewed,
 * and a must-fix goes back once: to the copier for words, to the chart
 * rebuilder for a chart. A full recreation stops at research. Claude and
 * Chromium are stand-ins; the deck is built and saved for real. Local
 * development storage only. Each build step's merge retires part of this file
 * with the bridge. */
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
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-bridge-test-"));
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

const orchestrator=load("lib/engine/agents/orchestrator.ts");
const posts=load("lib/engine/post-files.ts");
const jobs=load("lib/engine/recreate-jobs.ts");
const claude=load("lib/engine/agents/claude.ts");
const deckLib=load("lib/engine/agents/deck.ts");
const render=load("lib/engine/slide-render.ts");
const pagesLib=load("lib/engine/agents/pages.ts");
const model=load("lib/template-editor/model.ts");
const profiles=load("lib/engine/page-profiles.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const catalog=pagesLib.templatePages(template);
const pageIndex=label=>catalog.find(page=>page.label===label).index;
const COVER=pageIndex("Cover"),MEDIA=pageIndex("Text + Media");
const options={environment:async()=>({profile:english,template,templates:model.BUILT_IN_TEMPLATES})};
let owners=0;
const owner=()=>`owner-bridge-${++owners}`;

// A slide like an Instagram one: a dark background with a busy picture in a known box (on the 0-1000 grid).
const PICTURE={x:100,y:300,width:800,height:500};
async function upload(name) {
  const width=1080,height=1350,data=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=(y*width+x)*3,inside=x>=108&&x<972&&y>=405&&y<1080,noise=((x*73856093)^(y*19349663))>>>0;
    data[at]=inside?60+noise%160:16;data[at+1]=inside?60+(noise>>>8)%160:20;data[at+2]=inside?60+(noise>>>16)%160:24;
  }
  const png=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();
  return {name,dataUrl:`data:image/png;base64,${png.toString("base64")}`};
}
const transcriptOf=(second="photo")=>({
  name:"AI vs Jobs",originalLanguage:"en",translated:false,
  slides:[
    {original:1,templatePage:COVER,texts:[{slot:"cover-headline",text:"since ChatGPT came out, [[stocks]] nearly doubled"}],media:{kind:"photo",box:PICTURE,alt:"A trader at a screen"},graphic:null,posts:[]},
    {original:2,templatePage:MEDIA,texts:[{slot:"title",text:"Stocks vs job openings"},{slot:"body",text:"The S&P 500 is up 96% while US job openings fell 29%"},{slot:"source",text:"Source: FRED"}],media:{kind:second,box:PICTURE,alt:"Two lines: stocks up, openings down"},graphic:null,posts:[]},
  ],
  caption:"Stocks up, jobs down.\n\nSource: BLS",notes:[],
});
const words=call=>call.content.filter(block=>block.type==="text").map(block=>block.text).join("\n");
/** What the source reader (step A) hands in for `count` slides; its clean-up fills in the post's details. */
const notesFor=count=>({
  post:{author:{handle:"",name:""},format:count>1?"carousel":"photo",date:null,caption:"",url:null,traction:{likes:null,comments:null,views:null}},
  originalLanguage:"en",shows:"A trader at a screen",claims:"Stocks nearly doubled since ChatGPT came out",mismatch:"",
  template:{
    cover:{layout:"Picture above, headline below",headline:{text:"SINCE CHATGPT CAME OUT, STOCKS NEARLY DOUBLED",casing:"upper",lines:["SINCE CHATGPT CAME OUT,","STOCKS NEARLY DOUBLED"],weight:"black",highlighted:["DOUBLED"]},subject:{kind:"photo",what:"A trader",position:"top",size:"half"},background:"dark",insets:[]},
    branding:[],slides:Array.from({length:count},(_,index)=>({index:index+1,role:index?"chart":"cover",layout:"Picture, then words"})),avoid:[],
  },
  slides:Array.from({length:count},(_,index)=>({index:index+1,role:index?"chart":"cover",texts:[{role:"headline",text:index?"Stocks vs job openings":"SINCE CHATGPT CAME OUT, STOCKS NEARLY DOUBLED"}],parts:[]})),
  notes:[],
});

/** Claude, Chromium and the deck save watched: the copier and the critic answer from `answers`, every slide renders dark. */
async function stand(answers,run) {
  const real={ask:claude.ask,work:claude.work,renderSlides:render.renderSlides,saveBuiltDeck:deckLib.saveBuiltDeck},calls=[],saves=[];
  const png=await sharp({create:{width:1080,height:1440,channels:3,background:"#0B1014"}}).png().toBuffer();
  render.renderSlides=async document=>document.pages.map(page=>({pageId:page.id,png}));
  claude.ask=async call=>{
    calls.push(call);
    const answer=answers[call.role];
    assert.ok(answer,`nobody answers ${call.role} in this test`);
    return answer(calls.filter(item=>item.role===call.role).length,call);
  };
  claude.work=async call=>{
    calls.push(call);
    const answer=answers[call.role];
    assert.ok(answer,`nobody answers ${call.role} in this test`);
    return answer(calls.filter(item=>item.role===call.role).length,call);
  };
  deckLib.saveBuiltDeck=async(ownerKey,assembled,previous)=>{
    const result=await real.saveBuiltDeck(ownerKey,assembled,previous);
    saves.push({previous:previous?.deckId,saved:result.output.deckId});
    return result;
  };
  try { return await run({calls,saves,of:role=>calls.filter(call=>call.role===role)}); } finally { Object.assign(claude,{ask:real.ask,work:real.work}); render.renderSlides=real.renderSlides; deckLib.saveBuiltDeck=real.saveBuiltDeck; }
}

test("an exact copy runs end to end on the early test path, and the critic's word fix goes back to the copier once",async()=>{
  await stand({
    source:()=>notesFor(2),
    transcript:()=>transcriptOf(),
    designCritic:count=>count===1
      ?{verdict:"fix",summary:"A word is wrong",issues:[{slide:2,problem:"The body says 96%; the original says 97%",fix:"Write 97%",severity:"must_fix",route:"copy"}]}
      :{verdict:"ship",summary:"Faithful",issues:[]},
  },async({saves,of})=>{
    const ownerKey=owner();
    const {file,done}=await orchestrator.startRecreate(ownerKey,{profileId:"chatgptricks",mode:"exact",caption:"Stocks up, jobs down.",uploads:[await upload("1.png"),await upload("2.png")]},options);
    await done;
    const finished=await posts.getPostFile(ownerKey,file.id);
    assert.equal(finished.status,"done",finished.message);
    assert.deepEqual(Object.keys(finished.stages).sort(),["design","research","review","source","verdict"],"only the new stages are on the file");

    // Source: step A's reader keeps the uploads as workspace images and reads them once; the copier reuses them.
    assert.equal(finished.source.imageIds.length,2);
    assert.equal(of("source").length,1);
    assert.equal(finished.stages.source.output.slides.length,2);
    assert.equal(finished.stages.source.output.post.caption,"Stocks up, jobs down.","the post's own caption wins over the reading");
    // Research: a quick check that looked nothing up, and says so; the gate proceeds.
    const check=finished.stages.research.output;
    assert.equal(check.quick,true);
    assert.equal(check.origin.found,false);
    assert.match(check.recommendation.reason,/Nothing checked yet/);
    assert.equal(finished.stages.verdict.output.outcome,"proceed");

    // Design: the copier read both slides, the deck was built, and the fix round saved over the same deck.
    const copier=of("transcript");
    assert.equal(copier.length,2,"the copier ran again for the critic's word fix");
    assert.doesNotMatch(words(copier[0]),/FIX THIS/);
    assert.match(words(copier[1]),/YOUR PREVIOUS RESULT/);
    assert.match(words(copier[1]),/The body says 96%; the original says 97%\. Fix: Write 97%/);
    assert.equal(of("data").length,0,"no chart, so the chart rebuilder never asks Claude");
    assert.deepEqual(saves.map(save=>save.previous),[undefined,saves[0].saved],"round 1 saves over round 0's deck");
    assert.equal(saves[1].saved,saves[0].saved);
    const built=finished.stages.design.output;
    assert.equal(finished.deckId,built.deckId);
    assert.equal(finished.stages.design.round,1);
    assert.equal(built.slideCount,2);
    assert.deepEqual(built.pages.map(page=>[page.slide,page.layout]),[[1,"Cover"],[2,"Text + Media"]]);
    assert.equal(built.caption,"Stocks up, jobs down.\n\nSource: BLS");
    assert.equal(built.bridge.data.status,"skipped");
    const deck=await deckLib.loadDeck(ownerKey,built.deckId);
    assert.equal(deck.pages.length,2);

    // Review: the first team's routes become design; round 1 ships, so nothing goes back again.
    assert.equal(of("designCritic").length,2);
    const report=finished.stages.review.output;
    assert.equal(report.round,1);
    assert.deepEqual(report.sentBack,[]);
    assert.equal(report.design.verdict,"ship");
    assert.ok([...report.checks,...report.design.issues].every(issue=>["design","none"].includes(issue.route)));
    assert.deepEqual(report.bridge.legacy.sentBack,[]);
    const history=finished.history.filter(entry=>entry.stage==="design").map(entry=>entry.event);
    assert.ok(history.includes("sent back by the critics (round 1)"));

    // The run card says the origin wasn't checked rather than that none was found.
    const view=jobs.postView(finished,false);
    assert.deepEqual(view.stages.map(stage=>stage.stage),["source","research","verdict","design","review"]);
    assert.equal(view.stages.find(stage=>stage.stage==="source").summary,"Read 2 slides");
    assert.equal(view.stages.find(stage=>stage.stage==="research").summary,"Origin not checked yet");
    assert.match(view.stages.find(stage=>stage.stage==="verdict").summary,/^Passed: Nothing checked yet/);
    assert.equal(view.stages.find(stage=>stage.stage==="design").summary,"2 slides designed");
  });
});

test("a chart fix goes back to the chart rebuilder alone: the copy stands",async()=>{
  await stand({
    source:()=>notesFor(2),
    transcript:()=>transcriptOf("chart"),
    data:()=>({charts:[],missing:[{slide:2,why:"no real series in this test"}],notes:[]}),
    designCritic:count=>count===1
      ?{verdict:"fix",summary:"The chart is cut",issues:[{slide:2,problem:"The chart is a cut picture",fix:"Redraw it from FRED's series",severity:"must_fix",route:"data"}]}
      :{verdict:"ship",summary:"Faithful",issues:[]},
  },async({of})=>{
    const ownerKey=owner();
    const {file,done}=await orchestrator.startRecreate(ownerKey,{profileId:"chatgptricks",mode:"exact",uploads:[await upload("1.png"),await upload("2.png")]},options);
    await done;
    const finished=await posts.getPostFile(ownerKey,file.id);
    assert.equal(finished.status,"done",finished.message);
    assert.equal(of("transcript").length,1,"the copy stands");
    const rebuilder=of("data");
    assert.equal(rebuilder.length,2);
    assert.doesNotMatch(words(rebuilder[0]),/FIX THIS/);
    assert.match(words(rebuilder[1]),/The chart is a cut picture\. Fix: Redraw it from FRED's series/);
    assert.match(words(rebuilder[1]),/Rebuild each chart these name again from its real numbers/);
    assert.equal(finished.stages.design.output.bridge.data.status,"done");
    assert.ok(finished.stages.design.output.notes.some(note=>/Slide 2: the chart stays cut from the original: no real series in this test/.test(note)));
  });
});

test("a full recreation reads the post, then stops at research until step B lands",async()=>{
  await stand({source:()=>notesFor(1)},async({calls})=>{
    const ownerKey=owner();
    const {file,done}=await orchestrator.startRecreate(ownerKey,{profileId:"chatgptricks",mode:"autopilot",uploads:[await upload("1.png")]},options);
    await done;
    const finished=await posts.getPostFile(ownerKey,file.id);
    assert.equal(finished.status,"error");
    assert.equal(finished.stages.source.status,"done");
    assert.equal(finished.stages.research.status,"error");
    assert.match(finished.stages.research.error,/isn't built yet \(build step B\)/);
    assert.deepEqual(calls.map(call=>call.role),["source"],"only the source reader asks Claude");
  });
});
