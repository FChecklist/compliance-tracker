-- Wave 15: Home Page restructure -- tasks.assigned_by_id lets "assigned to
-- me" (To Do) be distinguished from "assigned by me, to someone else"
-- (needed once task assignment to other people exists; every existing row
-- predates that and is self-assigned).
ALTER TABLE compliance.tasks ADD COLUMN IF NOT EXISTS assigned_by_id text REFERENCES compliance.users(id);

UPDATE compliance.tasks SET assigned_by_id = user_id WHERE assigned_by_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by_id ON compliance.tasks(assigned_by_id);
