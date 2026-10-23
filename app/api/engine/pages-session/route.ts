import {getAuthServerClient, getCurrentAdminUser} from "@/lib/supabase/auth-server";
import {editorOwnerScope} from "@/lib/template-editor/persistence";
export async function GET(request:Request) {
  const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"};
  const site=request.headers.get("sec-fetch-site"),origin=request.headers.get("origin");
  if((site&&site!=="same-origin")||(origin&&origin!==new URL(request.url).origin))return Response.json({error:"Open sign-in from Engine."},{status:403,headers});
  if(!await getCurrentAdminUser())return Response.json({error:"Sign in to continue."},{status:401,headers});
  const client=await getAuthServerClient(),{data:{session}}=await client.auth.getSession();
  if(!session)return Response.json({error:"Sign in to continue."},{status:401,headers});
  return Response.json({access_token:session.access_token,refresh_token:session.refresh_token,scope:editorOwnerScope("owner")},{headers});
}
