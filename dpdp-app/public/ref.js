/* Keeps a Sales Partner's code. A shared link ends in ?ref=<code>.
   The code is kept in this browser only (localStorage, key "dpdp-referral" -- the key the sign-in app reads),
   then taken out of the address bar. Nothing is sent anywhere and nothing else is stored. */
(function () {
  try {
    var url = new URL(window.location.href)
    var code = url.searchParams.get("ref")
    if (code === null) return
    if (/^[A-Za-z0-9]{4,16}$/.test(code)) {
      try {
        window.localStorage.setItem("dpdp-referral", code)
      } catch (e) {
        /* storage is blocked: the page works the same, the code is simply not kept */
      }
    }
    url.searchParams.delete("ref")
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
  } catch (e) {
    /* never break the page */
  }
})()
