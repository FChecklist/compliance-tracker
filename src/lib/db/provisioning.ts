import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

// R48_ORG_PROVISION_RLS_BLOCKED_01 / ruling R-CRR-23.
//
// THE PROBLEM. compliance.organisations has RLS ENABLED **and FORCED**, and
// the only policy for the application role is:
//
//   app_runtime_tenant_isolation  ALL  USING (id = compliance.current_org_id())
//                                     WITH CHECK (id = compliance.current_org_id())
//
// An INSERT that creates a BRAND NEW organisation can never satisfy that
// WITH CHECK: the row being created is the very org that no tenant context
// can yet point at. Proved empirically rather than argued -- running the
// exact production INSERT under `SET ROLE app_runtime` returns
// "new row violates row-level security policy for table organisations",
// while the identical INSERT under a bypass-capable role succeeds. The
// consequence was total: NO new customer could be provisioned by ANY route.
//
// THE FIX, per R-CRR-23. You cannot be inside a tenant before the tenant
// exists -- SAP creates a company code from a system context, Odoo from the
// master path, Dynamics from an admin context. Provisioning is a PLATFORM
// operation, so the one row that brings the tenant into existence is written
// from an elevated connection. Everything afterwards is ordinary tenant work
// and goes back through app_runtime under normal RLS (see
// org-provisioning-service.ts, which sets the tenant context to the new org
// id and does the rest with withTenantContext).
//
// WHY THIS DOES NOT WEAKEN TENANT ISOLATION -- and why the obvious
// alternative was REJECTED: adding a permissive INSERT policy for
// app_runtime would let any authenticated tenant request create organisation
// rows for the lifetime of the app. This connection instead is:
//   1. server-side only -- it is never imported by a client component, and
//      the credential it uses is a server env var that never reaches a
//      browser;
//   2. reachable only from POST /api/v1/platform/provision-org, which is
//      authenticated with a platform application key and rate-limited;
//   3. used for EXACTLY ONE STATEMENT -- the organisations INSERT. It writes
//      nothing else, ever;
//   4. not a general-purpose escape hatch: every other write in the same
//      request stays on app_runtime with RLS enforcing org scoping.
//
// DO NOT import this module for anything except creating an organisation. If
// you find yourself reaching for it, you are almost certainly inside a tenant
// already and want withTenantContext() from ./tenant-scoped instead.

function getProvisioningConnectionString(): string {
  // An explicit, purpose-named variable is preferred so the elevated
  // connection is visible in the environment rather than implied.
  if (process.env.PROVISIONING_DATABASE_URL) return process.env.PROVISIONING_DATABASE_URL

  // Fall back to the same postgres-role pooler string db/connection-string.ts
  // already builds. The `postgres` role carries rolbypassrls, which is what
  // this needs; app_runtime deliberately does not.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const dbPassword = process.env.SUPABASE_DB_PASSWORD
  if (supabaseUrl && dbPassword) {
    const ref = supabaseUrl.replace("https://", "").split(".")[0]
    return `postgresql://postgres.${ref}:${dbPassword}@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`
  }

  // Fail loudly and specifically. A silent fallback to the app_runtime
  // connection would reintroduce the exact bug this module exists to fix,
  // and it would fail at the INSERT with a confusing RLS error instead of
  // here with an actionable one.
  throw new Error(
    "Organisation provisioning needs an elevated connection. Set PROVISIONING_DATABASE_URL " +
      "(or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD). It must NOT point at the app_runtime " +
      "role -- that role cannot create an organisation by design (see R48_ORG_PROVISION_RLS_BLOCKED_01)."
  )
}

let client: ReturnType<typeof postgres> | null = null
function getClient() {
  if (!client) {
    client = postgres(getProvisioningConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      // Signup/provisioning is low-volume and must not compete with request
      // traffic for pool slots.
      max: 2,
      connect_timeout: 10,
      idle_timeout: 30,
      // Same bounded-exposure posture as db/index.ts and tenant-scoped.ts,
      // added after the R46 300-second timeout incident.
      connection: { statement_timeout: 15_000 },
    })
  }
  return client
}

let rawDb: ReturnType<typeof drizzle<typeof schema>> | null = null

/**
 * Elevated, RLS-bypassing connection. ONLY for the single INSERT that brings
 * a new organisation into existence. See the header for why this exists and
 * the four constraints it operates under.
 */
export function getProvisioningDb() {
  if (!rawDb) rawDb = drizzle(getClient(), { schema })
  return rawDb
}
