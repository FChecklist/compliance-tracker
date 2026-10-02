/* Tiny first-party monitoring for the public pages: page views, speed (Core Web Vitals), JavaScript errors,
   files that fail to load, failed or slow calls to our own /api/. Sent with sendBeacon to /api/telemetry on THIS domain only.
   No cookie, no browser storage, no IP address, no query string or fragment, no personal data, no third party.
   It does not run on the signed-in or private pages (/app/, /act/, /unsubscribe/, /p/, /copy/, /ai/), and it does nothing
   when the browser sends Do Not Track or Global Privacy Control. It never throws into the page. */
(function () {
  try {
    var path = location.pathname
    var PRIVATE = ["/app/", "/act/", "/unsubscribe/", "/p/", "/copy/", "/ai/", "/api/"]
    for (var i = 0; i < PRIVATE.length; i++) if (path === PRIVATE[i].slice(0, -1) || path.indexOf(PRIVATE[i]) === 0) return
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.msDoNotTrack === "1" || navigator.globalPrivacyControl === true) return
    if (!navigator.sendBeacon || !window.PerformanceObserver) return

    var q = [], sent = 0, MAX = 30, lcp = 0, cls = 0, inp = 0, done = false
    var cut = function (s) { return String(s == null ? "" : s).split("?")[0].split("#")[0] }
    var rel = function (s) { return cut(s).replace(location.origin, "") }
    function push(k, n, v, d) {
      if (sent + q.length >= MAX) return
      q.push({ k: k, p: path, n: n || "", v: v == null ? null : Math.round(v * 1000) / 1000, d: d ? String(d).slice(0, 200) : "" })
    }
    function flush() {
      if (!q.length) return
      var b = JSON.stringify({ e: q })
      sent += q.length
      q = []
      try { navigator.sendBeacon("/api/telemetry", new Blob([b], { type: "application/json" })) } catch (e) {}
    }

    var ref = ""
    try {
      var rh = document.referrer ? new URL(document.referrer).hostname : ""
      ref = rh === location.hostname ? "" : rh
    } catch (e) {}
    push("pv", "", null, ref + "|" + (innerWidth < 700 ? "mobile" : innerWidth < 1100 ? "tablet" : "desktop"))

    function obs(type, cb, opt) {
      try {
        var o = new PerformanceObserver(function (l) { l.getEntries().forEach(cb) })
        o.observe(Object.assign({ type: type, buffered: true }, opt || {}))
      } catch (e) {}
    }
    obs("largest-contentful-paint", function (e) { lcp = e.startTime })
    obs("layout-shift", function (e) { if (!e.hadRecentInput) cls += e.value })
    obs("event", function (e) { if (e.interactionId && e.duration > inp) inp = e.duration }, { durationThreshold: 40 })

    function vitals() {
      if (done) return
      done = true
      var nav = performance.getEntriesByType("navigation")[0]
      if (nav) {
        push("vital", "TTFB", nav.responseStart)
        push("vital", "LOAD", nav.loadEventEnd || nav.domComplete)
        if (nav.responseStatus >= 400) push("res", "page-http-" + nav.responseStatus, null, rel(location.href))
      }
      var fcp = performance.getEntriesByName("first-contentful-paint")[0]
      if (fcp) push("vital", "FCP", fcp.startTime)
      if (lcp) push("vital", "LCP", lcp)
      push("vital", "CLS", cls)
      if (inp) push("vital", "INP", inp)
      // A file the page asked for and the server refused (404, 500...): the broken-link report.
      var bad = 0
      performance.getEntriesByType("resource").forEach(function (r) {
        if (r.responseStatus >= 400 && bad++ < 5) push("res", "http-" + r.responseStatus, null, rel(r.name))
      })
    }
    addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { vitals(); flush() } })
    addEventListener("pagehide", function () { vitals(); flush() })

    addEventListener("error", function (e) {
      var t = e.target
      if (t && t !== window && (t.src || t.href)) push("res", "load-failed", null, rel(t.src || t.href))
      else push("err", "js", null, cut(e.message || "error") + " @" + rel(e.filename || "") + ":" + (e.lineno || 0))
    }, true)
    addEventListener("unhandledrejection", function (e) {
      push("err", "promise", null, cut(e.reason && (e.reason.message || e.reason)))
    })

    // Same-origin /api/ calls only (the public pages make none today; this is here so a future one is never silent).
    var f = window.fetch
    if (f) window.fetch = function (input) {
      var url = typeof input === "string" ? input : (input && input.url) || ""
      var p = rel(url), t0 = performance.now()
      var track = p.indexOf("/api/") === 0 && p.indexOf("/api/telemetry") !== 0
      var out = f.apply(this, arguments)
      if (!track) return out
      return out.then(
        function (r) {
          var ms = performance.now() - t0
          if (r.status >= 500) push("api", p, ms, "http " + r.status)
          else if (ms > 8000) push("api", p, ms, "slow")
          return r
        },
        function (err) {
          push("api", p, performance.now() - t0, err && err.name === "AbortError" ? "timeout" : "network")
          throw err
        },
      )
    }
    setTimeout(function () { if (document.readyState === "complete") { vitals(); flush() } }, 15000)
  } catch (e) {
    /* never break the page */
  }
})()
