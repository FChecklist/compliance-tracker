/// <reference types="bun-types" />
// Migration 0751 makes a read through an AI work link leave a row in the audit trail (DPDP data audit 2026-10-14, D21). Pinned here: it is an AFTER INSERT
// trigger on ai_link_call, it records only GET reads, it writes the first path segment only (never the full path or the link token), and it can never
// raise into the AI call.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const sql = readFileSync(join(import.meta.dir, "..", "..", "..", "drizzle", "0751_dpdp_audit_ai_read.sql"), "utf8")

test("0751 audits a GET read through an AI link, first path segment only", () => {
  expect(sql).toMatch(/create trigger audit_from_ai_link_read after insert on dpdp\.ai_link_call/)
  expect(sql).toMatch(/new\.method = 'GET'/)
  expect(sql).toMatch(/'ai_read', 'ai_link'/)
  expect(sql).toMatch(/split_part\(ltrim\(coalesce\(new\.path, ''\), '\/'\), '\/', 1\)/)
  expect(sql).not.toMatch(/'path'\s*,\s*new\.path/)
})

test("0751 can never block the AI call", () => {
  expect(sql).toMatch(/exception when others then\s+null;/)
})
