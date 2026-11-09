/* Run: node --test tests/template-editor-post-files.test.mjs
 * The post file every Recreate agent shares: create, read, per-stage updates
 * with revision checks (parallel writers never lose each other's work),
 * expiry, size limits and which stages rerun after a change. Local
 * development storage only; no network. */
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
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-post-files-test-"));
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
  return {directory,posts:load("lib/engine/post-files.ts")};
}
const source={url:"https://www.instagram.com/p/abc/",caption:"Original caption",notes:"",slideCount:5,imageIds:[]};

test("a post file is created, read back, and kept per owner",async t=>{
  const {posts}=fixture(t);
  const file=await posts.createPostFile("owner-a",{profileId:"chatgptricks",mode:"checkpoint",source});
  assert.match(file.id,/^post-[0-9a-f-]{36}$/);
  assert.equal(file.status,"running");
  assert.deepEqual((await posts.getPostFile("owner-a",file.id)).source,source);
  assert.equal(await posts.getPostFile("owner-b",file.id),null,"another owner can't read it");
  assert.equal(await posts.getPostFile("owner-a","../etc/passwd"),null,"ids are validated");
  assert.ok(Date.parse(file.expiresAt)-Date.now()>29*864e5,"kept for 30 days");
});

test("parallel stages both land: each write retries on a newer revision",async t=>{
  const {posts}=fixture(t);
  const file=await posts.createPostFile("owner-a",{profileId:"chatgptricks",mode:"autopilot",source});
  await Promise.all(["source","research","brief","headline"].map(stage=>posts.updatePostFile("owner-a",file.id,next=>{
    posts.setStage(next,stage,{status:"done",output:{stage}});
  })));
  const saved=await posts.getPostFile("owner-a",file.id);
  assert.deepEqual(Object.keys(saved.stages).sort(),["brief","headline","research","source"]);
  assert.ok(Object.values(saved.stages).every(record=>record.status==="done"&&record.finishedAt&&record.by==="engine"));
  assert.equal(saved.history.filter(entry=>entry.stage!=="run").length,4);
  assert.notEqual(saved.revision,file.revision);
  await assert.rejects(posts.updatePostFile("owner-a","post-00000000-0000-0000-0000-000000000000",()=>{}),/doesn't exist/);
});

test("a rerun clears the old error and timing, and oversized files are refused",async t=>{
  const {posts}=fixture(t);
  const file=await posts.createPostFile("owner-a",{profileId:"chatgptricks",mode:"checkpoint",source});
  await posts.updatePostFile("owner-a",file.id,next=>posts.setStage(next,"design",{status:"error",error:"Claude declined"}));
  const rerun=await posts.updatePostFile("owner-a",file.id,next=>posts.setStage(next,"design",{status:"running",instructions:"Shorter headline"},"human","rerun"));
  assert.equal(rerun.stages.design.error,undefined);
  assert.equal(rerun.stages.design.instructions,"Shorter headline");
  assert.equal(rerun.stages.design.by,"human");
  await assert.rejects(posts.updatePostFile("owner-a",file.id,next=>posts.setStage(next,"research",{status:"done",output:"x".repeat(1_600_000)})),/too large/);
  assert.equal((await posts.getPostFile("owner-a",file.id)).stages.research,undefined,"a refused write changes nothing");
});

test("an expired post file reads as missing",async t=>{
  const {posts,directory}=fixture(t);
  const file=await posts.createPostFile("owner-a",{profileId:"chatgptricks",mode:"checkpoint",source});
  const folder=path.join(directory,".engine-dev","template-editor","post-files");
  const [name]=fs.readdirSync(folder);
  const raw=JSON.parse(fs.readFileSync(path.join(folder,name),"utf8"));
  fs.writeFileSync(path.join(folder,name),JSON.stringify({...raw,expiresAt:"2020-01-01T00:00:00.000Z"}));
  assert.equal(await posts.getPostFile("owner-a",file.id),null);
});

test("changing a stage reruns exactly the stages that read it, in each mode",t=>{
  const {posts}=fixture(t);
  assert.deepEqual(posts.downstreamOf("design"),["review"]);
  assert.deepEqual(posts.downstreamOf("approval"),["design","review"]);
  assert.deepEqual(posts.downstreamOf("brief"),["headline","approval","design","review"],"a new plan needs new headlines and a new approval");
  assert.deepEqual(posts.downstreamOf("research"),["verdict","brief","headline","approval","design","review"],"new research is checked again");
  assert.deepEqual(posts.downstreamOf("review"),[]);
  assert.deepEqual(posts.stagesFor("exact"),["source","research","verdict","design","review"]);
  assert.deepEqual(posts.downstreamOf("research","exact"),["verdict","design","review"]);
  assert.deepEqual(posts.downstreamOf("verdict","exact"),["design","review"]);
  assert.deepEqual(posts.inputsOf("brief","exact"),[],"an exact copy has no brief");
  for(const mode of ["checkpoint","autopilot","exact"]) {
    const stages=posts.stagesFor(mode);
    for(const stage of stages)for(const input of posts.inputsOf(stage,mode))assert.ok(stages.includes(input)&&stages.indexOf(input)<stages.indexOf(stage),`${stage} only reads earlier stages of a ${mode} run`);
  }
  assert.deepEqual(posts.legacyStagesFor("exact"),["transcript","data","deck","review"],"a version-1 exact copy keeps its own stages for showing");
  assert.equal(posts.legacyStagesFor("checkpoint").length,13);
});

test("production without cloud storage refuses to save",async t=>{
  const {posts}=fixture(t,{production:true});
  await assert.rejects(posts.createPostFile("owner-a",{profileId:"chatgptricks",mode:"checkpoint",source}),/Cloud storage is not configured/);
});
