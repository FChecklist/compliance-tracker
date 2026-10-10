/// <reference types="bun-types" />
/* eslint-disable @typescript-eslint/no-explicit-any -- the fake browser is deliberately loose */
// public/visit.js, the first-party visit-journey script: runs the REAL file against a fake browser and proves what it records (page view, sections with dwell, calls to action,
// choices, scroll depth, exit, source and campaign tags on the first beacon only), what it never records (typed text, the query string, anything on private pages), and the privacy
// signal (Global Privacy Control / Do Not Track: one count-only beacon, no id, no storage, no listeners).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PRIVATE_PAGES } from "./public-surface.mjs"

const source = readFileSync(join(import.meta.dir, "..", "..", "public", "visit.js"), "utf8")

type Beacon = { url: string; body: Record<string, any> }
type El = Record<string, any>

function makeSection(id: string | null, heading: string | null, extra: Record<string, string> = {}): El {
  return {
    id: id ?? "",
    tagName: "SECTION",
    getAttribute: (n: string) => (n === "aria-labelledby" ? null : extra[n] ?? null),
    querySelector: () => (heading ? { textContent: heading } : null),
  }
}

function run(href: string, opts: { gpc?: boolean; dnt?: boolean; referrer?: string; cookie?: string; local?: Record<string, string>; session?: Record<string, string>; sections?: El[]; scrollHeight?: number; width?: number } = {}) {
  const url = new URL(href)
  const beacons: Beacon[] = []
  const pending: Array<Promise<void>> = []
  const listeners: Record<string, Array<(e: any) => void>> = {}
  const docListeners: Record<string, Array<(e: any) => void>> = {}
  const touched: string[] = []
  const local: Record<string, string> = { ...(opts.local ?? {}) }
  const session: Record<string, string> = { ...(opts.session ?? {}) }
  const jar: string[] = opts.cookie ? [opts.cookie] : []
  const cookies: string[] = []
  let now = 1_000_000
  let io: { cb: (entries: any[]) => void; seen: El[] } | null = null
  class FakeIO {
    seen: El[] = []
    constructor(cb: (entries: any[]) => void) { io = { cb, seen: this.seen } }
    observe(el: El) { this.seen.push(el) }
  }
  const nav = { sendBeacon: (u: string, blob: Blob) => { const slot: Beacon = { url: u, body: {} }; beacons.push(slot); pending.push(blob.text().then((t) => { slot.body = JSON.parse(t) })); return true }, globalPrivacyControl: opts.gpc ? true : undefined, doNotTrack: opts.dnt ? "1" : null, language: "en-IN" }
  const store = (bag: Record<string, string>, name: string) => ({ getItem: (k: string) => (k in bag ? bag[k]! : null), setItem: (k: string, v: string) => { bag[k] = v }, _name: name })
  const doc: Record<string, any> = {
    referrer: opts.referrer ?? "",
    visibilityState: "visible",
    documentElement: { scrollHeight: opts.scrollHeight ?? 3000, scrollTop: 0 },
    querySelectorAll: () => opts.sections ?? [],
    getElementById: () => null,
    addEventListener: (t: string, cb: (e: any) => void) => { (docListeners[t] ||= []).push(cb) },
  }
  Object.defineProperty(doc, "cookie", { get: () => jar.join("; "), set: (v: string) => { cookies.push(v); const [kv] = v.split(";"); const [k] = kv!.split("="); const i = jar.findIndex((c) => c.startsWith(k + "=")); if (i >= 0) jar[i] = kv!; else jar.push(kv!) } })
  const win: Record<string, any> = { crypto: { getRandomValues: (b: Uint8Array) => { for (let i = 0; i < b.length; i++) b[i] = (i * 37 + 11 + now) & 255; return b } }, IntersectionObserver: FakeIO, pageYOffset: 0, doNotTrack: opts.dnt ? "1" : undefined }
  const fn = new Function("location", "navigator", "window", "document", "localStorage", "sessionStorage", "addEventListener", "innerWidth", "innerHeight", "IntersectionObserver", "Date", source)
  const g = { Date: { now: () => now } }
  fn(
    { pathname: url.pathname, href: url.href, host: url.host, hostname: url.hostname, search: url.search, protocol: url.protocol },
    nav, win, doc, store(local, "local"), store(session, "session"),
    (t: string, cb: (e: any) => void) => { (listeners[t] ||= []).push(cb) },
    opts.width ?? 1280, 800, FakeIO, g.Date,
  )
  const fire = (t: string, e?: any) => (listeners[t] ?? []).forEach((cb) => cb(e))
  const fireDoc = (t: string, e?: any) => (docListeners[t] ?? []).forEach((cb) => cb(e))
  const settle = async () => { await Promise.all(pending) }
  return {
    beacons, listeners, docListeners, touched, local, session, cookies, jar, fire, fireDoc, settle,
    tick: (ms: number) => { now += ms },
    scrollTo: (y: number) => { win.pageYOffset = y; fire("scroll") },
    enter: (el: El) => io!.cb([{ target: el, isIntersecting: true, intersectionRatio: 0.8 }]),
    leave: (el: El) => io!.cb([{ target: el, isIntersecting: false, intersectionRatio: 0 }]),
    hide: async () => { doc.visibilityState = "hidden"; fire("visibilitychange"); await settle() },
    show: () => { doc.visibilityState = "visible"; fire("visibilitychange") },
    pagehide: async () => { fire("pagehide"); await settle() },
    events: async () => { await settle(); return beacons.flatMap((b) => b.body.e ?? []) },
  }
}

const link = (href: string, extra: El = {}): El => ({ tagName: "A", getAttribute: (n: string) => (n === "href" ? href : null), closest: function () { return this }, ...extra })
const click = (r: ReturnType<typeof run>, el: El) => r.fireDoc("click", { target: el })

describe("public/visit.js: what it never does", () => {
  test("it does nothing at all on any private prefix, or on the pages under it", async () => {
    for (const priv of PRIVATE_PAGES) {
      for (const path of [priv.prefix, `${priv.prefix}abc`, priv.prefix.slice(0, -1)]) {
        const r = run(`https://dpdp.veridian-aios.com${path}#access_token=SECRET`)
        expect(Object.keys(r.listeners), path).toEqual([])
        expect(Object.keys(r.docListeners), path).toEqual([])
        await r.pagehide()
        expect(r.beacons, path).toEqual([])
        expect(r.cookies, path).toEqual([])
        expect(r.local, path).toEqual({})
      }
    }
  })

  test("Global Privacy Control and Do Not Track: one count-only beacon, no id anywhere, no cookie, no storage, no listeners", async () => {
    for (const opts of [{ gpc: true }, { dnt: true }]) {
      const r = run("https://veridian-aios.com/dpdp-firm/?ref=ABCD1234", opts)
      await r.settle()
      expect(r.beacons.length).toBe(1)
      expect(r.beacons[0]!.url).toBe("/api/visit")
      expect(r.beacons[0]!.body).toEqual({ off: 1, p: "/dpdp-firm/", d: "desktop" })
      expect(r.cookies).toEqual([]); expect(r.local).toEqual({}); expect(r.session).toEqual({})
      expect(Object.keys(r.listeners)).toEqual([]); expect(Object.keys(r.docListeners)).toEqual([])
    }
  })

  test("typed text is never read: text boxes, e-mail boxes, text areas and key presses are not listened to; values with spaces or an at-sign are skipped", async () => {
    const r = run("https://veridian-aios.com/")
    expect(Object.keys(r.docListeners).sort()).toEqual(["change", "click"])
    expect(Object.keys(r.listeners)).not.toContain("keydown"); expect(Object.keys(r.listeners)).not.toContain("input")
    r.fireDoc("change", { target: { tagName: "INPUT", type: "text", name: "name", id: "n", value: "Priya Shah", checked: false, getAttribute: () => null } })
    r.fireDoc("change", { target: { tagName: "INPUT", type: "email", name: "email", value: "priya@acme.in", getAttribute: () => null } })
    r.fireDoc("change", { target: { tagName: "TEXTAREA", name: "msg", value: "hello", getAttribute: () => null } })
    r.fireDoc("change", { target: { tagName: "SELECT", name: "role", value: "priya@acme.in", getAttribute: () => null } })
    r.fireDoc("change", { target: { tagName: "SELECT", name: "role", value: "Priya Shah", getAttribute: () => null } })
    await r.pagehide()
    const wire = JSON.stringify(r.beacons.map((b) => b.body))
    expect(wire).not.toMatch(/priya|hello|acme/i)
    expect((await r.events()).filter((e) => e.k === "choice")).toEqual([])
  })

  test("the query string and fragment never leave the browser except the campaign tags and the referring HOST on the first beacon", async () => {
    const r = run("https://veridian-aios.com/dpdp-firm/?ref=ABCD1234&utm_source=news&utm_medium=email&utm_campaign=launch&token=SECRETTOKEN#pricing", { referrer: "https://www.google.com/search?q=dpdp+secret" })
    await r.pagehide()
    const wire = JSON.stringify(r.beacons.map((b) => b.body))
    expect(wire).not.toMatch(/ABCD1234|SECRETTOKEN|secret|search\?q|pricing#|\?/)
    expect(r.beacons[0]!.body.r).toBe("www.google.com")
    expect(r.beacons[0]!.body.u).toEqual({ s: "news", m: "email", c: "launch", t: "", n: "" })
  })

  test("the source is sent once per visit: a second page in the same tab session carries no referrer and no campaign tags", async () => {
    const first = run("https://veridian-aios.com/?utm_source=x", { referrer: "https://www.linkedin.com/feed/" })
    await first.pagehide()
    const second = run("https://veridian-aios.com/dpdp-firm/", { cookie: first.jar[0], local: first.local, session: first.session, referrer: "https://veridian-aios.com/" })
    await second.pagehide()
    expect(first.beacons[0]!.body.r).toBe("www.linkedin.com")
    expect(second.beacons[0]!.body.r).toBeUndefined(); expect(second.beacons[0]!.body.u).toBeUndefined()
    expect(second.beacons[0]!.body.sid).toBe(first.beacons[0]!.body.sid)
  })

  test("its only destination is this site's own /api/visit, through one sendBeacon call; no fetch, no XMLHttpRequest, no third party", () => {
    expect((source.match(/sendBeacon\(/g) ?? []).length).toBe(1)
    expect(source).toContain('"/api/visit"')
    expect(source).not.toMatch(/https?:\/\//)
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|new Image/)
  })
})

describe("public/visit.js: the visitor id", () => {
  test("a random id is kept in a one-year first-party cookie (shared across our subdomains) and in local storage; the same id comes back on the next page", async () => {
    const r = run("https://veridian-aios.com/")
    await r.settle()
    const vid = r.beacons.length ? r.beacons[0]!.body.vid : null
    await r.pagehide()
    const id = r.beacons[0]!.body.vid
    expect(id).toMatch(/^[a-f0-9]{24}$/)
    expect(r.local.dpdp_vid).toBe(id)
    const set = r.cookies.find((c) => c.startsWith("dpdp_vid="))!
    expect(set).toContain(`dpdp_vid=${id}`); expect(set).toContain("Max-Age=31536000"); expect(set).toContain("SameSite=Lax"); expect(set).toContain("Domain=veridian-aios.com"); expect(set).toContain("Secure")
    void vid
    const again = run("https://dpdp.veridian-aios.com/partner/", { cookie: `dpdp_vid=${id}` })
    await again.pagehide()
    expect(again.beacons[0]!.body.vid).toBe(id)
  })
  test("a rubbish id in the cookie is replaced, never sent", async () => {
    const r = run("https://veridian-aios.com/", { cookie: "dpdp_vid=priya@acme.in" })
    await r.pagehide()
    expect(r.beacons[0]!.body.vid).toMatch(/^[a-f0-9]{24}$/)
    expect(JSON.stringify(r.beacons)).not.toContain("priya")
  })
})

describe("public/visit.js: what it reports", () => {
  test("page view, sections seen with dwell time, links, choices, scroll depth and the exit, in one beacon when the page is left", async () => {
    const how = makeSection("how", null), hero = makeSection(null, "Your DPDP jobs, owned")
    const r = run("https://veridian-aios.com/", { sections: [hero, how], referrer: "https://www.google.com/" })
    r.enter(hero); r.tick(3000); r.leave(hero)
    r.enter(how); r.tick(9000)
    r.scrollTo(1800)
    click(r, link("/dpdp-firm/?utm=x#top"))
    click(r, link("mailto:dpdp@veridian-aios.com"))
    click(r, link("https://www.linkedin.com/company/x?trk=1"))
    click(r, { tagName: "BUTTON", id: "", getAttribute: () => null, closest: function () { return this } })
    r.fireDoc("change", { target: { tagName: "SELECT", name: "Edition", value: "CA-Firm", getAttribute: () => null } })
    r.fireDoc("change", { target: { tagName: "INPUT", type: "radio", name: "plan", value: "yearly", checked: true, getAttribute: () => null } })
    r.fireDoc("change", { target: { tagName: "INPUT", type: "checkbox", name: "gst", value: "", checked: true, getAttribute: () => null } })
    await r.pagehide()
    expect(r.beacons.length).toBe(1)
    const e = (await r.events()) as Array<Record<string, any>>
    expect(e.find((x) => x.k === "pv")).toMatchObject({ p: "/" })
    expect(e.filter((x) => x.k === "sec")).toEqual([{ k: "sec", p: "/", n: "your-dpdp-jobs-owned", ms: 3000 }, { k: "sec", p: "/", n: "how", ms: 9000 }])
    expect(e.filter((x) => x.k === "cta").map((x) => x.n)).toEqual(["/dpdp-firm/", "mailto", "ext:www.linkedin.com"])
    expect(e.filter((x) => x.k === "choice")).toEqual([{ k: "choice", p: "/", n: "edition", v: "ca-firm" }, { k: "choice", p: "/", n: "plan", v: "yearly" }, { k: "choice", p: "/", n: "gst", v: "on" }])
    expect(e.find((x) => x.k === "exit")).toMatchObject({ p: "/", n: "how", ms: 12000, sc: 82 })
  })

  test("a section seen for under a second is not reported; time in a section still on screen at exit is counted", async () => {
    const a = makeSection("a", null), b = makeSection("b", null)
    const r = run("https://veridian-aios.com/", { sections: [a, b] })
    r.enter(a); r.tick(500); r.leave(a)
    r.enter(b); r.tick(2500)
    await r.pagehide()
    expect((await r.events()).filter((x) => x.k === "sec")).toEqual([{ k: "sec", p: "/", n: "b", ms: 2500 }])
  })

  test("leaving once sends one exit: hiding the tab and then the pagehide that follows do not send it twice", async () => {
    const r = run("https://veridian-aios.com/")
    await r.hide(); await r.pagehide()
    expect((await r.events()).filter((x) => x.k === "exit").length).toBe(1)
  })

  test("coming back to the tab and leaving again sends a second exit with the longer visible time (hidden time is not counted)", async () => {
    const r = run("https://veridian-aios.com/")
    r.tick(5000); await r.hide()
    r.tick(60000); r.show()
    r.tick(2000); await r.hide()
    const exits = (await r.events()).filter((x) => x.k === "exit")
    expect(exits.map((x) => x.ms)).toEqual([5000, 7000])
  })
  test("the device bucket follows the window width", async () => {
    for (const [w, d] of [[390, "mobile"], [900, "tablet"], [1440, "desktop"]] as const) {
      const r = run("https://veridian-aios.com/", { width: w })
      await r.pagehide()
      expect(r.beacons[0]!.body.d).toBe(d)
    }
  })

  test("more than 20 events are split across requests, each within the server's limit", async () => {
    const r = run("https://veridian-aios.com/")
    for (let i = 0; i < 14; i++) click(r, link(`/p${i}/`)) // flushes at 15 queued (pv + 14)
    for (let i = 0; i < 30; i++) click(r, link(`/q${i}/`))
    await r.pagehide()
    for (const b of r.beacons) expect((b.body.e ?? []).length).toBeLessThanOrEqual(20)
    expect(r.beacons.length).toBeGreaterThan(1)
  })
})
