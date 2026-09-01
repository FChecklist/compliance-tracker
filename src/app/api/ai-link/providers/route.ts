// R63 (owner directive, 2026-08-29): serves the data-driven connector list
// to the picker UI. Session-authenticated (not public) purely to match this
// route family's own convention -- the data itself is not per-org.
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/auth-guard'
import { listActiveConnectorProviders } from '@/lib/ai-links/connector-providers'

export async function GET() {
  const { response } = await requireAuth()
  if (response) return response

  const providers = await listActiveConnectorProviders()
  return NextResponse.json({ providers })
}
