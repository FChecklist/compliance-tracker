#!/usr/bin/env node
// W-CI follow-up (2026-09-13): file-level, process-topology-independent
// credential-redaction backstop for the e2e-env1 CI job's captured
// Playwright/server .log files (compliance-tracker#1719 / projexa#263
// follow-up).
//
// WHY THIS EXISTS. PROJEXA PR #263 added playwright/redacted-reporter.ts
// (a custom Playwright reporter + a `process.stdout`/`stderr.write`
// monkeypatch) meant to redact Supabase auth-token cookies out of
// Playwright's own TimeoutError "Call log" dumps before they reach a CI
// job's captured log. A real CI run (compliance-tracker run 34738259390,
// 2026-09-13) showed that fix did NOT fully work: a live Supabase
// auth-token cookie still appeared in plaintext in
// playwright-env1-projexa.log, inside a Call log for a timed-out
// `apiRequestContext.get('/api/module-chain')` call.
//
// ROOT CAUSE (see this fix's PR description for the full falsifiability
// writeup): projexa's playwright.config.ts runs with `workers: 3` (only
// the ct-side env1 run in this job forces `--workers=1`; the projexa-side
// run keeps the default 3). Each Playwright worker is a SEPARATE OS
// process. `redacted-reporter.ts`'s `process.stdout`/`stderr.write` patch
// is applied once, in the main/orchestrator process that hosts the
// reporters -- it has no effect on a worker process's OWN `process.stdout`
// object, which lives in a separate process's memory and can write
// directly to the shared underlying file descriptor (or otherwise reach
// the final captured log) without ever passing through the orchestrator's
// patched stream. A monkeypatch scoped to one process cannot be assumed to
// cover a multi-process test run -- confirmed via a real, local,
// multi-process repro (see this fix's PR description).
//
// THE FIX. This script is a process-topology-independent backstop: it
// operates on the log FILE's bytes after the fact, so it does not matter
// which process (main or any worker, however it wrote) produced the
// leaking line. Run it against every Playwright/server-log file this job
// captures immediately after that file is written, and BEFORE the
// "Scan Env-1 job output for leaked credentials" step (.github/workflows/
// ci.yml, e2e-env1 job) reads it -- that step remains the final gate and
// is NOT weakened by this script; this script exists so that gate finds
// nothing to catch.
//
// Patterns match (case-insensitively) the SAME credential shapes that
// scan step's own grep pattern looks for, and redact only the credential
// VALUE, not the whole line/match -- so structural context ("a cookie was
// sent", "an Authorization header was sent") stays visible for debugging.
import fs from "node:fs"

const REDACTED = "[REDACTED-BY-redact-env1-log]"

// NOTE on rule 4 below: it redacts the ENTIRE value of any cookie/
// set-cookie/authorization header LINE, not just a matched token
// substring -- deliberately broader than "only auth-token cookies", for
// two reasons: (a) it is the exact same logic
// playwright/redacted-reporter.ts's SENSITIVE_HEADER_LINE already uses in
// this same codebase (proven to work for main-process writes -- see this
// fix's PR description), applied here to the FILE instead of to a
// process's live stdout/stderr stream, so it works no matter which
// process produced the line; (b) leaving a header-name + "Bearer "/
// cookie-name fragment behind (e.g. "authorization: Bearer [REDACTED]")
// would still contain the literal substring the existing scan step's own
// grep pattern keys off of ("Authorization: Bearer "), which would make
// that step (correctly) keep failing even after the real secret is gone --
// confirmed by hand while building this fix (see PR description).
const RULES = [
  // 1. sb-<project-ref>-auth-token=<base64 GoTrue session JSON>, wherever
  // it appears (belt-and-braces beyond rule 4 below, in case it shows up
  // with no "cookie:"/"set-cookie:" prefix at all -- e.g. a bare
  // `document.cookie`-style dump). Redacts up to the next whitespace, `;`,
  // or quote, so it doesn't eat trailing unrelated cookie pairs.
  { rx: /(sb-[a-z0-9]+-auth-token=)[^\s;"'\r\n]+/gi, replace: "$1" + REDACTED },

  // 2/3. `"access_token": "<value>"` / `"refresh_token": "<value>"` --
  // GoTrue session JSON, however it got dumped (Call log body, a
  // console.log of a parsed response, etc).
  { rx: /("access_token"\s*:\s*")[^"]*(")/gi, replace: "$1" + REDACTED + "$2" },
  { rx: /("refresh_token"\s*:\s*")[^"]*(")/gi, replace: "$1" + REDACTED + "$2" },

  // 4. Any Cookie / Set-Cookie / Authorization HEADER LINE (Playwright
  // Call-log bullet style `- cookie: ...` / `- authorization: Bearer ...`,
  // or a plain header dump) -- redact the entire value. Same "however
  // Playwright/Node prefixes the line" allowance (leading whitespace, a
  // `-`/`*`/`=>` call-log bullet) as redacted-reporter.ts's own regex.
  {
    rx: /^([ \t\-*=>]*)(cookie|set-cookie|authorization)([ \t]*:[ \t]*)(.+)$/gim,
    replace: (_match, prefix, name, sep) => `${prefix}${name}${sep}${REDACTED}`,
  },

  // 5. The same 3 header names embedded inline in a single-line JSON dump
  // (e.g. `{"authorization":"Bearer xyz",...}`) -- rule 4 only matches a
  // line that STARTS with the header name, so this catches the case where
  // it's a JSON object key instead.
  {
    rx: /("(?:authorization|cookie|set-cookie)"\s*:\s*")[^"]*(")/gi,
    replace: "$1" + REDACTED + "$2",
  },

  // 6. A final, position-independent catch-all for the literal
  // "Authorization: Bearer <token>" shape wherever it occurs on a line
  // (e.g. embedded mid-line in a shell command dump, not just at line
  // start or as a JSON key) -- matches the exact phrase the scan step's
  // own grep pattern looks for, so nothing shaped like it can survive.
  { rx: /(authorization:\s*)bearer\s+[^\s"]+/gi, replace: "$1" + REDACTED },
]

function redact(text) {
  let out = text
  for (const rule of RULES) out = out.replace(rule.rx, rule.replace)
  return out
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: node scripts/redact-env1-log.mjs <file> [file...]")
  process.exit(2)
}

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`redact-env1-log: ${file} does not exist (yet), skipping`)
    continue
  }
  const before = fs.readFileSync(file, "utf8")
  const after = redact(before)
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8")
    console.log(`redact-env1-log: redacted credential-shaped content in ${file}`)
  } else {
    console.log(`redact-env1-log: no matches in ${file}`)
  }
}
