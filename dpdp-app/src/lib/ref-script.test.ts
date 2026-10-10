/// <reference types="bun-types" />
// public/ref.js keeps a Sales Partner's ?ref=<code> from a shared link, so it
// survives the click from a public page to /app/ (same origin, same
// localStorage). These tests run the real file against a fake window, tie its
// key and validation to src/lib/landing.ts (which reads the code back), and
// prove every public/hidden page loads it and no private page does.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { HIDDEN_PAGES, PRIVATE_PAGES, PUBLIC_PAGES, REF_SCRIPT } from "./public-surface.mjs"
import { recallReferral } from "./landing"

const root = join(import.meta.dir, "..", "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")
const source = read("public/ref.js")

type Store = Record<string, string>
function run(href: string, opts: { storage?: "ok" | "throws" | "missing" } = {}) {
  const store: Store = {}
  const calls: string[] = []
  const storage =
    opts.storage === "throws"
      ? {
          getItem: () => {
            throw new Error("blocked")
          },
          setItem: () => {
            throw new Error("blocked")
          },
        }
      : { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
  const win: Record<string, unknown> = {
    location: { href },
    history: { state: { s: 1 }, replaceState: (_s: unknown, _t: string, url: string) => void calls.push(url) },
  }
  if (opts.storage !== "missing") win.localStorage = storage
  new Function("window", source)(win)
  return { store, calls }
}

describe("public/ref.js: the logic", () => {
  test("a valid ?ref= is stored under landing.ts's key and removed from the address bar (path, other params and hash kept)", () => {
    const { store, calls } = run("https://veridian-aios.com/dpdp-firm/?ref=ABCD2345&edition=firm#top")
    expect(store).toEqual({ "dpdp-referral": "ABCD2345" })
    expect(calls).toEqual(["/dpdp-firm/?edition=firm#top"])
  })

  test("the home page: ?ref= alone leaves a clean path", () => {
    const { store, calls } = run("https://veridian-aios.com/?ref=Zz9Zz9Zz")
    expect(store["dpdp-referral"]).toBe("Zz9Zz9Zz")
    expect(calls).toEqual(["/"])
  })

  test("the key and the validation are the ones src/lib/landing.ts uses (it reads the code back)", () => {
    const landing = read("src/lib/landing.ts")
    expect(/const REFERRAL_KEY = "([^"]+)"/.exec(landing)![1]).toBe("dpdp-referral")
    expect(landing).toContain("/^[A-Za-z0-9]{4,16}$/")
    expect(source).toContain("/^[A-Za-z0-9]{4,16}$/")
    expect(source).toContain('"dpdp-referral"')
  })

  test("what ref.js stores, the app's recallReferral() finds when the visitor signs in", () => {
    const { store } = run("https://veridian-aios.com/?ref=ABCD2345")
    const g = globalThis as unknown as { localStorage?: unknown }
    const before = g.localStorage
    g.localStorage = { getItem: (k: string) => store[k] ?? null }
    try {
      expect(recallReferral()).toBe("ABCD2345")
    } finally {
      g.localStorage = before
    }
  })

  test("a code that does not look like a code is never stored (too short, too long, symbols), and ?ref= is still removed", () => {
    for (const bad of ["abc", "A".repeat(17), "AB-CD-EF", "%3Cscript%3E", ""]) {
      const { store, calls } = run(`https://veridian-aios.com/about/?ref=${bad}`)
      expect(store, bad).toEqual({})
      expect(calls, bad).toEqual(["/about/"])
    }
  })

  test("no ?ref= at all: nothing stored, the address bar is not touched", () => {
    const { store, calls } = run("https://veridian-aios.com/partner/?utm=x")
    expect(store).toEqual({})
    expect(calls).toEqual([])
  })

  test("blocked or missing localStorage: no error, the address bar is still cleaned", () => {
    for (const storage of ["throws", "missing"] as const) {
      const { calls } = run("https://veridian-aios.com/?ref=ABCD2345", { storage })
      expect(calls, storage).toEqual(["/"])
    }
  })

  test("it uses no cookie, no network and no other storage", () => {
    for (const banned of ["cookie", "fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "sessionStorage", "indexedDB", "import(", "eval(", "document."]) expect(source, banned).not.toContain(banned)
    expect(source).not.toMatch(/https?:\/\//)
  })
})

describe("public/ref.js: who loads it", () => {
  test("the file exists and the tag is a same-origin deferred script", () => {
    expect(existsSync(join(root, "public", "ref.js"))).toBe(true)
    expect(REF_SCRIPT.tag).toBe('<script defer src="/ref.js"></script>')
  })

  test("every public and hidden page loads it exactly once, in <head>", () => {
    for (const p of [...PUBLIC_PAGES.map((x) => x.source), ...HIDDEN_PAGES.map((x) => x.source)]) {
      const html = read(p)
      expect(html.split(REF_SCRIPT.tag).length - 1, p).toBe(1)
      expect(html.indexOf(REF_SCRIPT.tag), p).toBeLessThan(html.indexOf("</head>"))
    }
    expect(PUBLIC_PAGES.map((p) => p.path)).toEqual(expect.arrayContaining(["/", "/dpdp-firm/", "/dpdp-institution/", "/about/", "/partner/"]))
  })

  test("no private page loads it or any other script src (the app's own bundle is the only script there)", () => {
    for (const priv of PRIVATE_PAGES) {
      if (priv.source === null) continue
      const html = read(priv.source)
      expect(html, priv.source).not.toContain("/ref.js")
      expect(html, priv.source).not.toContain(REF_SCRIPT.tag)
    }
  })
})
