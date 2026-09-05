# R75 Part 2 — what needs you, and what doesn't

Plain language. Technical detail lives in `platform.claude_log` and the git history if you ever want it.

## 🔴 URGENT — do this first: revoke a leaked GitHub token

An old project folder on this laptop had a real GitHub access token sitting in a config file, in plain text. I found it, removed it from the file, and confirmed no copy of it remains anywhere else on this machine (checked 19 other project folders, all clean).

**But removing it from the file does not cancel the token.** Anyone who already had a copy of that file still has a working token, right now, until you cancel it on GitHub's side. I cannot do this myself — GitHub does not let anything but you, logged into your own account, cancel a personal access token.

**What to do (about 2 minutes):**
1. Go to github.com → click your profile picture → Settings → Developer settings → Personal access tokens → Tokens (classic).
2. You'll see a list of tokens. Look for one that hasn't been used in a while, or one you don't recognize the purpose of.
3. Click **Delete** (or **Revoke**) next to it.

I never printed, copied, or used the token's value anywhere — not in this file, not in any commit, not in any log. I genuinely don't have it anymore either, so I can't tell you exactly which one it is by name — you'll need to eyeball the list. If you want, tell me the token names/dates you see and I can help you guess which one based on when that old folder was last touched (mid-July).

This item stays at the top of every update until you tell me it's done.

---

## The numbers, plain

- **70 requirements tracked** (Sumeet's original list). Every single one now has a real, evidenced status — none left unchecked:
  - **43 CLOSED** — a real, committed, re-runnable test proves the behavior, and I personally re-ran every one of these 43 again just now, after all the day's changes, to make sure nothing broke it since. All still pass.
  - **18 BLOCKED** — the feature is real and I found real evidence for it, but I can't get a machine to prove it live right now (the demo login flow needs a browser step I couldn't safely automate today — details below). Not "broken," not "fake" — just not provable by me today.
  - **5 NOT_TESTABLE** — these are things only you can do (rotate a password, decide whether a repo should be public, review a legal question about GPL-licensed code). Nothing for a test to run.
  - **4 still OPEN, honestly** — real gaps, not yet closed:
    - *Project value matching the BOQ total* — the test that was cited for this doesn't actually prove this specific thing; needs a better test, not urgent.
    - *Two chat-assistant items* — real evidence exists but wasn't rigorous enough by today's stricter standard (I have to prove a test can actually FAIL before I trust it); fixable, not urgent.
    - *CRR (the "remember everything, cite your sources" backend feature)* — real, but only half-built and half-tested. This is a substantial separate piece of work, in progress (see below).

- **Security gaps in who-can-do-what (authz)**: found 831 places in the code that change data. Started at ~78 with no permission check at all; **25 are now fixed** (with real before/after tests) as of today, **53 remain**. Continuing.

- **Two other codebases checked for stale credential/dependency issues**: found and fixed one real security bug (a different vulnerable dependency path than one fixed earlier), pushed.

- **35 of my own commits pushed to GitHub today**, after I built and ran a tool that checks for anything credential-shaped before it goes out (checked clean, twice, using two different methods).

- **9 pending PROJEXA GitHub pull requests reviewed**: 2 were real and good, folded in; 7 had real problems (stale against current code) and were left open with specific notes rather than force-merged.

## What's still moving

I'm running a second Claude session in parallel on a specific sub-project (CRR — the "remember what this org has already captured or done" backend feature). It caught and fixed a real security bug on its own (a database function that runs with elevated privilege, already shipped safely to production a week ago) and is now working on the missing CRR test coverage listed above. I'm checking in on it periodically rather than duplicating its work.

## Mistakes I made and caught myself, today

Being upfront about this rather than only reporting the clean version:
- Once accidentally deleted a branch with real, unmerged work on it, before checking whether it had been merged first — the commit wasn't garbage-collected yet, so I recovered it. Now I always check first.
- Twice, a command I used to look at a file's content (`git show`/`git diff`, piped) silently cut off after ~30 lines and could have corrupted a file if I'd trusted it — caught both times by a test failing, switched to a command that doesn't truncate.
- Wrote a throwaway checking-script with a bug that made 29 real, already-verified pieces of evidence look like they'd all failed at once — caught it before believing the false result, by checking one manually.
- One dispatched sub-task reported back saying "I've handed this off to another AI to do," having done no actual work itself — caught by checking the file history directly, redone properly.
- Reverted two real pieces of evidence to "not done" by mistake, because I'd only checked one of the two codebases they could have lived in — found they were real, just in the other codebase, and restored them.

## What I still can't do myself

A handful of items need an actual browser session logged in as a real user to prove (not just a database query) — the login mechanism itself works (I built and tested it), but the last step of putting that login into a real browser tab was blocked by a safety check on this platform, and separately the laptop didn't have enough free memory at the time to safely try the one sanctioned alternative. These are marked BLOCKED above, not silently skipped.

---

*Still updating as the remaining ~53 security gaps get fixed and the last few phases finish. The PAT item at the top stays there until you confirm it's done.*
