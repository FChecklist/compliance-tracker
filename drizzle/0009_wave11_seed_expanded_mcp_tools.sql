-- Wave 11: seed global worker_agents rows for the 2 new MCP tools
-- (list_notices, get_task_status) -- routed through the real service layer
-- via internal fetch() to /api/v1 (see src/app/api/mcp/route.ts), not
-- reimplemented with raw Supabase JS like the original 7. Matches the exact
-- seeding pattern established in Wave 3 for the original tools.

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, is_immutable, version, input_schema)
VALUES
  (
    gen_random_uuid()::text, 'global', 'List Notices', 'Cross-Cutting > Data Access',
    'List government/regulatory notices for the organisation with optional filters.',
    'list_notices', true, 1,
    '{"type":"object","properties":{"status":{"type":"string","enum":["received","in_progress","replied","closed","appealed"]},"search":{"type":"string"},"page":{"type":"number","default":1},"limit":{"type":"number","default":20,"maximum":100}}}'::jsonb
  ),
  (
    gen_random_uuid()::text, 'global', 'Get Task Status', 'Cross-Cutting > Data Access',
    'Get the current status of a task by id.',
    'get_task_status', true, 1,
    '{"type":"object","required":["id"],"properties":{"id":{"type":"string"}}}'::jsonb
  )
ON CONFLICT DO NOTHING;
