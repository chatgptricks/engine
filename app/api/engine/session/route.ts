import {resolveEngineAccess} from "@/lib/engine/member";
import {editorOwnerScope} from "@/lib/template-editor/persistence";
export async function GET() {
  const access=await resolveEngineAccess();
  return Response.json(access?{scope:editorOwnerScope(access.ownerKey)}:{error:"Sign in to open your workspace."},{status:access?200:401,headers:{"Cache-Control":"private, no-store"}});
}
