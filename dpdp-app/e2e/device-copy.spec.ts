import { test, expect } from "@playwright/test"
import { createServer, type Server } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join, extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// A throwaway static server over dist/ that the test can SHUT DOWN: that is real "no network, no server" (Playwright's setOffline does not
// stop a service worker's own fetches, so it would prove nothing here).
const DIST = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "dist")
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" }
function serveDist(): Promise<{ server: Server; origin: string }> {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      let p = decodeURIComponent((req.url ?? "/").split("?")[0])
      if (p.endsWith("/")) p += "index.html"
      const file = join(DIST, p)
      if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("nope"); return }
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" })
      res.end(readFileSync(file))
    })
    server.listen(0, "127.0.0.1", () => ok({ server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` }))
  })
}

// The person's own machine does the work: after the first visit the whole /app/ page opens from the device with the network OFF (offline
// service worker), says so in plain words, and the page is three numbered steps with "copy your AI work link" first. Built dist/ in mock mode
// (VITE_MOCK=1), like the other specs; the service worker only registers in a production build, which is what dist/ is.

test.describe("Your copy on this device + the 3-step page", () => {
  test("step 1 is the AI link, in order, and one tap copies a paste-ready prompt", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await page.goto("/app/?mock=owner-live")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    const steps = page.getByTestId("ai-first-steps")
    await expect(steps.getByRole("heading", { name: "Do your DPDP jobs in 3 steps" })).toBeVisible()
    // order on the page: steps card BEFORE the jobs; 1, 2, 3 in order
    const order = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="ai-first-steps"]')!
      const jobs = document.getElementById("jobs")!
      const nums = [...s.querySelectorAll("[data-step]")].map((e) => e.getAttribute("data-step"))
      return { before: !!(s.compareDocumentPosition(jobs) & Node.DOCUMENT_POSITION_FOLLOWING), nums }
    })
    expect(order).toEqual({ before: true, nums: ["1", "2", "3"] })
    await expect(steps.getByText("Option 1 · Copy your AI work link")).toBeVisible()
    await expect(steps.getByText("Before you copy.")).toBeVisible()
    await steps.getByRole("button", { name: "📋 Copy my AI work link" }).click()
    const prompt = steps.getByTestId("ai-first-prompt")
    await expect(prompt).toContainText("/ai/")
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain("https://dpdp.veridian-aios.com/ai/")
  })

  test("after one visit the app opens with the server GONE, and says the copy is on the device", async ({ page }) => {
    const { server, origin } = await serveDist()
    try {
      await page.goto(`${origin}/app/?mock=owner-live`)
      await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId("device-copy")).toContainText("kept on this device", { timeout: 20_000 })
      await page.reload()
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 10_000 }).toBe(true)
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
      // The server no longer exists. A reload must still bring the whole app up from the device.
      await page.goto(`${origin}/app/`)
      await expect(page.getByTestId("ai-first-steps")).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId("device-copy")).toBeVisible()
      await expect(page.getByText("Signed in as")).toBeVisible()
    } finally {
      if (server.listening) server.close()
    }
  })

  test("the service worker never keeps anything but the app's own files", async ({ request }) => {
    const sw = await (await request.get("/app/sw.js")).text()
    expect(sw).toContain("dpdp-app-")
    expect(sw).toContain("url.origin !== self.location.origin")
    const files = JSON.parse(/const FILES = (\[[\s\S]*?\])\n/.exec(sw)![1]) as string[]
    expect(files.length).toBeGreaterThan(3)
    for (const f of files) expect(f).toMatch(/^\/(assets|fonts)\//)
    const manifest = await (await request.get("/app/manifest.webmanifest")).json()
    expect(manifest.scope).toBe("/app/")
    expect(manifest.display).toBe("standalone")
  })
})
