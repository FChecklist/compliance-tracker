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

*(This file will fill in with the rest of the session's plain-language summary — what was tested, what works, what doesn't, what changed — once the work itself is further along. Right now it exists specifically to carry the urgent item above where you'll see it.)*
