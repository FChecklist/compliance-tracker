/**
 * MCP Token Management — admin-only
 *
 * @deprecated Wave 10: /api/mcp now authenticates against the unified
 * api_keys table (see resolveToken() in src/app/api/mcp/route.ts), not
 * mcp_access_codes. POST here is disabled -- it would mint a token /api/mcp
 * no longer accepts, which is worse than not offering it at all. GET/DELETE
 * stay functional so any already-existing legacy token can still be viewed
 * or revoked. New MCP access should be generated via Settings > API Keys
 * (POST /api/settings/api-keys) instead -- that same key also works for
 * /api/v1 (Wave 11) and any future non-browser surface, not just MCP.
 *
 * Node runtime (uses Drizzle + postgres.js).
 * Requires Supabase session auth (requireAuth).
 * Only admin-role users can view or revoke MCP tokens.
 *
 * GET  /api/mcp/tokens  — list legacy tokens for the org
 * POST /api/mcp/tokens  — disabled, returns 410 pointing to the new path
 * DELETE /api/mcp/tokens?id=<id> — revoke a legacy token
 */

import { NextRequest, NextResponse } from 'next/server'
import { mcpAccessCodes } from '@/lib/db'
import { withTenantContext } from '@/lib/db/tenant-scoped'
import { eq, and } from 'drizzle-orm'
import { requireAuth, requireRole } from '@/lib/supabase/auth-guard'

export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, 'admin')
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ tokens: [] })

  const tokens = await withTenantContext({ orgId }, (db) =>
    db.query.mcpAccessCodes.findMany({
      where: eq(mcpAccessCodes.orgId, orgId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    })
  )

  return NextResponse.json({ tokens: tokens.map(t => ({
    id: t.id,
    name: t.name,
    tokenPreview: `${t.token.slice(0, 10)}...`,
    isActive: t.isActive,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  })), userId: dbUser?.id })
}

export async function POST() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, 'admin')
  if (roleErr) return roleErr

  return NextResponse.json({
    error: 'This endpoint no longer issues usable MCP tokens.',
    reason: '/api/mcp now authenticates against Settings > API Keys, not mcp_access_codes.',
    useInstead: {
      endpoint: 'POST /api/settings/api-keys',
      note: 'Generate a key with the "read" or "write" scope you need, then use it as the Bearer token for /api/mcp (and any other external surface).',
    },
  }, { status: 410 })
}

export async function DELETE(req: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, 'admin')
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ error: 'No organisation on this account' }, { status: 400 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // RLS-scoped -- WHERE clause here is also explicit so a token id from
  // another org can never be revoked, regardless of RLS being the backstop.
  const result = await withTenantContext({ orgId }, (db) =>
    db.update(mcpAccessCodes).set({ isActive: false })
      .where(and(eq(mcpAccessCodes.id, id), eq(mcpAccessCodes.orgId, orgId)))
      .returning({ id: mcpAccessCodes.id })
  )

  if (result.length === 0) return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  return NextResponse.json({ revoked: true, id })
}
