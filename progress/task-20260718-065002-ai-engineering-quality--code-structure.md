# PROGRESS -- task-20260718-065002-ai-engineering-quality--code-structure

Task: VERIDIAN Review Framework gap-closure, AI Engineering Quality / Code
Structure & Modularity -- 5 findings (see task prompt.txt for full text).

## Completed
- [x] Registered/checked ai-os/boss/ACTIVE-CLAIMS.yaml for overlaps -- no
      active claim owns "code structure/modularity" as its own scope.
      schema.ts and task-execution-engine.ts are both touched additively by
      many concurrent claims -- this constrained how invasive finding 1's
      split could safely be (see below).
- [x] Discovered this branch had 13 prior invocations with zero real
      commits (1326 commits behind origin/main). Rebased onto origin/main,
      started this per-task progress file per the resume protocol.
- [x] **Finding 1 (Code Modularity), partial, real code change**: extracted
      task-execution-engine.ts's dispatchTool() (fully self-contained, zero
      calls into other same-file functions) into
      src/lib/services/dispatch-tool-service.ts, re-exported unchanged so
      every external `import { dispatchTool } from "@/lib/task-execution-engine"`
      call site is unaffected. Extracted recordChainWorkerAgentEdges +
      enforceChainMonitoringRules (the one real chain-completion
      responsibility) into src/lib/services/chain-completion-service.ts.
      task-execution-engine.ts shrank from 2583 to ~2230 lines.
      **schema.ts split NOT attempted**: grepped ai-os/boss/ACTIVE-CLAIMS.yaml
      and found dozens of concurrently in-flight claims additively modifying
      schema.ts right now. A physical per-domain split would touch every
      importer (hundreds of files) and guarantee merge conflicts with most
      of that in-flight work, for a [Medium] finding whose gap is real but
      not urgent (schema.ts already has loose domain-section comments, e.g.
      "--- Accounting ---", "--- Assets ---", "--- Buying ---" etc. at
      lines 5996/6348/6428/...). Recommending this stay a separate,
      dedicated task run during a low-concurrency window, not bundled into
      this one -- attempting it here would risk breaking far more in-flight
      work than the finding itself justifies fixing right now.
- [x] **Finding 2 (Component Reusability)**: added REUSABLE-UTILITIES.md at
      repo root -- top ~19 most-reused cross-cutting helpers under
      src/lib/, ranked by real distinct-importer count (git grep across
      src/, not guessed), excluding single-domain services.
- [x] **Finding 4 (Design Pattern Consistency)**: added
      scripts/check-api-route-conventions.mjs (+ 10/10 passing tests) --
      diff-only CI check requiring NEW API routes to call
      requireAuth()/requireAuthOrApiKey() and NEW services that throw to
      use ServiceError, mirroring check-terminology-guardrail.mjs's
      reviewable-diff-ratchet pattern (only new files gated, not a
      retroactive sweep of the ~995 existing routes / ~212 existing
      services). Exemption registry at
      ai-os/registry/api-route-service-convention-exemptions.yaml.
      **CI wiring not yet live**: a real `git push` of a commit touching
      .github/workflows/ci.yml was rejected by GitHub (this session's gh
      token lacks the `workflow` OAuth scope -- confirmed live, matches
      the pre-existing documented constraint behind the repo's other two
      PENDING-MANUAL-APPLICATION-*.yml.txt files). The ready-to-paste job
      is staged at
      ai-os/registry/PENDING-MANUAL-APPLICATION-api-route-conventions-check.yml.txt
      for a real manual paste by someone with workflow-scope credentials.
      The script itself is real and independently runnable today
      (`node scripts/check-api-route-conventions.mjs --diff-only`).
- [x] **Finding 5 (File & Folder Organization), partial**: added
      src/app/api/README.md -- navigation aid for the 138-directory,
      ~995-route.ts API surface (v1/ vs root split explained, root
      directories grouped by real domain). For the "consolidate ai-os/'s
      overlapping subtrees" half: confirmed ai-os/OS.yaml already exists
      specifically as that navigation aid (CLAUDE.md cites it as "the one
      place that lists every other tracking/governance document"), and
      that audit-tree/system-tree/tree4-unified are a deliberate 3-layer
      methodology (Tree 1 = source requirements, Tree 3 = what's built,
      Tree 4 = the merge/gap-backlog), not accidental duplication --
      OS.yaml's own `what_should_exist_vs_what_does` section already
      documents this. The one subtree that WAS genuinely stale
      (tree4-unified/50-completion-plan/) is already archived + bannered
      per ai-os/registry/stale-doc-manifest.yaml. No further physical
      consolidation found warranted right now; the existing
      stale-doc-manifest.yaml + check-doc-quarantine-banner.mjs pattern is
      itself the "periodic consolidation" mechanism the finding asked for,
      and is already live -- nothing more to build here today.
- [x] Fixed 2 guardrail markers in scripts/check-guardrail-presence.mjs
      that moved with the finding-1 extraction (logActivity(,
      enforceChainMonitoringRules's nextEscalationRung call) -- relocated
      per Operating Rule 9's own "extending/relocating coverage is always
      permitted" carve-out, not a narrowing.
- [x] Verified clean: `bun run lint` (0 errors, 3 pre-existing unrelated
      warnings), `bunx tsc --noEmit` (clean on all touched files -- a full
      repo run OOMs in this environment on scripts unrelated to this
      change, a pre-existing environment constraint not introduced here),
      `bun test` on task-execution-engine.test.ts (7/7),
      tasks/[id]/status/route.test.ts (5/5), and the new
      check-api-route-conventions.test.ts (10/10). All 5 governance CI
      checks pass locally (guardrail-presence 89/89, metadata-index-coverage
      182+7/185, doc-quarantine-banner 44/44, doc-cross-references
      502/502, asset-registry-coverage 145+321/443). `bun run build` timed
      out in this resource-constrained sandbox before completing -- not
      run to completion; tsc/lint/tests are the real coverage evidence.

## Remaining
- [ ] **Finding 3 (FK constraints for org/user scoping)** -- NOT started.
      Needs a real, careful pass: identify the highest-traffic org/user-
      scoped relationships still missing a DB-level FK, verify no existing
      orphaned rows would violate the constraint before adding it (a live
      migration against real data), and add incrementally. Deferred here
      for the same reason as the schema.ts split -- this needs its own
      focused pass with real production-data verification, not squeezed
      into an already-multi-finding task; recommend a dedicated follow-up.
- [ ] schema.ts per-domain split (finding 1's other half) -- see rationale
      above; recommend a dedicated, low-concurrency-window task.
- [ ] .github/workflows/ci.yml wiring for check-api-route-conventions.mjs
      needs a real manual paste (workflow-scope credential gap, see above).
