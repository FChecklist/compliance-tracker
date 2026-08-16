import { NextResponse } from "next/server";
import { previewInviteLink } from "@/lib/invite-link-service";

// Public, unauthenticated by design -- called by /signup before any
// Supabase Auth identity exists for the visitor, so they can see "You're
// joining <org> as <role>" before creating an account. Never returns
// anything beyond org name + role: no orgId, no admin identity, no way to
// reconstruct the token. Not under src/app/(app)/, so it's outside
// PROTECTED_APP_ROUTE_PREFIXES (scripts/generate-protected-routes.mjs) --
// same posture as /r/[token]'s referral-link preview.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await previewInviteLink(token);
  return NextResponse.json(preview);
}
