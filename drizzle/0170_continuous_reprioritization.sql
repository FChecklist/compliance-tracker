-- GAP-CONTINUOUS-REPRIORITIZATION (Tree 1 D22.B2.S1, ai-os/MASTER-TRACKER.yaml).
-- Additive-only: two nullable columns on compliance.tasks so
-- task-reprioritization-service.ts's deterministic deadline-driven
-- recalculation can record, per row, whether the SYSTEM (not a human) most
-- recently changed `priority`, when, and why. No existing row's priority is
-- touched by this migration -- both columns start NULL for every row until
-- the recalculation engine first evaluates it.
--
-- Deliberately narrow, matching the honest scope in
-- task-reprioritization-service.ts's header: this closes the deadline-driven
-- slice of the "Deadlines/Business priorities/Dependencies/Resource
-- availability/Org objectives/User preferences/Risk/SLA" requirement only.
-- No dependency/blocking columns are added here -- confirmed by direct
-- investigation that `tasks` has no dependsOn/blockedBy concept and
-- entity_relationships (the one generic graph table that could carry it) is
-- never written with a 'task' sourceType/targetType anywhere in this
-- codebase today, so there is no real data to recalculate priority from
-- for that axis. Same for SLA: `tickets.sla_deadline` is real, but nothing
-- links a task row to a ticket row (no ticket_id on tasks, no
-- entity_relationships edge ever written between them), so "SLA breach"
-- has no real signal to read for `tasks` specifically, unlike compliance
-- items/tickets which already have their own real overdue detection.

ALTER TABLE compliance.tasks
  ADD COLUMN IF NOT EXISTS last_reprioritized_at timestamp,
  ADD COLUMN IF NOT EXISTS last_reprioritization_reason text;
