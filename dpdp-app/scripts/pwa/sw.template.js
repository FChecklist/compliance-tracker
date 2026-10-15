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

// ---- Reminders, made on this device from the person's own copy (nothing is sent to us) ---------------------------------------------------------
// The rule below is src/lib/device-copy/reminders.mjs, pasted in by build-pwa.mjs so the page, the tests and this worker share ONE rule.
__REMINDERS__

const IDB_NAME = "veridian-dpdp-copy"
const IDB_STORE = "kv"
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1)
    r.onupgradeneeded = () => { r.result.createObjectStore(IDB_STORE) }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
function idbOp(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode)
    const req = fn(tx.objectStore(IDB_STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function canNotify() {
  if (typeof Notification === "undefined") return false
  try { return (await navigator.permissions.query({ name: "notifications" })).state === "granted" } catch (_) { return Notification.permission === "granted" }
}

/** For every person who turned reminders on, on THIS device: read their own copy, decide, show at most one notification a day. Returns how many were shown, 0 for "nothing due", -1 when the browser refused to show one. */
async function checkDue(force) {
  if (!(await canNotify())) return 0
  if (!force) {
    // Someone is looking at the app right now: the page itself already shows the jobs, so a notification would only be noise.
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    if (all.some((c) => c.visibilityState === "visible")) return 0
  }
  const db = await idb()
  try {
    const keys = (await idbOp(db, "readonly", (s) => s.getAllKeys())).map(String)
    let shown = 0
    let refused = 0
    for (const k of keys) {
      if (!k.startsWith("remind:") || !k.endsWith("|on")) continue
      if ((await idbOp(db, "readonly", (s) => s.get(k))) !== true) continue
      const email = k.slice("remind:".length, -"|on".length)
      const snapKey = keys.find((x) => x.startsWith("snapshot:" + email + "|"))
      if (!snapKey) continue
      const snap = await idbOp(db, "readonly", (s) => s.get(snapKey))
      const lastKey = "remind:" + email + "|last"
      const lastDay = await idbOp(db, "readonly", (s) => s.get(lastKey))
      const d = decideReminder({ page: snap && snap.page, email, now: new Date(), lastDay, force })
      if (!d.show) continue
      try {
        await self.registration.showNotification(d.title, { body: d.body, tag: "dpdp-due", icon: "/app/icon-192.png", badge: "/app/icon-192.png", renotify: false })
      } catch (_) { refused++; continue } // the browser would not show it: say so, and do not count today as reminded
      if (!force) await idbOp(db, "readwrite", (s) => s.put(d.day, lastKey))
      shown++
    }
    return shown > 0 ? shown : refused > 0 ? -1 : 0
  } finally { db.close() }
}

// Chrome/Edge installed apps wake the worker now and then (the browser decides when) -- no server involved.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "dpdp-due-check") event.waitUntil(checkDue(false).catch(() => {}))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const open = all.find((c) => new URL(c.url).pathname.startsWith("/app"))
    if (open) return open.focus()
    return self.clients.openWindow(SHELL)
  })())
})

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
  if (event.data && event.data.type === "dpdp-check-due") {
    const p = checkDue(!!event.data.force).then((n) => { if (event.ports[0]) event.ports[0].postMessage({ shown: n }) }).catch(() => { if (event.ports[0]) event.ports[0].postMessage({ shown: 0 }) })
    event.waitUntil(p)
    return
  }
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
