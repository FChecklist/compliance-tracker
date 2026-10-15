# PROJEXA — plan to close every gap (2026-10-08)

Source of gaps: `PROJEXA_AUDIT_17_POINTS_2026-10-08.md`. Order is fixed by the owner: LOCAL -> LOCAL + SUPABASE -> LOCAL + SUPABASE + GITHUB. One train branch per repo (projexa, compliance-tracker), one PR each, one CI run, one squash merge. Local commits are free; nothing is pushed until Stage 3. One heavy job at a time (lock `C:\ct\heavy.lock`, free RAM > 1.2 GB).

## 0. New sign-in design (owner's point 8) and how it differs from today

Today (projexa `src/app/login/page.tsx`, `lib/local-first/offline-pin.ts`, `auth/callback`, `forgot-password`): the user picks a 6-digit passcode as a password; reset = e-mail link + 6 digits.

Owner's design, as I read it:

| Case | Behaviour |
|---|---|
| New e-mail, first time ever | Page opens, user types e-mail, submits. Account is created. A 6-digit code is e-mailed. Typing the code signs in. No separate verification link or step. |
| Existing e-mail, same machine | Browser keeps the sign-in. Opens straight in. Install is already there. Sync is automatic. Nothing is announced. |
| Existing e-mail, new machine | Same as a new e-mail: e-mailed 6-digit code, then signed in. |
| Forgot | Same e-mailed 6-digit code. |
| Password | None. The user remembers only the e-mail. |
| Background install | Starts the moment the e-mail is submitted. The user is never told. |

Decisions I am making unless the owner says otherwise (flagged because points 4 and 7 were blank):
- D1. "Without verification" = no extra verification link or screen; the e-mailed code is the only check. I will not skip the code.
- D2. Pre-sign-in download = only the public app shell (release bundle, same for everyone). Organisation data is copied only after the code is accepted. Reason: data copied before anyone proves the e-mail would hand one organisation's data to whoever types its address. This is the one place I will not follow the wording literally.
- D3. A brand-new e-mail has no organisation yet: the account opens an empty workspace; joining an organisation is by invite (already built, B6/B56).
- D4. The 6-digit code is single-use, expires in 10 minutes, 5 wrong tries lock it for 15 minutes; one new code per minute. Low security is the owner's rule, these are the minimum to stop guessing 1,000,000 combinations.
- D5. Offline: a machine that already signed in keeps working offline with no code; a code needs a connection (it is e-mailed).
- D6. The old chosen-passcode screens (`offline-pin.ts`, forgot-password) are retired; people who had a passcode are signed in by the same e-mail-code flow, nothing lost.

## 1. Work packages (common gaps clubbed; each package is one unit of work)

| Pkg | Closes | What |
|---|---|---|
| P1 Sign-in | point 8, B1, A16-A18, A20, A22, A24, B2-B4 | E-mail-only form; Supabase Auth OTP (6 digits, `signInWithOtp` + `verifyOtp`, user created on first use); remove password field; trusted-machine storage; background shell install on submit with no UI; role/org attach after code; Resend template with the code only. Tests: new e-mail, same machine, new machine, wrong/expired/reused code, rate limit, offline reopen, second user on one laptop (B12). |
| P2 Offline write gaps | aim 1, G-15, Sumeet R-C08-R-C10 | Offline work progress for projects with several activities (remove `several_activities` refusal: choose activity on the laptop); confirm every Sumeet-module create/edit/delete works offline; real Chrome run. |
| P3 Sync correctness | aims 2-4, B7, G-12, G-14 | Keep-mine/keep-theirs re-verified live; refresh all projects not only the open one (hourly -> every few minutes by change feed); scope query over 8 s (index/limit, `include=headers`); two-laptop online, offline, and conflict runs; laptop-to-laptop A8; second-org through Edge session layer and data-service key (A7). |
| P4 Update pick-up | A9, A10, B13 | Installer hook after `manifestDigestOk`, `RELEASE_ORIGIN` in projexa-sync, peer relay of signed bundles; installed laptop picks up the next release keeping data. |
| P5 AI function coverage | aims 5, 11, 12, R-97 | Build the table: each of the 111 requirements -> the AI function(s) that do it, find the missing ones, add them; refresh function lists on old links (mint-time freeze); confirm "cannot code" for every function; verify R-97 change-order <-> BOQ-revision link. |
| P6 Internal AI | aims 5-6, A11 | Owner switch screen per organisation; chat box in laptop mode; AI-off message; usage metering stub. Model and billing remain an owner decision. |
| P7 External AI proofs | aims 7-11, B37-B54 | Scripted runs for each engine with a fresh link; record in the register (AW-905); Claude connector Allow flow; ChatGPT retest; Gemini/DeepSeek/z.ai/Grok. These need the owner's accounts, so I prepare scripts, expected results and a recorder, owner presses the buttons. |
| P8 Sumeet register | 111 rows | Re-check R-15, R-40, R-47, R-71, R-96, R-97, R-C13 under the 6-condition rule (committed test, real surface, seen to fail, SHA, persisted re-read, recorded). Fix the disclaimer placeholders (R-A5). R-C17 inbound e-mail needs owner DNS. |
| P9 Infra and cost | risk D1, B55, B60 | DB connection saturation guard; storage cap 100 MB per organisation; `/workspace.txt`; Resend key; static host switch. Spend items are owner-only. |
| P10 Records | points 14-17 | One register file, one memory note, KT index row; stale copies of the checklist replaced by one. |

## 2. Stages and gates

**Stage 1 — LOCAL (no network)**
Order: P1 first (everything else logs in through it), then P2, P3 code, P4, P5, P6, P8 fixes. Build on the existing train branches: projexa `train/login-and-gaps-2026-10-08` off main; compliance-tracker `train/projexa-gaps-2026-10-08`.
Local run: compliance-tracker :3000 + projexa :3110, local Supabase not available (no Docker), so unit and PGlite tests run locally and live-Supabase reads are Stage 2.
Gate 1: every package's tests pass with `--isolate`, each new test seen to fail on a planted break then restored; local-first Playwright suite run once, one worker pair; restricted `tsc` on changed files.

**Stage 2 — LOCAL + SUPABASE**
Apply migrations (e.g. OTP rate-limit table, function-coverage fixes) one at a time with a cited authorisation, verify, log to `platform.claude_log`; deploy changed Edge functions under the deploy locks (`projexa-sync`, `ai-work-link`, `projexa-oauth`, `projexa-api`); SMTP template via the Management API.
Run against live Supabase from the local build: P1 new/existing/new-machine/forgot with throwaway users (deleted after), P3 two-laptop and conflict runs, A7, B7, P5 live link checks, P7 scripts with a fresh link.
Owner-only steps are listed and left; I never type owner passwords. For P1 the throwaway mailbox is read through the Gmail MCP, not the owner's real inbox.
Gate 2: live checks recorded with timestamps; Sumeet rows closed only under the 6-condition rule.

**Stage 3 — GITHUB**
Push each branch once, one PR per repo, one CI run; read failures from job logs, fix locally, push once more at most. Merge on green (Amendment 001). Merging projexa main starts a Vercel build — the owner approved one go-live deploy; I will ask before the next one because of the "zero Vercel" rule. Then run live smoke (`live-site-smoke`), and update records.

## 3. Estimated effort (my estimate, not a promise)
Stage 1 about 2 working days of agent time (P1 half a day; P3 and P5 largest); Stage 2 about 1 day plus owner-run proofs; Stage 3 half a day. The calendar is set by the owner-only runs in P7 and by GitHub/network reliability on this laptop.

## 4. Owner-only (cannot be closed by me)
Engine runs and connector Allow clicks; real passcode/e-mail sign-in on the live domain with the owner's own mailbox; Resend key in Vercel; DB compute size; Cloudflare static switch; DNS/MX for inbound mail; retention periods (lawyer); orphan demo org; internal AI billing.

## 5. Questions for the owner (answer before Stage 1 starts)
1. D2: agree the data copy waits until the code is accepted (only the public shell downloads on submit)?
2. Point 5 says "password is the e-mail id": confirm there is no chosen password or passcode anywhere, so existing 6-digit passcodes are retired (D6).
3. Points 4 and 7 were blank: anything to add?
