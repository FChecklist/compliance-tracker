import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { connectorAccounts } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { getConnectionStatus, CONNECTOR_TOOLKITS, type ConnectorToolkit } from "@/lib/composio-connectors"

// POST: re-checks Composio for this toolkit's current status and persists
// it. The frontend calls this while polling after the user returns from
// the OAuth popup -- Composio doesn't push a webhook to us for this, so a
// short client-side poll loop is the whole mechanism.
export async function POST(request: NextRequest, { params }: { params: Promise<{ toolkit: string }> }) {
  const { user, dbUser, orgId, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || !orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { toolkit } = await params
  if (!(toolkit in CONNECTOR_TOOLKITS)) {
    return NextResponse.json({ error: "Unknown toolkit" }, { status: 400 })
  }

  const row = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
    db.query.connectorAccounts.findFirst({
      where: and(eq(connectorAccounts.userId, dbUser.id), eq(connectorAccounts.toolkitSlug, toolkit as ConnectorToolkit)),
    })
  )
  if (!row) return NextResponse.json({ error: "No connection attempt found for this toolkit -- call POST /api/connectors first" }, { status: 404 })

  try {
    const { status, email } = await getConnectionStatus(row.composioConnectedAccountId)

    await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      db.update(connectorAccounts)
        .set({ status, connectedEmail: email ?? row.connectedEmail, updatedAt: new Date() })
        .where(eq(connectorAccounts.id, row.id))
    )

    return NextResponse.json({ toolkit, status, connectedEmail: email ?? row.connectedEmail })
  } catch (error) {
    console.error("Connector sync error:", error)
    const message = error instanceof Error ? error.message : "Failed to sync status"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
