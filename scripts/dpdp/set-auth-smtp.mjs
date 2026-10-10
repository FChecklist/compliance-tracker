#!/usr/bin/env node
// Sends the DPDP app's sign-in emails through Resend instead of Supabase's built-in mailer (owner, 2026-09-30).
//
// WHY: Supabase's built-in mailer only delivers to addresses that belong to the project's own team and is capped at a handful of emails an hour, so
// a customer who is not on that list never receives their sign-in link. Resend (already verified for veridian-aios.com, sending + receiving) has no
// such limit on the address; it has its own daily cap (see the Resend plan).
//
// WHAT IT CHANGES: the Auth settings of Supabase project pcrjmlpuqsbocqfwoxod, through the Management API (the same fields as Dashboard >
// Authentication > Emails > SMTP Settings): smtp_host, smtp_port, smtp_user, smtp_pass, smtp_admin_email, smtp_sender_name, and optionally
// rate_limit_email_sent. Nothing else. It does not touch the email templates.
//
// BLAST RADIUS -- read before running: that Supabase project is shared. Every app that signs people in with it (this one, and the compliance-tracker
// web app) will from then on send its sign-in emails from dpdp@veridian-aios.com with the sender name below. That is why this is a script the OWNER
// runs, with the owner's own keys, after choosing to; no Claude session sets it on the owner's behalf. Dry-run is the default and changes nothing.
//
// USAGE (PowerShell or bash; keys come from the environment, never from the command line or a file in this repo):
//   SUPABASE_ACCESS_TOKEN   a Supabase personal access token (Dashboard > Account > Access Tokens)
//   RESEND_API_KEY          a Resend API key with "Sending access" for veridian-aios.com (used as the SMTP password)
//
//   node scripts/dpdp/set-auth-smtp.mjs                 # dry run: shows current settings and exactly what would change
//   node scripts/dpdp/set-auth-smtp.mjs --apply         # makes the change, then reads it back to confirm
//   node scripts/dpdp/set-auth-smtp.mjs --apply --rate-limit 30    # ...and lets 30 sign-in emails an hour go out (default when SMTP is custom: 30)
//   node scripts/dpdp/set-auth-smtp.mjs --revert-note   # prints how to go back to the built-in mailer
//
// The script never prints a key. To go back, run with --revert-note (or clear the SMTP host in the Dashboard); Supabase does not return the old
// password, so the previous values printed by the dry run are the ones you would type back.

const REF = process.env.SUPABASE_PROJECT_REF || "pcrjmlpuqsbocqfwoxod"
const API = `https://api.supabase.com/v1/projects/${REF}/config/auth`
const SMTP = { smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_admin_email: "dpdp@veridian-aios.com", smtp_sender_name: "VERIDIAN DPDP" }

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const rateIx = args.indexOf("--rate-limit")
const rateLimit = rateIx >= 0 ? Number(args[rateIx + 1]) : 30

if (args.includes("--revert-note")) {
  console.log(
    [
      "To go back to Supabase's built-in mailer:",
      "  Dashboard > Authentication > Emails > SMTP Settings > turn 'Enable custom SMTP' off > Save.",
      "or PATCH the same endpoint with { smtp_host: null, smtp_port: null, smtp_user: null, smtp_pass: null, smtp_admin_email: null, smtp_sender_name: null }.",
      "Sign-in emails then only reach the project's team members again, at the built-in hourly cap.",
    ].join("\n"),
  )
  process.exit(0)
}
if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 1000) fail("--rate-limit must be a whole number from 1 to 1000")

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) fail("SUPABASE_ACCESS_TOKEN is not set (a Supabase personal access token).")
const resendKey = process.env.RESEND_API_KEY
if (apply && !resendKey) fail("RESEND_API_KEY is not set (needed as the SMTP password when --apply is used).")
if (apply && !/^re_[A-Za-z0-9_]{10,}$/.test(resendKey)) fail("RESEND_API_KEY does not look like a Resend key (they start with 're_').")

function fail(msg) {
  console.error(`set-auth-smtp: ${msg}`)
  process.exit(1)
}

async function call(method, body) {
  const res = await fetch(API, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) fail(`${method} ${API} -> HTTP ${res.status}. ${redact(text).slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

// A key must never reach the log, even inside an error message.
function redact(s) {
  let out = String(s)
  for (const secret of [token, resendKey]) if (secret) out = out.split(secret).join("[redacted]")
  return out
}

const show = (c) => ({
  smtp_host: c.smtp_host ?? null,
  smtp_port: c.smtp_port ?? null,
  smtp_user: c.smtp_user ?? null,
  smtp_pass: c.smtp_pass ? "(set, hidden)" : "(not set)",
  smtp_admin_email: c.smtp_admin_email ?? null,
  smtp_sender_name: c.smtp_sender_name ?? null,
  rate_limit_email_sent: c.rate_limit_email_sent ?? null,
})

const before = await call("GET")
console.log(`Project ${REF} -- current sign-in email settings:`)
console.log(show(before))

const wanted = { ...SMTP, rate_limit_email_sent: rateLimit }
const changes = Object.entries(wanted).filter(([k, v]) => String(before[k] ?? "") !== String(v))
console.log(changes.length === 0 && before.smtp_pass ? "\nNothing to change: SMTP is already set as wanted." : "\nWould set:")
for (const [k, v] of changes) console.log(`  ${k}: ${before[k] ?? "(empty)"}  ->  ${v}`)
console.log("  smtp_pass: (your RESEND_API_KEY, hidden)")

if (!apply) {
  console.log("\nDry run only. Nothing was changed. Run again with --apply to make the change.")
  process.exit(0)
}

await call("PATCH", { ...wanted, smtp_pass: resendKey })
const after = await call("GET")
console.log("\nApplied. Settings now:")
console.log(show(after))
const ok = Object.entries(SMTP).every(([k, v]) => String(after[k] ?? "") === String(v)) && !!after.smtp_pass
console.log(ok ? "\nOK -- sign-in emails now go through Resend. Send yourself one from the sign-in page to confirm it arrives." : "\nWARNING: read-back does not match what was set. Check Dashboard > Authentication > Emails.")
process.exit(ok ? 0 : 2)
