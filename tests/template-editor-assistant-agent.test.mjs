/* Run: node --test tests/template-editor-assistant-agent.test.mjs
 * The Engine chat's answer loop against a scripted Claude: streamed text and
 * progress notes, tool calls, edits that go to the asker's editor (or into
 * the live room when no editor is there), the tool-call cap, refusals and
 * failures that leave a conversation Claude can continue, a long
 * conversation starting over from a summary, and the fixed system prompt and
 * tools with an append-only history that keep Claude's reasoning valid.
 * Local development storage only; no network. */
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
// The same Yjs build the loaded modules use.
const Y=nativeRequire("yjs");

function fixture(t,stubs={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-assistant-agent-test-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const environment={cwd:()=>directory,env:{NODE_ENV:"test",ANTHROPIC_API_KEY:"test-key"}};
  const calls={started:[],approved:[],saved:[]};
  const overrides={
    "@/lib/supabase/admin":{getAdminSupabase:()=>null},
    "@/lib/engine/agents/orchestrator":{
      startRecreate:async(ownerKey,input)=>{calls.started.push(input);return {file:{id:"post-11111111-2222-3333-4444-555555555555",mode:input.mode,profileId:input.profileId,status:"running"},done:Promise.resolve()};},
      approveRecreate:async(...args)=>{calls.approved.push(args);return {file:{status:"running"},done:Promise.resolve()};},
      rerunRecreateStage:async()=>({done:Promise.resolve()}),addRecreatePosts:async()=>({added:1,problems:[],done:Promise.resolve()}),isRunning:()=>true,
      ...stubs.orchestrator,
    },
    "@/lib/engine/agents/research":{photoSize:async()=>({width:1200,height:800})},
    "@/lib/engine/apify":stubs.apify??{searchXImages:async()=>[]},
    "@/lib/engine/brand-actions":{checkAgainstGuide:async()=>({brand:{name:"ChatGPTricks"},summary:"Fine",issues:[]})},
    "@/lib/engine/headline-model":{isHeadlineModelConfigured:()=>false,requestHeadlines:async()=>{throw new Error("unused");}},
    "@/lib/engine/image-curator":stubs.curator??{curateImages:async images=>images},
    "@/lib/engine/page-profiles":{listPageProfiles:async()=>[{id:"chatgptricks",name:"ChatGPTricks",handle:"chatgptricks",language:"en"}]},
    "@/lib/engine/recreate-jobs":{postView:(file)=>({jobId:file.id.slice(5),postId:file.id,mode:file.mode,status:"queued",message:"Starting",stages:[]})},
    "@/lib/engine/slide-render":{renderSlides:async()=>null},
    "@/lib/template-editor/persistence":stubs.persistence??{getCollaborationDocument:async()=>{throw new Error("This document is not available in the signed-in workspace.");}},
  };
  const cache=new Map();
  function load(relative) {
    const filename=path.join(root,relative);
    if(cache.has(filename))return cache.get(filename).exports;
    const unit={exports:{}};cache.set(filename,unit);
    const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX},fileName:filename,
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`,{filename})(name=>{
      if(Object.hasOwn(overrides,name))return overrides[name];
      const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
      if(local)return load(path.relative(root,[local+".ts",local+".tsx",local].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile())));
      return nativeRequire(name);
    },unit,unit.exports,environment);
    return unit.exports;
  }
  return {
    calls,load,
    agent:load("lib/engine/assistant/agent.ts"),threads:load("lib/engine/assistant/threads.ts"),
    tools:load("lib/engine/assistant/tools.ts"),decks:load("lib/template-editor/agent-decks.ts"),
    collab:load("lib/template-editor/collaboration-document.ts"),
  };
}

/** A scripted Claude: each request gets the next response, streamed block by block. */
function scripted(responses) {
  const requests=[];
  const client={beta:{messages:{stream(params){
    requests.push(structuredClone(params));
    const next=responses[requests.length-1];
    const response=typeof next==="function"?next(params,requests.length-1):next;
    if(!response)throw new Error(`No scripted response for request ${requests.length}`);
    if(response instanceof Error)throw response;
    const message={id:`msg_${requests.length}`,type:"message",role:"assistant",model:params.model,content:response.content,stop_reason:response.stop??"end_turn",usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:50,cache_creation_input_tokens:0}};
    const events=[{type:"message_start",message:{...message,content:[],stop_reason:null}}];
    message.content.forEach((block,index)=>{
      if(block.type==="text"){events.push({type:"content_block_start",index,content_block:{type:"text",text:""}});for(const piece of block.text.match(/.{1,7}/gs)??[])events.push({type:"content_block_delta",index,delta:{type:"text_delta",text:piece}});}
      else if(block.type==="thinking"){events.push({type:"content_block_start",index,content_block:{type:"thinking",thinking:"",signature:""}});if(block.thinking)events.push({type:"content_block_delta",index,delta:{type:"thinking_delta",thinking:block.thinking}});}
      // Like the API, a web search starts with no input and its words stream in after.
      else if(block.type==="server_tool_use"){events.push({type:"content_block_start",index,content_block:{...block,input:{}}});for(const piece of JSON.stringify(block.input).match(/.{1,5}/gs)??[])events.push({type:"content_block_delta",index,delta:{type:"input_json_delta",partial_json:piece}});}
      else events.push({type:"content_block_start",index,content_block:{...block,...(block.type==="tool_use"?{input:{}}:{})}});
      events.push({type:"content_block_stop",index});
    });
    events.push({type:"message_delta",delta:{stop_reason:message.stop_reason},usage:{output_tokens:20}},{type:"message_stop"});
    return {async *[Symbol.asyncIterator](){for(const event of events)yield event;},finalMessage:async()=>message};
  }}}};
  return {client,requests};
}
const text=value=>({type:"text",text:value});
const note=value=>({type:"thinking",thinking:value,signature:"sig"});
const use=(id,name,input)=>({type:"tool_use",id,name,input});
const person={id:"p1",name:"ivan",color:"#20805c"};

function ask(f,{scope={kind:"home",personId:"p1"},text:message="hi",client,events=[],applyInEditor,uploads=new Map(),attached=[],turn={where:scope.kind==="deck"?"editor":"library"},now=()=>new Date("2026-11-08T12:00:00Z")}={}) {
  return f.agent.answer({
    ownerKey:"owner",scope,person,text:message,attached,uploads,turn,emit:event=>events.push(event),
    ...(applyInEditor?{applyInEditor}:{}),keepAlive:()=>{},signal:new AbortController().signal,
  },{client:()=>client,tools:f.tools.CHAT_TOOLS,now});
}
/** A one-slide deck held in a stub live room. */
function liveRoom(f) {
  const document=f.decks.createAgentDeck({id:"deck-1",name:"AI vs Jobs",format:"portrait",slides:[{title:"AI is taking jobs fast",body:"Here is why"}]});
  let doc=f.collab.createCollaborationDocument(document);
  const saves=[];
  const persistence={
    getCollaborationDocument:async(owner,id)=>{assert.equal(id,"deck-1");return {document:f.collab.readCollaborationDocument(doc),state:f.collab.encodeCollaborationUpdate(Y.encodeStateAsUpdate(doc)),epoch:"00000000-0000-0000-0000-000000000001",version:1};},
    saveCollaborationDocument:async(owner,id,update)=>{saves.push(update);Y.applyUpdate(doc,f.collab.decodeCollaborationUpdate(update));return {document:f.collab.readCollaborationDocument(doc)};},
  };
  const title=f.decks.agentDeckView(document).slides[0].elements.find(element=>element.type==="text"&&element.text.startsWith("AI is"));
  return {document,persistence,saves,title,current:()=>f.collab.readCollaborationDocument(doc)};
}

test("a plain answer streams its text, is saved with the person's message, and keeps a valid conversation",async t=>{
  const f=fixture(t),{client,requests}=scripted([{content:[text("Hello! Paste a post link to start.")]}]),events=[];
  const saved=await ask(f,{client,events,text:"hola"});
  assert.equal(saved.status,"done");
  assert.deepEqual(saved.parts,[{type:"text",text:"Hello! Paste a post link to start."}]);
  assert.deepEqual(events.map(event=>event.type).filter((type,index,all)=>all.indexOf(type)===index),["message","reply","text","done"]);
  assert.equal(events.filter(event=>event.type==="text").map(event=>event.delta).join(""),"Hello! Paste a post link to start.");
  const thread=await f.threads.getThread("owner",{kind:"home",personId:"p1"});
  assert.deepEqual(thread.messages.map(message=>message.role),["person","assistant"]);
  assert.equal(thread.messages[0].author.name,"ivan");
  assert.equal(thread.conversation.messages.length,2);
  const [context,said]=thread.conversation.messages[0].content;
  assert.match(context.text,/^<context>\nAsked by: ivan\nTime: 2026-11-08 12:00 UTC\nWhere: the library/);
  assert.equal(said.text,"hola");
  assert.deepEqual(thread.usage,{inputTokens:150,outputTokens:20,replies:1});
  const request=requests[0];
  assert.equal(request.model,"claude-opus-5-5");
  assert.deepEqual(request.thinking,{type:"adaptive",display:"updates",block_binding:{prefix_mismatch_behavior:"drop_block"}});
  assert.ok(request.betas.includes("thinking-display-updates-2026-08-18")&&request.betas.includes("thinking-binding-controls-2026-08-01"));
  assert.deepEqual(request.cache_control,{type:"ephemeral"});
  assert.equal(request.system[0].text,f.agent.SYSTEM_PROMPT);
});

test("progress notes and tool calls show in order, and every request only adds to the last one",async t=>{
  const f=fixture(t),events=[];
  const {client,requests}=scripted([
    {content:[note(""),note("Checking which pages exist first."),use("t1","list_pages",{})],stop:"tool_use"},
    {content:[note("This part of the response was interrupted before it finished."),text("You have one page: ChatGPTricks.")]},
  ]);
  const saved=await ask(f,{client,events,text:"which pages do we have?"});
  assert.deepEqual(saved.parts.map(part=>part.type),["note","tool","text"]);
  assert.equal(saved.parts[0].text,"Checking which pages exist first.");
  assert.deepEqual(saved.parts[1],{type:"tool",id:"t1",name:"list_pages",label:"Checking the pages",done:"Checked the pages",status:"done",detail:"1 page"});
  assert.equal(requests.length,2);
  // Claude's earlier reasoning stays valid: same system and tools, and the history only grows.
  assert.deepEqual(requests[1].system,requests[0].system);
  assert.deepEqual(requests[1].tools,requests[0].tools);
  assert.deepEqual(requests[1].messages.slice(0,requests[0].messages.length),requests[0].messages);
  const [assistant,results]=requests[1].messages.slice(-2);
  assert.equal(assistant.role,"assistant");
  assert.deepEqual(assistant.content[1],note("Checking which pages exist first."),"thinking blocks go back unchanged");
  assert.equal(results.content[0].tool_use_id,"t1");
  assert.match(results.content[0].content,/chatgptricks/);
  // The next message adds to the same conversation, with its own context block.
  const next=scripted([{content:[text("Sure.")]}]);
  await ask(f,{client:next.client,text:"thanks"});
  const thread=await f.threads.getThread("owner",{kind:"home",personId:"p1"});
  assert.deepEqual(next.requests[0].messages.slice(0,requests[1].messages.length+1).slice(0,-1),requests[1].messages);
  assert.deepEqual(thread.conversation.messages.map(message=>message.role),["user","assistant","user","assistant","user","assistant"]);
});

test("steps say what they're doing and what came of it, web searches too, and the answer knows how long it worked",async t=>{
  const f=fixture(t),events=[];
  let clock=Date.parse("2026-11-08T12:00:00Z");
  const {client}=scripted([
    {content:[text("Checking the pages first."),use("t1","list_pages",{})],stop:"tool_use"},
    {content:[
      text("Now the source."),
      // Web search runs code that searches; the search is the step people see, not the code around it.
      {type:"server_tool_use",id:"c1",name:"code_execution",input:{code:"r = await web_search({\"query\": \"OpenAI revenue 2026\"})\nprint(r[:3])"}},
      {type:"server_tool_use",id:"s1",name:"web_search",input:{query:"OpenAI revenue 2026"},caller:{type:"code_execution_20260120",tool_id:"c1"}},
      {type:"web_search_tool_result",tool_use_id:"s1",content:[{type:"web_search_result",url:"https://a.com",title:"A"},{type:"web_search_result",url:"https://b.com",title:"B"}]},
      {type:"code_execution_tool_result",tool_use_id:"c1",content:{type:"code_execution_result",stdout:"",stderr:"",return_code:0,content:[]}},
      {type:"server_tool_use",id:"c2",name:"code_execution",input:{code:"print(len(r))"}},
      {type:"code_execution_tool_result",tool_use_id:"c2",content:{type:"code_execution_result",stdout:"2",stderr:"",return_code:0,content:[]}},
      {type:"server_tool_use",id:"s2",name:"web_fetch",input:{url:"https://www.example.com/news/story/"}},
      text("It's $13B."),
    ]},
  ]);
  const saved=await ask(f,{client,events,now:()=>new Date(clock+=4000)});
  const steps=Object.fromEntries(saved.parts.filter(part=>part.type==="tool").map(part=>[part.id,part]));
  assert.deepEqual(Object.keys(steps),["t1","s1","c2","s2"]);
  assert.deepEqual(steps.t1,{type:"tool",id:"t1",name:"list_pages",label:"Checking the pages",done:"Checked the pages",status:"done",detail:"1 page"});
  assert.deepEqual(steps.s1,{type:"tool",id:"s1",name:"web_search",label:'Searching the web for "OpenAI revenue 2026"',done:'Searched the web for "OpenAI revenue 2026"',status:"done",detail:"2 results"});
  assert.deepEqual(steps.c2,{type:"tool",id:"c2",name:"code_execution",label:"Going through the results",done:"Went through the results",status:"done"});
  assert.equal(steps.s2.label,"Reading example.com/news/story");
  assert.equal(steps.s2.status,"done","a step that never heard back stops spinning when the answer ends");
  const searchEvents=events.filter(event=>event.type==="tool"&&event.part.id==="s1").map(event=>event.part.label);
  assert.deepEqual(searchEvents,["Searching the web",'Searching the web for "OpenAI revenue 2026"','Searching the web for "OpenAI revenue 2026"'],"the search says what it's looking for once its words arrive");
  assert.ok(Date.parse(saved.doneAt)>Date.parse(saved.at));
  const stream=f.load("lib/engine/assistant/chat-stream.ts");
  assert.deepEqual(stream.answerItems(saved.parts).filter(item=>item.kind==="text").map(item=>[item.text,item.narration]),[["Checking the pages first.",true],["Now the source.",true],["It's $13B.",false]]);
});

test("edits go to the asker's editor as one change and come back with a card",async t=>{
  const room={};const f=fixture(t,{persistence:new Proxy({}, {get:(_,name)=>(...args)=>room.persistence[name](...args)})});
  Object.assign(room,liveRoom(f));
  const operations=[{op:"update_element",pageId:room.document.pages[0].id,elementId:room.title.id,properties:{text:"AI takes jobs"}}];
  const {client,requests}=scripted([
    {content:[use("t1","edit_post",{changes:["Slide 1 title shortened"],operations})],stop:"tool_use"},
    {content:[text("Shortened the title.")]},
  ]);
  const sent=[],events=[];
  const saved=await ask(f,{scope:{kind:"deck",deckId:"deck-1"},client,events,applyInEditor:async(ops,changes)=>{sent.push({ops,changes});return {applied:true};}});
  assert.equal(sent.length,1);
  assert.deepEqual(sent[0].ops,operations);
  assert.equal(room.saves.length,0,"nothing is saved on the server when the editor takes the edits");
  const card=saved.parts.find(part=>part.type==="card").card;
  assert.deepEqual({...card,id:"x"},{type:"edits",id:"x",changes:["Slide 1 title shortened"],applied:"editor"});
  assert.match(requests[1].messages.at(-1).content[0].content,/Done in their editor.*Cmd\+Z/);
  assert.match(events.find(event=>event.type==="reply").message.id,/^[0-9a-f-]{36}$/);
});

test("a bad edit changes nothing and tells Claude what to fix",async t=>{
  const room={};const f=fixture(t,{persistence:new Proxy({}, {get:(_,name)=>(...args)=>room.persistence[name](...args)})});
  Object.assign(room,liveRoom(f));
  const {client,requests}=scripted([
    {content:[use("t1","edit_post",{changes:["Title"],operations:[{op:"update_element",pageId:room.document.pages[0].id,elementId:"missing",properties:{text:"x"}}]})],stop:"tool_use"},
    {content:[text("I couldn't find that box.")]},
  ]);
  const sent=[];
  const saved=await ask(f,{scope:{kind:"deck",deckId:"deck-1"},client,applyInEditor:async ops=>{sent.push(ops);return {applied:true};}});
  assert.equal(sent.length,0);
  const result=requests[1].messages.at(-1).content[0];
  assert.equal(result.is_error,true);
  assert.match(result.content,/Nothing was changed.*operations\[0\]\.elementId: element was not found/);
  assert.equal(saved.parts.find(part=>part.type==="tool").status,"error");
});

test("with no editor to take them, edits go into the live room for everyone",async t=>{
  const room={};const f=fixture(t,{persistence:new Proxy({}, {get:(_,name)=>(...args)=>room.persistence[name](...args)})});
  Object.assign(room,liveRoom(f));
  const pageId=room.document.pages[0].id;
  const {client}=scripted([
    {content:[use("t1","edit_post",{changes:["Title","FREE in green"],operations:[
      {op:"update_element",pageId,elementId:room.title.id,properties:{text:"AI jobs are FREE"}},
      {op:"style_words",pageId,elementId:room.title.id,words:["FREE"],color:"#00D98A"},
    ]})],stop:"tool_use"},
    {content:[text("Done.")]},
  ]);
  const saved=await ask(f,{scope:{kind:"deck",deckId:"deck-1"},client,applyInEditor:async()=>({gone:true})});
  assert.equal(room.saves.length,1);
  const title=room.current().pages[0].canvas.elements.find(element=>element.id===room.title.id);
  assert.equal(title.text,"AI jobs are FREE");
  assert.match(title.richText,/AI jobs are <span style="color: #00d98a">FREE<\/span>/);
  assert.equal(saved.parts.find(part=>part.type==="card").card.applied,"server");
});

test("past 12 tool calls nothing more runs, Claude wraps up, and the next message continues cleanly",async t=>{
  const f=fixture(t);
  let counter=0;
  const {client,requests}=scripted(Array.from({length:20},(_,index)=>index===13?{content:[text("I did what I could.")]}:()=>({content:[use(`t${++counter}`,"list_pages",{})],stop:"tool_use"})));
  const saved=await ask(f,{client});
  assert.equal(saved.parts.filter(part=>part.type==="tool").length,12);
  assert.equal(requests.length,13,"twelve tool rounds, then one turn to wrap up");
  const thread=await f.threads.getThread("owner",{kind:"home",personId:"p1"});
  const last=thread.conversation.messages.at(-1);
  assert.equal(last.role,"user");
  assert.ok(last.content.every(block=>block.type==="tool_result"));
  assert.match(last.content[0].content,/Not run: this reply has used its 12 tool calls/);
  const next=scripted([{content:[text("ok")]}]);
  await ask(f,{client:next.client,text:"go on"});
  const messages=next.requests[0].messages;
  for(let index=1;index<messages.length;index++)assert.notEqual(messages[index].role,messages[index-1].role,"turns alternate");
  assert.equal(messages.at(-1).content.at(-1).text,"go on");
});

test("a refusal or an API failure is part of the answer, and the conversation stays usable",async t=>{
  const f=fixture(t),events=[];
  const refused=await ask(f,{client:scripted([{content:[text("")],stop:"refusal"}]).client,events});
  assert.equal(refused.status,"error");
  assert.equal(refused.error,"Claude declined to help with that.");
  assert.equal(events.at(-1).type,"error");
  const failed=await ask(f,{client:scripted([new Error("socket hang up")]).client});
  assert.equal(failed.status,"error");
  assert.match(failed.error,/Something went wrong/);
  const next=scripted([{content:[text("Back.")]}]);
  const back=await ask(f,{client:next.client,text:"again"});
  assert.equal(back.status,"done");
  const messages=next.requests[0].messages;
  for(let index=1;index<messages.length;index++)assert.notEqual(messages[index].role,messages[index-1].role);
});

test("a long conversation starts over from a summary of the chat",async t=>{
  const f=fixture(t);
  await f.threads.updateThread("owner",{kind:"home",personId:"p1"},thread=>{
    thread.messages.push({id:"a",at:"2026-11-08T10:00:00Z",role:"person",author:person,text:"Recreate the AI vs Jobs post"});
    for(let index=0;index<45;index++)thread.conversation.messages.push({role:index%2?"assistant":"user",content:[{type:"text",text:"x".repeat(10_000)}]});
  });
  const {client,requests}=scripted([
    (params)=>{assert.match(JSON.stringify(params.system),/summarize a chat/);assert.match(params.messages[0].content,/Recreate the AI vs Jobs post/);return {content:[text("They asked to recreate the AI vs Jobs post.")]};},
    {content:[text("Continuing.")]},
  ]);
  await ask(f,{client,text:"and now?"});
  const fresh=requests[1].messages;
  assert.equal(fresh.length,1);
  assert.match(fresh[0].content[0].text,/Earlier in this chat: They asked to recreate the AI vs Jobs post\./);
  const thread=await f.threads.getThread("owner",{kind:"home",personId:"p1"});
  assert.equal(thread.conversation.restarts,1);
  assert.equal(thread.conversation.summary,"They asked to recreate the AI vs Jobs post.");
  assert.equal(thread.messages.length,3,"the chat people see stays whole");
});

test("recreate_post passes attached screenshots to the run and shows a run card",async t=>{
  const f=fixture(t);
  const uploads=new Map([["upload-a",{name:"slide1.png",dataUrl:"data:image/png;base64,AAAA"}]]);
  const {client}=scripted([
    {content:[use("t1","recreate_post",{uploads:["upload-a"],page:"chatgptricks",mode:"checkpoint",notes:"keep the chart"})],stop:"tool_use"},
    {content:[text("Started.")]},
  ]);
  const saved=await ask(f,{client,uploads,attached:[{id:"upload-a",name:"slide1.png"}]});
  assert.deepEqual(f.calls.started,[{uploads:[{name:"slide1.png",dataUrl:"data:image/png;base64,AAAA"}],profileId:"chatgptricks",mode:"checkpoint",notes:"keep the chart"}]);
  const card=saved.parts.find(part=>part.type==="card").card;
  assert.equal(card.type,"run");
  assert.equal(card.postId,"post-11111111-2222-3333-4444-555555555555");
  const thread=await f.threads.getThread("owner",{kind:"home",personId:"p1"});
  assert.match(thread.conversation.messages[0].content[0].text,/Attached: upload-a "slide1\.png"/);
  // A later "approve with hook 2" acts on that run.
  const next=scripted([{content:[use("t2","approve_plan",{hook:2})],stop:"tool_use"},{content:[text("Approved.")]}]);
  await ask(f,{client:next.client,text:"you pick, use the second hook"});
  assert.equal(f.calls.approved[0][1],"post-11111111-2222-3333-4444-555555555555");
  assert.deepEqual(f.calls.approved[0][2],{option:1});
  assert.equal(f.calls.approved[0][3],"agent","a hook the agent chose is never sent as a person's pick");
});

test("tools refuse what they can't do with a message Claude can act on",async t=>{
  const f=fixture(t);
  const {client,requests}=scripted([
    {content:[use("t1","read_post",{}),use("t2","recreate_post",{link:"https://example.com/x",page:"chatgptricks",mode:"checkpoint"}),use("t3","nope",{}),use("t4","look_at_slides",{slides:[1,2,3,4]})],stop:"tool_use"},
    {content:[text("Sorry.")]},
  ]);
  await ask(f,{client});
  const [readPost,recreate,unknown,tooMany]=requests[1].messages.at(-1).content;
  assert.match(readPost.content,/No post is open in this chat/);
  assert.match(recreate.content,/Only instagram\.com post links/);
  assert.match(unknown.content,/There is no tool named nope/);
  assert.match(tooMany.content,/Invalid input: slides/);
  assert.ok([readPost,recreate,unknown,tooMany].every(result=>result.is_error));
});

test("photos the vision check looked at say what they show; the rest only carry their X post's text",async t=>{
  const found=[
    {id:"a",url:"https://pbs.twimg.com/a.jpg",source:"x",description:"Big day for markets"},
    {id:"b",url:"https://pbs.twimg.com/b.jpg",source:"x",description:"lol look at this"},
    {id:"c",url:"https://pbs.twimg.com/c.jpg",source:"x"},
  ];
  // As curateImages does: a photo it looked at comes back as a new copy with its own description, one it didn't comes back as it was.
  const curator={curateImages:async images=>[{...images[0],description:"Traders on the NYSE floor watching screens"},images[1],images[2]]};
  const f=fixture(t,{apify:{searchXImages:async()=>found},curator});
  const cards=[];
  const findPhotos=f.tools.CHAT_TOOLS.find(tool=>tool.name==="find_photos");
  const {content,detail}=await findPhotos.run({search:"NYSE trading floor"},{signal:new AbortController().signal,card:card=>cards.push(card)});
  const photos=JSON.parse(content).photos;
  assert.deepEqual(photos.map(({number,description,postText})=>({number,description,postText})),[
    {number:1,description:"Traders on the NYSE floor watching screens",postText:undefined},
    {number:2,description:undefined,postText:"lol look at this"},
    {number:3,description:undefined,postText:undefined},
  ]);
  assert.equal(detail,"3 photos");
  // The card keeps one description field for its labels.
  assert.deepEqual(cards[0].photos.map(photo=>photo.description),["Traders on the NYSE floor watching screens","lol look at this",undefined]);
});

test("an exact copy starts in exact mode without posts from X, and what it doesn't have is refused in plain words",async t=>{
  let RecreateError;
  const f=fixture(t,{orchestrator:{approveRecreate:async()=>{throw new RecreateError("An exact copy doesn't pause for approval: it copies the original as it is.",409);}}});
  RecreateError=f.load("lib/engine/agents/claude.ts").RecreateError;
  const definition=f.tools.chatToolDefinitions().find(tool=>tool.name==="recreate_post");
  assert.deepEqual(definition.input_schema.properties.mode.enum,["exact","checkpoint","autopilot"]);
  const {client,requests}=scripted([
    {content:[use("t1","recreate_post",{link:"https://www.instagram.com/p/DfUR7MxoA62/",page:"chatgptricks",mode:"exact",xPosts:["https://x.com/sama/status/1850000000000000000"]})],stop:"tool_use"},
    {content:[use("t2","approve_plan",{hook:1})],stop:"tool_use"},
    {content:[text("It's an exact copy, so there's no plan to approve.")]},
  ]);
  const saved=await ask(f,{client,text:"exact copy of this for chatgptricks"});
  assert.deepEqual(f.calls.started,[{url:"https://www.instagram.com/p/DfUR7MxoA62/",profileId:"chatgptricks",mode:"exact"}],"an exact copy has no reaction slides, so posts from X aren't passed on");
  const started=requests[1].messages.at(-1).content[0];
  assert.match(started.content,/^Started an exact copy for chatgptricks/);
  assert.match(started.content,/posts from X weren't used/);
  // The Recreate team's own refusal reaches Claude as it is, not as "That didn't work".
  const refused=requests[2].messages.at(-1).content[0];
  assert.equal(refused.is_error,true);
  assert.match(refused.content,/An exact copy doesn't pause for approval/);
  assert.equal(saved.parts.find(part=>part.type==="card").card.mode,"exact");
  assert.equal(saved.parts.find(part=>part.type==="tool"&&part.name==="recreate_post").done,"Started an exact copy for chatgptricks");
});
