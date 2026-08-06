// OCID-038 GAP-NO-SERVICE-WORKER-OFFLINE-BLANK-PAGE, real fix
// (UMR-20260803-072940-6a88, real implementation authorized
// UMR-20260804-105822-a267): a real, installable PWA manifest
// (src/app/manifest.ts) already existed with no service worker behind it --
// going offline rendered a fully blank white page (real, directly observed
// finding). This is deliberately a MINIMAL app-shell service worker, not a
// full offline-first cache: this app is almost entirely dynamic/
// authenticated (tenant-scoped data, real-time task state), so caching API
// responses or authenticated pages would risk serving stale/wrong data --
// the real, narrow goal here is only "never show a blank page," not "work
// fully offline."
const CACHE_NAME = "veridian-app-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL, "/logo-mark.svg"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Network-first for navigations only (real page loads, not API/asset
// requests) -- on a genuine network failure, serve the cached offline
// fallback instead of letting the browser render its own blank error page.
// Every other request type (API calls, static assets, data fetches) passes
// straight through to the network, untouched -- this service worker never
// intercepts or caches app data.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL))
  );
});
