// Renders the first-visit screens of the MOCK build as PNGs, at phone (360 px) and laptop (1280 px) width, for the owner's preview.
// Usage: node scripts/first-visit-shots.mjs <base-url> <out-dir>
// The mock build (VITE_MOCK=1) keeps all sample data in the browser, so nothing here touches Supabase or sends anything.
import { chromium } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

const base = (process.argv[2] || "http://127.0.0.1:4173").replace(/\/+$/, "")
const out = process.argv[3] || "shots"
fs.mkdirSync(out, { recursive: true })

const PUBLIC = [
  ["01-home", "/"], ["02-firm-landing", "/dpdp-firm/"], ["03-organisation-landing", "/dpdp-institution/"], ["04-pricing", "/pricing/"], ["05-sign-in", "/app/"],
]
const APP = [
  ["10-org-owner-first-visit", "owner"], ["11-org-owner-running", "owner-live"], ["12-org-owner-reviews-ca-setup", "client-owner"],
  ["20-firm-partner", "partner"], ["21-firm-manager", "manager"],
  ["30-grievance-officer", "go"], ["31-coordinator", "coord"], ["32-staff", "staff"], ["33-hr", "hr"], ["34-member", "member"],
]
// For these worlds every button on the page is pressed in turn (page reloaded between presses) so each panel gets a picture.
const CRAWL = new Set(["owner-live", "partner"])
const SKIP = /sign out|log out|delete|remove|revoke|unsubscribe|not me|undo|close|dismiss/i
const NEXT = /^\W*(next|continue|create the list|start|get started|let'?s go|looks right|save|finish|done)\b/i
// The plan chip (trial, plan, pack) opens the billing panel: the screen with the trial pack, monthly and yearly choices.
const BILLING = /free trial|trial|billing|plan|pack|pay/i
const BILLING_WORLDS = new Set(["owner", "owner-live", "client-owner", "partner"])
const SIZES = [["phone", 360, 740], ["laptop", 1280, 800]]
const manifest = []

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x"

async function visibleButtonNames(page) {
  return page.evaluate(() => {
    const seen = new Set()
    for (const el of document.querySelectorAll("button, [role=button], summary")) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4 || getComputedStyle(el).visibility === "hidden") continue
      const name = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim()
      if (name && name.length <= 60) seen.add(name)
    }
    return [...seen]
  })
}

async function shot(page, name, note) {
  const file = `${name}.png`
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(out, file), fullPage: true })
  manifest.push({ file, note })
}

async function open(page, url) {
  await page.goto(base + url, { waitUntil: "load" })
  await page.waitForTimeout(500)
}

const browser = await chromium.launch()
try {
  for (const [label, width, height] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    page.on("dialog", (d) => d.dismiss().catch(() => {}))

    for (const [id, url] of PUBLIC) {
      try { await open(page, url); await shot(page, `${label}__${id}`, `${url}`) } catch (e) { manifest.push({ file: `${label}__${id}`, error: String(e).slice(0, 200) }) }
    }

    for (const [id, scenario] of APP) {
      const url = `/app/?mock=${scenario}`
      try {
        await open(page, url)
        await shot(page, `${label}__${id}`, url)

        if (BILLING_WORLDS.has(scenario)) {
          const chip = (await visibleButtonNames(page)).find((n) => BILLING.test(n) && !SKIP.test(n))
          if (chip) {
            try {
              await page.getByRole("button", { name: chip, exact: true }).first().click({ timeout: 3000 })
              await shot(page, `${label}__${id}--billing`, `after pressing "${chip}"`)
            } catch (e) { manifest.push({ file: `${label}__${id}--billing`, error: `could not press "${chip}": ${String(e).slice(0, 120)}` }) }
            await open(page, url)
          } else manifest.push({ file: `${label}__${id}--billing`, error: "no plan or trial button found" })
        }

        // First-visit guide: press the forward button step by step, a picture of each step.
        if (scenario === "owner") {
          for (let step = 2; step <= 6; step++) {
            const names = await visibleButtonNames(page)
            const next = names.find((n) => NEXT.test(n))
            if (!next) break
            await page.getByRole("button", { name: next, exact: true }).first().click({ timeout: 3000 }).catch(() => {})
            await shot(page, `${label}__${id}--step-${step}`, `after pressing "${next}"`)
          }
        }

        if (CRAWL.has(scenario) && label === "phone") {
          await open(page, url)
          const names = (await visibleButtonNames(page)).filter((n) => !SKIP.test(n)).slice(0, 14)
          for (const n of names) {
            try {
              await open(page, url)
              await page.getByRole("button", { name: n, exact: true }).first().click({ timeout: 3000 })
              await shot(page, `${label}__${id}--${slug(n)}`, `after pressing "${n}"`)
            } catch (e) { manifest.push({ file: `${label}__${id}--${slug(n)}`, error: `could not press "${n}": ${String(e).slice(0, 120)}` }) }
          }
        }
      } catch (e) { manifest.push({ file: `${label}__${id}`, error: String(e).slice(0, 200) }) }
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}

fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2))
const rows = manifest.filter((m) => !m.error).map((m) => `<figure><img src="${m.file}" loading="lazy" alt="${m.file}"><figcaption>${m.file.replace(/\.png$/, "")}<br>${m.note.replace(/</g, "&lt;")}</figcaption></figure>`).join("\n")
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>DPDP first visit pictures</title><style>body{font:15px system-ui;margin:16px;background:#fffdf9;color:#1c2b3a}figure{display:inline-block;vertical-align:top;margin:8px;max-width:380px}img{max-width:100%;border:1px solid #d9d3c7}figcaption{font-size:12px;color:#5a6672}</style><h1>DPDP first visit pictures</h1>\n${rows}`)
console.log(`${manifest.filter((m) => !m.error).length} pictures, ${manifest.filter((m) => m.error).length} problems -> ${out}`)
