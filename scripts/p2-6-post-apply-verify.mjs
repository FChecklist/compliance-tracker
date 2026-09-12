#!/usr/bin/env bun
// *** THIS SCRIPT FAILS TODAY, BY DESIGN. *** V2 (write) and V3 (read) both
// return ok:false. Cause: PostgREST does not expose the `platform` schema
// by default (Project Settings > API > Exposed Schemas), so
// service-role-client.ts's supabase-js calls throw "Invalid schema:
// platform" before RLS is ever evaluated -- this is a TRANSPORT bug
// introduced when the C-13 fix (commit bfb1fcb8) moved these functions off
// the app_runtime drizzle connection (direct Postgres, no PostgREST) onto
// supabase-js. See PM-T23 for the 3 candidate fixes (a privileged Postgres
// credential + drizzle, or a SECURITY DEFINER function, or -- refused --
// exposing `platform` publicly). THIS SCRIPT IS THE REGRESSION TEST for
// whichever fix lands: rerun it, V2/V3 should both flip to ok:true, and
// only then does this header get to say otherwise.
//
// P2.6 post-apply verification (PM-directed, 2026-09-10, after PM applied
// drizzle/0577 + 0578 live via the Supabase MCP). Proves V2/V3 for real
// against the now-migrated database, not by assumption. Creates one
// throwaway test capability (capability_key starts with
// "p2_6_post_apply_verify_") via the real service functions, exercises the
// write+read paths, then deletes it via the service-role client so the
// registry is left clean. NOT a bun:test file -- not run by CI, not
// referenced by package.json or any test glob (bunfig.toml's `[test] root
// = "src"` excludes this scripts/ file anyway) -- this deliberately
// touches the live DB on purpose, run once, by hand.
import { findOrCreateCapability, recordExecutionOutcome, findCapabilityByKey } from "../src/lib/services/capability-learning-service.ts"
import { listImprovementProposals } from "../src/lib/services/capability-audit-service.ts"

const results = {}

try {
  const cap = await findOrCreateCapability({
    modePill: "p2_6_post_apply_verify",
    pathKeys: ["probe"],
    orgId: null,
  })
  results.v2_insert = { ok: true, id: cap.id, capabilityKey: cap.capabilityKey, orgId: cap.orgId }
} catch (err) {
  results.v2_insert = { ok: false, error: err instanceof Error ? err.message : String(err) }
}

if (results.v2_insert.ok) {
  try {
    await recordExecutionOutcome(results.v2_insert.id, "NOVEL")
    const after = await findCapabilityByKey("p2_6_post_apply_verify_probe")
    results.v2_update = { ok: true, novelCount: after?.novelCount, occurrenceCount: after?.occurrenceCount, status: after?.status }
  } catch (err) {
    results.v2_update = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

try {
  const proposals = await listImprovementProposals()
  results.v3_read = { ok: true, count: proposals.length }
} catch (err) {
  results.v3_read = { ok: false, error: err instanceof Error ? err.message : String(err) }
}

// Cleanup: delete the throwaway probe row via the service-role client
// directly (no serviceRoleDelete helper exists yet -- one-off inline use,
// not adding a delete helper to service-role-client.ts for a single verify
// script).
if (results.v2_insert.ok) {
  try {
    const { createClient } = await import("@supabase/supabase-js")
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      db: { schema: "platform" },
      auth: { persistSession: false },
    })
    const { error } = await admin.from("task_capabilities").delete().eq("id", results.v2_insert.id)
    results.cleanup = { ok: !error, error: error?.message }
  } catch (err) {
    results.cleanup = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

console.log(JSON.stringify(results, null, 2))
