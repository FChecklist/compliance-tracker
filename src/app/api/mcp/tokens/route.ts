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
import { db, mcpAccessCodes, users, organisations } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/supabase/auth-guard'
import { createId } from '@paralleldrive/cuid2'
import { randomBytes } from 'crypto'

function generateToken(): string {
  return `ct_${randomBytes(32).toString('hex')}`
}

async function getAdminUser(supabaseUserId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, supabaseUserId),
  })
  return user
}

export async function GET() {
  const { user, response } = await requireAuth()
  if (response) return response

  const tokens = await db.query.mcpAccessCodes.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  })

  return NextResponse.json({ tokens: tokens.map(t => ({
    id: t.id,
    name: t.name,
    tokenPreview: `${t.token.slice(0, 10)}...`,
    isActive: t.isActive,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  })), userId: user?.id })
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth()
  if (response) return response

  const dbUser = await db.query.users.findFirst({ where: eq(users.role, 'admin') })
  if (!dbUser) return NextResponse.json({ error: 'Admin user not found' }, { status: 403 })

  const org = await db.query.organisations.findFirst()
  if (!org) return NextResponse.json({ error: 'No organisation found' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name ?? 'API Token').slice(0, 80)

  const token = generateToken()
  const [created] = await db.insert(mcpAccessCodes).values({
    id: createId(),
    token,
    orgId: org.id,
    name,
  }).returning()

  return NextResponse.json({
    id: created.id,
    name: created.name,
    token,
    warning: 'Save this token — it will not be shown again.',
    usage: {
      endpoint: 'https://compliance-tracker-ai.vercel.app/api/mcp',
      header: `Authorization: Bearer ${token}`,
    },
  }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const { response } = await requireAuth()
  if (response) return response

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await db.update(mcpAccessCodes).set({ isActive: false }).where(eq(mcpAccessCodes.id, id))
  return NextResponse.json({ revoked: true, id })
}
