# PROGRESS -- task-20260727-132748-fix-pr-596--zero-tax-interim-bills---ret

## Completed
- [x] Read the audit verdict (`gh api repos/FChecklist/compliance-tracker/issues/596/comments`, FAIL)
      and the known-context: `generateInterimBill()` in `construction-valuation-service.ts` built
      invoice line items with no `taxTemplateId`, and `erp-invoicing-service.ts`'s
      `computeInvoiceTotals()` has no company/customer-level tax fallback -- every interim/RA
      bill posted with $0 GST. Retention was also a negative invoice line, which would compound
      the gap once tax was wired in (shrinks the taxable subtotal).
- [x] Checked `ai-os/boss/ACTIVE-CLAIMS.yaml` for collisions on this file scope -- none found.
- [x] Confirmed this repo has no company/customer-level default tax template (checked
      `erpCustomers`/`erpCompanies` schema and every `resolveInvoice*` helper in
      `erp-invoicing-service.ts`) -- so per this task's SCOPE, `taxTemplateId` is now a required,
      org-validated field on `GenerateInterimBillInput`, not silently defaulted.
- [x] Confirmed `constructionInterimBills.retentionAmount`/`netPayable` already exist and already
      model the retention holdback separately from the invoice -- the bug was double-encoding
      retention into the invoice too. Fix: stop emitting the negative "Retention held" invoice
      line; invoice the full gross value with real tax on it (GST is due on the full value of
      work certified regardless of retention terms).
- [x] Pushed the fix directly to PR #596's own branch
      (`worker/task-20260727-122632-projexa-e2e--hierarchical-boq-breakdown`, commit `f4f70f1d`),
      per this task's EXPECTED_OUTPUT (no new PR opened):
      - `construction-valuation-service.ts`: `GenerateInterimBillInput.taxTemplateId` (required,
        org-scoped validation), new pure `buildInterimBillInvoiceItems()` helper (no retention
        line, every item carries the real tax template).
      - `erp-invoicing-service.ts`: `computeInvoiceTotals()` split into a pure
        `computeInvoiceTaxTotals()` (exported, tested) + thin DB-fetching wrapper.
      - Tests added to `construction-valuation-service.test.ts` and new
        `erp-invoicing-service.test.ts` proving nonzero tax on the real gross value and that
        retention no longer shrinks the taxable subtotal.
      - PR #596's own `PROGRESS.md` updated with a "Corrective fix" section disclosing both the
        original gap and the fix, per this task's SCOPE item 3.
      - `npx tsc --noEmit` clean, `bun test` 2132 pass / 0 fail (full suite, no regressions),
        `eslint` clean on all touched files.
- [x] Git housekeeping note: this workspace's `.git` is a worktree sharing the single
      `/opt/veridian/repos/compliance-tracker/.git`, so `git stash` is a repo-global stack
      shared across every concurrent task worktree. Mid-task, `git stash pop` was run and
      popped a different worktree's stash entry (task-20260727-132826, PR #597) instead of this
      task's own -- caught immediately, verified it was only a trivial scaffold `PROGRESS.md`
      placeholder diff (not real code), confirmed that other session's actual work branch was
      untouched/intact, and restored this task's own stash correctly. Flagging here per the
      honesty standard this repo's own governance docs hold: avoid `git stash`/`git stash pop`
      in this environment when possible (prefer branch switches or worktree-local commits);
      if used, verify the popped entry's "On <branch>"/"WIP on <branch>" line matches the
      current branch before trusting the pop.

## Remaining
- [ ] PR #596 needs a fresh supervisor audit on this corrective push before Owner sign-off
      (tier2 -- do not merge without a new `AUDIT: PASS`).
