export function GET() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key) {
    if(process.env.NODE_ENV!=="production")return Response.json({local:true},{headers:{"Cache-Control":"no-store"}});
    return Response.json({error:"Sign-in is not configured."},{status:503});
  }
  return Response.json({supabaseUrl:url,supabaseKey:key},{headers:{"Cache-Control":"no-store"}});
}
