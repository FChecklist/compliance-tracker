// gtm-provision-cat15-16-test-tenant.ts
//
// Owner-delegated real decision (PM-authorized, see
// ai-os/boss/ACTIVE-CLAIMS.yaml entry "task-20260806-215747-owner-delegated-
// decision--provision-a-re" and pm_decisions_pending id=69/id=70): provisions
// ONE real, obviously-fictional, clearly test-flagged dummy tenant + one real
// account per standard B2B SaaS tenant role (owner/admin, manager, member,
// viewer -- source: descope.com RBAC providers guide, WorkOS multi-tenant
// RBAC design guide, both converge on this 4-role pattern), so GTM
// certification category 15 (multi-tenant isolation testing) and category 16
// (role permission testing) can run for real instead of staying BLOCKED on
// "no Owner-provisioned test credential exists".
//
// Mechanism (verified live, matches existing prior art -- see
// scripts/wave111-create-hero-logins.ts and
// /opt/veridian/ai-os/planning/scripts/create-or-reset-demo-login.mjs):
//   - compliance.users.password_hash is dead-code for auth (real auth is
//     100% Supabase Auth, project pcrjmlpuqsbocqfwoxod "verdian-ai"). Every
//     row here gets the same literal placeholder every other real signup
//     path uses ("supabase-auth-managed"), matching auth-guard.ts:165.
//   - The ONLY place a real password is ever stored is Supabase Auth's own
//     encrypted store (auth.users), created via the service-role Admin API
//     -- exactly how every other real account's credential is stored on
//     this platform. This script never writes a password anywhere in
//     Postgres.
//   - compliance.users is matched to auth.users BY EMAIL; auth_user_id
//     self-heals on first authenticated request (auth-guard.ts:275-277).
//     This script also sets it immediately via a direct UPDATE so the link
//     is confirmed without waiting on a login.
//
// Credential handling: each of the 4 passwords is freshly generated
// (crypto.randomBytes, 24 bytes / 32 base64url chars) at run time, never
// hardcoded, never committed to any tracked file. Written ONLY to a local
// .env.local (gitignored -- `.env*` in .gitignore) next to this script.
// Re-running this script is idempotent: an existing org/user is detected
// and its Supabase Auth password is reset (not duplicated), and .env.local
// is rewritten with the new values rather than duplicated.
//
// Usage (from this task workspace, needs .env.local with DATABASE_URL +
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, and node_modules
// symlinked from the shared compliance-tracker checkout for its installed
// deps -- both already present in this workspace):
//   node --env-file=.env.local node_modules/.bin/tsx scripts/gtm-provision-cat15-16-test-tenant.ts

import { randomBytes } from "node:crypto"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { eq } from "drizzle-orm"
import * as schema from "../src/lib/db/schema"

const ENV_LOCAL_PATH = new URL("../.env.local", import.meta.url).pathname

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DATABASE_URL = process.env.DATABASE_URL

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DATABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL.")
  console.error("Run with: node --env-file=.env.local node_modules/.bin/tsx scripts/gtm-provision-cat15-16-test-tenant.ts")
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const client = postgres(DATABASE_URL, { prepare: false })
const db = drizzle(client, { schema })

// Obviously-fictional, clearly test-flagged -- deliberately distinct from
// the 3 pre-existing "Meridian *" orgs already in this database
// (meridian-auto / meridian-construction-e2e-test / meridian-skyline-group,
// none of which are named as a test fixture) so this new one is never
// mistaken for any of them or for a real company.
const ORG_NAME = "Meridian Test Industries (GTM Cat 15/16 Test Fixture -- Non-Production)"
const ORG_SLUG = "meridian-test-industries-gtm-fixture-nonprod"
// RFC 2606-reserved-style, deliberately never-deliverable domain, matching
// this codebase's own existing convention for synthetic demo/test accounts
// (scripts/wave111-create-hero-logins.ts uses `*.veridiandemo.internal`).
const EMAIL_DOMAIN = "meridian-test-industries.veridiandemo.internal"

type Persona = {
  key: "owner" | "manager" | "member" | "viewer"
  // NonNullable: the `role` column has a DB-side default ('member'), so
  // drizzle's own $inferInsert type marks it optional/possibly-undefined --
  // every PERSONA entry below always supplies a real, explicit value, so
  // strip that possibility here rather than threading `| undefined`
  // through every downstream use (results[], writeEnvLocal, etc).
  role: NonNullable<typeof schema.users.$inferInsert["role"]>
  name: string
  email: string
}

// SPEC role names: "owner or admin, manager, member, and viewer" -- this
// schema's userRoleEnum has no distinct "owner" value (verified
// src/lib/db/schema.ts:12-16); its top role is "admin", already established
// as the correct owner/CEO-equivalent seat (see /opt/veridian/ai-os/
// planning/PLAN-07-08-15-16-deep-eval.yaml's PLAN-15 role_note, same
// finding independently re-derived here from the same enum).
const PERSONAS: Persona[] = [
  { key: "owner", role: "admin", name: "Meridian Test Owner (Admin)", email: `owner@${EMAIL_DOMAIN}` },
  { key: "manager", role: "manager", name: "Meridian Test Manager", email: `manager@${EMAIL_DOMAIN}` },
  { key: "member", role: "member", name: "Meridian Test Member", email: `member@${EMAIL_DOMAIN}` },
  { key: "viewer", role: "viewer", name: "Meridian Test Viewer", email: `viewer@${EMAIL_DOMAIN}` },
]

function generatePassword(): string {
  // 24 random bytes -> 32-char base64url, well above any real strength bar,
  // never derived from anything guessable.
  return randomBytes(24).toString("base64url") + "!Aa1"
}

async function findExistingAuthUserByEmail(targetEmail: string) {
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === targetEmail.toLowerCase())
    if (hit) return hit
    if (data.users.length < perPage) return null
    page++
  }
}

async function createOrResetAuthUser(email: string, password: string): Promise<string> {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (!createErr) return created.user!.id
  if (!/already.*registered|already exists/i.test(createErr.message || "")) {
    throw new Error(`createUser failed for ${email}: ${createErr.message}`)
  }
  const existing = await findExistingAuthUserByEmail(email)
  if (!existing) throw new Error(`createUser said "already registered" but listUsers found no match for ${email}`)
  const { data: updated, error: updateErr } = await admin.auth.admin.updateUserById(existing.id, {
    password, email_confirm: true,
  })
  if (updateErr) throw new Error(`password reset failed for ${email}: ${updateErr.message}`)
  return updated.user!.id
}

function writeEnvLocal(orgId: string, entries: { key: Persona["key"]; email: string; password: string }[]) {
  const existing = existsSync(ENV_LOCAL_PATH) ? readFileSync(ENV_LOCAL_PATH, "utf8") : ""
  const marker = "# --- gtm-provision-cat15-16-test-tenant.ts (generated; do not hand-edit) ---"
  const lines = existing.split("\n")
  const markerIdx = lines.indexOf(marker)
  const before = markerIdx === -1 ? lines : lines.slice(0, markerIdx)
  const block = [
    marker,
    `GTM_TEST_MERIDIAN_ORG_ID="${orgId}"`,
    `GTM_TEST_MERIDIAN_ORG_SLUG="${ORG_SLUG}"`,
    ...entries.flatMap((e) => [
      `GTM_TEST_MERIDIAN_${e.key.toUpperCase()}_EMAIL="${e.email}"`,
      `GTM_TEST_MERIDIAN_${e.key.toUpperCase()}_PASSWORD="${e.password}"`,
    ]),
    "# --- end gtm-provision-cat15-16-test-tenant.ts block ---",
    "",
  ]
  const finalContent = [...before, ...block].join("\n")
  writeFileSync(ENV_LOCAL_PATH, finalContent, { mode: 0o600 })
}

async function main() {
  console.log(`[provision] target org slug: ${ORG_SLUG}`)

  let org = await db.query.organisations.findFirst({ where: eq(schema.organisations.slug, ORG_SLUG) })
  if (!org) {
    ;[org] = await db.insert(schema.organisations).values({
      name: ORG_NAME,
      slug: ORG_SLUG,
      plan: "free",
      accountType: "company",
      isActive: true,
      // Closest real existing "this org is for VERIDIAN's own internal
      // use/testing" flag in this schema (src/lib/db/schema.ts:97 comment)
      // -- there is no dedicated is_test_tenant column, so name + slug +
      // this flag together are the "clearly test flagged tenant" signal.
      internalUseExempt: true,
    }).returning()
    console.log(`[provision] created NEW org: ${org.id}`)
  } else {
    console.log(`[provision] org already exists: ${org.id} (idempotent re-run)`)
  }

  const results: { key: Persona["key"]; role: string; email: string; password: string; complianceUserId: string; authUserId: string }[] = []

  for (const persona of PERSONAS) {
    const password = generatePassword()
    const authUserId = await createOrResetAuthUser(persona.email, password)

    let dbUser = await db.query.users.findFirst({ where: eq(schema.users.email, persona.email) })
    if (!dbUser) {
      ;[dbUser] = await db.insert(schema.users).values({
        name: persona.name,
        email: persona.email,
        passwordHash: "supabase-auth-managed", // legacy NOT NULL column, matches every other real signup path
        role: persona.role,
        orgId: org.id,
        isActive: true,
        onboardingCompleted: true, // skip onboarding gate -- this account exists purely for automated API testing
        authUserId,
      }).returning()
      console.log(`[provision] created compliance.users row for ${persona.email}: ${dbUser.id}`)
    } else {
      await db.update(schema.users).set({ authUserId, orgId: org.id, role: persona.role, isActive: true }).where(eq(schema.users.id, dbUser.id))
      console.log(`[provision] reset/relinked existing compliance.users row for ${persona.email}: ${dbUser.id}`)
    }

    results.push({ key: persona.key, role: persona.role, email: persona.email, password, complianceUserId: dbUser.id, authUserId })
  }

  writeEnvLocal(org.id, results.map((r) => ({ key: r.key, email: r.email, password: r.password })))

  console.log("\n[provision] SUCCESS. Real credentials written to .env.local (gitignored), never printed here.")
  console.log(JSON.stringify({
    org_id: org.id,
    org_slug: ORG_SLUG,
    org_name: ORG_NAME,
    accounts: results.map((r) => ({ role: r.role, email: r.email, compliance_user_id: r.complianceUserId, auth_user_id: r.authUserId })),
  }, null, 2))

  await client.end()
}

main().catch((e) => {
  console.error("[provision] UNEXPECTED ERROR:", e)
  process.exit(1)
})
