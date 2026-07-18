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

## Remaining
- [ ] Extend src/lib/services/mdm-quality-service.ts with a 3rd
      MdmEntityType, 'erp_purchase_invoice': scanForDuplicates() exact
      supplierId+invoiceNumber match branch, reusing the existing
      mdmDuplicateCandidates table/review workflow (no migration --
      entityType is free text). mergeDuplicates() must reject this
      entity type (no safe merge semantics for a posted invoice);
      confirm/not_duplicate is the terminal state. Extend
      listDuplicateCandidates() name resolution for invoice candidates.
- [ ] Build src/lib/services/task-dedup-service.ts: sibling to (not part
      of) capability-registry-service.ts, own 'task' entityType over the
      same embeddings.ts infra, org+optional-projectId scoped, active
      (pending/in_progress) tasks only, >=0.92 threshold matching the
      finding's own stated pattern.
- [ ] Wire indexing into src/lib/services/task-service.ts createTask()/
      updateTask() (best-effort, fire-and-forget).
- [ ] New API route src/app/api/tasks/duplicates/route.ts (GET,
      requireAuth + requireRole "manager").
- [ ] New page src/app/(app)/task-duplicates/page.tsx + nav entry in
      src/components/AppSidebar.tsx + messages/en.json + messages/hi.json.
- [ ] Do NOT touch permission-service.ts's ERP_ACTION_ROLES structure.
- [ ] Run bun test / bunx tsc --noEmit / bun run lint / bun run build.
- [ ] Open PR against main (not self-merged).
