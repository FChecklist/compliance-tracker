# PROGRESS -- task-20260727-101134-erp-helpdesk-gaps--tiered-sla---team-rou

Owner directive DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE,
Phase 0 investigation (2026-07-27). Closes 3 confirmed-real Helpdesk gaps
vs. Odoo's stock Helpdesk app (compliance-tracker's Helpdesk already
exceeds Odoo in several other respects -- ITIL problem management, AI
ticket intelligence, voice-to-ticket -- this was narrow gap-closure, not a
rebuild).

## Completed

- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting (no collision found).
- [x] Re-verified all 3 gaps by direct code inspection (grep + full-file reads), confirming the SPEC's KNOWN_CONTEXT:
  - Gap 1 (tiered SLA/routing): confirmed absent -- `tickets.slaDeadline` was one ad-hoc timestamp from `input.slaHours` (`ticket-service.ts:71`, pre-change), zero `slaPolic`/`escalationRule`/`businessHours`/`teams` matches in schema.ts.
  - Gap 2 (email-to-ticket): confirmed absent -- `emailIntelligenceItems` only promoted to `tasks`, never `tickets`; schema.ts's own header comment already said so.
  - Gap 3 (self-service portal): confirmed absent -- `knowledgeBasePages` had no publish flag, `/knowledge-base` and `/tickets` are both in the protected-route allowlist, guest access is always staff-issued after a ticket exists.
- [x] **Gap 1 -- tiered SLA policy + team routing**:
  - Schema (`src/lib/db/schema.ts`, migration `drizzle/0264_helpdesk_tiered_sla_team_routing.sql`): `ticketTeams`, `businessHoursSchedules`, `slaPolicies`, `escalationRules`, `ticketEscalationEvents` tables; `tickets.teamId`/`slaPolicyId`/`requesterEmail` columns. Full RLS (`app_runtime_org_scoped` + `service_role_bypass_*`) matching the existing Wave 81 migration's own pattern exactly.
  - Service (`src/lib/services/ticket-service.ts`): `scoreSlaPolicyMatch`/`pickBestSlaPolicy` (pure, most-specific-match-wins scoring), `computeSlaDeadline` (business-hours-aware, UTC-based -- see its own doc comment for the documented IANA-timezone simplification), `resolveSlaPolicy`, `checkTicketEscalations()` (idempotent cron, wired into the existing `/api/internal/metric-alerts/run` cron -- no new cron job, no cron enablement changed, per this task's own constraint), plus CRUD (`listTicketTeams`/`createTicketTeam`/`updateTicketTeam`, `listSlaPolicies`/`createSlaPolicy`/`updateSlaPolicy`, `listEscalationRules`/`createEscalationRule`, `listBusinessHoursSchedules`/`createBusinessHoursSchedule`). `createTicket()` now resolves SLA from a matching policy when `input.slaHours` is omitted -- **the manual override path is unchanged byte-for-byte** (backward compatible, per spec).
  - Routes: `/api/ticket-teams` (+`[id]`), `/api/sla-policies` (+`[id]`), `/api/escalation-rules`, `/api/business-hours-schedules` -- all `requireAuth()`-gated, same convention as every existing ticket route.
  - Tests: `src/lib/services/ticket-service.test.ts` -- 10 pure-function tests (policy specificity scoring + business-hours deadline math incl. weekend rollover), **all passing** (`bun test`).
- [x] **Gap 2 -- email-to-ticket ingestion**: `createTicketFromEmailIntelligenceItem()` in `ticket-service.ts` promotes an `emailIntelligenceItems` row straight to a `tickets` row (reuses the existing email-ingestion record rather than building a second pipeline, per spec) -- posts the email body as the first conversation message, sets `requesterEmail`, marks the source item `promotedTicketId`/`status: "promoted_to_ticket"`. Route: `POST /api/email-intelligence/[id]/promote-to-ticket`.
- [x] **Gap 3 -- public self-service portal**:
  - `knowledgeBasePages.isPublished` (default false -- every existing page stays internal-only unless a staff member opts in via `updateKbPage`'s now-accepted `isPublished` patch field).
  - New `src/lib/services/public-portal-service.ts`: resolves org by its existing public `organisations.slug` (same established convention as `getOrgBySlugWithSso` in sso-service.ts), lists/reads only `isPublished` KB pages, and `submitPublicTicket()` -- creates a real ticket + conversation, routed to the org's default `ticketTeams` row (rejects with 400 if none configured, rather than silently creating an RLS-invisible orphan ticket) and issues a self-serve `conversationGuestAccess` token (reusing that exact existing mechanism, not a new one) so the anonymous submitter can check back.
  - Rate limiting: new `publicTicketSubmissionAttempts` table + `checkPublicTicketRateLimit`, same DB-log-table-plus-windowed-count pattern as `org_join_code_attempts`/`checkJoinCodeRateLimit` -- the one real rate-limit precedent in this codebase (guest-chat itself has none, by its own documented design).
  - Routes (genuinely unauthenticated, no `requireAuth()`): `GET /api/public/portal/[orgSlug]/kb`, `GET /api/public/portal/[orgSlug]/kb/[slug]`, `POST /api/public/portal/[orgSlug]/tickets`.
- [x] Verification given this sandbox's lack of a live DB/Supabase connection: `bun test` (10/10 pass on the new pure-function suite), `bun build` on every new/changed file (all bundle cleanly -- catches import/syntax errors, not full type errors). Full-project `npx tsc --noEmit` OOM'd in this sandbox (>8GB heap) both times it was attempted -- **not run to completion here**; CI's own Type Check job (AGENTS.md Rule 6 gate) will run it for real before merge.

## Remaining

- [ ] CI must actually run and pass (Lint/Type Check/Build/Unit Tests) -- full-project `tsc --noEmit` could not be completed in this sandbox (OOM), so there is real residual risk of a type error CI will catch that this session didn't.
- [ ] `get_advisors(security)` was not run (no live Supabase MCP connection available in this sandbox this session) -- **must be run against the real project before/at merge**, with particular attention to the new public-portal routes/RLS per this task's own SUCCESS_CRITERIA.
- [ ] No live DB to apply `drizzle/0264_helpdesk_tiered_sla_team_routing.sql` against this session -- migration is hand-written (following the exact existing pattern from `0067_wave81_customer_service_enhancements.sql`/`0146_org_join_codes.sql`) and journal-registered, but **not yet applied to any real database**; whoever merges/deploys this must run it (`bun run db:push` or the standard migration-apply step) before the new tables/columns exist for real.
- [ ] No minimal public-facing UI pages were built for the self-service portal (e.g. `/portal/[orgSlug]`) -- only the API routes exist and are tested. The SPEC's SUCCESS_CRITERIA only requires the anonymous-caller API behavior (browse published KB, raise a ticket without a pre-issued token), which is met; a real page UI is left as a followup if the Owner wants a browsable frontend, not just an API surface.
- [ ] Admin UI for configuring SLA policies/teams/escalation rules/business-hours schedules doesn't exist yet either -- only the CRUD API routes. An org must currently configure these via direct API calls (or a future admin screen) before tiered SLA/team routing or the public portal (which requires a default team) actually activate for that org.
- [ ] PR not yet opened/merged as of this checkpoint -- see git log for the commit(s) this PROGRESS.md update ships with.
