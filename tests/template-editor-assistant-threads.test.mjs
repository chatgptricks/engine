/* Run: node --test tests/template-editor-assistant-threads.test.mjs
 * The Engine chat's threads: a shared thread per post and a home thread per
 * person, revision-checked writes that never lose a parallel writer's change,
 * expiry, caps, and a browser view that never includes Claude's conversation.
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

function fixture(t,{production=false}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-assistant-threads-test-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const environment={cwd:()=>directory,env:{NODE_ENV:production?"production":"test"}};
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
      if(local)return load(path.relative(root,[local+".ts",local].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile())));
      return nativeRequire(name);
    },unit,unit.exports,environment);
    return unit.exports;
  }
  const storage=path.join(directory,".engine-dev","template-editor","assistant-threads");
  return {directory,storage,threads:load("lib/engine/assistant/threads.ts")};
}
const deck={kind:"deck",deckId:"design-123"};
const person={id:"ab12",name:"ivan",color:"#20805c"};
const say=(text)=>thread=>{thread.messages.push({id:`m-${thread.messages.length}`,at:new Date().toISOString(),role:"person",author:person,text});};

test("a post's thread is created on its first write, read back, and kept per owner and per post",async t=>{
  const {threads}=fixture(t);
  assert.equal(await threads.getThread("owner-a",deck),null);
  const saved=await threads.updateThread("owner-a",deck,say("Shorter title on slide 2"));
  assert.match(saved.id,/^thread-[0-9a-f-]{36}$/);
  assert.equal(saved.messages.length,1);
  assert.ok(Date.parse(saved.expiresAt)-Date.now()>89*864e5,"kept for 90 days after it was last used");
  const again=await threads.getThread("owner-a",deck);
  assert.equal(again.id,saved.id);
  assert.equal(again.messages[0].text,"Shorter title on slide 2");
  assert.equal(await threads.getThread("owner-b",deck),null,"another workspace can't read it");
  assert.equal(await threads.getThread("owner-a",{kind:"deck",deckId:"design-456"}),null,"another post has its own thread");
  assert.equal(await threads.getThread("owner-a",{kind:"home",personId:"ab12"}),null,"a person's home thread is separate");
});

test("parallel writers both land, and a reply's conversation only grows",async t=>{
  const {threads}=fixture(t);
  await threads.updateThread("owner-a",deck,say("first"));
  await Promise.all(["a","b","c","d"].map(text=>threads.updateThread("owner-a",deck,say(text))));
  const saved=await threads.getThread("owner-a",deck);
  assert.deepEqual(saved.messages.map(message=>message.text).sort(),["a","b","c","d","first"]);
  await threads.updateThread("owner-a",deck,thread=>{thread.conversation.messages.push({role:"user",content:"hi"},{role:"assistant",content:[{type:"text",text:"Hello"}]});});
  const grown=await threads.getThread("owner-a",deck);
  assert.equal(grown.conversation.messages.length,2);
  assert.ok(threads.conversationSize(grown)>10);
});

test("the browser's view leaves out Claude's conversation",async t=>{
  const {threads}=fixture(t);
  const saved=await threads.updateThread("owner-a",deck,thread=>{say("hi")(thread);thread.conversation.messages.push({role:"user",content:"secret context"});});
  const view=threads.threadView(saved,deck);
  assert.deepEqual(Object.keys(view).sort(),["id","messages","scope","updatedAt"]);
  assert.ok(!JSON.stringify(view).includes("secret context"));
  assert.deepEqual(threads.threadView(null,{kind:"home",personId:"ab12"}),{id:null,scope:{kind:"home"},messages:[],updatedAt:null},"a home thread's view doesn't name the person key");
});

test("an expired thread reads as new, and its row is replaced on the next write",async t=>{
  const {threads,storage}=fixture(t);
  const old=await threads.updateThread("owner-a",deck,say("old"));
  const [file]=fs.readdirSync(storage);
  const raw=JSON.parse(fs.readFileSync(path.join(storage,file),"utf8"));
  raw.expiresAt=new Date(Date.now()-1000).toISOString();
  fs.writeFileSync(path.join(storage,file),JSON.stringify(raw));
  assert.equal(await threads.getThread("owner-a",deck),null);
  const fresh=await threads.updateThread("owner-a",deck,say("new"));
  assert.notEqual(fresh.id,old.id);
  assert.deepEqual(fresh.messages.map(message=>message.text),["new"]);
  assert.equal(fs.readdirSync(storage).length,1,"the same row is reused");
});

test("caps: the oldest visible messages go first, and an oversized thread is refused",async t=>{
  const {threads}=fixture(t);
  await threads.updateThread("owner-a",deck,thread=>{for(let index=0;index<320;index++)say(`m${index}`)(thread);});
  const saved=await threads.getThread("owner-a",deck);
  assert.equal(saved.messages.length,threads.THREAD_LIMITS.maxMessages);
  assert.equal(saved.messages[0].text,"m20");
  await assert.rejects(threads.updateThread("owner-a",deck,thread=>{thread.conversation.messages.push({role:"user",content:"x".repeat(4_100_000)});}),/too large/);
  assert.equal((await threads.getThread("owner-a",deck)).conversation.messages.length,0,"a refused write changes nothing");
});

test("scopes and owners are validated, and production never writes local files",async t=>{
  const {threads}=fixture(t);
  await assert.rejects(threads.getThread("owner-a",{kind:"deck",deckId:"../etc/passwd"}),/isn't valid/);
  await assert.rejects(threads.getThread("owner-a",{kind:"other"}),/isn't valid/);
  await assert.rejects(threads.getThread("",deck),/owner is required/);
  const production=fixture(t,{production:true});
  await assert.rejects(production.threads.updateThread("owner-a",deck,say("hi")),/Cloud storage is not configured/);
});
