/* Authenticated transport for the static editor, including images and SSE.
 * It stores no tokens or artwork and never caches private API responses. */
const BACKEND = "__ENGINE_API_ORIGIN__";
const BASE = "__ENGINE_BASE_PATH__";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
function tokenFor(client) {
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    const timer=setTimeout(()=>{channel.port1.close();reject(new Error("Sign in again to connect to your workspace."));},15000);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(typeof event.data?.token==="string"?event.data.token:null);};
    client.postMessage({type:"engine-api-token"},[channel.port2]);
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
    const response=await fetch(target.href,{method,headers,body:["GET","HEAD"].includes(method)?undefined:await event.request.arrayBuffer(),credentials:"omit",mode:"cors",redirect:"error",cache:"no-store",signal:event.request.signal});
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
