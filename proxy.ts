import {NextRequest, NextResponse} from "next/server";
import {isFrontendOrigin} from "./lib/engine/frontend-origin";

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  // Session transfer is only readable by its same-origin sign-in popup.
  const transfer = request.nextUrl.pathname === "/api/engine/pages-session";
  if (transfer || !isFrontendOrigin(origin)) return NextResponse.next();
  const response = request.method === "OPTIONS" ? new NextResponse(null, {status:204}) : NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin", origin!);
  response.headers.set("Vary", "Origin");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Image-Name, Last-Event-ID");
  response.headers.set("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}
export const config = {matcher: "/api/:path*"};
