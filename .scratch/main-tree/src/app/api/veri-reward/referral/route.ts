import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import {
  getOrCreateReferralLink,
  listMyReferrals,
  type ReferralTargetType,
} from "@/lib/services/veri-reward-service"
import { requireVeriRewardEnabled, ServiceError } from "@/lib/services/veri-reward-enablement-service"

const VALID_TARGET_TYPES: ReferralTargetType[] = ["customer_to_customer", "veridian_growth"]

// GET: this user's referral links + status of everyone they've referred.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    await requireVeriRewardEnabled(orgId)
    const referrals = await withTenantContext({ orgId, userId: dbUser.id }, (db) => listMyReferrals(db, orgId, dbUser.id))
    return NextResponse.json({
      referrals: referrals.map((r) => ({
        referralToken: r.referralToken,
        targetType: r.targetType,
        status: r.status,
        clickCount: r.clickCount,
        rewardPoints: r.rewardPoints,
        createdAt: r.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Treasure referral list error:", error)
    return NextResponse.json({ error: "Failed to load referrals" }, { status: 500 })
  }
}

// POST: get-or-create this user's active shareable referral link. Both
// targetType values are available to any user for now -- they only affect
// reporting/attribution, not access, since points-only rewards are
// identical either way (Boss decision 2026-07-08).
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json().catch(() => ({}))
    const targetType = (body as { targetType?: string }).targetType ?? "customer_to_customer"
    if (!VALID_TARGET_TYPES.includes(targetType as ReferralTargetType)) {
      return NextResponse.json({ error: `targetType must be one of ${VALID_TARGET_TYPES.join(", ")}` }, { status: 400 })
    }

    await requireVeriRewardEnabled(orgId)

    const link = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      getOrCreateReferralLink(db, orgId, dbUser.id, targetType as ReferralTargetType)
    )
    return NextResponse.json({ referralToken: link.referralToken, targetType: link.targetType })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Treasure referral create error:", error)
    return NextResponse.json({ error: "Failed to create referral link" }, { status: 500 })
  }
}
