# PROGRESS -- task-20260803-111329-pm-decision--use-idle-capacity-to-fix-ga

SPEC: GAP-ERP-CRM-403-NO-UX-EXPLANATION (UMR-20260802-165606-4413 OCID-020,
PR #737 Finding B) -- fresh self-signup org sees silent 403s on CRM/ERP APIs
with no user-facing explanation.

## Completed
- [x] Registered active claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting.
- [x] Root-caused: backend already returns a real, Owner-worded, human-readable
      403 message (`{"error": "This capability is not part of the Module your
      organization purchased. Please contact your organization's
      administrator..."}`) via `requireErpEnabled()`/`requireSalesEnabled()`
      (`erp-enablement-service.ts`/`crm-enablement-service.ts`) -- this is a
      FRONTEND surfacing gap, not a backend response-shape gap. Every affected
      page's `load()` called `res.json()` and used `data.items ?? []` without
      ever checking `res.status`, so a 403 silently rendered as an empty list.
- [x] Checked existing UI precedent before inventing anything new: PMS
      (`src/app/(app)/pms/page.tsx`) blocks the whole page with a Card +
      icon + heading + message when `pmsEnabled` is false, but its
      "Go to Settings" CTA assumes a self-service enablement toggle that ERP/
      CRM genuinely do not have yet (confirmed via `AppSidebar.tsx`'s own
      comment: "the 'erp' branch has no enablement-toggle UI built yet").
      `rewards/page.tsx` shows the closer precedent for a module with no
      toggle: a plain Card with just the real message, no CTA.
- [x] Real fix shipped: new shared `src/components/ModuleAccessNotice.tsx`
      (Card + Lock icon + heading + the real backend message, no misleading
      CTA), wired into all 7 affected pages' `load()` functions to detect a
      403 and surface the backend's actual `error` message instead of a
      silently-empty list:
      - `src/app/(app)/crm/leads/page.tsx`
      - `src/app/(app)/crm/accounts/page.tsx`
      - `src/app/(app)/crm/campaigns/page.tsx`
      - `src/app/(app)/crm/contacts/page.tsx`
      - `src/app/(app)/crm/opportunities/page.tsx`
      - `src/app/(app)/erp/procurement/page.tsx` (requisitions/rfqs/quotations)
      - `src/app/(app)/erp/journal-entries/page.tsx` (accounts/cost-centers/
        journal-entries/companies)
- [x] `bunx eslint` clean on all 8 changed files. Repo-wide `tsc --noEmit`
      crashes on this host for unrelated reasons (OOM under concurrent
      dispatched workers) but targeted grep of its output shows zero errors
      in any of the changed files.

## Remaining
- [ ] Push branch, open PR.
- [ ] Independently retest live against projexa-ai.com with a fresh
      self-signup org: confirm CRM/ERP pages now show the real explanation
      card instead of a silent empty state. Capture a real screenshot.
- [ ] Update `ai-os/MASTER-TRACKER.yaml` `GAP-ERP-CRM-403-NO-UX-EXPLANATION`
      status honestly based on live retest result.
- [ ] Move ACTIVE-CLAIMS entry to `recently_completed:` once merged.
