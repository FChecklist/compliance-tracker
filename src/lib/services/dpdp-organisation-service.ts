// WO-DPDP-001 4.1 -- organisations, capabilities, membership, relationships.
// "Every org gets 'fiduciary' automatically" is enforced by the
// dpdp_organisation_auto_fiduciary DB trigger (drizzle/0415); this file
// never inserts into org_capability for that reason directly, only for an
// org deliberately ADDING a second capability (e.g. a CA firm is also a
// Processor for one client).
import { and, eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { db, dpdpOrganisation, dpdpOrgCapability, dpdpMembership, dpdpIdentity, dpdpIdentityEmail } from "@/lib/db"
import { withDpdpContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { logDpdpEvent } from "./dpdp-event-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return base || "org"
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name)
  let candidate = base
  let n = 1
  while (await db.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.slug, candidate) })) {
    n += 1
    candidate = `${base}-${n}`
  }
  return candidate
}

export type CreateOrganisationInput = {
  identityId: string
  name: string
  sector?: string
  // WO-DPDP-010: which library instantiateObligationsForOrg reads (31 firm
  // jobs vs 28 institution jobs). Defaults to 'firm' -- the product every
  // org used before this WO, and the /dpdp (no edition) signup path's
  // implicit product.
  product?: "firm" | "institution"
  extraCapabilities?: Array<"advisor" | "processor" | "auditor">
}

/**
 * "Open the account -- one person, free forever" (Home screen copy). The
 * creating identity becomes the org's first owner. can_sign is NEVER set
 * on this insert (the membership_no_sign_at_join DB trigger would reject
 * it) -- it is granted by a deliberate, separate UPDATE immediately after,
 * which is the work order's own "can_sign is never set at join time --
 * only by a later explicit act", applied to the very first owner too.
 */
export async function createDpdpOrganisation(input: CreateOrganisationInput) {
  if (!input.name.trim()) throw new ServiceError("An organisation name is required", 400)
  const slug = await uniqueSlug(input.name)

  return db.transaction(async (tx) => {
    const [org] = await tx.insert(dpdpOrganisation).values({ name: input.name.trim(), slug, sector: input.sector, product: input.product ?? "firm" }).returning()
    // The auto_fiduciary_capability trigger already inserted the
    // 'fiduciary' row for `org` -- add any others requested.
    for (const capability of input.extraCapabilities ?? []) {
      await tx.insert(dpdpOrgCapability).values({ orgId: org.id, capability }).onConflictDoNothing()
    }
    const [membership] = await tx.insert(dpdpMembership).values({
      identityId: input.identityId,
      orgId: org.id,
      level: "owner",
      joinedVia: "created",
    }).returning()
    await tx.update(dpdpMembership).set({ canSign: true }).where(eq(dpdpMembership.id, membership.id))

    await logDpdpEvent({ orgId: org.id, actorIdentityId: input.identityId, actorLabel: "Owner", kind: "organisation_created", summary: `Organisation "${org.name}" created` }, tx as never)
    return org
  })
}

/** The label used on event-log / "who did it" lines -- the primary email until there's a proper display-name field. */
export async function resolveIdentityLabel(identityId: string): Promise<string> {
  const email = await db.query.dpdpIdentityEmail.findFirst({ where: and(eq(dpdpIdentityEmail.identityId, identityId), eq(dpdpIdentityEmail.isPrimary, true)) })
  return email?.email ?? "Someone"
}

export async function listOrganisationsForIdentity(identityId: string) {
  const memberships = await db.query.dpdpMembership.findMany({ where: and(eq(dpdpMembership.identityId, identityId), eq(dpdpMembership.state, "active")) })
  const orgs = await Promise.all(memberships.map(async (m) => {
    const org = await db.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, m.orgId) })
    const caps = await db.query.dpdpOrgCapability.findMany({ where: eq(dpdpOrgCapability.orgId, m.orgId) })
    return { org, level: m.level, canSign: m.canSign, capabilities: caps.map((c) => c.capability) }
  }))
  return orgs.filter((o) => o.org)
}

export type InviteMemberInput = { orgId: string; actorIdentityId: string; email: string; level: "owner" | "staff" }

/**
 * "You type their email and choose what they can do. The link only works
 * for that address" (Adding someone, way ①). Creates the identity/email if
 * new, and a PENDING membership -- it becomes 'active' the first time that
 * identity signs in via a magic link scoped to this org (same as any other
 * dpdp identity resolution; there is no separate "accept invite" click,
 * the emailed link itself is the acceptance, matching the artefact's "you
 * never need a password" / "one email, one thing" posture).
 */
/**
 * db-handle-accepting variant, for a caller that already has an open
 * withDpdpContext transaction (e.g. nameDpdpRelationship below) -- see
 * tenant-scoped.ts's own header comment for why calling inviteDpdpMember
 * (which opens ITS OWN transaction) from inside another one is the exact
 * nested-withTenantContext bug class this repo has hit in production
 * before. Same established fix pattern as isBranchEnabledForOrgWithDb.
 *
 * Deliberately does NOT log a dpdp.event here (unlike every other write in
 * this file) -- membership/identity/identity_email have no RLS, but
 * dpdp.event does (org_id = dpdp.current_org_id()), and nameDpdpRelationship
 * calls this with a `tx` whose context is the ACTOR's org while `input.orgId`
 * is the COUNTERPART's (freshly created) org -- a real cross-tenant RLS
 * mismatch, found live via scripts/tmp-dpdp-smoke-test.ts. inviteDpdpMember
 * (below) logs the event itself, in its own correctly-scoped context, for
 * the normal (non-nested) call path.
 */
export async function inviteDpdpMemberWithDb(tx: TenantDb, input: InviteMemberInput) {
  const email = input.email.trim().toLowerCase()
  if (!email.includes("@")) throw new ServiceError("A valid email is required", 400)

  let identityRow = await tx.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, email) })
  let identityId: string
  if (identityRow) {
    identityId = identityRow.identityId
  } else {
    const [identity] = await tx.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
    await tx.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })
    identityId = identity.id
  }

  const existing = await tx.query.dpdpMembership.findFirst({ where: and(eq(dpdpMembership.identityId, identityId), eq(dpdpMembership.orgId, input.orgId)) })
  if (existing) throw new ServiceError("Already a member (or invited)", 409)

  const [membership] = await tx.insert(dpdpMembership).values({
    identityId, orgId: input.orgId, level: input.level, joinedVia: "invited", state: "pending",
  }).returning()

  return membership
}

export async function inviteDpdpMember(input: InviteMemberInput) {
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const membership = await inviteDpdpMemberWithDb(tx, input)
    await logDpdpEvent({ orgId: input.orgId, actorIdentityId: input.actorIdentityId, actorLabel: "Owner", kind: "membership_invited", summary: `Invited ${input.email.trim().toLowerCase()} as ${input.level}` }, tx)
    return membership
  })
}

/** "Change the name against the job. Their link stops working the same minute." */
export async function revokeDpdpMembership(orgId: string, actorIdentityId: string, membershipId: string) {
  const { revokeAllDpdpSessionsForIdentity } = await import("./dpdp-auth-service")
  return withDpdpContext({ orgId }, async (tx) => {
    const membership = await tx.query.dpdpMembership.findFirst({ where: and(eq(dpdpMembership.id, membershipId), eq(dpdpMembership.orgId, orgId)) })
    if (!membership) throw new ServiceError("Membership not found", 404)
    await tx.update(dpdpMembership).set({ state: "revoked", revokedAt: new Date() }).where(eq(dpdpMembership.id, membershipId))
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Owner", kind: "membership_revoked", summary: "Removed a member" }, tx)
    await revokeAllDpdpSessionsForIdentity(membership.identityId)
    return true
  })
}

/**
 * Verifies `actorOrgId` has an active relationship of one of `kinds` TOWARD
 * `targetOrgId` (actorOrgId is from_org) -- e.g. an advisor reading a
 * client's data map, an auditor reading an auditee's record. Throws 403
 * otherwise. Every "an advisor/auditor/processor reads another org's data"
 * service function must call this FIRST and explicitly -- withDpdpContext's
 * own RLS only checks org_id = current_org_id() on these tables (see
 * drizzle/0415's own note on which tables got relationship-aware policies
 * vs plain org_id ones), so a function that set the GUC to targetOrgId
 * without this check would grant access regardless of whether a real
 * relationship exists.
 */
export async function assertDpdpRelationship(
  actorOrgId: string,
  targetOrgId: string,
  kinds: Array<"advises" | "processes_for" | "audits">
) {
  const { dpdpRelationship } = await import("@/lib/db")
  const { inArray, isNull } = await import("drizzle-orm")
  // Must run under actorOrgId's own tenant context -- dpdp.relationship's
  // RLS is `from_org = current_org_id() OR to_org = current_org_id()`, and
  // the plain (unscoped) db client always has current_org_id() = NULL, so
  // this lookup would silently find zero rows and ALWAYS throw regardless
  // of whether a real relationship exists. Found by re-reading this
  // function while fixing the sibling RETURNING/RLS bugs above, not yet
  // hit by a test -- fixed before it shipped, not after.
  const rel = await withDpdpContext({ orgId: actorOrgId }, (tx) =>
    tx.query.dpdpRelationship.findFirst({
      where: and(
        eq(dpdpRelationship.fromOrg, actorOrgId),
        eq(dpdpRelationship.toOrg, targetOrgId),
        inArray(dpdpRelationship.kind, kinds),
        isNull(dpdpRelationship.endedAt)
      ),
    })
  )
  if (!rel) throw new ServiceError("No active relationship with that organisation", 403)
  return rel
}

export type NameRelationshipInput = {
  actorOrgId: string
  actorIdentityId: string
  counterpartOrgName: string
  counterpartEmail: string
  kind: "advises" | "processes_for" | "audits"
  scope?: string
}

/**
 * "Name the outside firms who hold our data" / "Our clients". The
 * relationship_no_self_declare DB trigger requires to_org = the acting
 * session's org for processes_for/audits -- so for those two kinds,
 * actorOrgId (the client/auditee) is to_org, and the named counterpart
 * becomes from_org (the processor/auditor), created here if it doesn't
 * exist yet as a bare organisation shell (it can flesh itself out the
 * first time one of its own people signs in). For 'advises' the direction
 * is the opposite: the ADVISOR names their client, so actorOrgId is
 * from_org.
 */
export async function nameDpdpRelationship(input: NameRelationshipInput) {
  return withDpdpContext({ orgId: input.actorOrgId }, async (tx) => {
    // NOTE (known, non-security limitation): dpdp.organisation's SELECT
    // policy is relationship-scoped -- this session cannot see a
    // counterpart org another, unrelated client already created (no
    // relationship exists between THIS actor and it yet), so naming the
    // "same" real-world firm from two different clients creates two
    // separate organisation rows rather than reusing one. Not a data leak
    // (each session only ever sees/creates its own), just a product
    // limitation -- fixing it would need a broader read grant on
    // dpdp.organisation, which is a deliberate tenant-isolation trade-off
    // for the Owner to make, not something to widen unilaterally here.
    let counterpart = await tx.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.name, input.counterpartOrgName.trim()) })
    if (!counterpart) {
      // Explicit id/createdAt instead of `.returning()`: the counterpart's
      // organisation row has no relationship to this session's org YET
      // (the relationship row below is what creates one), so the SELECT
      // half of RLS that `.returning()` implicitly performs would reject
      // reading the row right back -- found live via
      // scripts/tmp-dpdp-smoke-test.ts's org-creation path hitting the
      // identical problem (drizzle/0421). The id is generated client-side
      // by Drizzle's $defaultFn anyway, so we already have every field
      // needed to construct the object without reading it back.
      const id = createId()
      const createdAt = new Date()
      const slug = await uniqueSlug(input.counterpartOrgName)
      await tx.insert(dpdpOrganisation).values({ id, name: input.counterpartOrgName.trim(), slug, createdAt })
      counterpart = { id, name: input.counterpartOrgName.trim(), slug, sector: null, createdAt }
    }

    const fromOrg = input.kind === "advises" ? input.actorOrgId : counterpart.id
    const toOrg = input.kind === "advises" ? counterpart.id : input.actorOrgId

    const { dpdpRelationship } = await import("@/lib/db")
    const [rel] = await tx.insert(dpdpRelationship).values({ fromOrg, toOrg, kind: input.kind, scope: input.scope }).returning()

    await logDpdpEvent({ orgId: input.actorOrgId, actorIdentityId: input.actorIdentityId, actorLabel: "Owner", kind: "relationship_named", summary: `Named ${counterpart.name} (${input.kind})` }, tx)

    // Invite a first person at the counterpart org so someone can actually
    // sign the agreement -- "Send them the agreement" (Outside firms screen).
    // Uses the *WithDb variant: this is already inside the withDpdpContext
    // transaction opened above, and inviteDpdpMemberWithDb also targets a
    // DIFFERENT org (counterpart.id) than the one that transaction's GUC is
    // set to (input.actorOrgId) -- fine for a plain INSERT/SELECT (no RLS
    // policy on membership/identity/identity_email restricts by
    // dpdp.current_org_id() at all, see drizzle/0415's own note on which
    // tables got RLS), just not a second transaction.
    if (input.counterpartEmail) {
      await inviteDpdpMemberWithDb(tx, { orgId: counterpart.id, actorIdentityId: input.actorIdentityId, email: input.counterpartEmail, level: "owner" })
    }
    return rel
  })
}
