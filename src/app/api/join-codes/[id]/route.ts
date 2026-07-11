import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { revokeJoinCode, isPrivilegedMinter } from "@/lib/org-join-code-service";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  const { id } = await params;
  const privileged = isPrivilegedMinter(dbUser.role);
  // Path D: a non-privileged (peer) caller may only revoke a code THEY
  // created -- restrictToCreatedBy enforces that ownership check inside
  // the same UPDATE ... WHERE, so a peer can never revoke someone else's
  // code just by guessing/enumerating an id. Privileged (admin/manager)
  // callers keep Path C's unrestricted behavior (revoke any org code).
  //
  // Org scoping enforced by RLS inside revokeJoinCode's withTenantContext
  // call, not just this route's own orgId check -- a code belonging to a
  // different org simply won't be found/updated (0 rows), same result as
  // an explicit 404.
  const revoked = await revokeJoinCode(orgId, id, dbUser.id, privileged ? undefined : dbUser.id);
  if (!revoked) return NextResponse.json({ error: "Join code not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
