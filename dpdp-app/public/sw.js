/* VERIDIAN DPDP public site: the service worker for "/" (scope "/").
 *
 * It does exactly two things. (1) At install it keeps ONE file on the device: /offline.html. (2) When a person opens a PUBLIC page and the
 * network is down, it shows that file instead of the browser's own error. Nothing else is stored: no page, no script, no API answer, no data.
 *
 * It never touches a private prefix. A request to /app/ /act/ /p/ /copy/ /unsubscribe/ /ai/ or /api/ is not intercepted at all -- no
 * respondWith, no cache read, no cache write -- so the signed-in app (which has its own worker, /app/sw.js, scope /app/), the one-click token pages and
 * the AI link behave exactly as if this file did not exist.
 */
const CACHE = "dpdp-public-v1"
const OFFLINE = "/offline.html"
const PRIVATE = ["/app/", "/act/", "/p/", "/copy/", "/unsubscribe/", "/ai/", "/api/"]

const isPrivate = (path) => PRIVATE.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix))

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("dpdp-public-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET" || req.mode !== "navigate") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (isPrivate(url.pathname)) return
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((hit) => hit || Response.error())))
})
