-- audit198 gap closure (Owner directive 2026-07-21, wave 6, category
-- NOTIFICATIONS_PRODUCTIVITY): RULE-043 -- "Notifications shall be
-- prioritized intelligently to prevent information overload while
-- ensuring that users always know their next most important action."
--
-- Before this migration, compliance.notifications had no priority concept
-- at all (confirmed by direct read of src/lib/db/schema.ts before writing
-- this) and its ~12 independent insert call sites (task-service.ts,
-- ticket-service.ts, automation-rule-service.ts, compliance-service.ts,
-- risk-escalation-service.ts, metric-alert-service.ts,
-- report-schedule-service.ts, fm-visitor-service.ts,
-- task-nudge-digest-service.ts, cost-guard.ts,
-- instruction-mismatch-audit.ts, tasks/[id]/comments/route.ts) each just
-- inserted a row with no ordering signal.
--
-- Design choice: a BEFORE INSERT trigger, not an application-layer
-- wrapper function every call site would need to adopt. This gets every
-- existing AND future insert path prioritized with zero app-code changes
-- (AI_ENGINEERING_POLICY.yaml: "automation over manual work", "existing
-- database capability" preferred over a new cross-cutting service every
-- caller must remember to use). The read-side ranking/overload-cap logic
-- lives in src/lib/services/notification-priority-service.ts -- that file
-- is deliberately NOT a duplicate of this trigger's classification rule;
-- it consumes the `priority` column this migration adds and does
-- ordering/capping, which is a genuinely different concern from
-- classification.
--
-- Reuses the ALREADY-EXISTING compliance.priority enum (low/medium/high/
-- critical -- the same one compliance_items already uses), not a new
-- notification-specific enum, per "reuse over rebuilding".

ALTER TABLE compliance.notifications
  ADD COLUMN IF NOT EXISTS priority compliance.priority NOT NULL DEFAULT 'medium';

CREATE INDEX IF NOT EXISTS notifications_user_priority_created_idx
  ON compliance.notifications (user_id, priority, created_at DESC);

-- Deterministic, auditable classification -- every branch is a real rule
-- from RULE-043's own domain (deadline proximity, mismatch severity), not
-- an opaque score. `metadata->>'dueDate'` is the same jsonb payload shape
-- Wave 14's notifications.metadata comment already documents.
CREATE OR REPLACE FUNCTION compliance.compute_notification_priority()
RETURNS trigger AS $$
BEGIN
  -- Only auto-classify when the caller didn't already pass an explicit,
  -- non-default priority -- lets a future call site opt out of the
  -- automatic classification by setting its own value, without this
  -- trigger silently overwriting it.
  IF NEW.priority IS NOT NULL AND NEW.priority <> 'medium' THEN
    RETURN NEW;
  END IF;

  NEW.priority := CASE
    -- instruction_mismatch: the AI's output disagreed with the user's
    -- actual instruction -- always needs immediate human attention.
    WHEN NEW.type = 'instruction_mismatch' THEN 'critical'
    -- deadline_reminder within 2 days of its own due date (when the
    -- caller supplied one in metadata) is time-critical; further out is
    -- still important (high) but not yet urgent.
    WHEN NEW.type = 'deadline_reminder'
      AND (NEW.metadata ? 'dueDate')
      AND (NEW.metadata->>'dueDate') ~ '^\d{4}-\d{2}-\d{2}'
      AND (NEW.metadata->>'dueDate')::timestamptz <= now() + interval '2 days'
      THEN 'critical'
    WHEN NEW.type = 'deadline_reminder' THEN 'high'
    -- assignment: someone was just handed new work -- needs prompt
    -- acknowledgement, same tier as a near deadline.
    WHEN NEW.type = 'assignment' THEN 'high'
    WHEN NEW.type IN ('status_change', 'mention') THEN 'medium'
    -- comment/system: informational, no action required by definition --
    -- lowest tier, first to be capped by capForOverload.
    WHEN NEW.type IN ('comment', 'system') THEN 'low'
    ELSE 'medium'
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_compute_priority ON compliance.notifications;
CREATE TRIGGER notifications_compute_priority
  BEFORE INSERT ON compliance.notifications
  FOR EACH ROW
  EXECUTE FUNCTION compliance.compute_notification_priority();

-- Backfill: apply the same classification to rows that already existed
-- before this migration, so prioritization isn't only true for
-- notifications created after this deploys.
UPDATE compliance.notifications SET priority = CASE
  WHEN type = 'instruction_mismatch' THEN 'critical'
  WHEN type = 'deadline_reminder'
    AND (metadata ? 'dueDate')
    AND (metadata->>'dueDate') ~ '^\d{4}-\d{2}-\d{2}'
    AND (metadata->>'dueDate')::timestamptz <= now() + interval '2 days'
    THEN 'critical'
  WHEN type = 'deadline_reminder' THEN 'high'
  WHEN type = 'assignment' THEN 'high'
  WHEN type IN ('status_change', 'mention') THEN 'medium'
  WHEN type IN ('comment', 'system') THEN 'low'
  ELSE 'medium'
END::compliance.priority
WHERE priority = 'medium'; -- only rows still at the column default; never overwrite anything already set
