/* Makes the public site installable. It registers the service worker /sw.js (scope "/") so a browser can offer "Install" and a public page
   that cannot load shows a friendly offline page instead of the browser's error. That is all: no network call of its own, no cookie, no
   storage, nothing sent anywhere. It does nothing at all on the private prefixes (the signed-in app and the token pages) -- those are never
   given to the worker either (see /sw.js) -- and nothing if the browser has no service-worker support. */
(function () {
  try {
    if (!("serviceWorker" in navigator)) return
    var path = location.pathname
    var PRIVATE = ["/app/", "/act/", "/p/", "/copy/", "/unsubscribe/", "/ai/", "/api/"]
    for (var i = 0; i < PRIVATE.length; i++) {
      if (path === PRIVATE[i].slice(0, -1) || path.indexOf(PRIVATE[i]) === 0) return
    }
    var go = function () {
      try {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {})
      } catch (e) {
        /* never break the page */
      }
    }
    if (document.readyState === "complete") go()
    else window.addEventListener("load", go)
  } catch (e) {
    /* never break the page */
  }
})()
