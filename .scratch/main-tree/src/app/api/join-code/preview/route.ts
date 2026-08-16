import { NextRequest, NextResponse } from "next/server";
import { previewJoinCode } from "@/lib/org-join-code-service";

function extractIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Public, unauthenticated by design -- called by /signup as the user types
// a join code, before any Supabase Auth identity exists, so they can see
// "You're joining <org> as <role>" before creating an account (same UX as
// the invite-link preview). POST with the code in the request body, not a
// GET with the code in the URL like /api/invite/[token] -- a typed code is
// a secret the user is entering fresh, not a token already embedded in a
// link; keeping it out of the URL avoids it landing in browser history,
// server access logs, or referrer headers. Rate-limited via
// checkJoinCodeRateLimit inside previewJoinCode, same IP-keyed window the
// redemption path (auth-guard.ts) uses -- a probing attacker can't use this
// endpoint to enumerate codes for free either. Not under src/app/(app)/, so
// it's outside PROTECTED_APP_ROUTE_PREFIXES (scripts/generate-protected-routes.mjs).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  const preview = await previewJoinCode(code, extractIp(request));
  return NextResponse.json(preview);
}
