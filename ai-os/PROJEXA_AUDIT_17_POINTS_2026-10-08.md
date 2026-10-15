# PROJEXA-AI.COM — audit and gap analysis against the owner's 17 points (2026-10-08)

Method: read-only. I read the memory notes, `ai-os/PM_MASTER_PLAN_2026-10-06.md`, `ai-os/PROJEXA_OFFLINE_AUDIT_111_GAPS_2026-10-06.md`, `AUDIT_100_CHECKLIST.md` (copy in `C:\ct\ct-docs100`), and queried `platform.sumeet_requirements` live (111 rows). I did NOT re-run any test today.
Limits, stated plainly:
- GitHub was unreachable from this laptop today (`gh` timed out), so open PRs and CI state were not re-checked. Last known state comes from the 2026-10-07 notes.
- Live site check done: `https://projexa-ai.com/sw.js` answers and is stamped `b85b5795`, the merge of the user-guide PR #419.
- Google Drive / KT folder: I only listed file names in the KT folder (the `00_KT_MASTER_INDEX` versions). I did not open their contents, so KT was not cross-read. Treat point 15 as partly done.
- Percentages are my judgment from the evidence, not measured. Only merged + tested work counts as done.

## A. The 12 aims — status

| # | Aim | Proven (evidence) | Not proven / gap | Est. |
|---|-----|------------------|------------------|------|
| 1 | 100% offline | All 14 Sumeet modules open with the network cut (real Chromium). Offline pages 0.7–0.85 s; second visit 0.86 s. Offline writes queued and sent later: BOQ line edit (seen reaching Supabase), attendance, material issue/receipt, work progress, change order, timesheet. Offline creates of worker/material/task/meeting and permit/drawing/document (file kept on the laptop, sent when online) merged in projexa #417; full local run 90 pass, the 1 failure fixed and re-run 5/5. | (a) Work progress is refused offline when the project has more than one activity (`several_activities`) — a real gap in a Sumeet module. (b) First install needs internet + Supabase. (c) Safari and phone proven only by emulation (owner accepted). (d) No run in real Chrome (owner's step 3). (e) Installed-laptop update pick-up (A9/A10) not built or tested. (f) Server-only screens (budget, journal, quotation, invoice, etc.) are not Sumeet's and stay online-only. | ~75% |
| 2 | Laptop ↔ laptop sync | Two real browser contexts exchange signed rows over WebRTC (`lf-peer*` specs, delete propagation, relay-only ICE, ntfy fallback when Supabase is down). Same-org/same-role link rule tested. | Two real laptops on different networks never tried (owner accepted the simulation). PM-plan item A8 still PENDING. Peer relay of signed release bundles not built. | ~60% |
| 3 | Supabase → laptop | Proven live for the open project: a value changed on one laptop reached the other in ~50 s. First copy of 19 projects ≈38,500 rows. 28 project + 27 org kinds sync; deletes via tombstones. | Projects other than the open one refresh only hourly. Edge function session layer not tested with a second org's key. The scope query for the 2,467-line project exceeds the 8 s upstream timeout online (G-12). Real-backend run for B7 second-laptop leg still pending. | ~75% |
| 4 | Laptop → Supabase | Proven live: offline edit showed "Waiting to sync", landed in `compliance.construction_boq_line_items` ~27 s after reconnect (change-log seq 49241). | Same-field conflict was silent last-write-wins (G-14). Fixed with a version check + "keep mine / keep theirs" (ct #2114, projexa #411, merged) but NOT re-verified live. | ~75% |
| 5 | AI working on the user's laptop | Owner decision: the AI is always the user's own; nothing of ours calls a model. AI-created records go through the laptop outbox (e11 browser-AI specs). | The internal chat box exists only in the online app, not in laptop mode. An AI-created schedule task once vanished briefly during a sync round (flaky e2e); status after the train merge not individually confirmed. | ~55% |
| 6 | Internal AI (we provide it) | Chat box tested end to end with Claude Code as the test AI (`internal-ai-chat.live.test.ts`, ct #2076/#2078, seen to fail). Per-org allow flag (migration 0692). | Off by default, no org enabled, no owner toggle screen, no production model/billing decision. | ~50% |
| 7 | External AI, pasted link | Live guide answers in 0.3–0.6 s server time. ChatGPT-style fetch returns one 65 KB "reader edition" with all 15 projects and BOQs (ct #2123). A real ChatGPT run on 2026-10-07 read the guide once and showed 15 projects and the menu. Paste-card path for no-browse chats proven (3/3, DB re-read). | Zero formally recorded vendor passes (AW-905). ChatGPT only opens addresses the person types. Retest requested at end of last session (new chat, pick 15, ask for BOQ) is not done. Gemini, DeepSeek, z.ai, Grok never run. | ~70% |
| 8 | External AI via connectors | `projexa-oauth` Edge Function live; discovery chain, register, authorize, consent page and CORS verified. User guide `connect-ai.html` live. | The "Allow" click in a real Claude/ChatGPT session was never done (needs the owner's sign-in). Gemini connector untested. | ~65% |
| 9 | External AI via MCP | MCP at the link: 11/11 conformance; real Claude Code as MCP client lists projects = DB count; 16 tools incl. list/describe/run_read/make_change. | Same as 8 for a real claude.ai session. | ~85% |
| 10 | External AI via API | `/openapi.json` and `/swagger.json` validate and import; header-token mode (Link-Token / Bearer) equals path mode; token in query refused. | ChatGPT Actions retire 2026-12-11 — MCP is the path to prefer. No real vendor import done. | ~85% |
| 11 | External AI via access tokens | Revoke and expiry give 410 on guide, REST, header, MCP and card at once (11/11 live). OAuth access token is itself a 30-day work link. | Old links keep their frozen function list (94 of 141 functions): a link minted before the dictionary release cannot delete or create projects. | ~85% |
| 12 | External AI = internal AI, all work per role, no coding | Role gate tests; viewer write refused; foreign project 404; money redaction; "no code" rule in the manual and string test; level 0 = every write is a draft. | "Can do ALL the user's work" is not measured: no table maps the 111 requirements to the 141 functions. Money-sensitive create/update are not confirmed by design (owner decision). Files, PDF and WhatsApp stay with the person. | ~75% |

## B. Point 13 — Sumeet's 111 requirements (live table)

111 rows. By status text (not re-tested today): 102 read as DONE / CLOSED / VERIFIED; 9 carry a caveat that matters. The 28-item exceptions engine is closed with real-Postgres tests, live oracle agreement and a real-browser spec.

Rows needing attention:
- **R-40** Work Progress weighted subtasks: closed on earlier evidence; re-verification 2026-09-30 found the end-to-end spec blocked by infra (`mint-session-r33` returns 401 to the legacy anon JWT on the PROJEXA Supabase project). Owner decision: re-enable the legacy key or move the specs to the publishable-key scheme.
- **R-15, R-47, R-C13, R-71**: status text says "BUILT" / "CORRECTED BY CHAT" / "ALREADY IN BACKEND" / "verified in source" — no committed test + date under the 6-condition rule (R74-RULING-03). Re-check each.
- **R-96** Scope of work: PROJEXA has no screen named "Scope of Work" separate from BOQ (deliberate); owner may want a distinct view.
- **R-97** Change of scope: a note says an approved change order has no field linking it to the BOQ revision it caused (two parallel systems). The later `findApprovedChangeOrdersNeverBilled` detector refers to a "linked BOQ revision", so this may have changed — verify.
- **R-A5** Legal: closed on the owner's risk acceptance, not on a finding that no GPL/AGPL exposure exists; the disclaimer page still shows placeholder tokens for contact email, website and date.
- **R-C17** Email engine: outbound exists; inbound needs Resend Inbound configuration + an MX record per domain (owner / DNS).
- None of the 111 mentions offline, sync or AI-link behaviour: aims 1–12 are the owner's, tracked in the 100-point checklist, not in this table.

## C. Points 14–16 — what was done and what is pending

Completed and merged by 2026-10-07 (from the notes): projexa #417 (offline creates, file upload scheduler fix, release distribution, scope headers) deployed once to Vercel production (live smoke 9/9); #418 (OAuth consent page), #419 (user guide); ct #2119 (AWL person card, migration 0736), #2110 (audit-trail slice 1, migration 0730), #2121–#2123 (OAuth connector, dictionary, reader edition), #2098, #2112, #2114, #2115 (uploads). 100-point audit: 81 of 100 verified on 2026-10-06; engineering items since then are the A2 route moves (Vercel-served `/api` routes 94 → 74) and the offline/upload train.

Pending (owner-only): B1 real 6-digit sign-in on the live site; A5/A7 real-backend login specs; ChatGPT/Claude/Gemini/DeepSeek/z.ai/Grok runs (B37–B42); connector tests (B48–B50); real composers on chatgpt.com, claude.ai, DeepSeek (B52); `RESEND_API_KEY` in Vercel (invite email, B55); Cloudflare static switch (B60); orphan demo org `bc689d97` (G-04); Supabase free storage 1 GB; retention periods (lawyer); revoke the test AI link (expires 2026-10-14).
Pending (engineering): live re-run of the two-laptop conflict test; A6, A7, A8, A9, A10, A11 from the PM plan; B7 real-backend run; storage cap 100 MB per org (not built); `/workspace.txt` download (not built); G-12 slow scope query; function-vs-requirement map; owner toggle for the internal AI.

## D. Risks that cut across all aims
1. Database saturation: the live Micro database has gone unreachable before (pool full, 2026-10-02). It hits every online aim (3, 4, 7–11). Compute upgrade is an owner spend decision.
2. Process drift: this register and the 100-point checklist are copied into about a dozen worktrees. The newest copy is the single source; stale copies will mislead.
3. Vercel: owner wants near-zero; one Hobby production deploy was approved as go-live. Every merge to projexa main starts a production build — cancel unless intended.
4. Owner-run proofs are the main reason "done" stays below 100%: the product cannot prove vendor behaviour from this laptop.

## E. Recommended order
1. Owner: ChatGPT retest, claude.ai Allow click, B1 sign-in, then revoke the test link.
2. Me, once GitHub is reachable: confirm projexa/ct open PRs and main CI; re-check R-15, R-47, R-C13, R-71, R-97 under the 6-condition rule.
3. Me: fix offline work progress for multi-activity projects; re-verify conflict handling live; A6/A8 two-laptop runs.
4. Me: build the requirement-to-function map to measure "AI can do all the user's work" (aim 12).
5. Owner decisions: internal AI on/off and billing, DB compute size, legacy JWT for R-40.
