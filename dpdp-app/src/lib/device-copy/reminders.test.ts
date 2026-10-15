import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { countDue, dayKey, decideReminder, mineAndOpen, reminderText } from "./reminders.mjs"
import { reminderSource } from "../../../scripts/pwa/build-pwa.mjs"
import { createCopyStore } from "./copy-store"
import { memoryKv } from "./kv"

const NOW = new Date(2026, 9, 3, 10, 0, 0) // 3 Oct 2026, local
const day = (offset: number) => new Date(2026, 9, 3 + offset, 9, 0, 0).toISOString()
const row = (over: Record<string, unknown>) => ({ id: "r", due: day(0), yes: false, na: false, by: "me@x.in", isGroup: false, ...over })
const page = (rows: Array<Record<string, unknown>>, kind = "staff") => ({ viewer: { kind }, rows })

describe("reminders: which jobs count", () => {
  test("counts only my own open jobs, overdue vs due within 3 days", () => {
    const p = page([
      row({ id: "a", due: day(-2) }), // overdue
      row({ id: "b", due: day(0) }), // today = soon
      row({ id: "c", due: day(3) }), // edge of the window = soon
      row({ id: "d", due: day(4) }), // later: not yet
      row({ id: "e", due: day(-5), yes: true }), // done
      row({ id: "f", due: day(-5), na: true }), // not applicable
      row({ id: "g", due: day(-5), by: "other@x.in" }), // someone else's
    ])
    expect(countDue(p, "ME@x.in", NOW)).toEqual({ overdue: 1, soon: 2 })
  })
  test("a group job counts only for a member who has not answered", () => {
    const g = (extra: Record<string, unknown>) => row({ isGroup: true, by: "All staff", due: day(-1), ...extra })
    expect(mineAndOpen(page([g({ viewerIsGroupMember: true })]), "me@x.in")).toHaveLength(1)
    expect(mineAndOpen(page([g({ viewerIsGroupMember: true, myGroupAnswer: "done" })]), "me@x.in")).toHaveLength(0)
    expect(mineAndOpen(page([g({ viewerIsGroupMember: false })]), "me@x.in")).toHaveLength(0)
  })
  test("unassigned jobs are the owner's only", () => {
    const rows = [row({ by: null, due: day(-1) })]
    expect(countDue(page(rows, "owner"), "me@x.in", NOW).overdue).toBe(1)
    expect(countDue(page(rows, "staff"), "me@x.in", NOW).overdue).toBe(0)
  })
  test("garbage in a stored page never throws", () => {
    expect(countDue(null, "me@x.in", NOW)).toEqual({ overdue: 0, soon: 0 })
    expect(countDue({ rows: [null, { due: "not a date", yes: false, na: false, by: "me@x.in" }] } as never, "me@x.in", NOW)).toEqual({ overdue: 0, soon: 0 })
  })
})

describe("reminders: the notification", () => {
  test("text is counts only, and silent when nothing is due", () => {
    expect(reminderText({ overdue: 0, soon: 0 })).toBeNull()
    expect(reminderText({ overdue: 1, soon: 0 })?.body).toBe("1 job overdue. Open the app to see which.")
    expect(reminderText({ overdue: 2, soon: 3 })?.body).toContain("2 jobs overdue and 3 jobs due")
    const t = JSON.stringify(reminderText({ overdue: 2, soon: 3 }))
    expect(t).not.toMatch(/@|consent|breach|notice/i) // nothing identifying or topical on a lock screen
  })
  test("at most one a day, unless forced; forced never invents a count", () => {
    const p = page([row({ due: day(-1) })])
    const first = decideReminder({ page: p, email: "me@x.in", now: NOW, lastDay: null })
    expect(first.show).toBe(true)
    expect(decideReminder({ page: p, email: "me@x.in", now: NOW, lastDay: dayKey(NOW) }).show).toBe(false)
    expect(decideReminder({ page: p, email: "me@x.in", now: NOW, lastDay: dayKey(NOW), force: true }).show).toBe(true)
    expect(decideReminder({ page: page([]), email: "me@x.in", now: NOW, lastDay: null, force: true }).show).toBe(false)
  })
})

describe("the service worker uses the very same rule", () => {
  test("the pasted source is valid worker text and answers like the module", () => {
    const src = reminderSource()
    expect(src).not.toMatch(/^export /m)
    const api = new Function(`${src}; return { countDue, decideReminder }`)() as { countDue: typeof countDue }
    const p = page([row({ due: day(-1) }), row({ due: day(1) })])
    expect(api.countDue(p, "me@x.in", NOW)).toEqual(countDue(p, "me@x.in", NOW))
  })
  test("the template has the placeholder, the handlers, and nothing that talks to a server", () => {
    const t = readFileSync(join(import.meta.dir, "../../../scripts/pwa/sw.template.js"), "utf8")
    expect(t).toContain("__REMINDERS__")
    expect(t).toContain('addEventListener("periodicsync"')
    expect(t).toContain('addEventListener("notificationclick"')
    // The privacy promise, pinned: no push subscription is ever requested and the worker never sends the person's data anywhere.
    expect(t).not.toMatch(/pushManager|\.subscribe\(|applicationServerKey|sendBeacon/i)
    const reminderBlock = t.slice(t.indexOf("async function checkDue"), t.indexOf('addEventListener("notificationclick"'))
    expect(reminderBlock).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket/)
  })
  test("the page code never asks for a push subscription either", () => {
    const n = readFileSync(join(import.meta.dir, "notify.ts"), "utf8")
    expect(n.replace(/\/\/.*$/gm, "")).not.toMatch(/pushManager|\.subscribe\(|applicationServerKey/i)
  })
})

describe("the per-person reminder flag", () => {
  test("is per person, off by default, and removed by sign-out and by a different person", async () => {
    const store = createCopyStore(memoryKv())
    expect(await store.remindersOn("a@x.in")).toBe(false)
    await store.setReminders("A@x.in", true)
    expect(await store.remindersOn("a@x.in")).toBe(true)
    expect(await store.remindersOn("b@x.in")).toBe(false)
    await store.keepOnly("b@x.in")
    expect(await store.remindersOn("a@x.in")).toBe(false)
    await store.setReminders("b@x.in", true)
    await store.wipe()
    expect(await store.remindersOn("b@x.in")).toBe(false)
  })
})
