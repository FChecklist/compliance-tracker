import type { GuideGo } from "./catalog"

// "Take me there": find the exact box or heading by the words the person can see (a label, an
// accessible name, a heading), bring it into view, outline it and put the cursor in it.

const FLAG = "dpdp-guide-flag"
let styled = false

function ensureStyle() {
  if (styled || typeof document === "undefined") return
  styled = true
  const s = document.createElement("style")
  s.id = "dpdp-guide-style"
  s.textContent = `.${FLAG}{outline:4px solid #E4572E!important;outline-offset:3px;border-radius:6px}`
  document.head.appendChild(s)
}

function visible(el: Element | null): el is HTMLElement {
  if (!el) return false
  const h = el as HTMLElement
  return !!(h.offsetWidth || h.offsetHeight || h.getClientRects().length)
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[’‘]/g, "'")
const want = (s: string) => s.trim().toLowerCase().replace(/[’‘]/g, "'")

function controlOf(label: HTMLLabelElement): HTMLElement | null {
  const c = label.control as HTMLElement | null
  if (c) return c
  return label.querySelector("input, select, textarea")
}

/** The control a label/aria-label/placeholder phrase points at (first visible one). */
export function findControl(phrase: string, root: ParentNode = document): HTMLElement | null {
  const w = want(phrase)
  for (const l of Array.from(root.querySelectorAll("label"))) {
    if (text(l).includes(w)) {
      const c = controlOf(l)
      if (visible(c)) return c
    }
  }
  for (const el of Array.from(root.querySelectorAll("input, select, textarea, button, [role=textbox]"))) {
    const a = want(el.getAttribute("aria-label") ?? "")
    const p = want(el.getAttribute("placeholder") ?? "")
    if ((a && a.includes(w)) || (p && p.includes(w))) {
      if (visible(el)) return el as HTMLElement
    }
  }
  return null
}

/** A heading (or labelled region) containing the phrase. */
export function findSection(phrase: string, root: ParentNode = document): HTMLElement | null {
  const w = want(phrase)
  for (const h of Array.from(root.querySelectorAll("h1, h2, h3, h4, [role=region][aria-label], section[aria-label]"))) {
    const t = h.matches("h1, h2, h3, h4") ? text(h) : want(h.getAttribute("aria-label") ?? "")
    if (t.includes(w) && visible(h)) return h as HTMLElement
  }
  return null
}

function bring(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const h = window.innerHeight || document.documentElement.clientHeight
  if (r.top >= 60 && r.bottom <= h - 20) return
  el.scrollIntoView({ block: "center", behavior: "auto" })
}

function flag(el: HTMLElement): boolean {
  ensureStyle()
  el.classList.add(FLAG)
  bring(el)
  if (!el.matches("input, select, textarea, button, a, [tabindex]")) el.setAttribute("tabindex", "-1")
  try { el.focus({ preventScroll: true }) } catch { /* focusing is a courtesy */ }
  window.setTimeout(() => el.classList.remove(FLAG), 6000)
  return true
}

/** The element a guide points at right now, or null when it is not on this screen. */
export function locate(go: GuideGo): HTMLElement | null {
  for (const key of ["field", "section"] as const) {
    const spec = go[key]
    if (!spec) continue
    for (const phrase of spec.split("|")) {
      const el = key === "field" ? findControl(phrase) : findSection(phrase)
      if (el) return el
    }
  }
  return null
}

/** Returns true when it found the place and took the person there. */
export function focusTarget(go: GuideGo): boolean {
  const el = locate(go)
  return el ? flag(el) : false
}
