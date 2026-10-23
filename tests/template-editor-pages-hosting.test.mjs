import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,dependencies={}){const unit={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:file})(name=>{if(!(name in dependencies))throw Error('Unexpected import '+name);return dependencies[name];},unit,unit.exports);return unit.exports;}

test('Pages CORS matches one configured HTTPS origin and keeps session transfer private',()=>{
 const old=process.env.ENGINE_FRONTEND_URL;
 try{
  const origin=load('lib/engine/frontend-origin.ts');
  for(const value of ['', 'https://user:pass@pages.test/engine','http://pages.test/engine','data:text/plain,hello']){process.env.ENGINE_FRONTEND_URL=value;assert.equal(origin.frontendOrigin(),null);}
  process.env.ENGINE_FRONTEND_URL='https://chatgptricks.github.io/engine/';
  assert.equal(origin.isFrontendOrigin('https://chatgptricks.github.io'),true);
  assert.equal(origin.isFrontendOrigin('https://chatgptricks.github.io.evil.test'),false);
  const response=()=>new Response(null);
  const NextResponse=class extends Response {static next(){return response();}};
  const {proxy}=load('proxy.ts',{'next/server':{NextResponse},'./lib/engine/frontend-origin':origin});
  const request=(path,headers,method='GET')=>({nextUrl:new URL('https://api.test'+path),headers:new Headers(headers),method});
  const preflight=proxy(request('/api/template-editor',{Origin:'https://chatgptricks.github.io'},'OPTIONS'));
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://chatgptricks.github.io');
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);
  assert.equal(proxy(request('/api/engine/pages-session',{Origin:'https://chatgptricks.github.io'})).headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(proxy(request('/api/template-editor',{Origin:'https://evil.test'})).headers.get('Access-Control-Allow-Origin'),null);
 }finally{if(old===undefined)delete process.env.ENGINE_FRONTEND_URL;else process.env.ENGINE_FRONTEND_URL=old;}
});

test('backend verifies bearer sessions with Supabase and retains the owner allowlist',async()=>{
 let authorization=null,email='owner@test.dev',seen=[];
 const auth=load('lib/supabase/auth-server.ts',{
  '@supabase/ssr':{createServerClient:()=>({auth:{getUser:async token=>{seen.push(token);return {data:{user:token==='expired'?null:{email}}};}}})},
  'next/headers':{cookies:async()=>({getAll:()=>[],set(){}}),headers:async()=>new Headers(authorization?{Authorization:authorization}:{})},
  '@/lib/owners':{isOwnerEmail:value=>value==='owner@test.dev'},
 });
 assert.deepEqual(await auth.getCurrentAdminUser(),{email});assert.equal(seen.at(-1),undefined);
 authorization='Bearer signed.jwt.token';assert.deepEqual(await auth.getCurrentAdminUser(),{email});assert.equal(seen.at(-1),'signed.jwt.token');
 email='stranger@test.dev';assert.equal(await auth.getCurrentAdminUser(),null);
 authorization='Bearer expired';assert.equal(await auth.getCurrentAdminUser(),null);
 const before=seen.length;authorization='Basic token';assert.equal(await auth.getCurrentAdminUser(),null);assert.equal(seen.length,before);
});

function worker({token='verified-jwt',clientUrl='https://pages.test/engine/',network=async()=>new Response('saved')}={}){
 const events={},calls=[];
 class Channel{constructor(){const one={close(){},onmessage:null},two={postMessage:data=>one.onmessage?.({data})};this.port1=one;this.port2=two;}}
 const self={location:{origin:'https://pages.test'},registration:{scope:'https://pages.test/engine/'},clients:{get:async()=>({url:clientUrl,postMessage:(message,ports)=>ports[0].postMessage({token})}),claim:async()=>{}},skipWaiting(){},addEventListener:(name,handler)=>events[name]=handler};
 const source=fs.readFileSync('frontend/static/engine-api-worker.js','utf8').replaceAll('__ENGINE_API_ORIGIN__','https://api.test').replaceAll('__ENGINE_BASE_PATH__','/engine');
 vm.runInNewContext(source,{self,Response,Request,Headers,URL,MessageChannel:Channel,setTimeout,clearTimeout,fetch:async(...args)=>{calls.push(args);return network(...args);}});
 return {calls,request:(url,init)=>{let result;events.fetch({request:new Request(url,init),clientId:'client',respondWith:value=>result=Promise.resolve(value)});return result;}};
}
test('static transport forwards method, exact body and verified auth only to its configured backend',async()=>{
 const w=worker();
 const response=await w.request('https://pages.test/api/template-editor?packed=1',{method:'PUT',headers:{Authorization:'Bearer injected','Content-Type':'application/json'},body:'{"copy":true}'});
 assert.equal(await response.text(),'saved');const [url,options]=w.calls[0];
 assert.equal(url,'https://api.test/api/template-editor?packed=1');assert.equal(options.method,'PUT');assert.equal(new TextDecoder().decode(options.body),'{"copy":true}');
 assert.equal(options.headers.get('Authorization'),'Bearer verified-jwt');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
 assert.equal(w.request('https://unrelated.test/api/images'),undefined);assert.equal(w.calls.length,1);
});
test('static transport rejects missing auth and other project clients, while resolving portable artwork paths',async()=>{
 const unauth=worker({token:null});assert.equal((await unauth.request('https://pages.test/api/template-editor')).status,401);assert.equal(unauth.calls.length,0);
 const other=worker({clientUrl:'https://pages.test/other/'});assert.equal((await other.request('https://pages.test/api/template-editor')).status,401);assert.equal(other.calls.length,0);
 const w=worker();await w.request('https://pages.test/template-editor/image.webp');assert.equal(String(w.calls[0][0]),'https://pages.test/engine/template-editor/image.webp');
});
test('static transport preserves private image bytes and streams collaboration events',async()=>{
 const bytes=new Uint8Array([0,1,2,253,254,255]);const w=worker({network:async()=>new Response(bytes,{headers:{'Content-Type':'image/webp'}})});
 const image=await w.request('https://pages.test/api/template-editor/assets/abc');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),bytes);assert.equal(image.headers.get('content-type'),'image/webp');
 let controller;const stream=new ReadableStream({start(value){controller=value;}});
 const sse=worker({network:async()=>new Response(stream,{headers:{'Content-Type':'text/event-stream'}})});
 const response=await sse.request('https://pages.test/api/template-editor/collaboration'),reader=response.body.getReader();
 controller.enqueue(new TextEncoder().encode('event: update\ndata: {"revision":2}\n\n'));
 assert.match(new TextDecoder().decode((await reader.read()).value),/revision/);controller.close();
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});
