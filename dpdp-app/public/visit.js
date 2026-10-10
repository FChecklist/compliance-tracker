/* First-party visit journey for the public pages (owner-approved 2026-10-06). It records, on this site only, where a visit came from (the referring site's
   NAME and the campaign tags in the link), which public page and which section of it was looked at and for how long, which links and choices were used, how far
   the page was scrolled, and where the visit ended. It sends that to this site's own /api/visit with sendBeacon -- one small request when the page is left.
   It keeps a random visitor id (a cookie and local storage on this site, one year) so a returning visit is recognised. It never records what is typed, a name,
   an e-mail, the address bar's query text, or anything from the signed-in or private pages (/app/, /act/, /unsubscribe/, /p/, /copy/, /ai/, /api/).
   When the browser sends Global Privacy Control or Do Not Track it stores NO id and sends one count-only ping that is added to a daily total and kept nowhere else.
   It never throws into the page. */
(function () {
  try {
    var path = location.pathname
    var PRIVATE = ["/app/", "/act/", "/unsubscribe/", "/p/", "/copy/", "/ai/", "/api/"]
    for (var i = 0; i < PRIVATE.length; i++) if (path === PRIVATE[i].slice(0, -1) || path.indexOf(PRIVATE[i]) === 0) return
    if (!navigator.sendBeacon) return
    var ENDPOINT = "/api/visit"
    var device = innerWidth < 700 ? "mobile" : innerWidth < 1100 ? "tablet" : "desktop"
    var send = function (obj) {
      try { navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(obj)], { type: "application/json" })) } catch (e) {}
    }

    // Privacy signal: count this visit and nothing else. No id, no storage, no listeners.
    if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.msDoNotTrack === "1") {
      send({ off: 1, p: path, d: device })
      return
    }

    var hex = function (n) {
      var b = new Uint8Array(n)
      ;(window.crypto || window.msCrypto).getRandomValues(b)
      var s = ""
      for (var j = 0; j < b.length; j++) s += (b[j] < 16 ? "0" : "") + b[j].toString(16)
      return s
    }
    var HEX = /^[a-f0-9]{16,64}$/
    var cookieGet = function (k) {
      var m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)"))
      return m ? m[1] : ""
    }
    var vid = ""
    try { vid = cookieGet("dpdp_vid") || localStorage.getItem("dpdp_vid") || "" } catch (e) {}
    if (!HEX.test(vid)) vid = hex(12)
    try { localStorage.setItem("dpdp_vid", vid) } catch (e) {}
    try {
      var dom = /(^|\.)veridian-aios\.com$/.test(location.hostname) ? "; Domain=veridian-aios.com" : ""
      document.cookie = "dpdp_vid=" + vid + "; Max-Age=31536000; Path=/; SameSite=Lax" + dom + (location.protocol === "https:" ? "; Secure" : "")
    } catch (e) {}

    var sid = ""
    var first = false
    try {
      sid = sessionStorage.getItem("dpdp_sid") || ""
      if (!HEX.test(sid)) { sid = hex(8); sessionStorage.setItem("dpdp_sid", sid); first = true }
    } catch (e) {
      sid = hex(8)
      first = true
    }

    var slug = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) }
    var q = [], sections = {}, active = {}, resume = {}, lastSection = "", maxScroll = 0, visibleSince = Date.now(), visibleMs = 0
    var pv = function () { q.push({ k: "pv", p: path }) }

    function flush(withExit) {
      var now = Date.now()
      // Time only counts while the page is visible: leaving pauses the clocks (they restart when the tab comes back).
      if (visibleSince) { visibleMs += now - visibleSince; visibleSince = withExit ? 0 : now }
      for (var id in active) {
        sections[id] = (sections[id] || 0) + (now - active[id])
        if (withExit) { resume[id] = 1; delete active[id] } else active[id] = now
      }
      var ev = q.splice(0, q.length)
      for (var name in sections) if (sections[name] >= 800) ev.push({ k: "sec", p: path, n: name, ms: Math.min(sections[name], 3600000) })
      sections = {}
      if (withExit) ev.push({ k: "exit", p: path, n: lastSection || undefined, ms: visibleMs, sc: maxScroll })
      if (!ev.length) return
      var body = { sid: sid, vid: vid, p: path, d: device, l: (navigator.language || "").slice(0, 12) }
      if (first) {
        first = false
        try {
          var rh = document.referrer ? new URL(document.referrer).hostname : ""
          if (rh && rh !== location.hostname) body.r = rh
        } catch (e) {}
        try {
          var sp = new URLSearchParams(location.search)
          body.u = { s: sp.get("utm_source") || "", m: sp.get("utm_medium") || "", c: sp.get("utm_campaign") || "", t: sp.get("utm_term") || "", n: sp.get("utm_content") || "" }
        } catch (e) {}
      }
      // At most 20 events per request (the server accepts 25).
      for (var from = 0; from === 0 || from < ev.length; from += 20) {
        var part = Object.assign({}, body, { e: ev.slice(from, from + 20) })
        if (from > 0) { delete part.r; delete part.u }
        send(part)
      }
    }

    pv()

    // Sections: any <section>, [data-section], or id'd block in <main>, named by its id, else the heading it is labelled by, else its first heading's words.
    var nameOf = function (el) {
      if (el.id) return slug(el.id)
      var lb = el.getAttribute("aria-labelledby")
      var h = lb && document.getElementById(lb)
      if (!h) h = el.querySelector("h1,h2,h3")
      return slug(el.getAttribute("data-section") || (h && h.textContent))
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        var t = Date.now()
        entries.forEach(function (en) {
          var n = en.target.__dpdpName
          if (!n) return
          if (en.isIntersecting && en.intersectionRatio >= 0.4) { if (!active[n]) active[n] = t; lastSection = n }
          else if (active[n]) { sections[n] = (sections[n] || 0) + (t - active[n]); delete active[n] }
        })
      }, { threshold: [0, 0.4, 0.75] })
      var els = document.querySelectorAll("main section, section[id], [data-section]")
      for (var k = 0; k < els.length; k++) { var nm = nameOf(els[k]); if (nm) { els[k].__dpdpName = nm; io.observe(els[k]) } }
    }

    addEventListener("scroll", function () {
      var h = document.documentElement.scrollHeight - innerHeight
      var pct = h > 0 ? Math.round(((window.pageYOffset || document.documentElement.scrollTop) / h) * 100) : 100
      if (pct > maxScroll) maxScroll = Math.min(100, pct)
    }, { passive: true })

    // Links and buttons: the destination's path (or "ext:<host>", "mailto", "tel"), never the query.
    var NAME = /^[a-z0-9][a-z0-9_.:/-]{0,59}$/i
    document.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest("a,button,[data-visit]") : null
      if (!el) return
      var n = el.getAttribute("data-visit") || ""
      if (!n && el.tagName === "A") {
        var href = el.getAttribute("href") || ""
        if (/^mailto:/i.test(href)) n = "mailto"
        else if (/^tel:/i.test(href)) n = "tel"
        else {
          try {
            var u = new URL(href, location.href)
            n = u.host === location.host ? u.pathname.replace(/\/index\.html$/, "/") : "ext:" + u.hostname
          } catch (er) {}
        }
      }
      if (!n && el.tagName === "BUTTON") n = el.id || ""
      n = n.toLowerCase()
      if (NAME.test(n) || /^\/[a-z0-9_./-]{0,58}$/.test(n)) {
        q.push({ k: "cta", p: path, n: n })
        if (q.length >= 15) flush(false)
      }
    }, true)

    // Choices: a dropdown, a radio button or a tick box only -- a closed set of values, never typed text.
    var VALUE = /^[a-z0-9][a-z0-9_.+-]{0,39}$/i
    document.addEventListener("change", function (e) {
      var t = e.target
      if (!t || !t.tagName) return
      var isSel = t.tagName === "SELECT", isIn = t.tagName === "INPUT" && (t.type === "radio" || t.type === "checkbox")
      if (!isSel && !isIn) return
      var n = slug(t.getAttribute("data-visit") || t.name || t.id)
      var v = isSel ? t.value : t.type === "checkbox" ? (t.checked ? "on" : "off") : t.value
      if (n && VALUE.test(String(v))) q.push({ k: "choice", p: path, n: n, v: String(v).toLowerCase() })
    }, true)

    var left = false
    addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { left = true; flush(true) }
      else {
        left = false; visibleSince = Date.now()
        for (var id in resume) active[id] = visibleSince
        resume = {}
      }
    })
    addEventListener("pagehide", function () { if (!left) flush(true) })
  } catch (e) {
    /* never break the page */
  }
})()
