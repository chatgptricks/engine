import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
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
