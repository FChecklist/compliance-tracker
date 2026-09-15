// WO-DPDP-001 Phase 2 -- the DPDP-side equivalent of
// src/lib/supabase/auth-guard.ts's requireAuth(), deliberately NOT that
// file: dpdp.identity is a separate plane from compliance.users/Supabase
// Auth (see dpdp-auth-service.ts's own header), so a DPDP route reads its
// own cookie and looks up its own session table, never Supabase's.
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { resolveDpdpSession } from "./dpdp-auth-service"
import { db, dpdpMembership, dpdpOrgCapability } from "@/lib/db"
import { and, eq } from "drizzle-orm"

export const DPDP_SESSION_COOKIE = "dpdp_session"

export async function setDpdpSessionCookie(rawToken: string, expiresAt: Date): Promise<void> {
  const store = await cookies()
  store.set(DPDP_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  })
}

export async function clearDpdpSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(DPDP_SESSION_COOKIE)
}

export type DpdpIdentityContext = {
  identityId: string
  sessionId: string
  orgId: string | null // null only in the org-bootstrap window, see dpdp.session's schema.ts comment
}
export type DpdpAuthContext = DpdpIdentityContext & {
  orgId: string
  level: "owner" | "staff"
  canSign: boolean
  capabilities: Array<"advisor" | "fiduciary" | "processor" | "auditor">
}

/** The session alone, before any org/membership is known -- what the org-bootstrap flow needs. */
export async function getDpdpIdentityContext(): Promise<DpdpIdentityContext | null> {
  const store = await cookies()
  const raw = store.get(DPDP_SESSION_COOKIE)?.value
  if (!raw) return null
  const session = await resolveDpdpSession(raw)
  if (!session) return null
  return { identityId: session.identityId, sessionId: session.sessionId, orgId: session.orgId }
}

/**
 * Resolves the current DPDP session (cookie) into a full auth context
 * (requires an active org + membership), or null if there isn't one / it's
 * expired / revoked / has no org yet. Route handlers call
 * `requireDpdpSession()` (below) for the common "401 if absent" case;
 * this is exported separately for the rare page that wants to render
 * differently for a logged-out visitor rather than redirect.
 */
export async function getDpdpAuthContext(): Promise<DpdpAuthContext | null> {
  const identity = await getDpdpIdentityContext()
  if (!identity || !identity.orgId) return null

  const membership = await db.query.dpdpMembership.findFirst({
    where: and(eq(dpdpMembership.identityId, identity.identityId), eq(dpdpMembership.orgId, identity.orgId), eq(dpdpMembership.state, "active")),
  })
  if (!membership) return null

  const capRows = await db.query.dpdpOrgCapability.findMany({ where: eq(dpdpOrgCapability.orgId, identity.orgId) })

  return {
    identityId: identity.identityId,
    orgId: identity.orgId,
    sessionId: identity.sessionId,
    level: membership.level,
    canSign: membership.canSign,
    capabilities: capRows.map((c) => c.capability),
  }
}

/** For API routes: returns the context, or a ready-to-return 401 NextResponse. */
export async function requireDpdpSession(): Promise<{ ctx: DpdpAuthContext } | { response: NextResponse }> {
  const ctx = await getDpdpAuthContext()
  if (!ctx) return { response: NextResponse.json({ error: "Sign in first" }, { status: 401 }) }
  return { ctx }
}

/** For the one route that runs before any organisation exists: create-organisation. */
export async function requireDpdpIdentity(): Promise<{ ctx: DpdpIdentityContext } | { response: NextResponse }> {
  const ctx = await getDpdpIdentityContext()
  if (!ctx) return { response: NextResponse.json({ error: "Sign in first" }, { status: 401 }) }
  return { ctx }
}

/** For API routes that additionally require the owner-level "may sign" bit. */
export async function requireDpdpSigner(): Promise<{ ctx: DpdpAuthContext } | { response: NextResponse }> {
  const result = await requireDpdpSession()
  if ("response" in result) return result
  if (!result.ctx.canSign) return { response: NextResponse.json({ error: "Only someone who may sign can do this" }, { status: 403 }) }
  return result
}
