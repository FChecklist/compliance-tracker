// R63 (owner directive, 2026-08-29): session-authenticated endpoint the
// chat-box UI calls to fetch (creating if needed) the signed-in user's own
// AI-delegation link. Never accepts an org_id/user_id from the request --
// both come from requireAuth()'s resolved session, same discipline as
// every other route in this file (AR6).
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/auth-guard'
import { getOrCreateUserAiLink, revokeUserAiLink } from '@/lib/ai-links/user-links'

function buildUrl(request: Request, token: string): string {
  const origin = new URL(request.url).origin
  return `${origin}/api/mcp/${token}`
}

export async function GET(request: Request) {
  const { dbUser, orgId, response } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: 'No organisation on this account' }, { status: 400 })

  const { token } = await getOrCreateUserAiLink(orgId, dbUser.id)
  return NextResponse.json({ url: buildUrl(request, token) })
}

// Rotates the link -- revokes the old one, mints a fresh one. The old URL
// stops working the instant this returns (resolveAiLinkToken checks
// status='active', see user-links.ts).
export async function POST(request: Request) {
  const { dbUser, orgId, response } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: 'No organisation on this account' }, { status: 400 })

  await revokeUserAiLink(orgId, dbUser.id)
  const { token } = await getOrCreateUserAiLink(orgId, dbUser.id)
  return NextResponse.json({ url: buildUrl(request, token) })
}
