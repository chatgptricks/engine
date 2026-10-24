import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
const HEALTH_STATE=Symbol.for('engine.database-health-probe'),HOUR=3600000;
const settle=async()=>{for(let count=0;count<20;count++)await Promise.resolve();};
function load(file,dependencies){const unit={exports:{}};const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInThisContext(`(function(require,module,exports){${source}\n})`,{filename:file})(name=>{if(!Object.hasOwn(dependencies,name))throw Error('Unexpected import '+name);return dependencies[name];},unit,unit.exports);return unit.exports;}
function environment(t){const keys=['NODE_ENV','RENDER','IS_PULL_REQUEST','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RENDER_GIT_COMMIT'],before=new Map(keys.map(key=>[key,process.env[key]]));Object.assign(process.env,{NODE_ENV:'production',RENDER:'true',NEXT_PUBLIC_SUPABASE_URL:'https://project.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',RENDER_GIT_COMMIT:'verified-commit'});delete process.env.IS_PULL_REQUEST;delete globalThis[HEALTH_STATE];t.after(()=>{for(const [key,value]of before)if(value===undefined)delete process.env[key];else process.env[key]=value;delete globalThis[HEALTH_STATE];});const logs=[];t.mock.method(console,'info',text=>logs.push(text));t.mock.method(console,'warn',text=>logs.push(text));return logs;}
function fixture(t,{run=async()=>({error:null}),getClient}={}){const logs=environment(t),queries=[];let clients=0;const client={from(table){const query={table};queries.push(query);return {select(column){query.column=column;return this;},eq(column,value){query.filter={column,value};return this;},limit(limit){query.limit=limit;return this;},abortSignal(signal){query.signal=signal;return run(query);}};}};const dependencies={'server-only':{},'@/lib/supabase/admin':{getAdminSupabase(){clients++;return getClient?getClient():client;}}};return {logs,queries,dependencies,load:()=>load('lib/engine/database-health.ts',dependencies),get clients(){return clients;}};}

test('database health uses only a tiny owner lookup and throttles successful checks for six hours',async t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);const probe=fixture(t),health=probe.load();health.triggerDatabaseHealthProbe();assert.equal(probe.queries.length,0,'Do not start database work on the synchronous health response path');await settle();
 assert.equal(probe.queries.length,1);const query=probe.queries[0];assert.equal(query.table,'gf_client_state');assert.equal(query.column,'owner');assert.deepEqual(query.filter,{column:'owner',value:'template-editor:owner'});assert.equal(query.limit,1);assert.ok(query.signal instanceof AbortSignal);assert.equal(probe.logs.length,1);
 now+=6*HOUR-1;health.triggerDatabaseHealthProbe();await settle();assert.equal(probe.queries.length,1);now++;health.triggerDatabaseHealthProbe();await settle();assert.equal(probe.queries.length,2);
 assert.ok(probe.logs.every(line=>line==='[engine] Database health check succeeded.'));
});

test('concurrent health requests and separate route bundles share one in-flight database probe',async t=>{
 let finish,now=1000;t.mock.method(Date,'now',()=>now);const probe=fixture(t,{run:()=>new Promise(resolve=>{finish=resolve;})}),first=probe.load(),second=probe.load();
 for(let index=0;index<50;index++){first.triggerDatabaseHealthProbe();second.triggerDatabaseHealthProbe();}await settle();assert.equal(probe.queries.length,1);
 now+=24*HOUR;second.triggerDatabaseHealthProbe();await settle();assert.equal(probe.queries.length,1,'A slow probe must remain single-flight even after the cooldown would have elapsed');finish({error:null});await settle();
 now+=6*HOUR-1;first.triggerDatabaseHealthProbe();await settle();assert.equal(probe.queries.length,1,'Cooldown starts after the successful request finishes');now++;second.triggerDatabaseHealthProbe();await settle();assert.equal(probe.queries.length,2);finish({error:null});await settle();
});

test('provider errors and synchronous client failures are caught, sanitized, and retried at most hourly',async t=>{
 for(const kind of ['provider','throw','client'])await t.test(kind,async t=>{
  let now=1000;t.mock.method(Date,'now',()=>now);const secret='private-provider-url-and-token';const probe=fixture(t,{run:async()=>{if(kind==='throw')throw Error(secret);return {error:{message:secret},data:[{owner:secret}]};},getClient:kind==='client'?()=>{throw Error(secret);}:undefined}),health=probe.load();
  assert.doesNotThrow(()=>health.triggerDatabaseHealthProbe());await settle();assert.equal(probe.clients,1);assert.equal(probe.logs.length,1);assert.doesNotMatch(probe.logs[0],/private-provider|https|token/);
  now+=HOUR-1;health.triggerDatabaseHealthProbe();await settle();assert.equal(probe.clients,1);now++;health.triggerDatabaseHealthProbe();await settle();assert.equal(probe.clients,2);
 });
});

test('the probe is disabled outside production Render and without existing database configuration',async t=>{
 const probe=fixture(t),health=probe.load();for(const [key,value]of [['NODE_ENV','development'],['RENDER','false'],['RENDER',undefined],['IS_PULL_REQUEST','true'],['NEXT_PUBLIC_SUPABASE_URL',undefined],['SUPABASE_SERVICE_ROLE_KEY',undefined]]){const before=process.env[key];if(value===undefined)delete process.env[key];else process.env[key]=value;health.triggerDatabaseHealthProbe();await settle();assert.equal(probe.clients,0);if(before===undefined)delete process.env[key];else process.env[key]=before;}
 assert.equal(probe.queries.length,0);assert.equal(probe.logs.length,0);
});

test('the five-second abort reaches the real SDK fetch and cancels a stalled response body',async t=>{
 const logs=environment(t),deadlines=[],requests=[];let now=1000;t.mock.method(Date,'now',()=>now);t.mock.method(AbortSignal,'timeout',delay=>{const controller=new AbortController();deadlines.push({delay,controller});return controller.signal;});
 const fetcher=async(input,options)=>{requests.push({input,options});return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('[{"owner":'));options.signal.addEventListener('abort',()=>controller.error(options.signal.reason),{once:true});}}),{status:200,headers:{'Content-Type':'application/json'}});};
 const client=createClient('https://project.test','test-only',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher}});
 const health=load('lib/engine/database-health.ts',{'server-only':{},'@/lib/supabase/admin':{getAdminSupabase:()=>client}});health.triggerDatabaseHealthProbe();await settle();assert.equal(deadlines[0].delay,5000);assert.equal(requests.length,1);assert.equal(requests[0].options.signal,deadlines[0].controller.signal);
 const url=new URL(requests[0].input);assert.equal(url.searchParams.get('select'),'owner');assert.equal(url.searchParams.get('limit'),'1');assert.equal(url.searchParams.has('data'),false);
 deadlines[0].controller.abort(new DOMException('Timed out','TimeoutError'));await settle();assert.equal(globalThis[HEALTH_STATE].inFlight,null);assert.equal(globalThis[HEALTH_STATE].nextAt,now+HOUR);assert.equal(logs.length,1);assert.match(logs[0],/unavailable/);
});

test('version responds synchronously with the exact existing payload while the database is stalled',async t=>{
 let finish;const probe=fixture(t,{run:()=>new Promise(resolve=>{finish=resolve;})}),health=probe.load(),route=load('app/api/engine/version/route.ts',{'@/lib/engine/database-health':health});
 const response=route.GET();assert.ok(response instanceof Response);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(probe.queries.length,0);
 assert.deepEqual(await response.json(),{build:'2026-10-23-workspace-availability',commit:'verified-commit'});assert.equal(probe.queries.length,1,'The response body must finish while the database promise is still unresolved');assert.equal(probe.logs.length,0);finish({error:null});await settle();
});
