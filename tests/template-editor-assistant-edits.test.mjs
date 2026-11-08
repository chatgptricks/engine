/* Run: node --test tests/template-editor-assistant-edits.test.mjs
 * The chat's edits to an open post (deck operations plus coloring words in
 * a text box) and the answers running per thread (one at a time, a short
 * queue, a per-person hourly limit, edits the editor confirms). No network. */
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
function loader() {
  const cache=new Map();
  return function load(relative) {
    const filename=path.join(root,relative);
    if(cache.has(filename))return cache.get(filename).exports;
    const unit={exports:{}};cache.set(filename,unit);
    const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText;
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename})(name=>{
      const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
      if(local)return load(path.relative(root,[local+".ts",local].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile())));
      return nativeRequire(name);
    },unit,unit.exports);
    return unit.exports;
  };
}
const load=loader();
const edits=load("lib/engine/assistant/chat-edits.ts"),decks=load("lib/template-editor/agent-decks.ts"),replies=load("lib/engine/assistant/replies.ts");
const deck=()=>decks.createAgentDeck({id:"deck-1",name:"Free AI",format:"portrait",slides:[{title:"This AI is FREE for everyone & fast",body:"Body"},{title:"Second",body:"Two"}]});
const titleOf=(document,index=0)=>document.pages[index].canvas.elements.find(element=>element.type==="text"&&element.text!=="Body"&&element.text!=="Two");

test("style_words colors words inside a text box and keeps its text and the rest of its style",()=>{
  const document=deck(),title=titleOf(document);
  const next=edits.applyChatEdits(document,[{op:"style_words",pageId:document.pages[0].id,elementId:title.id,words:["FREE","& fast"],color:"#00D98A",bold:true}]);
  const styled=titleOf(next);
  assert.equal(styled.text,title.text);
  assert.equal(styled.color,title.color);
  assert.equal(styled.richText,'This AI is <span style="color: #00d98a; font-weight: 700">FREE</span> for everyone <span style="color: #00d98a; font-weight: 700">&amp; fast</span>');
  assert.equal(titleOf(document).richText===undefined||!titleOf(document).richText.includes("span"),true,"the original is untouched");
  const again=edits.applyChatEdits(next,[{op:"style_words",pageId:document.pages[0].id,elementId:title.id,words:["everyone"],color:"white"}]);
  assert.match(titleOf(again).richText,/<span style="color: white">everyone<\/span>/,"styles stack on earlier ones");
  assert.match(edits.applyChatEdits(document,[{op:"style_words",pageId:document.pages[0].id,elementId:title.id,words:["free"],color:"#fff"}]).pages[0].canvas.elements.find(element=>element.id===title.id).richText,/<span style="color: #fff">FREE<\/span>/,"a word in another case still matches");
});

test("template text with a fixed style takes colored words, like the page's own highlights, but not bold",()=>{
  const document=deck(),title=titleOf(document),pageId=document.pages[0].id;
  const fixed=structuredClone(document);titleOf(fixed).protected=["style"];
  const colored=edits.applyChatEdits(fixed,[{op:"style_words",pageId,elementId:title.id,words:["FREE"],color:"#00D98A"}]);
  assert.match(titleOf(colored).richText,/<span style="color: #00d98a">FREE<\/span>/);
  assert.equal(titleOf(colored).color,title.color,"the box's own color stays the template's");
  assert.throws(()=>edits.applyChatEdits(fixed,[{op:"style_words",pageId,elementId:title.id,words:["FREE"],bold:true}]),/\.bold: this text box's fonts are fixed by the template/);
  for(const lock of [{protected:["content"]},{locked:true},{templateRole:"brand"}]){
    const closed=structuredClone(document);Object.assign(titleOf(closed),lock);
    assert.throws(()=>edits.applyChatEdits(closed,[{op:"style_words",pageId,elementId:title.id,words:["FREE"],color:"#00D98A"}]),/element is locked or its text is protected/,JSON.stringify(lock));
  }
});

test("bad edits name the edit that failed, counted across the whole list, and change nothing",()=>{
  const document=deck(),title=titleOf(document),pageId=document.pages[0].id;
  assert.throws(()=>edits.applyChatEdits(document,[{op:"style_words",pageId,elementId:title.id,words:["missing"],color:"#fff"}]),/\$\.operations\[0\]\.words: "missing" isn't in that text box/);
  assert.throws(()=>edits.applyChatEdits(document,[{op:"style_words",pageId,elementId:title.id,words:["FREE"]}]),/requires color or bold/);
  assert.throws(()=>edits.applyChatEdits(document,[{op:"style_words",pageId,elementId:title.id,words:["FREE"],color:"red; background:url(x)"}]),/must be a hex color/);
  assert.throws(()=>edits.applyChatEdits(document,[
    {op:"rename",name:"New"},
    {op:"style_words",pageId,elementId:title.id,words:["FREE"],color:"#fff"},
    {op:"rename",name:"Newer"},
    {op:"update_element",pageId,elementId:"nope",properties:{text:"x"}},
  ]),/\$\.operations\[3\]\.elementId: element was not found/);
  assert.throws(()=>edits.applyChatEdits(document,[]),/send between 1 and 60 edits/);
  assert.equal(document.name,"Free AI");
});

test("deck operations and word styles apply in order, and the schema Claude sees has both",()=>{
  const document=deck(),title=titleOf(document),pageId=document.pages[0].id;
  const next=edits.applyChatEdits(document,[
    {op:"update_element",pageId,elementId:title.id,properties:{text:"Now FREE"}},
    {op:"style_words",pageId,elementId:title.id,words:["FREE"],color:"#00d98a"},
    {op:"move_slide",pageId:document.pages[1].id,index:0},
  ]);
  assert.equal(next.pages[1].id,pageId);
  assert.match(titleOf(next,1).richText,/Now <span style="color: #00d98a">FREE<\/span>/);
  const schema=edits.chatEditsSchema();
  const ops=schema.items.oneOf.map(variant=>variant.properties.op.const);
  assert.ok(ops.includes("update_element")&&ops.includes("style_words")&&ops.includes("caption"));
  assert.equal(schema.maxItems,60);
});

test("an attached photo goes in by its upload id",()=>{
  const uploads=new Map([["upload-1",{dataUrl:"data:image/png;base64,AAAA"}]]);
  assert.deepEqual(edits.withUploads([{op:"update_element",properties:{src:"upload:upload-1"}}],uploads),[{op:"update_element",properties:{src:"data:image/png;base64,AAAA"}}]);
  assert.throws(()=>edits.withUploads([{properties:{src:"upload:gone"}}],uploads),/isn't one of this chat's uploads/);
});

test("one answer at a time per thread, a short queue, and a limit per person",async()=>{
  const order=[];let release;
  const first=replies.enqueue("k1",()=>new Promise(resolve=>{order.push("first");release=resolve;}));
  const second=replies.enqueue("k1",async()=>{order.push("second");});
  assert.deepEqual([first.position,second.position],[0,1]);
  assert.equal(replies.isAnswering("k1"),true);
  replies.enqueue("k1",async()=>{});
  assert.throws(()=>replies.enqueue("k1",async()=>{}),/already waiting/);
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(order,["first"],"the second waits for the first");
  release();
  await second.done;
  assert.deepEqual(order,["first","second"]);
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(replies.isAnswering("k1"),false);
  const other=replies.enqueue("k2",async()=>{throw new Error("boom");});
  await assert.rejects(other.done,/boom/);
  assert.equal(replies.enqueue("k2",async()=>{}).position,0,"a failed answer frees the thread");
  const now=Date.now();
  for(let index=0;index<30;index++)replies.takeReply("person-a",now);
  assert.throws(()=>replies.takeReply("person-a",now),/30 messages in the last hour/);
  replies.takeReply("person-a",now+3601_000);
});

test("the editor confirms edits, and silence means it's gone",async()=>{
  const waiting=replies.waitForEditor("k3","ops-1",1000);
  assert.equal(replies.acknowledge("k3","ops-1",{applied:true}),true);
  assert.deepEqual(await waiting,{applied:true});
  assert.equal(replies.acknowledge("k3","ops-1",{applied:true}),false,"an edit is confirmed once");
  assert.deepEqual(await replies.waitForEditor("k3","ops-2",20),{gone:true});
  replies.rememberUploads("k4",[{id:"upload-1",name:"a.png",dataUrl:"data:image/png;base64,AAAA"}]);
  assert.equal(replies.uploadsOf("k4").get("upload-1").name,"a.png");
  assert.equal(replies.uploadsOf("k4",Date.now()+7*3600_000).size,0,"uploads are kept for a few hours");
});
