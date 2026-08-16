// GAP-CONNECTOR-LAYERS (Priority 14 Wave 2): Microsoft Office Add-in
// connector, Layer 2 of the 4-layer connector plan (ai-os/MASTER-TRACKER.yaml).
// This route is what the add-in's task pane calls right after a user pastes
// in a self-serve `vk_...` API key (minted at Settings > API Keys, POST
// /api/settings/api-keys -- zero new issuance mechanism invented here) --
// it lets the task pane confirm the key is valid and show "Connected as
// <org name> (<key name>)" before any compliance-item call is attempted.
// Reuses requireAuthOrApiKey()/validateApiKey() exactly as every other
// /api/v1 route does; no changes to auth-guard.ts's auth shape.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { organisations } from "@/lib/db"
import { eq } from "drizzle-orm"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const org = await withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.organisations.findFirst({ where: eq(organisations.id, ctx.orgId!), columns: { name: true } })
    )
    return NextResponse.json({
      orgName: org?.name ?? null,
      authMode: ctx.apiKey ? "api-key" : "session",
      keyName: ctx.apiKey?.name ?? null,
      scopes: ctx.apiKey?.scopes ?? ["read", "write"],
    })
  } catch (error) {
    console.error("v1 connectors/office-addin whoami error:", error)
    return NextResponse.json({ error: "Failed to resolve account" }, { status: 500 })
  }
}
