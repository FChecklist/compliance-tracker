-- WO-DPDP-002 Section 4.1 (RLS test row: "Auditor write is refused").
--
-- 0415's own comment said this was "enforced at the API/service layer via
-- requireRole" -- checked directly (WO-DPDP-002 test-planning pass,
-- 2026-09-16): no such capability check exists anywhere in the dpdp route
-- layer. Every mutating obligation route (accept/reject/assign/submit/
-- not-my-job/stuck) checks only requireDpdpSession() (any authenticated org
-- member) and then loadObligationOrThrow(tx, orgId, obligationId), which
-- filters WHERE org_id = orgId -- the ACTING org, not any RLS-visible org --
-- so today's app code happens not to let an auditor-related org touch
-- another org's obligation. But that safety is accidental (a side effect of
-- one helper's WHERE clause), not designed, and dpdp.obligation's own RLS
-- policy (app_runtime_relationship_scoped, FOR ALL) would allow the write at
-- the database level if any future code path queried/updated by
-- obligationId alone, relying on RLS the way every other RLS'd table in
-- this app does. This migration makes the database itself enforce what the
-- comment already claimed was true: an 'audits' relationship grants READ,
-- never WRITE. 'advises' (the CA/advisor role, which legitimately reviews
-- and accepts/rejects submitted proof -- see V.review in the spec) keeps
-- write access; only 'audits' loses it.
--
-- Verified via src/lib/services/dpdp-obligation-rls.test.ts: before this
-- migration, an app_runtime session in an 'audits' relationship can UPDATE
-- another org's obligation row; after, the identical UPDATE is rejected by
-- RLS (0 rows affected, not an exception -- see that test's own comment on
-- why UPDATE ... RETURNING rather than an error is what a blocked RLS
-- write actually looks like).
DROP POLICY IF EXISTS app_runtime_relationship_scoped ON "dpdp"."obligation";--> statement-breakpoint

CREATE POLICY app_runtime_obligation_read ON "dpdp"."obligation" FOR SELECT TO app_runtime
  USING (
    org_id = dpdp.current_org_id()
    OR (
      assigned_processor_org_id = dpdp.current_org_id()
      AND EXISTS (
        SELECT 1 FROM dpdp.relationship r
        WHERE r.kind = 'processes_for' AND r.from_org = dpdp.current_org_id()
          AND r.to_org = obligation.org_id AND r.agreement_signed_at IS NOT NULL AND r.ended_at IS NULL
      )
    )
    OR EXISTS (
      SELECT 1 FROM dpdp.relationship r
      WHERE r.kind IN ('advises', 'audits') AND r.from_org = dpdp.current_org_id()
        AND r.to_org = obligation.org_id AND r.ended_at IS NULL
    )
  );--> statement-breakpoint

CREATE POLICY app_runtime_obligation_write ON "dpdp"."obligation" FOR INSERT TO app_runtime
  WITH CHECK (
    org_id = dpdp.current_org_id()
    OR (
      assigned_processor_org_id = dpdp.current_org_id()
      AND EXISTS (
        SELECT 1 FROM dpdp.relationship r
        WHERE r.kind = 'processes_for' AND r.from_org = dpdp.current_org_id()
          AND r.to_org = obligation.org_id AND r.agreement_signed_at IS NOT NULL AND r.ended_at IS NULL
      )
    )
    OR EXISTS (
      SELECT 1 FROM dpdp.relationship r
      WHERE r.kind = 'advises' AND r.from_org = dpdp.current_org_id()
        AND r.to_org = obligation.org_id AND r.ended_at IS NULL
    )
  );--> statement-breakpoint

CREATE POLICY app_runtime_obligation_update ON "dpdp"."obligation" FOR UPDATE TO app_runtime
  USING (
    org_id = dpdp.current_org_id()
    OR (
      assigned_processor_org_id = dpdp.current_org_id()
      AND EXISTS (
        SELECT 1 FROM dpdp.relationship r
        WHERE r.kind = 'processes_for' AND r.from_org = dpdp.current_org_id()
          AND r.to_org = obligation.org_id AND r.agreement_signed_at IS NOT NULL AND r.ended_at IS NULL
      )
    )
    OR EXISTS (
      SELECT 1 FROM dpdp.relationship r
      WHERE r.kind = 'advises' AND r.from_org = dpdp.current_org_id()
        AND r.to_org = obligation.org_id AND r.ended_at IS NULL
    )
  )
  WITH CHECK (
    org_id = dpdp.current_org_id()
    OR (
      assigned_processor_org_id = dpdp.current_org_id()
      AND EXISTS (
        SELECT 1 FROM dpdp.relationship r
        WHERE r.kind = 'processes_for' AND r.from_org = dpdp.current_org_id()
          AND r.to_org = obligation.org_id AND r.agreement_signed_at IS NOT NULL AND r.ended_at IS NULL
      )
    )
    OR EXISTS (
      SELECT 1 FROM dpdp.relationship r
      WHERE r.kind = 'advises' AND r.from_org = dpdp.current_org_id()
        AND r.to_org = obligation.org_id AND r.ended_at IS NULL
    )
  );--> statement-breakpoint

CREATE POLICY app_runtime_obligation_delete ON "dpdp"."obligation" FOR DELETE TO app_runtime
  USING (
    org_id = dpdp.current_org_id()
    OR EXISTS (
      SELECT 1 FROM dpdp.relationship r
      WHERE r.kind = 'advises' AND r.from_org = dpdp.current_org_id()
        AND r.to_org = obligation.org_id AND r.ended_at IS NULL
    )
  );
