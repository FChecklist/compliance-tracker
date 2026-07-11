import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { revokeJoinCode } from "@/lib/org-join-code-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser || (dbUser.role !== "admin" && dbUser.role !== "manager")) {
    return NextResponse.json({ error: "Only admins and managers can revoke join codes" }, { status: 403 });
  }
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  const { id } = await params;
  // Org scoping enforced by RLS inside revokeJoinCode's withTenantContext
  // call, not just this route's own orgId check -- a code belonging to a
  // different org simply won't be found/updated (0 rows), same result as
  // an explicit 404.
  const revoked = await revokeJoinCode(orgId, id, dbUser.id);
  if (!revoked) return NextResponse.json({ error: "Join code not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
