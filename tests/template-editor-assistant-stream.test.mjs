/* Run: node --test tests/template-editor-assistant-stream.test.mjs
 * The chat panel's side of the event stream: reading events however the
 * bytes arrive, and building the live answer the way the server saves it. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
function load(relative) {
  const filename=path.join(root,relative),unit={exports:{}};
  const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(nativeRequire,unit,unit.exports);
  return unit.exports;
}
const stream=load("lib/engine/assistant/chat-stream.ts");
const bytes=text=>new TextEncoder().encode(text);
function body(chunks) {
  return new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}});
}
async function read(chunks) {
  const events=[];
  await stream.readChatEvents(body(chunks),event=>events.push(event));
  return events;
}

test("events split anywhere, even inside a character, still arrive whole and in order",async()=>{
  const wire=bytes(`data: ${JSON.stringify({type:"text",delta:"Hola, ¿qué tal? 👋"})}\n\n: keep-alive\n\ndata: ${JSON.stringify({type:"note",text:"Reading the post"})}\n\n`);
  const whole=await read([wire]);
  assert.deepEqual(whole,[{type:"text",delta:"Hola, ¿qué tal? 👋"},{type:"note",text:"Reading the post"}]);
  for(const size of [1,2,3,7,13]){
    const chunks=[];
    for(let index=0;index<wire.length;index+=size)chunks.push(wire.slice(index,index+size));
    assert.deepEqual(await read(chunks),whole,`in ${size}-byte pieces`);
  }
});

test("keep-alives, broken lines and a last event without its blank line",async()=>{
  const events=await read([bytes(": keep-alive\n\ndata: {not json}\n\ndata: {\"no\":\"type\"}\n\ndata: {\"type\":\"done\",\"message\":{\"id\":\"a\"}}")]);
  assert.deepEqual(events,[{type:"done",message:{id:"a"}}]);
});

test("the live answer is built like the saved one: text runs, notes, tools by id, cards",()=>{
  let message={id:"reply",at:"",role:"assistant",parts:[],status:"running"};
  const apply=event=>{message=stream.withChatEvent(message,event);};
  apply({type:"note",text:"Checking the post"});
  apply({type:"tool",part:{type:"tool",id:"t1",name:"read_post",label:"Reading the post",status:"running"}});
  apply({type:"text",delta:"Done. "});
  apply({type:"text",delta:"Shorter now."});
  apply({type:"tool",part:{type:"tool",id:"t1",name:"read_post",label:"Reading the post",status:"done"}});
  apply({type:"card",card:{type:"edits",id:"e1",changes:["Shorter title"],applied:"editor"}});
  apply({type:"deck_ops",id:"x",operations:[],changes:[]});
  assert.deepEqual(message.parts.map(part=>part.type),["note","tool","text","card"]);
  assert.equal(message.parts[1].status,"done","a tool's later state replaces its first");
  assert.equal(message.parts[2].text,"Done. Shorter now.");
});

test("a finished answer folds its steps and narration away, and keeps its cards and its answer",()=>{
  const parts=[
    {type:"text",text:"Reading the post first."},
    {type:"tool",id:"t1",name:"read_post",label:"Reading the post",done:"Read the post",status:"done",detail:"6 slides"},
    {type:"text",text:"Making it "},{type:"text",text:"green."},
    {type:"tool",id:"t2",name:"edit_post",label:"Editing the post",done:"Edited the post",status:"done"},
    {type:"card",card:{type:"edits",id:"e1",changes:["WHOLE STORY green"],applied:"editor"}},
    {type:"text",text:"Done. "},{type:"text",text:"Cmd+Z undoes it."},
  ];
  const items=stream.answerItems(parts);
  assert.deepEqual(items.map(item=>[item.kind,item.key,item.kind==="text"?item.narration:null]),[
    ["text","part-0",true],["step","part-1",null],["text","part-2",true],["step","part-4",null],["card","part-5",null],["text","part-6",false],
  ]);
  assert.equal(items[2].text,"Making it green.");
  const {folded,shown}=stream.foldAnswer({id:"r",at:"",role:"assistant",status:"done",parts});
  assert.deepEqual(folded.map(item=>item.key),["part-0","part-1","part-2","part-4"]);
  assert.deepEqual(shown.map(item=>item.key),["part-5","part-6"],"the card keeps its key, so it keeps its state through the fold");
  assert.equal(shown[1].text,"Done. Cmd+Z undoes it.");
  const ended=stream.foldAnswer({id:"r",at:"",role:"assistant",status:"done",parts:parts.slice(0,5)});
  assert.deepEqual(ended.shown.map(item=>[item.key,item.narration]),[["part-2",false]],"an answer that ended on a step keeps its last words in view");
  assert.deepEqual(stream.foldAnswer({id:"r",at:"",role:"assistant",status:"error",parts:parts.slice(0,5)}).shown,[],"a failed one shows its error instead");
});

test("the live line names the step under way, then writing or thinking; times read the way people say them",()=>{
  const searching={type:"tool",id:"t",name:"find_photos",label:'Searching X for "NYSE"',status:"running"};
  assert.equal(stream.activityOf([]),"Thinking");
  assert.equal(stream.activityOf([{type:"text",text:"Looking for a photo."},searching]),'Searching X for "NYSE"');
  assert.equal(stream.activityOf([{...searching,status:"done"}]),"Thinking");
  assert.equal(stream.activityOf([{...searching,status:"done"},{type:"text",text:"Here"}]),"Writing");
  assert.deepEqual([0,999,8_400,65_000,120_000,600_000,659_000,3_725_000].map(stream.duration),["0s","0s","8s","1m 5s","2m","10m","10m","1h 2m"]);
});

test("the message shown while sending gives way to the saved one, once",()=>{
  const local={id:"local-1",role:"person",text:"hi"},saved={id:"m1",role:"person",text:"hi"};
  assert.deepEqual(stream.settleMessage([local],"local-1",saved),[saved]);
  assert.deepEqual(stream.settleMessage([saved,local],"local-1",saved),[saved],"already there from a reload");
  assert.deepEqual(stream.settleMessage([],"local-1",saved),[saved]);
  const reply={id:"r1",role:"assistant",parts:[]};
  assert.deepEqual(stream.upsertMessage([saved],reply),[saved,reply]);
  assert.deepEqual(stream.upsertMessage([saved,reply],{...reply,status:"done"}),[saved,{...reply,status:"done"}]);
});
