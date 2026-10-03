import type { CopyStore } from "./copy-store"

// Browser side of the on-device reminders (see reminders.mjs for the rule and sw.template.js for the worker). The privacy line is the whole
// design: we never ask the browser for a push subscription, because a push address is something OUR server would have to keep. Instead the
// person's own browser shows the notification, from the copy of their own jobs it already holds. We receive nothing, and there is no phone number.
export type ReminderSupport = "unsupported" | "blocked" | "off" | "granted"

/** What this browser can do right now. "off" = it can, but the person has not agreed yet; "blocked" = they said no in the browser (only they can undo that). */
export function reminderSupport(): ReminderSupport {
  if (typeof window === "undefined" || typeof Notification === "undefined" || !("serviceWorker" in navigator)) return "unsupported"
  if (Notification.permission === "denied") return "blocked"
  return Notification.permission === "granted" ? "granted" : "off"
}

/** The same answer from the Permissions API, which is the more reliable of the two (some browsers' Notification.permission lags a grant). */
export async function currentSupport(): Promise<ReminderSupport> {
  const quick = reminderSupport()
  if (quick === "unsupported") return quick
  try {
    const s = await navigator.permissions.query({ name: "notifications" })
    return s.state === "granted" ? "granted" : s.state === "denied" ? "blocked" : "off"
  } catch { return quick }
}

type PeriodicReg = ServiceWorkerRegistration & { periodicSync?: { register: (tag: string, o: { minInterval: number }) => Promise<void>; unregister: (tag: string) => Promise<void> } }

async function worker(): Promise<ServiceWorkerRegistration | null> {
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]) } catch { return null }
}

/** Ask the worker to check now. `force` = the "send me a test" button: skips the once-a-day limit and the "you are looking at it" skip. Returns how many it showed. */
export async function checkNow(force: boolean): Promise<number> {
  const reg = await worker()
  if (!reg?.active) return 0
  return new Promise<number>((resolve) => {
    const ch = new MessageChannel()
    const t = setTimeout(() => resolve(0), 5000)
    ch.port1.onmessage = (m) => { clearTimeout(t); resolve(Number((m.data as { shown?: number }).shown ?? 0)) }
    reg.active!.postMessage({ type: "dpdp-check-due", force }, [ch.port2])
  })
}

/** Must be called from a click: browsers only show the permission prompt for a real tap. Returns the resulting state. */
export async function enableReminders(): Promise<ReminderSupport> {
  if (reminderSupport() === "unsupported") return "unsupported"
  const result = await Notification.requestPermission()
  if (result !== "granted") return result === "denied" ? "blocked" : "off"
  // Installed Chrome/Edge apps can also be woken by the browser about twice a day with nothing open. Best effort: absent elsewhere, and the
  // page's own hourly check (below) covers a tab that is open in the background.
  try { await (await worker() as PeriodicReg | null)?.periodicSync?.register("dpdp-due-check", { minInterval: 12 * 60 * 60 * 1000 }) } catch { /* not installed / not allowed: fine */ }
  return "granted"
}

export async function disableReminders(): Promise<void> {
  try { await (await worker() as PeriodicReg | null)?.periodicSync?.unregister("dpdp-due-check") } catch { /* nothing registered */ }
}

/** While the app is open (even in a background tab) look again every half hour. Returns a stop function. */
export function startBackgroundChecks(): () => void {
  void checkNow(false)
  const id = setInterval(() => { void checkNow(false) }, 30 * 60 * 1000)
  return () => clearInterval(id)
}

/**
 * Everything, silently, for a signed-in person: no banner, no button. If the browser already allows notifications, switch reminders on and
 * start the background checks. If it has not been asked yet, wait for the person's FIRST tap or key press anywhere in the app (browsers only
 * show their own one-time "Allow notifications?" question after a real gesture) and ask then. A "no" is remembered and never asked again.
 * Returns a cleanup function.
 */
export function armReminders(store: CopyStore, email: string): () => void {
  let live = true
  let stopChecks: (() => void) | null = null
  const events = ["pointerdown", "keydown"] as const
  const begin = async () => {
    await store.setReminders(email, true)
    try { await (await worker() as PeriodicReg | null)?.periodicSync?.register("dpdp-due-check", { minInterval: 12 * 60 * 60 * 1000 }) } catch { /* not installed / not allowed: fine */ }
    if (live && !stopChecks) stopChecks = startBackgroundChecks()
  }
  const onGesture = () => {
    for (const e of events) window.removeEventListener(e, onGesture)
    void (async () => {
      await store.setReminderAsked(email).catch(() => {})
      if ((await enableReminders()) === "granted" && live) await begin()
    })()
  }
  void Promise.all([currentSupport(), store.reminderAsked(email)]).then(([support, asked]) => {
    if (!live) return
    if (support === "granted") void begin()
    else if (support === "off" && !asked) for (const e of events) window.addEventListener(e, onGesture, { once: true })
  }).catch(() => {})
  return () => { live = false; stopChecks?.(); for (const e of events) window.removeEventListener(e, onGesture) }
}
