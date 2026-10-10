/// <reference types="bun-types" />
// public/rum.js, the first-party monitoring script: runs the REAL file against a fake browser and proves the
// privacy promises (private pages never measured, no query string, no cookie or storage, Do Not Track honoured,
// one beacon to our own /api/telemetry) plus that it reports what it is meant to (page view, speed, errors,
// failed files). And who loads it: every public, hidden and legal page, and no private one.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { HIDDEN_PAGES, LEGAL_PAGES, PRIVATE_PAGES, PUBLIC_PAGES, RUM_SCRIPT } from "./public-surface.mjs"

const root = join(import.meta.dir, "..", "..")
const source = readFileSync(join(root, "public", "rum.js"), "utf8")

type Beacon = { url: string; body: string }
interface Run {
  beacons: Beacon[]
  listeners: Record<string, Array<(e: unknown) => void>>
  touched: string[]
  fire: (type: string, event?: unknown) => void
  flush: () => Promise<Array<Record<string, unknown>>>
}

/** Executes rum.js as a browser would, on `href`, with a fake window. */
function run(href: string, opts: { dnt?: boolean; gpc?: boolean; referrer?: string; width?: number; entries?: Record<string, unknown[]> } = {}): Run {
  const url = new URL(href)
  const beacons: Beacon[] = []
  const listeners: Run["listeners"] = {}
  const touched: string[] = []
  const trap = (name: string) => () => { touched.push(name); throw new Error(`rum.js touched ${name}`) }
  const entries = opts.entries ?? {}
  class FakeObserver {
    constructor(public cb: (l: { getEntries: () => unknown[] }) => void) {}
    observe() {}
  }
  const win: Record<string, unknown> = { PerformanceObserver: FakeObserver, fetch: undefined, doNotTrack: opts.dnt ? "1" : undefined }
  const nav = {
    sendBeacon: (u: string, blob: Blob) => { beacons.push({ url: u, body: "" }); void blob.text().then((t) => { beacons[beacons.length - 1]!.body = t }); return true },
    doNotTrack: opts.dnt ? "1" : null,
    globalPrivacyControl: opts.gpc ? true : undefined,
  }
  const doc = { referrer: opts.referrer ?? "", readyState: "loading", visibilityState: "visible" }
  Object.defineProperty(doc, "cookie", { get: trap("document.cookie"), set: trap("document.cookie") })
  const perf = {
    getEntriesByType: (t: string) => entries[t] ?? [],
    getEntriesByName: (n: string) => entries[n] ?? [],
    now: () => 0,
  }
  const fn = new Function("location", "navigator", "window", "document", "performance", "PerformanceObserver", "addEventListener", "innerWidth", "setTimeout", "localStorage", "sessionStorage", source)
  fn(
    { pathname: url.pathname, href: url.href, origin: url.origin, search: url.search, hostname: url.hostname },
    nav,
    win,
    doc,
    perf,
    FakeObserver,
    (type: string, cb: (e: unknown) => void) => { (listeners[type] ||= []).push(cb) },
    opts.width ?? 1280,
    () => 0,
    new Proxy({}, { get: trap("localStorage") }),
    new Proxy({}, { get: trap("sessionStorage") }),
  )
  const fire = (type: string, event?: unknown) => (listeners[type] ?? []).forEach((cb) => cb(event))
  return {
    beacons,
    listeners,
    touched,
    fire,
    flush: async () => {
      fire("pagehide")
      await new Promise((r) => setTimeout(r, 0))
      return beacons.flatMap((b) => (JSON.parse(b.body) as { e: Array<Record<string, unknown>> }).e)
    },
  }
}

describe("public/rum.js: what it never does", () => {
  test("it does nothing at all on any private prefix, or on the pages under it", async () => {
    for (const priv of PRIVATE_PAGES) {
      for (const path of [priv.prefix, `${priv.prefix}abc`, priv.prefix.slice(0, -1)]) {
        const r = run(`https://dpdp.veridian-aios.com${path}#access_token=SECRET`)
        expect(Object.keys(r.listeners), path).toEqual([])
        expect(await r.flush(), path).toEqual([])
        expect(r.beacons, path).toEqual([])
      }
    }
  })

  test("a query string and a fragment never leave the browser: the page view carries the pathname only", async () => {
    const r = run("https://veridian-aios.com/dpdp-firm/?ref=ABCD1234&utm_source=x#section", { referrer: "https://www.google.com/search?q=dpdp+secret" })
    const events = await r.flush()
    expect(events.length).toBeGreaterThan(0)
    const wire = JSON.stringify(events)
    expect(wire).not.toContain("ABCD1234")
    expect(wire).not.toContain("utm_source")
    expect(wire).not.toContain("secret")
    expect(wire).not.toContain("?")
    expect(events[0]).toMatchObject({ k: "pv", p: "/dpdp-firm/", d: "www.google.com|desktop" })
  })

  test("an error whose file name or message carries a query string is reported without it", async () => {
    const r = run("https://veridian-aios.com/about/")
    r.fire("error", { message: "Boom?token=SECRETTOKEN", filename: "https://veridian-aios.com/assets/a.js?ref=SECRETTOKEN", lineno: 7 })
    r.fire("error", { target: { src: "https://veridian-aios.com/fonts/x.woff2?v=SECRETTOKEN" } })
    r.fire("unhandledrejection", { reason: new Error("nope#SECRETTOKEN") })
    const wire = JSON.stringify(await r.flush())
    expect(wire).not.toContain("SECRETTOKEN")
    expect(wire).toContain("/assets/a.js:7")
    expect(wire).toContain("/fonts/x.woff2")
  })

  test("it sets no cookie and touches no browser storage (the fake throws if it does)", async () => {
    const r = run("https://veridian-aios.com/")
    r.fire("error", { message: "x", filename: "", lineno: 1 })
    await r.flush()
    expect(r.touched).toEqual([])
  })

  test("Do Not Track and Global Privacy Control switch it off", async () => {
    for (const opts of [{ dnt: true }, { gpc: true }]) {
      const r = run("https://veridian-aios.com/", opts)
      expect(Object.keys(r.listeners)).toEqual([])
      expect(await r.flush()).toEqual([])
    }
  })

  test("the only destination is this site's own /api/telemetry, through one sendBeacon call", async () => {
    const r = run("https://veridian-aios.com/")
    await r.flush()
    expect(r.beacons.length).toBe(1)
    expect(r.beacons[0]!.url).toBe("/api/telemetry")
    expect(source).not.toMatch(/https?:\/\//)
    expect((source.match(/sendBeacon\(/g) ?? []).length).toBe(1)
  })
})

describe("public/rum.js: what it reports", () => {
  test("a page view with the referrer's host (never its path) and the device class; none for the site's own referrer", async () => {
    const own = await run("https://veridian-aios.com/about/", { referrer: "https://veridian-aios.com/" }).flush()
    expect(own[0]).toMatchObject({ k: "pv", d: "|desktop" })
    const phone = await run("https://veridian-aios.com/", { referrer: "https://t.co/abc?x=1", width: 390 }).flush()
    expect(phone[0]).toMatchObject({ k: "pv", d: "t.co|mobile" })
  })

  test("speed figures, a 404 file and a refused page are reported on the way out", async () => {
    const r = run("https://veridian-aios.com/pricing/", {
      entries: {
        navigation: [{ responseStart: 120, loadEventEnd: 900, responseStatus: 200 }],
        resource: [{ name: "https://veridian-aios.com/assets/gone.js?v=SECRETV", responseStatus: 404 }, { name: "https://veridian-aios.com/ok.css", responseStatus: 200 }],
        "first-contentful-paint": [{ startTime: 500 }],
      },
    })
    const events = await r.flush()
    const vitals = Object.fromEntries(events.filter((e) => e.k === "vital").map((e) => [e.n, e.v]))
    expect(vitals).toMatchObject({ TTFB: 120, LOAD: 900, FCP: 500, CLS: 0 })
    const res = events.filter((e) => e.k === "res")
    expect(res).toEqual([expect.objectContaining({ n: "http-404", d: "/assets/gone.js" })])
    expect(JSON.stringify(events)).not.toContain("SECRETV")
  })

  test("a script that throws, a file that fails to load and an unhandled rejection are all crash reports", async () => {
    const r = run("https://veridian-aios.com/")
    r.fire("error", { message: "x is not a function", filename: "https://veridian-aios.com/assets/index-1.js", lineno: 3 })
    r.fire("error", { target: { href: "https://veridian-aios.com/fonts/sora-latin-wght.woff2" } })
    r.fire("unhandledrejection", { reason: { message: "network down" } })
    const events = await r.flush()
    expect(events.filter((e) => e.k === "err").map((e) => e.n + ":" + e.d)).toEqual(["js:x is not a function @/assets/index-1.js:3", "promise:network down"])
    expect(events.filter((e) => e.k === "res")).toEqual([expect.objectContaining({ n: "load-failed", d: "/fonts/sora-latin-wght.woff2" })])
  })

  test("it never sends more than 30 events from one page", async () => {
    const r = run("https://veridian-aios.com/")
    for (let i = 0; i < 100; i++) r.fire("error", { message: "e" + i, filename: "", lineno: 1 })
    expect((await r.flush()).length).toBeLessThanOrEqual(30)
  })
})

describe("public/rum.js: who loads it", () => {
  test("the file exists and the tag is the pinned one", () => {
    expect(existsSync(join(root, "public", "rum.js"))).toBe(true)
    expect(RUM_SCRIPT.tag).toBe('<script defer src="/rum.js"></script>')
  })

  test("every public, hidden and legal page loads it once, in the head, after ref.js where there is one", () => {
    for (const p of [...PUBLIC_PAGES, ...LEGAL_PAGES, ...HIDDEN_PAGES]) {
      const html = readFileSync(join(root, p.source), "utf8")
      expect(html.split(RUM_SCRIPT.tag).length - 1, p.source).toBe(1)
      expect(html.indexOf(RUM_SCRIPT.tag), p.source).toBeLessThan(html.indexOf("</head>"))
      if (html.includes("/ref.js")) expect(html.indexOf('src="/ref.js"'), p.source).toBeLessThan(html.indexOf(RUM_SCRIPT.tag))
    }
  })

  test("no private page loads it, and neither does the 404 page", () => {
    for (const priv of PRIVATE_PAGES) {
      if (!priv.source) continue
      const html = readFileSync(join(root, priv.source), "utf8")
      expect(html, priv.source).not.toContain("/rum.js")
    }
    expect(readFileSync(join(root, "public", "404.html"), "utf8")).not.toContain("/rum.js")
  })
})
