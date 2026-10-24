import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
const source=ts.transpileModule(fs.readFileSync('lib/engine/pages-connection.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const unit={exports:{}};vm.runInThisContext(`(function(module,exports){${source}\n})`,{filename:'pages-connection.ts'})(unit,unit.exports);
const connection=unit.exports,backend='https://api.test',project='https://project.supabase.co',scope='a'.repeat(64);
const config={backend,supabaseUrl:project,supabaseKey:'sb_publishable_public-key',local:false};
const storage=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const session=(store,id='user-a')=>store.setItem(connection.PAGES_SESSION_KEY,JSON.stringify({access_token:'sdk-token',refresh_token:'sdk-refresh',user:{id},expires_at:1}));

test('public Pages config is pinned to its backend and accepts local bypass only for loopback',()=>{
 assert.deepEqual(connection.parsePagesConnection(config,backend),config);
 assert.equal(connection.parsePagesConnection({...config,backend:'https://evil.test'},backend),null);
 for(const url of ['https://user:pass@api.test','https://api.test/other','http://api.test','https://api.test/?key=secret'])assert.equal(connection.parsePagesConnection({...config,backend:url},url),null);
 assert.equal(connection.parsePagesConnection({backend,local:true},backend),null);
 assert.deepEqual(connection.parsePagesConnection({backend:'http://localhost:3018',local:true},'http://localhost:3018'),{backend:'http://localhost:3018',supabaseUrl:'',supabaseKey:'',local:true});
 assert.equal(connection.parsePagesConnection({...config,supabaseUrl:'https://project.supabase.co/other'},backend),null);
});

test('cached workspace selection requires the exact locally signed-in user, backend and Supabase project',()=>{
 const store=storage();session(store);
 assert.equal(connection.cachedPagesBinding(store,config),null);
 assert.equal(connection.rememberPagesBinding(store,config,'user-a',scope),true);
 assert.deepEqual(connection.cachedPagesBinding(store,config),{backend,supabaseUrl:project,userId:'user-a',scope});
 const custom=JSON.parse(store.getItem(connection.PAGES_BINDING_KEY));assert.equal(Object.hasOwn(custom,'access_token'),false);assert.equal(Object.hasOwn(custom,'refresh_token'),false);
 assert.equal(connection.cachedPagesBinding(store,{...config,backend:'https://different.test'}),null);
 assert.equal(connection.cachedPagesBinding(store,{...config,supabaseUrl:'https://different.supabase.co'}),null);
 session(store,'user-b');assert.equal(connection.cachedPagesBinding(store,config),null);
 assert.equal(connection.rememberPagesBinding(store,config,'user-a',scope),false,'A stale backend response cannot bind the previous account');
 store.removeItem(connection.PAGES_SESSION_KEY);assert.equal(connection.cachedPagesBinding(store,config),null);
});

test('signout revokes local selection while leaving scoped recovery data untouched',()=>{
 const store=storage();session(store);connection.rememberPagesBinding(store,config,'user-a',scope);
 store.setItem('unrelated-recovery','keep');connection.forgetPagesBinding(store);
 assert.equal(connection.cachedPagesBinding(store,config),null);assert.equal(store.getItem('unrelated-recovery'),'keep');
});

test('malformed browser state and unavailable storage do not grant local workspace access',()=>{
 const store=storage();session(store);for(const value of ['invalid',JSON.stringify({userId:'user-a',backend,supabaseUrl:project,scope:'invalid'}),'null']){store.setItem(connection.PAGES_BINDING_KEY,value);assert.equal(connection.cachedPagesBinding(store,config),null);}
 store.setItem(connection.PAGES_SESSION_KEY,JSON.stringify({user:{id:'user-a'}}));assert.equal(connection.storedPagesUser(store),null);
 const unavailable={getItem(){throw Error('Disabled');},setItem(){throw Error('Full');},removeItem(){throw Error('Disabled');}};
 assert.equal(connection.cachedPagesBinding(unavailable,config),null);assert.equal(connection.cachedPagesConnection(unavailable,backend),null);assert.equal(connection.rememberPagesBinding(unavailable,config,'user-a',scope),false);
 assert.doesNotThrow(()=>connection.forgetPagesBinding(unavailable));assert.doesNotThrow(()=>connection.rememberPagesConnection(unavailable,config));
});

test('public config cache contains no session credentials and is backend pinned',()=>{
 const store=storage();connection.rememberPagesConnection(store,config);assert.deepEqual(connection.cachedPagesConnection(store,backend),config);
 assert.equal(connection.cachedPagesConnection(store,'https://different.test'),null);
 assert.doesNotMatch([...store.values.values()].join(''),/access_token|refresh_token/);
});

test('online SDK identity works without browser persistence while offline selection remains disabled',()=>{
 const unavailable={getItem(){throw Error('Disabled');},setItem(){throw Error('Disabled');},removeItem(){throw Error('Disabled');}};
 assert.equal(connection.pagesIdentityMatches(unavailable,'user-a','user-a'),true);
 assert.equal(connection.pagesIdentityMatches(unavailable,'user-a','user-b'),false);
 assert.equal(connection.pagesIdentityMatches(unavailable,'user-a',null),false,'Signout invalidates the in-memory selection');
 assert.equal(connection.cachedPagesBinding(unavailable,config),null);
 assert.equal(connection.rememberPagesBinding(unavailable,config,'user-a',scope),false);
 const store=storage();session(store,'user-b');assert.equal(connection.pagesIdentityMatches(store,'user-a','user-a'),false,'A persisted account change takes precedence over old SDK state');
});

test('an external account change invalidates pending recovery and every old handoff retry',async()=>{
 const guard=connection.createPagesTransferGuard(),stillCurrent=guard.begin(),written=[];let finish;
 const pending=connection.restorePagesDrafts(['first-a','second-a'],stillCurrent,async draft=>{written.push(draft);if(draft==='first-a')await new Promise(resolve=>{finish=resolve;});});
 guard.invalidate();finish();assert.equal(await pending,false);assert.deepEqual(written,['first-a']);assert.equal(stillCurrent(),false);
 let staleSessionCalls=0;const staleRetry=()=>{if(stillCurrent())staleSessionCalls++;};staleRetry();assert.equal(staleSessionCalls,0);
 const selectedB=guard.begin();assert.equal(await connection.restorePagesDrafts(['draft-b'],selectedB,async draft=>{written.push(draft);}),true);
 assert.deepEqual(written,['first-a','draft-b']);
});

test('aborting the retired SDK client prevents a pending or retried setSession from restoring the previous account',async t=>{
 const store=storage(),key=connection.PAGES_SESSION_KEY,lifetimeA=new AbortController();let waiting,requests=0;
 const jwt=id=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.${Buffer.alloc(32).toString('base64url')}`;
 const user=id=>({id,aud:'authenticated',role:'authenticated',email:`${id}@test.dev`,created_at:'2026-10-23T00:00:00.000Z'});
 const jwtA=jwt('user-a'),jwtB=jwt('user-b');
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  requests++;if(new Headers(options.headers).get('Authorization')===`Bearer ${jwtB}`)return Response.json(user('user-b'));
  return new Promise((resolve,reject)=>{waiting=resolve;options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
 });
 const clientA=createClient(project,config.supabaseKey,{auth:{storageKey:key,storage:store,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:connection.createPagesAuthFetch(lifetimeA.signal)}});
 await clientA.auth.getSession();
 const applyingA=clientA.auth.setSession({access_token:jwtA,refresh_token:'refresh-a'});await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,1);
 const selectedB={access_token:jwtB,refresh_token:'refresh-b',user:user('user-b'),expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer'};
 store.setItem(key,JSON.stringify(selectedB));lifetimeA.abort();
 const result=await applyingA;assert.ok(result.error);waiting(Response.json(user('user-a')));assert.equal(JSON.parse(store.getItem(key)).user.id,'user-b');
 const retried=await clientA.auth.setSession({access_token:jwtA,refresh_token:'refresh-a'});assert.ok(retried.error);assert.equal(requests,1,'The retired client must not dispatch a fresh request under the next account');
 const clientB=createClient(project,config.supabaseKey,{auth:{storageKey:key,storage:store,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:connection.createPagesAuthFetch(new AbortController().signal)}});
 const fresh=await clientB.auth.setSession({access_token:jwtB,refresh_token:'refresh-b'});assert.equal(fresh.error,null);assert.equal(fresh.data.user.id,'user-b');assert.equal(JSON.parse(store.getItem(key)).user.id,'user-b');
 await Promise.all([clientA.auth.stopAutoRefresh(),clientB.auth.stopAutoRefresh()]);
});

test('an unresolved SDK operation has a bounded wait and does not block a later retry',async()=>{
 await assert.rejects(connection.connectionDeadline(new Promise(()=>{}),5),/taking too long/);
 assert.equal(await connection.connectionDeadline(Promise.resolve('recovered'),50),'recovered');
});

test('SDK fetch has an actual network deadline and respects request cancellation and cleanup',async t=>{
 const deadlines=[],requests=[];t.mock.method(AbortSignal,'timeout',milliseconds=>{const controller=new AbortController();deadlines.push({controller,milliseconds});return controller.signal;});
 t.mock.method(globalThis,'fetch',async(input,options)=>{requests.push({input,options});return new Promise((resolve,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});});
 const lifetime=new AbortController(),fetcher=connection.createPagesAuthFetch(lifetime.signal);
 const stalled=fetcher('https://project.supabase.co/auth/v1/token');assert.equal(deadlines[0].milliseconds,10000);
 deadlines[0].controller.abort(new DOMException('Deadline reached','TimeoutError'));await assert.rejects(stalled,{name:'TimeoutError'});
 const original=new AbortController(),cancelled=fetcher(new Request('https://project.supabase.co/auth/v1/user',{signal:original.signal}));original.abort();await assert.rejects(cancelled,{name:'AbortError'});
 const closing=fetcher('https://project.supabase.co/auth/v1/user');lifetime.abort();await assert.rejects(closing,{name:'AbortError'});
 assert.equal(requests.length,3);
});
