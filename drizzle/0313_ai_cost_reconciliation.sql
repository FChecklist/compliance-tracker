-- AI Cost Governance & FinOps gap-closure (2026-08-07): manual monthly
-- provider-invoice reconciliation for token_usage_ledger's estimated spend.
-- See src/lib/db/schema.ts's aiCostReconciliation for the full rationale.
--
-- Hand-written rather than `drizzle-kit generate`: this checkout's
-- drizzle/meta snapshot chain is already drifted from applied migrations
-- (ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml is the standing record of
-- this) -- running generate here proposed re-creating several tables
-- (construction_prevailing_wage_rates, dispatch_outcomes, etc.) that
-- already have real, applied migrations (0300/0301/0302). Isolating this
-- table's own DDL by hand avoids re-bundling that unrelated, already-
-- resolved drift into this PR. Real deploy path per AGENTS.md/CLAUDE.md is
-- `bun run db:push` (schema.ts -> live Supabase directly), so this file is
-- the paper-trail record, not itself the applied mechanism.
CREATE TABLE "compliance"."ai_cost_reconciliation" (
	"id" text PRIMARY KEY NOT NULL,
	"period_month" text NOT NULL,
	"provider" text NOT NULL,
	"actual_invoice_usd" numeric NOT NULL,
	"notes" text,
	"recorded_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
