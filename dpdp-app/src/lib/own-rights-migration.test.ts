/// <reference types="bun-types" />
// Migration 0752 (a person's own rights: data audit D03, D05, D12, D13, D15). The SQL itself was proved against the live database in a rolled-back
// transaction (request opens a ticket, nominee saved, my_data reads both, erase_person blanks the inbound ticket and replaces the e-mail). Pinned here so the
// guarantees cannot drift: who may call what, that the new tables are closed, that a request opens a ticket in the operator's queue, and that erasure is
// operator-only and keeps the hash-chained record intact.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const sql = readFileSync(join(import.meta.dir, "..", "..", "..", "drizzle", "0752_dpdp_own_rights.sql"), "utf8")

test("the two new tables are closed to anon and authenticated", () => {
  expect(sql).toMatch(/alter table dpdp\.person_request enable row level security/)
  expect(sql).toMatch(/alter table dpdp\.person_nominee enable row level security/)
  expect(sql).toMatch(/revoke all on dpdp\.person_request, dpdp\.person_nominee from public, anon, authenticated/)
})

test("the four person functions need a signed-in caller and are granted to authenticated only", () => {
  for (const fn of ["dpdp_my_data()", "dpdp_request_my_right(text, text)", "dpdp_set_my_nominee(text, text, text)", "dpdp_clear_my_nominee()"]) {
    expect(sql).toContain(`revoke all on function public.${fn} from public, anon`)
    expect(sql).toContain(`grant execute on function public.${fn} to authenticated`)
  }
  expect((sql.match(/dpdp__caller_identity_id\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
  expect((sql.match(/raise exception 'Sign in first'/g) ?? []).length).toBe(4)
})

test("a request opens a ticket in the operator's data_request queue", () => {
  expect(sql).toMatch(/dpdp_mail_insert_inbound\(\s*'data_request'/)
})

test("single-person erasure is operator-only and leaves the hash-chained record alone", () => {
  expect(sql).toMatch(/revoke all on function dpdp\.erase_person\(text, text\) from public, anon, authenticated/)
  expect(sql).not.toMatch(/grant execute on function dpdp\.erase_person/)
  expect(sql).toMatch(/update dpdp\.event set actor_identity_id = null where actor_identity_id = p_identity/)
  // the event row's text is part of its hash: it must not be rewritten
  expect(sql).not.toMatch(/update dpdp\.event set (summary|detail|actor_label)/)
  expect(sql).toMatch(/platform_admin/)
})

test("each consent answer stores a hash of the exact text shown, including the withdrawal row", () => {
  expect(sql).toMatch(/add column if not exists text_hash text/)
  expect((sql.match(/text_hash\)/g) ?? []).length).toBeGreaterThanOrEqual(2)
  expect(sql).toMatch(/sha256\(convert_to\(coalesce\(dpdp\.consent_notice_text/)
  expect(sql).toMatch(/v_last\.text_hash/)
})
