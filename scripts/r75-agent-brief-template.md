# R75 Part 2 — hardened agent brief template (V0-05)

Every BUILD-tier agent brief dispatched from R75 Part 2 Phase 1 onward carries
these four lines verbatim, not paraphrased, near the top of the prompt. They
exist because two real fabrication failure modes landed in the same batch
(KV-01, KV-02) before this template was written: a 17-byte placeholder
overwriting a 1244-line file, and a convincing break/restore narrative with no
actual test code behind it.

```
HARD RULES, violating any of these means your whole submission is discarded and redone:
1. The "files" array in your final structured report MUST contain the COMPLETE, real, final
   text of every test file you created or modified -- never a placeholder, never "see
   previous call", never a summary, never empty/near-empty content. State the byte count of
   what you return for each file.
2. If you modify an EXISTING file, "full_content" must be that file's ENTIRE content after
   your edit (every pre-existing line plus your addition), never just your new lines. Read
   the file's current full content first if you are not certain you have it all. Declare
   claimed_status: "new" or "modified" per file so the payload gate can check your claim
   against real git status.
3. If you run low on turns/budget before finishing all assigned requirements, STILL return
   the schema with whatever you DID complete fully and correctly in "files" -- do not pad
   unfinished ones with placeholder text. Report an unfinished requirement honestly in
   per_requirement with passes_now=false and say what remains in notes. Honest partial
   failure is always preferred to a convincing but empty report.
4. Before finishing, run `git status --porcelain` from your worktree and confirm every
   non-test source file you touched has been reverted (git checkout -- <file>) -- report
   this check's result in notes.
```

Every payload returned under this template is still run through the three
mechanical gates before being trusted or applied — the brief lowers the rate
of fabrication, it does not replace verification:

- `scripts/r75-payload-gate.mjs <workflow-output.json>` — before any file in a
  payload is written to disk (V0-01).
- `scripts/r75-citation-gate.mjs <citation.json>` — before any
  `platform.sumeet_requirements.closure_state` is written to `CLOSED` (V0-02).
- `scripts/r75-exemption-gate.mjs <exemptions.json>` — before any route is
  filed in `EXEMPT_ROUTES` rather than left as an open gap (V0-03, GV-24: a
  route that scopes by org but lets any role in that org act is still a gap
  — tenant-scoping is never sufficient evidence on its own).

All three gates are proven on planted failures (not by inspection) — see each
script's own header comment for what was planted and what it caught,
including one real bug the citation gate's own first draft had (`bun test`'s
pass/fail tally is written to stderr, not stdout — the gate's first version
only read stdout and would have wrongly rejected a genuinely passing test).
