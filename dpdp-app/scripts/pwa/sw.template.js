/* VERIDIAN DPDP app: the offline service worker for /app/ (template; scripts/pwa/build-pwa.mjs fills in the two placeholders after the build).
 *
 * What it keeps on the device: ONLY the app's own code, styles and fonts (the list below, all content-hashed files) and the /app/ page itself.
 * It never stores a response from the server's data API, an /ai/ link, or anything else: the person's own jobs live in the page's IndexedDB
 * copy (src/lib/device-copy), which is wiped on sign-out. So a shared laptop leaks nothing through this cache.
 *
 * Why: the person's machine does the work. After the first visit the whole app opens from the device with no network and no server, and
 * the only requests left are the data calls themselves.
 */
const VERSION = "__VERSION__"
const FILES = __PRECACHE__
const CACHE = "dpdp-app-" + VERSION
const SHELL = "/app/"

async function broadcast(msg) {
  const all = await self.clients.matchAll({ includeUncontrolled: true })
  for (const c of all) c.postMessage(msg)
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    const total = FILES.length + 1
    let done = 0
    const one = async (url) => {
      const res = await fetch(url, { cache: "reload", credentials: "omit" })
      if (!res.ok) throw new Error("precache " + url + " " + res.status)
      await cache.put(url, res)
      done++
      await broadcast({ type: "dpdp-copy-progress", version: VERSION, done, total })
    }
    await one(SHELL)
    // Four at a time: fast on a good line, gentle on a weak one.
    const queue = FILES.slice()
    await Promise.all(Array.from({ length: 4 }, async () => { for (let u = queue.shift(); u; u = queue.shift()) await one(u) }))
    await broadcast({ type: "dpdp-copy-ready", version: VERSION })
  })())
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("dpdp-app-") && k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "dpdp-copy-status" && event.ports[0]) {
    caches.open(CACHE).then((c) => c.match(SHELL)).then((hit) => event.ports[0].postMessage({ ready: !!hit, version: VERSION }))
  }
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // the data API and everything else: straight to the network, never stored
  const p = url.pathname
  if (req.mode === "navigate" && (p === "/app/" || p === "/app")) {
    // The page: the network if it answers quickly (so a new release arrives), the device copy if not.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 3500)
        const res = await fetch(req, { signal: ctl.signal })
        clearTimeout(timer)
        if (res.ok) { cache.put(SHELL, res.clone()).catch(() => {}); return res }
      } catch (_) { /* offline or slow: fall through */ }
      return (await cache.match(SHELL)) || Response.error()
    })())
    return
  }
  if (p.startsWith("/assets/") || p.startsWith("/fonts/") || p === "/app/manifest.webmanifest" || p.startsWith("/app/icon-")) {
    // Hashed files never change under one name, so the device copy is always right.
    event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)))
  }
})
