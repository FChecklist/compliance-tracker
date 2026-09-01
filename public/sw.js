// VERIDIAN AI -- app-shell + read-only offline service worker.
//
// This file is the real merge of two independent gap-closures that both
// landed on `public/sw.js` at the same time (a genuine add/add rebase
// conflict, not a design choice): OCID-038 GAP-NO-SERVICE-WORKER-OFFLINE-
// BLANK-PAGE (PR #889/#1531, merged to main 2026-09-01) and the VERIDIAN
// Review Framework's "Cache & Synchronization / Offline Cache Support"
// Critical finding (PR #1019, this file's other half). Both real fixes are
// kept, combined rather than either one dropped:
//   - OCID-038's contribution: pre-caching `/offline.html` + the app's logo
//     mark on `install`, so the offline fallback page is guaranteed
//     available even on a tab's very first load (before anything else has
//     been cached) -- this is what actually closes "going offline renders a
//     fully blank white page."
//   - PR #1019's contribution: cache-first static assets, allowlisted
//     read-only GET API caching (FM register-digitization rows + site-diary
//     GET aliases) with every cached response stripped down to JSON-body-
//     only (see cacheBodyOnly() below), and the navigate-fallback-to-
//     offline.html behavior itself.
//
// Combined scope (unchanged from PR #1019's original design, still
// deliberately READ-ONLY -- see the non-GET guard below):
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
//     A navigation that fails offline instead gets the static, no-
//     personalization public/offline.html fallback below (now pre-cached
//     on install, per OCID-038, so this works even on a first-ever visit).
//   - Static build assets (_next/static/*, the logo SVGs, fonts) ARE
//     cached, cache-first -- they're immutable/content-hashed and carry no
//     per-user data, so caching them is unconditionally safe and makes a
//     flaky-network reload of an already-open tab noticeably more
//     resilient even outside a fully offline scenario.
//
// Browser-cache-at-rest encryption is deliberately NOT part of this file:
// the Cache & Synchronization finding's own recommended approach is
// "risk-accept browser cache; evaluate KMS encryption for
// llm_response_cache" -- i.e. the server-side llm_response_cache table (see
// src/lib/llm-response-cache.ts) is where real encryption effort belongs,
// and the browser cache layer's risk is explicitly pre-accepted rather than
// a gap this file needs to close too.
//
// No test file: this repo has an established, existing precedent of
// leaving a plain browser-side public/*.js script untested (e.g.
// public/office-addin/taskpane.js has no companion test), and Bun's test
// runner has no `self`/`caches`/ServiceWorkerGlobalScope shim to run this
// kind of file against anyway.

const CACHE_VERSION = "veridian-offline-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const OFFLINE_URL = "/offline.html";

const OFFLINE_DATA_ROUTE_PREFIXES = [
  "/api/fm/register-digitization/",
  "/api/construction/site-diary",
  "/api/v1/construction/site-diary",
  "/api/v1/projexa/site-diary",
];

self.addEventListener("install", (event) => {
  // Pre-cache the offline fallback + logo so a navigation-fallback is
  // guaranteed available even before anything else has ever been cached
  // (OCID-038's real fix for "offline renders a fully blank white page").
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/logo-mark.svg"]))
  );
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
    // Network-first for real page loads -- on a genuine network failure,
    // serve the pre-cached offline fallback instead of letting the browser
    // render its own blank error page (OCID-038's original finding).
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL).then((cached) => cached || Response.error())));
  }
  // Everything else (every other API route, every non-GET, every
  // non-allowlisted read) is left to default browser/network behavior --
  // this worker only ever narrows what it touches, never widens silently.
});
