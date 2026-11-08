/* Run: node --test tests/template-editor-page-profiles.test.mjs
 * Page profiles for "Recreate post": built-in defaults, validation, overrides,
 * per-owner storage (cloud CAS and local development files) and the route's
 * session/agent-token authentication. Only auth, env and Supabase are faked. */
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

function fakeDatabase() {
  const valueAt=(row,column)=>column.startsWith("data->>")?row?.data?.[column.slice(7)]:row?.[column];
  const rows=new Map();
  let writes=0;
  return {
    rows,
    get writes(){return writes;},
    from(table) {
      assert.equal(table,"gf_client_state");
      const conditions=new Map();
      let update;
      const query={
        abortSignal(){return query;},
        select(){return query;},
        eq(column,value){conditions.set(column,value);return query;},
        update(value){update=structuredClone(value);return query;},
        insert(value){
          return {abortSignal(){return this;},then(resolve,reject){return Promise.resolve().then(()=>{
            if(rows.has(value.owner))return {error:{code:"23505"}};
            rows.set(value.owner,structuredClone(value));writes++;
            return {error:null};
          }).then(resolve,reject);}};
        },
        async maybeSingle(){
          await new Promise(resolve=>setImmediate(resolve)); // Let concurrent writers interleave.
          const owner=conditions.get("owner"),row=rows.get(owner);
          if(update){
            if(!row||![...conditions].every(([column,value])=>valueAt(row,column)===value))return {data:null,error:null};
            rows.set(owner,{...row,...update});writes++;
            return {data:{owner},error:null};
          }
          return {data:row?structuredClone(row):null,error:null};
        },
      };
      return query;
    },
  };
}

function fixture(t,{db=fakeDatabase(),ownerKey="owner-a",production=false}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-page-profiles-test-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const environment={cwd:()=>directory,env:{NODE_ENV:production?"production":"test"}};
  let access=ownerKey?{kind:"owner",ownerKey}:null;
  const overrides={
    "@/lib/engine/member":{resolveEngineAccess:async()=>access},
    "@/lib/supabase/admin":{getAdminSupabase:()=>db},
    "server-only":{},
  };
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
      if(local){
        const target=[local,local+".ts",local+".tsx",path.join(local,"index.ts")].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
        if(!target)throw Error(`Unresolved local dependency ${name} from ${relative}`);
        return load(path.relative(root,target));
      }
      return nativeRequire(name);
    },unit,unit.exports,environment);
    return unit.exports;
  }
  return {
    db,directory,load,
    setOwner(owner){access=owner?{kind:"owner",ownerKey:owner}:null;},
    profiles:()=>load("lib/engine/page-profiles.ts"),
    route:()=>load("app/api/engine/page-profiles/route.ts"),
    agentAccess:()=>load("lib/template-editor/agent-access.ts"),
  };
}

const baseUrl="https://engine.example";
function request(method,{query="",body,raw,token,origin,headers={}}={}) {
  const all={"Content-Type":"application/json",...headers};
  if(token!==undefined)all.Authorization=`Bearer ${token}`;
  if(origin!==undefined)all.Origin=origin;
  return new Request(`${baseUrl}/api/engine/page-profiles${query}`,{method,headers:all,...(raw!==undefined?{body:raw}:body!==undefined?{body:JSON.stringify(body)}:{})});
}
const plain=value=>JSON.parse(JSON.stringify(value));
const rejectsProfile=async(promise,status,pattern)=>assert.rejects(promise,error=>{
  assert.equal(error.name,"PageProfileError",error.message);assert.equal(error.status,status,error.message);
  if(pattern)assert.match(error.message,pattern);return true;
});

test("built-in chatgptricks and Spanish example profiles ship with the briefed defaults",async t=>{
  const f=fixture(t),{listPageProfiles,getPageProfile}=f.profiles();
  const profiles=await listPageProfiles("owner-a");
  assert.deepEqual(profiles.map(profile=>profile.id),["chatgptricks","pagina-es"]);
  assert.equal(f.db.writes,0,"listing never writes");

  const en=await getPageProfile("owner-a","chatgptricks");
  assert.equal(en.handle,"@chatgptricks");
  assert.equal(en.language,"en");
  assert.equal(en.templateId,"chatgptricks-3x4");
  assert.deepEqual(plain(en.format),{noFinalPeriods:true,bodyMaxLines:2});
  assert.deepEqual(plain(en.followCta),{line1:"FOLLOW THIS PAGE",maxChars:21});
  assert.equal(en.swipeText,"SWIPE FOR MORE");
  assert.equal(en.builtIn,true);
  assert.equal(en.overridden,false);
  assert.match(en.voice,/2\.7M/);
  assert.match(en.voice,/no clickbait/i);
  assert.match(en.voice,/INSANE goes on a cover only when the story backs it up/,"hype words are allowed on covers the story backs up");
  assert.equal(en.brandId,"chatgptricks","the page follows the ChatGPTricks brand guide");
  const rules=en.rules.join("\n");
  for(const pattern of [/no final periods/i,/two lines/i,/75 characters/,/simple words/i,/primary source/i,/source line/i,/ALL CAPS/,/green/i,/one scale/i,/21 characters/,/fear-bait/i]) assert.match(rules,pattern);
  assert.ok(en.rules.every(rule=>!rule.endsWith(".")),"house style: no final periods in rules either");

  const es=await getPageProfile("owner-a","pagina-es");
  assert.equal(es.name,"Example Spanish page");
  assert.equal(es.handle,"@tu_pagina");
  assert.equal(es.language,"es");
  assert.equal(es.templateId,"chatgptricks-3x4");
  assert.deepEqual(plain(es.format),{noFinalPeriods:true,bodyMaxLines:2});
  assert.deepEqual(plain(es.followCta),{line1:"SIGUE ESTA PÁGINA",maxChars:21});
  assert.equal(es.swipeText,"DESLIZA PARA VER MÁS");
  const spanish=es.rules.join("\n");
  for(const pattern of [/no final periods/i,/two lines/i,/primary source/i,/ALL CAPS/,/one scale/i,/fear-bait/i,/adapt rather than translate/i,/US-only examples/i,/á é í ó ú ñ/,/¿/,/¡/]) assert.match(spanish,pattern);
  assert.equal(await getPageProfile("owner-a","missing"),null);
  assert.equal(await getPageProfile("owner-a","../etc"),null);
});

test("savePageProfile validates fields and lengths before any write",async t=>{
  const f=fixture(t),{savePageProfile}=f.profiles();
  const valid={id:"tech-es",name:"Tech ES",handle:"@tech_es",language:"es",voice:"Plain Spanish tech news."};
  const invalid=[
    ["not an object",400],
    [[valid],400],
    [{...valid,id:"Bad Id!"},400],
    [{...valid,id:"x".repeat(49)},400],
    [{...valid,language:"fr"},400],
    [{...valid,handle:"no spaces allowed"},400],
    [{...valid,handle:"@"+"a".repeat(31)},400],
    [{...valid,name:""},400],
    [{...valid,name:"n".repeat(81)},400],
    [{...valid,name:"Tab\tname"},400],
    [{...valid,voice:"v".repeat(2001)},400],
    [{...valid,voice:undefined},400],
    [{...valid,rules:"one rule"},400],
    [{...valid,rules:[42]},400],
    [{...valid,rules:["r".repeat(401)]},400],
    [{...valid,rules:Array.from({length:31},(_,i)=>`rule ${i}`)},400],
    [{...valid,format:{noFinalPeriods:"yes"}},400],
    [{...valid,format:{bodyMaxLines:0}},400],
    [{...valid,format:{bodyMaxLines:2.5}},400],
    [{...valid,format:{bodyMaxLines:7}},400],
    [{...valid,followCta:{maxChars:100}},400],
    [{...valid,followCta:{line1:""}},400],
    [{...valid,followCta:{line1:"L".repeat(41)}},400],
    [{...valid,swipeText:""},400],
    [{...valid,swipeText:"S".repeat(41)},400],
    [{...valid,templateId:"has spaces"},400],
    [{...valid,brandId:"Not An Id"},400],
    [{...valid,brandId:42},400],
  ];
  for(const [input,status] of invalid) await rejectsProfile(savePageProfile("owner-a",input),status);
  await assert.rejects(savePageProfile("owner-a",{...valid,language:"fr",handle:"bad handle",format:{bodyMaxLines:0}}),error=>error.issues.length===3&&/2 more issues/.test(error.message));
  await rejectsProfile(savePageProfile("",valid),401);
  assert.equal(f.db.writes,0);
});

test("custom pages get language defaults, a derived id, and can be listed, fetched and deleted",async t=>{
  const f=fixture(t),{savePageProfile,listPageProfiles,getPageProfile,deletePageProfile}=f.profiles();
  const saved=await savePageProfile("owner-a",{name:"Página Dos",handle:"pagina_dos",language:"es",voice:"  Spanish AI news.\nShort and plain.  ",rules:["Sin punto final",""," "],templateId:"my-template",brandId:"chatgptricks",ignored:"field"});
  assert.equal(saved.id,"pagina-dos");
  assert.equal(saved.brandId,"chatgptricks");
  assert.equal(saved.handle,"@pagina_dos");
  assert.equal(saved.voice,"Spanish AI news.\nShort and plain.");
  assert.deepEqual(plain(saved.rules),["Sin punto final"]);
  assert.deepEqual(plain(saved.followCta),{line1:"SIGUE ESTA PÁGINA",maxChars:21});
  assert.equal(saved.swipeText,"DESLIZA PARA VER MÁS");
  assert.deepEqual(plain(saved.format),{noFinalPeriods:true,bodyMaxLines:2});
  assert.equal(saved.ignored,undefined);
  assert.equal(saved.builtIn,false);
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
  const english=await savePageProfile("owner-a",{id:"aaa-tech",name:"AAA Tech",handle:"@aaa",language:"en",voice:"English AI news.",format:{noFinalPeriods:false,bodyMaxLines:3}});
  assert.deepEqual(plain(english.followCta),{line1:"FOLLOW THIS PAGE",maxChars:21});
  assert.deepEqual(plain(english.format),{noFinalPeriods:false,bodyMaxLines:3});

  assert.deepEqual((await listPageProfiles("owner-a")).map(profile=>profile.id),["chatgptricks","pagina-es","aaa-tech","pagina-dos"]);
  assert.equal((await getPageProfile("owner-a","pagina-dos")).name,"Página Dos");
  const edited=await savePageProfile("owner-a",{id:"pagina-dos",templateId:null,format:{bodyMaxLines:4}});
  assert.equal(edited.name,"Página Dos","fields left out keep their saved value");
  assert.equal(edited.templateId,undefined,"null clears the template");
  assert.equal(edited.brandId,"chatgptricks","fields left out keep their saved brand");
  assert.equal((await savePageProfile("owner-a",{id:"pagina-dos",brandId:null})).brandId,undefined,"null clears the brand");
  assert.deepEqual(plain(edited.format),{noFinalPeriods:true,bodyMaxLines:4});

  assert.equal(await deletePageProfile("owner-a","pagina-dos"),true);
  assert.equal(await getPageProfile("owner-a","pagina-dos"),null);
  assert.equal(await deletePageProfile("owner-a","pagina-dos"),false);
  assert.equal(await deletePageProfile("owner-a","Not An Id"),false);
  await rejectsProfile(savePageProfile("owner-a",{id:"new-page",name:"New",handle:"@new",language:"en"}),400,/voice is required/);
});

test("editing a built-in saves an override under page-profiles:<owner> and built-ins cannot be deleted",async t=>{
  const f=fixture(t),{savePageProfile,listPageProfiles,getPageProfile,deletePageProfile}=f.profiles();
  const override=await savePageProfile("owner-a",{id:"chatgptricks",templateId:"chatgptricks-4x5",format:{bodyMaxLines:3},rules:["Only this rule"]});
  assert.equal(override.builtIn,true);
  assert.equal(override.overridden,true);
  assert.equal(override.handle,"@chatgptricks","untouched fields come from the built-in");
  assert.deepEqual(plain(override.format),{noFinalPeriods:true,bodyMaxLines:3});
  const listed=await getPageProfile("owner-a","chatgptricks");
  assert.equal(listed.templateId,"chatgptricks-4x5");
  assert.deepEqual(plain(listed.rules),["Only this rule"]);
  assert.equal(listed.overridden,true);
  assert.equal((await getPageProfile("owner-b","chatgptricks")).templateId,"chatgptricks-3x4","other owners keep the defaults");
  assert.deepEqual((await listPageProfiles("owner-b")).map(profile=>profile.overridden),[false,false]);

  await rejectsProfile(deletePageProfile("owner-a","chatgptricks"),400,/can't be deleted/);
  await rejectsProfile(deletePageProfile("owner-a","pagina-es"),400);
  assert.equal((await getPageProfile("owner-a","chatgptricks")).overridden,true);

  assert.deepEqual([...f.db.rows.keys()],["page-profiles:owner-a"]);
  for(const key of f.db.rows.keys()) assert.equal(key.startsWith("template-editor:"),false);
  const stored=f.db.rows.get("page-profiles:owner-a").data;
  assert.equal(typeof stored.revision,"string");
  assert.deepEqual(plain(stored.profiles.chatgptricks.format),{noFinalPeriods:true,bodyMaxLines:3});
});

test("saved profiles without format get it filled in, and unreadable entries are skipped but preserved",async t=>{
  const db=fakeDatabase(),f=fixture(t,{db}),{listPageProfiles,getPageProfile,savePageProfile}=f.profiles();
  db.rows.set("page-profiles:owner-c",{owner:"page-profiles:owner-c",updated_at:"2026-11-01T00:00:00.000Z",data:{revision:"r1",profiles:{
    "legacy-es":{id:"legacy-es",name:"Legacy ES",handle:"@legacy",language:"es",voice:"Old save.",rules:["Regla"],followCta:{line1:"SÍGUENOS",maxChars:20},swipeText:"DESLIZA",updatedAt:"2026-10-01T00:00:00.000Z"},
    "chatgptricks":{id:"chatgptricks",name:"chatgptricks",handle:"@chatgptricks",language:"en",voice:"Override saved before format existed.",rules:[],followCta:{line1:"FOLLOW",maxChars:21},swipeText:"SWIPE"},
    "broken":{id:"broken",language:"de"},
  }}});
  const legacy=await getPageProfile("owner-c","legacy-es");
  assert.deepEqual(plain(legacy.format),{noFinalPeriods:true,bodyMaxLines:2});
  assert.equal(legacy.updatedAt,"2026-10-01T00:00:00.000Z");
  const override=await getPageProfile("owner-c","chatgptricks");
  assert.equal(override.voice,"Override saved before format existed.");
  assert.deepEqual(plain(override.format),{noFinalPeriods:true,bodyMaxLines:2});
  assert.equal(override.templateId,"chatgptricks-3x4","missing template comes from the built-in");
  assert.deepEqual((await listPageProfiles("owner-c")).map(profile=>profile.id),["chatgptricks","pagina-es","legacy-es"]);
  await savePageProfile("owner-c",{id:"another",name:"Another",handle:"@another",language:"en",voice:"Hi"});
  assert.deepEqual(plain(db.rows.get("page-profiles:owner-c").data.profiles.broken),{id:"broken",language:"de"},"never destroys data it can't read");

  db.rows.set("page-profiles:owner-d",{owner:"page-profiles:owner-d",data:{profiles:"garbage"}});
  await rejectsProfile(listPageProfiles("owner-d"),503,/could not be read/);
  await rejectsProfile(savePageProfile("owner-d",{id:"x-page",name:"X",handle:"@x",language:"en",voice:"v"}),503);
  assert.deepEqual(db.rows.get("page-profiles:owner-d").data,{profiles:"garbage"});
});

test("concurrent saves from separate server instances both land through revision checks",async t=>{
  const db=fakeDatabase(),one=fixture(t,{db}).profiles(),two=fixture(t,{db}).profiles();
  const page=id=>({id,name:id,handle:`@${id.replace(/-/g,"_")}`,language:"en",voice:"v"});
  await Promise.all([one.savePageProfile("owner-a",page("first-page")),two.savePageProfile("owner-a",page("second-page")),one.savePageProfile("owner-a",{id:"pagina-es",templateId:"es-template"})]);
  const ids=(await two.listPageProfiles("owner-a")).map(profile=>profile.id);
  assert.deepEqual(ids,["chatgptricks","pagina-es","first-page","second-page"]);
  assert.equal((await one.getPageProfile("owner-a","pagina-es")).templateId,"es-template");
});

test("local development storage keeps profiles in their own files, and production requires cloud storage",async t=>{
  const f=fixture(t,{db:null}),{savePageProfile,listPageProfiles,deletePageProfile}=f.profiles();
  await savePageProfile("owner-a",{id:"local-page",name:"Local",handle:"@local",language:"es",voice:"v"});
  await savePageProfile("owner-a",{id:"chatgptricks",swipeText:"SWIPE"});
  const folder=path.join(f.directory,".engine-dev","template-editor","page-profiles");
  const files=fs.readdirSync(folder);
  assert.equal(files.length,1);
  assert.match(files[0],/^[a-f0-9]{64}\.json$/);
  const saved=JSON.parse(fs.readFileSync(path.join(folder,files[0]),"utf8"));
  assert.deepEqual(Object.keys(saved.profiles).sort(),["chatgptricks","local-page"]);
  assert.equal(fs.readdirSync(path.join(f.directory,".engine-dev","template-editor")).filter(name=>name.endsWith(".json")).length,0,"editor library files are untouched");
  assert.deepEqual((await listPageProfiles("owner-a")).map(profile=>profile.id),["chatgptricks","pagina-es","local-page"]);
  assert.deepEqual((await listPageProfiles("owner-b")).map(profile=>profile.id),["chatgptricks","pagina-es"]);
  assert.equal(await deletePageProfile("owner-a","local-page"),true);

  const production=fixture(t,{db:null,production:true}).profiles();
  await rejectsProfile(production.listPageProfiles("owner-a"),503,/Cloud storage is not configured/);
});

test("the route serves signed-in people and agent tokens, scoped to their owner",async t=>{
  const f=fixture(t),route=f.route();
  const listed=await route.GET(request("GET"));
  assert.equal(listed.status,200);
  assert.equal(listed.headers.get("cache-control"),"private, no-store");
  assert.deepEqual((await listed.json()).profiles.map(profile=>profile.id),["chatgptricks","pagina-es"]);

  const created=await route.PUT(request("PUT",{origin:baseUrl,body:{profile:{name:"Mi Página",handle:"@mi_pagina",language:"es",voice:"Plain."}}}));
  assert.equal(created.status,200,await created.clone().text());
  assert.equal((await created.json()).profile.id,"mi-pagina");
  const bare=await route.PUT(request("PUT",{body:{id:"chatgptricks",templateId:"other-template"}}));
  assert.equal((await bare.json()).profile.overridden,true);
  const one=await route.GET(request("GET",{query:"?id=mi-pagina"}));
  assert.equal((await one.json()).profile.handle,"@mi_pagina");
  assert.equal((await route.GET(request("GET",{query:"?id=nope"}))).status,404);

  const invalid=await route.PUT(request("PUT",{body:{profile:{id:"bad-page",name:"Bad",handle:"@bad",language:"fr",voice:"v"}}}));
  assert.equal(invalid.status,400);
  assert.deepEqual((await invalid.json()).issues,['language must be "en" or "es".']);
  assert.equal((await route.PUT(request("PUT",{raw:"{broken"}))).status,400);
  assert.equal((await route.PUT(request("PUT",{raw:JSON.stringify({profile:{voice:"x".repeat(70*1024)}})}))).status,413);

  assert.equal((await route.DELETE(request("DELETE"))).status,400);
  assert.equal((await route.DELETE(request("DELETE",{query:"?id=chatgptricks"}))).status,400);
  assert.equal((await route.DELETE(request("DELETE",{query:"?id=nope"}))).status,404);
  const deleted=await route.DELETE(request("DELETE",{query:"?id=mi-pagina"}));
  assert.deepEqual(await deleted.json(),{deleted:true,id:"mi-pagina"});

  // Agent tokens resolve to the owner that created them, with no browser session.
  const {token}=await f.agentAccess().createAgentCredential("owner-b","Recreate agent");
  f.setOwner(null);
  assert.equal((await route.GET(request("GET"))).status,401);
  const agentSave=await route.PUT(request("PUT",{token,body:{profile:{id:"agent-page",name:"Agent page",handle:"@agent_page",language:"en",voice:"v"}}}));
  assert.equal(agentSave.status,200,await agentSave.clone().text());
  const agentList=await (await route.GET(request("GET",{token}))).json();
  assert.deepEqual(agentList.profiles.map(profile=>profile.id),["chatgptricks","pagina-es","agent-page"]);
  assert.equal(agentList.profiles[0].templateId,"chatgptricks-3x4","owner-a's override is not visible to owner-b");
  assert.ok(f.db.rows.has("page-profiles:owner-b"));
  for(const headers of [{Authorization:"Bearer definitely-invalid"},{Authorization:"Basic Zm9vOmJhcg=="}]) {
    assert.equal((await route.GET(request("GET",{headers}))).status,401);
  }
});

test("the route rejects unauthenticated and cross-origin requests before reading or writing",async t=>{
  const f=fixture(t,{ownerKey:null}),route=f.route();
  assert.equal((await route.GET(request("GET"))).status,401);
  assert.equal((await route.PUT(request("PUT",{body:{id:"x-page"}}))).status,401);
  assert.equal((await route.DELETE(request("DELETE",{query:"?id=x-page"}))).status,401);
  f.setOwner("owner-a");
  for(const method of ["GET","PUT","DELETE"]) {
    const response=await route[method](request(method,{origin:"https://evil.example",query:"?id=x-page",body:method==="PUT"?{id:"x-page",name:"X",handle:"@x",language:"en",voice:"v"}:undefined}));
    assert.equal(response.status,403,method);
  }
  assert.equal(f.db.writes,0);
});
