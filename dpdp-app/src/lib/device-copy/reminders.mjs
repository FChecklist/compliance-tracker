// Reminders that are made ENTIRELY ON THE PERSON'S OWN DEVICE. Nothing here talks to a network, and nothing is sent to us: the service worker
// reads the copy of the person's own jobs that already lives in this browser (src/lib/device-copy), works out what is overdue or due soon, and
// shows a notification. No subscription, no push address and no phone number ever reaches our server, because there is no server in this loop.
//
// Plain JavaScript on purpose: scripts/pwa/build-pwa.mjs pastes this file's text into the service worker (which cannot import), and the page and
// the tests import the very same file, so the rule the worker applies and the rule the tests pin cannot drift apart. Keep it dependency-free.

export const SOON_DAYS = 3

const norm = (s) => String(s || "").trim().toLowerCase()

/** Local calendar day of a moment, "YYYY-MM-DD" (the person's own day, not UTC). */
export function dayKey(d) {
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dayNumber(d) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
}

/**
 * Which jobs in a stored page are the viewer's own and still open. "Own" = assigned to them, or a group job they belong to and have not answered
 * yet; the owner also counts jobs nobody has been given. Done and not-applicable jobs never count.
 */
export function mineAndOpen(page, email) {
  const me = norm(email)
  const kind = page && page.viewer && page.viewer.kind
  const rows = page && Array.isArray(page.rows) ? page.rows : []
  return rows.filter((r) => {
    if (!r || r.yes || r.na) return false
    if (r.isGroup) return !!r.viewerIsGroupMember && !r.myGroupAnswer
    if (r.by == null || r.by === "") return kind === "owner"
    return norm(r.by) === me
  })
}

/** Counts of the viewer's open jobs that are already late, and that fall due today or within SOON_DAYS. */
export function countDue(page, email, now) {
  const today = dayNumber(now)
  let overdue = 0
  let soon = 0
  for (const r of mineAndOpen(page, email)) {
    const due = new Date(r.due)
    if (Number.isNaN(due.getTime())) continue
    const n = dayNumber(due)
    if (n < today) overdue++
    else if (n <= today + SOON_DAYS) soon++
  }
  return { overdue, soon }
}

const jobs = (n) => `${n} job${n === 1 ? "" : "s"}`

/**
 * The notification text, or null when there is nothing to say. Deliberately generic (counts only, no job names, no organisation name): a
 * notification can light up a locked screen or a shared laptop, and a count tells a bystander nothing.
 */
export function reminderText({ overdue, soon }) {
  if (overdue > 0 && soon > 0) return { title: "DPDP jobs need you", body: `${jobs(overdue)} overdue and ${jobs(soon)} due in the next ${SOON_DAYS} days.` }
  if (overdue > 0) return { title: "DPDP jobs are overdue", body: `${jobs(overdue)} overdue. Open the app to see which.` }
  if (soon > 0) return { title: "DPDP jobs due soon", body: `${jobs(soon)} due in the next ${SOON_DAYS} days.` }
  return null
}

/**
 * The one decision the worker makes: show a reminder now? At most one a day per person (lastDay = the day a reminder was last shown), and only
 * when there is something to say. `force` (the "send me a test" button) skips the once-a-day limit but never invents a count.
 */
export function decideReminder({ page, email, now, lastDay, force }) {
  const counts = countDue(page, email, now)
  const text = reminderText(counts)
  const day = dayKey(now)
  if (!text) return { show: false, day, counts }
  if (!force && lastDay === day) return { show: false, day, counts }
  return { show: true, day, counts, ...text }
}
