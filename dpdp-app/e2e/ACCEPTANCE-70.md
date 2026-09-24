# The 70 acceptance checks, as Playwright (WO-DPDP-011 Step 6)

WO-DPDP-010 defined acceptance as "the spec's 70 behaviour checks ... run
against the spec file with jsdom (`tlaw` 18, `tfirst` 28, `troles2` 24)". Those
jsdom files were never committed. WO-DPDP-011 Step 6 asks for each check to be
rewritten as a Playwright test against the real app, one test per check, all
70 passing before merge.

`acceptance-70.spec.ts` is that suite: exactly 70 tests, `LAW-01..18`,
`FIRST-01..28`, `ROLES-01..24`, in three `describe` blocks, each title quoting
the behaviour in the spec's own words. This file is the derivation: since the
original checks are gone, every one below is derived from the spec itself --
`dpdp-app/spec/veridian-dpdp.html`, the owner's one-page product spec, copied
into the repo byte-for-byte (sha256
`00C697A77FB0F802DDE51D4E285E6888993E6D932A14D52AF87D83D7A8159F16`) so a
future check can cite a line of it. Line numbers below are that file's.

The suite runs the same way as `agent-by-role.spec.ts` and
`step5-by-role.spec.ts`: the BUILT site (`dist/`, `vite preview`) in mock mode
(`VITE_MOCK=1`), every locator by `getByRole` / `getByLabel` / `getByText` /
`getByTitle` and an accessible name -- no CSS selector, test id or XPath. CI
(`.github/workflows/dpdp-app-ci.yml`, job `dpdp-app-e2e`) runs every spec in
`e2e/`; `bunx playwright test --list` shows 91 tests in 3 files, 70 of them
this suite's.

## The mock: who you are, and which world you are in

`src/lib/mock-client.ts` (v4) stands in for the `public.dpdp_*` RPCs. Two
things changed for this suite; neither touches the real client
(`src/lib/client.ts` only ever constructs the mock when `VITE_MOCK=1`).

**The fixture is the spec's own job library.** `LIBRARY.firm` (31 jobs) and
`LIBRARY.institution` (28 jobs) are `LIB.firm` / `LIB.institution` from the
spec (lines 306-367), verbatim: part, wording, area, due-in days, data set,
data types, law codes, the group flag and the sign-off chain. Every number the
suite asserts is derived from that library, and `src/lib/mock-client.test.ts`
pins each derivation in the unit layer (which `bun test` runs), so a fixture
change fails there first, naming the number that moved.

**Who you are is the sign-in address** (the mock's `PERSONAS` table -- a real
magic link carries exactly that). **Which world you are in is
`?mock=<scenario>` on `/app/`**: it seeds a fresh fixture, discards stored
state, and signs the scenario's persona in directly (no 1.5 s inbox wait). A
plain form sign-in with no `?mock=` keeps whatever state is stored, so one
test can sign out and back in as another persona against the same org, the way
a real day goes. Reloading a `?mock=` URL re-seeds; `page.goto("/app/")`
(no query) is how a test proves something PERSISTED.

| `?mock=` | signed in as | world |
|---|---|---|
| `owner` | owner@example.test (owner) | **fresh**: nothing named but the sign-off chain; the owner's first visit is the 3-step wizard |
| `client-owner` | client-owner@example.test (owner) | **CA set it up**: the live assignment, made by partner@example.test, owner not yet confirmed -- the review screen |
| `owner-live` | owner@example.test (owner, first visit seen) | **live**: set up -- 9 areas named, 3 people in "All staff", 5 jobs done, 1 "doesn't apply", 1 with nobody, 3 late |
| `partner` | partner@example.test (CA partner) | live; on the chain's "CA partner signs the file"; one client, Mehta Traders |
| `manager` | manager@example.test (CA manager) | live; "CA manager checks the proof"; the same client |
| `go` | go@example.test (Grievance Officer) | live; the 4 GO-area jobs |
| `coord` | coord@example.test (DPDP coordinator) | live; the 1 Accounts job |
| `staff` | staff@example.test (staff) | live; the 4 Customer-data jobs; NOT in the group |
| `member`, `member2`, `member3` | (staff) | live; the "All staff" group only |
| `hr` | hr@example.test (staff) | live; the 5 Staff-records jobs |

The live world, in numbers (all pinned by `mock-client.test.ts`): 31 jobs, 30
live (Payroll firm n/a), 5 done (naming the GO, naming the coordinator, and
three more), so the seal reads **5 of 30 / 17%**; chips All 31 · Mine 1 · Not
done 25 · Late 3 · Required today 9 · Nobody named 1 · Done 5; parts 2/3, 2/7,
0/6, 1/5, 0/3, 0/3, 0/3; 12 jobs carry "⚡ required today"; the group job has 3
members; Mehta Traders is "4 of 31 done, In progress".

A real client org exists too (`org-mehta`), so a CA's **Open** lands on a
different page (`ROLES-17`), and every client a CA adds becomes its own org
with its own 31 (firm) or 28 (school) jobs.

## tlaw -- 18 checks on the law and date labels

All on `?mock=owner-live` (the full table). "Spec" cites
`spec/veridian-dpdp.html`.

| id | spec | what is asserted |
|---|---|---|
| LAW-01 | `LAWS.s` 381: "IT Act §43A and SPDI Rules 2011 — in force TODAY, until 13 May 2027"; `lawCell` 384-388 | 11 tags carry that exact title (the 11 firm jobs with an `s:` code); the first reads "SPDI R5(9)"; the privacy-policy row's reads "SPDI R4" |
| LAW-02 | `LAWS.d` 381: "DPDP Act 2023 and Rules 2025 — in force from 13 May 2027"; refs joined with " · " (387) | 27 tags (every job but the four `g:`/`s:`-only ones); "Name the Grievance Officer" reads "DPDP §8(9) · §8(10)" |
| LAW-03 | `LAWS.a` 382: "Aadhaar Act 2016 — in force today"; LIB.firm 324 `a:§29` | exactly one, "Aadhaar Act §29", on "Mask Aadhaar copies" |
| LAW-04 | `LAWS.g` 382: "Not a legal duty — it keeps the work moving"; 337-338 `g:` on the CA chain | 3 tags; "Good practice" on "CA manager checks the proof" and "CA partner signs the file" |
| LAW-05 | `isToday` 389 (`s`/`a` only), `nowlaw` "⚡ required today" 388 | 12 pills, under the privacy-policy row, under no `g:`-only or `d:`-only row |
| LAW-06 | `lawCell` 386 sort order `'asdg'` | row text reads SPDI/Aadhaar before DPDP before the ⚡ line, on three rows |
| LAW-07 | chips 643-645 with `cnt` 634-635; `filt` 500-502 | the seven chips with their counts; "Required today" shows the privacy-policy row and hides `g:`/`d:`-only rows |
| LAW-08 | `SENS` 383, `.dt.sens` 157 `#9E2620`: "red data types are sensitive — stricter rules apply" 651 | "Aadhaar" and "Bank details" are `rgb(158, 38, 32)`; "Salary" is the ordinary ink |
| LAW-09 | `seal()` 283-287, `vHero` 291: "N of M" / "P% done", over `live()` rows 495 | "5 of 30", "17% done" |
| LAW-10 | `.track`/`.tnode` 638-642: one node per part with `s.done+' of '+s.all`, "✓" when 100% | the 7 labels; titles "2 of 3 done", "2 of 7 done", "0 of 6 done", "1 of 5 done", "0 of 3 done"×3; no ✓ |
| LAW-11 | stamps 671 (`pill y` Yes), 676 (No), 674-675 (Mark Yes only when `mine`) | YES on the done GO job; "No" and no button on the GO's open job; exactly one "Mark Yes" for the owner |
| LAW-12 | group header row 655: `'Part '+s.k+' · '+s.name` + `s.done+' of '+s.all+' done'` | all 7 headers with their counts |
| LAW-13 | `fmt()` 270: `en-IN {day:'2-digit', month:'short'}` | four due dates read exactly what that formatter gives for +25/+27/+30/-6 days |
| LAW-14 | 665: `(-x.due)+' days late'` when `!x.yes && x.due<0` | "6 days late", "3 days late", "1 days late"; three in all; none on a done job |
| LAW-15 | `blocked()` 497; 672: "Waiting" `until "…" is done` | "Waiting" on the manager's and partner's chain steps, no button |
| LAW-16 | chain 336-338 + `blocked()` | the owner's Mark Yes frees the manager's step ("No", not "Waiting"), the partner's stays "Waiting", History records it |
| LAW-17 | 336-338; `stage()` 505-514 | the manager (real sign-in) then sees Mark Yes and frees the partner; the partner (three steps, then Mark Yes) closes the chain; History has all three |
| LAW-18 | 667 "Doesn't apply" + `.na td.what` 135 line-through + 658 "—"; 662 "nobody" `tag nob` | Payroll firm: stamp, strike-through, "—" for the person; Group company: "nobody", the only one |

The spec's `lawbar` (649-651, "⚖️ Which law asks for it?") was not ported to
the static app; LAW-01..04 assert the same four in-force statements where the
app does render them -- as each tag's `title`.

## tfirst -- 28 checks on the first-visit flows

| id | `?mock=` | spec | what is asserted |
|---|---|---|---|
| FIRST-01 | owner | `vWizard` step 1, 568-572; `prevParts` 553-557 | "First, here is your DPDP list", "31 jobs", the rail, 7 part cards with 3/7/6/5/4/3/3 jobs |
| FIRST-02 | owner | 572 "Nothing is sent to anybody yet." → `data-w1` 893-896 | the line; "✓ Create the list" moves to "Who looks after what?", step 1's marker becomes ✓ |
| FIRST-03 | owner | step 2, 575-584: "An email next to each", `AREAHELP` 368-378, "N jobs: … — and n more" 582 | 11 labelled fields; two help lines verbatim; "4 jobs: … — and 1 more"; "1 job: …" |
| FIRST-04 | owner | `PREFILL` 379, pill 578 "your email — change if someone else", counter 587 | GO and coordinator prefilled with the owner's address; two pills; "2 of 11 answered. Empty ones stay amber — that is fine." |
| FIRST-05 | owner | 580-581: textarea "paste every email, separated by commas" for a group, `type=email` "name@example.com" otherwise | those attributes on "All staff" and "Customer data" |
| FIRST-06 | owner | `CANNA` 380, 583 "We don't have this", `.isna` 194 | 4 checkboxes only; ticking Payroll firm disables its box and moves the counter to 3 of 11 |
| FIRST-07 | owner | `data-w2` 898-901: "These do not look like email addresses — fix them or clear the box" | the message names the area and value; nothing saved -- `/app/` is still step 1 |
| FIRST-08 | owner | `data-w2` 902-910: `fromArea` → owner + yes 905; group 906; n/a 904/908; history "Named … as …" | wizard gone; GO job YES; Customer data → staff; group "All staff"; Payroll "Doesn't apply"; four History lines; still gone after `/app/` |
| FIRST-09 | owner | "Not sure? Leave it empty — it shows amber" 576; `vNow` 542; `filt('nobody')` 502 | "25 jobs have nobody looking after them"; "Show me" → chip "Nobody named 25", 25 amber tags, the owner's own job not among them |
| FIRST-10 | partner | `vCAWizard` step 1 721-730; `vWelcome` 785 "{who} added you as {role}" | "Welcome to VERIDIAN"; "… named you as their CA partner — you have 1 job …"; the 3-step rail; "Next — my clients"; "This isn’t me" |
| FIRST-11 | partner | step 3 742-749 "Add your clients … (OPTIONAL)"; `vClients` 615-627 | "Your clients": Mehta Traders "As CA partner · 4 of 31 done · In progress"; "+ Add a client"; "Back" returns |
| FIRST-12 | partner | step order 722 + `data-c3` 873-877; `data-got` 854 | "How it works" names the chain and "Waiting"; "Got it" → the jobs page with the partner's "Waiting" step; History "… saw their DPDP jobs for the first time"; never returns |
| FIRST-13 | partner | `data-notme` 855-856 "Said this is not me — n jobs handed back" | "This isn’t me" → "Yes, tell the owner" → the waiting screen |
| FIRST-14 | client-owner | `vReview` 755-767: "{CA} has set this up for you", Person / Will be asked to, "N jobs have nobody named yet" | "partner@example.test set this up for you"; "31 jobs"; part cards; "Who looks after what" with "go@example.test — 4 jobs", "All staff — 1 job"; "1 job has nobody yet"; "Nothing is sent to anybody yet." |
| FIRST-15 | client-owner | `data-rok` 857 "Checked and confirmed the setup done by …" | "Looks right — confirm" → the page; History "… confirmed the list their CA set up"; never returns |
| FIRST-16 | staff | `vWelcome` 784-790: "Welcome, {me}" / "{inviter} added you as {role} for {org}" / "What you will be asked" | "{org} named you as someone who looks after some of their DPDP jobs — you have 4 jobs of your own."; Got it; This isn’t me |
| FIRST-17 | go | same, role `Grievance Officer` 471 | "… named you as their Grievance Officer — you have 4 jobs of your own." |
| FIRST-18 | coord | same, role `DPDP coordinator` 470 | "… named you as their DPDP coordinator — you have 1 job of your own." |
| FIRST-19 | manager | same, role `Manager` 467 | "… named you as their CA manager — you have 1 job of your own." |
| FIRST-20 | member | role `Everyone` 473 (`me:'All staff'`): the group's job is theirs | "… — you have 1 job of your own." |
| FIRST-21 | go | `data-got` 854 "✓ Got it — show me my page" | the page; History "go@example.test saw their DPDP jobs for the first time"; never returns |
| FIRST-22 | staff | `data-notme` 855-856 "✗ This is not me / not my job" → "Thank you. Whoever added you has been told …" | the confirmation copy; "Never mind" returns; "Yes, tell the owner" → "We’ve told {org}’s owner" |
| FIRST-23 | staff → owner | 856 "Whoever added you has been told" | the waiting screen persists on `/app/`; the owner (real sign-in) sees "staff@example.test said this isn't them -- needs reassigning" |
| FIRST-24 | `/p/#mock-parent` | parent role 481, `vWelcome` 783/791 "Hello from {org}" / "just Yes or No"; `data-yes` 926 | the notice first ("From Sharma & Associates."), then Yes → "Saved, thank you" / "recorded with today’s date" |
| FIRST-25 | `/p/#mock-parent` | `data-no` 933 "Said No to …"; 670 `pill n` "you said no" | No → "Saved, thank you"; the link is then single use (reload: still saved, no buttons) |
| FIRST-26 | `/p/#not-a-token` | (token pages, WO-011 §2 / drizzle/0609) | "This link can't be used" / "This link is not valid or has expired"; nothing has changed; no button |
| FIRST-27 | form | 813 "from your email · no password"; 792 "The link in your email is your login" | "Check your email" with the address; "Send me a new link" → "Sent — check your email again."; "Use a different email" → the form; nobody signed in (clock frozen, as in agent-by-role) |
| FIRST-28 | `/app/?email=…#error=…otp_expired…` | same principle; the screen is WO-011's (`Screens.tsx` `LinkExpired`) | "That sign-in link has stopped working" / "… send you a fresh one to owner@example.test."; URL cleaned to `/app/`; one press → "Check your email" |

## troles2 -- 24 checks on roles

| id | `?mock=` | spec | what is asserted |
|---|---|---|---|
| ROLES-01 | owner-live | `seesAll` 492, `manager` 491; `render` 833-834 hero + list + policy/email/report/history | seal, "Do this now", 7 track nodes, chips, 39 rows (header + 7 parts + 31 jobs) including other people's, History, AI Link, Sign out |
| ROLES-02 | owner-live | `data-yes` 926 "Said Yes to …" | Mark Yes → YES, History line, seal 6 of 30; all still there after `/app/` |
| ROLES-03 | staff | `visRows` 499 (`x.by===me`), `.big.lite` 121 "Narrow table for staff", 638/643 no track, no chips | header + 4 rows only; no seal, track, chips, part headers or History |
| ROLES-04 | staff | 499; group visible only to members (`yesFor` 496 / app's `viewerIsGroupMember`) | no hr's job, no owner's job, no "All staff" job, no other address |
| ROLES-05 | staff | `vNow` 525: "You have N jobs to do" / "When a job is done, press the green button. That is all." / "Show me my jobs" | that copy, with 4 |
| ROLES-06 | staff | 674 `bigyes` "✓ Yes, done"; 929 "Done — thank you" | YES; "You have 3 jobs to do"; both survive `/app/` |
| ROLES-07 | member | 669: "✓ Done, I checked" / "I never had any" / "I cannot"; 660 "n of m have answered" | one row; "All staff"; the three buttons ("Done", "Doesn't apply to me", "I can't" -- drizzle/0609's labels); "0 of 3 answered" |
| ROLES-08 | member | `data-ga` 930-932: "your answer is in. n of m have answered"; `yes` only when all have | "1 of 3 answered"; no YES; persists on `/app/` |
| ROLES-09 | member → member2 → member3 → owner | 930 `if(xg.o.grp[0]>=xg.o.grp[1])xg.yes=1`; 931 history per answer | Done / Doesn't apply / I can't in turn; the job closes on the third; the owner sees YES and three History lines "(1 of 3)", "(2 of 3)", "(3 of 3)"; seal 6 of 30 |
| ROLES-10 | go | `vNow` 541: "You have N jobs of your own" / "As {GO}. Press Mark Yes on each when it is done." | the welcome names the Grievance Officer; that copy; the full page (seal, History); 4 Mark Yes |
| ROLES-11 | coord | `manager()` 491 includes coord; `vNow` 542 (`r.k!=='go'`) | the welcome names the DPDP coordinator; "1 job has nobody looking after it"; full page; one Mark Yes on the Accounts job |
| ROLES-12 | partner | `vClients` 615-627: Client / Owner's email / Where it is / Work completed …; `stage()` 505-514 | "My clients (1)" → "My CA clients": headers Client / As / Done / Where it is; "CA partner"; "4 of 31 done (13%)"; "In progress"; "Open Mehta Traders"; back |
| ROLES-13 | manager | 467 Manager; 776 "You check each client’s proof" | the same entry, labelled "CA manager", no "CA partner" |
| ROLES-14 | partner | 618-620 "+ Add a client" (name, owner's email); 534 "Set it up for them"; 889 "Type a client name and a real email address" | the form's fields; ticking "Set it up for them — name the owner now" reveals "Owner’s email"; a bad address is refused; "Never mind" |
| ROLES-15 | partner | 890-891 "{name} added. A link has gone to …"; `stage()` | the new row: "you set it up", 0 of 31, "Waiting for the owner to confirm" (see findings); "My clients (2)"; History |
| ROLES-16 | partner | 534 "Set it up for them"; 939 "{owner} emailed to check it" | owner named → "Waiting for the owner to confirm"; History "Named … as owner" |
| ROLES-17 | partner | `data-ca` 887 (pick a client) → 833 "📋 The list — {client}" | "Open Mehta Traders" → h1 "Mehta Traders", seal 4 of 31, the partner's step "Waiting", still signed in as the partner, "My clients (1)" still there |
| ROLES-18 | owner-live | (WO-DPDP-013 §4 item 6, `AiWorkLink.tsx` -- supersedes WO-DPDP-012 §7's `AiLinkButton.tsx`, retired) | "Copy link" → one `https://app.veridian-aios.com/ai/<token>`; "Copy"; the create form is gone, replaced by the link + Copy; History "Made an AI link" |
| ROLES-19 | owner-live | (same) "shown once" | after `/app/` only the create form is back, no link shown; making a SECOND link does not revoke the first (WO-013 §1.1 drops the old "any earlier link stops working" rule -- links now coexist, each independently listed and revocable under "Your AI links") |
| ROLES-20 | owner-live + `#draft=` | (WO-DPDP-012 §7, `DraftConfirm.tsx`) | the draft in full (What / Job / Note / For); token cleared from the URL; "Nothing has changed yet"; no History line; "Not now" leaves none |
| ROLES-21 | owner-live + `#draft=` | (same) | "Confirm" → status + History "drafted by AI, confirmed by owner@example.test …"; the same link again is already confirmed, no Confirm button, one History line |
| ROLES-22 | owner-live, `/act/#mock-done` | `vEmail` 690 "pressing Yes in it updates the list above", 693 `data-via="email"` | the preview names the job and "Opening this page has changed nothing."; `/app/` still open with no History line; press → "Recorded, thank you"; `/app/` YES + History |
| ROLES-23 | owner-live, `/act/` | (drizzle/0606 single-use tokens) | used twice → "This link has already been used. Nothing has changed."; `#mock-cannot` records "Said they are stuck"; a bad link has no button |
| ROLES-24 | `/unsubscribe/#mock-unsub` | 694 "There is no off switch — a legal duty with a date does not stop" | nothing until the button; "Stopped" for that address, "Statutory notices … will still come"; no token → refused |

Eight checks (FIRST-26..28, ROLES-18..21, 23) exercise screens the one-page
spec predates -- they come from WO-DPDP-011 (sign-in, token pages) and
WO-DPDP-012 §7 (AI link, draft confirm) and are the checks the Step 6 brief
lists by name. Their copy is asserted against the app's own screens
(`Screens.tsx`, `TokenPages.tsx`, `AiLinkButton.tsx`, `DraftConfirm.tsx`),
with the spec principle each instantiates cited above. ROLES-18/19 were
updated 2026-09-24 (WO-DPDP-013 §4 item 6) when `AiLinkButton.tsx`'s
single-link screen was replaced by `AiWorkLink.tsx`'s authority-level screen;
the assertions above are the current, re-verified behaviour, not the
original spec's.

## Honesty notes -- what is not asserted, and why

Every one of the 70 is a real test with a real assertion; none is vacuous.
Three things the brief's list mentions are asserted less directly than the
words suggest:

- **"Emails sent so far" is 0.** The static app's `sent` is always 0
  (`view-model.ts`'s own header: the digest tables are not joined). ROLES-01
  asserts the card exists; no test asserts a count, because the app cannot
  yet show a true one.
- **"Waiting … until "{step}" is done".** The spec's stamp (672) carries the
  name of the step it waits on; the app's `JobsTable.tsx` renders "Waiting"
  alone. LAW-15..17 assert the stamp and the ORDER of the chain (which is
  the behaviour), not the sub-line.
- **The seal's ✓ ring.** No part is complete in the live fixture, so LAW-10
  asserts the absence of ✓ and the presence of every "N of M". A part
  becoming complete is exercised indirectly by LAW-17 (Part 7 closes) but
  the ring's ✓ is not asserted there, because that test ends on the
  partner's page and the ring is not the point of it.

## Findings -- real behaviour the honest mock surfaced (recorded, not fixed here)

1. **A school client a CA creates never appears in "My clients".**
   drizzle/0602's institution library (28 templates) has no `CAMGR`/`CAPARTNER`
   template -- its Part 7 is only the OWNER's "Sign off all the answers" -- so
   `dpdp_create_client_org` (0609:327-330) assigns nothing to the caller and
   `dpdp_my_clients` (0609:236-250, `ca_sub is null` → filtered out) drops the
   school the moment it is created. The v3 mock listed it anyway;
   `step5-by-role.spec.ts` asserted that. The v4 mock follows the SQL, the
   Step 5 test now creates a firm, and `mock-client.test.ts` pins the gap
   ("FINDING, not fixed here"). A template-library / RPC decision is needed
   (a CAPARTNER row for schools, or a membership-level CA rule), not a test
   change.
2. **"Where it is" for a client a CA just added is "Waiting for the owner to
   confirm" even with no owner named.** 0609:322 records `set_up_by` on every
   CA-created org, and `whereItIs` (0609:221) puts that case first, ahead of
   "Not started". The v3 mock said "Not started" when no owner was named --
   its own guess. ROLES-15 asserts what the SQL does. Whether "Not started"
   should win when there is no owner to confirm is a product question.
3. **A group member's "Do this now" says "Nothing for you this week" while
   their group job is unanswered.** `vNow`'s `mine` is `r.by === viewer.me`
   (spec 519 `x.by===me`); in the spec the "Everyone" role's `me` IS the group
   label (`'All staff'`, 473) so the group row matches, but in the app `me` is
   the person's email and the group row's `by` is "All staff", so it never
   does. ROLES-07/08 assert the group row and its three answers; no test
   asserts the member's "Do this now" copy, because the app's is wrong and a
   test asserting it would enshrine the bug. Fix belongs in `view-model.ts`
   (`mine` should include `isGroup && viewerIsGroupMember && !myGroupAnswer`).
4. **`dpdp_flag_not_me` in the v3 mock stamped only `saidNotMeAt`;
   drizzle/0604:287 stamps `first_visit_seen_at` too.** Without that, the app
   showed the welcome again instead of the waiting screen, and FIRST-13/22/23
   would have been impossible to write honestly. Fixed in the mock (it now
   matches the SQL); no app change.

## Running it

CI is canonical (`dpdp-app-ci.yml`, job `dpdp-app-e2e`). Locally, only with
more than 2 GB free (see `e2e/README.md`):

```sh
cd dpdp-app
bun install
bunx playwright install chromium
VITE_MOCK=1 bun run build
bunx playwright test e2e/acceptance-70.spec.ts
bunx playwright test --list        # 91 tests in 3 files; 70 are this suite
bun test src/lib/mock-client.test.ts   # the fixture's numbers, no browser
```

Two long tests (`LAW-17`, `ROLES-09`) chain three or four real sign-ins and
are marked `test.slow()`. Dates are asserted through the same `en-IN` formatter
the app uses, computed on the same day, so a run that crosses local midnight
between seeding and asserting `LAW-13` could see a one-day drift; nothing else
depends on the clock.
