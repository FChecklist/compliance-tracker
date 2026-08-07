// VERIDIAN AI -- minimal, READ-ONLY offline shell service worker.
//
// Gap closure, 2026-08-07 (VERIDIAN Review Framework, Cache & Synchronization
// / "Offline Cache Support", Critical finding -- "No offline support
// anywhere in the app"). Confirmed by grep before writing this file: zero
// existing serviceWorker.register call, zero workbox/next-pwa/serwist
// dependency, zero public/sw.js -- this really was a greenfield gap, not
// partially-built scaffolding to extend.
//
// The finding's own recommended approach is "start with a read-only
// offline shell for FM/site-diary screens" -- this is deliberately that
// start, not a full offline-first rewrite:
//   - READ-ONLY. This worker never intercepts a non-GET request (see the
//     `if (request.method !== "GET") return;` guard below) -- a write made
//     while offline just fails normally, exactly like today, with no
//     background-sync queue. Queuing/replaying offline writes safely
//     (conflict resolution, at-least-once vs exactly-once delivery,
//     multi-tenant RLS re-validation on replay) is a materially larger
//     project than this wave's scope; scoping down to read-only here rather
//     than half-building write-sync is the honest cut.
//   - Two allowlisted route families only: the FM register-digitization
//     rows GET (src/app/api/fm/register-digitization/[batchId]/rows/route.ts)
//     and the construction site-diary list GETs (both the direct route and
//     its /api/v1 and /api/v1/projexa aliases) -- the two concrete surfaces
//     this gap-closure wave's spec named. Every other API GET is left alone
//     (default network behavior, not force-cached) -- widening this
//     allowlist to a new read-only screen later is a one-line addition, not
//     a redesign.
//   - Every cached API response is re-built with ONLY its JSON body kept --
//     see cacheBodyOnly() below for why: requireAuth()'s Supabase server
//     client refreshes the session cookie on essentially any authenticated
//     request (src/lib/supabase/server.ts's `setAll` callback), so a raw
//     `Response` clone can carry a real Set-Cookie header. Caching that
//     verbatim and replaying it on a later request -- possibly to a
//     different signed-in user on a shared/kiosk browser -- would leak a
//     session. Stripping every header down to a plain, inert
//     application/json response before it ever reaches the Cache Storage
//     API removes that risk entirely, at the cost of not caching
//     Cache-Control/ETag metadata this app doesn't rely on anyway.
//   - Full authenticated PAGE navigations (the actual server-rendered HTML)
//     are deliberately NEVER cached, for the same Set-Cookie reason plus
//     the fact that VERIDIAN's authenticated pages are personalized SSR,
//     not static HTML -- caching one org/user's rendered page and serving
//     it to another would be a much worse leak than a JSON list endpoint.
//     A navigation that fails offline and isn't already showing a live
//     client-rendered app (i.e. a fresh/never-visited tab) instead gets the
//     static, no-personalization public/offline.html fallback below.
//   - Static build assets (_next/static/*, the logo SVGs, fonts) ARE
//     cached, cache-first -- they're immutable/content-hashed and carry no
//     per-user data, so caching them is unconditionally safe and makes a
//     flaky-network reload of an already-open tab noticeably more
//     resilient even outside a fully offline scenario.
//
// Browser-cache-at-rest encryption is deliberately NOT part of this file:
// the same finding's own recommended approach is "risk-accept browser
// cache; evaluate KMS encryption for llm_response_cache" -- i.e. the
// server-side llm_response_cache table (see src/lib/llm-response-cache.ts,
// closed in this same PR) is where real encryption effort belongs, and the
// browser cache layer's risk is explicitly pre-accepted rather than a gap
// this file needs to close too.
//
// No test file: this repo has an established, existing precedent of
// leaving a plain browser-side public/*.js script untested (e.g.
// public/office-addin/taskpane.js has no companion test), and Bun's test
// runner has no `self`/`caches`/ServiceWorkerGlobalScope shim to run this
// kind of file against anyway.

const CACHE_VERSION = "veridian-offline-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const OFFLINE_DATA_ROUTE_PREFIXES = [
  "/api/fm/register-digitization/",
  "/api/construction/site-diary",
  "/api/v1/construction/site-diary",
  "/api/v1/projexa/site-diary",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || /\.(?:svg|png|ico|woff2?|css)$/.test(url.pathname);
}

function isOfflineDataRoute(url) {
  return OFFLINE_DATA_ROUTE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

/** See this file's header for why only the JSON body -- never the original headers -- is kept. */
async function cacheBodyOnly(cache, request, response) {
  const body = await response.clone().text();
  const sanitized = new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  await cache.put(request, sanitized);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept a mutation -- read-only shell

  const url = new URL(request.url);

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  if (isOfflineDataRoute(url)) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (response.ok) await cacheBodyOnly(cache, request, response);
          return response;
        } catch (err) {
          const cached = await cache.match(request);
          if (cached) return cached;
          throw err;
        }
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html").then((cached) => cached || Response.error())));
  }
  // Everything else (every other API route, every non-GET, every
  // non-allowlisted read) is left to default browser/network behavior --
  // this worker only ever narrows what it touches, never widens silently.
});
