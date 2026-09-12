#!/usr/bin/env bun
// P2.2 (W-ENV, R81-ADDENDUM-B phase S5): test-tenant scoping checker.
//
// WHAT. Every e2e spec or fixture in this repo's e2e/ tree must only ever
// exercise a tenant (a row in `compliance.organisations`) whose slug starts
// with the literal prefix "test-" -- UNLESS it is a deliberate,
// already-reviewed exception that exists specifically to verify real
// production/demo behaviour (see EXCEPTIONS below; those are print-only,
// never a failure, and must say why in their own file). This script:
//   (a) statically scans e2e/**/*.ts for every tenant-identifying literal it
//       knows how to recognise -- an email address (its domain or full
//       address identifies the tenant) or a raw UUID -- and FAILS if any
//       such literal is NOT listed in REGISTRY or EXCEPTIONS below. This is
//       the drift guard: a new e2e file that quietly starts hitting a
//       different tenant can't slip in unreviewed, it has to be classified
//       first.
//   (b) when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set,
//       live-checks every REGISTRY row against the real
//       `compliance.organisations.slug` (via the service role, which
//       bypasses RLS on purpose -- see the comment on liveCheck() for why
//       this table's own app_runtime connection cannot be used here) and
//       FAILS if the slug does not start with "test-".
//
// WHY. See scripts/gtm-provision-cat15-16-test-tenant.ts and R81-ADDENDUM-B
// Part A: this repo and projexa share one database per environment: an e2e
// run that accidentally touches real/demo data pollutes the same rows
// production reads from the moment Vercel unpauses.
//
// INVENTORY (2026-09-10), by file:
//   e2e/fixtures/r74-tenants.ts, r74-roles.ts  -- R74_TENANT_A_ID /
//     R74_TENANT_B_ID (env, from .env.r74-test.local), slugs were
//     "r74-test-tenant-a"/"-b" (contained "test" but did not START with
//     "test-") -- renamed to "test-r74-tenant-a"/"-b" as part of this fix.
//   e2e/demo-gate-smoke.spec.ts   -- EXCEPTION: deliberately runs against
//     real production/demo (democeo@projexa-ai.com, "Demo Organization")
//     by design (R38/WO-11) to guard a path already proven live; a
//     "test-" tenant would not exercise what this test exists to prove.
//     Self-skips when its target (ENV 2, projexa-ai.com) is unreachable,
//     which is the case whenever Vercel stays paused -- see R81-ADDENDUM-B.
//   e2e/r63-local-composer.spec.ts -- EXCEPTION: explicitly a local-only
//     manual diagnostic (test.skip(!!process.env.CI, ...)), same demo
//     account, never runs unattended.
//   e2e/r48-uat-bank-reachability.spec.ts -- EXCEPTION: explicitly, by its
//     own header comment, a deliberate choice to log in as a real,
//     richer-data account (Skyline Builders) for a UAT reachability check;
//     run by hand as a script, not part of routine CI.
//   e2e/accessibility.spec.ts, browser-execution-tiers.spec.ts -- no login,
//     no tenant reference; not in REGISTRY or EXCEPTIONS because there is
//     nothing to register.
//
// USAGE.
//   bun scripts/check-test-tenant-scoping.mjs                # static + live (if service role env set)
//   bun scripts/check-test-tenant-scoping.mjs --static-only   # skip the DB round-trip
//
// EXIT CODE. 0 = every literal found is registered or an explicit
// exception, and every live-checked registry row's slug starts with
// "test-". 1 = otherwise.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Windows import.meta.url gotcha: always resolve via fileURLToPath, never by
// string-slicing the URL (silently no-ops otherwise).
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const SCAN_DIRS = ["e2e"];

// ---------------------------------------------------------------------------
// REGISTRY -- tenants that MUST be test-scoped (slug must start with
// "test-"). Extend this when e2e grows a new isolated test tenant.
// ---------------------------------------------------------------------------
const REGISTRY = [
  {
    match: { type: "env-derived", value: "R74_TENANT_A_ID" },
    id: "f384a4fc-7193-4296-929c-32646879173d",
    note: "e2e/fixtures/r74-tenants.ts + r74-roles.ts -- R74 two-tenant isolation fixture, tenant A.",
  },
  {
    match: { type: "env-derived", value: "R74_TENANT_B_ID" },
    id: "1850e900-6b54-4108-b01c-cc42c00f3eb9",
    note: "e2e/fixtures/r74-tenants.ts + r74-roles.ts -- R74 two-tenant isolation fixture, tenant B.",
  },
];

// ---------------------------------------------------------------------------
// EXCEPTIONS -- literals that are real production/demo tenants, deliberately
// and reviewed. Never live-checked, never counted as a static failure, but
// always PRINTED so removing the exception here without also changing the
// spec is a visible diff, not a silent gap.
// ---------------------------------------------------------------------------
const EXCEPTIONS = [
  {
    match: { type: "email-address", value: "democeo@projexa-ai.com" },
    note: "e2e/demo-gate-smoke.spec.ts (R38/WO-11) + e2e/r63-local-composer.spec.ts (local-only, CI-skipped) -- deliberately real demo org, see file headers.",
  },
  {
    match: { type: "email-address", value: "arjun.mehta@skylinebuilders-demo.veridianai.dev" },
    note: "e2e/r48-uat-bank-reachability.spec.ts -- deliberately a real, richer-data account for a UAT reachability check; run by hand, not routine CI. See file header.",
  },
  // Both spec files also contain the Playwright placeholder "you@company.com"
  // for an unrelated form field -- not a tenant reference, listed here so a
  // reviewer sees it was noticed, not missed by the exact-address match below.
  { match: { type: "email-address", value: "you@company.com" }, note: "Playwright form-field placeholder text, not a real address or a tenant reference." },
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// R74's ids are read from env (.env.r74-test.local), never appear as literal
// UUIDs in e2e/ source -- so the static UUID scan has nothing of REGISTRY's
// to match against. The registry is still consulted by the live DB check.
const registeredEmails = new Set([...EXCEPTIONS].filter((r) => r.match.type === "email-address").map((r) => r.match.value));

function listFiles(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(listFiles(p));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function scanStatic() {
  const files = SCAN_DIRS.flatMap((d) => listFiles(join(REPO_ROOT, d)));
  const unregistered = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(EMAIL_RE)) {
      const email = m[0];
      if (!registeredEmails.has(email)) unregistered.push({ file, kind: "email-address", value: email });
    }
    for (const m of text.matchAll(UUID_RE)) {
      const uuid = m[0].toLowerCase();
      unregistered.push({ file, kind: "uuid", value: uuid }); // no UUID is expected to appear literally; see comment above
    }
  }
  return unregistered;
}

// Deliberately NOT this repo's usual src/lib/db/connection-string.ts
// (DATABASE_URL, connecting as app_runtime): confirmed empirically
// (2026-09-10) that a bare unscoped SELECT against compliance.organisations
// as app_runtime returns zero rows for a real, existing id -- RLS on this
// table filters reads by tenant context, which a standalone script never
// sets. This is exactly the read-side of what P2.6 is about (registry
// tables should not be app-writable; this table apparently isn't even
// app-*readable* without a tenant context either). A checker whose job is
// ground truth needs a connection that bypasses RLS on purpose, the same
// way the Supabase service role always has -- so this uses the service role
// key over the JS client, not a raw Postgres role.
async function liveCheck() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { ran: false, failures: [] };
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceKey, { db: { schema: "compliance" } });
  const failures = [];
  for (const row of REGISTRY) {
    const { data, error } = await supabase.from("organisations").select("slug").eq("id", row.id).maybeSingle();
    if (error) throw new Error(`query failed for ${row.id}: ${error.message}`);
    const slug = data?.slug ?? null;
    const ok = !!slug && slug.startsWith("test-");
    console.log(`  ${ok ? "PASS" : "FAIL"}: ${row.id} (${row.note}) -> slug=${slug ?? "NOT FOUND"}`);
    if (!ok) failures.push({ ...row, slug });
  }
  return { ran: true, failures };
}

async function main() {
  const staticOnly = process.argv.includes("--static-only");

  console.log("=== test-tenant scoping: static scan of e2e/ ===");
  const unregistered = scanStatic();
  if (unregistered.length === 0) {
    console.log("  no unregistered tenant-identifying literals found.");
  } else {
    for (const u of unregistered) console.log(`  UNREGISTERED ${u.kind}: ${u.value} (${u.file})`);
  }

  console.log("\n=== test-tenant scoping: documented non-test exceptions (not checked, listed for visibility) ===");
  for (const row of EXCEPTIONS) console.log(`  ALLOWED: ${JSON.stringify(row.match)} -- ${row.note}`);

  let live = { ran: false, failures: [] };
  if (!staticOnly) {
    console.log("\n=== test-tenant scoping: live DB check of REGISTRY rows ===");
    live = await liveCheck();
    if (!live.ran) console.log("  SKIPPED: no NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.");
  }

  const nonTestTenantCount = unregistered.length + live.failures.length;
  console.log(`\nnon-test tenants: ${nonTestTenantCount}`);
  console.log(nonTestTenantCount === 0 ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(nonTestTenantCount === 0 ? 0 : 1);
}

main();
