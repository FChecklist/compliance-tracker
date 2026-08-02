import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { organisations, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { isPmsEnabledForOrg } from "@/lib/services/pms-enablement-service"
import { isVeriChatV2EnabledForOrg } from "@/lib/services/veri-chat-v2-enablement-service"
import { isFirmEnabledForOrg } from "@/lib/services/firm-enablement-service"
import { resolveBranding } from "@/lib/services/org-branding-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response

  const org = orgId
    ? await withTenantContext({ orgId }, (db) => db.query.organisations.findFirst({ where: eq(organisations.id, orgId) }))
    : null
  const pmsEnabled = orgId ? await isPmsEnabledForOrg(orgId) : false
  const veriChatV2Enabled = orgId ? await isVeriChatV2EnabledForOrg(orgId) : false
  const firmEnabled = orgId ? await isFirmEnabledForOrg(orgId) : false
  // Wave B (BYOB white-label branding): resolved here (not raw org columns)
  // so every consumer (AppShell for the sidebar logo/CSS vars, the Branding
  // settings section itself) gets the SAME already-defaulted values -- an
  // org that has never configured branding gets the real default VERIDIAN
  // AI colors/null-logo back, never a raw null a client would have to
  // remember to fall back on itself. See org-branding-service.ts's own
  // resolveBranding() header for why this is the only sanctioned read path.
  const branding = orgId ? await resolveBranding(orgId) : null

  return NextResponse.json({
    id: dbUser?.id ?? null,
    name: dbUser?.name ?? null,
    email: dbUser?.email ?? null,
    role: dbUser?.role ?? null,
    // Priority 18b (Owner directive 2026-07-15): read regardless of orgId
    // -- a pure stage-0 user has dbUser but orgId is null (no real home
    // org), and accountStage is exactly the signal AppShell needs to know
    // to render the restricted Chat-only nav.
    accountStage: dbUser?.accountStage ?? null,
    orgId: orgId ?? null,
    orgName: org?.name ?? null,
    orgSlug: org?.slug ?? null,
    orgEntityType: org?.entityType ?? null,
    orgAccountType: org?.accountType ?? "company",
    orgRegulatoryEntityType: org?.regulatoryEntityType ?? "general",
    pmsEnabled,
    veriChatV2Enabled,
    firmEnabled,
    orgPlan: org?.plan ?? "free",
    trialEndsAt: org?.trialEndsAt ? org.trialEndsAt.toISOString() : null,
    orgLogoUrl: branding?.logoUrl ?? null,
    brandName: branding?.brandName ?? "VERIDIAN AI OS",
    orgBrandPrimaryColor: branding?.primaryColor ?? null,
    orgBrandAccentColor: branding?.accentColor ?? null,
  })
}

export async function PATCH(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 })

  try {
    const body = await request.json()
    const { name, phone, orgName, orgAddress, orgCin, orgGstin, orgPan, orgAccountType, orgRegulatoryEntityType } = body
    const VALID_ACCOUNT_TYPES = ["company", "ca_firm", "legal_firm", "consultant"]
    const VALID_REGULATORY_TYPES = ["listed_company", "bank_nbfc", "insurer", "general"]

    if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

    await withTenantContext({ orgId }, async (db) => {
      // Update user profile
      if (name && typeof name === 'string' && name.trim()) {
        await db.update(users).set({ name: name.trim() }).where(eq(users.id, dbUser.id))
      }

      // Update org details (admin only)
      if (dbUser.role === 'admin') {
        const orgUpdate: Partial<typeof organisations.$inferInsert> = {}
        if (orgName && typeof orgName === 'string') orgUpdate.name = orgName.trim()
        if (orgAddress && typeof orgAddress === 'string') orgUpdate.address = orgAddress.trim()
        if (orgCin && typeof orgCin === 'string') orgUpdate.cinNumber = orgCin.trim()
        if (orgGstin && typeof orgGstin === 'string') orgUpdate.gstin = orgGstin.trim()
        if (orgPan && typeof orgPan === 'string') orgUpdate.panNumber = orgPan.trim()
        if (orgAccountType && VALID_ACCOUNT_TYPES.includes(orgAccountType)) orgUpdate.accountType = orgAccountType
        if (orgRegulatoryEntityType && VALID_REGULATORY_TYPES.includes(orgRegulatoryEntityType)) orgUpdate.regulatoryEntityType = orgRegulatoryEntityType
        if (Object.keys(orgUpdate).length > 0) {
          await db.update(organisations).set(orgUpdate).where(eq(organisations.id, orgId))
        }
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Profile update error:", error)
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 })
  }
}
