-- R67 F-25 (audit recommendation R-241) -- index for the dated attendance
-- query.
--
-- listAttendance() gained `date` (one day) and `from`/`to` (an inclusive
-- range) so PROJEXA's Manpower screen stops pulling a project's ENTIRE
-- attendance log on every landing for a tab it opens closed. The predicate is
-- (project_id, attendance_date), and compliance.construction_attendance has no
-- index on either column: 0102_wave116_manpower_attendance_gantt.sql created
-- the table with only its primary key, so every attendance read since -- dated
-- or not -- has been a sequential scan.
--
-- attendance_date DESC matches the ORDER BY the service has always used, so
-- the same index serves both the filter and the sort.
--
-- Hand-authored SQL with a journal entry, matching 0312-0315's convention for
-- index-only migrations (drizzle-kit generate only emits what schema.ts
-- declares, and this index is not declared there).
CREATE INDEX IF NOT EXISTS idx_construction_attendance_project_date
  ON compliance.construction_attendance(project_id, attendance_date DESC);
