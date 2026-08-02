# PROGRESS -- task-20260802-194612-pm-decision--ocid-020-certification-targ

PM decision task: resolve the OCID-020 certification-target question (real evidence, not left
for a session to decide alone). Amends `UMR-20260802-104058-25ba` via the canonical
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`.

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain, ACTIVE-CLAIMS.yaml, canonical matrix.
- [x] Checked PR #727 and PR #735 real current state (both open, real CI status, real bodies).
- [x] Traced task-20260802-172443 (the competing "certify projexa-smoky.vercel.app" finding):
      confirmed `status: failed`, never merged, no PR from it beyond unrelated #731 -- no
      conflicting conclusion on `main`.
- [x] Independently re-verified the domain-revert evidence cited in the PM directive
      (item 12 / UMR-20260802-134939-145d, -123246-f2e7, -124023-371b already in the matrix;
      `curl -I https://projexa-ai.com` -> live 200).
- [x] Recorded the PM decision as a new amendment in `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`:
      `veridian-compliance-ai` confirmed as the OCID-020 certification target, task-172443's
      conclusion explained and superseded, PR #727/#735 confirmed as the correct in-progress
      work to build on, real next-step blockers named (Metadata Index Coverage Check, missing
      AUDIT verdict on both PRs).
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`.
- [x] Committed and pushed.

## Remaining
- [ ] Next continuation session: index PR #727/#735's new `ai-os/` doc paths in `OS.yaml`, get a
      real non-self `AUDIT:` verdict posted, merge both.
- [ ] Then continue authenticated-screen coverage on `veridian-compliance-ai` (real inbox access
      or a pre-confirmed test user needed to unblock PR #727's `NOT ASSESSED` gap).
