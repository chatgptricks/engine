/* Run: node --test tests/template-editor-agent-api.test.mjs
 * Exercise the real agent routes, token store and editor persistence together.
 * Only authentication, environment and Supabase's external boundary are faked. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
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
      let update, pattern, maximum, range, projection;
      const orderings=[];
      const query={
        select(columns){projection=columns;return query;},
        eq(column,value){conditions.set(column,value);return query;},
        like(column,value){pattern={column,value};return query;},
        order(column,options){orderings.push({column,...options});return query;},
        range(start,end){range={start,end};return query;},
        limit(value){maximum=value;return query;},
        update(value){update=structuredClone(value);return query;},
        async insert(value){
          if(rows.has(value.owner))return {error:{code:"23505"}};
          rows.set(value.owner,structuredClone(value));writes++;
          return {error:null};
        },
        async maybeSingle(){
          const owner=conditions.get("owner"),row=rows.get(owner);
          if(update){
            if(!row||![...conditions].every(([column,value])=>valueAt(row,column)===value))return {data:null,error:null};
            rows.set(owner,{...row,...update});writes++;
            return {data:{owner},error:null};
          }
          if(projection==="library:data->library,revision:data->>revision,assets:data->assets")return {data:row?structuredClone({library:row.data.library,revision:row.data.revision,assets:row.data.assets}):null,error:null};
          return {data:row?structuredClone(row):null,error:null};
        },
        then(resolve,reject){
          try{
            let selected=[...rows.values()].filter(row=>[...conditions].every(([column,value])=>valueAt(row,column)===value));
            if(pattern){const prefix=pattern.value.replace(/%$/,""),suffix=pattern.value.endsWith("%");selected=selected.filter(row=>suffix?row[pattern.column].startsWith(prefix):row[pattern.column]===prefix);}
            if(orderings.length)selected.sort((a,b)=>{for(const order of orderings){const comparison=String(a[order.column]).localeCompare(String(b[order.column]))*(order.ascending===false?-1:1);if(comparison)return comparison;}return 0;});
            if(range)selected=selected.slice(range.start,range.end+1);
            if(maximum!==undefined)selected=selected.slice(0,maximum);
            return Promise.resolve({data:structuredClone(selected),error:null}).then(resolve,reject);
          }catch(error){return Promise.reject(error).then(resolve,reject);}
        },
      };
      return query;
    },
  };
}

function fixture(t,{db=fakeDatabase(),ownerKey="owner-a",production=false}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"engine-agent-api-test-"));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const environment={cwd:()=>directory,env:{NODE_ENV:production?"production":"test"}};
  let access=ownerKey?{kind:"owner",ownerKey}:null,sessionLookups=0;
  const overrides={
    "@/lib/engine/member":{resolveEngineAccess:async()=>{sessionLookups++;return access;}},
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
    const compiled=vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`,{filename});
    compiled(name=>{
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
    db,load,directory,
    get sessionLookups(){return sessionLookups;},
    setOwner(owner){access=owner?{kind:"owner",ownerKey:owner}:null;},
    slides:()=>load("app/api/agent/slides/route.ts"),
    credentials:()=>load("app/api/agent/access/route.ts"),
    store:()=>load("lib/template-editor/persistence.ts"),
  };
}

const baseUrl="https://engine.example";
function actionRequest(action,args={},options={}) {
  const headers={"Content-Type":"application/json",...options.headers};
  if(options.token!==undefined)headers.Authorization=`Bearer ${options.token}`;
  if(options.origin!==undefined)headers.Origin=options.origin;
  return new Request(baseUrl+"/api/agent/slides",{
    method:"POST",headers,body:options.raw??JSON.stringify({action,...args}),
  });
}
function accessRequest(method,body,options={}) {
  return new Request(baseUrl+"/api/agent/access",{
    method,headers:{"Content-Type":"application/json",Origin:options.origin??baseUrl,...options.headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
}
async function createToken(f,name="Agent test") {
  const response=await f.credentials().POST(accessRequest("POST",{name}));
  assert.equal(response.status,201,await response.clone().text());
  const body=await response.json();assert.equal(typeof body.token,"string");assert.ok(body.token.length>=32);
  return body;
}
async function runAction(f,action,args={},options={}) {
  return f.slides().POST(actionRequest(action,args,options));
}

test("agent actions and credential management require an authenticated identity",async t=>{
  const f=fixture(t,{ownerKey:null});
  const actions=await runAction(f,"capabilities");
  assert.equal(actions.status,401);
  assert.equal((await f.credentials().GET(accessRequest("GET"))).status,401);
  assert.equal((await f.credentials().POST(accessRequest("POST",{name:"Unauthenticated"}))).status,401);
  assert.equal((await f.credentials().DELETE(accessRequest("DELETE",{id:randomUUID()}))).status,401);
  assert.equal(f.db.writes,0);
});

test("opaque credentials store only a hash and management stays isolated to the signed-in owner",async t=>{
  const f=fixture(t),created=await createToken(f,"My slide agent");
  assert.equal(created.credential.name,"My slide agent");
  assert.equal(created.credential.token,undefined);
  assert.equal(created.credential.hash,undefined);
  assert.equal(created.credential.ownerKey,undefined);
  assert.ok(Number.isFinite(Date.parse(created.credential.expiresAt)));
  assert.equal(JSON.stringify([...f.db.rows.values()]).includes(created.token),false);
  const listed=await f.credentials().GET(accessRequest("GET"));
  assert.equal(listed.headers.get("cache-control"),"private, no-store");
  const listedBody=await listed.json();
  assert.ok(JSON.stringify(listedBody).includes(created.credential.id));
  assert.equal(JSON.stringify(listedBody).includes(created.token),false);
  assert.equal(JSON.stringify(listedBody).includes('"hash"'),false);
  f.setOwner("owner-b");
  const others=await f.credentials().GET(accessRequest("GET"));
  assert.equal(JSON.stringify(await others.json()).includes(created.credential.id),false);
  const revokedByOther=await f.credentials().DELETE(accessRequest("DELETE",{id:created.credential.id}));
  assert.equal(revokedByOther.status,404);
  assert.ok(await f.load("lib/template-editor/agent-access.ts").resolveAgentToken(created.token));
  f.setOwner("owner-a");
  assert.equal((await f.credentials().DELETE(accessRequest("DELETE",{id:created.credential.id}))).status,200);
  assert.equal(await f.load("lib/template-editor/agent-access.ts").resolveAgentToken(created.token),null);
  assert.equal((await runAction(f,"capabilities",{},{token:created.token})).status,401);
});

test("invalid bearer authentication cannot fall back to an active browser session",async t=>{
  const f=fixture(t),before=f.sessionLookups;
  for(const headers of [
    {Authorization:"Bearer definitely-invalid"},
    {Authorization:"Basic Zm9vOmJhcg=="},
    {Authorization:"Bearer"},
  ]) {
    assert.equal((await runAction(f,"capabilities",{},{headers})).status,401);
  }
  assert.equal(f.sessionLookups,before);
  assert.equal(f.db.writes,0);
});

test("credential creation and revocation reject cross-origin browser requests",async t=>{
  const f=fixture(t),created=await createToken(f),writes=f.db.writes;
  assert.equal((await f.credentials().POST(accessRequest("POST",{name:"Untrusted"},{origin:"https://evil.example"}))).status,403);
  assert.equal((await f.credentials().DELETE(accessRequest("DELETE",{id:created.credential.id},{origin:"https://evil.example"}))).status,403);
  assert.equal(f.db.writes,writes);
  assert.ok(await f.load("lib/template-editor/agent-access.ts").resolveAgentToken(created.token));
});

test("revoked and expired credentials fail closed across independent server instances",async t=>{
  const db=fakeDatabase(),one=fixture(t,{db}),two=fixture(t,{db});
  const first=await createToken(one,"Shared credential");
  assert.equal((await runAction(two,"capabilities",{},{token:first.token})).status,200);
  await one.credentials().DELETE(accessRequest("DELETE",{id:first.credential.id}));
  assert.equal((await runAction(two,"capabilities",{},{token:first.token})).status,401);
  const expiring=await createToken(one,"Expired credential");
  for(const row of db.rows.values()) {
    const visit=value=>{
      if(!value||typeof value!=="object")return;
      if(value.id===expiring.credential.id)value.expiresAt="2000-01-01T00:00:00.000Z";
      for(const child of Object.values(value))visit(child);
    };
    visit(row.data);
  }
  assert.equal((await runAction(two,"capabilities",{},{token:expiring.token})).status,401);
});

test("agent requests reject malformed and oversized streamed bodies before writes",async t=>{
  const f=fixture(t);
  for(const raw of ["{broken","null","[]",'{"action":"unknown"}']) {
    assert.equal((await runAction(f,"capabilities",{},{raw})).status,400,raw);
  }
  assert.equal((await runAction(f,"capabilities",{},{raw:" ".repeat(12*1024*1024+1)})).status,413);
  assert.equal(f.db.writes,0);
});

test("development credentials persist as private hashed records and production requires cloud storage",async t=>{
  const local=fixture(t,{db:null}),created=await createToken(local,"Local agent");
  const directory=path.join(local.directory,".engine-dev","template-editor","agent-access");
  const files=fs.readdirSync(directory);
  assert.deepEqual(files,[created.credential.id+".json"]);
  const file=path.join(directory,files[0]),record=JSON.parse(fs.readFileSync(file,"utf8"));
  assert.equal(record.ownerKey,"owner-a");
  assert.match(record.tokenHash,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(record).includes(created.token),false);
  assert.equal(fs.statSync(file).mode&0o077,0);
  const tokenStore=local.load("lib/template-editor/agent-access.ts");
  assert.deepEqual(await tokenStore.resolveAgentToken(created.token),{ownerKey:"owner-a",credentialId:created.credential.id});
  const production=fixture(t,{db:null,production:true});
  assert.equal((await production.credentials().GET(accessRequest("GET"))).status,503);
  assert.equal((await production.credentials().POST(accessRequest("POST",{name:"Never temporary"}))).status,503);
  assert.equal(fs.existsSync(path.join(production.directory,".engine-dev")),false);
});

const deckSpec=(overrides={})=>({
  name:"Editable agent deck",format:"presentation",slides:[{id:"intro",layout:"blank",elements:[
    {id:"heading",type:"text",text:"Editable title",x:100,y:100,width:1500,height:180,fontSize:80},
    {id:"accent",type:"shape",shape:"rectangle",x:100,y:350,width:1000,height:40,fill:"#00d98a"},
  ]}],...overrides,
});
const editText=text=>({operations:[{op:"update_element",pageId:"intro",elementId:"heading",properties:{text,x:120,fontSize:88}}]});
async function createDeck(f,spec=deckSpec(),options={}) {
  const response=await runAction(f,"create_deck",{spec,operationId:options.operationId??randomUUID()},options);
  assert.ok([200,201].includes(response.status),await response.clone().text());
  return response.json();
}

test("agent-created decks remain editable native documents through read, update and export",async t=>{
  const f=fixture(t),created=await createDeck(f);
  assert.match(created.hash,/^[a-f0-9]{64}$/);
  assert.ok(created.editorUrl.includes(encodeURIComponent(created.document.id)));
  const elements=created.document.pages[0].canvas.elements;
  assert.deepEqual(elements.map(element=>element.type),["text","shape"]);
  assert.equal(elements[0].text,"Editable title");
  assert.equal(elements[0].x,100*360/1920);
  assert.equal(elements[0].fontSize,80*360/1920);
  const read=await runAction(f,"get_deck",{deckId:created.document.id});
  assert.equal(read.status,200);
  assert.deepEqual(await read.json(),created);
  const updatedResponse=await runAction(f,"update_deck",{
    deckId:created.document.id,expectedHash:created.hash,changes:editText("The agent refined this"),operationId:randomUUID(),
  });
  assert.equal(updatedResponse.status,200,await updatedResponse.clone().text());
  const updated=await updatedResponse.json();
  assert.notEqual(updated.hash,created.hash);
  assert.equal(updated.document.pages[0].canvas.elements[0].text,"The agent refined this");
  assert.equal(updated.document.pages[0].canvas.elements[0].x,120*360/1920);
  assert.equal(updated.document.pages[0].canvas.elements[1].fill,"#00d98a");
  const exportedResponse=await runAction(f,"export_deck",{deckId:created.document.id});
  assert.equal(exportedResponse.status,200);
  const exported=await exportedResponse.json();
  assert.match(exported.filename,/\.engine\.json$/);
  const model=f.load("lib/template-editor/model.ts"),parsed=model.parseLibrary(exported.package);
  assert.ok(parsed,"The export must be directly importable through Engine's existing editable document parser");
  assert.equal(parsed.designs.length,1);
  assert.deepEqual(parsed.designs[0].pages,updated.document.pages);
  assert.deepEqual(parsed.designs[0].pages[0].canvas.elements.map(element=>element.type),["text","shape"]);
  assert.equal(exported.editorUrl,updated.editorUrl);
});

test("bearer owner isolation applies to create, list, read, update and export despite another active session",async t=>{
  const f=fixture(t),credential=await createToken(f,"Owner A agent");
  f.setOwner("owner-b");
  const created=await createDeck(f,deckSpec({name:"Only owner A"}),{token:credential.token});
  assert.equal((await f.store().getEditorLibrary("owner-a")).library.designs[0].id,created.document.id);
  assert.equal((await f.store().getEditorLibrary("owner-b")).library.designs.length,0);
  const otherList=await runAction(f,"list_decks");
  assert.equal(JSON.stringify(await otherList.json()).includes(created.document.id),false);
  const ownedList=await runAction(f,"list_decks",{},{token:credential.token});
  assert.equal(JSON.stringify(await ownedList.json()).includes(created.document.id),true);
  for(const action of ["get_deck","export_deck"]) {
    assert.equal((await runAction(f,action,{deckId:created.document.id})).status,404);
    assert.equal((await runAction(f,action,{deckId:created.document.id},{token:credential.token})).status,200);
  }
  const writes=f.db.writes;
  assert.equal((await runAction(f,"update_deck",{deckId:created.document.id,expectedHash:created.hash,changes:editText("Other owner"),operationId:randomUUID()})).status,404);
  assert.equal(f.db.writes,writes);
});

test("cookie deck mutations reject other origins while bearer agents can author without a browser session",async t=>{
  const f=fixture(t),credential=await createToken(f),writes=f.db.writes;
  const cookie=await runAction(f,"create_deck",{spec:deckSpec(),operationId:randomUUID()},{origin:"https://agent.example"});
  assert.equal(cookie.status,403);
  assert.equal(f.db.writes,writes);
  f.setOwner(null);
  const created=await createDeck(f,deckSpec(),{token:credential.token});
  f.setOwner("owner-a");
  assert.ok(created.document.id);
  const before=f.db.writes;
  const cookieEdit=await runAction(f,"update_deck",{deckId:created.document.id,expectedHash:created.hash,changes:editText("Blocked"),operationId:randomUUID()},{origin:"https://agent.example"});
  assert.equal(cookieEdit.status,403);
  assert.equal(f.db.writes,before);
});

test("exact create retries are idempotent and existing identities cannot be overwritten",async t=>{
  const f=fixture(t),operationId=randomUUID(),spec=deckSpec({id:"agent-explicit-deck"}),created=await createDeck(f,spec,{operationId});
  const writes=f.db.writes,revision=(await f.store().getEditorLibrary("owner-a")).revision;
  const retried=await createDeck(f,spec,{operationId});
  assert.deepEqual(retried.document,created.document);
  assert.equal(retried.hash,created.hash);
  assert.equal(retried.replayed,true);
  assert.equal(f.db.writes,writes);
  assert.equal((await f.store().getEditorLibrary("owner-a")).revision,revision);
  const differentInput=await runAction(f,"create_deck",{operationId,spec:deckSpec({id:spec.id,name:"Changed retry payload"})});
  assert.equal(differentInput.status,409);
  const sameId=await runAction(f,"create_deck",{operationId:randomUUID(),spec:deckSpec({id:spec.id,name:"Overwrite attempt"})});
  assert.equal(sameId.status,409);
  assert.equal(f.db.writes,writes);
  assert.equal((await f.store().getEditorLibrary("owner-a")).library.designs[0].name,spec.name);
});

test("update retries preserve the committed result and stale hashes never write",async t=>{
  const f=fixture(t),created=await createDeck(f),operationId=randomUUID();
  const args={deckId:created.document.id,expectedHash:created.hash,changes:editText("Committed once"),operationId};
  const first=await runAction(f,"update_deck",args);
  assert.equal(first.status,200);
  const updated=await first.json(),writes=f.db.writes,revision=(await f.store().getEditorLibrary("owner-a")).revision;
  const retried=await runAction(f,"update_deck",args);
  assert.equal(retried.status,200);
  const replayed=await retried.json();
  assert.deepEqual(replayed.document,updated.document);
  assert.equal(replayed.hash,updated.hash);
  assert.equal(replayed.replayed,true);
  assert.equal(f.db.writes,writes);
  const stale=await runAction(f,"update_deck",{...args,changes:editText("Stale overwrite"),operationId:randomUUID()});
  assert.equal(stale.status,409);
  const reused=await runAction(f,"update_deck",{...args,changes:editText("Reused id with different input")});
  assert.equal(reused.status,409);
  assert.equal(f.db.writes,writes);
  assert.equal((await f.store().getEditorLibrary("owner-a")).revision,revision);
  assert.equal((await f.store().getEditorLibrary("owner-a")).library.designs[0].pages[0].canvas.elements[0].text,"Committed once");
});

test("simultaneous deck writers use optimistic concurrency across independent route instances",async t=>{
  const db=fakeDatabase(),one=fixture(t,{db}),two=fixture(t,{db}),created=await createDeck(one);
  const results=await Promise.all([
    runAction(one,"update_deck",{deckId:created.document.id,expectedHash:created.hash,changes:editText("First writer"),operationId:randomUUID()}),
    runAction(two,"update_deck",{deckId:created.document.id,expectedHash:created.hash,changes:editText("Second writer"),operationId:randomUUID()}),
  ]);
  assert.deepEqual(results.map(response=>response.status).sort(),[200,409]);
  const winning=await results.find(response=>response.status===200).json();
  assert.equal((await one.store().getEditorLibrary("owner-a")).library.designs[0].pages[0].canvas.elements[0].text,winning.document.pages[0].canvas.elements[0].text);
});

test("a simultaneous retry creates one deck and unrelated deck writes are retained",async t=>{
  const db=fakeDatabase(),one=fixture(t,{db}),two=fixture(t,{db}),operationId=randomUUID(),spec=deckSpec();
  const [a,b]=await Promise.all([createDeck(one,spec,{operationId}),createDeck(two,spec,{operationId})]);
  assert.equal(a.document.id,b.document.id);
  assert.deepEqual(a.document,b.document);
  assert.equal((await one.store().getEditorLibrary("owner-a")).library.designs.length,1);
  const [c,d]=await Promise.all([
    createDeck(one,deckSpec({name:"Additional deck one"})),
    createDeck(two,deckSpec({name:"Additional deck two"})),
  ]);
  const stored=(await one.store().getEditorLibrary("owner-a")).library.designs;
  assert.deepEqual(new Set(stored.map(deck=>deck.id)),new Set([a.document.id,c.document.id,d.document.id]));
});

test("list pagination and schema failures are bounded without mutating artwork",async t=>{
  const f=fixture(t);
  await createDeck(f,deckSpec({name:"First"}));
  await createDeck(f,deckSpec({name:"Second"}));
  const writes=f.db.writes;
  for(const action of ["list_decks","list_templates"]) {
    for(const args of [{limit:0},{limit:101},{limit:1.5},{offset:-1},{offset:10001},{offset:0.5}]) {
      assert.equal((await runAction(f,action,args)).status,400,JSON.stringify({action,...args}));
    }
  }
  const one=await runAction(f,"list_decks",{offset:0,limit:1}),two=await runAction(f,"list_decks",{offset:1,limit:1});
  const first=await one.json(),second=await two.json();
  assert.equal(first.decks.length,1);assert.equal(second.decks.length,1);
  assert.notEqual(first.decks[0].id,second.decks[0].id);
  const invalidSpec=await runAction(f,"create_deck",{operationId:randomUUID(),spec:deckSpec({slides:[{id:"duplicate",layout:"blank",elements:[]},{id:"duplicate",layout:"blank",elements:[]}]})});
  assert.equal(invalidSpec.status,400);
  assert.equal(f.db.writes,writes);
});

test("agent credentials cannot mint more credentials and tampered secrets are rejected",async t=>{
  const f=fixture(t),created=await createToken(f),writes=f.db.writes;
  f.setOwner(null);
  const headers={Authorization:`Bearer ${created.token}`};
  assert.equal((await f.credentials().GET(accessRequest("GET",undefined,{headers}))).status,401);
  assert.equal((await f.credentials().POST(accessRequest("POST",{name:"Token cannot mint"},{headers}))).status,401);
  assert.equal((await f.credentials().DELETE(accessRequest("DELETE",{id:created.credential.id},{headers}))).status,401);
  const last=created.token.at(-1),tampered=created.token.slice(0,-1)+(last==="A"?"B":"A");
  assert.equal((await runAction(f,"capabilities",{},{token:tampered})).status,401);
  assert.equal((await runAction(f,"capabilities",{},{token:created.token})).status,200);
  assert.equal(f.db.writes,writes);
});

test("inspection and subsequent edits roundtrip in output pixels while the native document stays scaled",async t=>{
  const f=fixture(t),created=await createDeck(f,deckSpec({slides:[{id:"intro",layout:"blank",elements:[
    {id:"heading",type:"text",text:"Pixel roundtrip",x:192,y:108,width:960,height:216,fontSize:96},
  ]}]}));
  const native=created.document.pages[0].canvas.elements[0],pixel=created.view.slides[0].elements[0];
  assert.equal(native.x,36);
  assert.equal(native.width,180);
  assert.equal(pixel.x,192);
  assert.equal(pixel.y,108);
  assert.equal(pixel.width,960);
  assert.equal(pixel.height,216);
  assert.equal(pixel.fontSize,96);
  assert.equal(created.view.coordinates,"output pixels");
  assert.deepEqual(created.view.size,{width:1920,height:1080});
  const response=await runAction(f,"update_deck",{
    deckId:created.document.id,expectedHash:created.hash,operationId:randomUUID(),
    changes:{operations:[{op:"update_element",pageId:"intro",elementId:pixel.id,properties:{
      x:pixel.x+192,y:pixel.y+108,width:pixel.width,height:pixel.height,fontSize:pixel.fontSize,
    }}]},
  });
  assert.equal(response.status,200,await response.clone().text());
  const edited=await response.json(),editedNative=edited.document.pages[0].canvas.elements[0],editedPixel=edited.view.slides[0].elements[0];
  assert.equal(editedNative.x,72);assert.equal(editedNative.y,40.5);
  assert.equal(editedNative.width,native.width);assert.equal(editedNative.height,native.height);
  assert.equal(editedNative.fontSize,native.fontSize);
  assert.equal(editedPixel.x,384);assert.equal(editedPixel.y,216);
  assert.equal(editedPixel.width,pixel.width);assert.equal(editedPixel.height,pixel.height);
  assert.equal(editedPixel.fontSize,pixel.fontSize);
  const reloaded=await runAction(f,"get_deck",{deckId:created.document.id});
  assert.deepEqual((await reloaded.json()).view,edited.view);
});

test("the agent template catalogue and creation both honor trashed built-in templates",async t=>{
  const f=fixture(t),model=f.load("lib/template-editor/model.ts"),catalog=f.load("lib/template-editor/template-catalog.ts");
  const template=model.BUILT_IN_TEMPLATES[0];
  let library=catalog.deleteLibraryTemplate(structuredClone(model.EMPTY_LIBRARY),template.id);
  let saved=await f.store().saveEditorLibrary("owner-a",library,null);
  for(const permanent of [false,true]) {
    if(permanent){library=catalog.purgeLibraryTemplate(saved.library,template.id);saved=await f.store().saveEditorLibrary("owner-a",library,saved.revision);}
    const listed=await runAction(f,"list_templates",{limit:100});
    assert.equal(listed.status,200);
    assert.equal((await listed.json()).templates.some(candidate=>candidate.id===template.id),false);
    const writes=f.db.writes;
    const created=await runAction(f,"create_deck",{operationId:randomUUID(),spec:{name:"Deleted template copy",templateId:template.id}});
    assert.equal(created.status,400);
    assert.equal(f.db.writes,writes);
    assert.equal((await f.store().getEditorLibrary("owner-a")).library.designs.length,0);
  }
});

test("native import validation rejects corrupt or unbounded agent operation receipts",t=>{
  const f=fixture(t),model=f.load("lib/template-editor/model.ts"),document=model.createBlankDesign("Receipt validation","portrait");
  const receipt={id:randomUUID(),inputHash:"a".repeat(64)};
  const imported=receipts=>({...structuredClone(model.EMPTY_LIBRARY),designs:[{...structuredClone(document),agentOperations:receipts}]});
  assert.ok(model.parseLibrary(imported([receipt])));
  const twenty=Array.from({length:20},()=>({id:randomUUID(),inputHash:"b".repeat(64)}));
  assert.ok(model.parseLibrary(imported(twenty)));
  for(const corrupt of [
    "invalid",[{id:"bad-id",inputHash:receipt.inputHash}],[{id:receipt.id,inputHash:"bad-hash"}],
    [receipt,receipt],[...twenty,{id:randomUUID(),inputHash:"c".repeat(64)}],
  ])assert.equal(model.parseLibrary(imported(corrupt)),null);
});

test("credential pagination exposes every connection beyond the first hundred without leaking another owner",async t=>{
  const f=fixture(t),createdAt="2026-10-21T12:00:00.000Z",expiresAt="2099-01-01T00:00:00.000Z";
  const records=Array.from({length:105},(_,index)=>({
    id:randomUUID(),ownerKey:"owner-a",name:`Connection ${index+1}`,createdAt,expiresAt,tokenHash:"a".repeat(64),
  }));
  for(const record of records)f.db.rows.set("template-editor-agent:"+record.id,{owner:"template-editor-agent:"+record.id,data:record,updated_at:createdAt});
  for(let index=0;index<3;index++){
    const record={...records[index],id:randomUUID(),ownerKey:"owner-b",name:"Other workspace"};
    f.db.rows.set("template-editor-agent:"+record.id,{owner:"template-editor-agent:"+record.id,data:record,updated_at:createdAt});
  }
  const request=offset=>new Request(baseUrl+"/api/agent/access"+(offset===undefined?"":`?offset=${offset}`));
  const firstResponse=await f.credentials().GET(request());
  assert.equal(firstResponse.status,200);
  const first=await firstResponse.json();
  assert.equal(first.credentials.length,100);assert.equal(first.nextOffset,100);
  const secondResponse=await f.credentials().GET(request(first.nextOffset));
  assert.equal(secondResponse.status,200);
  const second=await secondResponse.json();
  assert.equal(second.credentials.length,5);assert.equal(second.nextOffset,null);
  assert.deepEqual(new Set([...first.credentials,...second.credentials].map(record=>record.id)),new Set(records.map(record=>record.id)));
  for(const credential of [...first.credentials,...second.credentials]){
    assert.equal(credential.tokenHash,undefined);assert.equal(credential.ownerKey,undefined);
  }
  assert.equal((await f.credentials().DELETE(accessRequest("DELETE",{id:second.credentials[0].id}))).status,200);
  const writes=f.db.writes;
  for(const offset of ["-1","1.5","10001","invalid",""]){
    assert.equal((await f.credentials().GET(request(offset))).status,400,JSON.stringify(offset));
  }
  assert.equal(f.db.writes,writes);
  const exhausted=await f.credentials().GET(request(200));
  assert.deepEqual(await exhausted.json(),{credentials:[],nextOffset:null});

  const local=fixture(t,{db:null}),directory=path.join(local.directory,".engine-dev","template-editor","agent-access");
  fs.mkdirSync(directory,{recursive:true});
  for(const record of records)fs.writeFileSync(path.join(directory,record.id+".json"),JSON.stringify(record));
  const localStore=local.load("lib/template-editor/agent-access.ts");
  const localFirst=await localStore.listAgentCredentials("owner-a"),localSecond=await localStore.listAgentCredentials("owner-a",100);
  assert.equal(localFirst.length,100);assert.equal(localSecond.length,5);
  assert.deepEqual(new Set([...localFirst,...localSecond].map(record=>record.id)),new Set(records.map(record=>record.id)));
});
