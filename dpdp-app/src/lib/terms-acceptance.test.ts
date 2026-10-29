/// <reference types="bun-types" />
// The ticked Terms boxes, the app side and the one-constant rule (drizzle/0748 is proved on a real Postgres in
// src/lib/services/dpdp-terms-acceptance.pglite.test.ts). This file pins:
//   - the version "2026-10-13" is the SAME in the app, the Edge Function helper, the migration and the Terms page
//   - the box wording is exactly the agreed wording, everywhere it appears, and each linked phrase links where it should
//   - the boxes are never pre-ticked, and the action waits (disabled, with the reason beside it) until the box is ticked
//   - the app sends the version and the tick to the database; a refusal comes back as the one sentence
//   - the table has no IP-address or device column; the Refund page and the K3 box do not contradict each other
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { OpenOrganisation } from "../components/Screens"
import { TermsCheckbox, TermsWhy } from "../components/TermsBox"
import { BOX_K2, BOX_K3, CONSENT_REQUIRED_CODE, TERMS_VERSION, TICK_TO_CONTINUE, isConsentRequired } from "./terms"
import * as shared from "../../../supabase/functions/_shared/terms"
import { openAccount, startOnlinePayment } from "./api"
import { createMockClient } from "./mock-client"

const APP = join(import.meta.dir, "..", "..")
const ROOT = join(APP, "..")
const readApp = (rel: string) => readFileSync(join(APP, rel), "utf8")
const MIGRATION = readFileSync(join(ROOT, "drizzle", "0748_dpdp_terms_acceptance.sql"), "utf8")

// The agreed words. Do not edit these to make a test pass: they are the owner's wording.
const AGREED_K2 = "I have read and agree to the Terms & Conditions and the Privacy Policy."
const AGREED_K3 = "I agree to the Terms and the Refund Policy."
const AGREED_REFUSAL = "Please tick the box to continue."

describe("one version, one wording", () => {
  test("the version is 2026-10-13 in the app, the Edge Function helper, the migration and on the Terms page", () => {
    expect(TERMS_VERSION).toBe("2026-10-13")
    expect(shared.TERMS_VERSION).toBe(TERMS_VERSION)
    expect(MIGRATION).toMatch(/terms_current_version\(\)[\s\S]*?select '2026-10-13'::text/)
    expect(readApp("public/terms/index.html")).toContain("Version 2026-10-13")
    expect(readApp("public/refund/index.html")).toContain("Version 2026-10-13")
  })

  test("the K2 and K3 wording is the agreed wording everywhere: app, Edge Function helper, migration", () => {
    expect(BOX_K2.text).toBe(AGREED_K2)
    expect(BOX_K3.text).toBe(AGREED_K3)
    expect(shared.BOX_K2).toBe(AGREED_K2)
    expect(shared.BOX_K3).toBe(AGREED_K3)
    expect(MIGRATION).toContain(`when 'K2' then '${AGREED_K2}'`)
    expect(MIGRATION).toContain(`when 'K3' then '${AGREED_K3}'`)
  })

  test("the refusal sentence and code are the same in the app, the Edge Function helper and the migration", () => {
    expect(TICK_TO_CONTINUE).toBe(AGREED_REFUSAL)
    expect(shared.CONSENT_REQUIRED_MESSAGE).toBe(AGREED_REFUSAL)
    expect(CONSENT_REQUIRED_CODE).toBe("consent-required")
    expect(shared.CONSENT_REQUIRED_CODE).toBe("consent-required")
    expect(MIGRATION).toContain(`raise exception '${AGREED_REFUSAL}' using errcode = '22023', hint = 'consent-required'`)
  })

  test("each box's pieces join into the sentence, and the linked phrases go to the right pages", () => {
    for (const box of [BOX_K2, BOX_K3]) expect(box.parts.map((p) => p.text).join("")).toBe(box.text)
    const links = (b: typeof BOX_K2) => b.parts.filter((p): p is { text: string; href: string } => "href" in p).map((p) => [p.text, p.href])
    expect(links(BOX_K2)).toEqual([["Terms & Conditions", "/terms/"], ["Privacy Policy", "/privacy/"]])
    expect(links(BOX_K3)).toEqual([["Terms", "/terms/"], ["Refund Policy", "/refund/"]])
  })
})

describe("the boxes on the screen", () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

  test("a checkbox shows the sentence, its two linked phrases open in a new tab, and it is not ticked", () => {
    for (const box of [BOX_K2, BOX_K3]) {
      const out = html(createElement(TermsCheckbox, { box, checked: false, onChange: () => {} }))
      expect(out).toContain('type="checkbox"')
      expect(out).not.toMatch(/\schecked(=|\s|>)/)
      expect(out.replace(/<[^>]+>/g, "")).toBe(box.text.replace(/&/g, "&amp;"))
      expect((out.match(/<a /g) ?? []).length).toBe(2)
      expect((out.match(/target="_blank"/g) ?? []).length).toBe(2)
      expect((out.match(/rel="noopener noreferrer"/g) ?? []).length).toBe(2)
    }
  })

  test("a ticked checkbox says so; the reason line is shown only while it is not", () => {
    expect(html(createElement(TermsCheckbox, { box: BOX_K3, checked: true, onChange: () => {} }))).toMatch(/\schecked/)
    expect(html(createElement(TermsWhy, { id: "w", ticked: false }))).toContain(AGREED_REFUSAL)
    expect(html(createElement(TermsWhy, { id: "w", ticked: true }))).toBe("")
  })

  test("sign-up (K2): the box is there, NOT pre-ticked, and the 'Open my organisation' button is disabled with the reason beside it", () => {
    const out = html(createElement(OpenOrganisation, { email: "a@b.test", busy: false, error: null, onCreate: () => {}, onSignOut: () => {} }))
    expect(out).toContain('data-terms-kind="K2"')
    expect(out).toContain("Terms &amp; Conditions")
    expect(out).toContain('href="/terms/"')
    expect(out).toContain('href="/privacy/"')
    const box = /<input[^>]*data-terms-kind="K2"[^>]*>/.exec(out)![0]
    expect(box).not.toMatch(/\schecked(=|\s|>)/)
    const button = /<button type="submit"[^>]*>/.exec(out)![0]
    expect(button).toContain("disabled")
    expect(button).toContain('aria-describedby="terms-why-k2"')
    expect(out).toContain(`<p id="terms-why-k2"`)
    expect(out).toContain(AGREED_REFUSAL)
  })

  test("the sign-up source: the button waits for the box, submit() refuses without it, and onCreate is told the box was ticked", () => {
    const src = readApp("src/components/Screens.tsx")
    expect(src).toContain("const [terms, setTerms] = useState(false)")
    expect(src).toContain("disabled={busy || !terms}")
    expect(src).toContain("if (!terms) return")
    expect(src).toContain("termsAccepted: true")
    expect(readApp("src/App.tsx")).toContain("termsAccepted: extra.termsAccepted")
  })

  test("paying (K3): the box is never pre-ticked, the Pay and Renew buttons wait for it and say why, and no 'no refund' wording is added", () => {
    const src = readApp("src/components/BillingPanel.tsx")
    expect(src).toContain("const [terms, setTerms] = useState(false)")
    expect(src.match(/<TermsCheckbox box=\{BOX_K3\}/g)?.length).toBe(2)
    expect(src.match(/disabled=\{busy \|\| !terms\}/g)?.length).toBe(2)
    expect(src).toContain("if (!billing || !terms) return")
    expect(src).toContain("startOnlinePayment(client, orgId, terms)")
    expect(`${readApp("src/components/TermsBox.tsx")}\n${src}`).not.toMatch(/no[- ]refund|non-?refundable/i)
  })
})

describe("what the app sends, and how a refusal reads", () => {
  function recorder() {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
    const client = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: { ok: true }, error: null } }, accessToken: async () => "tok" }
    return { calls, client: client as unknown as Parameters<typeof openAccount>[0] }
  }

  test("openAccount sends the current version and the tick to dpdp_open_account (and false when the box was not ticked)", async () => {
    for (const ticked of [true, false]) {
      const { calls, client } = recorder()
      await openAccount(client, { accountType: "firm", orgName: "Mehta & Co", termsAccepted: ticked })
      expect(calls[0].fn).toBe("dpdp_open_account")
      expect(calls[0].args.p_terms_version).toBe("2026-10-13")
      expect(calls[0].args.p_terms_accepted).toBe(ticked)
    }
  })

  test("startOnlinePayment sends termsVersion and termsAccepted in the body of the dpdp-pay request", async () => {
    const { client } = recorder()
    const real = globalThis.fetch
    const bodies: unknown[] = []
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => { bodies.push(JSON.parse(init?.body ?? "{}")); return new Response(JSON.stringify({ error: AGREED_REFUSAL, code: "consent-required" }), { status: 400 }) }) as typeof fetch
    try {
      const r = await startOnlinePayment(client, "org1", true)
      expect(bodies[0]).toEqual({ interval: "year", orgId: "org1", termsVersion: "2026-10-13", termsAccepted: true })
      expect(r).toEqual({ ok: false, notEnabled: false, error: AGREED_REFUSAL })
      await startOnlinePayment(client, null, false)
      expect(bodies[1]).toEqual({ interval: "year", termsVersion: "2026-10-13", termsAccepted: false })
    } finally {
      globalThis.fetch = real
    }
  })

  test("the mock database refuses a sign-up without the tick, and with an old version, in the one sentence with the hint", async () => {
    const mock = createMockClient("visitor")
    for (const args of [{}, { p_terms_accepted: false, p_terms_version: "2026-10-13" }, { p_terms_accepted: true }, { p_terms_accepted: true, p_terms_version: "2026-10-12" }]) {
      const r = await mock.rpc("dpdp_open_account", { p_account_type: "firm", p_org_name: "Mehta & Co", ...args })
      expect(r.data).toBeNull()
      expect(r.error?.message).toBe(AGREED_REFUSAL)
      expect(r.error?.hint).toBe("consent-required")
    }
    const ok = await mock.rpc("dpdp_open_account", { p_account_type: "firm", p_org_name: "Mehta & Co", p_terms_accepted: true, p_terms_version: "2026-10-13" })
    expect(ok.error).toBeNull()
  })

  test("isConsentRequired recognises the hint, the code field and the sentence, and nothing else", () => {
    expect(isConsentRequired({ hint: "consent-required", message: "x" })).toBe(true)
    expect(isConsentRequired({ code: "consent-required" })).toBe(true)
    expect(isConsentRequired({ message: AGREED_REFUSAL })).toBe(true)
    expect(isConsentRequired({ message: "Sign in first" })).toBe(false)
    expect(isConsentRequired(null)).toBe(false)
  })
})

describe("what is stored, and the Refund page", () => {
  test("the table stores who, kind, reference, version, wording hash and time -- no IP address, no device detail", () => {
    const table = /create table if not exists dpdp\.terms_acceptance \(([\s\S]*?)\n\);/.exec(MIGRATION)![1]
    const cols = table.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c))
    expect(cols).toEqual(["id", "identity_id", "org_id", "kind", "reference", "terms_version", "box_text_hash", "accepted_at"])
    expect(table).not.toMatch(/(^|[^a-z])(ip|ip_address|user_agent|device|browser|fingerprint|geo|location)([^a-z]|$)/i)
  })

  test("the migration is written, not applied: it carries the DDL citation and has a rollback file", () => {
    expect(MIGRATION.split("\n")[0]).toMatch(/^-- PRE-APPROVED-LIVE-DDL: /)
    expect(MIGRATION).toMatch(/NOT applied/i)
    expect(readFileSync(join(ROOT, "drizzle", "down", "0748_dpdp_terms_acceptance.down.sql"), "utf8")).toContain("drop table if exists dpdp.terms_acceptance")
  })

  test("the Refund page the K3 box links to says what the box says it agrees to, and the box adds no wording of its own", () => {
    const refund = readApp("public/refund/index.html").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
    expect(refund).toContain("Cancellation and Refund Policy")
    expect(refund).toContain("You can cancel any time.")
    // the page states its exceptions and its route to a refund; the box is just "I agree to the Terms and the Refund Policy."
    expect(refund).toContain("except where a payment was taken twice or by mistake")
    expect(refund).toContain("How to ask for a refund")
    expect(BOX_K3.text).not.toMatch(/refund(s|ed)?\b.*\b(no|not|never)\b|\b(no|not|never)\b.*refund/i)
    expect(readApp("public/terms/index.html")).toContain('href="/refund/"')
  })
})
