# PROGRESS -- task-20260718-090002-checks---balances--duplicate---data-qual

Task: VERIDIAN Review Framework gap closure -- 4 findings (2 duplicate
pairs in the dispatch): "Duplicate Work Detection" (tasks table) and
"Duplicate Data Detection" (vendors/customers/invoices).

## Completed
- [x] Read governance docs (AGENTS.md, CLAUDE.md, ai-os/CONSTITUTION.yaml
      pointers) and ai-os/boss/ACTIVE-CLAIMS.yaml; no conflicting active
      claim on this file scope; registered this task's own claim.
- [x] Investigated current code before writing anything (per this task's
      own instructions to re-verify stale findings against real code):
      - **Duplicate Data Detection is LARGELY already resolved**, not a
        clean gap: src/lib/services/mdm-quality-service.ts (Wave 93,
        MDM007/MDM008 gap closure) is a real, generalized pg_trgm +
        gstin/pan-number similarity dedup service for erp_customers /
        erp_suppliers, with a full scan -> pending candidate -> human
        review (confirm/not-duplicate) -> merge workflow, its own table
        (mdmDuplicateCandidates/mdmMergeLog), API routes
        (src/app/api/mdm/duplicates/**) and UI
        (src/app/(app)/mdm-quality/page.tsx). It was NOT built on top of
        src/lib/gst/reconciliation-engine.ts as the finding's own
        "recommended approach" text assumed -- that assumption in the
        finding is stale; a different, already-generalized service exists.
        Purchase-invoice duplicates were the one real remaining gap: only
        an ephemeral exact-match array (detectDuplicateInvoices in
        src/lib/engines/audit-engine.ts), reachable only through an
        AI-planned task_execution_engine.ts case
        ("duplicate_invoice_detector"), no persistent candidate/review
        workflow or direct UI/API surface for AP staff.
      - **Duplicate Work Detection (tasks table) is a genuine, still-open
        gap**: confirmed by src/lib/loop-prevention.ts's own header
        comment, which explicitly says duplicate-task detection "doesn't
        exist yet" ("that graph doesn't exist yet ... adding a fake
        detector with nothing real to detect against would be worse than
        naming the gap honestly"). grep across src/lib and src/app/api
        confirmed zero existing similarity/dedup logic against the
        `tasks` table. src/lib/services/capability-registry-service.ts's
        auditDuplicateCapabilities() (>=0.92 pgvector-embedding
        similarity) is real but explicitly scoped to
        worker_agent/automation_rule/module/prompt_pattern/dynamic_chain
        only -- the finding's own text calls this "a narrower, different
        concept" from ordinary business-task dedup.
- [x] Extended src/lib/services/mdm-quality-service.ts with a 3rd
      MdmEntityType, 'erp_purchase_invoice': scanForDuplicates() has a new
      exact supplierId+invoiceNumber match branch (no similarity
      threshold needed -- an exact repeat invoice number for the same
      supplier is never a legitimate coincidence), reusing the existing
      mdmDuplicateCandidates table/review workflow (no migration --
      entityType is a free-text column, only its comment was updated).
      mergeDuplicates() now explicitly rejects this entity type (no safe
      merge semantics for a posted invoice, which may already be paid/
      posted to the ledger) -- confirm/not_duplicate is the terminal,
      actionable state, documented as a deliberate boundary. Extended
      listDuplicateCandidates() name resolution to show a human-readable
      invoice label (supplier name + invoice number + amount). Extended
      src/app/(app)/mdm-quality/page.tsx: entity-type selector now
      includes "Purchase Invoices"; the Data Completeness panel (a
      customer/supplier-only concept) is skipped for that entity type
      instead of fetching/showing a fabricated score; confirmed invoice
      duplicates show "Void or credit-note the duplicate manually" instead
      of an Merge button that would just 400.
- [x] Built src/lib/services/task-dedup-service.ts: a sibling to (NOT
      merged into) capability-registry-service.ts -- reuses the same
      underlying entity-agnostic src/lib/embeddings.ts
      (storeEmbedding/findSimilar) with its own 'task' entityType,
      deliberately kept OUT of CAPABILITY_ENTITY_TYPES (per the finding's
      own text calling capability dedup "a narrower, different concept").
      indexTaskForDedup() embeds title+description; findSimilarActiveTasks()
      finds candidate matches scoped to org + optional projectId (tasks'
      closest real "module" concept) among active (pending/in_progress)
      tasks only; scanForDuplicateTasks() runs the same pairwise on-demand
      audit shape as auditDuplicateCapabilities(), default threshold 0.92
      as the finding specifies. Added task-dedup-service.test.ts covering
      the one pure function (buildTaskDedupContent), matching this repo's
      established "don't exercise a live DB from a .test.ts file"
      convention (see capability-registry-service.test.ts's own note).
- [x] Wired indexing into src/lib/services/task-service.ts: createTask()
      and updateTask() (on title/description change) call
      indexTaskForDedup() best-effort (fire-and-forget, never blocks task
      creation/update on an embedding failure) -- same pattern already
      used there for dynamic_chain capability indexing.
- [x] New API route src/app/api/tasks/duplicates/route.ts (GET,
      requireAuth + requireRole "manager", optional ?projectId= filter) --
      mirrors the existing capability-registry/duplicates and
      mdm/duplicates/scan route shape (on-demand, real embedding-API-cost
      audit, admin/manager-triggered, never auto-merges/cancels).
- [x] New page src/app/(app)/task-duplicates/page.tsx (manager/admin
      gated, "Scan for duplicate tasks" button + results list) mirroring
      src/app/(app)/capability-registry/page.tsx's established UI pattern.
- [x] Added a "Duplicate Task Detection" nav entry (Tools section) in
      src/components/AppSidebar.tsx + messages/en.json + messages/hi.json.
      src/lib/protected-routes.generated.ts picked up the new
      /task-duplicates route automatically (build-time codegen).
- [x] Did NOT touch src/lib/services/permission-service.ts's shared
      ERP_ACTION_ROLES table structure or any other file (per this task's
      own instructions) -- confirmed via `git status` before finalizing.
- [x] Verification, fresh `bun install` first (node_modules was absent):
      bunx tsc --noEmit -- 0 errors. bun run lint -- 0 errors, 3
      pre-existing unrelated warnings (same ones noted by the prior
      session in this repo's history). bun test -- 1424 pass / 0 fail
      (1421 pre-existing + 3 new). bun run build -- succeeded,
      /task-duplicates present in the route manifest. Guardrail Presence
      Check 88/88, Asset Registry Coverage Check 431/431 (no new table --
      confirmed no migration needed, entityType stayed free text),
      Metadata Index Coverage Check 30/30, Doc Quarantine Banner Check
      44/44, Doc Cross-Reference Check 339/339. `ls drizzle/*.sql | sort
      -V | tail` confirmed no new migration file was created.

## Remaining
- [ ] Open PR against main (not self-merged), left for the supervising
      session's audit per Rule 7(c)/Rule 10.
- [ ] Move this session's ai-os/boss/ACTIVE-CLAIMS.yaml entry from
      `active:` to `recently_completed:` once the PR merges (or is
      abandoned), per that file's own protocol.
