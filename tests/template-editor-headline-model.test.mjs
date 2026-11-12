/* Run: node --test tests/template-editor-headline-model.test.mjs
 * Recreate post, headline model client: the request bodies and auth header for
 * POST /v1/headlines and /v1/picks, response validation, and every failure a
 * person could hit (wrong key, server error, timeout, bad JSON, no options,
 * no key set), plus a check that the key never leaks into an error.
 * No network to the real service: fetch is injected, and redirects are
 * checked against a throwaway server on this machine. */
import test, {after, beforeEach} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import ts from "typescript";
// The code under test times out with AbortSignal.timeout, whose timer doesn't keep
// Node running. A real request holds the process open with its socket; these fakes
// hang on a bare promise, so Node 22 (CI) would exit and cancel the waiting tests.
// Hold the process open while this file runs, as a real request would.
const keepAlive=setInterval(()=>{},60_000);
after(()=>clearInterval(keepAlive));

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
function load(relative,env={NODE_ENV:"test"}) {
  const cache=new Map(),environment={cwd:()=>root,env};
  function requireModule(file) {
    const filename=path.join(root,file);
    if(cache.has(filename))return cache.get(filename).exports;
    const unit={exports:{}};cache.set(filename,unit);
    const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename,
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`,{filename})(name=>{
      const local=name.startsWith("@/")?path.join(root,name.slice(2)):name.startsWith(".")?path.resolve(path.dirname(filename),name):null;
      if(local)return requireModule(path.relative(root,[local+".ts",local+".tsx",local].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile())));
      return nativeRequire(name);
    },unit,unit.exports,environment);
    return unit.exports;
  }
  return requireModule(relative);
}

const KEY="hm-test-key-7f3a9c1e5b2d4086";
const DEFAULT_URL="https://ivand971217--headline-service-api.us-east.modal.run";
const env={NODE_ENV:"test"};
const headlines=load("lib/engine/headline-model.ts",env);
const {HeadlineModelError}=headlines;

beforeEach(()=>{
  env.HEADLINE_API_KEY=KEY;
  delete env.HEADLINE_API_URL;
});

const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json",...headers}});
function mockFetch(handler) {
  const calls=[];
  const fn=async(url,init)=>{calls.push({url,init,body:init?.body?JSON.parse(init.body):undefined});return handler(url,init,calls.length);};
  fn.calls=calls;
  return fn;
}
const serves=(body,status=200)=>mockFetch(()=>json(body,status));
const hangsUntilAborted=()=>mockFetch((url,init)=>new Promise((resolve,reject)=>{
  init.signal.addEventListener("abort",()=>reject(init.signal.reason),{once:true});
}));
async function failure(promise) {
  try {await promise;} catch(error) {return error;}
  assert.fail("expected the call to throw");
}
function assertTypedFailure(error,code,status) {
  assert.ok(error instanceof HeadlineModelError,`a HeadlineModelError, got ${error}`);
  assert.equal(error.code,code);
  assert.equal(error.status,status);
  assert.equal(error.name,"HeadlineModelError");
  assert.ok(error.message.length>20,"a plain-English message");
}
function assertNoKey(error) {
  for(const text of [error.message,String(error),error.stack,JSON.stringify(error),JSON.stringify(Object.getOwnPropertyDescriptors(error),(k,v)=>typeof v==="function"?undefined:v)])
    assert.ok(!String(text).includes(KEY),"the key never appears in an error");
}

const serviceReply={
  options:[
    {text:"OPENAI JUST RELEASED A MODEL THAT CODES FOR 24 HOURS STRAIGHT",framework:"story",sources:["v4-27b"]},
    {text:"JUST IN: OPENAI SHIPS A 24-HOUR CODING MODEL",framework:"breaking",sources:["v4-27b"]},
    {text:"  ",framework:"story",sources:["v4-27b"]},
    {text:"Original page line",framework:"original",sources:["original"]},
  ],
  recommended:{text:"OPENAI JUST RELEASED A MODEL THAT CODES FOR 24 HOURS STRAIGHT",framework:"story",sources:["v4-27b"]},
  framework:"story",why:"It is a human story with a held-back hook.",
  dropped:[{text:"OPENAI ADDS 99% FASTER CODING",why:"invented number"}],
  story:"OpenAI released a coding model that works for 24 hours.",
  note:"Best first.",
  research:{context:["OpenAI blog post"],unconfirmed:["24h claim"],sources:["https://openai.com"],read_post:true},
  original_check:{verdict:"light_edit",original:"Original page line",light_edit:"Original page line, tightened"},
};

test("isHeadlineModelConfigured follows HEADLINE_API_KEY",()=>{
  assert.equal(headlines.isHeadlineModelConfigured(),true);
  env.HEADLINE_API_KEY="   ";
  assert.equal(headlines.isHeadlineModelConfigured(),false);
  delete env.HEADLINE_API_KEY;
  assert.equal(headlines.isHeadlineModelConfigured(),false);
});

test("without a key both calls fail as not_configured and never touch the network",async()=>{
  delete env.HEADLINE_API_KEY;
  const fetch=serves(serviceReply);
  const written=await failure(headlines.writeHeadlines({story:"A story",originalHeadline:"",fetch}));
  assertTypedFailure(written,"not_configured",0);
  assert.match(written.message,/HEADLINE_API_KEY/);
  const saved=await failure(headlines.savePick({story:"A story",chosen:0,options:[{text:"A"}],fetch}));
  assertTypedFailure(saved,"not_configured",0);
  assert.equal(fetch.calls.length,0);
});

test("writeHeadlines posts the story to /v1/headlines with the Bearer key and follows redirects",async()=>{
  const fetch=serves(serviceReply);
  await headlines.writeHeadlines({story:"  OpenAI released a coding model.  ",url:" https://x.com/a/status/1 ",originalHeadline:" Original page line ",count:5,research:true,fetch});
  assert.equal(fetch.calls.length,1);
  const [{url,init,body}]=fetch.calls;
  assert.equal(url,`${DEFAULT_URL}/v1/headlines`);
  assert.equal(init.method,"POST");
  assert.equal(init.redirect,"follow");
  assert.equal(init.headers.Authorization,`Bearer ${KEY}`);
  assert.equal(init.headers["Content-Type"],"application/json");
  assert.deepEqual(body,{story:"OpenAI released a coding model.",url:"https://x.com/a/status/1",original_headline:"Original page line",count:5,research:true});
  assert.ok(!init.body.includes(KEY),"the key is only in the header");
});

test("writeHeadlines defaults to five options, no research, empty strings for what is missing",async()=>{
  const fetch=serves(serviceReply);
  await headlines.writeHeadlines({story:"Only a story",fetch});
  assert.deepEqual(fetch.calls[0].body,{story:"Only a story",url:"",original_headline:"",count:5,research:false});
  await headlines.writeHeadlines({url:"https://x.com/a/status/1",fetch});
  assert.deepEqual(fetch.calls[1].body,{story:"",url:"https://x.com/a/status/1",original_headline:"",count:5,research:false});
});

test("count is kept inside the service's 1 to 10",async()=>{
  const fetch=serves(serviceReply);
  for(const count of [0,-4,3.9,11,500,Number.NaN])await headlines.writeHeadlines({story:"S",count,fetch});
  assert.deepEqual(fetch.calls.map(call=>call.body.count),[1,1,3,10,10,5]);
});

test("a story or a link is required before any call is made",async()=>{
  const fetch=serves(serviceReply);
  for(const input of [{},{story:"   "},{story:"",url:" "}]) {
    assertTypedFailure(await failure(headlines.writeHeadlines({...input,fetch})),"invalid_input",0);
  }
  assert.equal(fetch.calls.length,0);
});

test("HEADLINE_API_URL replaces the default address, and a trailing slash is harmless",async()=>{
  env.HEADLINE_API_URL="https://headlines.example.test/base/";
  const fetch=serves(serviceReply);
  await headlines.writeHeadlines({story:"S",fetch});
  assert.equal(fetch.calls[0].url,"https://headlines.example.test/base/v1/headlines");
  const picks=serves({id:"p1"});
  await headlines.savePick({story:"S",chosen:0,options:[{text:"A"}],fetch:picks});
  assert.equal(picks.calls[0].url,"https://headlines.example.test/base/v1/picks");
});

test("the key is only sent over https, or to this machine",async()=>{
  const fetch=serves(serviceReply);
  for(const bad of ["http://headlines.example.test","ftp://headlines.example.test","not a url"]) {
    env.HEADLINE_API_URL=bad;
    assertTypedFailure(await failure(headlines.writeHeadlines({story:"S",fetch})),"not_configured",0);
  }
  assert.equal(fetch.calls.length,0);
  env.HEADLINE_API_URL="http://localhost:8787";
  await headlines.writeHeadlines({story:"S",fetch});
  env.HEADLINE_API_URL="http://127.0.0.1:8787";
  await headlines.writeHeadlines({story:"S",fetch});
  assert.deepEqual(fetch.calls.map(call=>call.url),["http://localhost:8787/v1/headlines","http://127.0.0.1:8787/v1/headlines"]);
});

test("writeHeadlines returns the options, best first, as plain {text, framework, sources}",async()=>{
  const options=await headlines.writeHeadlines({story:"S",fetch:serves(serviceReply)});
  assert.deepEqual(options,[
    {text:"OPENAI JUST RELEASED A MODEL THAT CODES FOR 24 HOURS STRAIGHT",framework:"story",sources:["v4-27b"]},
    {text:"JUST IN: OPENAI SHIPS A 24-HOUR CODING MODEL",framework:"breaking",sources:["v4-27b"]},
    {text:"Original page line",framework:"original",sources:["original"]},
  ]);
});

test("requestHeadlines also returns the checked story, recommendation, dropped lines and research",async()=>{
  const result=await headlines.requestHeadlines({story:"S",originalHeadline:"Original page line",fetch:serves(serviceReply)});
  assert.equal(result.options.length,3);
  assert.equal(result.story,"OpenAI released a coding model that works for 24 hours.");
  assert.equal(result.recommended.text,serviceReply.recommended.text);
  assert.equal(result.framework,"story");
  assert.match(result.why,/held-back hook/);
  assert.deepEqual(result.dropped,[{text:"OPENAI ADDS 99% FASTER CODING",why:"invented number"}]);
  assert.deepEqual(result.research,{context:["OpenAI blog post"],unconfirmed:["24h claim"],sources:["https://openai.com"],readPost:true});
  assert.deepEqual(result.originalCheck,{verdict:"light_edit",original:"Original page line",lightEdit:"Original page line, tightened"});
});

test("a minimal reply is enough; the story falls back to the one sent",async()=>{
  const result=await headlines.requestHeadlines({story:"  My story ",fetch:serves({options:[{text:"ONE LINE"}]})});
  assert.deepEqual(result,{options:[{text:"ONE LINE"}],story:"My story",dropped:[]});
});

test("savePick posts the pick to /v1/picks as client engine, with every option's writer",async()=>{
  const fetch=serves({id:"a1b2c3d4e5f6"});
  const options=[
    {text:"FIRST",framework:"story",sources:["v4-27b"]},
    {text:"SECOND",framework:"breaking",sources:["v4-27b","plain_rewrite"]},
    {text:"THIRD"},
  ];
  const saved=await headlines.savePick({story:"Checked story",chosen:1,finalText:"SECOND, edited",originalHeadline:"Page line",account:"chatgptricks",pickedBy:"ivan",options,fetch});
  assert.deepEqual(saved,{id:"a1b2c3d4e5f6"});
  const [{url,init,body}]=fetch.calls;
  assert.equal(url,`${DEFAULT_URL}/v1/picks`);
  assert.equal(init.method,"POST");
  assert.equal(init.redirect,"follow");
  assert.equal(init.headers.Authorization,`Bearer ${KEY}`);
  assert.deepEqual(body,{
    story:"Checked story",chosen:1,final_text:"SECOND, edited",original_headline:"Page line",account:"chatgptricks",picked_by:"ivan",client:"engine",
    options:[
      {text:"FIRST",sources:["v4-27b"],framework:"story"},
      {text:"SECOND",sources:["v4-27b","plain_rewrite"],framework:"breaking"},
      {text:"THIRD",sources:[],framework:""},
    ],
  });
});

test("savePick fills missing optional fields with empty strings, and -1 means none was good enough",async()=>{
  const fetch=serves({id:"x"});
  await headlines.savePick({story:"S",chosen:-1,options:[{text:"A"},{text:"B"}],fetch});
  assert.deepEqual(fetch.calls[0].body,{
    story:"S",chosen:-1,final_text:"",original_headline:"",account:"",picked_by:"",client:"engine",
    options:[{text:"A",sources:[],framework:""},{text:"B",sources:[],framework:""}],
  });
});

test("savePick refuses a choice that isn't one of the options, without calling the service",async()=>{
  const fetch=serves({id:"x"});
  for(const chosen of [-2,2,1.5,Number.NaN,"1",null,undefined]) {
    assertTypedFailure(await failure(headlines.savePick({story:"S",chosen,options:[{text:"A"},{text:"B"}],fetch})),"invalid_input",0);
  }
  assert.equal(fetch.calls.length,0);
});

test("resolvePick finds the index, treats empty text as none, and adds a human-written line as its own option",()=>{
  const options=[{text:"ONE",sources:["m"]},{text:"TWO",sources:["m"]}];
  assert.deepEqual(headlines.resolvePick(options,"TWO"),{options,chosen:1});
  assert.deepEqual(headlines.resolvePick(options,"  "),{options,chosen:-1});
  const own=headlines.resolvePick(options,"  My own hook ");
  assert.equal(own.chosen,2);
  assert.deepEqual(own.options,[...options,{text:"My own hook",sources:["human"]}]);
  assert.equal(options.length,2,"the original list is untouched");
});

test("a wrong key (401, 403) says so without repeating any key",async()=>{
  for(const status of [401,403]) {
    const fetch=serves({detail:`Missing or wrong team key (sent: Bearer ${KEY})`},status);
    const error=await failure(headlines.writeHeadlines({story:"S",fetch}));
    assertTypedFailure(error,"unauthorized",status);
    assert.match(error.message,/HEADLINE_API_KEY/);
    assertNoKey(error);
    const pick=await failure(headlines.savePick({story:"S",chosen:0,options:[{text:"A"}],fetch}));
    assertTypedFailure(pick,"unauthorized",status);
    assertNoKey(pick);
  }
});

test("server trouble is explained plainly, with the link detail when the service gives one",async()=>{
  const plain=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>new Response("Internal Server Error",{status:500}))}));
  assertTypedFailure(plain,"server",500);
  assert.match(plain.message,/error 500/);
  const html=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>new Response("<html>modal-http: internal error</html>",{status:503}))}));
  assertTypedFailure(html,"server",503);
  assert.ok(!html.message.includes("<html>"),"raw error pages are not repeated");
  const link=await failure(headlines.writeHeadlines({url:"https://x.com/a/status/1",fetch:serves({detail:"Couldn't read the link: 404"},502)}));
  assertTypedFailure(link,"server",502);
  assert.match(link.message,/Couldn't read the link: 404/);
  const slow=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>new Response("",{status:504}))}));
  assertTypedFailure(slow,"timeout",504);
  const busy=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>new Response("",{status:429}))}));
  assertTypedFailure(busy,"busy",429);
});

test("a rejected request surfaces the service's reason; a wrong address points at HEADLINE_API_URL",async()=>{
  const sentence=await failure(headlines.writeHeadlines({story:"S",fetch:serves({detail:"Send a story, a link, or both"},422)}));
  assertTypedFailure(sentence,"rejected",422);
  assert.match(sentence.message,/Send a story, a link, or both/);
  const list=await failure(headlines.savePick({story:"S",chosen:0,options:[{text:"A"}],fetch:serves({detail:[{type:"missing",loc:["body","story"],msg:"Field required",input:{secret:"x"}}]},422)}));
  assertTypedFailure(list,"rejected",422);
  assert.match(list.message,/story: Field required/);
  assert.ok(!list.message.includes("secret"),"echoed input is not repeated");
  const missing=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>new Response("Not Found",{status:404}))}));
  assertTypedFailure(missing,"rejected",404);
  assert.match(missing.message,/HEADLINE_API_URL/);
});

test("a service that echoes the key in its reason never gets it into the message",async()=>{
  for(const detail of [`bad key ${KEY}`,`Authorization: Bearer ${KEY}`]) {
    const error=await failure(headlines.writeHeadlines({story:"S",fetch:serves({detail},422)}));
    assertTypedFailure(error,"rejected",422);
    assertNoKey(error);
  }
});

test("the wait is 15 minutes for headlines, 5 for picks, and never more than 15",async()=>{
  const seen=[];
  const real=AbortSignal.timeout;
  AbortSignal.timeout=ms=>{seen.push(ms);return real.call(AbortSignal,ms);};
  try {
    await headlines.writeHeadlines({story:"S",fetch:serves(serviceReply)});
    await headlines.writeHeadlines({story:"S",timeoutMs:99_999_999,fetch:serves(serviceReply)});
    await headlines.writeHeadlines({story:"S",timeoutMs:30_000,fetch:serves(serviceReply)});
    await headlines.savePick({story:"S",chosen:0,options:[{text:"A"}],fetch:serves({id:"x"})});
    await headlines.savePick({story:"S",chosen:0,options:[{text:"A"}],timeoutMs:60_000_000,fetch:serves({id:"x"})});
  } finally {AbortSignal.timeout=real;}
  assert.equal(headlines.HEADLINE_MAX_TIMEOUT_MS,900_000);
  assert.deepEqual(seen,[900_000,900_000,30_000,300_000,900_000]);
});

test("a call that outlasts its wait fails as a timeout and the request is cancelled",async()=>{
  const fetch=hangsUntilAborted();
  const error=await failure(headlines.writeHeadlines({story:"S",timeoutMs:25,fetch}));
  assertTypedFailure(error,"timeout",0);
  assert.match(error.message,/try again/);
  assert.ok(fetch.calls[0].init.signal.aborted,"the request was aborted");
  const pick=await failure(headlines.savePick({story:"S",chosen:0,options:[{text:"A"}],timeoutMs:25,fetch:hangsUntilAborted()}));
  assertTypedFailure(pick,"timeout",0);
});

test("a reply that stalls halfway also times out",async()=>{
  const fetch=mockFetch((url,init)=>new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"options":'));
      init.signal.addEventListener("abort",()=>controller.error(init.signal.reason),{once:true});
    },
  }),{status:200}));
  assertTypedFailure(await failure(headlines.writeHeadlines({story:"S",timeoutMs:25,fetch})),"timeout",0);
});

test("the caller's signal cancels the call, even before it starts",async()=>{
  const controller=new AbortController();
  const fetch=hangsUntilAborted();
  const running=failure(headlines.writeHeadlines({story:"S",signal:controller.signal,fetch}));
  setTimeout(()=>controller.abort(),10);
  const error=await running;
  assertTypedFailure(error,"aborted",0);
  assert.ok(fetch.calls[0].init.signal.aborted);

  const early=new AbortController();
  early.abort();
  const never=serves(serviceReply);
  assertTypedFailure(await failure(headlines.savePick({story:"S",chosen:0,options:[{text:"A"}],signal:early.signal,fetch:never})),"aborted",0);
  assert.equal(never.calls.length,0);
});

test("a network failure is explained plainly, and a fetch that leaks the key in its own error does not leak it here",async()=>{
  const down=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>{throw new TypeError("fetch failed");})}));
  assertTypedFailure(down,"network",0);
  assert.match(down.message,/HEADLINE_API_URL/);
  const leaky=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>{
    const error=new TypeError(`Headers.append: "Bearer ${KEY}" is an invalid header value.`);
    error.cause=new Error(`Authorization: Bearer ${KEY}`);
    throw error;
  })}));
  assertTypedFailure(leaky,"network",0);
  assertNoKey(leaky);
  assert.equal(leaky.cause,undefined,"the original error is not attached");
});

test("malformed or unexpected replies fail as bad_response",async()=>{
  const replies=[
    new Response("this is not json",{status:200}),
    new Response("",{status:200}),
    new Response("<html>cold start page</html>",{status:200}),
    json({options:"nope"}),
    json({options:[{text:42}]}),
    json({nothing:true}),
    json([1,2,3]),
    json(null),
  ];
  for(const reply of replies) {
    const error=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>reply)}));
    assertTypedFailure(error,"bad_response",200);
  }
  for(const reply of [new Response("{oops",{status:200}),json({saved:true}),json({id:""}),json({id:7})]) {
    const error=await failure(headlines.savePick({story:"S",chosen:0,options:[{text:"A"}],fetch:mockFetch(()=>reply)}));
    assertTypedFailure(error,"bad_response",200);
  }
});

test("an empty options list (or only blank lines) is an error, not an empty result",async()=>{
  for(const options of [[],[{text:""},{text:"   "}]]) {
    const error=await failure(headlines.writeHeadlines({story:"S",fetch:serves({options,recommended:null,dropped:[{text:"x",why:"invented"}],story:"S"})}));
    assertTypedFailure(error,"empty",200);
    assert.match(error.message,/any headline options/);
  }
});

test("a reply bigger than the cap is refused, and the rest of it is never downloaded",async()=>{
  let pulled=0,cancelled=false;
  const fetch=mockFetch(()=>new Response(new ReadableStream({
    pull(controller) {pulled+=1;controller.enqueue(new Uint8Array(400_000).fill(32));},
    cancel() {cancelled=true;},
  }),{status:200}));
  const error=await failure(headlines.writeHeadlines({story:"S",fetch}));
  assertTypedFailure(error,"too_large",200);
  assert.ok(cancelled,"the stream was cancelled");
  assert.ok(pulled<=5,`stopped early (pulled ${pulled} chunks)`);

  const declared=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>new Response("{}",{status:200,headers:{"content-length":"5000000"}}))}));
  assertTypedFailure(declared,"too_large",200);

  const pick=await failure(headlines.savePick({story:"S",chosen:0,options:[{text:"A"}],fetch:mockFetch(()=>new Response(`{"id":"${"a".repeat(1_200_000)}"}`,{status:200}))}));
  assertTypedFailure(pick,"too_large",200);
});

test("a huge error page is capped too and its text is not repeated",async()=>{
  const error=await failure(headlines.writeHeadlines({story:"S",fetch:mockFetch(()=>new Response("x".repeat(2_000_000),{status:500}))}));
  assertTypedFailure(error,"server",500);
  assert.ok(error.message.length<300);
});

test("redirects are followed over real HTTP, the way Modal answers a long wait",async()=>{
  const seen=[];
  const server=http.createServer((req,res)=>{
    let body="";
    req.on("data",chunk=>{body+=chunk;});
    req.on("end",()=>{
      seen.push({method:req.method,url:req.url,auth:req.headers.authorization,body});
      if(req.method==="POST") {res.writeHead(303,{location:`/__modal/function-calls/${req.url.split("/").pop()}`});res.end();return;}
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify(req.url.endsWith("headlines")?{options:[{text:"AFTER THE WAKE-UP",framework:"story",sources:["v4-27b"]}],story:"S"}:{id:"picked123"}));
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  after(()=>server.close());
  env.HEADLINE_API_URL=`http://127.0.0.1:${server.address().port}`;

  const options=await headlines.writeHeadlines({story:"S"});
  assert.deepEqual(options,[{text:"AFTER THE WAKE-UP",framework:"story",sources:["v4-27b"]}]);
  assert.deepEqual(seen.map(item=>[item.method,item.url]),[["POST","/v1/headlines"],["GET","/__modal/function-calls/headlines"]]);
  assert.equal(seen[0].auth,`Bearer ${KEY}`);
  assert.equal(JSON.parse(seen[0].body).count,5);

  seen.length=0;
  assert.deepEqual(await headlines.savePick({story:"S",chosen:0,options}),{id:"picked123"});
  assert.deepEqual(seen.map(item=>[item.method,item.url]),[["POST","/v1/picks"],["GET","/__modal/function-calls/picks"]]);
});
