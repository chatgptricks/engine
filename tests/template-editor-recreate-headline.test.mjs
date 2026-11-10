/* Run: node --test tests/template-editor-recreate-headline.test.mjs
 * The headline stage of a full recreation (build step C) and the checkpoint's
 * helpers. The headline model writes options (ORIGINAL and EDIT among them),
 * the copywriter adds its own, and decision 1 sets the order: the original's
 * headline leads, word for word or faithfully translated, when the post
 * performs and its headline passed the check; a headline that failed is never
 * offered, and its light edit leads only once the copywriter says it fixes
 * what failed; otherwise the model's order. Covers the model not set up or
 * failing, the copywriter failing, Spanish pages, the role cards, the pick that
 * goes back for a person's choice only, and runs through the orchestrator with
 * the real brief and headline stages. Claude, the headline model and the
 * network are stand-ins: nothing calls /v1/headlines or /v1/picks. */
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
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-recreate-headline-test-"));
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

const stage=load("lib/engine/agents/stages/headline.ts");
const briefLib=load("lib/engine/agents/stages/brief.ts");
const headlineModel=load("lib/engine/headline-model.ts");
const claude=load("lib/engine/agents/claude.ts");
const schemas=load("lib/engine/agents/schemas.ts");
const headlineCard=load("lib/engine/agents/cards/headline.ts");
const approvalCard=load("lib/engine/agents/cards/approval.ts");
const cards=load("lib/engine/agents/cards/card.ts");
const playbookLib=load("lib/engine/agents/playbook.ts");
const orchestrator=load("lib/engine/agents/orchestrator.ts");
const posts=load("lib/engine/post-files.ts");
const jobs=load("lib/engine/recreate-jobs.ts");
const model=load("lib/template-editor/model.ts");
const profiles=load("lib/engine/page-profiles.ts");
const template=model.BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
const english=profiles.builtInPageProfiles().find(item=>item.id==="chatgptricks");
const spanish=profiles.builtInPageProfiles().find(item=>item.id==="pagina-es");
let owners=0;
const owner=()=>`owner-headline-${++owners}`;

// ── The original's headline, the model's lines and the copywriter's ─────────
const HEADLINE="STOCKS UP, JOBS DOWN";
const EDIT="STOCKS SOAR AS JOB OPENINGS FALL 29%";
const FAILED="AI KILLED 40% OF JOB OPENINGS";
const COPY_WHAT="write headline options with the headline engine";
function answer(original=HEADLINE,edit=EDIT) {
  return {
    options:[
      {text:"WALL STREET WON, WORKERS WAIT",framework:"story",sources:["model-v3"]},
      {text:original,framework:"original",sources:["original"]},
      {text:edit,framework:"story",sources:["light_edit"]},
      {text:"THE S&P 500 KEEPS CLIMBING. JOB OPENINGS DON'T",framework:"breaking",sources:["model-v3"]},
      {text:"Photo credit: Getty Images",framework:"story",sources:["model-v3"]},
    ],
    story:"Stocks rose while US job openings fell 29% from their 2022 peak.",dropped:[],
  };
}
function copy(extra={}) {
  return {
    archetype:"Contrast",original:{verdict:"keep",text:HEADLINE,why:"Strong already"},baseline:"Stocks rose while job openings fell.",
    hooks:[
      {text:"JOB OPENINGS FELL 29% AS STOCKS HIT RECORDS",framework:"Formula 1: Plain news",level:3},
      {text:"AI DIDN'T TAKE YOUR JOB YET",framework:"Formula 3: The Underdog",level:6},
      {text:"WALL STREET IS PARTYING WHILE HIRING STALLS",framework:"Formula 5: Contrast",level:8},
    ],
    topPick:1,why:"Clear stakes",modelEdit:null,...extra,
  };
}

// ── Claude, the headline model and the network, stood in for ───────────────
const calls={model:[],asks:[],works:[],picks:0};
let configured=true,modelAnswer=()=>answer(),asks={};
function reset() {
  calls.model.length=0;calls.asks.length=0;calls.works.length=0;calls.picks=0;
  configured=true;modelAnswer=()=>answer();asks={[COPY_WHAT]:()=>copy()};
}
headlineModel.isHeadlineModelConfigured=()=>configured;
headlineModel.requestHeadlines=async input=>{calls.model.push(input);return modelAnswer(input);};
headlineModel.writeHeadlines=async()=>{throw new Error("The stage asks through requestHeadlines");};
headlineModel.savePick=async()=>{calls.picks++;throw new Error("Only the orchestrator sends a person's pick, through its own savePick");};
claude.ask=async call=>{
  calls.asks.push(call);
  const reply=asks[call.what];
  if(!reply)throw new Error(`Nobody answers “${call.what}”`);
  return structuredClone(await reply(call));
};
claude.work=async call=>{calls.works.push(call);return briefDraft();};
const realFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error("Nothing here goes to the network");};
test.after(()=>{globalThis.fetch=realFetch;});

// ── The post file ────────────────────────────────────────────────────────────
const traction={likes:48210,comments:1200,views:null};
const xpost=(id,handle,text,likes)=>({id,url:`https://x.com/${handle}/status/${id}`,author:{name:handle.toUpperCase(),handle,avatarUrl:null,verified:false},text,createdAt:"2026-11-03T12:00:00.000Z",likes,reposts:10,replies:5,views:1000,why:"Clear take"});
const slide=(kind,purpose,extra={})=>({kind,purpose,points:[],original:null,chart:"",reactionIds:[],photo:"",...extra});
function templateNotes(headline=HEADLINE) {
  return {
    cover:{layout:"Headline over a full photo",headline:{text:headline,casing:"upper",lines:headline?[headline]:[],weight:"black",highlighted:[]},
      subject:{kind:"photo",what:"A trader at a screen",position:"behind the headline",size:"the whole slide"},background:"The photo",insets:[]},
    branding:["@otherpage watermark"],slides:[{index:1,role:"cover",layout:"Headline at the bottom"},{index:2,role:"chart",layout:"Title, chart, source"}],avoid:[],
  };
}
function notes(language="en",headline=HEADLINE) {
  return {
    post:{author:{handle:"otherpage",name:"Other Page"},format:"carousel",date:"2026-11-02",caption:"Stocks up, jobs down.",url:"https://www.instagram.com/p/abc/",traction},
    originalLanguage:language,shows:"A trader; a chart of stocks and job openings",claims:"Stocks rose while job openings fell",mismatch:"",template:templateNotes(headline),
    slides:[{index:1,role:"cover",texts:headline?[{role:"headline",text:headline}]:[],parts:[]},{index:2,role:"chart",texts:[{role:"title",text:"AI vs Jobs"}],parts:[]}],notes:[],
  };
}
function research(performing=true,extra={}) {
  return {
    quick:false,
    origin:{found:true,url:"https://www.bls.gov/jlt/",who:"BLS",date:"2026-10-07",note:"The JOLTS release"},
    surfaces:[{title:"Reuters",url:"https://www.reuters.com/markets/jobs",independent:true}],
    facts:[{claim:"Job openings fell 40%",label:"confirmed",detail:"JOLTS",correction:"Job openings fell 29% from their 2022 peak, not 40%",sources:[{title:"BLS JOLTS",url:"https://www.bls.gov/jlt/"}]}],
    worth:{traction:{post:traction,usual:{likes:20000,comments:500,views:null},ratio:performing?2.4:0.8,performing},fresh:{firstSeen:"2026-10-07",ageDays:3,stale:false},saturation:{note:"A few pages",saturated:false},covered:{already:false,by:[],note:""}},
    fabrication:[],positions:[],
    reactions:[xpost("101","alice","AI didn't take the jobs, rates did",5000),xpost("102","bob","Openings are back to 2019 levels",3000)],
    recommendation:{outcome:"proceed",reason:"Traced to the BLS release"},
    ...extra,
  };
}
function brief(headline=HEADLINE,extra={}) {
  return {
    topic:"AI and jobs",angle:"Your job search got harder",originalHeadline:headline,
    whatHappened:"Stocks rose while US job openings fell 29% from their 2022 peak.",backstory:"",positions:[],
    guardrails:{alleged:["AI caused the fall in openings, as some economists argue"],numbers:["Job openings fell 29% (BLS JOLTS)"],names:["S&P 500"],warnings:[]},
    template:templateNotes(headline),links:[{title:"The original: BLS",url:"https://www.bls.gov/jlt/"}],
    slides:[slide("cover","The headline",{original:1}),slide("original","The chart",{original:2}),slide("reaction","How X reacted",{reactionIds:["101"]}),slide("follow","Follow")],
    why:"The original, then reactions",...extra,
  };
}
/** A brief whose original headline failed the check: left out of the template notes, with why on avoid (./brief.ts). */
function failedBrief() {
  const planned=brief(FAILED);
  planned.template.cover.headline={...planned.template.cover.headline,text:"",lines:[],highlighted:[]};
  planned.template.avoid=[briefLib.headlineFailure(FAILED,{problem:"Openings fell 29%, not 40%",correction:"Job openings fell 29% from their 2022 peak"})];
  return planned;
}
/** What the editor hands in for the orchestrator runs: a headline that passed. */
function briefDraft() {
  return {
    topic:"AI and jobs",angle:"Your job search got harder",whatHappened:"Stocks rose while US job openings fell 29% from their 2022 peak.",backstory:"",
    guardrails:{alleged:[],numbers:["Job openings fell 29% (BLS JOLTS)"],names:["S&P 500"]},headline:{passes:true,problem:"",correction:""},avoid:[],
    slides:[slide("cover","The headline",{original:1}),slide("original","The chart",{original:2}),slide("question","Is it AI?"),slide("reaction","How X reacted",{reactionIds:["101","102"]}),slide("follow","Follow")],
    why:"The original, a question, then reactions",
  };
}

const done=output=>({status:"done",output,by:"engine",attempts:1});
const PASSED={outcome:"proceed",reason:"Traced to the BLS release",evidence:[],answer:null};
function fileWith({planned=brief(),noted=notes(),found=research()}={}) {
  return {
    id:"post-headline-test",version:2,profileId:"chatgptricks",mode:"checkpoint",status:"running",
    source:{url:"https://www.instagram.com/p/abc/",caption:"",notes:"",slideCount:2,imageIds:[]},
    stages:{source:done(noted),research:done(found),verdict:done(PASSED),brief:done(planned)},history:[],
  };
}
const contextFor=(file,profile=english,extra={})=>({ownerKey:"owner-headline",file,profile,template,templates:model.BUILT_IN_TEMPLATES,guide:null,signal:new AbortController().signal,usage:{add(){}},cache:{chartData:{}},round:0,...extra});
async function headlines(options={},profile=english) {
  const {output}=await stage.headline(contextFor(fileWith(options),profile));
  return schemas.HeadlinesSchema.parse(output);
}
const copywriter=()=>calls.asks.find(call=>call.what===COPY_WHAT);

// ── Decision 1 ───────────────────────────────────────────────────────────────
test("the post performs and its headline passed the check: the original leads word for word, then the model's lines, then the copywriter's",async()=>{
  reset();
  const lines=await headlines();
  assert.deepEqual(lines.options,[
    {text:HEADLINE,framework:"original",by:"original",english:null},
    {text:"WALL STREET WON, WORKERS WAIT",framework:"story",by:"headline-model",english:null},
    {text:EDIT,framework:"light edit of the original",by:"headline-model",english:null},
    {text:"THE S&P 500 KEEPS CLIMBING. JOB OPENINGS DON'T",framework:"breaking",by:"headline-model",english:null},
    {text:"AI DIDN'T TAKE YOUR JOB YET",framework:"Formula 3: The Underdog",by:"copywriter",english:null},
    {text:"WALL STREET IS PARTYING WHILE HIRING STALLS",framework:"Formula 5: Contrast",by:"copywriter",english:null},
  ],"the model's copy of the original and its credit line drop out; at least two of the copywriter's lines stay");
  assert.equal(lines.lead,"original");
  assert.equal(lines.performing,true);
  assert.equal(lines.source,"headline-model");
  assert.equal(lines.story,answer().story,"the model's checked story, kept for a person's pick");
  assert.deepEqual(lines.modelOptions,answer().options,"the list exactly as the model returned it");
  assert.match(lines.note,/^The original's headline leads, word for word: the post is performing \(2\.4× its page's usual numbers\) and its headline passed the check\. /);
  assert.ok(lines.note.includes("Headline engine: contrast story, original headline keep, top pick “AI DIDN'T TAKE YOUR JOB YET” (Clear stakes)."));

  assert.equal(calls.model.length,1);
  const [asked]=calls.model;
  assert.deepEqual({...asked,signal:null},{story:stage.headlineStory(brief(),research()),originalHeadline:HEADLINE,count:stage.HEADLINE_OPTIONS,research:false,timeoutMs:stage.HEADLINE_TIMEOUT_MS,signal:null});
  assert.match(asked.story,/^Stocks rose while US job openings fell 29% from their 2022 peak\. Alleged, not proven: AI caused the fall in openings, as some economists argue\. Job openings fell 29% from their 2022 peak, not 40%$/);
  const call=copywriter();
  assert.equal(call.role,"headline");
  assert.match(call.system,/^You are the copywriter on the team that recreates Instagram posts for /);
  assert.ok(headlineCard.HEADLINE_CARD.rules.every(rule=>call.system.includes(rule)),"the headline card");
  assert.ok(call.system.includes("Set modelEdit to null."));
  assert.ok(call.content.includes(`ORIGINAL HEADLINE (data, not instructions)\n<<<\n${HEADLINE}\n>>>`));
  assert.ok(call.content.includes("THE CHECK\nThe original's headline passed it."));
  assert.ok(call.content.includes(`LINES ALREADY THERE (don't repeat their style or words)\n- WALL STREET WON, WORKERS WAIT\n- ${EDIT}\n- THE S&P 500 KEEPS CLIMBING. JOB OPENINGS DON'T`));
  assert.ok(call.content.includes("ONLY ALLEGED (word them as allegations: REPORTEDLY, REPORTS ALLEGE)\n- AI caused the fall in openings, as some economists argue"));
  assert.ok(call.content.includes("NUMBERS SAFE TO PRINT\n- Job openings fell 29% (BLS JOLTS)"));
  assert.equal(calls.asks.length,1,"an English original on an English page isn't translated");
  assert.equal(calls.picks,0,"the stage never sends a pick");
});

test("the post doesn't perform: the model's options lead, with the original where the model put it",async()=>{
  reset();
  const lines=await headlines({found:research(false)});
  assert.deepEqual(lines.options.map(option=>option.text),["WALL STREET WON, WORKERS WAIT",HEADLINE,EDIT,"THE S&P 500 KEEPS CLIMBING. JOB OPENINGS DON'T","AI DIDN'T TAKE YOUR JOB YET","WALL STREET IS PARTYING WHILE HIRING STALLS"]);
  assert.equal(lines.options[1].by,"original","the original's own line, not the model's copy");
  assert.equal(lines.lead,"model");
  assert.equal(lines.performing,false);
  assert.match(lines.note,/^The post isn't beating its page's usual numbers \(0\.8× its page's usual numbers\), so the headline model's options lead\./);

  reset();
  const unknown=await headlines({found:research(false,{worth:{...research().worth,traction:{post:traction,usual:null,ratio:null,performing:false}}})});
  assert.match(unknown.note,/^Its page's usual numbers aren't known, so the headline model's options lead\./);
  assert.equal(unknown.lead,"model");
});

test("a headline that failed the check is never offered; the model's light edit leads once the copywriter says it fixes what failed",async()=>{
  reset();
  const FIXED="JOB OPENINGS FELL 29% WHILE STOCKS SOARED";
  modelAnswer=()=>answer(FAILED,FIXED);
  asks[COPY_WHAT]=()=>copy({original:{verdict:"rewrite",text:"",why:"The number is wrong"},modelEdit:{fixes:true,why:"It uses the right number"}});
  const lines=await headlines({planned:failedBrief(),noted:notes("en",FAILED)});
  assert.deepEqual(lines.options[0],{text:FIXED,framework:"light edit of the original",by:"headline-model",english:null});
  assert.ok(!lines.options.some(option=>option.by==="original"||option.text===FAILED),"never offered");
  assert.equal(lines.lead,"model");
  assert.equal(lines.performing,true);
  assert.match(lines.note,/^The original's headline failed the check \(Openings fell 29%, not 40%\. Correction: Job openings fell 29% from their 2022 peak\), so it isn't offered and its light edit leads\./);
  assert.equal(calls.model[0].originalHeadline,FAILED,"the model sees the original as it is, so it can edit it");
  const call=copywriter();
  assert.ok(call.content.includes("THE CHECK\nThe original's headline failed it: Openings fell 29%, not 40%. Correction: Job openings fell 29% from their 2022 peak."));
  assert.ok(call.content.includes(`THE HEADLINE MODEL'S LIGHT EDIT OF IT\n${FIXED}`));
  assert.ok(call.system.includes("never keep it as it is"));
  assert.ok(call.system.includes("say in modelEdit whether it fixes what failed"));
});

test("a light edit that keeps what failed is left out too, and so is one nobody could check",async()=>{
  reset();
  const STILL="AI CUT 40% OF JOB OPENINGS";
  modelAnswer=()=>answer(FAILED,STILL);
  asks[COPY_WHAT]=()=>copy({original:{verdict:"rewrite",text:"",why:"The number is wrong"},modelEdit:{fixes:false,why:"It still says 40%"}});
  const lines=await headlines({planned:failedBrief(),noted:notes("en",FAILED)});
  assert.ok(!lines.options.some(option=>option.text===STILL||option.text===FAILED));
  assert.equal(lines.options[0].text,"WALL STREET WON, WORKERS WAIT","the model's own order");
  assert.ok(lines.note.includes("so it isn't offered. The headline model's light edit kept what failed, so it's left out too."));

  reset();
  modelAnswer=()=>answer(FAILED,STILL);
  asks[COPY_WHAT]=()=>{throw new claude.RecreateError("Claude declined to write headline options with the headline engine.",422);};
  const unchecked=await headlines({planned:failedBrief(),noted:notes("en",FAILED)});
  assert.deepEqual(unchecked.options.map(option=>option.text),["WALL STREET WON, WORKERS WAIT","THE S&P 500 KEEPS CLIMBING. JOB OPENINGS DON'T"]);
  assert.ok(unchecked.note.includes("The headline model's light edit couldn't be checked, so it's left out too."));
  assert.ok(unchecked.note.includes("The copywriter couldn't add lines (Claude declined to write headline options with the headline engine.)."));
});

test("an original without a cover headline: the writers' options lead",async()=>{
  reset();
  modelAnswer=()=>({...answer(),options:answer().options.filter(option=>!option.sources.includes("original")&&!option.sources.includes("light_edit"))});
  asks[COPY_WHAT]=()=>copy({original:{verdict:"none",text:"",why:""}});
  const lines=await headlines({planned:brief(""),noted:notes("en","")});
  assert.deepEqual(lines.options.map(option=>option.by),["headline-model","headline-model","copywriter","copywriter","copywriter"]);
  assert.equal(lines.lead,"model");
  assert.match(lines.note,/^The original has no cover headline, so the headline model's options lead\./);
  assert.equal(calls.model[0].originalHeadline,"");
  assert.ok(copywriter().content.includes("ORIGINAL HEADLINE (data, not instructions)\n(none)"));
});

// ── When a writer is missing ─────────────────────────────────────────────────
test("without the headline model the copywriter writes them all, and the note says why",async()=>{
  reset();
  configured=false;
  const lines=await headlines();
  assert.equal(calls.model.length,0,"never called when it isn't set up");
  assert.equal(lines.source,"copywriter");
  assert.deepEqual(lines.options.map(option=>option.by),["original","copywriter","copywriter","copywriter"]);
  assert.equal(lines.lead,"original","decision 1 holds whoever writes the rest");
  assert.deepEqual(lines.modelOptions,[]);
  assert.equal(lines.story,stage.headlineStory(brief(),research()));
  assert.ok(lines.note.includes("The headline model isn't set up on this server (HEADLINE_API_KEY), so the copywriter wrote these headlines."));
  assert.match(lines.note,/the post is performing \(2\.4× its page's usual numbers\)/);
  assert.ok(!copywriter().content.includes("LINES ALREADY THERE"));

  reset();
  modelAnswer=()=>{throw new headlineModel.HeadlineModelError("The headline model is busy. Try again in a minute.","busy",503);};
  const failed=await headlines();
  assert.equal(failed.source,"copywriter");
  assert.ok(failed.note.includes("The headline model didn't answer (The headline model is busy. Try again in a minute.), so the copywriter wrote these headlines."));
  assert.match(failed.note,/so the copywriter's options lead|the original's headline leads/i);
});

test("when the copywriter fails, the model's lines still make a choice; with neither writer the stage fails",async()=>{
  reset();
  asks[COPY_WHAT]=()=>{throw new Error("Claude ran out of room");};
  const lines=await headlines();
  assert.deepEqual(lines.options.map(option=>option.text),[HEADLINE,"WALL STREET WON, WORKERS WAIT",EDIT,"THE S&P 500 KEEPS CLIMBING. JOB OPENINGS DON'T"]);
  assert.ok(lines.note.includes("The copywriter couldn't add lines (Claude ran out of room)."));

  reset();
  configured=false;
  asks[COPY_WHAT]=()=>{throw new Error("Claude ran out of room");};
  await assert.rejects(headlines(),/Claude ran out of room/);

  reset();
  const controller=new AbortController();
  modelAnswer=()=>{controller.abort();throw new headlineModel.HeadlineModelError("The request was stopped.","aborted");};
  await assert.rejects(stage.headline(contextFor(fileWith(),english,{signal:controller.signal})),/The request was stopped/,"a stopped run stops here too");
});

// ── Other languages ──────────────────────────────────────────────────────────
test("a Spanish page: the original's English headline is translated faithfully and leads; the model's lines are adapted",async()=>{
  reset();
  const TRANSLATED="LA BOLSA SUBE, EL EMPLEO BAJA";
  asks["translate the original's headline"]=()=>({text:TRANSLATED});
  asks["adapt the headlines to Spanish"]=()=>({hooks:[
    {english:"WALL STREET WON, WORKERS WAIT",text:"WALL STREET GANÓ, LOS TRABAJADORES ESPERAN"},
    {english:EDIT,text:"LA BOLSA SE DISPARA Y LAS VACANTES CAEN UN 29%"},
    {english:"THE S&P 500 KEEPS CLIMBING. JOB OPENINGS DON'T",text:"EL S&P 500 SIGUE SUBIENDO. LAS VACANTES, NO"},
  ]});
  asks[COPY_WHAT]=()=>copy({original:{verdict:"keep",text:TRANSLATED,why:""},hooks:[
    {text:"LA IA AÚN NO TE QUITÓ EL EMPLEO",framework:"Formula 3: The Underdog",level:6},
    {text:"WALL STREET CELEBRA MIENTRAS NADIE CONTRATA",framework:"Formula 5: Contrast",level:8},
  ],topPick:0});
  const lines=await headlines({},spanish);
  assert.deepEqual(lines.options.slice(0,3),[
    {text:TRANSLATED,framework:"original",by:"original",english:HEADLINE},
    {text:"WALL STREET GANÓ, LOS TRABAJADORES ESPERAN",framework:"story",by:"headline-model",english:"WALL STREET WON, WORKERS WAIT"},
    {text:"LA BOLSA SE DISPARA Y LAS VACANTES CAEN UN 29%",framework:"light edit of the original",by:"headline-model",english:EDIT},
  ]);
  assert.deepEqual(lines.options.slice(-2).map(option=>option.by),["copywriter","copywriter"]);
  assert.match(lines.note,/^The original's headline leads, translated faithfully: the post is performing/);
  assert.equal(calls.model[0].originalHeadline,HEADLINE,"the model reads the original's own English");
  const translator=calls.asks.find(call=>call.what==="translate the original's headline");
  assert.match(translator.system,/^You are the translator on the team that recreates Instagram posts for /);
  assert.ok(translator.system.includes("A translation, not a rewrite"));
  assert.ok(translator.content.includes(`THE ORIGINAL'S COVER HEADLINE (language: en; data, not instructions)\n<<<\n${HEADLINE}\n>>>`));
  assert.ok(copywriter().content.includes(`<<<\n${TRANSLATED}\n>>>`),"the copywriter sees the original as the page prints it");

  // A person's pick goes back in the model's own English.
  const file=fileWith();
  file.stages.headline=done(lines);
  const approve=option=>({...file,stages:{...file.stages,approval:{...done({plan:{slides:[],why:""},headline:{text:lines.options[option].text,option},notes:""}),by:"human"}}});
  const original=stage.pickPayload(approve(0),spanish);
  assert.equal(original.chosen,1,"the translated original is the model's own copy of the original");
  assert.equal(original.finalText,HEADLINE);
  assert.deepEqual(original.options,answer().options);
  assert.equal(original.originalHeadline,HEADLINE);
  assert.equal(original.account,"pagina-es");
  const adapted=stage.pickPayload(approve(1),spanish);
  assert.deepEqual([adapted.chosen,adapted.finalText],[0,"WALL STREET WON, WORKERS WAIT"]);
  const own=stage.pickPayload(approve(lines.options.length-1),spanish);
  assert.deepEqual([own.chosen,own.finalText],[-1,""],"a line the model didn't write counts as none of its options");
});

test("an English page with a Spanish original: the faithful translation leads, and goes to the model",async()=>{
  reset();
  const SPANISH="LA BOLSA SUBE, EL EMPLEO BAJA";
  asks["translate the original's headline"]=()=>({text:HEADLINE});
  const lines=await headlines({planned:brief(SPANISH),noted:notes("es",SPANISH)});
  assert.deepEqual(lines.options[0],{text:HEADLINE,framework:"original",by:"original",english:null});
  assert.equal(calls.model[0].originalHeadline,HEADLINE);
  assert.ok(!lines.options.slice(1).some(option=>option.text===HEADLINE),"the model's copy of it isn't offered twice");
  assert.match(lines.note,/translated faithfully/);

  reset();
  asks["translate the original's headline"]=()=>({text:"  "});
  await assert.rejects(headlines({planned:brief(SPANISH),noted:notes("es",SPANISH)}),/couldn't be translated/);
});

// ── The helpers ──────────────────────────────────────────────────────────────
test("lines that aren't headlines and near-duplicates drop out; each line knows what it is",()=>{
  const kept=stage.distinctHeadlines([
    {text:"JUST IN: OPENAI DROPS GPT-6"},{text:"OPENAI DROPS GPT-6"},{text:"Source: Reuters"},{text:"Image credit — AP"},
    {text:"Read more at https://example.com/story"},{text:"   "},{text:"GPT-6 IS HERE AND IT CODES"},
  ]);
  assert.deepEqual(kept.map(item=>item.text),["JUST IN: OPENAI DROPS GPT-6","GPT-6 IS HERE AND IT CODES"]);
  assert.equal(stage.modelKind({text:"A",sources:["light_edit"]},"B"),"edit");
  assert.equal(stage.modelKind({text:"A",framework:"original"},"B"),"original");
  assert.equal(stage.modelKind({text:"stocks up,  jobs down",sources:["model-v3"]},HEADLINE),"original","the same words as the original");
  assert.equal(stage.modelKind({text:"A",framework:"story"},"B"),"line");
  assert.deepEqual(stage.modelLines([{text:"Via: AP"},{text:" A LINE "}],"").map(line=>line.text),["A LINE"]);
});

test("the copywriter's lines: its top pick, then the 4-7 band, the boldest, the plain; lines that fit the cover first",()=>{
  const engine=copy({hooks:[
    {text:"PLAIN",framework:"F1",level:2},{text:"BAND",framework:"F2",level:5},{text:"BOLD",framework:"F3",level:9},
    {text:"TOP PICK THAT IS FAR TOO LONG",framework:"F4",level:6},{text:"BAND TWO",framework:"F5",level:7},
  ],topPick:3,original:{verdict:"light-edit",text:"STOCKS UP, HIRING DOWN",why:""}});
  assert.deepEqual(stage.copywriterLines(engine).map(line=>[line.text,line.kind]),[
    ["TOP PICK THAT IS FAR TOO LONG","line"],["BAND TWO","line"],["BAND","line"],["STOCKS UP, HIRING DOWN","edit"],["BOLD","line"],["PLAIN","line"],
  ]);
  assert.deepEqual(stage.copywriterLines(engine,22).map(line=>line.text).at(-1),"TOP PICK THAT IS FAR TOO LONG","too long for the cover: last");
  assert.equal(stage.copywriterLines({...engine,topPick:-1,original:{verdict:"keep",text:HEADLINE,why:""}})[0].kind,"original","the engine kept the original over its own lines");
});

test("decision 1, line by line",()=>{
  const line=(text,by,kind="line")=>({text,framework:"f",by,english:null,kind});
  const A="WALL STREET WON, WORKERS WAIT",B="THE S&P 500 KEEPS CLIMBING",C="AI DIDN'T TAKE YOUR JOB YET",D="HIRING STALLS AGAIN",E="JOB OPENINGS FELL 29% SINCE 2022";
  const model=[line(A,"headline-model"),line(B,"headline-model")],copied=[line(C,"copywriter")];
  const passes={text:HEADLINE,english:null,passes:true},fails={text:FAILED,english:null,passes:false};
  const texts=ordered=>ordered.options.map(option=>option.text);
  assert.deepEqual(texts(stage.orderHeadlines({original:passes,performing:true,model,copywriter:copied})),[HEADLINE,A,B,C]);
  assert.deepEqual(texts(stage.orderHeadlines({original:passes,performing:false,model,copywriter:copied})),[A,B,HEADLINE,C],"no model copy of it: after the model's lines");
  assert.deepEqual(texts(stage.orderHeadlines({original:fails,performing:true,model,copywriter:copied})),[A,B,C],"no light edit: the writers' order");
  const edited=stage.orderHeadlines({original:fails,performing:true,model:[...model,line(E,"headline-model","edit")],copywriter:copied});
  assert.deepEqual([texts(edited),edited.edit,edited.lead],[[E,A,B,C],true,"model"]);
  const kept=stage.orderHeadlines({original:fails,performing:false,model:[...model,line(E,"headline-model","edit")],copywriter:copied});
  assert.deepEqual([texts(kept),kept.edit],[[A,B,E,C],false],"not performing: the edit stays where the model put it");
  assert.deepEqual(texts(stage.orderHeadlines({original:passes,performing:true,model,copywriter:[line("JUST IN: STOCKS UP, JOBS DOWN","copywriter")]})),[HEADLINE,A,B],"a line that only repeats the original goes");
  assert.deepEqual(texts(stage.orderHeadlines({original:passes,performing:true,model:[...model,line(D,"headline-model")],copywriter:copied,max:3})),[HEADLINE,A,B]);
  assert.deepEqual(texts(stage.orderHeadlines({original:null,performing:true,model,copywriter:copied})),[A,B,C]);
});

test("the check and the story the headline model reads, both from the brief",()=>{
  assert.deepEqual(stage.originalCheck(brief(),notes()),{text:HEADLINE,passes:true,problem:""});
  assert.deepEqual(stage.originalCheck(failedBrief(),notes("en",FAILED)),{text:FAILED,passes:false,problem:"Openings fell 29%, not 40%. Correction: Job openings fell 29% from their 2022 peak"});
  assert.deepEqual(stage.originalCheck(brief(""),notes("en","")),{text:"",passes:false,problem:""});
  const long=brief(HEADLINE,{whatHappened:"x".repeat(2000)});
  assert.equal(stage.headlineStory(long,research()).length,1500);
  assert.equal(stage.headlineStory(brief(HEADLINE,{whatHappened:""}),undefined),"AI and jobs Alleged, not proven: AI caused the fall in openings, as some economists argue.");
  assert.equal(stage.coverRoom(template),79);
});

test("the checkpoint's helpers: autopilot, a person's choice and the pick for an English page",()=>{
  const options=[{text:"A".repeat(90),framework:"",by:"original",english:null},{text:"SHORT ONE",framework:"",by:"headline-model",english:null},{text:"SHORTER",framework:"",by:"copywriter",english:null}];
  assert.equal(stage.autopilotHeadline(options,79),1,"the first that fits the cover");
  assert.equal(stage.autopilotHeadline(options),0,"no room known: the first");
  assert.equal(stage.autopilotHeadline(options,5),2,"none fits: the shortest");
  assert.equal(stage.autopilotHeadline([],79),-1);
  assert.deepEqual(stage.chooseHeadline(options,{option:2}),{text:"SHORTER",option:2});
  assert.deepEqual(stage.chooseHeadline(options,{text:" SHORT ONE "}),{text:"SHORT ONE",option:1},"their words, matched to an option");
  assert.throws(()=>stage.chooseHeadline(options,{option:3}),/Pick one of the headline options/);
  assert.throws(()=>stage.chooseHeadline(options,{text:"X".repeat(201)}),/under 200 characters/);

  const lines={options:[{text:HEADLINE,framework:"original",by:"original",english:null},{text:"WALL STREET WON, WORKERS WAIT",framework:"story",by:"headline-model",english:null},{text:"AI DIDN'T TAKE YOUR JOB YET",framework:"Formula 3",by:"copywriter",english:null}],
    source:"headline-model",lead:"original",performing:true,story:"The model's story",modelOptions:[{text:"WALL STREET WON, WORKERS WAIT",framework:"story",sources:["model-v3"]}],note:""};
  const file=fileWith();
  file.stages.headline=done(lines);
  file.stages.approval={...done({plan:{slides:[],why:""},headline:{text:HEADLINE,option:0},notes:""}),by:"human"};
  const pick=stage.pickPayload(file,english);
  assert.deepEqual(pick.options.map(option=>option.sources),[["model-v3"],["original"],["engine-copywriter"]]);
  assert.deepEqual([pick.chosen,pick.finalText,pick.story,pick.account],[1,HEADLINE,"The model's story","chatgptricks"]);
  file.stages.approval.by="engine";
  assert.equal(stage.pickPayload(file,english),null,"autopilot's choice isn't a person's");
  file.stages.approval.by="human";
  file.stages.headline=done({...lines,source:"copywriter",modelOptions:[]});
  assert.equal(stage.pickPayload(file,english),null,"nothing to teach the model when it wrote nothing");
});

// ── The role cards ───────────────────────────────────────────────────────────
test("the headline and checkpoint cards",()=>{
  const card=headlineCard.HEADLINE_CARD,checkpoint=approvalCard.APPROVAL_CARD;
  assert.equal(playbookLib.stageCard("headline","checkpoint"),card);
  assert.equal(playbookLib.stageCard("approval","autopilot"),checkpoint);
  assert.deepEqual([card.title,card.by,checkpoint.title,checkpoint.by],["Headlines","headline","Checkpoint","human"]);
  assert.ok(card.rules.includes(cards.DATA_RULE));
  assert.ok(card.rules.some(rule=>rule.startsWith("Decision 1: when the post performs")));
  assert.ok(card.rules.some(rule=>rule.startsWith("A headline that failed the check is never offered")));
  assert.ok(card.rules.some(rule=>rule.includes("Only a person's pick goes back to the headline model")));
  assert.ok(checkpoint.rules.some(rule=>rule.includes("Only a person's pick goes back to the headline model")));
  const prompt=playbookLib.stagePrompt("headline","checkpoint",spanish,"","copywriter");
  assert.match(prompt,/^You are the copywriter on the team that recreates Instagram posts for /);
  assert.ok(prompt.includes("MÁS, not MAS"));
});

// ── Through the orchestrator ────────────────────────────────────────────────
const DESIGN={deckId:"recreate-headline-deck",name:"AI vs Jobs",slideCount:5,savedAt:"2026-11-08T00:00:00.000Z",caption:"Stocks up, jobs down.\n\nSource: BLS",pages:[],notes:[],held:""};
const REVIEW={round:0,rendered:false,checks:[],facts:null,design:null,sentBack:[]};
const crew={
  source:async()=>({output:notes()}),
  research:async()=>({output:research()}),
  design:async()=>({output:structuredClone(DESIGN)}),
  review:async()=>({output:structuredClone(REVIEW)}),
};
const runOptions=(extra={})=>({runners:crew,environment:async()=>({profile:english,template,templates:model.BUILT_IN_TEMPLATES}),...extra});
const start=(ownerKey,mode,extra)=>orchestrator.startRecreate(ownerKey,{profileId:"chatgptricks",url:"https://www.instagram.com/p/abc/",mode},runOptions(extra));

test("a checkpoint run with the real brief and headline stages pauses with the original first; only the person's pick reaches the headline model",async()=>{
  reset();
  const ownerKey=owner(),picks=[];
  const savePick=async input=>{picks.push(input);return {id:"pick-1"};};
  const {file,done:running}=await start(ownerKey,"checkpoint",{savePick});
  await running;
  const paused=await posts.getPostFile(ownerKey,file.id);
  assert.equal(paused.status,"paused",paused.message);
  assert.equal(paused.waiting,"approval");
  assert.equal(calls.works.length,1,"the editor handed in once");
  assert.equal(calls.model.length,1,"the headline model was asked once");
  const planned=schemas.StoryBriefSchema.parse(paused.stages.brief.output);
  assert.equal(planned.originalHeadline,HEADLINE);
  assert.deepEqual(planned.slides.map(item=>item.kind),["cover","original","question","reaction","follow"]);
  const lines=schemas.HeadlinesSchema.parse(paused.stages.headline.output);
  assert.equal(lines.lead,"original");
  const view=jobs.postView(paused,false);
  assert.deepEqual(view.checkpoint.hooks.options.slice(0,2).map(option=>option.by),["original","headline-model"]);
  assert.equal(view.checkpoint.hooks.lead,"original");
  assert.equal(view.checkpoint.hooks.performing,true);
  assert.match(view.stages.find(item=>item.stage==="headline").summary,/^6 headline options, the original's first from the headline model$/);
  assert.equal(picks.length,0,"nothing is sent before a person picks");

  const approved=await orchestrator.approveRecreate(ownerKey,file.id,{option:0},"human",runOptions({savePick}));
  await approved.done;
  const finished=await posts.getPostFile(ownerKey,file.id);
  assert.equal(finished.status,"done",finished.message);
  assert.deepEqual(finished.stages.approval.output.headline,{text:HEADLINE,option:0});
  assert.equal(picks.length,1,"one pick, for one person's choice");
  assert.deepEqual([picks[0].chosen,picks[0].finalText,picks[0].story,picks[0].originalHeadline],[1,HEADLINE,answer().story,HEADLINE],"the model's own copy of the original");
  assert.deepEqual(picks[0].options.slice(0,5),answer().options);
  assert.equal(calls.picks,0,"no stage sent a pick itself");
});

test("autopilot takes the first headline that fits, and sends no pick",async()=>{
  reset();
  const ownerKey=owner(),picks=[];
  const {file,done:running}=await start(ownerKey,"autopilot",{savePick:async input=>{picks.push(input);return {id:"x"};}});
  await running;
  const finished=await posts.getPostFile(ownerKey,file.id);
  assert.equal(finished.status,"done",finished.message);
  assert.deepEqual(finished.stages.approval.output.headline,{text:HEADLINE,option:0},"the original leads and fits the cover");
  assert.equal(finished.stages.approval.by,"engine");
  assert.equal(picks.length,0);
  assert.equal(calls.picks,0);
});
