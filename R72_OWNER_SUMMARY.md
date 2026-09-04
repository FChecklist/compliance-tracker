# What happened this week — plain-language summary (R71 + R72)

Written for the owner, no technical background assumed. If a term needs it, it's explained
inline. The detailed, evidence-heavy version of everything below lives in
`platform.claude_log` (ids 171–198) and the three companion files linked at the end.

## The short version

Two big cleanup projects ran back to back on the compliance-tracker app this week:

1. **R71** merged 13 months' worth of separately-developed work back into the main codebase,
   found and fixed a real bug that had been silently blocking a data-saving feature since
   July, and added some missing safety rails around deleting records.
2. **R72** checked whether "what's on this laptop" actually matches "what's really live" —
   and found several real, meaningful mismatches, including one that could have caused
   real confusion (this app's login system was accidentally configured, on this laptop
   only, to point at a different app's database).

**Nothing was deployed to real users this week.** The live app has been intentionally kept
offline (paused) since before this work started, and stays that way until a separate,
explicit decision is made to bring it back — see "What needs your decision" below.

## R71, in plain terms

- 13 separate "branches" of work — code that had been written but never actually joined to
  the main app — got safely combined. Think of it like 13 people each editing their own copy
  of a shared document, and this was the work of carefully merging all 13 copies into one
  without losing anyone's changes or creating contradictions. 112 specific conflicts came
  up during that merge; each one was resolved and the reasoning was written down.
- A real, meaningful bug was found: a database safety feature (meant to stop legitimate
  updates from accidentally corrupting records) had a flaw that caused it to also block a
  *legitimate* save action — silently, since July. That's now fixed.
- The app was already set up to never truly delete certain records (an audit-trail
  requirement). That protection had one gap — a way records could be deleted after all — is
  now closed.
- A checked-out safety net: the code that runs on your live website (Vercel) was confirmed
  to build and pass its own tests successfully with all of this week's changes.

## R72, in plain terms

R72 asked a simple but important question: does what's on this laptop (or in the online
code repository) actually match reality? Several real answers came back:

- **A real misconfiguration was found and fixed**: this laptop's local copy of the app was
  accidentally set up to log in against a *different* application's database (a related
  product, PROJEXA, which is a separate app entirely). This didn't affect real customers —
  it only affected testing done on this laptop — but it's exactly the kind of thing that
  causes confusing, hard-to-explain bugs later if left alone. Fixed by pulling the correct
  settings directly from the official hosting service (Vercel), which had the right values
  the whole time.
- **This laptop cannot currently run its own private copy of the database.** The tools
  needed for that (Docker, or a direct database install) aren't present, and installing
  them is a decision left for you, not made unilaterally — see below.
- **A safety gap in how the code reaches the live website was found and closed**: pushing
  code to the main line used to automatically trigger a deployment attempt to the live site
  (currently harmless only because the site is paused — but if it were ever un-paused
  without this fix, the very next code push would have gone live with zero review in
  between). That auto-deploy has now been turned off; going live now requires a deliberate,
  documented set of steps (see `R72_DEPLOY_RITUAL.md`).
- **The website's code repository (on GitHub) had zero protection** against someone
  accidentally force-erasing history or deleting the main branch. Basic protection against
  those two specific accidents is now in place.
- **A checklist-style safety script was built** (and actually tested, twice, catching two
  real bugs in itself along the way) that should be run before any future deployment — it
  checks that the code compiles, passes its tests, and builds successfully before anyone is
  allowed to call a deploy "safe."

## What needs your decision

Nothing here is urgent or time-sensitive, and nothing commits money. In order of how much
it matters:

1. **When (or whether) to bring the live website back online.** It's been intentionally
   paused. Bringing it back is a deliberate, separate decision — not something this work
   does automatically, and not something recommended without your explicit go-ahead.
2. **Whether to let this laptop run its own private test database** (via installing Docker
   or PostgreSQL directly). Right now every test this laptop runs talks to the *real*
   database — which has worked fine so far, but isn't ideal long-term.
3. Two smaller technical items are listed in full in the detailed register (`claude_log`,
   search for "owner decisions") if you want the complete list — none are blocking anything.

## Where to find more detail

- `R72_PARITY_GAP_REGISTER.md` — the full technical list of 10 differences found between
  this laptop and the real live setup.
- `R72_DEPLOY_RITUAL.md` — the step-by-step procedure for safely deploying, going forward.
- `CLAUDE.md` — the technical bootstrap file every AI session reads first; keeps all of the
  above current for whoever (human or AI) picks this codebase up next.
