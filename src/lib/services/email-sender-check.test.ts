/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-12 (AW-604): who may make an inbound email do work. email-sender-check.ts on PGlite (real Postgres as WASM) with the
// one table it reads, compliance.users, reduced to the five columns the query names.
//
// WHAT IS PROVEN
//   1. parseSenderAddress: `Name <a@b.example>`, a quoted name and a bare address all give the lower-case address; a display name that
//      looks like another address is not trusted; two addresses, control characters, no domain and an unclosed bracket give null.
//   2. readAuthenticationVerdict: fail when Authentication-Results says spf, dkim or dmarc failed (any header-name case); pass when it is
//      present without a failure; absent when there is none.
//   3. verifySender against real rows: an active member of the organisation is accepted (address compared without regard to case); an
//      address of another organisation, an inactive person, an unknown address, a viewer and a failed authentication verdict are each a
//      refusal with its own code, and the note never repeats anything but the reason and the address.
//
// Run: bun test --isolate src/lib/services/email-sender-check.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"

process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"

import * as schema from "@/lib/db/schema"
import { findOrganisationPerson, parseSenderAddress, readAuthenticationVerdict, verifySender, type SenderDb } from "./email-sender-check"

const ORG = "org-a"
const OTHER_ORG = "org-b"

const pglite = await PGlite.create()
await pglite.exec(`
CREATE SCHEMA compliance;
CREATE TABLE compliance.users (id text PRIMARY KEY, email text NOT NULL, role text NOT NULL, org_id text, is_active boolean NOT NULL DEFAULT true);
`)
const pgDb = drizzle(pglite, { schema })
const db = pgDb as unknown as SenderDb

async function person(id: string, email: string, role: string, orgId: string | null, active = true) {
  await pglite.query("insert into compliance.users (id, email, role, org_id, is_active) values ($1, $2, $3, $4, $5)", [id, email, role, orgId, active])
}

beforeAll(async () => {
  await person("u-member", "Asha.Mehta@Firm.Example", "member", ORG)
  await person("u-manager", "boss@firm.example", "manager", ORG)
  await person("u-viewer", "viewer@firm.example", "viewer", ORG)
  await person("u-inactive", "gone@firm.example", "member", ORG, false)
  await person("u-other", "outsider@other.example", "admin", OTHER_ORG)
  await person("u-none", "nobody@stage0.example", "member", null)
})

afterAll(async () => {
  await pglite.close()
})

describe("parseSenderAddress", () => {
  test("a display name and angle brackets, a quoted name and a bare address all give the lower-case address", () => {
    expect(parseSenderAddress("Asha Mehta <Asha.Mehta@Firm.Example>")).toBe("asha.mehta@firm.example")
    expect(parseSenderAddress('"Mehta, Asha" <asha@firm.example>')).toBe("asha@firm.example")
    expect(parseSenderAddress("  asha@firm.example ")).toBe("asha@firm.example")
  })

  test("the name is never trusted: a name that looks like another address does not become the address", () => {
    expect(parseSenderAddress("boss@firm.example <attacker@evil.example>")).toBe("attacker@evil.example")
    expect(parseSenderAddress("attacker@evil.example boss@firm.example")).toBeNull()
    // Angle brackets inside the display name: the address is what is inside the LAST pair, never the name's.
    expect(parseSenderAddress('"<boss@firm.example>" <attacker@evil.example>')).toBe("attacker@evil.example")
  })

  test("nothing readable gives null: empty, no domain, two addresses, an unclosed bracket, control characters, too long", () => {
    for (const bad of ["", "   ", "asha", "asha@", "@firm.example", "asha@firm", "a@b.example, c@d.example", "Asha <asha@firm.example", "asha@firm.example\nBcc: x@y.example", `${"a".repeat(260)}@firm.example`]) {
      expect(parseSenderAddress(bad)).toBeNull()
    }
    expect(parseSenderAddress(null)).toBeNull()
    expect(parseSenderAddress(undefined)).toBeNull()
  })
})

describe("readAuthenticationVerdict", () => {
  test("fail when spf, dkim or dmarc failed, whatever the header's case", () => {
    expect(readAuthenticationVerdict({ "Authentication-Results": "mx.example; spf=pass; dkim=fail header.d=firm.example" })).toBe("fail")
    expect(readAuthenticationVerdict({ "authentication-results": "mx.example; dmarc=fail (p=reject)" })).toBe("fail")
    expect(readAuthenticationVerdict({ "AUTHENTICATION-RESULTS": "spf=FAIL" })).toBe("fail")
  })
  test("pass when present with no failure; absent when there is no header", () => {
    expect(readAuthenticationVerdict({ "authentication-results": "mx.example; spf=pass; dkim=pass; dmarc=pass" })).toBe("pass")
    expect(readAuthenticationVerdict({ "authentication-results": "mx.example; spf=softfail" })).toBe("pass")
    expect(readAuthenticationVerdict({ subject: "hello" })).toBe("absent")
    expect(readAuthenticationVerdict(null)).toBe("absent")
    expect(readAuthenticationVerdict({ "authentication-results": 7 })).toBe("absent")
  })
})

describe("findOrganisationPerson and verifySender against real rows", () => {
  test("an active member of the organisation is accepted, whatever the case of the address on either side", async () => {
    expect(await findOrganisationPerson(db, ORG, "asha.mehta@firm.example")).toEqual({ id: "u-member", role: "member" })
    const verdict = await verifySender(db, { orgId: ORG, fromAddress: "Asha <ASHA.MEHTA@FIRM.EXAMPLE>" })
    expect(verdict).toEqual({ ok: true, address: "asha.mehta@firm.example", person: { id: "u-member", role: "member" } })
    expect((await verifySender(db, { orgId: ORG, fromAddress: "boss@firm.example" })).ok).toBe(true)
  })

  test("a person of another organisation is refused: sender_not_a_user_of_this_organisation", async () => {
    const verdict = await verifySender(db, { orgId: ORG, fromAddress: "outsider@other.example" })
    expect(verdict).toMatchObject({ ok: false, code: "sender_not_a_user_of_this_organisation" })
    expect((await verifySender(db, { orgId: OTHER_ORG, fromAddress: "outsider@other.example" })).ok).toBe(true)
  })

  test("an inactive person, an unknown address and a person with no organisation are refused the same way", async () => {
    for (const from of ["gone@firm.example", "stranger@nowhere.example", "nobody@stage0.example"]) {
      expect(await verifySender(db, { orgId: ORG, fromAddress: from })).toMatchObject({ ok: false, code: "sender_not_a_user_of_this_organisation" })
    }
  })

  test("a viewer is below member: sender_role_too_low", async () => {
    expect(await verifySender(db, { orgId: ORG, fromAddress: "viewer@firm.example" })).toMatchObject({ ok: false, code: "sender_role_too_low" })
  })

  test("a failed authentication verdict refuses even a known person, before the database is asked", async () => {
    const verdict = await verifySender(db, { orgId: ORG, fromAddress: "asha.mehta@firm.example", headers: { "Authentication-Results": "mx.example; dkim=fail" } })
    expect(verdict).toMatchObject({ ok: false, code: "sender_authentication_failed" })
    const withPass = await verifySender(db, { orgId: ORG, fromAddress: "asha.mehta@firm.example", headers: { "Authentication-Results": "mx.example; dkim=pass" } })
    expect(withPass.ok).toBe(true)
  })

  test("an unreadable From address is refused: sender_address_unreadable", async () => {
    expect(await verifySender(db, { orgId: ORG, fromAddress: "not an address" })).toMatchObject({ ok: false, code: "sender_address_unreadable" })
    expect(await verifySender(db, { orgId: ORG, fromAddress: undefined })).toMatchObject({ ok: false, code: "sender_address_unreadable" })
  })

  test("a refusal note names the reason and the address, nothing else", async () => {
    const verdict = await verifySender(db, { orgId: ORG, fromAddress: "Stranger <stranger@nowhere.example>" })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.note).toBe("message refused: stranger@nowhere.example is not an active person of this organisation")
  })
})
