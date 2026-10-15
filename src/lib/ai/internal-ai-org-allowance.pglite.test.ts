/// <reference types="bun-types" />
// AUDIT-100 A11 ("our AI is used only if we allow it"): the per-organisation allow flag on a REAL database, with the REAL code.
//
// internal-ai-org-allowance.test.ts mocks product-branch-service, so it proves the wrapper's fail-closed handling but not that the flag is
// really read from the entitlement tables. This test runs the real isInternalAiAllowedForOrgWithDb -> the real isBranchEnabledForOrgWithDb ->
// real Drizzle queries on PGlite (real Postgres as WASM), over tables with the exact columns schema.ts declares for
// platform.product_branches, compliance.organisations (the one column read) and compliance.org_product_branch_enablements, and with the
// catalog row created by running the REAL file drizzle/0692_internal_ai_product_branch.sql.
//
// WHAT IS PROVEN
//   1. 0692 applies, creates exactly one catalog row 'internal_ai' (active), and applying it twice changes nothing.
//   2. With the catalog row and NO enablement: every organisation is NOT allowed (default closed).
//   3. An is_enabled = true row for org A allows org A only; org B stays closed.
//   4. Turning the row off (is_enabled = false) closes it again at once.
//   5. Before 0692 is applied (no catalog row): closed, no exception reaches the caller.
//
// Live database facts (read-only, 2026-10-05, project pcrjmlpuqsbocqfwoxod): the 'internal_ai' catalog row exists and is active; the number
// of organisations enabled for it is 0.
//
// Run: bun test --isolate src/lib/ai/internal-ai-org-allowance.pglite.test.ts
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"

process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"

import * as schema from "@/lib/db/schema"
import { INTERNAL_AI_BRANCH_KEY, isInternalAiAllowedForOrgWithDb } from "./internal-ai-org-allowance"

setDefaultTimeout(60_000)

const MIGRATION = readFileSync(join(import.meta.dir, "..", "..", "..", "drizzle", "0692_internal_ai_product_branch.sql"), "utf8")

const pglite = await PGlite.create()
await pglite.exec(`
CREATE SCHEMA platform;
CREATE SCHEMA compliance;
CREATE TABLE platform.product_branches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  domain text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  tagline text,
  icon text,
  status text NOT NULL DEFAULT 'planned',
  launch_order integer NOT NULL DEFAULT 999,
  parent_domain text,
  build_tier text,
  created_at timestamp NOT NULL DEFAULT now(),
  host_domain text
);
CREATE TABLE compliance.organisations (id text PRIMARY KEY, primary_product_branch_id text);
CREATE TABLE compliance.org_product_branch_enablements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  product_branch_id text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamp,
  enabled_by_id text,
  disabled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO compliance.organisations (id) VALUES ('org-a'), ('org-b');
`)
// the handle the service functions take (a tenant transaction in production)
const db = drizzle(pglite, { schema }) as never

const allowed = (orgId: string) => isInternalAiAllowedForOrgWithDb(db, orgId)
const branchRows = async () => (await pglite.query<{ id: string; is_active: boolean }>("select id, is_active from platform.product_branches where branch_key = $1", [INTERNAL_AI_BRANCH_KEY])).rows
const setEnabled = async (orgId: string, enabled: boolean) => {
  const [{ id }] = await branchRows()
  const existing = await pglite.query("select id from compliance.org_product_branch_enablements where org_id = $1 and product_branch_id = $2", [orgId, id])
  if (existing.rows.length) await pglite.query("update compliance.org_product_branch_enablements set is_enabled = $3 where org_id = $1 and product_branch_id = $2", [orgId, id, enabled])
  else await pglite.query("insert into compliance.org_product_branch_enablements (org_id, product_branch_id, is_enabled) values ($1, $2, $3)", [orgId, id, enabled])
}

afterAll(async () => {
  await pglite.close()
})

describe("per-organisation internal AI allow flag, real code on a real database", () => {
  test("before 0692 is applied there is no catalog row: closed, and nothing is thrown", async () => {
    expect(await branchRows()).toHaveLength(0)
    expect(await allowed("org-a")).toBe(false)
  })

  describe("after 0692", () => {
    beforeAll(async () => {
      await pglite.exec(MIGRATION)
    })

    test("0692 creates exactly one active catalog row, and a second run changes nothing", async () => {
      const first = await branchRows()
      expect(first).toHaveLength(1)
      expect(first[0].is_active).toBe(true)
      await pglite.exec(MIGRATION)
      const second = await branchRows()
      expect(second).toEqual(first)
    })

    test("with the catalog row but no enablement, every organisation is closed", async () => {
      expect(await allowed("org-a")).toBe(false)
      expect(await allowed("org-b")).toBe(false)
      expect(await allowed("an-org-that-does-not-exist")).toBe(false)
    })

    test("an enabled row allows that organisation only", async () => {
      await setEnabled("org-a", true)
      expect(await allowed("org-a")).toBe(true)
      expect(await allowed("org-b")).toBe(false)
    })

    test("switching it off closes it again at once", async () => {
      await setEnabled("org-a", false)
      expect(await allowed("org-a")).toBe(false)
    })

    test("a disabled row that was never enabled is closed too", async () => {
      await setEnabled("org-b", false)
      expect(await allowed("org-b")).toBe(false)
    })
  })
})
