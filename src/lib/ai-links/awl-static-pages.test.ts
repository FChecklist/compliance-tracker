/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-47b (register row BR-496; harness AWL-H15 and AWL-H25; spec 9.4, 9.5; audit A-15): the two static pages of the
// universal AI work link, projexa-link-pages/ai-inbox.html and ai-confirm.html, checked as FILES and as running code.
//
//   FILES      each has the typed confirm-code input (id="confirm-code"), no x-vercel-id anywhere, no origin other than the two Supabase hosts
//              the pages talk to, no external script, stylesheet, image, frame, font or tracker, a no-referrer policy, and a Content-Security-
//              Policy whose script hash equals the sha256 of the inline script (an edit to the script fails here until the hash is redone)
//   BEHAVIOUR  the inline script runs against a small DOM stub and a recording fetch: nothing that changes anything is posted on page load
//              (the confirm page posts nothing; the inbox posts only /check for a proposal in the fragment), the Confirm button stays disabled
//              until the typed code matches (and, on the confirm page, until the person is signed in), the fragment is removed from the
//              address bar and never sent anywhere, and the one confirm request is POST F/drafts/{id}/confirm with the person's session
//              token and the confirm code in the body
//   THE SCRIPT scripts/verify/awl-static-pages.sh (BR-496's own command) run against a local server that serves these exact files:
//              exit 0 and the line AWL_STATIC pages=2 vercel_headers=0 confirm_code=2
//
// Needs bash and curl for the last group; a missing tool fails at load with a message, it never skips (as conformance.edge.test.ts).
// Run under Git Bash on Windows: bun test --isolate src/lib/ai-links/awl-static-pages.test.ts
import { describe, test, expect, afterAll } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..", "..")
const DIR = join(ROOT, "projexa-link-pages")
const PAGES = ["ai-inbox.html", "ai-confirm.html"] as const
const html = (name: string) => readFileSync(join(DIR, name), "utf8")

const EDGE = "https://pcrjmlpuqsbocqfwoxod.supabase.co"
const PROJEXA_AUTH = "https://evpckeuxgvahguwsaeul.supabase.co"
const F = `${EDGE}/functions/v1/ai-work-link`
const ALLOWED_ORIGINS = new Set([EDGE, PROJEXA_AUTH])

function need(cmd: string, what: string): void {
  const probe = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: 20_000 })
  if (probe.status !== 0) throw new Error(`${what} is not on PATH as \`${cmd}\`; the static page test needs it`)
}
need("bash", "bash")
need("curl", "curl")

const inlineScript = (src: string): string => {
  const found = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  if (found.length !== 1) throw new Error("expected exactly one inline script")
  return found[0][1]
}
const configOf = (src: string): Record<string, string> => JSON.parse(/<script type="application\/json" id="awl-config">([\s\S]*?)<\/script>/.exec(src)![1])

// ------------------------------------------------------------------------------------------------------------------------------- files
describe("the files", () => {
  test("the folder holds the two pages and the headers file, and nothing that runs on a server", () => {
    for (const f of [...PAGES, "_headers"]) expect(existsSync(join(DIR, f))).toBe(true)
  })

  test("AWL-H25: both pages carry the typed confirm-code input, once, as a 4-character text input", () => {
    for (const name of PAGES) {
      const src = html(name)
      expect(`${name} ${src.split('id="confirm-code"').length - 1}`).toBe(`${name} 1`)
      expect(src).toMatch(/<input id="confirm-code"[^>]*maxlength="4"/)
    }
  })

  test("AWL-H15: no x-vercel-id, no vercel host, and no origin other than the two Supabase hosts, in any page or the headers file", () => {
    for (const f of [...PAGES, "_headers"]) {
      const src = readFileSync(join(DIR, f), "utf8")
      expect(`${f} ${/x-vercel-id/i.test(src)}`).toBe(`${f} false`)
      expect(`${f} ${/vercel/i.test(src)}`).toBe(`${f} false`)
      for (const m of src.matchAll(/https?:\/\/[^\s"'`)<>;,\\]+/g)) {
        const origin = new URL(m[0]).origin
        expect(`${f} ${origin} ${ALLOWED_ORIGINS.has(origin)}`).toBe(`${f} ${origin} true`)
      }
    }
  })

  test("no external script, stylesheet, image, frame, font, import or tracker", () => {
    for (const name of PAGES) {
      const src = html(name)
      expect(src).not.toMatch(/<script[^>]*\ssrc=/i)
      expect(src).not.toMatch(/<link[^>]*href=/i)
      expect(src).not.toMatch(/<(img|iframe|frame|object|embed|video|audio|source|form)\b/i)
      expect(src).not.toMatch(/@import|url\(|@font-face/i)
      expect(src).not.toMatch(/google-analytics|googletagmanager|gtag\(|fbq\(|plausible|hotjar|segment\.|mixpanel|sentry|clarity\.ms|matomo|posthog/i)
      expect(src).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|XMLHttpRequest|WebSocket|eval\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write)/)
    }
  })

  test("a no-referrer policy, noindex, and a CSP that allows nothing but its own script hash and the Supabase hosts", () => {
    for (const name of PAGES) {
      const src = html(name)
      expect(src).toContain('<meta name="referrer" content="no-referrer">')
      expect(src).toMatch(/<meta name="robots" content="noindex/)
      const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(src)![1]
      expect(csp).toContain("default-src 'none'")
      expect(csp).toContain("base-uri 'none'")
      expect(csp).toContain("form-action 'none'")
      const hash = createHash("sha256").update(inlineScript(src), "utf8").digest("base64")
      expect(`${name} ${/script-src ([^;]+)/.exec(csp)![1]}`).toBe(`${name} 'sha256-${hash}'`)
      const connect = /connect-src ([^;]+)/.exec(csp)![1].split(" ")
      for (const o of connect) expect(`${name} ${o} ${ALLOWED_ORIGINS.has(o)}`).toBe(`${name} ${o} true`)
    }
    // the inbox talks to the Edge function only; the confirm page also to PROJEXA's sign-in
    expect(/connect-src ([^;]+)/.exec(html("ai-inbox.html"))![1]).toBe(EDGE)
  })

  test("the pages' configured function address is the real Edge function, and the sign-in key is not baked in", () => {
    for (const name of PAGES) expect(configOf(html(name))["function"]).toBe(F)
    expect(configOf(html("ai-confirm.html")).authUrl).toBe(`${PROJEXA_AUTH}/auth/v1`)
    expect(configOf(html("ai-confirm.html")).authKey).toBe("")
  })

  test("the headers file sets no-store, no-referrer, noindex and no framing", () => {
    const h = readFileSync(join(DIR, "_headers"), "utf8")
    for (const line of ["X-Robots-Tag: noindex", "Referrer-Policy: no-referrer", "Cache-Control: no-store", "X-Content-Type-Options: nosniff", "frame-ancestors 'none'"]) expect(h).toContain(line)
  })

  test("the pages are LF files, so the script hash holds on every checkout", () => {
    for (const name of PAGES) expect(html(name)).not.toContain("\r")
    expect(readFileSync(join(ROOT, ".gitattributes"), "utf8")).toContain("projexa-link-pages/* text eol=lf")
  })
})

// ------------------------------------------------------------------------------------------------------------------------------- behaviour
class El {
  id = ""
  value = ""
  textContent = ""
  className = ""
  hidden = false
  disabled = false
  type = ""
  href = ""
  children: El[] = []
  listeners: Record<string, () => void> = {}
  constructor(id = "") {
    this.id = id
  }
  appendChild(c: El): El {
    this.children.push(c)
    return c
  }
  addEventListener(type: string, fn: () => void): void {
    this.listeners[type] = fn
  }
  /** A click on a disabled button does nothing, as in a browser. */
  click(): void {
    if (this.disabled) return
    this.listeners.click?.()
  }
  input(v: string): void {
    this.value = v
    this.listeners.input?.()
  }
  text(): string {
    return [this.textContent, ...this.children.map((c) => c.text())].join("\n")
  }
}

type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown }
type Reply = { status: number; json: unknown }

function run(name: string, o: { hash?: string; config?: Record<string, string>; replies?: (s: Sent) => Reply }) {
  const src = html(name)
  const config = { ...configOf(src), ...(o.config ?? {}) }
  const els = new Map<string, El>()
  for (const m of src.matchAll(/\sid="([^"]+)"/g)) if (m[1] !== "awl-config") els.set(m[1], new El(m[1]))
  const cfgEl = new El("awl-config")
  cfgEl.textContent = JSON.stringify(config)
  els.set("awl-config", cfgEl)
  els.set("token-row", Object.assign(els.get("token-row") ?? new El("token-row"), { hidden: true }))
  const sent: Sent[] = []
  const replaced: string[] = []
  const location = { hash: o.hash ?? "", pathname: "/ai-page.html", search: "" }
  const fakeFetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const s: Sent = { url, method: init.method ?? "GET", headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body === undefined ? undefined : JSON.parse(init.body) }
    sent.push(s)
    const r = o.replies ? o.replies(s) : { status: 404, json: {} }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json }
  }
  const document = { getElementById: (id: string) => els.get(id) ?? null, createElement: () => new El() }
  const history = { replaceState: (_a: unknown, _b: string, url: string) => { replaced.push(url); location.hash = "" } }
  new Function("document", "location", "history", "crypto", "fetch", "atob", "TextDecoder", inlineScript(src))(document, location, history, crypto, fakeFetch, atob, TextDecoder)
  const $ = (id: string) => els.get(id)!
  return { $, sent, replaced, location, shownCode: () => $("shown-code").textContent }
}
const tick = () => new Promise((r) => setTimeout(r, 5))
const TOKEN = "pxa_" + "a".repeat(64)
const CONFIRM_CODE = "b".repeat(64)
const posts = (sent: Sent[]) => sent.filter((s) => s.method === "POST")

describe("ai-confirm.html run as code", () => {
  test("on load it posts nothing and reads the draft from the fragment, then removes the fragment from the address bar", async () => {
    const p = run("ai-confirm.html", { hash: `#d=drf123.${CONFIRM_CODE}` })
    await tick()
    expect(p.sent).toEqual([])
    expect(p.replaced).toEqual(["/ai-page.html"])
    expect(p.location.hash).toBe("")
    expect(p.$("draft-line").textContent).toContain("drf123")
    expect(p.$("draft-line").textContent).not.toContain(CONFIRM_CODE)
    expect(p.$("token-row").hidden).toBe(true)
    expect(p.$("confirm").disabled).toBe(true)
  })

  test("a link with no confirm code in it asks for the code to be typed", () => {
    const p = run("ai-confirm.html", { hash: "#d=drf123" })
    expect(p.$("token-row").hidden).toBe(false)
  })

  test("the typed code is 4 characters from an alphabet without look-alikes and differs between loads", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const c = run("ai-confirm.html", { hash: "#d=x" }).shownCode()
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/)
      seen.add(c)
    }
    expect(seen.size).toBeGreaterThan(10)
  })

  test("without the sign-in key set, sign-in says so and nothing is sent", async () => {
    const p = run("ai-confirm.html", { hash: `#d=drf123.${CONFIRM_CODE}` })
    expect(p.$("signin-note").textContent).toContain("not set up")
    p.$("signin").click()
    await tick()
    expect(p.sent).toEqual([])
  })

  test("Confirm stays disabled until the person is signed in AND the typed code matches; then one POST goes to the confirm route with the session and the code", async () => {
    const p = run("ai-confirm.html", {
      hash: `#d=drf123.${CONFIRM_CODE}`,
      config: { authKey: "public-test-key" },
      replies: (s) => (s.url.includes("/auth/v1/token") ? { status: 200, json: { access_token: "session-token-1" } } : { status: 200, json: { status: "confirmed", message: "Done." } }),
    })
    // not signed in, wrong code
    p.$("confirm-code").input(p.shownCode())
    expect(p.$("confirm").disabled).toBe(true)
    p.$("email").value = "person@example.test"
    p.$("password").value = "pw"
    p.$("signin").click()
    await tick()
    expect(p.$("password").value).toBe("")
    const signIn = p.sent[0]
    expect(signIn.url).toBe(`${PROJEXA_AUTH}/auth/v1/token?grant_type=password`)
    expect(signIn.headers.apikey).toBe("public-test-key")
    // signed in, but the code is wrong
    p.$("confirm-code").input("ZZZZ".replace(/./g, p.shownCode() === "ZZZZ" ? "Y" : "Z"))
    expect(p.$("confirm").disabled).toBe(true)
    p.$("confirm").click()
    await tick()
    expect(posts(p.sent).filter((s) => s.url.includes("/confirm"))).toEqual([])
    // signed in and the code typed in lower case still matches
    p.$("confirm-code").input(p.shownCode().toLowerCase())
    expect(p.$("confirm").disabled).toBe(false)
    p.$("confirm").click()
    await tick()
    const c = posts(p.sent).filter((s) => s.url.includes("/confirm"))
    expect(c).toHaveLength(1)
    expect(c[0].url).toBe(`${F}/drafts/drf123/confirm`)
    expect(c[0].headers.authorization).toBe("Bearer session-token-1")
    expect(c[0].body).toEqual({ confirmToken: CONFIRM_CODE })
    expect(p.$("result").textContent).toContain("Confirmed")
    // the code is dropped after a success, so a second click cannot send it again
    p.$("confirm").click()
    await tick()
    expect(posts(p.sent).filter((s) => s.url.includes("/confirm"))).toHaveLength(1)
  })

  test("a refusal shows a plain sentence for its stable code, and never the raw answer", async () => {
    const p = run("ai-confirm.html", {
      hash: `#d=drf123.${CONFIRM_CODE}`,
      config: { authKey: "k" },
      replies: (s) => (s.url.includes("/auth/v1/token") ? { status: 200, json: { access_token: "t" } } : { status: 409, json: { code: "CONFIRM_ALREADY_USED", error: "raw server text" } }),
    })
    p.$("signin").click()
    await tick()
    p.$("confirm-code").input(p.shownCode())
    p.$("confirm").click()
    await tick()
    expect(p.$("result").textContent).toContain("already confirmed")
    expect(p.$("result").textContent).not.toContain("raw server text")
    expect(p.$("result").className).toBe("bad")
  })
})

describe("ai-inbox.html run as code", () => {
  const history = { items: [{ intent_id: "i1", kind: "draft", function_id: "add_roster_entry", status: "awaiting_confirmation", created_at: "2026-09-26T01:00:00Z" }, { intent_id: "i2", kind: "draft", function_id: "x", status: "confirmed" }, { intent_id: "i3", kind: "action", function_id: "y", status: "awaiting_confirmation" }] }
  const reply = (s: Sent): Reply => {
    if (s.url.endsWith("/check")) return { status: 200, json: { valid: true, will_execute_directly: (s.body as { function: string }).function === "record_work_progress" } }
    if (s.url.includes("/history")) return { status: 200, json: history }
    return { status: 201, json: {} }
  }
  const proposal = (fn: string) => Buffer.from(JSON.stringify({ v: 1, function: fn, params: { itemCode: "EX-01", percent: 40 } })).toString("base64url")

  test("on load with a link it makes one GET of the history, in header mode, with the token in a header and in no address, and posts nothing", async () => {
    const p = run("ai-inbox.html", { hash: `#t=${TOKEN}`, replies: reply })
    await tick()
    expect(p.sent).toHaveLength(1)
    expect(p.sent[0].method).toBe("GET")
    expect(p.sent[0].url).toBe(`${F}/header/history?format=json&limit=50`)
    expect(p.sent[0].headers["link-token"]).toBe(TOKEN)
    for (const s of p.sent) expect(s.url).not.toContain("pxa_")
    expect(p.replaced).toEqual(["/ai-page.html"])
    // only the draft that is waiting is listed, and it points at the confirm page with just its id
    const items = p.$("drafts").children
    expect(items).toHaveLength(1)
    expect(items[0].children[0].href).toBe("ai-confirm.html#d=i1")
    expect(items[0].text()).not.toContain(TOKEN)
  })

  test("with no link in the address it says so and calls nothing", async () => {
    const p = run("ai-inbox.html", { hash: "", replies: reply })
    await tick()
    expect(p.sent).toEqual([])
    expect(p.$("status").textContent).toContain("Open this page from the link")
  })

  test("a proposal in the fragment is only CHECKED on load; the change is posted by a click after the typed code, to /drafts or /actions by the check", async () => {
    for (const [fn, path] of [["add_roster_entry", "/drafts"], ["record_work_progress", "/actions"]] as const) {
      const p = run("ai-inbox.html", { hash: `#t=${TOKEN}&p=${proposal(fn)}`, replies: reply })
      await tick()
      expect(posts(p.sent).map((s) => s.url.replace(F + "/header", ""))).toEqual(["/check"])
      const btn = p.$("blocks").children[0].children.find((c) => c.textContent === "Confirm")!
      expect(btn.disabled).toBe(false)
      // the wrong code sends nothing
      p.$("confirm-code").input("nope")
      btn.click()
      await tick()
      expect(posts(p.sent)).toHaveLength(1)
      // the right code sends exactly one change request
      p.$("confirm-code").input(p.shownCode())
      btn.click()
      await tick()
      const changes = posts(p.sent).filter((s) => !s.url.endsWith("/check"))
      expect(changes.map((s) => s.url.replace(F + "/header", ""))).toEqual([path])
      expect(changes[0].body).toEqual({ function: fn, params: { itemCode: "EX-01", percent: 40 } })
      expect(changes[0].headers["link-token"]).toBe(TOKEN)
    }
  })

  test("a pasted block is checked when read; a block that is not valid stays unconfirmable; a block that is not JSON says so; at most 20 blocks", async () => {
    const p = run("ai-inbox.html", { hash: `#t=${TOKEN}`, replies: (s) => (s.url.endsWith("/check") ? { status: 200, json: { valid: false, problems: ["Unknown parameter x."], missing: ["itemCode"] } } : reply(s)) })
    await tick()
    const block = (j: string) => "```projexa-proposal\n" + j + "\n```\n"
    p.$("paste").value = block('{"v":1,"function":"record_work_progress","params":{"x":1}}') + block("not json") + block('{"v":1,"function":"a","params":{}}').repeat(25)
    p.$("read").click()
    await tick()
    const blocks = p.$("blocks").children
    expect(blocks).toHaveLength(20)
    expect(blocks[0].text()).toContain("Unknown parameter x.")
    expect(blocks[0].children.find((c) => c.textContent === "Confirm")!.disabled).toBe(true)
    expect(blocks[1].text()).toContain("could not be read")
    expect(posts(p.sent).every((s) => s.url.endsWith("/check"))).toBe(true)
  })

  test("text written by an AI is shown as text: nothing in the script builds markup from it", () => {
    // no innerHTML and friends (asserted above for the file); every proposal string reaches the page through textContent
    expect(inlineScript(html("ai-inbox.html"))).toContain(".textContent = text")
  })
})

// ------------------------------------------------------------------------------------------------------------------------------- BR-496
describe("BR-496's own script against a local server that serves these files", () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const name = new URL(req.url).pathname.replace(/^\//, "")
      if (!(PAGES as readonly string[]).includes(name)) return new Response("not found", { status: 404 })
      return new Response(readFileSync(join(DIR, name)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
    },
  })
  afterAll(() => server.stop(true))

  const runScript = (env: Record<string, string>) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("AWL_")) clean[k] = v
      const child = spawn("bash", ["scripts/verify/awl-static-pages.sh"], { cwd: ROOT, env: { ...clean, ...env } as unknown as NodeJS.ProcessEnv })
      let out = ""
      child.stdout?.on("data", (d) => (out += d))
      child.stderr?.on("data", (d) => (out += d))
      const timer = setTimeout(() => child.kill(), 60_000)
      child.on("close", (code) => {
        clearTimeout(timer)
        resolve({ code, out: out.replace(/\r/g, "") })
      })
    })

  test("exit 0 and the expected last line", async () => {
    const r = await runScript({ AWL_CONFIRM_HOST: `127.0.0.1:${server.port}`, AWL_STATIC_SCHEME: "http" })
    expect(r.out.trim().split("\n").pop()).toBe("AWL_STATIC pages=2 vercel_headers=0 confirm_code=2")
    expect(r.code).toBe(0)
  })
})
