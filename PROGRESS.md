# REVIEW-FRAMEWORK-WAVE4 Track 1b item 2 — Audited support-session impersonation

Building a real, audited "act on behalf of customer" support-session capability
(time-limited, fully logged, visible to the impersonated org). Following the
prior session's already-validated plan; not redesigning.

## Completed
- [x] Read auth-guard.ts (veridian_admin / ROLE_RANK), tenant-scoped.ts
      (withTenantContext GUC mechanism), audit.ts (logActivity/auditLogs),
      api-keys.ts (hashSHA256), and the existing tenant-table RLS pattern
      (drizzle/0219 CRM: app_runtime_org_scoped + service_role_bypass +
      FORCE RLS) before writing any code.
- [x] Confirmed zero pre-existing support-session/impersonation concept
      (only unrelated "impersonat" mention is communication-guardrails.ts).
- [x] Confirmed audit_logs vs activity_log are distinct tables.
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml.
- [x] schema.ts: added supportSessions table (initiatedByUserId/Name,
      targetOrgId, targetUserId/Name, reason, tokenHash, expiresAt,
      endedAt/endedReason) + relations, plus 2 nullable columns on the
      EXISTING auditLogs table (supportSessionId, actingOnBehalfOfUserId).
- [x] drizzle/0224_support_sessions.sql — table + FORCE RLS 2-policy
      (app_runtime_org_scoped on target_org_id / service_role_bypass) shape
      matching drizzle/0219's precedent, + the 2 additive audit_logs columns.
      NOT applied to a live DB from this session (no DATABASE_URL / Supabase
      MCP available here) -- committed as the real migration for deploy/
      db:push to pick up, same as this repo's other recent migrations.
- [x] src/lib/services/support-session-service.ts: startSupportSession/
      endSupportSession/validateSupportSessionToken/
      listSupportSessionsForOrg/getSupportSessionById, reusing hashSHA256
      from api-keys.ts. Cross-org writes go through the raw db client
      (same posture as autoProvisionUser/provisionOrganisation); the
      target-org's-own-admin read (listSupportSessionsForOrg) goes through
      withTenantContext/RLS. Pure helpers: evaluateSupportSessionStatus,
      isSupportSessionActive, generateSupportSessionToken.
- [x] Extended src/lib/audit.ts's logActivity() with an optional
      `supportSession` param (backward-compatible -- every existing call
      site passes neither field and is unaffected).
- [x] Routes: POST /api/support-sessions/start (veridian_admin only),
      POST /api/support-sessions/[id]/end (veridian_admin OR the target
      org's own admin), GET /api/support-sessions/whoami-target (bearer
      ss_... token, proves a real tenant-scoped read + a real
      audit-marked log row), GET /api/support-sessions/on-my-org (target
      org's own admin, RLS-scoped by target_org_id = current_org_id()).
- [x] src/lib/services/support-session-service.test.ts — pure-helper unit
      tests (evaluateSupportSessionStatus, isSupportSessionActive,
      generateSupportSessionToken).

- [x] Ran tsc --noEmit (0 errors), eslint (0 errors, 3 pre-existing
      warnings unrelated to this change), bun test (1389 pass / 0 fail
      across 102 files, incl. the 12 new pure-helper tests in
      support-session-service.test.ts).
- [x] Moved ai-os/boss/ACTIVE-CLAIMS.yaml entry to recently_completed.

## Remaining
- [ ] Open the PR (branch worker/task-20260717-194828-support-session-impersonation).
- [ ] Live DB migration (drizzle/0224_support_sessions.sql) needs to be
      applied via db:push/Supabase MCP by a session with DB access -- this
      session had neither DATABASE_URL nor Supabase MCP available.
