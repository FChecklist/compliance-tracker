// Platform first-user link (fix/signup-first-user-link).
//
// THE GAP THIS CLOSES. A brand-new PROJEXA signup is provisioned by POST
// /api/v1/platform/provision-org, which creates the VERIDIAN organisation, its
// vk_ API key and its product-branch enablements -- and NO compliance.users row
// for the person who signed up. Everything that needs "who is this person" then
// answers USER_NOT_LINKED: resolveActingUser() here, and the ai-work-link Edge
// Function (supabase/functions/ai-work-link/mint.ts -> projexa_read_resolve_user,
// which matches compliance.users.auth_user_id to the PROJEXA session's `sub`),
// which is what put the red "not linked" text under the AI prompt button.
//
// THE FIX. When a request is authenticated by an API key that was ISSUED FOR A
// PLATFORM APPLICATION (api_keys.issued_for_application_id is not null: the key
// provision-org minted) and the organisation has ZERO users, the first person who
// shows up with the acting-user headers PROJEXA's server attaches (X-Acting-User =
// the verified session's Supabase id, X-Acting-User-Email) becomes the org's first
// user: role admin, authUserId = that id, so the ai-work-link lookup by `sub`
// resolves from then on.
//
// WHY THIS IS NOT A PRIVILEGE ESCALATION. It fires only for an org with no user at
// all, so it can never add a second person or raise anyone; a customer's own vk_
// key (issued_for_application_id null) never triggers it; and the headers come from
// a caller that already holds the org's secret key. Idempotent: users.email is
// UNIQUE, so a concurrent or repeated call inserts nothing and the loser re-reads.
import { and, eq } from "drizzle-orm"
import { db, users, departments } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { ServiceError } from "./service-error"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type FirstUserInput = {
  orgId: string | null | undefined
  /** api_keys.issued_for_application_id of the calling key; null/absent = a customer's own key, never auto-creates. */
  issuedForApplicationId: string | null | undefined
  actorEmail: string | null | undefined
  /** X-Acting-User: the verified PROJEXA session's Supabase id. Stored as auth_user_id only when it is a UUID. */
  actorId?: string | null
  actorName?: string | null
}

export type FirstUserOutcome = "created" | "skipped" | "org_has_users" | "email_taken"

export type FirstUserDeps = {
  orgHasUsers: (orgId: string) => Promise<boolean>
  defaultDepartmentId: (orgId: string) => Promise<string | null>
  /** Inserts the row. Returns its id, or null when the email already exists (UNIQUE conflict: nothing was written). */
  insertUser: (row: { name: string; email: string; orgId: string; departmentId: string | null; authUserId: string | null }) => Promise<string | null>
  afterCreate?: (userId: string, orgId: string) => Promise<void>
}

// Orgs known to have at least one user: a positive-only memo, so the common case (every request after the
// first) costs no query at all. An org with no user is never memoised, so it is checked again until it has one.
const orgsWithUsers = new Set<string>()
// One in-flight attempt per org, so a dashboard that fires several calls at once creates the user once.
const inFlight = new Map<string, Promise<FirstUserOutcome>>()

/** Test hook. */
export function resetFirstUserMemo(): void {
  orgsWithUsers.clear()
  inFlight.clear()
}

const defaultDeps: FirstUserDeps = {
  async orgHasUsers(orgId) {
    const row = await db.query.users.findFirst({ where: eq(users.orgId, orgId), columns: { id: true } })
    return !!row
  },
  async defaultDepartmentId(orgId) {
    const dept = await withTenantContext({ orgId }, (tx) =>
      tx.query.departments.findFirst({ where: and(eq(departments.orgId, orgId), eq(departments.name, "General")), columns: { id: true } })
    )
    if (dept) return dept.id
    const any = await withTenantContext({ orgId }, (tx) => tx.query.departments.findFirst({ where: eq(departments.orgId, orgId), columns: { id: true } }))
    return any?.id ?? null
  },
  async insertUser(row) {
    const inserted = await db
      .insert(users)
      .values({
        name: row.name,
        email: row.email,
        passwordHash: "supabase-auth-managed", // legacy NOT NULL column, real auth is via Supabase (same as autoProvisionUser)
        role: "admin",
        orgId: row.orgId,
        departmentId: row.departmentId,
        authUserId: row.authUserId,
        onboardingCompleted: false,
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id })
    return inserted[0]?.id ?? null
  },
  async afterCreate(userId, orgId) {
    // Same best-effort step autoProvisionUser runs for every new user; never blocks the link.
    const { provisionAiAssistantsForUser } = await import("@/lib/services/subscription-plan-service")
    await provisionAiAssistantsForUser(userId, orgId)
  },
}

async function attempt(input: FirstUserInput, deps: FirstUserDeps): Promise<FirstUserOutcome> {
  const orgId = input.orgId as string
  const email = (input.actorEmail ?? "").trim().toLowerCase()
  if (await deps.orgHasUsers(orgId)) {
    orgsWithUsers.add(orgId)
    return "org_has_users"
  }
  const departmentId = await deps.defaultDepartmentId(orgId)
  const actorId = (input.actorId ?? "").trim()
  const name = (input.actorName ?? "").trim() || email.split("@")[0]
  let id: string | null
  try {
    id = await deps.insertUser({ name, email, orgId, departmentId, authUserId: UUID_RE.test(actorId) ? actorId.toLowerCase() : null })
  } catch (err) {
    // The caller (ensureFirstPlatformUser) logs this and lets the request proceed unlinked: never a 500 for the person.
    console.warn("First-user insert failed:", err)
    throw new ServiceError("The first user of this organisation could not be created", 500, { code: "FIRST_USER_CREATE_FAILED" })
  }
  if (!id) return "email_taken" // someone (a parallel call) already owns this email: nothing was written
  orgsWithUsers.add(orgId)
  if (deps.afterCreate) {
    try {
      await deps.afterCreate(id, orgId)
    } catch (err) {
      console.warn("First-user AI assistant provisioning failed (non-fatal):", err)
    }
  }
  return "created"
}

/**
 * Makes the person on a platform-key request the org's first user when the org has none. Never throws:
 * a failure is logged and the request proceeds exactly as it would have without this.
 */
export async function ensureFirstPlatformUser(input: FirstUserInput, deps: FirstUserDeps = defaultDeps): Promise<FirstUserOutcome> {
  const orgId = input.orgId
  if (!orgId || !input.issuedForApplicationId) return "skipped"
  if (!EMAIL_RE.test((input.actorEmail ?? "").trim())) return "skipped"
  if (orgsWithUsers.has(orgId)) return "org_has_users"
  const running = inFlight.get(orgId)
  if (running) return running
  const p = attempt(input, deps)
    .catch((err): FirstUserOutcome => {
      console.warn(`First-user link failed for org ${orgId} (non-fatal):`, err)
      return "skipped"
    })
    .finally(() => inFlight.delete(orgId))
  inFlight.set(orgId, p)
  return p
}
