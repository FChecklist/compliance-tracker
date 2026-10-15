#!/usr/bin/env node
// Which Razorpay payment was for which PRODUCT and which VARIATION, and does our own record agree?
//
// Every product that takes money through the IT Services by Rajat Agarwal Razorpay account writes the same three labels on its Razorpay order:
//   notes.product    veridian_dpdp | corporate_tambola | startup_coach        (the receipt also starts with it: dpdp_..., pay_..., sc_...)
//   notes.variation  veridian_dpdp: <plan>_<interval> (e.g. firm_growth_year); corporate_tambola: pack_<n> | payment_test; startup_coach: startups_<n>
//   receipt          our own payment/attempt id
// This script lists the orders from Razorpay, groups them by product + variation, flags any order that carries no product label, and (for DPDP)
// compares Razorpay's "paid" orders with our dpdp.payment_ledger view, in both directions.
//
// Read-only. Keys come from the environment (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) or .env.local; they are never printed.
//   node scripts/razorpay-ledger-report.mjs [--days 30] [--json]
// DPDP comparison needs SUPABASE_ACCESS_TOKEN (Management API); without it that part is skipped and said so.
import { readFileSync, existsSync } from "node:fs"

const args = process.argv.slice(2)
const days = Number(args[args.indexOf("--days") + 1]) || 30
const asJson = args.includes("--json")

function loadEnv() {
  for (const f of [".env.local", "../.env.local", "../ct/.env.local", "C:/ct/ct/.env.local"]) {
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
    return
  }
}
loadEnv()
const KEY = process.env.RAZORPAY_KEY_ID
const SECRET = process.env.RAZORPAY_KEY_SECRET
if (!KEY || !SECRET) {
  console.error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.")
  process.exit(2)
}
const auth = "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64")

async function allOrders(fromSec) {
  const out = []
  for (let skip = 0; skip < 5000; skip += 100) {
    const r = await fetch(`https://api.razorpay.com/v1/orders?count=100&skip=${skip}&from=${fromSec}`, { headers: { Authorization: auth } })
    if (!r.ok) throw new Error(`Razorpay answered HTTP ${r.status}`)
    const j = await r.json()
    out.push(...j.items)
    if (j.items.length < 100) break
  }
  return out
}

const rupees = (paise) => (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })
const orders = await allOrders(Math.floor(Date.now() / 1000) - days * 86400)

const groups = new Map()
const unlabelled = []
for (const o of orders) {
  const product = o.notes?.product
  if (!product || Array.isArray(o.notes)) {
    unlabelled.push(o)
    continue
  }
  const key = `${product} / ${o.notes.variation ?? "(no variation)"}`
  const g = groups.get(key) ?? { orders: 0, paid: 0, paidPaise: 0 }
  g.orders++
  if (o.status === "paid") {
    g.paid++
    g.paidPaise += o.amount_paid
  }
  groups.set(key, g)
}

let dpdp = null
if (process.env.SUPABASE_ACCESS_TOKEN) {
  const sql = `select razorpay_order_id, status, amount_paise, variation, receipt from dpdp.payment_ledger where razorpay_order_id is not null and created_at > now() - interval '${days} days'`
  const r = await fetch("https://api.supabase.com/v1/projects/pcrjmlpuqsbocqfwoxod/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json", "User-Agent": "razorpay-ledger-report" },
    body: JSON.stringify({ query: sql }),
  })
  if (r.ok) {
    const rows = await r.json()
    const rzp = new Map(orders.map((o) => [o.id, o]))
    const problems = []
    for (const row of rows) {
      const o = rzp.get(row.razorpay_order_id)
      if (!o) problems.push({ kind: "our order is not on Razorpay (outside the window?)", order: row.razorpay_order_id })
      else if (o.status === "paid" && row.status !== "paid") problems.push({ kind: "PAID on Razorpay, NOT booked by us", order: row.razorpay_order_id, rupees: rupees(o.amount_paid) })
      else if (o.status !== "paid" && row.status === "paid") problems.push({ kind: "booked by us, NOT paid on Razorpay", order: row.razorpay_order_id })
      else if (o.notes?.variation && row.variation && o.notes.variation !== row.variation) problems.push({ kind: "variation differs", order: row.razorpay_order_id, razorpay: o.notes.variation, ours: row.variation })
      else if (o.receipt !== row.receipt) problems.push({ kind: "receipt differs", order: row.razorpay_order_id })
    }
    const ours = new Set(rows.map((x) => x.razorpay_order_id))
    for (const o of orders) if (o.notes?.product === "veridian_dpdp" && !ours.has(o.id)) problems.push({ kind: "Razorpay DPDP order we have no record of", order: o.id })
    dpdp = { compared: rows.length, problems }
  } else dpdp = { skipped: `Supabase answered HTTP ${r.status}` }
}

if (asJson) {
  console.log(JSON.stringify({ days, orders: orders.length, groups: Object.fromEntries(groups), unlabelled: unlabelled.map((o) => ({ id: o.id, receipt: o.receipt, rupees: rupees(o.amount), status: o.status })), dpdp }, null, 2))
} else {
  console.log(`Razorpay orders in the last ${days} days: ${orders.length}\n`)
  console.log("product / variation".padEnd(48), "orders".padStart(7), "paid".padStart(6), "paid Rs".padStart(14))
  for (const [k, g] of [...groups].sort()) console.log(k.padEnd(48), String(g.orders).padStart(7), String(g.paid).padStart(6), rupees(g.paidPaise).padStart(14))
  console.log(`\nOrders with NO product label: ${unlabelled.length}${unlabelled.length ? " (made before labels existed, or by something outside our products)" : ""}`)
  for (const o of unlabelled.slice(0, 20)) console.log(`  ${o.id}  receipt=${o.receipt ?? "-"}  Rs ${rupees(o.amount)}  ${o.status}`)
  if (!dpdp) console.log("\nDPDP comparison skipped: SUPABASE_ACCESS_TOKEN is not set.")
  else if (dpdp.skipped) console.log(`\nDPDP comparison skipped: ${dpdp.skipped}`)
  else {
    console.log(`\nDPDP: ${dpdp.compared} attempts compared with Razorpay; ${dpdp.problems.length} disagreement(s).`)
    for (const p of dpdp.problems) console.log("  " + JSON.stringify(p))
  }
}
process.exit(unlabelled.length || dpdp?.problems?.length ? 1 : 0)
