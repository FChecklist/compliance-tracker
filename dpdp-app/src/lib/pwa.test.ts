/// <reference types="bun-types" />
/* eslint-disable @typescript-eslint/no-explicit-any -- the fake browser is deliberately loose */
// 2026-10-18: the public site is an installable app (family web-quality check C04). This runs the REAL public/pwa.js and the REAL public/sw.js against fakes and pins:
//   * pwa.js registers /sw.js with scope "/" only when the browser has service workers, never on a private prefix, and touches no network, cookie or storage;
//   * sw.js keeps exactly one file (/offline.html), answers a failed PUBLIC page navigation with it, and does not intercept a private prefix, an API call, a non-GET,
//     a non-navigation or another site at all (no respondWith);
//   * the manifest names the app, links real 192 and 512 icons, and every public, hidden and legal page links it while no private page does;
//   * the _headers model still gives every private prefix its own headers, and the new files get theirs.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  COMPANY_FOOTER_COPY,
  HIDDEN_PAGES,
  HOME_SCRIPT_OPENS,
  LEGAL_PAGES,
  LEGAL_SCRIPT_OPENS,
  PRIVATE_PAGES,
  PUBLIC_PAGES,
  PUBLIC_SCRIPT_OPENS,
  PWA,
  PWA_SCRIPT,
  SITEMAP_PAGES,
  parseHeadersFile,
  resolveHeaders,
} from "./public-surface.mjs"

const root = join(import.meta.dir, "..", "..")
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const pwaSource = read("public/pwa.js")
const swSource = read("public/sw.js")

// ------------------------------------------------------------------ pwa.js
function runPwa(href: string, opts: { sw?: boolean; readyState?: string; registerFails?: boolean } = {}) {
  const url = new URL(href)
  const registered: Array<{ url: string; options: any }> = []
  const listeners: Record<string, Array<() => void>> = {}
  const touched: string[] = []
  const trap = (name: string) => () => {
    touched.push(name)
    throw new Error(`pwa.js must not use ${name}`)
  }
  const navigator: Record<string, any> = {}
  if (opts.sw !== false) {
    navigator.serviceWorker = {
      register: (u: string, options: any) => {
        registered.push({ url: u, options })
        return opts.registerFails ? Promise.reject(new Error("blocked")) : Promise.resolve({})
      },
    }
  }
  const document: Record<string, any> = { readyState: opts.readyState ?? "loading" }
  Object.defineProperty(document, "cookie", { get: trap("document.cookie"), set: trap("document.cookie") })
  const window = { addEventListener: (t: string, cb: () => void) => (listeners[t] ||= []).push(cb) }
  const fn = new Function("navigator", "document", "window", "location", "fetch", "localStorage", "sessionStorage", "indexedDB", "XMLHttpRequest", pwaSource)
  fn(navigator, document, window, { pathname: url.pathname }, trap("fetch"), trap("localStorage"), trap("sessionStorage"), trap("indexedDB"), trap("XMLHttpRequest"))
  return { registered, listeners, touched }
}

describe("public/pwa.js (the registration script)", () => {
  test("registers /sw.js with scope / when the page has finished loading", () => {
    const r = runPwa("https://veridian-aios.com/", { readyState: "complete" })
    expect(r.registered).toEqual([{ url: "/sw.js", options: { scope: "/" } }])
    expect(r.touched).toEqual([])
  })

  test("waits for the load event while the page is still loading, then registers once", () => {
    const r = runPwa("https://veridian-aios.com/dpdp-firm/")
    expect(r.registered).toEqual([])
    expect(r.listeners.load?.length).toBe(1)
    r.listeners.load![0]!()
    expect(r.registered).toEqual([{ url: "/sw.js", options: { scope: "/" } }])
  })

  test("does nothing when the browser has no service-worker support", () => {
    const r = runPwa("https://veridian-aios.com/", { sw: false, readyState: "complete" })
    expect(r.registered).toEqual([])
    expect(r.listeners.load).toBeUndefined()
  })

  test("does nothing on any private prefix (with or without the trailing slash, and below it)", () => {
    for (const priv of PRIVATE_PAGES) {
      for (const path of [priv.prefix, priv.prefix.slice(0, -1), `${priv.prefix}something/deep`]) {
        const r = runPwa(`https://veridian-aios.com${path}`, { readyState: "complete" })
        expect(r.registered, path).toEqual([])
        expect(r.listeners.load, path).toBeUndefined()
      }
    }
  })

  test("a refused registration never throws into the page", () => {
    expect(() => runPwa("https://veridian-aios.com/", { readyState: "complete", registerFails: true })).not.toThrow()
  })

  test("no network call, cookie or browser storage anywhere in the file; no absolute address", () => {
    for (const bad of ["fetch(", "XMLHttpRequest", "sendBeacon", "document.cookie", "localStorage", "sessionStorage", "indexedDB", "http://", "https://"]) {
      expect(pwaSource.includes(bad), bad).toBe(false)
    }
  })
})

// ------------------------------------------------------------------- sw.js
function loadSw() {
  const handlers: Record<string, (e: any) => void> = {}
  const cacheStore = new Map<string, Map<string, string>>()
  const added: string[] = []
  let claimed = false
  let skipped = false
  const caches = {
    open: async (name: string) => {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map())
      return { add: async (path: string) => { added.push(path); cacheStore.get(name)!.set(path, `cached:${path}`) } }
    },
    keys: async () => [...cacheStore.keys()],
    delete: async (name: string) => cacheStore.delete(name),
    match: async (req: string) => {
      for (const c of cacheStore.values()) if (c.has(req)) return c.get(req)
      return undefined
    },
  }
  const net: { fail: boolean; calls: string[] } = { fail: false, calls: [] }
  const fetchFn = async (req: any) => {
    net.calls.push(req.url)
    if (net.fail) throw new TypeError("offline")
    return `network:${new URL(req.url).pathname}`
  }
  const self = {
    location: { origin: "https://veridian-aios.com" },
    addEventListener: (t: string, cb: (e: any) => void) => { handlers[t] = cb },
    skipWaiting: () => { skipped = true },
    clients: { claim: () => { claimed = true } },
  }
  const ResponseFake = { error: () => "error-response" }
  new Function("self", "caches", "fetch", "Response", swSource)(self, caches, fetchFn, ResponseFake)
  const fire = async (type: string, extra: Record<string, any> = {}) => {
    let waited: Promise<unknown> = Promise.resolve()
    let responded: Promise<unknown> | undefined
    handlers[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => { waited = p }, respondWith: (p: Promise<unknown>) => { responded = p } })
    await waited
    return { responded: responded === undefined ? undefined : await responded, intercepted: responded !== undefined }
  }
  const navigate = (url: string, extra: Record<string, any> = {}) => fire("fetch", { request: { url, method: "GET", mode: "navigate", ...extra } })
  return { fire, navigate, cacheStore, added, net, state: () => ({ claimed, skipped }) }
}

describe("public/sw.js (the worker for /)", () => {
  test("install keeps exactly one file, /offline.html, and takes over at once", async () => {
    const sw = loadSw()
    await sw.fire("install")
    expect(sw.added).toEqual(["/offline.html"])
    expect([...sw.cacheStore.keys()]).toEqual(["dpdp-public-v1"])
    expect(sw.state().skipped).toBe(true)
  })

  test("activate removes only older public caches and claims the open pages", async () => {
    const sw = loadSw()
    await sw.fire("install")
    sw.cacheStore.set("dpdp-public-v0", new Map())
    sw.cacheStore.set("dpdp-app-abc123", new Map()) // the signed-in app's own cache: not ours to touch
    await sw.fire("activate")
    expect([...sw.cacheStore.keys()].sort()).toEqual(["dpdp-app-abc123", "dpdp-public-v1"])
    expect(sw.state().claimed).toBe(true)
  })

  test("a public page opens from the network when online", async () => {
    const sw = loadSw()
    await sw.fire("install")
    const r = await sw.navigate("https://veridian-aios.com/dpdp-firm/")
    expect(r.intercepted).toBe(true)
    expect(r.responded).toBe("network:/dpdp-firm/")
  })

  test("a public page that cannot load shows the offline page, for the home page, a landing and a legal page", async () => {
    const sw = loadSw()
    await sw.fire("install")
    sw.net.fail = true
    for (const path of ["/", "/dpdp-firm/", "/privacy/", "/no-such-page/"]) {
      const r = await sw.navigate(`https://veridian-aios.com${path}`)
      expect(r.responded, path).toBe("cached:/offline.html")
    }
  })

  test("without the cached offline page a failed navigation is an ordinary network error, not a crash", async () => {
    const sw = loadSw()
    sw.net.fail = true
    const r = await sw.navigate("https://veridian-aios.com/")
    expect(r.responded).toBe("error-response")
  })

  test("a private prefix is NOT intercepted at all: no respondWith, no network call made by the worker, nothing cached", async () => {
    const sw = loadSw()
    await sw.fire("install")
    sw.net.fail = true
    for (const priv of PRIVATE_PAGES) {
      for (const path of [priv.prefix, priv.prefix.slice(0, -1), `${priv.prefix}x/y?token=1`]) {
        const r = await sw.navigate(`https://veridian-aios.com${path}`)
        expect(r.intercepted, path).toBe(false)
      }
    }
    expect(sw.net.calls).toEqual([])
    expect(sw.added).toEqual(["/offline.html"])
  })

  test("a non-GET, a non-navigation (script, image, API call) and another site are left alone", async () => {
    const sw = loadSw()
    await sw.fire("install")
    expect((await sw.navigate("https://veridian-aios.com/", { method: "POST" })).intercepted).toBe(false)
    expect((await sw.navigate("https://veridian-aios.com/rum.js", { mode: "no-cors" })).intercepted).toBe(false)
    expect((await sw.navigate("https://veridian-aios.com/api/telemetry", { mode: "cors" })).intercepted).toBe(false)
    expect((await sw.navigate("https://example.com/")).intercepted).toBe(false)
  })

  test("the source names every private prefix, stores nothing but the offline page, and has no storage, cookie or absolute address", () => {
    for (const priv of PRIVATE_PAGES) expect(swSource.includes(`"${priv.prefix}"`), priv.prefix).toBe(true)
    expect((swSource.match(/cache\.add\(/g) ?? []).length).toBe(1)
    for (const bad of ["addAll(", ".put(", "indexedDB", "localStorage", "document.cookie", "XMLHttpRequest", "sendBeacon", "http://", "https://"]) expect(swSource.includes(bad), bad).toBe(false)
  })
})

// ---------------------------------------------------- manifest and offline page
describe("public/manifest.webmanifest", () => {
  const man = JSON.parse(read("public/manifest.webmanifest"))

  test("names the app and starts at the home page, scope /", () => {
    expect(man.name).toBe("VERIDIAN DPDP")
    expect(man.short_name).toBe("VERIDIAN")
    expect([man.id, man.start_url, man.scope]).toEqual(["/", "/", "/"])
    expect(man.display).toBe("standalone")
    expect(man.theme_color).toBe(PWA.themeColor)
    expect(man.lang).toBe("en-IN")
    expect(man.background_color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  test("links 192 and 512 icons (any and maskable) that are real PNGs of that size", () => {
    for (const size of [192, 512]) {
      for (const purpose of ["any", "maskable"]) {
        const icon = man.icons.find((i: any) => i.sizes === `${size}x${size}` && i.purpose === purpose)
        expect(icon, `${size} ${purpose}`).toBeDefined()
        const png = readFileSync(join(root, "public", icon.src.replace(/^\//, "")))
        expect(png.subarray(1, 4).toString("latin1")).toBe("PNG")
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
      }
    }
  })
})

describe("public/offline.html", () => {
  const html = read("public/offline.html")

  test("noindex, no canonical, no script, no stylesheet file (it must work with no network), a plain way back", () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).not.toMatch(/rel="canonical"|<script|rel="stylesheet"/i)
    expect(html).toContain("<style>")
    expect(html).toContain('<a class="btn" href="/">Try again</a>')
  })

  test("is not in the sitemap or llms files, and carries the seller line as the last thing in its footer", () => {
    for (const f of ["public/llms.txt", "public/llms-full.txt", "public/robots.txt"]) expect(read(f), f).not.toContain("offline")
    expect(SITEMAP_PAGES.some((p) => p.path.includes("offline"))).toBe(false)
    const footer = /<footer\b[\s\S]*?<\/footer>/.exec(html)![0]
    for (const part of COMPANY_FOOTER_COPY) expect(footer).toContain(part)
    const lines = footer.split("\n").map((l) => l.trim()).filter(Boolean)
    expect(lines[lines.length - 1]).toBe("</footer>")
    expect(lines[lines.length - 2]).toContain("owned and operated by")
  })

  test("says nothing internal or unfinished", () => {
    expect(html).not.toMatch(/pending|draft|TODO|lorem|work order|WO-/i)
  })
})

// ------------------------------------------------ the pages link it, private pages do not
describe("every public, hidden and legal page is installable; no private page is", () => {
  const manifestTags = ['<link rel="manifest" href="/manifest.webmanifest" />', '<link rel="manifest" href="/manifest.webmanifest">']
  const themeTags = [`<meta name="theme-color" content="${PWA.themeColor}" />`, `<meta name="theme-color" content="${PWA.themeColor}">`]

  test("the manifest link and the theme colour are in the <head> of the public and hidden pages and of the eight legal pages", () => {
    for (const p of [...PUBLIC_PAGES, ...HIDDEN_PAGES, ...LEGAL_PAGES]) {
      const html = read(p.source)
      const head = /<head>[\s\S]*<\/head>/.exec(html)![0]
      expect(manifestTags.filter((t) => head.includes(t)).length, `${p.source} manifest`).toBe(1)
      expect(themeTags.filter((t) => head.includes(t)).length, `${p.source} theme-color`).toBe(1)
    }
  })

  test("the script lists: public pages ref, rum, visit, pwa; the home page adds theme first; legal pages rum, visit, pwa", () => {
    expect(PUBLIC_SCRIPT_OPENS.at(-1)).toBe(PWA_SCRIPT.open)
    expect(HOME_SCRIPT_OPENS.at(-1)).toBe(PWA_SCRIPT.open)
    expect(LEGAL_SCRIPT_OPENS).toEqual(['<script defer src="/rum.js">', '<script defer src="/visit.js">', PWA_SCRIPT.open])
    for (const p of [...PUBLIC_PAGES, ...HIDDEN_PAGES]) expect(read(p.source), p.source).toContain(`${PWA_SCRIPT.tag}\n`)
    for (const p of LEGAL_PAGES) expect(read(p.source), p.source).toContain(`${PWA_SCRIPT.tag}\n`)
  })

  test("no private page loads pwa.js or links the public manifest", () => {
    for (const priv of PRIVATE_PAGES) {
      if (!priv.source) continue
      const html = read(priv.source)
      expect(html, priv.source).not.toContain("/pwa.js")
      expect(html, priv.source).not.toContain('href="/manifest.webmanifest"')
    }
  })

  test("the hand-kept 404 page stays script-free", () => {
    expect(read("public/404.html")).not.toMatch(/<script/i)
  })
})

// ---------------------------------------------------------------- _headers model
describe("public/_headers: the installable-app files, with the private model intact", () => {
  const rules = parseHeadersFile(read("public/_headers"))

  test("/sw.js is revalidated on every load; the manifest is cached an hour and typed; the offline page is noindex", () => {
    expect(resolveHeaders(rules, "/sw.js")["cache-control"]).toBe("no-cache")
    expect(resolveHeaders(rules, "/manifest.webmanifest")["cache-control"]).toBe("public, max-age=3600")
    expect(resolveHeaders(rules, "/manifest.webmanifest")["content-type"]).toBe("application/manifest+json")
    expect(resolveHeaders(rules, "/offline.html")["x-robots-tag"]).toBe("noindex, nofollow")
  })

  test("the new files still get the site-wide security headers, and none of them sits under a private prefix", () => {
    for (const path of ["/sw.js", "/manifest.webmanifest", "/pwa.js", "/offline.html"]) {
      const h = resolveHeaders(rules, path)
      expect(h["x-content-type-options"], path).toBe("nosniff")
      expect(h["x-frame-options"], path).toBe("DENY")
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin")
      expect(PRIVATE_PAGES.some((p) => path.startsWith(p.prefix)), path).toBe(false)
    }
  })

  test("every private prefix keeps exactly its own headers: noindex, no-referrer, no-store (nothing from the new rules leaks in)", () => {
    for (const priv of PRIVATE_PAGES) {
      for (const path of [priv.prefix, `${priv.prefix}index.html`, `${priv.prefix}sw.js`, `${priv.prefix}manifest.webmanifest`]) {
        const h = resolveHeaders(rules, path)
        expect(h["x-robots-tag"], path).toBe("noindex, nofollow")
        expect(h["referrer-policy"], path).toBe("no-referrer")
        expect(h["cache-control"], path).toBe("no-store")
      }
    }
  })

  test("public pages still carry no Cache-Control and no X-Robots-Tag", () => {
    for (const p of SITEMAP_PAGES) {
      const h = resolveHeaders(rules, p.path)
      expect(h["cache-control"], p.path).toBeUndefined()
      expect(h["x-robots-tag"], p.path).toBeUndefined()
    }
  })
})
