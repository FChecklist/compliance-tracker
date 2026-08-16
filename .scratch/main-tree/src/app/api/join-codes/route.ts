import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { canAssignSeat } from "@/lib/org-license-service";
import {
  createJoinCode,
  listJoinCodes,
  isInviteRole,
  isPrivilegedMinter,
  resolveAllowedMintRoles,
  resolvePeerExpiryDays,
  countActiveCodesForCreator,
  PEER_MAX_ACTIVE_CODES,
} from "@/lib/org-join-code-service";

// Path D (peer-provided-code self-registration): this route is no longer
// admin/manager-only. ANY authenticated org member may mint/list their own
// join codes now -- see org-join-code-service.ts's header comment for the
// full privilege-escalation reasoning (rank-ceiling on the grantable role,
// plus forced expiry + an active-code cap for non-privileged minters).

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser) return NextResponse.json({ codes: [] });
  if (!orgId) return NextResponse.json({ codes: [] });

  const privileged = isPrivilegedMinter(dbUser.role);
  // Non-privileged callers only ever see codes THEY created -- an org's
  // full join-code list stays admin/manager-only, same info-disclosure
  // posture as before for anyone who isn't the peer who minted a given code.
  const codes = await listJoinCodes(orgId, privileged ? undefined : { createdByUserId: dbUser.id });
  // codeHash is never returned -- only the display-safe fields a caller
  // needs to identify/manage a code, mirroring GET /api/invite-links.
  return NextResponse.json({
    codes: codes.map((c) => ({
      id: c.id,
      role: c.role,
      label: c.label,
      codePrefix: c.codePrefix,
      redeemCount: c.redeemCount,
      createdByRole: c.createdByRole,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      revokedAt: c.revokedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
    orgWide: privileged,
  });
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  // Same posture as POST /api/invite-links' seat check: block issuing a
  // code that would just fail for whoever redeems it. Applies to every
  // minter equally, privileged or not.
  const seatCheck = await canAssignSeat(orgId);
  if (!seatCheck.allowed) {
    return NextResponse.json({ error: seatCheck.reason }, { status: 403 });
  }

  const privileged = isPrivilegedMinter(dbUser.role);
  const allowedRoles = resolveAllowedMintRoles(dbUser.role);

  if (!privileged) {
    const activeCount = await countActiveCodesForCreator(orgId, dbUser.id);
    if (activeCount >= PEER_MAX_ACTIVE_CODES) {
      return NextResponse.json(
        { error: `You already have ${PEER_MAX_ACTIVE_CODES} active join codes. Revoke one before creating another.` },
        { status: 429 }
      );
    }
  }

  try {
    const body = await request.json();
    const role = typeof body.role === "string" ? body.role : "member";
    if (!isInviteRole(role) || !allowedRoles.includes(role)) {
      // Distinct message from a plain "invalid role" -- this is a real
      // privilege-ceiling rejection, not a typo in the request body.
      return NextResponse.json(
        { error: `You can only create join codes for: ${allowedRoles.join(", ")}` },
        { status: 403 }
      );
    }
    const label = typeof body.label === "string" ? body.label : undefined;
    const requestedExpiresInDays = typeof body.expiresInDays === "number" ? body.expiresInDays : null;
    // Privileged (admin/manager) keeps Path C's exact behavior: null/absent
    // means no forced expiry. Non-privileged (peer) always gets a real
    // expiry, clamped server-side regardless of what the client sent.
    const expiresInDays = privileged
      ? (requestedExpiresInDays != null && requestedExpiresInDays > 0 ? requestedExpiresInDays : null)
      : resolvePeerExpiryDays(requestedExpiresInDays);

    const joinCode = await createJoinCode({
      orgId,
      role,
      createdByUserId: dbUser.id,
      createdByRole: dbUser.role,
      label,
      expiresInDays,
    });

    return NextResponse.json(
      {
        id: joinCode.id,
        role: joinCode.role,
        expiresAt: joinCode.expiresAt?.toISOString() ?? null,
        // The raw code is returned exactly once, here -- it is not
        // retrievable again after this response (only codeHash is stored).
        code: joinCode.code,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Join code creation error:", error);
    return NextResponse.json({ error: "Failed to create join code" }, { status: 500 });
  }
}
