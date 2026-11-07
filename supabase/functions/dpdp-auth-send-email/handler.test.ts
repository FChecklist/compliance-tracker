import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import { buildMessage, handleSendEmail, renderGoTemplate, type HookDeps } from "./handler"

const dir = new URL("./", import.meta.url)
const magicHtml = readFileSync(new URL("magic-link.html", dir), "utf8")
const magicSubject = readFileSync(new URL("magic-link.subject.txt", dir), "utf8")
const SECRET_RAW = Buffer.from("test-secret-bytes-0123456789abcd")
const SECRET = "v1,whsec_" + SECRET_RAW.toString("base64")
const NOW = 1_800_000_000_000

function signed(payload: object, over: { ts?: number; secret?: Buffer } = {}) {
  const body = JSON.stringify(payload), id = "msg_1", ts = String(over.ts ?? Math.floor(NOW / 1000))
  const mac = createHmac("sha256", over.secret ?? SECRET_RAW).update(`${id}.${ts}.${body}`).digest("base64")
  return new Request("https://x.test/hook", { method: "POST", body, headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${mac}` } })
}
const payload = (redirect = "https://dpdp.veridian-aios.com/app/", type = "magiclink") => ({ user: { email: "t@test.invalid" }, email_data: { token: "123456", token_hash: "hash1", email_action_type: type, redirect_to: redirect, site_url: "https://veridian-aios.com" } })

function deps(plan: { resend?: number | "throw"; cf?: number | "throw"; cfKey?: boolean }) {
  const calls: string[] = []
  const env: Record<string, string> = { SEND_EMAIL_HOOK_SECRET: SECRET, SUPABASE_URL: "https://p.supabase.co", RESEND_API_KEY: "re_x", ...(plan.cfKey === false ? {} : { CLOUDFLARE_EMAIL_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }) }
  const f = (async (url: string) => {
    const which = String(url).includes("resend") ? "resend" : "cloudflare"; calls.push(which)
    const r = which === "resend" ? plan.resend : plan.cf
    if (r === "throw") throw new Error("net")
    return new Response("{}", { status: r ?? 200 })
  }) as unknown as typeof fetch
  const d: HookDeps = { env: (k) => env[k] ?? "", fetch: f, now: () => NOW, magicHtml, magicSubject }
  return { d, calls }
}

describe("dpdp-auth-send-email hook", () => {
  test("a bad or stale signature is refused and nothing is sent", async () => {
    const { d, calls } = deps({})
    expect((await handleSendEmail(signed(payload(), { secret: Buffer.from("other-secret-bytes-0123456789abc") }), d)).status).toBe(401)
    expect((await handleSendEmail(signed(payload(), { ts: Math.floor(NOW / 1000) - 3600 }), d)).status).toBe(401)
    expect(calls).toEqual([])
  })
  test("Resend works: one send, Cloudflare untouched", async () => {
    const { d, calls } = deps({ resend: 200 })
    expect((await handleSendEmail(signed(payload()), d)).status).toBe(200)
    expect(calls).toEqual(["resend"])
  })
  test("Resend refuses (quota 4xx/5xx or network error): Cloudflare sends instead", async () => {
    for (const r of [403, 429, 500, "throw" as const]) {
      const { d, calls } = deps({ resend: r, cf: 200 })
      expect((await handleSendEmail(signed(payload()), d)).status).toBe(200)
      expect(calls).toEqual(["resend", "cloudflare"])
    }
  })
  test("both fail: the hook answers 500 so the page shows its normal message", async () => {
    const { d } = deps({ resend: 403, cf: 500 })
    const res = await handleSendEmail(signed(payload()), d)
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { http_code: number } }).error.http_code).toBe(500)
  })
  test("Cloudflare not configured yet: still 500 when Resend fails, never throws", async () => {
    const { d, calls } = deps({ resend: 403, cfKey: false })
    expect((await handleSendEmail(signed(payload()), d)).status).toBe(500)
    expect(calls).toEqual(["resend"])
  })
  test("DPDP redirect gets the three-option design, any other redirect gets the original text", () => {
    const { d } = deps({})
    const dp = buildMessage(d, { email: "t@test.invalid" }, payload().email_data)
    expect(dp.subject).toContain("Sign in to Veridian DPDP")
    expect(dp.html).toContain("OPTION 3")
    expect(dp.html).toContain("123456")
    expect(dp.html).toContain("https://p.supabase.co/auth/v1/verify?token=hash1&amp;type=magiclink")
    const other = buildMessage(d, { email: "t@test.invalid" }, payload("https://other.example/app/").email_data)
    expect(other.subject).toBe("Your sign-in link")
    expect(other.html).toContain("Follow the link below to sign in")
    expect(other.html).not.toContain("OPTION 3")
  })
  test("other mail types get a plain message with the link; the code is shown for reauthentication", () => {
    const { d } = deps({})
    expect(buildMessage(d, { email: "t@test.invalid" }, payload("https://x.test/", "recovery").email_data).html).toContain("/auth/v1/verify?token=hash1&amp;type=recovery")
    expect(buildMessage(d, { email: "t@test.invalid" }, payload("https://x.test/", "reauthentication").email_data).html).toContain("<b>123456</b>")
  })
  test("template values are HTML-escaped", () => {
    expect(renderGoTemplate("<p>{{ .Token }}</p>", { Token: "<b>&\"" })).toBe("<p>&lt;b&gt;&amp;&quot;</p>")
  })
  test("the function's copy of the template is byte-identical to supabase/auth-templates", () => {
    expect(magicHtml).toBe(readFileSync(new URL("../../auth-templates/magic-link.html", dir), "utf8"))
    expect(magicSubject).toBe(readFileSync(new URL("../../auth-templates/magic-link.subject.txt", dir), "utf8"))
  })
})
