import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { copyToClipboard, fetchPrompt, promptPath, promptTokenFromHash } from "./copy-prompt"
import { PRIVATE_PAGES, parseHeadersFile, resolveHeaders, parseRobots } from "./public-surface.mjs"

// The one-tap Copy page behind the Monday email's "Copy" button (owner, 2026-09-30). The pure half, plus the rules that keep it a
// private page like /act/ and /unsubscribe/: never indexed, no referrer, no third-party anything, token only in the fragment.
const TOKEN = "ab".repeat(32) // 64 hex characters, low entropy on purpose (gitleaks)
const APP = join(import.meta.dir, "..", "..")
const PROMPT = "You are my DPDP compliance assistant. Help me finish this week's DPDP jobs at Acme & Co.\n\nMy link (works until 12 October 2026):\nhttps://app.veridian-aios.com/ai/" + TOKEN

describe("promptTokenFromHash", () => {
  test("a token in the fragment, with or without the #", () => {
    expect(promptTokenFromHash(`#${TOKEN}`)).toBe(TOKEN)
    expect(promptTokenFromHash(TOKEN)).toBe(TOKEN)
  })
  test("anything that is not a token is refused: empty, short, a path, spaces, a query, a second key", () => {
    for (const bad of ["", "#", "#abc", "#" + TOKEN + "/../x", "#" + TOKEN + " x", "#" + TOKEN + "?a=1", "#t=" + TOKEN, "#" + "a".repeat(300), "#<script>alert(1)</script>"]) {
      expect(promptTokenFromHash(bad)).toBeNull()
    }
  })
  test("the path is exactly /ai/<token>/prompt on the same origin", () => {
    expect(promptPath(TOKEN)).toBe(`/ai/${TOKEN}/prompt`)
  })
})

describe("fetchPrompt", () => {
  const ok = (body: string, status = 200) => async () => new Response(body, { status })
  test("a prompt: line endings normalised, trimmed; asks the right path with no cookies, no cache and no referrer", async () => {
    let seen: { input: string; init?: RequestInit } | null = null
    const r = await fetchPrompt(TOKEN, async (input, init) => { seen = { input, init }; return new Response(PROMPT.replace(/\n/g, "\r\n") + "\r\n\r\n") })
    expect(r).toEqual({ kind: "ok", text: PROMPT })
    expect(seen!.input).toBe(`/ai/${TOKEN}/prompt`)
    expect(seen!.init).toMatchObject({ method: "GET", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" })
  })
  test("a link that is gone, expired, revoked or unknown is one answer", async () => {
    for (const status of [401, 404, 410]) expect(await fetchPrompt(TOKEN, ok("This link has expired or was revoked", status))).toEqual({ kind: "gone" })
  })
  test("a server problem, a network failure, or a 200 that is not a prompt (an error page) is an error, never copied as the prompt", async () => {
    expect(await fetchPrompt(TOKEN, ok("boom", 500))).toEqual({ kind: "error" })
    expect(await fetchPrompt(TOKEN, ok("boom", 429))).toEqual({ kind: "error" })
    expect(await fetchPrompt(TOKEN, async () => { throw new Error("offline") })).toEqual({ kind: "error" })
    expect(await fetchPrompt(TOKEN, ok("<html><body>The DPDP chooser</body></html>"))).toEqual({ kind: "error" })
    expect(await fetchPrompt(TOKEN, ok("This link has expired or was revoked"))).toEqual({ kind: "error" })
    expect(await fetchPrompt(TOKEN, ok(""))).toEqual({ kind: "error" })
    // a prompt that carries somebody else's link (or none) is not this person's prompt
    expect(await fetchPrompt(TOKEN, ok(PROMPT.replace(TOKEN, "cd".repeat(32))))).toEqual({ kind: "error" })
    expect(await fetchPrompt(TOKEN, ok(PROMPT + "x".repeat(21_000)))).toEqual({ kind: "error" })
  })
})

describe("copyToClipboard", () => {
  test("the async clipboard when it works", async () => {
    let got = ""
    expect(await copyToClipboard("hello", { writeText: async (t) => { got = t } })).toBe(true)
    expect(got).toBe("hello")
  })
  test("a browser that refuses (Safari, Firefox without a tap) falls back to select-and-copy, then to 'false' so the page shows its button", async () => {
    const refuse = async () => { throw new Error("NotAllowedError") }
    expect(await copyToClipboard("x", { writeText: refuse, legacyCopy: () => true })).toBe(true)
    expect(await copyToClipboard("x", { writeText: refuse, legacyCopy: () => false })).toBe(false)
    expect(await copyToClipboard("x", { writeText: refuse })).toBe(false)
    expect(await copyToClipboard("x", {})).toBe(false)
    expect(await copyToClipboard("x", { legacyCopy: () => { throw new Error("x") } })).toBe(false)
  })
})

describe("it is a private page like /act/ and /unsubscribe/", () => {
  const read = (f: string) => readFileSync(join(APP, f), "utf8")
  test("registered as private, so it is built, kept out of the sitemap, and every guard models it", () => {
    expect(PRIVATE_PAGES.some((p: { prefix: string; source: string | null }) => p.prefix === "/copy/" && p.source === "copy/index.html")).toBe(true)
    expect(existsSync(join(APP, "copy", "index.html"))).toBe(true)
  })
  test("its headers over HTTP: noindex, no referrer, never cached (and the site-wide Referrer-Policy is detached first)", () => {
    const rules = parseHeadersFile(read("public/_headers"))
    for (const path of ["/copy/", "/copy/index.html"]) {
      const h = resolveHeaders(rules, path)
      expect(h["x-robots-tag"]).toBe("noindex, nofollow")
      expect(h["referrer-policy"]).toBe("no-referrer")
      expect(h["cache-control"]).toBe("no-store")
    }
  })
  test("robots.txt keeps every bot out of it, in both groups", () => {
    const { groups } = parseRobots(read("public/robots.txt"))
    expect(groups.length).toBeGreaterThanOrEqual(2)
    for (const g of groups) expect(g.disallow).toContain("/copy/")
  })
  test("the page itself: noindex, no referrer, no third-party link or script, the token only ever in the fragment", () => {
    const html = read("copy/index.html")
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(html).toContain('<meta name="referrer" content="no-referrer" />')
    expect(html.match(/(?:src|href)="([^"]+)"/g)!.every((a) => /="\/(src\/copy\.tsx|fonts\/[\w.-]+\.woff2)"/.test(a))).toBe(true)
    const page = read("src/components/CopyPromptPage.tsx")
    expect(page).toContain("window.history.replaceState(null, \"\", window.location.pathname + window.location.search)")
    for (const bad of ["localStorage", "sessionStorage", "console.", "document.cookie", "https://"]) expect(page).not.toContain(bad)
    const lib = read("src/lib/copy-prompt.ts")
    for (const bad of ["localStorage", "sessionStorage", "console.", "document.cookie"]) expect(lib).not.toContain(bad)
  })
})
