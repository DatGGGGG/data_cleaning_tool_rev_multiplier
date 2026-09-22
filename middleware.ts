import { NextRequest, NextResponse } from "next/server";
import { getWorkbenchSession, workbenchBasePath } from "@/lib/auth/session";

function applicationPath(pathname: string) {
  const basePath = workbenchBasePath();
  if (basePath && pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  if (basePath && pathname === basePath) return "/";
  return pathname;
}

function isPublicPath(pathname: string) {
  return pathname === "/auth/exchange" || pathname === "/api/health" || pathname.startsWith("/_next/") || pathname === "/favicon.ico";
}

function isPortalServiceRoute(pathname: string, method: string) {
  if (method !== "GET") return false;
  return /^\/api\/(top-down|bottom-up)\/versions(?:\/[0-9a-f-]+\/download)?$/i.test(pathname);
}

function isStateChanging(method: string) {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function expectedOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

function unauthorized(pathname: string) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "authentication_required", message: "Launch the workbench from the portal." } }, { status: 401 });
  }
  return new NextResponse("Authentication required. Return to the portal and launch the workbench again.", { status: 401 });
}

function csrfRejected(pathname: string) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "invalid_origin", message: "Same-origin request required." } }, { status: 403 });
  }
  return new NextResponse("Same-origin request required.", { status: 403 });
}

export async function middleware(request: NextRequest) {
  const pathname = applicationPath(request.nextUrl.pathname);
  if (isPublicPath(pathname)) return NextResponse.next();

  // These existing read-only endpoints authenticate the portal bearer token in
  // their route handlers. Let only their GET requests reach that validation.
  if (isPortalServiceRoute(pathname, request.method)) return NextResponse.next();

  const session = await getWorkbenchSession(request);
  if (!session) return unauthorized(pathname);

  if (isStateChanging(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== expectedOrigin(request)) return csrfRejected(pathname);
  }
  return NextResponse.next();
}

export const config = {
  // The explicit root matcher is required when Next.js applies basePath. Without
  // it, the exact `/cleaning/sensortower` URL can bypass the catch-all matcher.
  matcher: ["/", "/((?!_next/static|_next/image).*)"],
};
