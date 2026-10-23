import {resolveEngineAccess} from "@/lib/engine/member";
import {PersistenceBusyError} from "@/lib/template-editor/persistence";
import {addReviewComment,createReview,getPublicReview,getReviewFeedback,listReviewLinks,readOwnerReview,readOwnerFeedback,revokeReview,resolveReviewComment} from "@/lib/template-editor/reviews";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow"};
const reply = (value: unknown, status = 200) => Response.json(value, {status, headers});
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return [request.url, process.env.NEXT_PUBLIC_SITE_URL, process.env.RENDER_EXTERNAL_URL,process.env.ENGINE_FRONTEND_URL].some(value => { try { return value && new URL(value).origin === origin; } catch { return false; } });
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Error("Missing request.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16_384) { await reader.cancel(); throw new Error("Request too large."); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const value = JSON.parse(await new Blob(chunks as BlobPart[]).text());
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request."); return value;
}
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams, token = query.get("token") ?? "";
  try {
    if(query.get('owner')==='1'&&query.get('feedback')==='1'){const access=await resolveEngineAccess();if(!access)return reply({error:'Sign in to manage feedback.'},401);const feedback=await readOwnerFeedback(access.ownerKey,token,query.get('since')??undefined);return feedback?reply(feedback):reply({error:'Review not found.'},404);}
    if(query.get('feedback')==='1'){const feedback=await getReviewFeedback(token,query.get('since')??undefined);return feedback?reply(feedback):reply({error:'Review expired or revoked.'},404);}
    if(query.get('list')==='1'){const access=await resolveEngineAccess();if(!access)return reply({error:'Sign in to manage reviews.'},401);return reply({links:await listReviewLinks(access.ownerKey,query.get('documentId')??undefined)});}
    if (query.get("owner") === "1") { const access = await resolveEngineAccess(); if (!access) return reply({error: "Sign in to manage review feedback."}, 401); const review = await readOwnerReview(access.ownerKey, token); return review ? reply({review}) : reply({error: "Review not found."}, 404); }
    const review = await getPublicReview(token); return review ? reply({review}) : reply({error: "This review link has expired or been revoked."}, 404);
  } catch { return reply({error: "Review is temporarily unavailable."}, 503); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({error: "Open the review in this site to comment."}, 403);
  try {
    const input = await body(request);
    if (typeof input.token === "string") {
      const comment=await addReviewComment(input.token,{name:input.name as string,text:input.text as string,pageId:input.pageId as string|undefined,parentId:input.parentId as string|undefined,elementId:input.elementId as string|undefined,anchor:input.anchor as {x:number;y:number}|undefined});return reply({comment},201);
    }
    const access = await resolveEngineAccess(); if (!access) return reply({error: "Sign in to create a review link."}, 401);
    if (typeof input.documentId !== "string") return reply({error: "Choose a saved design."}, 400);
    const result = await createReview(access.ownerKey, input.documentId, typeof input.days === "number" ? input.days : 7, typeof input.documentUpdatedAt === "string" ? input.documentUpdatedAt : undefined,typeof input.operationId==='string'&&/^[a-f0-9-]{36}$/i.test(input.operationId)?input.operationId:undefined);
    return reply({...result, url: `/engine/review/${result.token}`}, 201);
  } catch (cause) { return reply({error: cause instanceof Error ? cause.message : "Review could not be saved."}, cause instanceof PersistenceBusyError ? 503 : 400); }
}
export async function PATCH(request:Request){const access=await resolveEngineAccess();if(!access)return reply({error:'Sign in to resolve review comments.'},401);if(!sameOrigin(request))return reply({error:'Open the editor to manage feedback.'},403);try{const input=await body(request);if(typeof input.token!=='string'||typeof input.commentId!=='string'||typeof input.resolved!=='boolean')throw Error('Choose a comment and resolution.');await resolveReviewComment(access.ownerKey,input.token,input.commentId,input.resolved);return reply({ok:true});}catch(error){return reply({error:error instanceof Error?error.message:'Feedback could not be updated.'},400);}}
export async function DELETE(request: Request) {
  const access = await resolveEngineAccess(); if (!access) return reply({error: "Sign in to revoke a review link."}, 401);
  if (!sameOrigin(request)) return reply({error: "Open the editor to revoke a link."}, 403);
  try { const input = await body(request); if (typeof input.token !== "string") return reply({error: "Choose a review link."}, 400); await revokeReview(access.ownerKey, input.token); return reply({ok: true}); }
  catch { return reply({error: "Review link not found or could not be revoked."}, 404); }
}
