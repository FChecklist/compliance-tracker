/**
 * MCP Token Management — admin-only
 *
 * Node runtime (uses Drizzle + postgres.js).
 * Requires Supabase session auth (requireAuth).
 * Only admin-role users can generate or revoke MCP tokens.
 *
 * GET  /api/mcp/tokens  — list tokens for the org
 * POST /api/mcp/tokens  — generate a new token
 * DELETE /api/mcp/tokens?id=<id> — revoke a token
 */

import { NextRequest, NextResponse } from 'next/server'
import { mcpAccessCodes } from '@/lib/db'
import { withTenantContext } from '@/lib/db/tenant-scoped'
import { eq, and } from 'drizzle-orm'
import { requireAuth, requireRole } from '@/lib/supabase/auth-guard'
import { createId } from '@paralleldrive/cuid2'
import { randomBytes } from 'crypto'

function generateToken(): string {
  return `ct_${randomBytes(32).toString('hex')}`
}

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

export async function POST(req: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, 'admin')
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ error: 'No organisation on this account' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name ?? 'API Token').slice(0, 80)

  const token = generateToken()
  const created = await withTenantContext({ orgId }, (db) =>
    db.insert(mcpAccessCodes).values({
      id: createId(),
      token,
      orgId,
      name,
    }).returning()
  )

  return NextResponse.json({
    id: created[0].id,
    name: created[0].name,
    token,
    warning: 'Save this token — it will not be shown again.',
    usage: {
      endpoint: 'https://veridian-compliance-ai.vercel.app/api/mcp',
      header: `Authorization: Bearer ${token}`,
    },
  }, { status: 201 })
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
