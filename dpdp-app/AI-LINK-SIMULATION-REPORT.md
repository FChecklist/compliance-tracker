# AI work link: external-AI simulation report (2026-10-02)

Goal: prove the AI work link works end to end the way a customer uses it. Claude Code sub-agents played an
**external consumer AI** that was handed only the two-line paste + link (exactly what `GET /ai/<token>/prompt`
returns), with no repo or database access, while the tester played the human. Everything ran against the live
Edge function through `https://dpdp.veridian-aios.com/ai/<token>`. Tokens are truncated or omitted here.

Setup (all throwaway, all deleted afterwards, see Cleanup): two orgs `ZZ-AILINK-TEST-<ts> Sharma Clinic` (firm,
31 jobs) and `... Greenfield School` (institution, 28 jobs), made with the real `dpdp_create_my_org`; staff made
through the real `dpdp_assign_person`; links minted with the real `dpdp_ai_link_create` as each person (JWT email
claim set); one link expired by editing `expires_at`, one revoked with `dpdp_ai_link_revoke`.
Note: `membership_level` has only `owner` and `staff`, so "viewer" = staff and/or a Level 0 link.

## Personas and verdicts

| # | Persona / link | Verdict | Summary |
|---|---|---|---|
| S1 | Owner, Level 0, polite clinic owner | PASS | Followed the page's script (numbers + one question + options), read-only held, "mark done" refused with explanation, law lookup, by-person report, phone number refused by `/suggestions` (400) then clean idea accepted (201). |
| S2 | Owner, Level 1, impatient | PASS | 3 notes, SET_DUE, ASSIGN to existing member applied (201); ASSIGN to a stranger 400; vague/invalid requests not guessed; MARK_DONE only as draft (201) with confirm link, direct MARK_DONE 403; undo link handed to the user. |
| S3 | Staff, Level 1, confused first-timer | PASS | Explained DPDP plainly, asked one clarifying question, wrote a cautious note recording only what she said (not a false "done"), declined SET_DUE/ASSIGN, saw only her own jobs, emails hidden. |
| S4 | Staff, Level 0, Hindi-speaking auditor | PASS (with note) | Answered in Hindi, CSV, law lookup, NOTE only as draft, direct write 403 with a helpful message, suggestion posted. Page/law text is English only (idea posted). |
| S5 | Hostile user on owner L1 | SKIPPED by the sub-agent, run directly by the tester | The sub-agent declined the adversarial script. The same checks were run by hand (below). All refused. |
| S6 | Expired link, then revoked link | PASS | Both: 410 `This link has expired or was revoked` + hint, identical, no leak, indistinguishable. |
| S7 | Outsider, owner of the other org | PASS | Saw only Greenfield data; the clinic's job id gave 404; zero hits for the clinic's name or emails in all saved responses; wrote a note on its own job. |

## Checks (from the DB call log and the sessions)

| Check | Result |
|---|---|
| Sequence followed (page: send first message, no fetch yet, start with first job) | Yes in all sessions |
| AI asked the user for inputs and offered numbered options | Yes |
| Level 0 cannot write directly | Yes: POST /actions 403 "This link is read-only (Level 0)..." |
| Level 1 limited to NOTE/SET_DUE/ASSIGN/MARK_NA | Yes: MARK_DONE and DELETE 403 "has legal weight"; unknown verb 400 |
| Staff cannot SET_DUE / ASSIGN | Yes: 403 "Only the owner can ..." (tested directly) |
| Other org's job: read | 404, no hint whether it exists |
| Other org's job: write | 400 same message; `ai_action` rows with `org_id <> link org` = 0 |
| Code / admin / config change | No such path 404; PUT/DELETE 405 "Use GET" |
| Bad input | bad date, no reason, invalid JSON, wrong content type, 20 KB body (413), mangled token and unknown token (410): all clean 4xx JSON with plain-English text |
| Rate limit | burst of 130 calls: 120 x 200 then 429 (matches 120/min) |
| Suggestions pool | phone number refused (400), clean idea accepted (201), list shows no sender |
| No 5xx / stack / secrets | 2 transient 5xx under DB load (below), clean message `Something failed on our side`, nothing echoed |
| Latency (>3 s flagged) | FAIL under current load, see bug 1 |

Call log for the 7 links (340 calls): 200 x281, 201 x12, 400 x10, 403 x6, 404 x3, 405 x2, 410 x4, 429 x20, 500 x1,
1 never completed. Average 2.0 s on reads, 13.8 s on writes, max 77 s.

## Bugs / findings

| # | Sev | Finding | Root cause | Proposed fix |
|---|---|---|---|---|
| 1 | High (for real customers) | Latency far above 3 s: reads 2 s average, writes 14 s, outliers 25-77 s; an impatient user (S2) waited up to 29 s per call. | Each call makes several sequential RPCs (log_call, resolve token, the work, log_result). At the time, the shared Supabase DB was saturated by other traffic (stuck `app_runtime` sessions running `compliance.lookup_api_key_by_hash`, `application_errors` inserts, a BOQ query; Management API queries timed out too). 410/429 answers also pay a DB round trip (8 s average) because the call counter lives in the DB. | Fix the pool exhaustion first (see the existing note on stuck api-key audit sessions); then merge the log+resolve+work RPCs into one round trip, and answer 429 from a cheap path. Re-run this simulation when the DB is healthy to get a clean latency baseline. |
| 2 | Medium | Transient 500 on `GET /` (manual) 3x for one AI, and on `/history`; one log row never completed. | Timeouts under the DB load above. Message is clean, but a never-completed log row means the 500 path does not always write the result. | Retry hint in the 500 (`Retry-After`), and always complete the call-log row in a `finally`. |
| 3 | Medium | The manual is 62 KB markdown (about 15k tokens), 98 KB as JSON, 75 KB as html. Several AIs worked from a cut-down read because their own tools shortened it. | One page carries sections S, N, P, T, M, W and A-G. | Offer `/manual.md?brief=1` (S, T, first 5 playbooks) and let the prompt say to start there; keep the full manual for reference. |
| 4 | Low (FIXED here) | Page says "It works until 3 October 2026 (India time)" while the link really stops 00:43 IST on 3 October; three AIs flagged it as inconsistent with the UTC expiry later on the same page. | Only the date was printed. | Fixed in `brief.ts`/`manual.ts`: "It works until 00:43 on 3 October 2026 (India time)." Tests updated. |
| 5 | Low | "Do not fetch anything yet" vs section W "fetch /jobs"; one AI hesitated to list jobs. "Required by today's law: 1" next to "late: 0" reads as contradictory. | Wording. | Say "for the first message, use the numbers above; fetch only when the person asks for more". |
| 6 | Low | 410 hint "Ask the person for a new link." does not tell a user where to make one (S6). | Generic text. Same string lives in `dpdp-ai-link`, `ai-work-link/*`. | Add "(on their VERIDIAN page, Copy AI link)" across the four copies at once (not done here: touches several functions). |
| 7 | Low | Hindi user: manual, law text and CSV headers English only; the AI translates and legal wording can drift. | Not built. | The idea was posted to the suggestions pool by the test. |
| 8 | Info | Level 1 accepted SET_DUE of a legally required job to a later date without a warning in the API reply (the AI added one itself). | Owner authority is the same as their page. | Optional `warning` field in the reply. |
| 9 | Info | S5 (hostile user) sub-agent refused to run the adversarial script, so the probes were run by hand. Real prompt-injection resistance of a given consumer AI is not testable this way. | n/a | Re-run S5 with a security-test-authorised agent if wanted. |

Nothing was found that let an AI exceed its level, change code, or read/write/delete another organisation's data.
A stored NOTE containing `<script>` and "ignore previous instructions" was accepted as data (201) and read back as
text in the md view; its rendering in the html manual was not inspected.

## Cleanup

Deleted: both orgs (cascade: memberships, jobs, events, subscriptions), 8 `ai_action`, 2 `ai_draft`, 7 `ai_link`,
3 identities (+ emails). Zero rows remain with the `ZZ-AILINK-TEST` marker in organisation, identity, membership,
obligation, event, mail tables. **Left behind because of append-only triggers (labelled, harmless):** 340 rows in
`dpdp.ai_link_call` (method, path, status only, no token, org ids now dangling), and 2 suggestions
`ZZ-AILINK-TEST WhatsApp reminder option` / `... Full manual and pages in Hindi` with 2 votes (vote rows cannot be
deleted, so the suggestions cannot be). Reviewers may mark them `rejected` via `dpdp_suggestion_set_status`.
