# Audit 37 / E - Passcode and login (points 16-24, 36 N/A)

Read-only audit, 2026-10-04. Repo: C:\ct\projexa, branch fix/signup-already-registered-message (HEAD 72595992). Nothing was run or edited. Paths are relative to C:\ct\projexa unless stated.

## Summary
| Pt | Requirement | Status |
|---|---|---|
| 16 | 6-digit passcode | PARTIAL (built, untested) |
| 17a | Forgot passcode -> email with link + 6 digits | PARTIAL (email body unverified; very likely lacks the digits) |
| 17b | New laptop asks the code; known laptop auto-logs-in | PARTIAL (works only if the email template uses token_hash) |
| 18 | Nothing lost on reset | BUILT-UNTESTED (by design, no test) |
| 19-24 | Works-for-user first | OK with notes below |
| 36 | N/A | - |
Extras: email delivery = MISSING/owner-blocked; offline PIN login = MISSING; signup = BUILT; Supabase min length = fine for 6 digits.

## 16. 6-digit passcode - PARTIAL
- Signup: src/app/signup/page.tsx:114 - numeric, pattern [0-9]{6}, minLength/maxLength 6. HTML5 validation only; no confirm field, and type=password hides digits (typo risk).
- Reset: src/app/reset-password/page.tsx:63 rejects anything not /^[0-9]{6}$/; inputs numeric, maxLength 6 (lines 112, 123). Error reuses t("tooShort",{min:6}) - wording may say "at least 6 characters", misleading for a digits-only rule (check messages/en.json).
- Login: src/app/login/page.tsx:81 is a plain password field (no numeric keypad). Good for legacy accounts, but no PIN hint.
- Legacy accounts keep old long passwords; nothing migrates them.
- Unknown: whether the PROJEXA Supabase project (evpckeuxgvahguwsaeul per .env.local) enforces password-strength rules (letters+digits). If so, numeric-only is rejected with 422 and the user sees Supabase's raw message. Min length 6 matches the Supabase default.
- Tests: none for the PIN. src/app/forgot-password/password-recovery-route.test.ts is source-grep only and predates the PIN commits.

## 17a. Email with link + 6 digits - PARTIAL
- Request: src/app/forgot-password/page.tsx:46-47 calls resetPasswordForEmail with redirectTo=/auth/callback?redirectTo=/reset-password. Line 58 stores localStorage "projexa_recovery_email" (marker: this laptop asked). Anti-enumeration wording kept.
- The email body is NOT in any repo. No mailer template, ConfirmationURL or {{ .Token }} in projexa or C:\ct\ct (scripts/, supabase/, ai-os). scripts/dpdp/set-auth-smtp.mjs (commit 46af6d76) says it "does not touch the email templates". So production most likely sends Supabase's default recovery mail: a ConfirmationURL link only, no 6-digit code. Requirement 17 is therefore probably unmet.
- Fix: set the recovery template (dashboard or Management API mailer_templates_recovery_content) to include {{ .Token }} plus a link {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&redirectTo=/reset-password.

## 17b. New laptop vs known laptop - PARTIAL
- Logic: src/app/auth/callback/page.tsx:32-38 (isRequestingMachine), 88-90 (recovery token_hash without marker -> needsCode), 158-170 (verifyOtp email+token type recovery -> /reset-password), 91-96 (marker present -> verifyOtp(token_hash) -> auto sign-in). Code and link are the same Supabase OTP; design is sound.
- Gaps:
  1. With the default template the link arrives as ?code= (PKCE) or #access_token, which callback handles BEFORE the needsCode branch (lines 76-87), so that branch is dead code. On another machine exchangeCodeForSession fails (no code verifier) and the user sees "Sign-in link could not be used" - a dead end, not the code form.
  2. "Same user/laptop" is approximated by "any recovery request was ever made in this browser". The email in the link is not compared with the stored one and the marker is never cleared, so a later link for a different account also auto-signs-in. Acceptable under "security not a priority", but not literally "recognises the same user".
  3. Mail-scanner prefetch can burn the single-use token before the user clicks (not handled).
- Tests: none for needsCode or verifyOtp.

## 18. Nothing lost on reset - BUILT-UNTESTED
- Reset uses auth.updateUser({password}) (reset-password/page.tsx:73) on the same auth user: user id, org membership and server data unchanged. Local offline data is keyed per user id (projexa-local:<userId>) and sign-out keeps it by default, pending outbox edits always survive (src/lib/local-first/sign-out.ts header). A reset touches none of it.
- On a NEW laptop, server data re-syncs via mandatory workspace preparation (commit fc3f4370); unpushed edits on the old laptop stay there until it is online. Untested.
- Duplicate-signup is blocked with a clear message (signup/page.tsx:42), so no account/data split.

## 19-24. Works-for-user first
- Good: durable sessions never sign out on refresh failure/offline (src/lib/supabase/durable-auth.ts); sign-out keeps the local copy; 6-digit PIN is weak but owner accepts.
- Gates that can block usability: (a) Supabase built-in mailer limit (memory: rate_limit_email_sent=2/hour per project) - the 3rd reset/signup email fails with 429; forgot-password shows only err.message. Biggest practical risk. (b) Email confirmation deferral at signup (signup:50-56, callback:121-140) needs working mail. (c) Default Supabase SMTP may only deliver to team-member addresses - real customers may receive nothing.

## Email delivery path - MISSING / OWNER-BLOCKED
- Per memory dpdp-single-mailbox-state-2026-09-29.md and C:\ct\ct\HANDOFF_FOR_RAJAT.md: Resend is verified for veridian-aios.com (send+receive, DMARC) and used by DPDP/Edge functions. Supabase Auth mail still uses the built-in mailer; set-auth-smtp.mjs --apply is owner-only and was not applied as of 2026-09-30 (live state not re-checked today). That script targets project pcrjmlpuqsbocqfwoxod; PROJEXA auth is a different project (evpckeuxgvahguwsaeul) so it would not fix PROJEXA mail. No Postmark anywhere.

## Offline login with PIN - MISSING
- Login is online-only (login/page.tsx:26 signInWithPassword); no local PIN verifier exists. A laptop that is still signed in opens offline via the identity mirror with no PIN prompt (src/lib/local-first/identity.ts header). After an explicit sign-out the local copy is kept but sign-in offline is impossible. So "known laptop logs in offline with the PIN" is true only in the stay-signed-in sense.

## Signup - BUILT
- signup/page.tsx: org + email + PIN; user_already_exists message (commit 1449b6f4); deferred provisioning via /api/org/provision, finished in callback. No PIN confirmation field.

## Proof tests (Playwright, commit under e2e/)
Needs an inbox the test can read (Supabase local Inbucket/Mailpit or Resend API) and a dev project with the recovery template configured.
1. pin-signup: /signup, "12345" blocked by pattern; "123456" accepted; then /login with 123456 reaches /dashboard.
2. reset-same-laptop: /forgot-password; assert localStorage projexa_recovery_email set; read email, assert it contains a 6-digit number AND a /auth/callback?token_hash=...&type=recovery link; open link in the same context -> lands on /reset-password with no prompt; set 654321 twice -> /dashboard; sign out; login 654321 works, old PIN fails.
3. reset-new-laptop: fresh browser context -> open link -> "Confirm it is you" form; wrong code shows alert; correct email+code -> /reset-password -> new PIN -> /dashboard.
4. data-preserved: create a BOQ row offline (pattern from e2e/boq-offline.spec.ts) plus a server row; run flow 2; assert both rows present and IndexedDB projexa-local:<userId> and its outbox intact.
5. offline-known-laptop: sign in, setOffline(true), reload -> shell opens; sign out (keep copy), still offline, attempt login -> documents the gap.
6. rate-limit: three resets in a row -> friendly message, not raw error.

## Priority fixes
1. Configure the PROJEXA project's recovery template with {{ .Token }} and a token_hash callback link.
2. Custom SMTP (Resend) on evpckeuxgvahguwsaeul (owner-run).
3. Verify password-strength setting allows numeric-only; add a PIN-specific error string.
4. Add confirm-PIN to signup and a numeric keypad on login.
5. Optional offline PIN sign-in (salted hash in the identity store).
6. Commit tests 1-6.
