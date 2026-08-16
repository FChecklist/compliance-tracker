import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { connectorAccounts } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { CONNECTOR_TOOLKITS, initiateConnection, getConnectionStatus, type ConnectorToolkit } from "@/lib/composio-connectors"

// GET: current user's connector status for every known toolkit (connected + not-yet-connected).
export async function GET() {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const rows = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
    db.query.connectorAccounts.findMany({ where: eq(connectorAccounts.userId, dbUser.id) })
  )
  const byToolkit = new Map(rows.map((r) => [r.toolkitSlug, r]))

  const toolkits = (Object.keys(CONNECTOR_TOOLKITS) as ConnectorToolkit[]).map((slug) => {
    const row = byToolkit.get(slug)
    return {
      toolkit: slug,
      label: CONNECTOR_TOOLKITS[slug].label,
      connected: row?.status === "ACTIVE",
      status: row?.status ?? "NOT_CONNECTED",
      connectedEmail: row?.connectedEmail ?? null,
    }
  })

  return NextResponse.json({ toolkits })
}

// POST { toolkit }: starts a new OAuth connection for the caller. Returns the redirect_url to open.
export async function POST(request: NextRequest) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { toolkit } = (await request.json()) as { toolkit?: string }
  if (!toolkit || !(toolkit in CONNECTOR_TOOLKITS)) {
    return NextResponse.json({ error: `toolkit must be one of: ${Object.keys(CONNECTOR_TOOLKITS).join(", ")}` }, { status: 400 })
  }

  try {
    const result = await initiateConnection(toolkit as ConnectorToolkit, dbUser.id)

    await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.insert(connectorAccounts).values({
        orgId, userId: dbUser.id, toolkitSlug: toolkit,
        composioConnectedAccountId: result.connectedAccountId,
        status: "INITIALIZING",
      }).onConflictDoUpdate({
        target: [connectorAccounts.userId, connectorAccounts.toolkitSlug],
        set: { composioConnectedAccountId: result.connectedAccountId, status: "INITIALIZING", updatedAt: new Date() },
      })
    )

    return NextResponse.json({ redirectUrl: result.redirectUrl, connectedAccountId: result.connectedAccountId })
  } catch (error) {
    console.error("Connector initiate error:", error)
    const message = error instanceof Error ? error.message : "Failed to start connection"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
