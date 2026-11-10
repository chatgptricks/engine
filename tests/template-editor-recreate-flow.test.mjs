/* Run: node --test tests/template-editor-recreate-flow.test.mjs
 * The current Recreate team (post files of version 2): source → research →
 * verdict → brief → headline → approval → design → review, and an exact
 * copy's source → research → verdict → design → review. The verdict is the
 * gate: proceed goes on, stop ends the run, ask waits for a person. Also the
 * checkpoint, autopilot's headline, the critics' fix rounds, failures and
 * resume, reruns, hand-ins, version-1 files (read-only), the playbook and the
 * dialog's job model. Claude, X and the headline model are never called:
 * every agent stage here is a stand-in, and the verdict is Engine's own code.
 * Local development storage only. */
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
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-flow-test-"));
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
const headlines=load("lib/engine/agents/stages/headline.ts");
const reviewStage=load("lib/engine/agents/stages/review.ts");
const playbookLib=load("lib/engine/agents/playbook.ts");
const cards=load("lib/engine/agents/cards/card.ts");
const claude=load("lib/engine/agents/claude.ts");
const model=load("lib/template-editor/model.ts");
const profiles=load("lib/engine/page-profiles.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const spanish=profiles.builtInPageProfiles().find(item=>item.id==="pagina-es");
const env=profile=>async()=>({profile,template,templates:model.BUILT_IN_TEMPLATES});
let owners=0;
const owner=()=>`owner-flow-${++owners}`;

// ── The stand-in team's outputs ──────────────────────────────────────────────
const traction={likes:48210,comments:1200,views:null};
const xpost=(id,handle,text,likes)=>({id,url:`https://x.com/${handle}/status/${id}`,author:{name:handle.toUpperCase(),handle,avatarUrl:null,verified:false},text,createdAt:"2026-11-03T12:00:00.000Z",likes,reposts:10,replies:5,views:1000,why:"Clear take"});
const TEMPLATE_NOTES={
  cover:{layout:"Headline over a full photo",headline:{text:"STOCKS UP, JOBS DOWN",casing:"upper",lines:["STOCKS UP,","JOBS DOWN"],weight:"black",highlighted:["JOBS DOWN"]},
    subject:{kind:"photo",what:"A trader at a screen",position:"behind the headline",size:"the whole slide"},background:"The photo",insets:[]},
  branding:["@otherpage watermark"],slides:[{index:1,role:"cover",layout:"Headline at the bottom"},{index:2,role:"chart",layout:"Title, chart, source"}],avoid:[],
};
const SOURCE={
  post:{author:{handle:"otherpage",name:"Other Page"},format:"carousel",date:"2026-11-02",caption:"Stocks up, jobs down.",url:"https://www.instagram.com/p/abc/",traction},
  originalLanguage:"en",shows:"A trader; a chart of stocks and job openings",claims:"Stocks rose while job openings fell",mismatch:"",template:TEMPLATE_NOTES,
  slides:[{index:1,role:"cover",texts:[{role:"headline",text:"STOCKS UP, JOBS DOWN"}],parts:[]},{index:2,role:"chart",texts:[{role:"title",text:"AI vs Jobs"}],parts:[]}],notes:[],
};
const REASONS={proceed:"Traced to the BLS release, and the post is performing",stop:"No original anywhere, and the numbers change between versions",ask:"Only one account has posted it"};
function research(outcome="proceed",extra={}) {
  return {
    quick:false,
    origin:outcome==="proceed"?{found:true,url:"https://www.bls.gov/jlt/",who:"BLS",date:"2026-10-07",note:"The JOLTS release"}:{found:false,url:null,who:"",date:null,note:"Every copy points back to the same screenshot"},
    surfaces:[{title:"Reuters",url:"https://www.reuters.com/markets/jobs",independent:true}],
    facts:[{claim:"Job openings fell 29%",label:"confirmed",detail:"JOLTS, seasonally adjusted",correction:"",sources:[{title:"BLS JOLTS",url:"https://www.bls.gov/jlt/"}]}],
    worth:{traction:{post:traction,usual:{likes:20000,comments:500,views:null},ratio:2.4,performing:true},fresh:{firstSeen:"2026-10-07",ageDays:3,stale:false},saturation:{note:"A few pages",saturated:false},covered:{already:false,by:[],note:""}},
    fabrication:outcome==="stop"?[{sign:"shifting_numbers",detail:"29% in one copy, 40% in another",sources:[{title:"A repost",url:"https://example.com/repost"}]}]:[],
    positions:[],
    reactions:[xpost("101","alice","AI didn't take the jobs, rates did",5000),xpost("102","bob","Openings are back to 2019 levels",3000)],
    recommendation:{outcome,reason:REASONS[outcome]},
    ...extra,
  };
}
const slide=(kind,purpose,extra={})=>({kind,purpose,points:[],original:null,chart:"",reactionIds:[],photo:"",...extra});
const BRIEF={
  topic:"AI and jobs",angle:"Your job search got harder",originalHeadline:"STOCKS UP, JOBS DOWN",
  whatHappened:"Stocks rose while US job openings fell after ChatGPT came out.",backstory:"",positions:[],
  guardrails:{alleged:[],numbers:["Job openings fell 29% (BLS JOLTS)"],names:[],warnings:[]},template:TEMPLATE_NOTES,
  links:[{title:"BLS JOLTS",url:"https://www.bls.gov/jlt/"}],
  slides:[
    slide("cover","Hook",{original:1,photo:"A trader at a screen"}),
    slide("original","The chart",{original:2,points:["Openings fell 29%"],chart:"S&P 500 against job openings, FRED"}),
    slide("reaction","How X reacted",{reactionIds:["101","102"]}),
    slide("follow","Follow"),
  ],
  why:"The original, then reactions",
};
const HEADLINES={
  options:[
    {text:"STOCKS UP, JOBS DOWN",framework:"the original's",by:"original",english:null},
    {text:"WALL STREET WON, WORKERS WAIT",framework:"story",by:"headline-model",english:null},
    {text:"AI DIDN'T TAKE YOUR JOB YET",framework:"stakes",by:"copywriter",english:null},
  ],
  source:"headline-model",lead:"original",performing:true,story:"Stocks rose while US job openings fell after ChatGPT.",
  modelOptions:[{text:"WALL STREET WON, WORKERS WAIT",framework:"story",sources:["model-v3"]}],note:"",
};
const DESIGN={deckId:"recreate-flow-deck",name:"AI vs Jobs",slideCount:4,savedAt:"2026-11-08T00:00:00.000Z",caption:"Stocks up, jobs down.\n\nSource: BLS",pages:[],notes:[],held:""};
const REVIEW={round:0,rendered:false,checks:[],facts:null,design:null,sentBack:[]};
const OUTPUTS={source:SOURCE,brief:BRIEF,headline:HEADLINES,design:DESIGN,review:REVIEW};

/**
 * Stand-in stages: each records its call, checks that what it reads finished
 * first, and returns its canned output. The verdict and autopilot's approval
 * are Engine's own code unless a test replaces them.
 */
function team(custom={}) {
  const calls=[];
  const runners={};
  for(const stage of posts.POST_STAGES) {
    if((stage==="verdict"||stage==="approval")&&!custom[stage])continue;
    runners[stage]=async context=>{
      for(const input of posts.inputsOf(stage,context.file.mode))assert.ok(["done","skipped"].includes(context.file.stages[input]?.status),`${stage} started before ${input} finished`);
      calls.push({stage,round:context.round,instructions:context.instructions,previous:context.previous,mode:context.file.mode});
      await new Promise(resolve=>setTimeout(resolve,2));
      const count=calls.filter(call=>call.stage===stage).length;
      if(custom[stage])return custom[stage](context,count);
      if(stage==="research")return {output:research("proceed",{quick:context.file.mode==="exact"})};
      return {output:structuredClone(OUTPUTS[stage])};
    };
  }
  return {calls,runners,count:stage=>calls.filter(call=>call.stage===stage).length,order:()=>calls.map(call=>call.stage)};
}
const options=(crew,extra={})=>({runners:crew.runners,environment:env(english),...extra});
const start=(ownerKey,crew,mode,extra={})=>orchestrator.startRecreate(ownerKey,{profileId:"chatgptricks",url:"https://www.instagram.com/p/abc/",mode},options(crew,extra));
const read=(ownerKey,id)=>posts.getPostFile(ownerKey,id);
const researching=outcome=>async()=>({output:research(outcome)});

// ── A full recreation ────────────────────────────────────────────────────────
test("a checkpoint run reads the post, researches it, passes the check, and pauses for a person",async()=>{
  const crew=team(),ownerKey=owner(),{file,done}=await start(ownerKey,crew,"checkpoint");
  assert.equal(file.version,2);
  await done;
  assert.deepEqual(crew.order(),["source","research","brief","headline"],"one stage at a time, each after what it reads; the verdict is Engine's code");
  const paused=await read(ownerKey,file.id);
  assert.equal(paused.status,"paused");
  assert.equal(paused.waiting,"approval");
  assert.equal(paused.message,"Ready for you: check the plan and pick the headline");
  assert.equal(paused.stages.approval,undefined,"nobody approved it");
  assert.equal(crew.count("design"),0,"nothing is designed before the approval");
  assert.deepEqual(paused.stages.verdict.output,{outcome:"proceed",reason:REASONS.proceed,evidence:[{title:"BLS",url:"https://www.bls.gov/jlt/"}],answer:null},"the verdict follows the research's recommendation, with the original as evidence");
  const view=jobs.postView(paused,false);
  assert.equal(view.version,2);
  assert.equal(view.status,"paused");
  assert.equal(view.waiting,"approval");
  assert.deepEqual(view.stages.map(stage=>stage.stage),posts.POST_STAGES);
  assert.deepEqual(view.stages.map(stage=>stage.title),["Source reader","Researcher","The check","Editor","Headlines","Checkpoint","Designer","Critics"]);
  assert.equal(view.stages.find(stage=>stage.stage==="verdict").by,"code");
  assert.match(view.stages.find(stage=>stage.stage==="source").summary,/Read 2 slides; 48.2K likes/);
  assert.match(view.stages.find(stage=>stage.stage==="verdict").summary,/^Passed: /);
  assert.equal(view.verdict.choice,"proceed");
  assert.equal(view.verdict.traction.performing,true);
  assert.equal(view.checkpoint.outline.slides.length,4);
  assert.deepEqual(view.checkpoint.hooks.options.map(option=>option.by),["original","headline-model","copywriter"],"the original's headline leads: the post performs");
  assert.equal(view.checkpoint.hooks.lead,"original");
  assert.equal(view.checkpoint.reactions[0].url,"https://x.com/alice/status/101","reactions keep their links");
  assert.equal(view.checkpoint.brief.originalHeadline,"STOCKS UP, JOBS DOWN");
  assert.equal(view.jobId,file.id.slice(5));
});

test("a person's own headline finishes the post, and their pick goes to the headline model",async()=>{
  const crew=team(),ownerKey=owner(),picks=[];
  const savePick=async input=>{picks.push(input);return {id:"pick-1"};};
  const first=await start(ownerKey,crew,"checkpoint",{savePick});
  await first.done;
  await assert.rejects(orchestrator.approveRecreate(ownerKey,first.file.id,{option:9},"human",options(crew,{savePick})),/Pick one of the headline options/);
  await assert.rejects(orchestrator.approveRecreate(ownerKey,first.file.id,{text:"X".repeat(201)},"human",options(crew,{savePick})),/under 200 characters/);
  const approved=await orchestrator.approveRecreate(ownerKey,first.file.id,{text:"WALL STREET WON, WORKERS STILL WAIT"},"human",options(crew,{savePick}));
  assert.equal(approved.file.message,"Approved. Designing the slides");
  await approved.done;
  const finished=await read(ownerKey,first.file.id);
  assert.equal(finished.status,"done");
  assert.equal(finished.deckId,"recreate-flow-deck");
  assert.equal(finished.message,"Created 4 editable slides");
  assert.deepEqual(finished.stages.approval.output.headline,{text:"WALL STREET WON, WORKERS STILL WAIT",option:-1});
  assert.equal(finished.stages.approval.by,"human");
  assert.equal(picks.length,1,"one pick, for one human choice");
  const [pick]=picks;
  assert.deepEqual(pick.options.map(option=>option.sources),[["model-v3"],["original"],["engine-copywriter"],["human"]],"the original's, the copywriter's and the person's lines are tagged as theirs");
  assert.equal(pick.chosen,3);
  assert.equal(pick.finalText,"WALL STREET WON, WORKERS STILL WAIT");
  assert.equal(pick.originalHeadline,"STOCKS UP, JOBS DOWN");
  assert.equal(pick.account,"chatgptricks");
  assert.ok(finished.history.some(entry=>/Sent the headline pick to the headline model \(pick-1\)/.test(entry.event)));
  await assert.rejects(orchestrator.approveRecreate(ownerKey,first.file.id,{option:0},"human",options(crew,{savePick})),/already approved/);
  const order=crew.order();
  assert.ok(order.indexOf("design")>order.indexOf("headline")&&order.indexOf("review")>order.indexOf("design"));
  const view=jobs.postView(finished,false);
  assert.equal(view.status,"done");
  assert.equal(view.result.deckId,"recreate-flow-deck");
  assert.match(view.result.editorUrl,/design=recreate-flow-deck/);
  assert.equal(view.result.caption,DESIGN.caption);
  assert.deepEqual(view.result.factChecks.map(fact=>fact.verdict),["confirmed"],"the research's labels are the fact-check");
  assert.equal(view.checkpoint,undefined,"an approved plan isn't offered again");
});

test("autopilot takes the plan and the first headline that fits the cover, and never sends a pick",async()=>{
  const crew=team(),ownerKey=owner(),picks=[];
  const {file,done}=await start(ownerKey,crew,"autopilot",{savePick:async input=>{picks.push(input);return {id:"x"};}});
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(finished.stages.approval.by,"engine");
  assert.deepEqual(finished.stages.approval.output.headline,{text:"STOCKS UP, JOBS DOWN",option:0});
  assert.equal(finished.stages.approval.output.plan.slides.length,4,"the brief's plan as written");
  assert.equal(picks.length,0,"autopilot's choices never reach the headline model");
  assert.deepEqual(crew.order(),["source","research","brief","headline","design","review"]);
});

test("autopilot's headline is the first that fits the cover's headline, else the shortest",()=>{
  const options=["A HEADLINE FAR TOO LONG FOR THE COVER, WITH A CLAIM THE FACTS DON'T SUPPORT AND A YEAR THAT IS OUT OF DATE","STOCKS UP, JOBS DOWN SINCE CHATGPT","JOBS DOWN"].map(text=>({text,framework:"",by:"headline-model",english:null}));
  assert.equal(headlines.autopilotHeadline(options,79),1,"the order wins among the headlines that fit");
  assert.equal(headlines.autopilotHeadline(options),0,"without a known limit, the first");
  assert.equal(headlines.autopilotHeadline([options[0],options[2]],5),1,"none fits: the shortest");
  assert.equal(headlines.autopilotHeadline([options[0],options[0]],20),0,"a tie keeps the order");
  assert.equal(headlines.autopilotHeadline([],79),-1);
});

// ── The check ────────────────────────────────────────────────────────────────
test("the check stops a made-up story before anything is planned, and a person can build it anyway",async()=>{
  const crew=team({research:researching("stop")}),ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const stopped=await read(ownerKey,file.id);
  assert.equal(stopped.status,"stopped");
  assert.equal(stopped.message,`Stopped at the check: ${REASONS.stop}`);
  assert.equal(stopped.deckId,undefined,"no deck");
  assert.deepEqual(crew.order(),["source","research"],"nothing is planned, written or designed");
  assert.deepEqual(stopped.stages.verdict.output.evidence,[{title:"A repost",url:"https://example.com/repost"}]);
  const view=jobs.postView(stopped,false);
  assert.equal(view.status,"stopped");
  assert.equal(view.resumable,undefined,"a stop isn't a failure to resume");
  assert.equal(view.verdict.outcome,"stop");
  assert.deepEqual(view.verdict.fabrication,[{sign:"shifting_numbers",detail:"29% in one copy, 40% in another"}]);
  assert.equal(view.verdict.origin.found,false);
  assert.match(view.stages.find(stage=>stage.stage==="verdict").summary,/^Stopped: /);
  assert.deepEqual(orchestrator.readyStages(stopped),[]);
  await assert.rejects(orchestrator.resumeRecreate(ownerKey,file.id,options(crew)),/The check stopped this post/);
  await assert.rejects(orchestrator.approveRecreate(ownerKey,file.id,{option:0},"human",options(crew)),/aren't ready yet/);
  const anyway=await orchestrator.answerRecreateVerdict(ownerKey,file.id,{choice:"proceed",note:"Build it anyway: we'll say it's unconfirmed"},"human",options(crew));
  assert.equal(anyway.file.message,"Building it anyway, with the check's warnings in the brief");
  await anyway.done;
  const built=await read(ownerKey,file.id);
  assert.equal(built.status,"done");
  assert.equal(built.stages.verdict.output.outcome,"stop","the check's own outcome stays on the record");
  assert.deepEqual([built.stages.verdict.output.answer.choice,built.stages.verdict.output.answer.by,built.stages.verdict.output.answer.note],["proceed","human","Build it anyway: we'll say it's unconfirmed"]);
  assert.ok(built.history.some(entry=>entry.stage==="verdict"&&entry.event==="built anyway"&&entry.by==="human"));
  assert.deepEqual(["research","brief","design"].map(crew.count),[1,1,1],"research isn't redone");
  assert.equal(jobs.postView(built,false).stages.find(stage=>stage.stage==="verdict").summary,"Built anyway, by your call");
  await assert.rejects(orchestrator.answerRecreateVerdict(ownerKey,file.id,{choice:"stop"},"human",options(crew)),/already answered/);
});

test("the check asks a person, in autopilot too: stop ends the run and proceed goes on",async()=>{
  const crew=team({research:researching("ask")}),ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const asking=await read(ownerKey,file.id);
  assert.equal(asking.status,"paused");
  assert.equal(asking.waiting,"verdict");
  assert.equal(asking.message,`Check the story first: ${REASONS.ask}`);
  const view=jobs.postView(asking,false);
  assert.equal(view.waiting,"verdict");
  assert.equal(view.checkpoint,undefined);
  assert.equal(view.verdict.choice,"ask");
  assert.match(view.stages.find(stage=>stage.stage==="verdict").summary,/^Needs you: /);
  await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,["https://x.com/i/status/301"],"human"),/once the plan is ready/);
  await assert.rejects(orchestrator.answerRecreateVerdict(ownerKey,file.id,{choice:"maybe"},"human",options(crew)),/proceed, stop or the original's link/);
  const no=await orchestrator.answerRecreateVerdict(ownerKey,file.id,{choice:"stop"},"human",options(crew));
  await no.done;
  const ended=await read(ownerKey,file.id);
  assert.equal(ended.status,"stopped");
  assert.equal(ended.waiting,undefined);
  assert.equal(ended.message,"Stopped: you chose not to make this post.");
  assert.equal(jobs.postView(ended,false).stages.find(stage=>stage.stage==="verdict").summary,"You chose not to make it");
  assert.equal(crew.count("brief"),0);
  // A second run that asks: this time the person goes ahead.
  const again=team({research:researching("ask")}),other=await start(ownerKey,again,"autopilot");
  await other.done;
  const yes=await orchestrator.answerRecreateVerdict(ownerKey,other.file.id,{choice:"proceed"},"agent",options(again));
  assert.equal(yes.file.message,"Going ahead");
  await yes.done;
  const made=await read(ownerKey,other.file.id);
  assert.equal(made.status,"done");
  assert.ok(made.history.some(entry=>entry.stage==="verdict"&&entry.event==="answered: proceed"&&entry.by==="agent"));
});

test("adding the story's original researches again from it",async()=>{
  const crew=team({research:async(context,count)=>({output:research(count===1?"ask":"proceed")})});
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  assert.equal((await read(ownerKey,file.id)).waiting,"verdict");
  await assert.rejects(orchestrator.answerRecreateVerdict(ownerKey,file.id,{choice:"link",link:"not a link"},"human",options(crew)),/Add the link to the story's original/);
  const linked=await orchestrator.answerRecreateVerdict(ownerKey,file.id,{choice:"link",link:"https://www.example.com/first-report",note:"It started here"},"human",options(crew));
  assert.equal(linked.file.message,"Researching again from the original's link");
  await linked.done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(finished.source.originUrl,"https://www.example.com/first-report");
  assert.equal(crew.count("research"),2);
  assert.equal(crew.count("source"),1,"the post isn't read again");
  assert.match(crew.calls.filter(call=>call.stage==="research")[1].instructions,/A person added the story's original: https:\/\/www\.example\.com\/first-report\. Start from it\. Their note: It started here/);
  assert.equal(jobs.postView(finished,false).verdict.originUrl,"https://www.example.com/first-report");
  await assert.rejects(orchestrator.answerRecreateVerdict(ownerKey,file.id,{choice:"stop"},"human",options(crew)),/passed the check/);
});

// ── Fix rounds, failures, reruns and hand-ins ────────────────────────────────
test("the critics send work back to the designer at most twice, with what to fix and the earlier deck",async()=>{
  const issue={slide:2,problem:"The body runs to three lines",fix:"Cut it to one short sentence",severity:"must_fix",route:"design"};
  const crew=team({review:async context=>({output:{...REVIEW,round:context.round,rendered:true,checks:[issue,{...issue,problem:"Fine print",severity:"note"}],sentBack:context.round<reviewStage.MAX_FIX_ROUNDS?["design"]:[]}})});
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(crew.count("design"),1+reviewStage.MAX_FIX_ROUNDS,"the first deck plus two fix rounds");
  assert.equal(crew.count("review"),1+reviewStage.MAX_FIX_ROUNDS);
  assert.deepEqual(["research","brief","headline"].map(crew.count),[1,1,1],"nothing before the design is redone");
  const fixes=crew.calls.filter(call=>call.stage==="design").slice(1);
  assert.ok(fixes.every(call=>/Slide 2 \(must fix\): The body runs to three lines\. Fix: Cut it to one short sentence/.test(call.instructions)&&!/Fine print/.test(call.instructions)&&call.previous?.deckId==="recreate-flow-deck"));
  assert.deepEqual(crew.calls.filter(call=>call.stage==="review").map(call=>call.round),[0,1,2]);
  assert.deepEqual(finished.stages.review.output.sentBack,[],"the last round sends nothing back");
});

test("a failed stage stops the post, and resume picks up from that stage",async()=>{
  const crew=team({brief:async(context,count)=>{if(count===1)throw new claude.RecreateError("The editor couldn't finish the brief. Try again.",502);return {output:structuredClone(BRIEF)};}});
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const failed=await read(ownerKey,file.id);
  assert.equal(failed.status,"error");
  assert.equal(failed.message,"The editor couldn't finish the brief. Try again.");
  assert.equal(failed.stages.brief.status,"error");
  assert.deepEqual(["source","research","verdict"].map(stage=>failed.stages[stage].status),["done","done","done"],"the stages before it finished");
  const view=jobs.postView(failed,false);
  assert.equal(view.status,"error");
  assert.equal(view.resumable,true);
  const resumed=await orchestrator.resumeRecreate(ownerKey,file.id,options(crew));
  await resumed.done;
  assert.equal((await read(ownerKey,file.id)).status,"done");
  assert.deepEqual(["source","research","brief"].map(crew.count),[1,1,2],"finished stages aren't redone");
});

test("a run that stopped without finishing shows as stopped and can be resumed",async()=>{
  const ownerKey=owner();
  const file=await posts.createPostFile(ownerKey,{profileId:"chatgptricks",mode:"autopilot",source:{caption:"",notes:"",slideCount:0,imageIds:["slide-1"]}});
  await posts.updatePostFile(ownerKey,file.id,next=>{posts.setStage(next,"source",{status:"running",attempt:"gone"});});
  const view=jobs.postView(await read(ownerKey,file.id),false);
  assert.equal(view.status,"error");
  assert.equal(view.resumable,true);
  assert.match(view.message,/Resume it/);
  assert.equal(view.stages[0].status,"error","the stage left running shows as failed");
  const crew=team(),resumed=await orchestrator.resumeRecreate(ownerKey,file.id,options(crew));
  await resumed.done;
  assert.equal((await read(ownerKey,file.id)).status,"done");
});

test("the review is optional: when the critics fail, the post is still made",async()=>{
  const crew=team({review:async()=>{throw new claude.RecreateError("The critics couldn't see the slides.",502);}});
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(finished.stages.review.status,"skipped");
  assert.equal(finished.stages.review.error,"The critics couldn't see the slides.");
  assert.equal(jobs.postView(finished,false).result.review,null);
});

test("rerunning a stage reruns everything that read it, with the person's instructions",async()=>{
  const crew=team(),ownerKey=owner(),{file,done}=await start(ownerKey,crew,"autopilot");
  await done;
  const again=await orchestrator.rerunRecreateStage(ownerKey,file.id,"design","Make the cover shorter","human",options(crew));
  assert.equal(again.file.message,"Rerunning: designing the slides");
  await again.done;
  assert.equal((await read(ownerKey,file.id)).status,"done");
  assert.deepEqual(["design","review","brief","research"].map(crew.count),[2,2,1,1]);
  const rerun=crew.calls.filter(call=>call.stage==="design")[1];
  assert.equal(rerun.instructions,"Make the cover shorter");
  assert.equal(rerun.previous.deckId,"recreate-flow-deck","the designer sees its earlier deck");
  // The brief: the headline, the approval, the design and the review all read it.
  const plan=await orchestrator.rerunRecreateStage(ownerKey,file.id,"brief",undefined,"agent",options(crew));
  await plan.done;
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.deepEqual(["brief","headline","design","review","research","source"].map(crew.count),[2,2,3,3,1,1]);
  assert.equal(finished.stages.approval.by,"engine","autopilot approves the new plan itself");
  await assert.rejects(orchestrator.rerunRecreateStage(ownerKey,file.id,"copy",undefined,"human",options(crew)),/There is no copy stage/);
});

test("an agent can hand in a stage, checked against its schema; the verdict and the design can't be",async()=>{
  const crew=team(),ownerKey=owner(),{file,done}=await start(ownerKey,crew,"checkpoint");
  await done;
  const opts=options(crew);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"verdict",{outcome:"proceed",reason:"",evidence:[],answer:null},"agent",opts),/The check is answered, not handed in/);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"design",DESIGN,"agent",opts),/Engine builds the design stage itself/);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"headline",{options:"nope"},"agent",opts),/doesn't match its schema: options/);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"headline",{...HEADLINES,options:[]},"agent",opts),/at least one headline option/);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"review",REVIEW,"agent",opts),/needs design first/);
  const own={...HEADLINES,options:[{text:"THE JOBS DATA AI CAN'T EXPLAIN",framework:"number",by:"agent",english:null}],source:"agent",lead:"model",modelOptions:[]};
  const handed=await orchestrator.submitRecreateStage(ownerKey,file.id,"headline",own,"agent",opts);
  await handed.done;
  const after=await read(ownerKey,file.id);
  assert.equal(after.stages.headline.by,"agent");
  assert.equal(after.status,"paused","it still waits for the approval");
  assert.equal(after.waiting,"approval");
  assert.equal(crew.count("headline"),1,"the handed-in headlines aren't rewritten");
  // An approval handed in goes through the checkpoint like a person's.
  const approved=await orchestrator.submitRecreateStage(ownerKey,file.id,"approval",{plan:{slides:BRIEF.slides,why:BRIEF.why},headline:{text:"THE JOBS DATA AI CAN'T EXPLAIN",option:0},notes:""},"agent",opts);
  await approved.done;
  assert.equal((await read(ownerKey,file.id)).status,"done");
  // Before the check says proceed, nothing that reads it can be handed in.
  const waiting=team({research:researching("ask")}),asked=await start(ownerKey,waiting,"checkpoint");
  await asked.done;
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,asked.file.id,"brief",BRIEF,"agent",options(waiting)),/waits for the check to say proceed/);
});

test("the checkpoint takes an edited plan and keeps only the posts the research found",async()=>{
  const crew=team(),ownerKey=owner(),{file,done}=await start(ownerKey,crew,"checkpoint");
  await done;
  const opts=options(crew);
  await assert.rejects(orchestrator.approveRecreate(ownerKey,file.id,{plan:{slides:[{kind:"cover"}],why:""},option:0},"human",opts),/That plan isn't valid/);
  await assert.rejects(orchestrator.approveRecreate(ownerKey,file.id,{plan:{slides:[slide("reaction","Made up",{reactionIds:["999"]})],why:""},option:0},"human",opts),/no slides that can be built/);
  const edited={slides:[BRIEF.slides[0],slide("reaction","How X reacted",{reactionIds:["102","999","101"]}),BRIEF.slides[3]],why:"Cover, reactions, Follow"};
  const approved=await orchestrator.approveRecreate(ownerKey,file.id,{plan:edited,option:1,notes:"Keep it short"},"agent",opts);
  await approved.done;
  const finished=await read(ownerKey,file.id);
  const {plan,headline,notes}=finished.stages.approval.output;
  assert.equal(plan.slides.length,3);
  assert.deepEqual(plan.slides[1].reactionIds,["102","101"],"a post the research didn't find is dropped");
  assert.deepEqual(headline,{text:"WALL STREET WON, WORKERS WAIT",option:1});
  assert.equal(notes,"Keep it short");
  assert.equal(finished.stages.approval.by,"agent");
});

test("normalizePlan keeps a plan to slides that can be built",()=>{
  const plan=headlines.normalizePlan({slides:[
    slide("cover","  Hook  ",{points:[" A ",""],photo:" A trader "}),
    slide("reaction","Posts",{reactionIds:["1","1","2","3","4"],chart:"Not here",photo:"Nor here"}),
    slide("reaction","Nothing real",{reactionIds:["9"]}),
    slide("question","Why?",{reactionIds:["1"],chart:" Openings, FRED "}),
    ...Array.from({length:25},(_,index)=>slide("takeaway",`Point ${index}`)),
  ],why:" Because "},{reactions:["1","2","3","4"]});
  assert.equal(plan.slides.length,headlines.MAX_PLAN_SLIDES);
  assert.deepEqual(plan.slides[0],slide("cover","Hook",{points:["A"],photo:"A trader"}));
  assert.deepEqual(plan.slides[1].reactionIds,["1","2","3"],"at most three posts on a slide, each once");
  assert.deepEqual([plan.slides[1].chart,plan.slides[1].photo],["",""]);
  assert.equal(plan.slides[2].kind,"question","a reaction slide with no real post is dropped");
  assert.deepEqual([plan.slides[2].reactionIds,plan.slides[2].chart],[[],"Openings, FRED"]);
  assert.equal(plan.why,"Because");
});

test("readyStages follows each mode's graph, and holds the gate and the checkpoint",()=>{
  const done=status=>({status:"done",output:status});
  const at=(mode,stages)=>({version:2,mode,stages});
  const checked=outcome=>done({outcome,reason:"",evidence:[],answer:null});
  assert.deepEqual(orchestrator.readyStages(at("checkpoint",{})),["source"]);
  assert.deepEqual(orchestrator.readyStages(at("checkpoint",{source:done(SOURCE),research:{status:"running"}})),["research"],"a stage a stopped run left running starts again");
  assert.deepEqual(orchestrator.readyStages(at("checkpoint",{source:done(SOURCE),research:done(research())})),["verdict"]);
  assert.deepEqual(orchestrator.readyStages(at("checkpoint",{source:done(SOURCE),research:done(research()),verdict:checked("ask")})),[],"the brief waits for an answer");
  assert.deepEqual(orchestrator.readyStages(at("checkpoint",{source:done(SOURCE),research:done(research()),verdict:checked("stop")})),[]);
  assert.deepEqual(orchestrator.readyStages(at("checkpoint",{source:done(SOURCE),research:done(research()),verdict:done({outcome:"stop",reason:"",evidence:[],answer:{choice:"proceed",by:"human",at:"",note:""}})})),["brief"],"a person's answer goes over the outcome");
  const planned={source:done(SOURCE),research:done(research()),verdict:checked("proceed"),brief:done(BRIEF),headline:done(HEADLINES)};
  assert.deepEqual(orchestrator.readyStages(at("checkpoint",planned)),[],"the checkpoint waits for a person");
  assert.deepEqual(orchestrator.readyStages(at("autopilot",planned)),["approval"]);
  assert.deepEqual(orchestrator.readyStages(at("exact",{source:done(SOURCE),research:done(research()),verdict:checked("proceed")})),["design"],"an exact copy goes from the check to the designer");
  assert.deepEqual(orchestrator.readyStages({...at("autopilot",planned),version:1}),[],"a version-1 file never runs");
});

// ── An exact copy ────────────────────────────────────────────────────────────
test("an exact copy reads, checks and copies the post, with no plan, headline or pause",async()=>{
  const crew=team(),ownerKey=owner();
  const {file,done}=await orchestrator.startRecreate(ownerKey,{profileId:"chatgptricks",url:"https://www.instagram.com/p/abc/",mode:"exact",xPosts:["https://x.com/alice/status/101"]},options(crew));
  assert.equal(file.source.xPosts,undefined,"an exact copy shows only the posts from X its original shows");
  await done;
  assert.deepEqual(crew.order(),["source","research","design","review"]);
  assert.ok(crew.calls.every(call=>call.mode==="exact"));
  const finished=await read(ownerKey,file.id);
  assert.equal(finished.status,"done");
  assert.equal(finished.deckId,"recreate-flow-deck");
  assert.equal(finished.stages.research.output.quick,true);
  const view=jobs.postView(finished,false);
  assert.deepEqual(view.stages.map(stage=>[stage.stage,stage.title]),[["source","Source reader"],["research","Quick check"],["verdict","The check"],["design","Designer"],["review","Fidelity critic"]]);
  assert.deepEqual(view.result.factChecks,[],"an exact copy adds no fact-check of its own");
  const opts=options(crew);
  await assert.rejects(orchestrator.approveRecreate(ownerKey,file.id,{option:0},"human",opts),/An exact copy doesn't pause for approval/);
  await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,["https://x.com/i/status/301"],"human"),/An exact copy shows only the posts from X its original shows/);
  await assert.rejects(orchestrator.rerunRecreateStage(ownerKey,file.id,"brief",undefined,"human",opts),/An exact copy has no brief stage\. Its stages are source, research, verdict, design, review/);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,file.id,"headline",HEADLINES,"agent",opts),/An exact copy has no headline stage/);
});

test("an exact copy's critic sends the copy back once, and its check can stop it too",async()=>{
  const issue={slide:1,problem:"The cover's words differ from the original",fix:"Use the original's words",severity:"must_fix",route:"design"};
  const crew=team({review:async context=>({output:{...REVIEW,round:context.round,rendered:true,design:{verdict:"fix",summary:"One slide is off",issues:[issue]},sentBack:["design"]}})});
  const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"exact");
  await done;
  assert.equal((await read(ownerKey,file.id)).status,"done");
  assert.equal(crew.count("design"),1+reviewStage.MAX_EXACT_FIX_ROUNDS,"one fix round for an exact copy, even when the critic asks again");
  assert.match(crew.calls.filter(call=>call.stage==="design")[1].instructions,/^The fidelity critic and Engine's checks found these problems/);
  const fake=team({research:async()=>({output:research("stop",{quick:true})})}),stopped=await start(ownerKey,fake,"exact");
  await stopped.done;
  assert.equal((await read(ownerKey,stopped.file.id)).status,"stopped");
  assert.equal(fake.count("design"),0);
});

// ── At the checkpoint: posts from X added by link ───────────────────────────
test("at the checkpoint a person adds posts from X by link: nothing reruns, and the approval can use them",async()=>{
  const embed=id=>({__typename:"Tweet",id_str:id,text:`Post ${id} about the job market`,created_at:"2026-11-05T19:08:45.000Z",favorite_count:7291,user:{name:`Person ${id}`,screen_name:`person${id}`,is_blue_verified:true}});
  const original=globalThis.fetch,asked=[];
  globalThis.fetch=async url=>{
    const id=new URL(url).searchParams.get("id");asked.push(id);
    return id==="404"?new Response("",{status:404}):new Response(JSON.stringify(embed(id)),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try {
    // Research found no posts from X, so the plan has no reaction slide yet.
    const crew=team({
      research:async()=>({output:research("proceed",{reactions:[]})}),
      brief:async()=>({output:{...structuredClone(BRIEF),slides:BRIEF.slides.filter(item=>item.kind!=="reaction")}}),
    });
    const ownerKey=owner(),{file,done}=await start(ownerKey,crew,"checkpoint");
    await done;
    const calls=crew.calls.length;
    const added=await orchestrator.addRecreatePosts(ownerKey,file.id,["https://x.com/i/status/301","https://x.com/i/status/404"],"human");
    await added.done;
    assert.equal(added.added,1);
    assert.match(added.problems.join(" "),/won't show post 404/);
    assert.equal(crew.calls.length,calls,"nothing reruns: the plan and the headlines stay");
    const paused=await read(ownerKey,file.id);
    assert.equal(paused.status,"paused");
    assert.deepEqual(paused.stages.research.output.reactions.map(item=>[item.id,item.url,item.why]),[["301","https://x.com/person301/status/301","Added by you"]]);
    assert.equal(paused.stages.research.output.origin.who,"BLS","the rest of the research stays");
    assert.deepEqual(paused.source.xPosts,["https://x.com/i/status/301"],"only posts X showed are kept as added");
    assert.ok(paused.history.some(entry=>entry.stage==="research"&&entry.by==="human"&&/added a post from X by link/.test(entry.event)));
    assert.deepEqual(jobs.postView(paused,false).checkpoint.reactions.map(item=>item.id),["301"]);
    // The same post again, by another kind of link, changes nothing and asks X nothing.
    const fetched=asked.length;
    const again=await orchestrator.addRecreatePosts(ownerKey,file.id,["https://twitter.com/person301/status/301?s=20"],"human");
    assert.equal(again.added,0); assert.equal(asked.length,fetched);
    await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,["https://x.com/i/status/404"],"human"),/won't show post 404/);
    await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,Array.from({length:8},(_,index)=>`https://x.com/i/status/${500+index}`),"human"),/at most 8 posts/);
    await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,["https://example.com/a/status/1"],"human"),/isn't a link to a post on X/);
    // The approval puts the added post on a reaction slide.
    const planned=jobs.postView(paused,false).checkpoint.outline.slides;
    const withPost=[...planned.slice(0,-1),slide("reaction","How X reacted",{reactionIds:["301"]}),planned.at(-1)];
    const approved=await orchestrator.approveRecreate(ownerKey,file.id,{plan:{slides:withPost,why:"With the post I added"},option:0},"agent",options(crew));
    await approved.done;
    const finished=await read(ownerKey,file.id);
    assert.deepEqual(finished.stages.approval.output.plan.slides.find(item=>item.kind==="reaction").reactionIds,["301"]);
    await assert.rejects(orchestrator.addRecreatePosts(ownerKey,file.id,["https://x.com/i/status/302"],"human"),/already approved/);
  } finally {
    globalThis.fetch=original;
  }
});

// ── The headline model's pick ────────────────────────────────────────────────
test("a person's pick tells the headline model what it was up against; a Spanish page sends only its English lines",()=>{
  const file=(headline,by="human",lines=HEADLINES)=>({stages:{
    brief:{status:"done",output:BRIEF},
    headline:{status:"done",output:lines},
    approval:{status:"done",by,output:{plan:{slides:BRIEF.slides,why:BRIEF.why},headline,notes:""}},
  }});
  const picked=orchestrator.pickPayload(file({text:"STOCKS UP, JOBS DOWN",option:0}),english);
  assert.deepEqual(picked.options.map(option=>option.text),["WALL STREET WON, WORKERS WAIT","STOCKS UP, JOBS DOWN","AI DIDN'T TAKE YOUR JOB YET"]);
  assert.equal(picked.chosen,1,"the person picked the original's headline");
  assert.equal(picked.originalHeadline,"STOCKS UP, JOBS DOWN");
  const es={...HEADLINES,lead:"model",options:[
    {text:"BOLSA ARRIBA, EMPLEOS ABAJO",framework:"story",by:"headline-model",english:"WALL STREET WON, WORKERS WAIT"},
    {text:"LA IA AÚN NO TE QUITÓ EL EMPLEO",framework:"stakes",by:"copywriter",english:null},
  ]};
  const model=orchestrator.pickPayload(file({text:"BOLSA ARRIBA, EMPLEOS ABAJO",option:0},"human",es),spanish);
  assert.deepEqual(model.options.map(option=>option.text),["WALL STREET WON, WORKERS WAIT"],"no Spanish line reaches the model");
  assert.equal(model.chosen,0);
  assert.equal(model.finalText,"WALL STREET WON, WORKERS WAIT");
  assert.equal(model.account,"pagina-es");
  assert.equal(orchestrator.pickPayload(file({text:"LA IA AÚN NO TE QUITÓ EL EMPLEO",option:1},"human",es),spanish).chosen,-1,"a line the model didn't write counts as none of its lines");
  assert.equal(orchestrator.pickPayload(file({text:"BOLSA ARRIBA, EMPLEOS ABAJO",option:0},"engine",es),spanish),null,"autopilot never sends a pick");
  assert.equal(orchestrator.pickPayload(file({text:"BOLSA ARRIBA, EMPLEOS ABAJO",option:0},"agent",es),spanish),null,"an agent's choice isn't a person's");
  assert.equal(orchestrator.pickPayload(file({text:"MINE",option:-1},"human",{...HEADLINES,source:"copywriter",modelOptions:[]}),english),null,"no model lines, nothing to teach it");
});

// ── Version-1 files ──────────────────────────────────────────────────────────
test("a run made by the earlier Recreate opens read-only",async()=>{
  const ownerKey=owner(),crew=team(),opts=options(crew);
  const made=async(mode,status,stages)=>{
    const file=await posts.createPostFile(ownerKey,{profileId:"chatgptricks",mode,source:{caption:"",notes:"",slideCount:0,imageIds:[]}});
    return posts.updatePostFile(ownerKey,file.id,next=>{next.version=1;next.status=status;next.message=status==="done"?"Created 3 editable slides":"FRED is down. Resume it to continue.";next.stages=stages;});
  };
  const deck={deckId:"earlier-deck",name:"Earlier",slideCount:3,savedAt:"2026-10-01T00:00:00.000Z",notes:["A note"],pages:[],held:""};
  const finished=await made("exact","done",{deck:{status:"done",output:deck},review:{status:"skipped",error:"No renders"}});
  const reread=await read(ownerKey,finished.id);
  assert.equal(reread.version,1,"version-1 files still open");
  const view=jobs.postView(reread,false);
  assert.equal(view.version,1);
  assert.equal(view.status,"done");
  assert.deepEqual(view.stages.map(stage=>stage.stage),["transcript","data","deck","review"],"its own stages, under their old names");
  assert.equal(view.stages.find(stage=>stage.stage==="data").title,"Chart rebuilder");
  assert.equal(view.result.deckId,"earlier-deck");
  assert.deepEqual(view.result.notes,["A note"]);
  assert.equal(view.checkpoint,undefined);
  assert.equal(view.verdict,undefined);
  const unfinished=jobs.postView(await made("checkpoint","error",{brief:{status:"done",output:{}},facts:{status:"error",error:"FRED is down"}}),false);
  assert.equal(unfinished.status,"error");
  assert.equal(unfinished.resumable,false);
  assert.match(unfinished.message,/made by the earlier Recreate and can't continue/);
  assert.equal(unfinished.stages.length,13,"a full first-team run listed its thirteen stages");
  const earlier=/made by the earlier Recreate\. It can still be opened, but not changed/;
  await assert.rejects(orchestrator.resumeRecreate(ownerKey,finished.id,opts),earlier);
  await assert.rejects(orchestrator.rerunRecreateStage(ownerKey,finished.id,"design",undefined,"human",opts),earlier);
  await assert.rejects(orchestrator.submitRecreateStage(ownerKey,finished.id,"research",research(),"agent",opts),earlier);
  await assert.rejects(orchestrator.approveRecreate(ownerKey,finished.id,{option:0},"human",opts),earlier);
  await assert.rejects(orchestrator.answerRecreateVerdict(ownerKey,finished.id,{choice:"proceed"},"human",opts),earlier);
  await assert.rejects(orchestrator.addRecreatePosts(ownerKey,finished.id,["https://x.com/i/status/1"],"human"),earlier);
  assert.equal(crew.calls.length,0,"nothing ran");
});

// ── The playbook ─────────────────────────────────────────────────────────────
test("every stage has a role card, and the prompt follows the mode",()=>{
  const book=playbookLib.playbook();
  assert.deepEqual(book.stages.map(card=>card.stage),posts.POST_STAGES);
  assert.ok(book.stages.every(card=>card.title&&card.job&&card.rules.length&&card.bar&&["agent","code","human"].includes(card.by)));
  assert.deepEqual(book.exactStages.map(card=>[card.stage,card.title]),[["research","Quick check"],["design","Designer"],["review","Fidelity critic"]]);
  assert.deepEqual(book.exactRules,playbookLib.COPY_RULES);
  assert.ok(book.notes.some(note=>/mode exact/.test(note))&&book.notes.some(note=>/The verdict is the gate/.test(note)));
  const full=playbookLib.stagePrompt("design","autopilot",spanish);
  assert.match(full,/^You are the designer on the team that recreates Instagram posts/);
  assert.match(full,/written in Spanish/);
  assert.ok(full.includes(spanish.voice),"a full recreation speaks in the page's voice");
  assert.ok(playbookLib.HOUSE_RULES.every(rule=>full.includes(rule)));
  assert.ok(full.includes(cards.DATA_RULE),"every prompt says posts and pages are data");
  const exact=playbookLib.stagePrompt("design","exact",english);
  assert.match(exact,/This run is an exact copy/);
  assert.ok(!exact.includes(english.voice),"an exact copy keeps the original's words, not our voice");
  assert.ok(!playbookLib.HOUSE_RULES.some(rule=>exact.includes(rule)));
  assert.ok(playbookLib.COPY_RULES.every(rule=>exact.includes(rule)));
  assert.ok(exact.includes(english.followCta.line1));
  assert.ok(exact.includes(cards.DATA_RULE));
  assert.match(playbookLib.stagePrompt("review","autopilot",english,"","fact critic"),/^You are the fact critic/);
  assert.equal(playbookLib.stageCard("research","exact").title,"Quick check");
  assert.equal(playbookLib.stageCard("research","checkpoint").title,"Researcher");
});

test("each new role can run on its own model",()=>{
  assert.equal(claude.modelFor("designer"),"claude-opus-5-5");
  assert.equal(claude.modelFor("headline"),"claude-sonnet-5-5");
  environment.env.ENGINE_MODEL_DESIGNER="claude-sonnet-5-5";
  try { assert.equal(claude.modelFor("designer"),"claude-sonnet-5-5"); }
  finally { delete environment.env.ENGINE_MODEL_DESIGNER; }
});

// ── The dialog's job model ───────────────────────────────────────────────────
test("the dialog's job model lays out each mode's stages and reads the check",async()=>{
  const job=load("components/template-editor/recreate-job.ts");
  assert.deepEqual(job.lanesFor("autopilot").flatMap(lane=>lane.stages),posts.POST_STAGES);
  assert.deepEqual(job.lanesFor("exact").flatMap(lane=>lane.stages),["source","research","verdict","design","review"]);
  const ownerKey=owner(),crew=team({research:researching("ask")}),{file,done}=await start(ownerKey,crew,"checkpoint");
  await done;
  const original=globalThis.fetch;
  let body=jobs.postView(await read(ownerKey,file.id),false);
  globalThis.fetch=async()=>new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
  try {
    const asking=await job.fetchRecreateJob(file.id.slice(5));
    assert.deepEqual([asking.version,asking.status,asking.waiting],[2,"paused","verdict"]);
    assert.deepEqual([asking.verdict.outcome,asking.verdict.choice,asking.verdict.reason],["ask","ask",REASONS.ask]);
    assert.equal(asking.verdict.origin.found,false);
    assert.equal(asking.checkpoint,undefined);
    assert.deepEqual(asking.stages.map(stage=>stage.stage),posts.POST_STAGES);
    const yes=await orchestrator.answerRecreateVerdict(ownerKey,file.id,{choice:"proceed"},"human",options(crew));
    await yes.done;
    body=jobs.postView(await read(ownerKey,file.id),false);
    const planned=await job.fetchRecreateJob(file.id.slice(5));
    assert.equal(planned.waiting,"approval");
    assert.equal(planned.checkpoint.slides.length,4);
    assert.deepEqual(planned.checkpoint.slides[1],slide("original","The chart",{original:2,points:["Openings fell 29%"],chart:"S&P 500 against job openings, FRED"}),"a plan slide reads as the server sends it");
    assert.deepEqual([planned.checkpoint.lead,planned.checkpoint.performing,planned.checkpoint.hooks[0].by],["original",true,"original"]);
    body={...body,status:"stopped",waiting:undefined,checkpoint:undefined};
    assert.equal((await job.fetchRecreateJob(file.id.slice(5))).status,"stopped");
    body={jobId:file.id.slice(5),version:1,mode:"exact",status:"done",message:"",stages:[{stage:"transcript",title:"Exact copy",by:"agent",status:"done",summary:""},{stage:"deck",title:"Designer",by:"code",status:"done",summary:""}],result:{deckId:"earlier-deck",editorUrl:"",name:"Earlier",slideCount:3,factChecks:[{claim:"A",verdict:"corrected",detail:"",sources:[]}],notes:[]}};
    const earlier=await job.fetchRecreateJob(file.id.slice(5));
    assert.equal(earlier.version,1);
    assert.deepEqual(job.lanesOf(earlier,earlier.mode),[{title:"Earlier Recreate",stages:["transcript","deck"]}],"a first-team run lists its own stages");
    assert.equal(earlier.result.factChecks[0].verdict,"corrected");
  } finally { globalThis.fetch=original; }
});

test("a post added at the checkpoint goes on the last reaction slide with room, or on a new one before Follow",()=>{
  const job=load("components/template-editor/recreate-job.ts");
  const make=()=>({...slide("reaction","New"),key:"new"});
  const base=BRIEF.slides.map((item,index)=>({...item,key:`s${index}`}));
  let placed=job.placePost(base,"301",{slide:make});
  assert.deepEqual([placed.at,placed.created,placed.changed],[2,false,true],"the plan's two-post slide has room for a third");
  assert.deepEqual(placed.slides[2].reactionIds,["101","102","301"]);
  assert.equal(base[2].reactionIds.length,2,"the slides passed in are left as they were");
  const same=job.placePost(placed.slides,"102",{slide:make});
  assert.deepEqual([same.at,same.changed,same.slides],[2,false,placed.slides],"a post already on a slide stays where it is");
  placed=job.placePost(placed.slides,"302",{slide:make});
  assert.deepEqual([placed.at,placed.created],[3,true],"three posts is a full slide");
  assert.deepEqual(placed.slides.map(item=>item.kind),["cover","original","reaction","reaction","follow"],"a new reaction slide goes before Follow");
  assert.deepEqual([placed.slides[3].reactionIds,placed.slides[3].key],[["302"],"new"]);
  const full=Array.from({length:job.MAX_RECREATE_SLIDES},(_,index)=>({...base[0],key:`f${index}`}));
  assert.equal(job.placePost(full,"303",{slide:make}),null,"no room for another slide");
});
