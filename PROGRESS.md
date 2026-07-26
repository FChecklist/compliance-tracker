# PROGRESS -- task-20260726-172009-e-invoicing-per-line-gstrt-fix---irp-for

## Finding: already resolved, no code change needed

V2-21 (E-invoicing per-line GstRt fix + IRP format scaffolding) was re-triaged
2026-07-26 as GENUINELY_STILL_OPEN based on `erp-einvoice-service.ts:77` on
`origin/main` allegedly hardcoding `GstRt: 0`. Re-verifying live against this
session's starting HEAD (`7d8c6f28`, == `origin/main`) found that evidence
stale: the fix already shipped 2026-07-21 via PR #492 ("V2-1: finish UAE
country pack"), commits `3dfc0aa1`/`b4220392`, already an ancestor of HEAD
before this session started.

Verification command from the task's own success criteria:

```
$ grep -n "GstRt" src/lib/services/erp-einvoice-service.ts
64:    // V2-21 per-line GstRt fix: resolve each line's real tax rate from its
68:    // two rows); the per-line GstRt for the IRP schema is the combined rate.
```

No hardcoded `GstRt: 0` stub remains. The per-line rate is resolved in
`erp-einvoice-service.ts` from the line's `taxTemplateId` ->
`erpTaxTemplateItems.rate` (combined across CGST+SGST or IGST rows, with the
intra-state/inter-state split derived from org vs. customer GSTIN state
codes), then passed into `src/lib/engines/einvoice-format.ts`'s
`buildEInvoicePayload()`, which routes IN (IRP JSON, `GstRt:
Number(item.taxRatePercent)`) vs AE (FTA Peppol UBL, `ClassifiedTaxCategory.Percent`)
off `organisations.country` with no India-specific hardcoding -- exactly the
"per-line GstRt fix + UAE/India e-invoice format scaffolding behind the
country-config" the original task asked for. Covered by
`src/lib/engines/einvoice-format.test.ts` (asserts `ItemList[0].GstRt` is
`18`, not `0`, on the IN path; asserts the AE path emits UBL shape with no
GstRt/HSN fields; asserts case-insensitive country routing; asserts an
unregistered country throws rather than silently falling back to India's
schema).

The GSP-sandbox live-IRP-submission half is, and remains, deferred on
Owner-provisioned creds -- unchanged by this task, exactly as V2-21 always
specified (tracked under V2-6).

Per this task's own instruction ("If the finding turns out to already be
resolved... say so in PROGRESS.md rather than making an unnecessary
change"), **no source code change was made.**

## Completed
- [x] Read ACTIVE-CLAIMS.yaml; found the original V2-1 claim (which absorbed
      V2-21's code half) still sitting under `active:` 6 days after its PR
      (#492) merged -- moved it to `recently_completed:` and logged this
      session's own verification-only entry alongside it.
- [x] Re-verified live against current `origin/main` (not the stale triage
      snapshot) that the GstRt fix and IN/AE e-invoice format scaffolding
      are both fully implemented, tested, and merged.
- [x] Ran the task's own verification command; confirmed no hardcoded
      `GstRt: 0` stub remains.
- [x] Annotated `ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`'s
      V2-21 section and C12 table row as RE-SCORED CLOSED (code half),
      matching the C1 precedent's annotation style, citing PR #492.
- [x] Docs-only, Tier1, additive changes (ai-os/ governance files only) --
      committed and pushed; opening a PR for visibility even though there is
      no functional code change.

## Remaining
- [ ] None for this task's code scope. GSP-sandbox live IRP/FTA-portal
      submission stays a separate, explicitly-deferred task (V2-6) blocked
      on Owner-provisioned creds -- out of scope here, as the original task
      prompt itself says.
