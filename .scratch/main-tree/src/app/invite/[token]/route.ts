import { NextRequest, NextResponse } from "next/server";

// Public shareable-link landing route -- what an admin actually copies and
// sends via WhatsApp/email. Deliberately a thin redirect (not its own page)
// so the real validation logic lives in one place, GET /api/invite/[token]
// (called client-side by /signup), rather than duplicated here. Same
// "redirect straight into /signup with a query param" shape as
// src/app/r/[token]/route.ts's referral-link redirect. Not under
// src/app/(app)/, so it's outside PROTECTED_APP_ROUTE_PREFIXES -- reachable
// with no session, which is the whole point.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL("/signup", request.url);
  url.searchParams.set("invite", token);
  return NextResponse.redirect(url);
}
