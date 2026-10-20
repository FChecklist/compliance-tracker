# PROJEXA automatic error log and AI fix workflow: gap analysis (20 October 2026)

Owner's wish, in plain words
1. Every error in real use is captured automatically, saved with a complete report.
2. Every project is watched from start to end; every error in it is saved with a complete report.
3. Every action is watched; every error in it is saved with a complete report.
4. The capturing runs on the user's own phone or laptop, not on our server.
5. The system holds all the logs. Whenever the owner decides, an AI fixes the logged errors and writes down
   what it did, with the file path and the fix. This is automatic once started. The AI is not part of the
   product; the owner uses it.

## 1. What exists today (checked 20 Oct 2026)

| Piece | State | Evidence |
|---|---|---|
| Browser error catcher | Exists but thin. Catches window errors and unhandled promise errors, keeps up to 20 unsent in the browser, sends a short, data-free line | `src/lib/local-first/client-error-report.ts`, `src/components/ClientErrorReporting.tsx` |
| Where it lands | Only as one line in the hosting provider's runtime log. Not in the database, not searchable by project, no status | route `/api/local-first/client-error` |
| Database tables | `compliance.application_errors` (route, message, stack, org, user; only server-side page errors), `compliance.activity_log` and `audit_logs` (server-side business actions), `platform.error_log` (the team's own hand-kept error register with file path and how resolved) | queried live |
| Failed API calls | Shown to the user as a message; not recorded | audit |
| What the person did before the error | Not recorded | none |
| Per-project record from start to end | Business actions exist in `activity_log`; errors and failed actions are not tied to a project | none |
| Owner screen | None | none |
| AI fix loop | Manual; the register `platform.error_log` is filled by hand by the team | none |

## 2. Gaps against the wish, and the fix in progress

| # | Gap | Fix (built by agents now, all on the user's device plus light storage) | Status |
|---|---|---|---|
| E1 | Errors are not stored with a complete report | New tables `client_log_events` (every occurrence) and `client_error_issues` (grouped by fingerprint) with message, stack, route, project, API call + status + request id, device, steps, app version | Backend agent building |
| E2 | No "what was the person doing" | Device keeps the last 30 steps (page changes, clicks by visible label, saves) and attaches them to every error; typed values are never recorded | Frontend agent building |
| E3 | Failed server calls are invisible | Device wraps every API call; each failure (error code, timeout, no network) is logged with path, method, status, the server's own message and duration | Frontend agent building |
| E4 | Actions are not monitored | Every important write (create, save, approve, delete, upload, export) logs an action with success or failed, duration and project | Frontend agent building |
| E5 | Projects are not watched start to end | Every event carries its project; a "Project timeline" screen shows actions and errors in order for one project | Frontend + backend agents |
| E6 | Work must run on the user's device | Capture, grouping (fingerprint), batching, offline keeping and retry all happen on the device; the server only stores. Limit: some server must hold the rows (see section 3) | Frontend agent building |
| E7 | Nowhere to see all logs | Owner-only "System log" screen: Open problems, Fixed, Project timeline; plain words; "Copy report" button | Frontend agent building |
| E8 | AI fix loop | Owner says one sentence to Claude Code: "Fix the open errors". Scripts pull the queue and record each fix back with file path and summary; `FIX_ERRORS.md` instructs the AI step by step | Triage agent building |
| E9 | Fix is not recorded | `record-fix` writes status fixed, summary, file paths with what changed, commit id; the Fixed tab shows it | Triage + backend agents |
| E10 | A "fixed" error that returns | The system reopens it automatically (reopened count) | Backend agent building |
| E11 | Secrets in logs | Passwords, tokens, cookies, keys stripped on the device and again on the server; request bodies never sent | Both |

## 3. Limits to know (honest)

- "Without our server" cannot be 100% true. The device does the work, but the logs have to be kept somewhere
  that survives the device. We store them in the existing database through one small save endpoint; no
  processing happens on the server.
- Errors the device never sees cannot be captured by the device: a crash before the app loads, a phone with
  no signal for ever, a person who clears their browser data before it sends. Failed server calls are still
  seen by the device, so server problems show up through the person's own failed requests.
- "AI fixes it automatically" means: capture and queue are automatic, the fix runs when the owner starts it
  (your wording: "whenever I will"). It does not run unattended.
- Volume: actions are batched every minute and errors within seconds; there is a cap per person per minute.
  A cleanup of old action rows is not included yet.

## 4. Not yet covered (second phase)

- Veridian DPDP and the Tambola/games apps (separate apps and servers). The same capture module and tables
  can be reused; they are not wired in this round.
- Server-side crashes that never reach a user (for example a nightly job). Needs a server-side logger.
- Alerts (e-mail or WhatsApp when a new serious error appears). Not asked yet.

## 5. Everything else still open from the Sumeet audit

(Details in PROJEXA_GO_LIVE_GAP_ANALYSIS_2026-10-19.md and SUMEET_111_UI_AUDIT.md.)

| Item | Status |
|---|---|
| Site-instruction form on the laptop-first variant (file box, landing on the item) | Code agent building |
| Invoice from a billing claim (R-94/R-95) | Same agent |
| R-80, R-81, R-91, R-100, R-48, R-18/13/19 UI cases, R-C08/C09, R-C12, Export PDF button, client-viewer headers on a costed BOQ | Audit agent driving live |
| Slow writes (change-tracking trigger) and the BOQ-line row rule | Needs your review, not changed |
| About 14,000 test BOQs slowing the demo organisation | Needs your yes to delete |
| R-C17 e-mail engine | Needs your Resend and MX setup |

## 6. Order and finish

1. Backend tables and API merge, migration applied, backend deployed.
2. Device capture and the System log screen merge, frontend deploys.
3. Triage scripts and `FIX_ERRORS.md` merge.
4. I trigger one fake error on the live site as the test user, confirm it appears with steps in System log,
   run the fix workflow once on it, and confirm the Fixed tab shows the file path and fix.
5. Audit agent finishes; final counts.
