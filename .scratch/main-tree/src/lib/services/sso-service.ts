// Wave 59 (Tier 3 #13, second half): Service-Provider-side SAML 2.0 SSO.
// @node-saml/node-saml (MIT) handles assertion signature validation,
// replay/timestamp checks, and audience restriction -- none of that is
// hand-rolled here. Session establishment reuses the EXISTING Supabase
// magic-link + /auth/callback code-exchange flow already in production
// (see src/app/auth/callback/route.ts) rather than inventing a second
// session mechanism.
//
// SAML login only authenticates a user who already exists in this org's
// `users` table by email -- it deliberately does NOT auto-provision new
// users from IdP assertions. Auto-provisioning is a distinct, higher-risk
// decision (an IdP could assert an email VERIDIAN has never vetted) that
// an admin should opt into explicitly in a future wave, not something to
// default to silently here.
import { SAML } from "@node-saml/node-saml"
import { db, ssoConfigurations, organisations, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"

export type SsoContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// ============================================================
// Admin config management (authenticated, org-scoped, admin-gated at the route layer)
// ============================================================

export async function getSsoConfiguration(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.ssoConfigurations.findFirst({ where: eq(ssoConfigurations.orgId, ctx.orgId) }) ?? null
  })
}

export async function upsertSsoConfiguration(
  ctx: SsoContext,
  input: { idpEntryPoint: string; idpIssuer: string; idpCert: string; spEntityId: string; isEnabled?: boolean }
) {
  if (!input.idpEntryPoint?.trim()) throw new ServiceError("idpEntryPoint is required", 400)
  if (!input.idpIssuer?.trim()) throw new ServiceError("idpIssuer is required", 400)
  if (!input.idpCert?.trim()) throw new ServiceError("idpCert is required", 400)
  if (!input.spEntityId?.trim()) throw new ServiceError("spEntityId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.ssoConfigurations.findFirst({ where: eq(ssoConfigurations.orgId, ctx.orgId) })

    if (existing) {
      const [updated] = await db.update(ssoConfigurations).set({
        idpEntryPoint: input.idpEntryPoint, idpIssuer: input.idpIssuer, idpCert: input.idpCert,
        spEntityId: input.spEntityId, isEnabled: input.isEnabled ?? existing.isEnabled, updatedAt: new Date(),
      }).where(eq(ssoConfigurations.id, existing.id)).returning()
      await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "sso_configuration.updated", entityType: "sso_configuration", entityId: existing.id })
      return updated
    }

    const [created] = await db.insert(ssoConfigurations).values({
      orgId: ctx.orgId, idpEntryPoint: input.idpEntryPoint, idpIssuer: input.idpIssuer,
      idpCert: input.idpCert, spEntityId: input.spEntityId, isEnabled: input.isEnabled ?? false, createdById: ctx.userId,
    }).returning()
    await logActivity({ tx: db, orgId: ctx.orgId, dbUser: ctx.dbUser, action: "sso_configuration.created", entityType: "sso_configuration", entityId: created.id })
    return created
  })
}

// ============================================================
// Public SAML flow (unauthenticated by definition -- this IS the login
// path). Uses the raw `db` export directly, matching this codebase's own
// established convention for public token/slug-scoped reads (see
// getGuestConversation in veri-chat-service.ts) -- every query below is
// explicitly scoped to the one org resolved from the slug, never a
// cross-org read.
// ============================================================

export async function getOrgBySlugWithSso(orgSlug: string) {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.slug, orgSlug) })
  if (!org) throw new ServiceError("Organisation not found", 404)
  const config = await db.query.ssoConfigurations.findFirst({ where: and(eq(ssoConfigurations.orgId, org.id), eq(ssoConfigurations.isEnabled, true)) })
  if (!config) throw new ServiceError("SSO is not enabled for this organisation", 404)
  return { org, config }
}

function buildSamlClient(config: typeof ssoConfigurations.$inferSelect, callbackUrl: string) {
  return new SAML({
    callbackUrl,
    entryPoint: config.idpEntryPoint,
    issuer: config.spEntityId,
    idpCert: config.idpCert,
    wantAssertionsSigned: true,
  })
}

/** Builds the redirect URL that sends the browser to the IdP's login page. */
export async function getSsoLoginRedirectUrl(orgSlug: string, callbackUrl: string): Promise<string> {
  const { config } = await getOrgBySlugWithSso(orgSlug)
  const saml = buildSamlClient(config, callbackUrl)
  return saml.getAuthorizeUrlAsync("", undefined, {})
}

/**
 * Validates the IdP's SAML assertion (signature, timestamps, audience --
 * all handled by @node-saml/node-saml, not hand-rolled) and looks up the
 * matching pre-existing user in this org by email. Throws if the
 * assertion is invalid, expired, or if no matching user exists --
 * SAML login never creates a new user.
 */
export async function validateSsoAssertionAndGetUser(orgSlug: string, samlResponse: string, callbackUrl: string) {
  const { org, config } = await getOrgBySlugWithSso(orgSlug)
  const saml = buildSamlClient(config, callbackUrl)

  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse })
  if (!profile) throw new ServiceError("SAML assertion could not be validated", 401)

  const email = (profile.email ?? profile.mail ?? profile.nameID)?.toLowerCase()?.trim()
  if (!email) throw new ServiceError("SAML assertion did not include an email address", 400)

  const user = await db.query.users.findFirst({ where: and(eq(users.email, email), eq(users.orgId, org.id)) })
  if (!user) throw new ServiceError("No matching user found for this organisation -- SAML login does not create new users", 403)

  return { org, user, email }
}
