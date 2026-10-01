/// <reference types="bun-types" />
// The referral carry-through, end to end, as ONE chain (owner, 2026-10-01: "the 'carry referral code to the app'
// task ... COMPLETE IT"). A Sales Partner shares https://veridian-aios.com/?ref=<code>. The code must reach the
// database call that opens the new organisation:
//
//   1. public/ref.js (loaded by every public page) reads ?ref= and keeps it in localStorage["dpdp-referral"];
//   2. the visitor clicks through to /app/ and signs in (same origin, same localStorage);
//   3. src/lib/landing.ts recallReferral() reads it back;
//   4. src/App.tsx openMyOrg() passes it to createMyOrg();
//   5. createMyOrg() sends it as p_referral_code to the RPC dpdp_create_my_org;
//   6. that RPC (drizzle/0655) records the referral, and the migration-0674 trigger and
//      dpdp_record_confirmed_payment apply the partner rules.
//
// Every link below is run for real or pinned to the source text, so if any one of them breaks (a renamed key, a
// dropped argument, a renamed RPC parameter) this file fails. The database end of step 6 is proven by
// src/lib/services/dpdp-partner-lifecycle.pglite.test.ts and, against the real sign-up RPC, by
// scripts/dpdp/partner-lifecycle-live-test.mjs.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createMyOrg } from "./api"
import { recallReferral } from "./landing"
import type { DpdpClient } from "./client"

const root = join(import.meta.dir, "..", "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")
const refScript = read("public/ref.js")

/** Runs the real public/ref.js on a visit to `href`; returns what it kept and what it did to the address bar. */
function visit(href: string, store: Record<string, string> = {}) {
  const replaced: string[] = []
  const win = {
    location: { href },
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => void replaced.push(url) },
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) },
  }
  new Function("window", refScript)(win)
  return { store, replaced }
}

/** A client that records the one RPC the sign-up makes. */
function fakeClient() {
  const calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = []
  const client = { rpc: async (fn: string, args?: Record<string, unknown>) => { calls.push({ fn, args }); return { data: { ok: true, orgId: "o1" }, error: null } } } as unknown as DpdpClient
  return { client, calls }
}

async function withLocalStorage<T>(store: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const g = globalThis as unknown as { localStorage?: unknown }
  const before = g.localStorage
  g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] }
  try {
    return await fn()
  } finally {
    g.localStorage = before
  }
}

describe("referral carry-through: share link -> ref.js -> localStorage -> sign-up RPC", () => {
  test("a shared link to the home page ends as p_referral_code on dpdp_create_my_org", async () => {
    const { store, replaced } = visit("https://veridian-aios.com/?ref=ABCD2345")
    expect(store).toEqual({ "dpdp-referral": "ABCD2345" })
    expect(replaced).toEqual(["/"])
    // the visitor clicks "Start free" and later signs in: the same localStorage is read by the app
    const { client, calls } = fakeClient()
    await withLocalStorage(store, async () => {
      expect(recallReferral()).toBe("ABCD2345")
      // exactly what App.tsx's openMyOrg does (pinned to the source below)
      await createMyOrg(client, "Mehta & Co", "firm", recallReferral())
    })
    expect(calls).toEqual([{ fn: "dpdp_create_my_org", args: { p_name: "Mehta & Co", p_product: "firm", p_referral_code: "ABCD2345" } }])
  })

  test("the same from an edition page and with other parameters on the link", async () => {
    const { store } = visit("https://veridian-aios.com/dpdp-institution/?ref=Zz9Zz9Zz&utm_source=wa#top")
    const { client, calls } = fakeClient()
    await withLocalStorage(store, async () => { await createMyOrg(client, "St Mary School", "institution", recallReferral()) })
    expect(calls[0].args?.p_referral_code).toBe("Zz9Zz9Zz")
  })

  test("no code, or a code that does not look like one, sends null (the sign-up is never blocked)", async () => {
    for (const href of ["https://veridian-aios.com/", "https://veridian-aios.com/?ref=a-b", "https://veridian-aios.com/?ref=ab"]) {
      const { store } = visit(href)
      const { client, calls } = fakeClient()
      await withLocalStorage(store, async () => { await createMyOrg(client, "X Ltd", "firm", recallReferral()) })
      expect(calls[0].args?.p_referral_code, href).toBeNull()
    }
  })

  test("a later visit without ?ref= does not erase the code that was kept", async () => {
    const { store } = visit("https://veridian-aios.com/?ref=ABCD2345")
    visit("https://veridian-aios.com/about/", store)
    await withLocalStorage(store, () => expect(recallReferral()).toBe("ABCD2345"))
  })

  test("App.tsx passes the remembered code to createMyOrg (the argument must not be dropped)", () => {
    const app = read("src/App.tsx")
    expect(app).toContain("await createMyOrg(client, name, product, landing.referralCode ?? recallReferral())")
    expect(app).toContain('import { clearJoin, readLanding, recallEdition, recallEmail, recallJoin, recallReferral, rememberEmail')
  })

  test("the RPC argument names in api.ts are the parameter names of the real dpdp_create_my_org", () => {
    const api = read("src/lib/api.ts")
    expect(api).toContain('client.rpc("dpdp_create_my_org", { p_name: name, p_product: product, p_referral_code: referralCode?.trim() || null })')
    // the LAST migration that defines the function is the one that is live
    const dir = join(root, "..", "drizzle")
    const defs = readdirSync(dir).filter((f) => /^0\d{3}_.*\.sql$/.test(f) && f >= "0654").sort()
      .filter((f) => /create or replace function public\.dpdp_create_my_org\(/i.test(readFileSync(join(dir, f), "utf8")))
    expect(defs.length).toBeGreaterThan(0)
    const last = readFileSync(join(dir, defs[defs.length - 1]), "utf8")
    expect(last).toMatch(/create or replace function public\.dpdp_create_my_org\(p_name text, p_product text, p_referral_code text default null\)/i)
    // and it resolves the code against dpdp.referral and records the sign-up
    expect(last).toContain("from dpdp.referral r where upper(r.code) = upper(trim(p_referral_code)) and r.state = 'active'")
    expect(last).toContain("insert into dpdp.referral_event")
  })

  test("the sign-up never carries the code anywhere else: no cookie, no URL, no second storage key", () => {
    const landing = read("src/lib/landing.ts")
    expect([...landing.matchAll(/const (\w+_KEY) = "([^"]+)"/g)].map((m) => m[2]).sort()).toEqual(["dpdp-edition", "dpdp-join", "dpdp-referral", "dpdp-signin-email"])
    expect(refScript).not.toMatch(/cookie|fetch|XMLHttpRequest|sendBeacon/)
  })
})
