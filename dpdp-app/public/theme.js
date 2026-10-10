/* Colour theme for the home page: three dots at the top centre switch between three looks (violet, studio blue, emerald).
   The choice is a display preference kept in this browser only (localStorage, key "veridian-theme"); nothing is sent anywhere,
   no cookie. It runs in the <head> so the saved theme is on <html data-theme> before the first paint (no flash), then builds
   the three buttons -- position: absolute, so they move nothing and cause no layout shift. If storage is blocked the page
   simply opens in violet. */
(function () {
  var THEMES = [
    ["violet", "#6d28d9", "Violet"],
    ["studio", "#1d4ed8", "Studio blue"],
    ["emerald", "#0f766e", "Emerald"],
  ]
  var KEY = "veridian-theme"
  function known(v) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i][0] === v) return true
    return false
  }
  function saved() {
    try {
      var v = window.localStorage.getItem(KEY)
      return known(v) ? v : "violet"
    } catch (e) {
      return "violet"
    }
  }
  var root = document.documentElement
  root.setAttribute("data-theme", saved())
  function mark(group, name) {
    var buttons = group.children
    for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute("aria-pressed", String(buttons[i].getAttribute("data-theme") === name))
  }
  function mount() {
    var group = document.createElement("div")
    group.className = "tdots"
    group.setAttribute("role", "group")
    group.setAttribute("aria-label", "Colour theme")
    THEMES.forEach(function (t) {
      var b = document.createElement("button")
      b.type = "button"
      b.setAttribute("type", "button")
      b.setAttribute("data-theme", t[0])
      b.setAttribute("style", "--dot: " + t[1])
      b.setAttribute("title", t[2])
      b.setAttribute("aria-label", t[2] + " theme")
      b.addEventListener("click", function () {
        root.setAttribute("data-theme", t[0])
        try {
          window.localStorage.setItem(KEY, t[0])
        } catch (e) {
          /* storage blocked: the choice lasts until the page is closed */
        }
        mark(group, t[0])
      })
      group.appendChild(b)
    })
    mark(group, root.getAttribute("data-theme"))
    var host = document.querySelector(".hm-page") || document.body
    host.insertBefore(group, host.firstChild)
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount)
  else mount()
})()
