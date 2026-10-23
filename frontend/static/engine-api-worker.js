/* Authenticated transport for the static editor, including images and SSE.
 * It stores no tokens or artwork and never caches private API responses. */
const BACKEND = "__ENGINE_API_ORIGIN__";
const BASE = "__ENGINE_BASE_PATH__";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
function tokenFor(client,refresh=false) {
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    const timer=setTimeout(()=>{channel.port1.close();reject(new Error("Sign in again to connect to your workspace."));},15000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();if(event.data?.error){reject(new Error("Session refresh is temporarily unavailable."));return;}resolve(typeof event.data?.token==="string"?event.data.token:null);};
    client.postMessage({type:"engine-api-token",refresh},[channel.port2]);
  });
}
async function proxyApi(event,url) {
  const client=await self.clients.get(event.clientId);
  if(!client||!client.url.startsWith(self.registration.scope))return Response.json({error:"Open your Engine workspace to continue."},{status:401});
  try {
    const token=await tokenFor(client);
    const local=["localhost","127.0.0.1"].includes(new URL(BACKEND).hostname);
    if(!token&&!local)return Response.json({error:"Sign in again to save your library."},{status:401});
    const headers=new Headers(event.request.headers);
    headers.delete("cookie");headers.delete("authorization");
    if(token)headers.set("Authorization",`Bearer ${token}`);
    const target=new URL(url.pathname+url.search,BACKEND);
    const method=event.request.method;
    const body=["GET","HEAD"].includes(method)?undefined:await event.request.arrayBuffer();
    const send=()=>fetch(target.href,{method,headers,body,credentials:"omit",mode:"cors",redirect:"error",cache:"no-store",signal:event.request.signal});
    let response=await send();
    if(response.status===401&&token){
      // Authentication is checked before writes. Retry the same request once
      // with a freshly renewed session, retaining its idempotent save body.
      await response.body?.cancel();
      const renewed=await tokenFor(client,true);
      if(!renewed)return Response.json({error:"Sign in again to save your library."},{status:401});
      headers.set("Authorization",`Bearer ${renewed}`);
      response=await send();
    }
    const output=new Headers(response.headers);output.set("Cache-Control","private, no-store");
    // Preserve the stream: collaboration events and exports are not buffered.
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers:output});
  } catch {
    return Response.json({error:"Could not connect to your workspace. Your local recovery is kept. Retry when connected."},{status:503});
  }
}
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith("/api/"))event.respondWith(proxyApi(event,url));
  // Existing documents keep portable root-relative artwork paths.
  else if(["/fonts/","/template-editor/"].some(prefix=>url.pathname.startsWith(prefix)))event.respondWith(fetch(new URL(BASE+url.pathname+url.search,url.origin)));
});
