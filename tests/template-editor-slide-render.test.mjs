/* Run: node --test tests/template-editor-slide-render.test.mjs
 * Server-side slide renderer: short-lived render tokens, the null fallback
 * when Chromium can't launch, budget and abort handling, and the page flow
 * with an injected browser. The real Chromium render only runs with
 * ENGINE_RENDER_SMOKE=1 while a dev server is up (ENGINE_RENDER_ORIGIN, or
 * localhost:$PORT, default 3000); set ENGINE_CHROMIUM_PATH if Playwright's
 * own Chromium build isn't installed. */
import test, {after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createHash} from "node:crypto";
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
const tokens=load("lib/engine/render-tokens.ts");
const render=load("lib/engine/slide-render.ts");
const decks=load("lib/template-editor/agent-decks.ts");
const deck=()=>decks.createAgentDeck({name:"Render test",templateId:"chatgptricks-3x4"});
const memory=()=>globalThis[Symbol.for("engine.render-tokens")];
const bridgeDirectory=path.join(os.tmpdir(),"engine-render-tokens",createHash("sha256").update(root).digest("hex").slice(0,24));
const bridgeFiles=()=>fs.existsSync(bridgeDirectory)?fs.readdirSync(bridgeDirectory).length:0;

test("render tokens are random, name one page and never carry document data",()=>{
  const document=deck(),pageId=document.pages[1].id;
  const token=tokens.createRenderToken({document,pageId});
  try {
    assert.match(token,/^[A-Za-z0-9_-]{43}$/,"32 random bytes, URL-safe");
    assert.ok(!token.includes(pageId)&&!token.includes(document.id));
    assert.notEqual(tokens.createRenderToken({document,pageId}),token);
    const entry=tokens.readRenderToken(token);
    assert.equal(entry.pageId,pageId);
    assert.deepEqual(entry.document,document);
    document.pages[1].label="Changed after the token";
    assert.notEqual(tokens.readRenderToken(token).document.pages[1].label,"Changed after the token","the token keeps a snapshot");
  } finally { tokens.revokeRenderToken(token); }
  assert.equal(tokens.readRenderToken(token),null,"revoked");
  assert.throws(()=>tokens.createRenderToken({document,pageId:"not-a-page"}),/not in this design/);
});

test("render tokens expire after two minutes and unknown tokens are rejected",()=>{
  const document=deck(),now=Date.now();
  const token=tokens.createRenderToken({document,pageId:document.pages[0].id,now});
  assert.ok(tokens.readRenderToken(token,now+tokens.RENDER_TOKEN_TTL_MS-1));
  assert.equal(tokens.RENDER_TOKEN_TTL_MS,120_000);
  assert.equal(tokens.readRenderToken(token,now+tokens.RENDER_TOKEN_TTL_MS),null,"expired");
  assert.equal(tokens.readRenderToken(token,now),null,"an expired token is removed, not revived");
  assert.equal(tokens.readRenderToken("A".repeat(43)),null,"unknown");
  for(const value of ["","short","../../etc/passwd","A".repeat(44),"A".repeat(42)+"/",null,undefined,42])assert.equal(tokens.readRenderToken(value),null);
});

test("outside production a token reaches a dev server in another process; production keeps it in memory",()=>{
  const document=deck(),pageId=document.pages[2].id,before=bridgeFiles();
  const token=tokens.createRenderToken({document,pageId});
  try {
    assert.equal(bridgeFiles(),before+1,"a private copy for the dev server");
    memory().delete(token);
    assert.equal(tokens.readRenderToken(token)?.pageId,pageId,"read back from the copy");
    const production=load("lib/engine/render-tokens.ts",{NODE_ENV:"production"});
    assert.equal(production.readRenderToken(token),null,"production never reads copies");
    const kept=production.createRenderToken({document,pageId});
    assert.equal(bridgeFiles(),before+1,"production never writes copies");
    assert.equal(production.readRenderToken(kept)?.pageId,pageId);
    production.revokeRenderToken(kept);
  } finally { tokens.revokeRenderToken(token); }
  assert.equal(bridgeFiles(),before,"revoking removes the copy");
});

test("the renderer uses an installed Chrome when Playwright's own Chromium isn't installed",async()=>{
  const calls=[],browser={};
  const missing=new Error("browserType.launch: Executable doesn't exist at /cache/ms-playwright/chrome-headless-shell\nmore details");
  const chromium=outcomes=>({launch:async options=>{calls.push(options);const next=outcomes.shift();if(next instanceof Error)throw next;return next;}});
  assert.equal(await render.launchChromium(chromium([missing,browser]),""),browser);
  assert.deepEqual(calls.map(options=>options.channel),[undefined,"chrome"]);
  assert.ok(calls.every(options=>options.headless===true));
  // A configured path is used as it is.
  calls.length=0;
  await assert.rejects(render.launchChromium(chromium([missing]),"/opt/chromium"),/Executable doesn't exist/);
  assert.deepEqual(calls.map(options=>options.executablePath),["/opt/chromium"]);
  // Other failures aren't retried, and with no Chrome either the first problem is reported.
  calls.length=0;
  await assert.rejects(render.launchChromium(chromium([new Error("Target page, context or browser has been closed")]),""),/has been closed/);
  assert.equal(calls.length,1);
  calls.length=0;
  await assert.rejects(render.launchChromium(chromium([missing,new Error("Chromium distribution 'chrome' is not found")]),""),/Executable doesn't exist/);
  assert.equal(calls.length,2);
});

test("renderSlides resolves null when Chromium can't launch and logs the reason once",async t=>{
  await render.closeSlideRenderer();
  const warn=t.mock.method(console,"warn",()=>{});
  let launches=0;
  const launch=async()=>{launches++;throw new Error("Executable doesn't exist at /nowhere/chrome\nmore details");};
  assert.equal(await render.renderSlides(deck(),{launch}),null);
  assert.equal(await render.renderSlides(deck(),{launch}),null);
  assert.equal(launches,1,"a failed launch is not retried on every call");
  assert.equal(warn.mock.callCount(),1);
  assert.match(warn.mock.calls[0].arguments[0],/Chromium could not launch.*Executable doesn't exist at \/nowhere\/chrome$/);
  await render.closeSlideRenderer();
});

test("renderSlides checks page ids, respects the signal and keeps to its budget",async()=>{
  await render.closeSlideRenderer();
  const document=deck();
  let launches=0;const launch=()=>{launches++;return new Promise(()=>{});};
  await assert.rejects(render.renderSlides(document,{pageIds:["missing"],launch}),/Page missing is not in this design/);
  assert.deepEqual(await render.renderSlides(document,{pageIds:[],launch}),[]);
  assert.equal(launches,0);
  const controller=new AbortController();controller.abort(new Error("Stopped by the critic"));
  await assert.rejects(render.renderSlides(document,{signal:controller.signal,launch}),/Stopped by the critic/);
  await assert.rejects(render.renderSlides(document,{launch,budgetMs:30}),/ran past its 0 s budget/);
  const later=new AbortController();setTimeout(()=>later.abort(new Error("Run cancelled")),20);
  await assert.rejects(render.renderSlides(document,{launch,signal:later.signal}),/Run cancelled/);
  await render.closeSlideRenderer();
});

function fakeBrowser({reloadOnce=false,exportRefused}={}) {
  const log={contexts:[],visits:[],routes:[],closed:0};
  const browser={
    isConnected:()=>true,on(){},async close(){log.closed++;},
    async newContext(options) {
      const handlers={};let reloaded=!reloadOnce;
      log.contexts.push(options);
      const main={};
      const tab={
        on:(event,handler)=>{handlers[event]=handler;},mainFrame:()=>main,
        async goto(url) {log.visits.push({url,entry:tokens.readRenderToken(url.split("/").pop())});handlers.framenavigated?.(main);return {ok:()=>true,status:()=>200};},
        locator:()=>({waitFor:async()=>{},screenshot:async options=>{log.shot=options;return Buffer.from(`png:${log.visits.at(-1).entry.pageId}`);}}),
        async evaluate(fn) {
          assert.equal(typeof fn,"function");
          if(!reloaded){reloaded=true;handlers.framenavigated?.(main);throw new Error("Execution context was destroyed, most likely because of a navigation.");}
          const {pageId}=log.visits.at(-1).entry;
          return {failed:[],exportError:pageId===exportRefused?"Shorten “Post text” before exporting: the text does not fit legibly.":null,missingFonts:true};
        },
        async waitForLoadState(){},
      };
      return {async route(match,handler){log.routes.push({match,handler});},async newPage(){return tab;},async close(){}};
    },
  };
  return {browser,log};
}

test("renderSlides opens each page's private render URL at output size, one page at a time",async t=>{
  await render.closeSlideRenderer();
  t.mock.method(console,"warn",()=>{});
  const document=deck(),pages=[document.pages[0].id,document.pages[3].id];
  const {browser,log}=fakeBrowser({reloadOnce:true,exportRefused:pages[1]});
  const result=await render.renderSlides(document,{pageIds:pages,launch:async()=>browser});
  assert.deepEqual(result.map(item=>item.pageId),pages);
  assert.equal(result[0].exportError,undefined);
  assert.match(result[1].exportError,/^Shorten “Post text” before exporting/,"Export's refusal comes back with the PNG");
  assert.equal(console.warn.mock.calls.filter(call=>/fallback fonts/.test(call.arguments[0])).length,1,"missing fonts are logged once");
  assert.deepEqual(result.map(item=>item.png.toString()),pages.map(id=>`png:${id}`));
  assert.deepEqual(log.contexts[0].viewport,{width:360,height:480});
  assert.equal(log.contexts[0].deviceScaleFactor,3,"360 CSS px × 3 = the 1080 px export");
  assert.equal(log.shot.scale,"device");
  assert.equal(log.visits.length,2,"a dev reload is waited out on the same page, not reopened");
  for(const [index,visit] of log.visits.entries()){
    assert.match(visit.url,/^http:\/\/localhost:3000\/engine\/render\/[A-Za-z0-9_-]{43}$/);
    assert.equal(visit.entry.pageId,pages[index],"the token is readable while the page renders");
    assert.equal(tokens.readRenderToken(visit.url.split("/").pop()),null,"and revoked right after");
  }
  // Only this origin's /api/ requests are intercepted; nothing but images comes back.
  const {match,handler}=log.routes[0];
  assert.equal(match(new URL("http://localhost:3000/api/template-editor/designs")),true);
  assert.equal(match(new URL("http://localhost:3000/_next/static/chunk.js")),false);
  assert.equal(match(new URL("https://images.example.com/api/photo.jpg")),false);
  const answer=async(url,method="GET",body=null)=>{let reply;await handler({request:()=>({url:()=>url,method:()=>method,postData:()=>body}),fulfill:async value=>{reply=value;},abort:async reason=>{reply={aborted:reason};}});return reply;};
  assert.equal((await answer("http://localhost:3000/api/template-editor/designs")).status,404,"workspace data is refused");
  assert.equal((await answer(`http://localhost:3000/api/template-editor/assets/${"a".repeat(64)}?maxDimension=1080`)).status,404,"private originals need the caller's ownerKey");
  assert.equal((await answer("http://localhost:3000/api/engine/img?u=file%3A%2F%2F%2Fetc%2Fpasswd")).status,404);
  assert.deepEqual(await answer("http://localhost:3000/api/engine/img?u=x","POST"),{aborted:"accessdenied"});
  // The export's dimension lookup for photos saved without them.
  const metadata=async body=>{const reply=await answer("http://localhost:3000/api/template-editor/assets/metadata","POST",body);return [reply.status,JSON.parse(reply.body.toString())];};
  assert.deepEqual(await metadata("not json"),[400,{error:"Choose an image."}]);
  assert.deepEqual(await metadata(JSON.stringify({src:`/api/template-editor/assets/${"b".repeat(64)}`})),[404,{error:"Image unavailable to the slide renderer."}]);
  assert.deepEqual(await metadata(JSON.stringify({src:"/api/template-editor/designs"})),[404,{error:"Image unavailable to the slide renderer."}]);
  await render.closeSlideRenderer();
  assert.equal(log.closed,1,"closeSlideRenderer closes the shared browser");
});

test("render origin: ENGINE_RENDER_ORIGIN, else localhost in development and 127.0.0.1 in production",()=>{
  assert.equal(load("lib/engine/slide-render.ts",{NODE_ENV:"development",PORT:"4123"}).renderOrigin(),"http://localhost:4123");
  assert.equal(load("lib/engine/slide-render.ts",{NODE_ENV:"production"}).renderOrigin(),"http://127.0.0.1:3000");
  assert.equal(load("lib/engine/slide-render.ts",{NODE_ENV:"production",ENGINE_RENDER_ORIGIN:"https://engine.example.com/"}).renderOrigin(),"https://engine.example.com");
});

const smokeEnv={NODE_ENV:"test",...Object.fromEntries(["ENGINE_RENDER_ORIGIN","ENGINE_CHROMIUM_PATH","PORT"].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))};
async function devServerUp() {
  if(process.env.ENGINE_RENDER_SMOKE!=="1")return false;
  try {await fetch(load("lib/engine/slide-render.ts",smokeEnv).renderOrigin(),{signal:AbortSignal.timeout(5000)});return true;} catch {return false;}
}
const smoke=await devServerUp();
test("real render of the @chatgptricks template through Chromium",{skip:smoke?false:"set ENGINE_RENDER_SMOKE=1 with a dev server running"},async()=>{
  const live=load("lib/engine/slide-render.ts",smokeEnv),sharp=nativeRequire("sharp");
  const template=load("lib/template-editor/model.ts").BUILT_IN_TEMPLATES.find(item=>item.id==="chatgptricks-3x4");
  const index=label=>{const found=decks.agentTemplatePages(template).find(page=>page.label===label);assert.ok(found,`${label} page`);return found.index;};
  const document=decks.createAgentDeck({name:"Render smoke",templateId:"chatgptricks-3x4",slides:[
    {templatePage:index("Cover"),slots:{"cover-headline":"AI WROTE HALF THE CODE AT GOOGLE THIS YEAR"}},
    {templatePage:index("Text + Media"),slots:{title:"The quiet takeover",body:"AI-written code went from a pilot\nto half of every new commit"}},
    {templatePage:index("Follow"),slots:{cta:"Follow for more AI news"}},
  ]});
  try {
    const result=await live.renderSlides(document);
    assert.ok(result,"Chromium launched (set ENGINE_CHROMIUM_PATH if Playwright's build is missing)");
    assert.deepEqual(result.map(item=>item.pageId),document.pages.map(page=>page.id));
    for(const item of result){
      const {width,height,format}=await sharp(item.png).metadata();
      assert.deepEqual([format,width,height],["png",1080,1440]);
      assert.equal(item.exportError,undefined,"Export accepts these pages");
      const {channels}=await sharp(item.png).stats();
      assert.ok(channels.some(channel=>channel.stdev>8),"the page has visible content");
    }
  } finally { await live.closeSlideRenderer(); }
});
