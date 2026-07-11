import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth-guard";
import { canAssignSeat } from "@/lib/org-license-service";
import {
  createInviteLink,
  listInviteLinks,
  isInviteRole,
  INVITE_ROLES,
} from "@/lib/invite-link-service";

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser || (dbUser.role !== "admin" && dbUser.role !== "manager")) {
    return NextResponse.json({ error: "Only admins and managers can manage invite links" }, { status: 403 });
  }
  if (!orgId) return NextResponse.json({ links: [] });

  const links = await listInviteLinks(orgId);
  // tokenHash is never returned -- only the display-safe fields an admin
  // needs to identify/manage a link, mirroring api/settings/api-keys'
  // keyPrefix-only listing convention.
  return NextResponse.json({
    links: links.map((l) => ({
      id: l.id,
      role: l.role,
      label: l.label,
      tokenPrefix: l.tokenPrefix,
      maxUses: l.maxUses,
      useCount: l.useCount,
      expiresAt: l.expiresAt.toISOString(),
      revokedAt: l.revokedAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth();
  if (response) return response;
  if (!dbUser || (dbUser.role !== "admin" && dbUser.role !== "manager")) {
    return NextResponse.json({ error: "Only admins and managers can create invite links" }, { status: 403 });
  }
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 });

  // Same posture as POST /api/users' seat check: block issuing a link that
  // would just fail for whoever redeems it, rather than letting them find
  // out only at signup time. Opt-in / no-op for the vast majority of orgs.
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
    const expiresInDays = typeof body.expiresInDays === "number" ? body.expiresInDays : undefined;
    const maxUses = typeof body.maxUses === "number" && body.maxUses > 0 ? Math.floor(body.maxUses) : null;

    const link = await createInviteLink({
      orgId,
      role,
      createdByUserId: dbUser.id,
      label,
      expiresInDays,
      maxUses,
    });

    const origin = request.nextUrl.origin;
    return NextResponse.json(
      {
        id: link.id,
        role: link.role,
        expiresAt: link.expiresAt.toISOString(),
        maxUses: link.maxUses,
        // The raw token is returned exactly once, here -- it is not
        // retrievable again after this response (only tokenHash is stored).
        url: `${origin}/invite/${link.token}`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Invite link creation error:", error);
    return NextResponse.json({ error: "Failed to create invite link" }, { status: 500 });
  }
}
