import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { canAssignSeat } from "@/lib/org-license-service";
import {
  createJoinCode,
  listJoinCodes,
  isInviteRole,
  INVITE_ROLES,
} from "@/lib/org-join-code-service";

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser || (dbUser.role !== "admin" && dbUser.role !== "manager")) {
    return NextResponse.json({ error: "Only admins and managers can manage join codes" }, { status: 403 });
  }
  if (!orgId) return NextResponse.json({ codes: [] });

  const codes = await listJoinCodes(orgId);
  // codeHash is never returned -- only the display-safe fields an admin
  // needs to identify/manage a code, mirroring GET /api/invite-links.
  return NextResponse.json({
    codes: codes.map((c) => ({
      id: c.id,
      role: c.role,
      label: c.label,
      codePrefix: c.codePrefix,
      redeemCount: c.redeemCount,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      revokedAt: c.revokedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser || (dbUser.role !== "admin" && dbUser.role !== "manager")) {
    return NextResponse.json({ error: "Only admins and managers can create join codes" }, { status: 403 });
  }
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  // Same posture as POST /api/invite-links' seat check: block issuing a
  // code that would just fail for whoever redeems it.
  const seatCheck = await canAssignSeat(orgId);
  if (!seatCheck.allowed) {
    return NextResponse.json({ error: seatCheck.reason }, { status: 403 });
  }

  try {
    const body = await request.json();
    const role = typeof body.role === "string" ? body.role : "member";
    if (!isInviteRole(role)) {
      return NextResponse.json({ error: `Role must be one of: ${INVITE_ROLES.join(", ")}` }, { status: 400 });
    }
    const label = typeof body.label === "string" ? body.label : undefined;
    const expiresInDays = typeof body.expiresInDays === "number" && body.expiresInDays > 0 ? body.expiresInDays : null;

    const joinCode = await createJoinCode({
      orgId,
      role,
      createdByUserId: dbUser.id,
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
