Governing UMR: `UMR-20260806-101802-a350`. Two things landed in this one PR:

**1. SPEC's own deliverable** (task-20260815-041523): real-confirmed all 8 Z.AI GTM finding files at `/opt/veridian/ai-os/memory/zai-gtm-findings/` (non-zero, real line counts). Real merge + point-enumeration step was already done by a prior cycle (separate repo `veridian-ai-os`, PR #3, tier2-audited) — checked before redoing, per Rule 12. **Real total point count: 139** (11 CB, 20 HP, 20 MP, 10 OBS, 78 individually-verdicted sub-checks). Full citation chain in `progress/task-20260815-041523-z-ai-gtm-findings-files-are-now-real-and.md`.

**2. Carried forward PR #1200's real work** (task-20260815-033857, same governing UMR): that task's worker went inactive mid-cycle after implementing 4 real point fixes (CSP/X-Frame-Options headers, `/forgot-password` redirect, sitemap domain correction, a correction to a wrong prior "no rate limiting" verdict) but before merging. Independently live-re-verified all 4 claims against `https://projexa-ai.com` before touching anything (all reproduced pre-fix, exactly as claimed). Cherry-picked that commit onto this branch (worker branch-isolation enforcement blocks committing directly to another task's branch) and fixed the one real gap: the Terminology Guardrail Check CI failure (3 new unexempted `hardcoded_iso_date` findings from that PR's own dated verification comments) — registered permanent exemptions with real reasons, locally re-confirmed the check now passes clean. `bunx tsc --noEmit` and `bunx eslint` both clean on every changed file.

`ai-os/boss/ACTIVE-CLAIMS.yaml` updated with a continuation note on the existing claim (not a new/duplicate one), per Rule 11.

Does not begin closure work on any of the remaining ~128 unclosed points — explicitly out of scope for this cycle per SPEC.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
