import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "./lib/auth/jwt";

const PUBLIC_PATHS = ["/login", "/auth/verify", "/api/auth/passcode", "/api/auth/magic-link", "/api/auth/passcode/verify"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/api") && !pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = request.cookies.get("auth-token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const payload = await verifySessionToken(token);
    if (!payload) {
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.set("auth-token", "", { maxAge: 0 });
      return response;
    }
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", payload.sub);
    requestHeaders.set("x-user-role", payload.role);
    requestHeaders.set("x-user-org-id", payload.org_id);
    requestHeaders.set("x-user-email", payload.email);
    return NextResponse.next({ headers: requestHeaders });
  } catch {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set("auth-token", "", { maxAge: 0 });
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};