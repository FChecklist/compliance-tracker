import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { forgetCachedMode, isTestMode, readModeCached, showTestBanner, testPaymentAvailable, TEST_BANNER, TEST_PAYMENT_LABEL, TEST_PAYMENT_NOTE } from "./platform-mode"
import { readMode } from "../../functions/api/_mode"
import { PROFILE_NUDGE, PROFILE_TITLE } from "../components/ProfileCard"
import type { MyAccountPayload } from "./rpc-types"

const APP = join(import.meta.dir, "../..")
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const src = (rel: string) => readFileSync(join(APP, rel), "utf8")

const acct = (over: Record<string, unknown> = {}) => ({ orgId: "o", hasAccount: true, coveredByFirm: false, isTest: true, ...over }) as unknown as MyAccountPayload
const ALARM = new RegExp(["warn" + "ing", "dang" + "er", "err" + "or", "fail", "urgent", "alert", "!", "must", "required", "mandatory", "blocked"].join("|"), "i")

describe("the Test mode banner: only inside the signed-in app, and calm", () => {
  test("it shows in Test mode inside the app and nowhere else (public pages, e-mails) and never in Live", () => {
    const test = { mode: "TEST", test: true } as const
    const live = { mode: "LIVE", test: false } as const
    expect(showTestBanner(test, "app")).toBe(true)
    expect(showTestBanner(test, "public")).toBe(false)
    expect(showTestBanner(test, "email")).toBe(false)
    expect(showTestBanner(live, "app")).toBe(false)
    expect(showTestBanner(null, "app")).toBe(false)
    expect(isTestMode(undefined)).toBe(false)
  })

  test("the wording is one calm, plain sentence: no alarm words, no exclamation marks", () => {
    for (const s of [TEST_BANNER, TEST_PAYMENT_LABEL, TEST_PAYMENT_NOTE, PROFILE_TITLE, PROFILE_NUDGE]) expect(s).not.toMatch(ALARM)
    expect(TEST_BANNER).toContain("practice workspace")
    expect(TEST_PAYMENT_NOTE).toContain("No money moves")
  })

  test("only the signed-in Page shell renders it: no public page, landing file, e-mail renderer or Edge Function mentions it", () => {
    const users = walk(APP).filter((f) => /\.(tsx?|html|mjs|js)$/.test(f) && !/\.test\./.test(f) && readFileSync(f, "utf8").includes("TestModeBanner"))
    const rel = users.map((f) => f.slice(APP.length + 1).split("\\").join("/")).sort()
    expect(rel).toEqual(["src/App.tsx", "src/components/TestModeBanner.tsx"])
    expect(src("src/App.tsx")).toContain("<TestModeBanner client={client} orgId={org.id}")
    const edge = join(APP, "../supabase/functions")
    for (const f of walk(edge).filter((x) => /\.ts$/.test(x))) expect(readFileSync(f, "utf8"), f).not.toContain(TEST_BANNER)
  })

  test("the Test payment is offered only in Test mode, on a test account that pays for itself", () => {
    const test = { mode: "TEST", test: true } as const
    expect(testPaymentAvailable(test, acct())).toBe(true)
    expect(testPaymentAvailable({ mode: "LIVE", test: false }, acct())).toBe(false)
    expect(testPaymentAvailable(test, acct({ isTest: false }))).toBe(false)
    expect(testPaymentAvailable(test, acct({ coveredByFirm: true }))).toBe(false)
    expect(testPaymentAvailable(test, { orgId: "o", hasAccount: false, state: "ACTIVE" })).toBe(false)
  })

  test("the mode is read at most once every few seconds", async () => {
    forgetCachedMode()
    let n = 0
    const counted = async () => { n++; return { mode: "TEST", test: true } as const }
    await readModeCached(counted, 1000)
    await readModeCached(counted, 3000)
    expect(n).toBe(1)
    await readModeCached(counted, 7000)
    expect(n).toBe(2)
    forgetCachedMode()
  })
})

describe("GET /api/mode: public, read-only, cached a few seconds, and never a banner by mistake", () => {
  const ok = (mode: string) => async () => new Response(JSON.stringify({ mode }), { status: 200 })
  test("it relays the database's answer with a short cache", async () => {
    const r = await readMode("GET", { SUPABASE_ANON_KEY: "anon" }, ok("TEST"))
    expect(await r.json()).toEqual({ mode: "TEST", test: true })
    expect(r.headers.get("Cache-Control")).toContain("s-maxage=5")
  })
  test("anything it cannot read is LIVE and is not cached; only GET is allowed", async () => {
    expect(await (await readMode("GET", {}, ok("TEST"))).json()).toEqual({ mode: "LIVE", test: false })
    expect(await (await readMode("GET", { SUPABASE_ANON_KEY: "a" }, async () => new Response("no", { status: 500 }))).json()).toEqual({ mode: "LIVE", test: false })
    expect(await (await readMode("GET", { SUPABASE_ANON_KEY: "a" }, async () => { throw new Error("down") })).json()).toEqual({ mode: "LIVE", test: false })
    expect((await readMode("GET", {}, ok("x"))).headers.get("Cache-Control")).toBe("no-store")
    expect((await readMode("POST", { SUPABASE_ANON_KEY: "a" }, ok("TEST"))).status).toBe(405)
  })
  test("it only ever calls the read function, never the owner's switch", () => {
    const code = src("functions/api/_mode.ts")
    expect(code).toContain("dpdp_platform_mode")
    expect(code).not.toMatch(/dpdp_owner_|set_mode|service_role/i)
  })
})

describe("no offer end date is written anywhere a customer, a crawler or a reader can see", () => {
  test("no source, page, doc or Edge Function carries the placeholder end date or an 'offer ends' sentence", () => {
    for (const root of [APP, join(APP, "../supabase/functions")]) {
      for (const f of walk(root)) {
        if (!/\.(tsx?|html|md|txt|mjs|js|json|xml)$/.test(f) || /\.test\.|parity\.golden|bun\.lock|TEST-REPORT/.test(f)) continue
        const body = readFileSync(f, "utf8")
        expect(body, f).not.toMatch(/offer (ends|end date|valid (till|until))|ends on 20\d\d/i)
        expect(/2026-12-31/.test(body) && /offer/i.test(body), f).toBe(false)
      }
    }
  })
})
