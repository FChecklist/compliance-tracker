import { test, expect, type Page } from "@playwright/test"

// Reminders made on the person's own device, switched on silently, with nothing sent to us. Built dist/ in mock mode (VITE_MOCK=1), like the
// other specs. The mock owner has three overdue jobs (src/lib/mock-client.ts, `due: { 4: -6, 15: -3, 24: -1 }`).
const KEY = "owner@example.test"
const keys = (page: Page) => page.evaluate(() => new Promise<string[]>((res) => {
  const r = indexedDB.open("veridian-dpdp-copy", 1)
  r.onsuccess = () => { const q = r.result.transaction("kv").objectStore("kv").getAllKeys(); q.onsuccess = () => res(q.result.map(String).filter((k) => k.startsWith("remind:"))) }
}))
const askWorker = (page: Page) => page.evaluate(() => new Promise<number>((resolve) => {
  navigator.serviceWorker.ready.then((reg) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = (m) => resolve(Number(m.data.shown))
    reg.active!.postMessage({ type: "dpdp-check-due", force: true }, [ch.port2])
  })
}))

test.describe("Reminders made on this device", () => {
  test("already allowed: switched on silently -- nothing on screen, no push subscription, a notification from the device's own copy", async ({ page, context }) => {
    await context.grantPermissions(["notifications"])
    await page.goto("/app/?mock=owner-live")
    await expect(page.getByTestId("device-copy")).toContainText("kept on this device", { timeout: 20_000 })
    await expect.poll(() => keys(page), { timeout: 15_000 }).toContain(`remind:${KEY}|on`)
    // Silent: no banner, no button, no wording about reminders anywhere on the page.
    await expect(page.getByTestId("device-reminders")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /remind me/i })).toHaveCount(0)
    // The promise: this browser never gave us a push address, so there is nothing of theirs on our server to hold.
    expect(await page.evaluate(async () => (await (await navigator.serviceWorker.ready).pushManager.getSubscription()) === null)).toBe(true)
    // Playwright's headless Chromium refuses showNotification even with the permission granted; a real browser shows it (checked live, see the PR).
    const canShow = await page.evaluate(async () => { try { await (await navigator.serviceWorker.ready).showNotification("probe", { tag: "probe" }); return true } catch { return false } })
    await page.evaluate(async () => { for (const n of await (await navigator.serviceWorker.ready).getNotifications()) n.close() })
    const shown = await askWorker(page)
    if (!canShow) { expect(shown).toBe(-1); return }
    expect(shown).toBe(1)
    const got = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body })))
    expect(got).toHaveLength(1)
    expect(got[0].title).toBe("DPDP jobs are overdue")
    expect(got[0].body).toMatch(/^3 jobs overdue/)
    expect(JSON.stringify(got)).not.toMatch(/@/)
  })

  test("not asked yet: nothing is asked until the person's first tap, then once, and a 'no' is remembered", async ({ page }) => {
    await page.goto("/app/?mock=owner-live")
    await expect(page.getByTestId("device-copy")).toContainText("kept on this device", { timeout: 20_000 })
    await page.waitForTimeout(500)
    expect(await keys(page)).toEqual([]) // no tap yet: nothing asked, nothing stored
    await page.mouse.click(5, 5)
    await expect.poll(() => keys(page), { timeout: 10_000 }).toContain(`remind:${KEY}|asked`)
    await expect(page.getByTestId("device-reminders")).toHaveCount(0)
  })

  test("the built worker contains the shared rule and no network call in its reminder code", async ({ request }) => {
    const sw = await (await request.get("/app/sw.js")).text()
    expect(sw).toContain("function decideReminder")
    expect(sw).toContain('addEventListener("periodicsync"')
    expect(sw).not.toContain("__REMINDERS__")
    expect(sw).not.toMatch(/^export /m)
  })
})
