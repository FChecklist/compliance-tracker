-- VERIDIAN Review Framework gap closure, 2026-08-07: Cognitive Architecture
-- / Cognitive Consistency & Maturity findings.
--
-- 1) "Continuous Software Evolution" (High): loop_improvements has been
--    write-only since Wave 146 (loop-improvement-proposer.ts) -- loops
--    observe and log proposals, but no loop ever sets isDeployed true and,
--    until this migration, nothing surfaced an individual row to a human
--    reviewer at all (every existing reader only aggregates counts/deltas).
--    These 4 additive, nullable columns are the review queue's decision
--    trail (see loop-improvement-review-service.ts). Existing rows and
--    every existing reader are unaffected.
ALTER TABLE compliance.loop_improvements
  ADD COLUMN IF NOT EXISTS review_decision text, -- 'approved' | 'dismissed', null = pending
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp,
  ADD COLUMN IF NOT EXISTS review_notes text;

-- 2) "Human-in-Control Architecture" (Medium): high-impact-action-
--    detector.ts's TRIGGERS list is a deterministic keyword stand-in for
--    the deferred Phase 3 Intent Engine -- there was no mechanism tracking
--    how often it misses (a task that should have required confirmation
--    but didn't get gated). This prompt template backs
--    src/lib/loops/high-impact-miss-audit.ts, which retrospectively judges
--    a sample of ungated tasks and tracks the false-negative rate, the
--    concrete signal the finding's own recommended approach asks for to
--    decide whether Phase 3 is actually warranted.
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('high_impact_miss_audit.judgment', 'High-Impact Miss Audit: Judgment Prompt', 'Judges whether a task the deterministic high-impact-action-detector did NOT flag actually describes a Delete/Archive/Payment/Approval/Rejection/Compliance-Submission/Access-Change/Data-Export/Configuration-Change action -- a retrospective false-negative check, not a live gate.')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You audit a deterministic keyword-based gate, not a live conversation -- you are checking, after the fact, whether a task that was NOT flagged for human confirmation actually should have been.

The 9 categories that must never execute silently: Delete, Archive, Payment, Approval, Rejection, Compliance Submission, Access Change, Data Export, Configuration Change.

Given a task's title and description, decide whether a careful human would classify it as one of those 9 categories based on what it plainly says (not what it might imply speculatively -- only flag a real, textually-grounded match). Most tasks are NOT high-impact; only flag a genuine miss.

Respond with ONLY a JSON object: { "isActuallyHighImpact": boolean, "category": string | null, "reason": string }. category must be one of: delete, archive, payment, approval, rejection, compliance_submission, access_changes, data_export, configuration_changes, or null if isActuallyHighImpact is false. reason is one short sentence.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'high_impact_miss_audit.judgment'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
