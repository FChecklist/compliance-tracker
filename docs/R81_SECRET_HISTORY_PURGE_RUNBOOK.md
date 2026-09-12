# Runbook — purge the published mint secret from public git history

**Fault:** `R81_F40` · **Gap:** `G-21` · **Prepared by:** R81, 2026-09-08
**Status:** prepared, NOT executed. This is deliberately for the owner to run.

## Why this is not automated

Rewriting history on a **public** repository changes **every commit SHA** from the
rewrite point forward. That breaks every existing clone, fork, open PR and any
external reference to a commit. It is not reversible by a follow-up commit. So it
is prepared here and handed over, rather than run by a session.

## What is being purged, and what it does NOT fix

`e2e/demo-gate-smoke.spec.ts` contains a hardcoded secret for the
`mint-session-r33` Supabase Edge Function. It is present in the `origin/main`
blob of a **public** repo, so it must be assumed **read by strangers** and
permanently burned.

**Purging history does not, on its own, close anything.** The live fix is:

1. **DONE** — both Edge Functions were hardened (v2) with an email allow-list, an
   env-preferred secret and `verify_jwt: true`. A non-allow-listed address now
   gets `403` with no token.
2. **OUTSTANDING, one dashboard action** — set **`MINT_SECRET`** on project
   `evpckeuxgvahguwsaeul` under **Edge Functions → Secrets**. The function reads
   it immediately, with no redeploy, and the published literal stops working at
   that moment. **Do this first — it is what actually retires the secret.**
3. Then, optionally, this purge — hygiene, so the burned value is not sitting in
   a public history for anyone to scrape.

Doing step 3 without step 2 achieves nothing: anyone who already copied the value
still has it.

## Preconditions

- Both Claude sessions stopped, and **no uncommitted work** in `C:\ct\ct`.
- Everything pushed (`git status` clean, `git log origin/main..HEAD` empty).
- A full backup clone kept somewhere safe: `git clone --mirror <url> ct-backup.git`

## Procedure (git-filter-repo — preferred over BFG)

```bash
pip install git-filter-repo
```

Create the replacement file **outside the repo** so it is never committed. Put the
real secret on the left of `==>`; copy it from `e2e/demo-gate-smoke.spec.ts`
(`const MINT_SECRET = "..."`). Do not paste it into any chat, issue or commit.

```bash
# C:/ct/secret-replacements.txt   <-- OUTSIDE the repo, delete afterwards
<PASTE_THE_LITERAL_HERE>==>REDACTED_R81_F40
```

```bash
cd C:/ct
git clone --mirror https://github.com/FChecklist/compliance-tracker.git ct-purge.git
cd ct-purge.git
git filter-repo --replace-text ../secret-replacements.txt
git push --force --all
git push --force --tags
```

Then, **every** existing clone must be re-cloned — `git pull` will not reconcile a
rewritten history:

```bash
# in C:/ct, after moving the old checkout aside
git clone https://github.com/FChecklist/compliance-tracker.git ct
```

Also delete `C:/ct/secret-replacements.txt` and check the worktrees under
`C:/ct/ct-worktrees/` — at least `r65-partc-phase2-embeddings` holds its own copy
of the spec and must be re-created, not pulled.

## Verify afterwards

```bash
git log --all -S'<PASTE_THE_LITERAL_HERE>' --oneline | head
```

Zero lines = purged. Re-run `node scripts/check-migration-journal-parity.mjs` and
`node scripts/check-comment-rot.mjs` afterwards to confirm the rewrite did not
disturb the migration journal or the comment registry.

## If you would rather not rewrite history

Legitimate choice. Do step 2 (set `MINT_SECRET`), and treat the old value as
burned and worthless. The history then contains a string that opens nothing. The
only cost is that a scanner will keep flagging it, and anyone reading the repo
learns the naming convention the secrets followed — which is itself a reason the
replacement secret must not follow that pattern.
