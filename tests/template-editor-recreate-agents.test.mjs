/* Run: node --test tests/template-editor-recreate-agents.test.mjs
 * The Recreate agent team: the orchestrator's stage order, parallel research,
 * the checkpoint pause and approval, autopilot, the critics' fix rounds (at
 * most two), reruns, hand-ins, failures and resume; plus the pieces code owns
 * (outline clean-up, distinct hooks, the headline pick, the designer, house
 * checks and the playbook). Claude, X and the headline model are never called:
 * every stage here is a stand-in. Local development storage only. */
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

const orchestrator=load("lib/engine/agents/orchestrator.ts");
const posts=load("lib/engine/post-files.ts");
const jobs=load("lib/engine/recreate-jobs.ts");
const story=load("lib/engine/agents/story.ts");
const deckLib=load("lib/engine/agents/deck.ts");
const review=load("lib/engine/agents/review.ts");
const pagesLib=load("lib/engine/agents/pages.ts");
const playbookLib=load("lib/engine/agents/playbook.ts");
const claude=load("lib/engine/agents/claude.ts");
const model=load("lib/template-editor/model.ts");
const profiles=load("lib/engine/page-profiles.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const spanish=profiles.builtInPageProfiles().find(item=>item.id==="pagina-es");
const catalog=pagesLib.templatePages(template);
const pageIndex=label=>catalog.find(page=>page.label===label).index;
const COVER=pageIndex("Cover"),MEDIA=pageIndex("Text + Media"),FOLLOW=pageIndex("Follow"),REACTION=pageIndex("Reaction"),REACTIONS=pageIndex("Two reactions"),THREE=pageIndex("Three reactions");
const env=profile=>async()=>({profile,template,templates:model.BUILT_IN_TEMPLATES});
let owners=0;
const owner=()=>`owner-agents-${++owners}`;

const post=(id,handle,text,likes)=>({id,url:`https://x.com/${handle}/status/${id}`,author:{name:handle.toUpperCase(),handle,avatarUrl:null,verified:false},text,createdAt:"2026-11-03T12:00:00.000Z",likes,reposts:10,replies:5,views:1000,why:"Clear take"});
const chart={unit:"index",labels:[],series:[{name:"S&P 500",source:"fred",fred:"SP500",values:[],emphasis:false}],from:"2016-01-01",markerDate:"2022-11-30",indexToMarker:true,markerIndex:-1,markerLabel:"ChatGPT",markerIcon:"openai",endLabel:"change_since_marker",markers:[],band:null};
const OUTPUTS={
  brief:{topic:"AI and jobs",story:"Stocks rose while US job openings fell after ChatGPT came out.",originalHeadline:"STOCKS UP, JOBS DOWN",angle:"Your job search got harder",
    slides:[{index:1,role:"cover",says:"STOCKS UP, JOBS DOWN",shows:"Photo",keep:"The claim"},{index:2,role:"chart",says:"Chart",shows:"Two lines",keep:"The chart"}],
    chart:null,claims:["Job openings fell 29%"],questions:["Is AI the reason?"],reactionSearch:{terms:["chatgpt jobs"],since:"2026-10-01"},photos:[],risks:[]},
  facts:{claims:[{claim:"Job openings fell 29%",verdict:"confirmed",detail:"JOLTS, seasonally adjusted",sources:[{title:"BLS JOLTS",url:"https://www.bls.gov/jlt/"}]}],answers:[{question:"Is AI the reason?",answer:"Not alone: rates rose too",sources:[]}],context:[],risks:[]},
  data:{charts:[{id:"main",purpose:"Stocks vs job openings",recreates:"Slide 2",chart,source:"Source: FRED SP500, 2016 to 2026"}],notes:[]},
  reactions:{reactions:[post("101","alice","AI didn't take the jobs, rates did",5000),post("102","bob","Openings are back to 2019 levels",3000)],note:""},
  visuals:{candidates:[],note:"No usable photos turned up on X."},
  outline:{slides:[
    {kind:"cover",templatePage:COVER,purpose:"Hook",points:[],chartId:null,reactionIds:[],photo:"ChatGPT on a phone"},
    {kind:"original",templatePage:MEDIA,purpose:"The chart",points:["Openings fell 29%"],chartId:"main",reactionIds:[],photo:""},
    {kind:"reaction",templatePage:REACTIONS,purpose:"How X reacted",points:[],chartId:null,reactionIds:["101","102"],photo:""},
    {kind:"follow",templatePage:FOLLOW,purpose:"Follow",points:[],chartId:null,reactionIds:[],photo:""},
  ],why:"The original, then reactions"},
  hooks:{options:[
    {text:"STOCKS UP, JOBS DOWN",framework:"story",by:"headline-model",english:null},
    {text:"AI DIDN'T TAKE YOUR JOB YET",framework:"stakes",by:"copywriter",english:null},
  ],source:"headline-model",story:"Stocks rose while US job openings fell after ChatGPT.",modelOptions:[{text:"STOCKS UP, JOBS DOWN",framework:"story",sources:["model-v3"]}],note:""},
  copy:{name:"AI vs Jobs",slides:[
    {templatePage:COVER,texts:[{slot:"cover-headline",text:"STOCKS UP, [[JOBS DOWN]]"}]},
    {templatePage:MEDIA,texts:[{slot:"title",text:"AI vs Jobs"},{slot:"body",text:"Stocks went up and job openings went down"},{slot:"source",text:"Source: FRED"}]},
    {templatePage:REACTIONS,texts:[{slot:"title",text:"How X reacted"},{slot:"source",text:"Source: X, Nov 2026"}]},
    {templatePage:FOLLOW,texts:[{slot:"cta",text:"FOR AI JOB NEWS"}]},
  ],caption:"Stocks up, jobs down.\n\nSource: BLS",notes:[]},
  charts:{charts:[{id:"main",ok:true,error:"",points:120,from:"2016-01",to:"2026-09"}]},
  images:{photos:[],notes:[]},
  deck:{deckId:"recreate-test-deck",name:"AI vs Jobs",slideCount:4,savedAt:"2026-11-07T00:00:00.000Z",notes:[],pages:[],held:""},
  review:{round:0,rendered:false,checks:[],facts:null,design:null,sentBack:[]},
};
const SKIPPED=new Set(["visuals","images"]);

/** Stand-in stages: each records its call, checks its inputs finished first, and returns the canned output. */
function team(custom={}) {
  const calls=[];
  const runners={};
  for(const stage of posts.POST_STAGES) {
    if(stage==="approval"&&!custom.approval)continue; // autopilot uses Engine's own auto-approval
    runners[stage]=async context=>{
      for(const input of posts.STAGE_INPUTS[stage])assert.ok(["done","skipped"].includes(context.file.stages[input]?.status),`${stage} started before ${input} finished`);
      calls.push({stage,round:context.round,instructions:context.instructions,previous:context.previous});
      await new Promise(resolve=>setTimeout(resolve,2));
      if(custom[stage])return custom[stage](context,calls.filter(call=>call.stage===stage).length);
      return SKIPPED.has(stage)?{status:"skipped",output:structuredClone(OUTPUTS[stage])}:{output:structuredClone(OUTPUTS[stage])};
    };
  }
  return {calls,runners,count:stage=>calls.filter(call=>call.stage===stage).length};
}
const start=(ownerKey,crew,mode,extra={})=>orchestrator.startRecreate(ownerKey,{profileId:"chatgptricks",url:"https://www.instagram.com/p/abc/",mode},{runners:crew.runners,environment:env(english),...extra});
const read=(ownerKey,id)=>posts.getPostFile(ownerKey,id);

test("a checkpoint run researches in parallel, then pauses for a person",async()=>{
  let started=0,release;const together=new Promise(resolve=>{release=resolve;});
  const research=async()=>{started+=1;if(started===3)release(true);return Promise.race([together,new Promise(resolve=>setTimeout(()=>resolve(false),2000))]);};
  const parallel=[];
  const crew=team(Object.fromEntries(["facts","data","reactions"].map(stage=>[stage,async()=>{parallel.push(await research());return {output:OUTPUTS[stage]};}])));
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"checkpoint");
  await done;
  assert.deepEqual(parallel,[true,true,true],"facts, data and reactions were all being researched at once");
  const order=crew.calls.map(call=>call.stage);
  assert.ok(order.indexOf("visuals")>order.indexOf("facts"),"the photo search reads the facts' sources, so it starts after them");
  const paused=await read(ownerKey,file.id);
  assert.equal(paused.status,"paused");
  assert.equal(paused.stages.approval,undefined,"nobody approved it");
  assert.equal(crew.count("copy"),0,"nothing is written before the approval");
  assert.equal(crew.calls[0].stage,"brief","the editor-in-chief goes first");
  const view=jobs.postView(paused,false);
  assert.equal(view.status,"paused");
  assert.equal(view.checkpoint.outline.slides.length,4);
  assert.equal(view.checkpoint.hooks.options[0].text,"STOCKS UP, JOBS DOWN");
  assert.equal(view.checkpoint.reactions[0].url,"https://x.com/alice/status/101","reactions keep their links");
  assert.equal(view.jobId,file.id.slice(5));
  assert.equal(view.stages.find(stage=>stage.stage==="visuals").status,"skipped");
});

test("a person's approval with their own hook finishes the post, and their pick goes to the headline model",async()=>{
  const crew=team(),ownerKey=owner(),picks=[];
  const savePick=async input=>{picks.push(input);return {id:"pick-1"};};
  const first=await start(ownerKey,crew,"checkpoint",{savePick});
  await first.done;
  await assert.rejects(orchestrator.approveRecreate(ownerKey,first.file.id,{option:9},"human",{runners:crew.runners,environment:env(english),savePick}),/Pick one of the hook options/);
  const approved=await orchestrator.approveRecreate(ownerKey,first.file.id,{text:"WALL STREET WON, WORKERS WAIT"},"human",{runners:crew.runners,environment:env(english),savePick});
  await approved.done;
  const done=await read(ownerKey,first.file.id);
  assert.equal(done.status,"done");
  assert.equal(done.deckId,"recreate-test-deck");
  assert.deepEqual(done.stages.approval.output.hook,{text:"WALL STREET WON, WORKERS WAIT",option:-1});
  assert.equal(done.stages.approval.by,"human");
  assert.equal(picks.length,1,"one pick, for one human choice");
  const pick=picks[0];
  assert.deepEqual(pick.options.map(option=>option.sources),[["model-v3"],["engine-copywriter"],["human"]],"the copywriter's and the person's lines are tagged as theirs");
  assert.equal(pick.chosen,2);
  assert.equal(pick.finalText,"WALL STREET WON, WORKERS WAIT");
  assert.equal(pick.originalHeadline,"STOCKS UP, JOBS DOWN");
  assert.equal(pick.account,"chatgptricks");
  assert.ok(done.history.some(entry=>/Sent the hook pick to the headline model \(pick-1\)/.test(entry.event)));
  await assert.rejects(orchestrator.approveRecreate(ownerKey,first.file.id,{option:0},"human",{runners:crew.runners,environment:env(english),savePick}),/already approved/);
  const view=jobs.postView(done,false);
  assert.equal(view.status,"done");
  assert.equal(view.result.deckId,"recreate-test-deck");
  assert.match(view.result.editorUrl,/design=recreate-test-deck/);
  assert.equal(view.result.factChecks[0].verdict,"confirmed");
});

test("autopilot takes the plan and the first hook, and never sends a pick",async()=>{
  const crew=team(),ownerKey=owner(),picks=[];
  const {file,done}=await start(ownerKey,crew,"autopilot",{savePick:async input=>{picks.push(input);return {id:"x"};}});
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(finished.stages.approval.by,"engine");
  assert.deepEqual(finished.stages.approval.output.hook,{text:"STOCKS UP, JOBS DOWN",option:0});
  assert.equal(picks.length,0,"autopilot choices never reach the headline model");
  const order=crew.calls.map(call=>call.stage);
  assert.ok(order.indexOf("outline")>order.indexOf("data")&&order.indexOf("copy")>order.indexOf("outline")&&order.indexOf("review")>order.indexOf("deck"));
});

test("the critics send work back at most twice, with what to fix and the earlier version",async()=>{
  const crew=team({
    review:async context=>({output:{round:context.round,rendered:true,checks:[{slide:2,problem:"The body runs to three lines",fix:"Cut it to one short sentence",severity:"must_fix",route:"copy"}],facts:null,design:null,
      sentBack:context.round<review.MAX_FIX_ROUNDS?["copy"]:[]}}),
  });
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(crew.count("copy"),1+review.MAX_FIX_ROUNDS,"the first draft plus two fix rounds");
  assert.equal(crew.count("review"),1+review.MAX_FIX_ROUNDS);
  assert.equal(crew.count("facts"),1,"research isn't redone for a copy fix");
  const fixes=crew.calls.filter(call=>call.stage==="copy").slice(1);
  assert.ok(fixes.every(call=>/The body runs to three lines/.test(call.instructions)&&call.previous?.name==="AI vs Jobs"));
  assert.deepEqual(crew.calls.filter(call=>call.stage==="review").map(call=>call.round),[0,1,2]);
  assert.equal(finished.stages.review.output.sentBack.length,0,"the last round sends nothing back");
});

test("a failed stage stops the post, and resume picks up from that stage",async()=>{
  const crew=team({data:async(context,count)=>{if(count===1)throw new claude.RecreateError("FRED is down. Try again.",502);return {output:OUTPUTS.data};}});
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const failed=await read(ownerKey,file.id);
  assert.equal(failed.status,"error");
  assert.equal(failed.message,"FRED is down. Try again.");
  assert.equal(failed.stages.data.status,"error");
  assert.equal(failed.stages.facts.status,"done","the stages that could finish did");
  const view=jobs.postView(failed,false);
  assert.equal(view.status,"error");
  assert.equal(view.resumable,true);
  const resumed=await orchestrator.resumeRecreate(ownerKey,file.id,{runners:crew.runners,environment:env(english)});
  await resumed.done;
  assert.equal((await read(ownerKey,file.id)).status,"done");
  assert.equal(crew.count("brief"),1,"finished stages aren't redone");
  assert.equal(crew.count("data"),2);
});

test("a run that stopped without finishing shows as stopped and can be resumed",async()=>{
  const ownerKey=owner();
  const file=await posts.createPostFile(ownerKey,{profileId:"chatgptricks",mode:"autopilot",source:{caption:"",notes:"",slideCount:0,imageIds:[]}});
  await posts.updatePostFile(ownerKey,file.id,next=>{posts.setStage(next,"brief",{status:"running",attempt:"gone"});});
  const view=jobs.postView(await read(ownerKey,file.id),false);
  assert.equal(view.status,"error");
  assert.equal(view.resumable,true);
  assert.match(view.message,/Resume it/);
  const crew=team(),resumed=await orchestrator.resumeRecreate(ownerKey,file.id,{runners:crew.runners,environment:env(english)});
  await resumed.done;
  assert.equal((await read(ownerKey,file.id)).status,"done");
});

test("an optional stage that fails is skipped and the post goes on",async()=>{
  const crew=team({reactions:async()=>{throw new claude.RecreateError("Apify is out of credit.",502);}});
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(finished.stages.reactions.status,"skipped");
  assert.equal(finished.stages.reactions.error,"Apify is out of credit.");
});

test("rerunning a stage reruns everything that read it, with the person's instructions",async()=>{
  const crew=team(),ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const again=await orchestrator.rerunRecreateStage(ownerKey,file.id,"copy","Make the cover shorter","human",{runners:crew.runners,environment:env(english)});
  await again.done;
  assert.equal((await read(ownerKey,file.id)).status,"done");
  assert.deepEqual(["copy","deck","review","facts","charts"].map(crew.count),[2,2,2,1,1]);
  const rerun=crew.calls.filter(call=>call.stage==="copy")[1];
  assert.equal(rerun.instructions,"Make the cover shorter");
  assert.equal(rerun.previous.name,"AI vs Jobs","the copywriter sees its earlier version");
});

test("a rerun on a stopped run also picks up what the stop left unfinished",async()=>{
  // Hooks stop once, the way a person's Stop leaves them; they don't read the reactions.
  const crew=team({hooks:async(context,count)=>{if(count===1)throw new claude.RecreateError("Stopped. Resume the run to continue.",409);return {output:structuredClone(OUTPUTS.hooks)};}});
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  assert.equal((await read(ownerKey,file.id)).stages.hooks.status,"error");
  const again=await orchestrator.rerunRecreateStage(ownerKey,file.id,"reactions",undefined,"human",{runners:crew.runners,environment:env(english)});
  await again.done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done","the rerun doesn't stop again at the hooks");
  assert.deepEqual(["reactions","hooks","brief","facts"].map(crew.count),[2,2,1,1]);
});

test("an agent can hand in a stage, checked against the stage's schema",async()=>{
  const crew=team(),ownerKey=owner(),{file,done}=await start(ownerKey,crew,"checkpoint");
  await done;
  const options={runners:crew.runners,environment:env(english)};
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"deck",{},"agent",options),/Engine builds the deck stage itself/);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"hooks",{options:"nope"},"agent",options),/doesn't match its schema: options/);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"copy",OUTPUTS.copy,"agent",options),/needs approval first/);
  const hooks={...OUTPUTS.hooks,options:[{text:"THE JOBS DATA AI CAN'T EXPLAIN",framework:"number",by:"agent",english:null}],source:"agent",modelOptions:[]};
  const handed=await orchestrator.submitRecreateStage(ownerKey,file.id,"hooks",hooks,"agent",options);
  await handed.done;
  const after=await read(ownerKey,file.id);
  assert.equal(after.stages.hooks.by,"agent");
  assert.equal(after.status,"paused","it still waits for the approval");
  assert.equal(crew.count("hooks"),1,"the handed-in hooks aren't rewritten");
});

test("the checkpoint accepts an edited outline and refuses one the template can't show",async()=>{
  const crew=team(),ownerKey=owner(),{file,done}=await start(ownerKey,crew,"checkpoint");
  await done;
  const options={runners:crew.runners,environment:env(english)};
  const bad={slides:[{...OUTPUTS.outline.slides[0],templatePage:42}],why:""};
  await assert.rejects(orchestrator.approveRecreate(ownerKey,file.id,{outline:bad,option:0},"human",options),/no slides this template can show/);
  const shorter={slides:[OUTPUTS.outline.slides[0],OUTPUTS.outline.slides[3]],why:"Cover and Follow only"};
  const approved=await orchestrator.approveRecreate(ownerKey,file.id,{outline:shorter,option:1,notes:"Keep it short"},"agent",options);
  await approved.done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.stages.approval.output.outline.slides.length,2);
  assert.equal(finished.stages.approval.output.notes,"Keep it short");
  assert.equal(finished.stages.approval.by,"agent");
});

test("readyStages waits on inputs, holds the checkpoint, and reruns a stage left running",()=>{
  const file={mode:"checkpoint",stages:{brief:{status:"done"},facts:{status:"running"},data:{status:"error"},reactions:{status:"done"},visuals:{status:"skipped"}}};
  assert.deepEqual(orchestrator.readyStages(file),["facts"],"facts was left running by a stopped run; the outline waits for the failed data stage");
  const later={mode:"checkpoint",stages:Object.fromEntries(["brief","facts","data","reactions","visuals","outline","hooks"].map(stage=>[stage,{status:"done"}]))};
  assert.deepEqual(orchestrator.readyStages(later),[],"the checkpoint waits for a person");
  assert.deepEqual(orchestrator.readyStages({...later,mode:"autopilot"}),["approval"]);
});

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

test("a Spanish page's pick sends only the headline model's own English lines",()=>{
  const file=(hook,by="human")=>({stages:{
    brief:{status:"done",output:OUTPUTS.brief},
    hooks:{status:"done",output:{...OUTPUTS.hooks,options:[
      {text:"BOLSA ARRIBA, EMPLEOS ABAJO",framework:"story",by:"headline-model",english:"STOCKS UP, JOBS DOWN"},
      {text:"LA IA AÚN NO TE QUITÓ EL EMPLEO",framework:"stakes",by:"copywriter",english:null},
    ]}},
    approval:{status:"done",by,output:{outline:OUTPUTS.outline,hook,notes:""}},
  }});
  const model=orchestrator.pickPayload(file({text:"BOLSA ARRIBA, EMPLEOS ABAJO",option:0}),spanish);
  assert.deepEqual(model.options.map(option=>option.text),["STOCKS UP, JOBS DOWN"],"no Spanish line reaches the model");
  assert.equal(model.chosen,0);
  assert.equal(model.finalText,"STOCKS UP, JOBS DOWN");
  assert.equal(model.account,"pagina-es");
  const other=orchestrator.pickPayload(file({text:"LA IA AÚN NO TE QUITÓ EL EMPLEO",option:1}),spanish);
  assert.equal(other.chosen,-1,"a line the model didn't write counts as none of its lines");
  assert.equal(orchestrator.pickPayload(file({text:"BOLSA ARRIBA, EMPLEOS ABAJO",option:0},"engine"),spanish),null,"autopilot never sends a pick");
  assert.equal(orchestrator.pickPayload(file({text:"BOLSA ARRIBA, EMPLEOS ABAJO",option:0},"agent"),spanish),null,"an agent's choice isn't a person's");
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
  // A post longer than its card is cut at a word with "…", like X's "Show more".
  assert.ok(slot(3,"reaction-text").text.endsWith("…")); assert.equal(slot(2,"reaction-text").text,medium.text);
  // The deck's notes keep every post's link and stats.
  assert.ok(document.comments.some(comment=>comment.text.includes("@baude (7.3K likes · 10 reposts · Nov 3, 2026): https://x.com/baude/status/204")));
  assert.ok(model.parseLibrary({...model.EMPTY_LIBRARY,designs:[document]}));
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

test("every stage has a role card, and its prompt carries the page's voice and the house rules",()=>{
  for(const stage of posts.POST_STAGES)assert.ok(playbookLib.roleCardFor(stage).rules.length,`${stage} has rules`);
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
  const bodies=[],replies=[[tweet("201",900,"This chart is the whole job market"),tweet("202",300,"Openings fell before ChatGPT")],[],"credit"];
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
    const file={source:{caption:"",notes:"",slideCount:0,imageIds:[],xPosts:["https://x.com/i/status/301","https://x.com/i/status/404","https://x.com/i/status/302"]},stages:{brief:{status:"done",output:OUTPUTS.brief}}};
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

test("at the checkpoint a person adds posts from X by link: nothing reruns, and the approval can use them",async()=>{
  const embed=id=>({__typename:"Tweet",id_str:id,text:`Post ${id} about the job market`,created_at:"2026-11-05T19:08:45.000Z",favorite_count:7291,user:{name:`Person ${id}`,screen_name:`person${id}`,is_blue_verified:true}});
  const original=globalThis.fetch,asked=[];
  globalThis.fetch=async url=>{
    const id=new URL(url).searchParams.get("id");asked.push(id);
    return id==="404"?new Response("",{status:404}):new Response(JSON.stringify(embed(id)),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try {
    // X couldn't be searched, so the plan has no reaction slide yet.
    const crew=team({
      reactions:async()=>({status:"skipped",output:{reactions:[],note:"X reactions need APIFY_TOKEN on the server."}}),
      outline:async()=>({output:{...OUTPUTS.outline,slides:OUTPUTS.outline.slides.filter(slide=>slide.kind!=="reaction")}}),
    });
    const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"checkpoint");
    await done;
    const calls=crew.calls.length;
    const added=await orchestrator.addRecreatePosts(ownerKey,file.id,["https://x.com/i/status/301","https://x.com/i/status/404"],"human");
    await added.done;
    assert.equal(added.added,1);
    assert.match(added.problems.join(" "),/won't show post 404/);
    assert.equal(crew.calls.length,calls,"nothing reruns: the plan and the hooks stay");
    const paused=await read(ownerKey,file.id);
    assert.equal(paused.status,"paused");
    assert.equal(paused.stages.reactions.status,"done");
    assert.deepEqual(paused.stages.reactions.output.reactions.map(item=>[item.id,item.url,item.why]),[["301","https://x.com/person301/status/301","Added by you"]]);
    assert.equal(paused.stages.reactions.output.note,"X reactions need APIFY_TOKEN on the server.","the search's note stays");
    assert.deepEqual(paused.source.xPosts,["https://x.com/i/status/301"],"only posts X showed are kept as added");
    assert.ok(paused.history.some(entry=>entry.stage==="reactions"&&entry.by==="human"&&/added a post from X by link/.test(entry.event)));
    assert.deepEqual(jobs.postView(paused,false).checkpoint.reactions.map(item=>item.id),["301"]);
    // The same post again, by another kind of link, changes nothing and asks X nothing.
    const fetched=asked.length;
    const again=await orchestrator.addRecreatePosts(ownerKey,file.id,["https://twitter.com/person301/status/301?s=20"],"human");
    assert.equal(again.added,0); assert.equal(asked.length,fetched);
    await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,["https://x.com/i/status/404"],"human"),/won't show post 404/);
    await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,Array.from({length:8},(_,index)=>`https://x.com/i/status/${500+index}`),"human"),/at most 8 posts/);
    await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,["https://example.com/a/status/1"],"human"),/isn't a link to a post on X/);
    assert.equal(asked.length,fetched+1,"refused links never reach X");
    // The approval puts the added post on a reaction slide.
    const slides=jobs.postView(paused,false).checkpoint.outline.slides;
    const planned=[...slides.slice(0,-1),{kind:"reaction",templatePage:REACTION,purpose:"How X reacted",points:[],chartId:null,reactionIds:["301"],photo:""},slides.at(-1)];
    const approved=await orchestrator.approveRecreate(ownerKey,file.id,{outline:{slides:planned,why:"With the post I added"},option:0},"agent",{runners:crew.runners,environment:env(english)});
    await approved.done;
    const finished=await read(ownerKey,file.id);
    assert.deepEqual(finished.stages.approval.output.outline.slides.find(slide=>slide.kind==="reaction").reactionIds,["301"]);
    await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,["https://x.com/i/status/302"],"human"),/already approved/);
  } finally {
    globalThis.fetch=original;
  }
});

test("a post added at the checkpoint goes on the last reaction slide with room, or on a new one before Follow",()=>{
  const job=load("components/template-editor/recreate-job.ts");
  const page=count=>count>=3?THREE:count===2?REACTIONS:REACTION;
  const slide=templatePage=>({kind:"reaction",templatePage,purpose:"New",points:[],chartId:null,reactionIds:[],photo:"",key:"new"});
  const base=OUTPUTS.outline.slides.map((item,index)=>({...item,key:`s${index}`}));
  let placed=job.placePost(base,"301",{maxPosts:3,page,slide});
  assert.deepEqual([placed.at,placed.created,placed.changed],[2,false,true],"the plan's two-post slide has room for a third");
  assert.deepEqual([placed.slides[2].reactionIds,placed.slides[2].templatePage],[["101","102","301"],THREE]);
  assert.equal(base[2].reactionIds.length,2,"the slides passed in are left as they were");
  const same=job.placePost(placed.slides,"102",{maxPosts:3,page,slide});
  assert.deepEqual([same.at,same.changed,same.slides],[2,false,placed.slides],"a post already on a slide stays where it is");
  placed=job.placePost(placed.slides,"302",{maxPosts:3,page,slide});
  assert.deepEqual([placed.at,placed.created],[3,true]);
  assert.deepEqual(placed.slides.map(item=>item.kind),["cover","original","reaction","reaction","follow"],"a new reaction slide goes before Follow");
  assert.deepEqual([placed.slides[3].reactionIds,placed.slides[3].templatePage,placed.slides[3].key],[["302"],REACTION,"new"]);
  const full=Array.from({length:job.MAX_RECREATE_SLIDES},(_,index)=>({...base[0],key:`f${index}`}));
  assert.equal(job.placePost(full,"303",{maxPosts:3,page,slide}),null,"no room for another slide");
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
